// Combat des parties croisées (tâche O2.3) : attaque, bloqueur, contres, résolution, dégâts, déclencheurs, KO et double
// attaque, dans les deux sens, comme une petite machine à états par échange.
//
// Qui tranche (interprétation 4400) : le moteur joy-boy. Le jeu OPTCGSim n'envoie pas l'issue d'un combat : chacun la
// calcule (GameplayLogicScript.ResolveAttack_Internal). Le moteur résout donc lui-même ses combats, dégâts compris, et le
// miroir (mirror.ts) prend les puissances du moteur (mirrorOptions) pour déduire la même issue côté OPTCGSim. Les
// mutations que le miroir tire de ResolveAttack ne sont jamais rejouées dans le moteur (elles y sont déjà) ; un écart
// entre les deux tables est noté (notes).
//
// Pour que les dégâts attendent la défense, advanceShared (engine.ts) s'arrête avant l'étape des dégâts tant que le
// combat n'est pas « libéré » (Battle.release) : c'est ce module qui la lève, au ResolveAttack.
//
// Les échanges, d'après GameplayLogicScript et NetworkPlayerScript (1.45a) et les fixtures du 17 nov. :
//
// OPTCGSim attaque, joy-boy défend (phase 'defense') :
//   reçu  TapCard, SetupAttack, [MoveToBlocker, effets [En attaquant]], SelectBlocker (ou SelectBlockerNoProcs)
//   envoi [effets [Attaque adverse]], SetBlocker(i) ou NoBlocker
//   envoi pour chaque contre : MoveHandCardToDiscard(i), AddCounterAmount(x) ; Évènement [Contre] : ses effets, puis
//         AddCounterAmount(x) pour son bonus au défenseur
//   envoi AllOnKOResolved, ResolveAttack            (le défenseur résout ; repoussée : rien de plus)
//   Leader touché : phase de déclenchement ; sans [Déclenchement] ou refusé : rendre la main (ReturnToOpponentActionPhase :
//         AllOnKOResolved, SwitchTurns, ResetActionPhase, NoMorePendingActions) ; activé : ses effets, puis la carte
//         (MoveHandCardToDiscard ou MoveHandCardToDeploy), puis rendre la main ; double attaque : entre les deux vies,
//         PlayerDrawLife(1), MoveToSecondLifeTrigger (TriggerEnd_DoubleAttack) ; [Exil] : rendre la main aussitôt
//   Personnage mis KO : ses effets [En cas de KO], puis rendre la main ; plus d'attaque possible : AllOnKOResolved,
//         ResolveNoAttack
//
// joy-boy attaque, OPTCGSim défend (phase 'attack') :
//   envoi TapCard(i) ; SetupAttack(i, j, …) [+ MoveToBlocker si l'attaquant a un effet [En attaquant]] ; effets
//         [En attaquant] ; SelectBlocker
//   reçu  SetBlocker(i) ou NoBlocker ; contres (MoveHandCardToDiscard, AddCounterAmount) ; AllOnKOResolved, ResolveAttack
//   reçu  Leader touché ou Personnage mis KO : ses effets, [PlayerDrawLife(1), MoveToSecondLifeTrigger,] puis
//         AllOnKOResolved, SwitchTurns, ResetActionPhase, NoMorePendingActions : la main revient à joy-boy
//   plus d'attaque possible avant le blocage : AllOnKOResolved, ResolveNoAttackFromAttackerSide
//
// Le module est pur : chaque appel rend le nouvel état du combat, le nouvel état du moteur, les lots de ServerRpc à
// envoyer, les mutations du miroir que la session applique encore (inbound), et ce que la traduction joy-boy → OPTCGSim
// (outbound) ne doit pas envoyer en plus (handled). Indices : `ctx.mirror` est la table telle qu'OPTCGSim la verra après
// les RPC déjà envoyées ; les RPC d'un même appel s'y appliquent l'une après l'autre (la position d'une carte change).
import '../../engine/cards/index.ts';
import { cardData } from '../../engine/cards/index.ts';
import {
  allField, def, donTotal, emit, findField, hasKeyword, isNegated, log, other, power, triggerEffect,
} from '../../engine/rules.ts';
import { advanceShared } from '../../engine/engine.ts';
import type { GameState, Modifier, PendingEffect } from '../../engine/types.ts';
import { answerExternal, forceDecision, isForced } from './external.ts';
import { applyRpc, baseName, type Mirror, type MirrorOptions } from './mirror.ts';
import { cardName, translateOutbound } from './outbound.ts';
import type { External, Rpc, Seat } from './types.ts';

// ---------------------------------------------------------------------------------------------------- types

export type CombatStep =
  | 'none'      // pas de combat
  | 'onAttack'  // attaque annoncée : l'attaquant résout ses effets [En attaquant]
  | 'block'     // le défenseur choisit un bloqueur, puis ses contres
  | 'trigger'   // joy-boy défend, Leader touché : phase de déclenchement
  | 'handBack'; // le défenseur finit (effets [En cas de KO], déclencheur) et rend la main

/** Ce que le combat a calculé au moment des dégâts (puissances du moteur, mots-clés, issue attendue). */
export interface Snapshot {
  attacker: number; target: number;                 // puissances (contres compris)
  attackerUid: number; targetUid: number; attackerNum: string;
  defender: Seat; leader: boolean; double: boolean; banish: boolean;
  /** Issue selon le moteur. */
  outcome: 'repelled' | 'ko' | 'hit' | 'banished' | 'over';
  /** Cartes de Vie que l'attaque doit prendre (dessus d'abord) et si chacune pose la question du [Déclenchement]. */
  lifeUids: number[]; asks: boolean[];
}

export interface CombatState {
  phase: 'idle' | 'defense' | 'attack';
  step: CombatStep;
  attacker?: number;  // uid moteur
  target?: number;    // uid moteur (le bloqueur après un blocage)
  blockSent?: boolean;
  /** OPTCGSim défend : total des contres reçus (AddCounterAmount, SetCounterAmount). */
  counter?: number;
  snap?: Snapshot;
  /** joy-boy défend : questions de [Déclenchement] déjà répondues ; seconde vie (double attaque) déjà envoyée. */
  triggers?: number;
  secondSent?: boolean;
  /** joy-boy défend : cartes de Vie dont le [Déclenchement] activé est déjà traduit (double attaque : la première). */
  triggered?: number[];
  /** OPTCGSim défend, double attaque : sa seconde vie (PlayerDrawLife) est déjà dans le moteur. */
  secondLife?: boolean;
}

export interface CombatContext {
  /** Table vue par OPTCGSim (RPC déjà envoyées comprises), pour les indices. */
  mirror: Mirror;
  /** Siège du joueur joy-boy (1 par défaut, contrat de l'étape O). */
  joyboy?: Seat;
  /** Objet réseau du joueur joy-boy (celui de ses ServerRpc). */
  object?: number;
}

export interface Handled {
  /** Cartes dont le changement d'état vient du combat (ou est calculé par OPTCGSim lui-même). */
  uids: number[];
  /** Bonus de combat déjà envoyés en AddCounterAmount (uid de la carte, valeur). */
  mods: { uid: number; amount: number }[];
}

export interface CombatResult {
  combat: CombatState;
  game: GameState;
  /** Lots de ServerRpc à envoyer, dans l'ordre (la session peut les espacer, le prototype attendait 1 s). */
  send: Rpc[][];
  /** Les RPC traduites par outbound pour ce pas (effets des cartes joy-boy) vont avant ce lot ; par défaut à la fin. */
  effectsBefore?: number;
  /** Mutations du miroir à appliquer encore au moteur (inbound) : celles du combat en sont retirées. */
  externals: External[];
  handled: Handled;
  /** Écarts entre le moteur et le miroir, RPC inattendues. */
  notes: string[];
}

export const IDLE: CombatState = { phase: 'idle', step: 'none' };
export const createCombat = (): CombatState => ({ ...IDLE });

/** RPC dont le combat s'occupe (sans suffixe). */
export const COMBAT_RPCS: ReadonlySet<string> = new Set([
  'SetupAttack', 'MoveToBlocker', 'SelectBlocker', 'SelectBlockerNoProcs', 'EnterBlockPhase', 'SetBlocker', 'NoBlocker',
  'SetNewDefender', 'AddCounterAmount', 'SetCounterAmount', 'ResetCounterPhase', 'ResolveAttack', 'ResolveNoAttack',
  'ResolveNoAttackFromAttackerSide', 'AllOnKOResolved', 'EnterTriggerPhase', 'DoNoTrigger', 'MoveToSecondLifeTrigger',
  'SwitchTurns', 'ResetActionPhase', 'NoMorePendingActions', 'TellOpponentImResolving',
]);

/**
 * Le joueur joy-boy doit-il attendre le jeu OPTCGSim (rien à lui présenter) ? Oui pendant les effets [En attaquant]
 * d'OPTCGSim et pendant toute la défense d'OPTCGSim, sauf une question d'un effet de joy-boy (dégâts infligés…).
 */
export function waiting(c: CombatState, game: GameState, joyboy: Seat = 1): boolean {
  const ownQuestion = Boolean(game.decision?.inEffect && game.decision.player === joyboy);
  return (c.phase === 'attack' && c.step !== 'onAttack' && !ownQuestion) || (c.phase === 'defense' && c.step === 'onAttack');
}

/** La réponse du joueur joy-boy passe-t-elle par le combat (combatAnswer) ? */
export function routesTo(c: CombatState, choice: string): boolean {
  return c.phase !== 'idle' || choice.startsWith('attack:');
}

// ---------------------------------------------------------------------------------------------------- miroir

const HOLD_TAG = 'optcgsimAttack';

function stats(code: string, c: CombatState) {
  const d = cardData()[code];
  if (!d) return undefined;
  const keywords: string[] = [...(d.keywords ?? [])];
  // mots-clés accordés par un effet du moteur à l'attaquant ([Double attaque], [Exil]) : le miroir doit les voir
  if (c.snap && code === c.snap.attackerNum) {
    if (c.snap.double && !keywords.includes('Double Attack')) keywords.push('Double Attack');
    if (c.snap.banish && !keywords.includes('Banish')) keywords.push('Banish');
  }
  return { power: d.power, keywords, ...(d.category === 'LEADER' ? { maxDon: donTotal(code) } : {}) };
}

/** Puissances du combat en cours dans le moteur, avant les dégâts. */
function livePowers(game: GameState): { attacker: number; target: number } | undefined {
  const b = game.battle;
  if (!b || game.flow.stage !== 'battle' || b.step === 'end' || !findField(game, b.attacker) || !findField(game, b.target)) return undefined;
  return { attacker: power(game, b.attacker), target: power(game, b.target) };
}

/**
 * Options du miroir pendant une partie croisée : puissances du moteur (effets passifs et contres compris) au moment du
 * combat, mots-clés du catalogue et ceux que le moteur a accordés à l'attaquant. Le contre du miroir (AddCounterAmount)
 * est déjà dans la puissance du moteur : on le retire au défenseur pour ne pas le compter deux fois.
 */
export function mirrorOptions(c: CombatState, game: GameState): MirrorOptions {
  return {
    stats: (code) => stats(code, c),
    power: (state, _seat, _card, attacking) => {
      const v = c.snap ?? livePowers(game);
      if (!v) return undefined;
      return attacking ? v.attacker : v.target - (state.battle?.counter ?? 0);
    },
  };
}

// ---------------------------------------------------------------------------------------------------- outils

interface Work {
  c: CombatState; game: GameState; mirror: Mirror; send: Rpc[][]; externals: External[]; handled: Handled; notes: string[];
  joyboy: Seat; foreign: Seat; object: number; effectsBefore?: number;
  /** État du moteur avant le traitement des dégâts (base des effets de [Déclenchement] à traduire). */
  base?: GameState;
}

function start(c: CombatState, game: GameState, ctx: CombatContext, externals: External[] = []): Work {
  const joyboy = ctx.joyboy ?? 1;
  return {
    c: structuredClone(c), game, mirror: ctx.mirror, send: [], externals, handled: { uids: [], mods: [] }, notes: [],
    joyboy, foreign: other(joyboy) as Seat, object: ctx.object ?? 0,
  };
}

function done(w: Work): CombatResult {
  return {
    combat: w.c, game: w.game, send: w.send.filter((l) => l.length), externals: w.externals, handled: w.handled, notes: w.notes,
    ...(w.effectsBefore !== undefined ? { effectsBefore: w.effectsBefore } : {}),
  };
}

/** Une ServerRpc du joueur joy-boy ; appliquée aussitôt à la table de travail (les indices suivants en tiennent compte). */
function rpc(w: Work, name: string, values: Record<string, unknown> = {}): Rpc {
  const r: Rpc = { name: `${name}ServerRpc`, object: w.object, behaviour: 0, values };
  w.mirror = applyRpc(w.mirror, r, w.joyboy, mirrorOptions(w.c, w.game)).state;
  return r;
}

function lot(w: Work, ...rpcs: [string, Record<string, unknown>?][]) {
  w.send.push(rpcs.map(([n, v]) => rpc(w, n, v ?? {})));
}

const HAND_BACK: [string][] = [['AllOnKOResolved'], ['SwitchTurns'], ['ResetActionPhase'], ['NoMorePendingActions']];

/** Position OPTCGSim d'une carte du terrain (-1 = Leader) : par uid, sinon par la position du moteur ou le code. */
function fieldIndex(w: Work, seat: Seat, uid: number): number {
  const P = w.game.players[seat];
  if (P.leader.uid === uid) return -1;
  const deploy = w.mirror.players[seat].zones.deploy;
  const byUid = deploy.findIndex((c) => c.uid === uid);
  if (byUid >= 0) return byUid;
  const e = P.chars.findIndex((c) => c.uid === uid);
  const num = P.chars[e]?.num;
  if (e >= 0 && deploy[e]?.code === num) return e;
  const byCode = deploy.findIndex((c) => c.code === num && c.uid === undefined);
  if (byCode < 0) w.notes.push(`carte ${num ?? uid} introuvable sur le terrain OPTCGSim du joueur ${seat}`);
  return byCode >= 0 ? byCode : Math.max(e, 0);
}

/** Position OPTCGSim d'une carte de la main : par uid, sinon une carte du même code (dernière arrivée si `last`). */
function handIndex(w: Work, seat: Seat, uid: number, num: string, last = false): number {
  const hand = w.mirror.players[seat].zones.hand;
  const byUid = hand.findIndex((c) => c.uid === uid);
  if (byUid >= 0) return byUid;
  const same = hand.map((c, i) => [c, i] as const).filter(([c]) => c.code === num && c.uid === undefined);
  const pick = last ? same.at(-1) : same[0];
  if (!pick) { w.notes.push(`carte ${num} introuvable dans la main OPTCGSim du joueur ${seat}`); return Math.max(hand.length - 1, 0); }
  return pick[1];
}

/** uid moteur d'une carte du terrain désignée par OPTCGSim (iIdx, -1 = Leader). */
function engineUid(w: Work, seat: Seat, idx: number): number | undefined {
  const P = w.game.players[seat];
  if (idx === -1) return P.leader.uid;
  const m = w.mirror.players[seat].zones.deploy[idx];
  if (m?.uid !== undefined && P.chars.some((c) => c.uid === m.uid)) return m.uid;
  const e = P.chars[idx];
  if (e && (!m || m.code === e.num)) return e.uid;
  const byCode = P.chars.find((c) => c.num === m?.code);
  if (!byCode) w.notes.push(`carte OPTCGSim ${idx} du joueur ${seat} sans équivalent dans le moteur`);
  return byCode?.uid ?? e?.uid;
}

const num = (r: Rpc, k: string, d = 0) => (typeof r.values?.[k] === 'number' ? (r.values[k] as number) : d);
const forJoyboy = (w: Work) => Boolean(w.game.decision && w.game.decision.player === w.joyboy);
const inBattle = (g: GameState) => g.flow.stage === 'battle' && Boolean(g.battle) && g.battle!.step !== 'end';
const held = (g: GameState) => inBattle(g) && g.battle!.step === 'damage' && !g.battle!.release;

function answer(w: Work, choice: string) {
  w.game = answerExternal(w.game, choice, { joyboy: w.joyboy });
}

/** Questions et décisions de combat du joueur OPTCGSim : le moteur ne les pose que pour suivre son jeu. */
function settleForeign(w: Work, opts: { block?: boolean; counter?: boolean; trigger?: boolean }) {
  for (let guard = 0; guard < 20; guard++) {
    const d = w.game.decision;
    if (!d || d.player !== w.foreign) return;
    if (opts.block && d.kind === 'blocker') answer(w, 'noblock');
    else if (opts.counter && d.kind === 'counter') answer(w, 'pass');
    // [Déclenchement] d'une carte OPTCGSim : la carte va en main ; s'il l'active, son jeu envoie la suite
    else if (opts.trigger && d.inEffect && d.tag === 'trigger' && d.options.some((o) => o.id === 'hand')) answer(w, 'hand');
    else return;
  }
}

/** Bonus de combat apparus sur la carte `uid` entre deux états (contres, Évènements [Contre]). */
function newBattleMods(before: GameState, after: GameState, uid: number): Modifier[] {
  const seen = new Map<string, number>();
  const key = (m: Modifier) => `${m.uid}|${m.stat}|${m.amount}|${m.until}|${m.source}`;
  for (const m of before.mods) seen.set(key(m), (seen.get(key(m)) ?? 0) + 1);
  const out: Modifier[] = [];
  for (const m of after.mods) {
    const k = key(m);
    if (seen.get(k)) { seen.set(k, seen.get(k)! - 1); continue; }
    if (m.uid === uid && m.stat === 'power' && m.until === 'battle' && m.amount > 0) out.push(m);
  }
  return out;
}

function snapshot(game: GameState): Snapshot {
  const b = game.battle!;
  const att = findField(game, b.attacker)!;
  const tgt = findField(game, b.target)!;
  const pa = power(game, b.attacker);
  const pd = power(game, b.target);
  const double = hasKeyword(game, att.player, att.card, 'Double Attack');
  const banish = hasKeyword(game, att.player, att.card, 'Banish');
  const life = game.players[tgt.player].life;
  const hit = pa >= pd;
  const outcome: Snapshot['outcome'] = !hit ? 'repelled' : !tgt.leader ? 'ko' : !life.length ? 'over' : banish ? 'banished' : 'hit';
  const lifeUids = hit && tgt.leader ? life.slice(0, double ? 2 : 1).map((c) => c.uid) : [];
  const asks = lifeUids.map((u) => {
    const n = life.find((c) => c.uid === u)!.num;
    return !banish && Boolean(def(n).trigger) && Boolean(triggerEffect(n));
  });
  return {
    attacker: pa, target: pd, attackerUid: b.attacker, targetUid: b.target, attackerNum: att.card.num, defender: tgt.player as Seat,
    leader: tgt.leader, double, banish, outcome, lifeUids, asks,
  };
}

/** Lève l'arrêt avant les dégâts : le moteur résout le combat (c.snap garde les puissances pour le miroir). */
function release(w: Work) {
  w.c.snap = snapshot(w.game);
  const s = structuredClone(w.game);
  s.battle!.release = true;
  s.decision = null;
  w.game = advanceShared(s, w.joyboy);
}


/**
 * Ce que le miroir a déduit de ResolveAttack, comparé au moteur (vies et terrain du défenseur). `pending` : vies que
 * le moteur a déjà prises et qu'OPTCGSim prendra plus tard (seconde vie d'une double attaque). Seulement hors d'un effet
 * (pendant une question, l'état visible du moteur n'est pas fini).
 */
function compare(w: Work, pending = 0) {
  const snap = w.c.snap;
  if (!snap || w.game.decision?.inEffect || w.game.winner !== null || w.mirror.over) return;
  const P = w.game.players[snap.defender];
  const M = w.mirror.players[snap.defender].zones;
  if (M.life.length !== P.life.length + pending) w.notes.push(`écart au combat : ${M.life.length} vie(s) chez OPTCGSim, ${P.life.length + pending} d'après le moteur`);
  if (M.deploy.length !== P.chars.length) w.notes.push(`écart au combat : ${M.deploy.length} Personnage(s) chez OPTCGSim, ${P.chars.length} dans le moteur`);
}

/** Seconde vie d'une double attaque sans [Exil] que le défenseur prend après le premier déclenchement. */
const twoLives = (snap: Snapshot) => snap.double && !snap.banish && snap.outcome === 'hit' && snap.lifeUids.length > 1;

/** Fin de l'échange : plus de combat ; les puissances restent pour l'écho de ResolveAttack (miroir de la session). */
function toIdle(w: Work) {
  w.c = { phase: 'idle', step: 'none', ...(w.c.snap ? { snap: w.c.snap } : {}) };
}

// ---------------------------------------------------------------------------------------------------- joy-boy défend

/** SetupAttack d'OPTCGSim : le combat s'ouvre dans le moteur, arrêté le temps des effets [En attaquant] de l'attaquant. */
function openDefense(w: Work, r: Rpc) {
  const attacker = engineUid(w, w.foreign, num(r, 'iAttackerIdx', -1));
  const target = engineUid(w, w.joyboy, num(r, 'iDefenderIdx', -1));
  if (attacker === undefined || target === undefined) { w.notes.push('SetupAttack : attaquant ou cible inconnus du moteur'); return; }
  if (w.game.decision?.inEffect) { w.notes.push('SetupAttack pendant un effet du moteur : combat ignoré'); return; }
  const s = structuredClone(w.game);
  s.decision = null;
  s.battle = { attacker, target, step: 'block', blocked: false };
  s.flow = { stage: 'battle' };
  const a = findField(s, attacker)!;
  if (!a.card.rested) a.card.rested = true;  // TapCard précède SetupAttack ; au cas où il manque
  log(s, w.foreign, `${def(a.card.num).name} (${power(s, attacker)}) attaque ${def(findField(s, target)!.card.num).name}`);
  w.game = forceDecision(s, { player: w.foreign, prompt: 'Le joueur OPTCGSim résout ses effets [En attaquant]', options: [{ id: 'go', label: 'Continuer' }], tag: HOLD_TAG });
  w.c = { phase: 'defense', step: 'onAttack', attacker, target };
}

/** SelectBlocker : à joy-boy de défendre ; ses effets [Attaque adverse] d'abord (10-2-16). */
function startDefense(w: Work) {
  const s = structuredClone(w.game);
  if (isForced(s.decision) && s.decision!.tag === HOLD_TAG) s.decision = null;
  const b = s.battle;
  if (!b || !findField(s, b.attacker)) { w.game = s; return; }
  const a = findField(s, b.attacker)!;
  const effects: PendingEffect[] = allField(s, w.joyboy).filter((c) => def(c.num).onOpponentAttack && !isNegated(s, c.uid))
    .map((c) => ({ kind: 'onOpponentAttack', source: c.uid, num: c.num, controller: w.joyboy, answers: [] }));
  emit(s, { type: 'attack', player: w.foreign, uid: b.attacker, num: a.card.num, zone: a.leader ? 'leader' : 'character', by: w.foreign, cause: 'attack', target: b.target }, effects);
  w.c.step = 'block';
  w.game = advanceShared(s, w.joyboy);
}

/** Fait avancer la défense de joy-boy jusqu'à la prochaine décision qui lui revient, en envoyant ce que son jeu enverrait. */
function followDefense(w: Work) {
  for (let guard = 0; guard < 20; guard++) {
    const c = w.c;
    if (c.phase !== 'defense' || c.step === 'onAttack') return;
    // l'étape du bloqueur est passée sans que joy-boy ait eu à choisir (aucun [Bloqueur]) : NoBlocker, comme bAutoNoBlock
    if (c.step === 'block' && !c.blockSent && inBattle(w.game) && w.game.battle!.step !== 'block') { lot(w, ['NoBlocker']); c.blockSent = true; }
    if (forJoyboy(w)) {
      if (w.game.decision!.inEffect && w.game.decision!.tag === 'trigger') secondLifeBeforeQuestion(w);
      return;
    }
    if (c.step === 'block') {
      if (held(w.game)) {
        c.target = w.game.battle!.target;
        const before = w.mirror;
        lot(w, ['AllOnKOResolved'], ['ResolveAttack']);
        release(w);
        afterDefenseDamage(w, before);
        continue;
      }
      if (!inBattle(w.game)) {
        // plus de combat avant les dégâts (attaquant ou cible partis) : le défenseur annule l'attaque (ResolveNoAttack)
        lot(w, ['AllOnKOResolved'], ['ResolveNoAttack']);
        toIdle(w);
      }
      return;
    }
    if (c.step === 'trigger') {
      // phase de déclenchement finie (refusé, absent ou résolu) : cartes de Vie activées, seconde vie, puis rendre la main
      const snap = c.snap!;
      if (twoLives(snap) && !c.secondSent) { lot(w, ['PlayerDrawLife', { iCount: 1 }], ['MoveToSecondLifeTrigger']); c.secondSent = true; }
      triggerEffects(w);
      compare(w);
      lot(w, ...HAND_BACK);
      toIdle(w);
      return;
    }
    if (c.step === 'handBack') {
      compare(w);
      lot(w, ...HAND_BACK);
      toIdle(w);
    }
    return;
  }
}

/** Après ResolveAttack (joy-boy défend) : issue vue par OPTCGSim (miroir, qui fait le protocole) et par le moteur. */
function afterDefenseDamage(w: Work, before: Mirror) {
  const snap = w.c.snap!;
  w.handled.uids.push(...snap.lifeUids);
  const mb = before.players[w.joyboy].zones, ma = w.mirror.players[w.joyboy].zones;
  const mirrorHit = ma.life.length < mb.life.length;
  const mirrorKo = ma.deploy.length < mb.deploy.length;
  if (w.game.winner !== null || w.mirror.over) { toIdle(w); return; }
  if (snap.outcome === 'ko' && !mirrorKo) w.notes.push('le moteur met KO le Personnage défenseur, OPTCGSim non');
  if (snap.outcome !== 'ko' && mirrorKo) w.notes.push('OPTCGSim met KO le Personnage défenseur, le moteur non');
  if (snap.outcome === 'ko' && findField(w.game, snap.targetUid)) w.notes.push('Personnage défenseur sauvé par un effet du moteur ; OPTCGSim le met KO');
  if ((snap.outcome === 'hit' || snap.outcome === 'banished') !== mirrorHit) w.notes.push('le moteur et OPTCGSim ne voient pas le même résultat contre le Leader');
  if (mirrorHit) w.c = { ...w.c, step: snap.banish ? 'handBack' : 'trigger', triggers: 0 };
  else if (mirrorKo) w.c = { ...w.c, step: 'handBack' };
  else { compare(w); toIdle(w); }  // repoussée : chacun rend la main à l'attaquant de son côté, rien à envoyer
}

/**
 * Double attaque : la question du [Déclenchement] de la seconde vie arrive ; le jeu prend d'abord cette vie
 * (TriggerEnd_DoubleAttack). La carte de la première vie, si son [Déclenchement] a été activé, est traduite à la fin.
 */
function secondLifeBeforeQuestion(w: Work) {
  const c = w.c, snap = c.snap;
  if (c.step !== 'trigger' || !snap || !twoLives(snap) || c.secondSent) return;
  const questionLife = snap.asks[0] && (c.triggers ?? 0) === 0 ? 0 : 1;
  if (questionLife !== 1) return;
  // l'état visible est celui du moment de la question : le premier [Déclenchement] y est résolu ; ses effets partent
  // avant la seconde vie (TriggerEffect puis TriggerEnd_DoubleAttack)
  triggerEffects(w, [snap.lifeUids[0]]);
  lot(w, ['PlayerDrawLife', { iCount: 1 }], ['MoveToSecondLifeTrigger']);
  c.secondSent = true;
}

/**
 * [Déclenchement] activé par joy-boy (TriggerEffect, puis l'action de la carte) : ligne « Log.UseTrigger », puis tout ce
 * que l'effet a changé, traduit par outbound depuis l'état d'avant les dégâts : bonus de puissance (BuffCardPower…),
 * pioches, KO…, et la carte elle-même (main → Défausse, ou jouée). Les cartes de Vie restées en main n'y figurent pas
 * (OPTCGSim les a déjà prises au ResolveAttack). Correction O2.3b : avant, seule la carte partait en Défausse, sans
 * son effet (essai réel du 18 nov., Guard Point ST01-014 : le +1000 manquait).
 */
function triggerEffects(w: Work, which?: number[]) {
  const snap = w.c.snap!;
  const P = w.game.players[w.joyboy];
  const seen = (u: number) => [...P.trash, ...P.chars, ...(P.stage ? [P.stage] : []), ...P.deck].some((x) => x.uid === u);
  const used = (which ?? snap.lifeUids).filter((u) => !(w.c.triggered ?? []).includes(u) && seen(u));
  if (!used.length) return;
  w.c.triggered = [...(w.c.triggered ?? []), ...used];
  const nums = used.map((u) => [...P.trash, ...P.chars, ...(P.stage ? [P.stage] : []), ...P.deck].find((x) => x.uid === u)?.num ?? '');
  w.send.push(nums.map((n) => rpc(w, 'AddLogLine', { s: 'Log.UseTrigger', bPlayer: true, s1: cardName(n), s2: '', i1: -999, i2: -999 })));
  const out = translateOutbound(w.mirror, w.game, {
    seat: w.joyboy, before: w.base ?? w.game, choice: `trigger:${used[0]}`, object: w.object, mirror: mirrorOptions(w.c, w.game),
  });
  w.notes.push(...out.problems.map((p) => `déclenchement : ${p}`));
  if (out.rpcs.length) w.send.push(out.rpcs);
  w.mirror = out.mirror;
  w.handled.uids.push(...used);
}

// ---------------------------------------------------------------------------------------------------- joy-boy attaque

function startAttack(w: Work, choice: string) {
  const [, a, t] = choice.split(':');
  const attacker = Number(a), target = Number(t);
  const att = findField(w.game, attacker);
  if (!att) { answer(w, choice); return; }
  const attIdx = fieldIndex(w, w.joyboy, attacker);
  const defIdx = fieldIndex(w, w.foreign, target);
  const unblockable = hasKeyword(w.game, w.joyboy, att.card, 'Unblockable');
  const onAttack = Boolean(def(att.card.num).whenAttacking) && !isNegated(w.game, attacker);
  lot(w, ['TapCard', { iCardIndex: attIdx }]);
  answer(w, choice);
  w.handled.uids.push(attacker);
  // [Imblocable] : bornes impossibles pour un bloqueur (GameplayLogicScript.StartAttack)
  const limits = unblockable ? { iBlockerMustBeSmaller: -2000000, iBlockerMustBeLarger: 2000000, iBlockerMustCostMore: -1000000 }
    : { iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1 };
  w.send.push([rpc(w, 'SetupAttack', { iAttackerIdx: attIdx, iDefenderIdx: defIdx, ...limits }), ...(onAttack ? [rpc(w, 'MoveToBlocker')] : [])]);
  w.c = { phase: 'attack', step: 'onAttack', attacker, target, counter: 0 };
  followAttack(w);
}

/** Après les effets [En attaquant] de joy-boy : au tour du défenseur OPTCGSim. */
function followAttack(w: Work) {
  if (w.c.phase !== 'attack' || w.c.step !== 'onAttack') return;
  if (forJoyboy(w)) return;  // une question de ses effets [En attaquant]
  w.effectsBefore = w.send.length;
  if (!inBattle(w.game)) {
    lot(w, ['AllOnKOResolved'], ['ResolveNoAttackFromAttackerSide']);
    toIdle(w);
    return;
  }
  lot(w, ['SelectBlocker']);
  w.c.step = 'block';
}

/** SetBlocker d'OPTCGSim : le bloqueur, choisi dans le moteur s'il l'y propose, posé tel quel sinon (4405). */
function foreignBlocker(w: Work, r: Rpc) {
  const uid = engineUid(w, w.foreign, num(r, 'iBlockerIdx', -1));
  if (uid === undefined || !inBattle(w.game)) return;
  const d = w.game.decision;
  if (d && d.player === w.foreign && d.kind === 'blocker' && d.options.some((o) => o.id === `block:${uid}`)) { answer(w, `block:${uid}`); return; }
  const s = structuredClone(w.game);
  const f = findField(s, uid);
  if (!f) return;
  f.card.rested = true;
  s.battle!.target = uid;
  s.battle!.blocked = true;
  if (s.battle!.step === 'block') s.battle!.step = 'counter';
  if (s.decision && !s.decision.inEffect) s.decision = null;
  log(s, w.foreign, `bloque avec ${def(f.card.num).name}`);
  w.notes.push(`bloqueur ${def(f.card.num).name} posé par OPTCGSim hors des choix du moteur`);
  w.game = advanceShared(s, w.joyboy);
}

/** Contre d'OPTCGSim : bonus de combat à la cible dans le moteur (le miroir le compte à part, voir mirrorOptions). */
function foreignCounter(w: Work, amount: number) {
  if (!amount || !inBattle(w.game)) return;
  const s = structuredClone(w.game);
  s.mods.push({ uid: s.battle!.target, stat: 'power', amount, until: 'battle', source: 'OPTCGSim (Contre)' });
  log(s, w.foreign, `contre : ${amount > 0 ? '+' : '−'}${Math.abs(amount)} à ${def(findField(s, s.battle!.target)!.card.num).name}`);
  if (s.decision && !s.decision.inEffect && !isForced(s.decision)) s.decision = null;
  w.game = advanceShared(s, w.joyboy);
  w.c.counter = (w.c.counter ?? 0) + amount;
}

/** ResolveAttack d'OPTCGSim (joy-boy attaque) : le moteur résout, ses dégâts et KO font foi. */
function foreignResolve(w: Work) {
  settleForeign(w, { block: true, counter: true });
  if (!held(w.game)) {
    if (inBattle(w.game)) w.notes.push('ResolveAttack reçu mais le combat du moteur n’est pas aux dégâts');
    else w.notes.push('ResolveAttack reçu sans combat dans le moteur');
    toIdle(w);
    return;
  }
  release(w);
  settleForeign(w, { trigger: true });
  const snap = w.c.snap!;
  compare(w, twoLives(snap) ? 1 : 0);
  if (snap.outcome === 'repelled' || w.game.winner !== null) { toIdle(w); return; }
  w.c = { ...w.c, step: 'handBack', secondLife: twoLives(snap) };
}

// ---------------------------------------------------------------------------------------------------- entrées

/**
 * Une RPC reçue (ClientRpc), déjà appliquée au miroir (`ctx.mirror` est le miroir après elle, avec mirrorOptions),
 * avec les mutations que le miroir en a tirées. Rend les mutations à appliquer encore au moteur.
 */
export function handleCombatRpc(c: CombatState, game: GameState, r: Rpc, sender: Seat, externals: External[], ctx: CombatContext): CombatResult {
  const w = start(c, game, ctx, externals);
  const n = baseName(r.name);
  if (sender === w.joyboy) {
    // écho d'une action de joy-boy : le moteur l'a déjà ; ResolveAttack : comparer ce que le miroir en a déduit
    if (COMBAT_RPCS.has(n)) w.externals = [];
    return done(w);
  }
  const attack = w.c.phase === 'attack';
  switch (n) {
    case 'SetupAttack':
      if (w.c.phase !== 'idle') w.notes.push(`SetupAttack pendant un combat (${w.c.phase})`);
      openDefense(w, r);
      break;
    case 'SelectBlocker': case 'SelectBlockerNoProcs': case 'EnterBlockPhase':
      if (w.c.phase === 'defense' && w.c.step === 'onAttack') { startDefense(w); followDefense(w); }
      break;
    case 'SetNewDefender': {
      const uid = engineUid(w, w.c.phase === 'defense' ? w.joyboy : w.foreign, num(r, 'iDefenderIdx', -1));
      if (uid !== undefined && inBattle(w.game)) { const s = structuredClone(w.game); s.battle!.target = uid; w.game = s; w.c.target = uid; }
      break;
    }
    case 'SetBlocker':
      if (attack) { w.externals = []; foreignBlocker(w, r); }
      break;
    case 'NoBlocker':
      if (attack) settleForeign(w, { block: true });
      break;
    case 'AddCounterAmount':
      if (attack) foreignCounter(w, num(r, 'iCounter'));
      break;
    case 'SetCounterAmount':
      if (attack) foreignCounter(w, num(r, 'iCounter') - (w.c.counter ?? 0));
      break;
    case 'ResolveAttack':
      w.externals = [];
      if (attack && w.c.step === 'block') foreignResolve(w);
      else w.notes.push('ResolveAttack inattendu');
      break;
    case 'ResolveNoAttack': case 'ResolveNoAttackFromAttackerSide':
      if (inBattle(w.game)) {
        const s = structuredClone(w.game);
        s.battle!.step = 'end';
        if (s.decision && !s.decision.inEffect) s.decision = null;
        w.game = advanceShared(s, w.joyboy);
      }
      toIdle(w);
      break;
    case 'NoMorePendingActions':
      if (attack && w.c.step === 'handBack') toIdle(w);
      break;
    case 'PlayerDrawLife':
      // double attaque : la seconde vie du défenseur OPTCGSim, déjà prise par le moteur
      if (attack && w.c.step === 'handBack' && w.c.secondLife && num(r, 'iCount', 1) === 1) { w.externals = []; w.c.secondLife = false; }
      break;
    case 'EndTurn': case 'AnotherTurn': case 'Concede':
      toIdle(w);
      break;
    default:
      break;
  }
  return done(w);
}

/**
 * Réponse du joueur joy-boy pendant un combat, ou annonce d'une attaque (`attack:<uid>:<cible>`) : la décision passe au
 * moteur (answerExternal) et le combat envoie ce que le jeu de joy-boy enverrait.
 */
export function combatAnswer(c: CombatState, game: GameState, choice: string, ctx: CombatContext): CombatResult {
  const w = start(c, game, ctx);
  const d = game.decision;
  if (!d) throw new Error('aucune décision attendue');
  if (d.kind === 'main' && choice.startsWith('attack:')) { startAttack(w, choice); return done(w); }
  if (w.c.phase === 'defense') {
    const before = w.game;
    const target = w.game.battle?.target;
    if (d.kind === 'blocker') {
      if (choice.startsWith('block:')) {
        const uid = Number(choice.split(':')[1]);
        lot(w, ['SetBlocker', { iBlockerIdx: fieldIndex(w, w.joyboy, uid) }]);
        w.handled.uids.push(uid);
      } else lot(w, ['NoBlocker']);
      w.c.blockSent = true;
      answer(w, choice);
    } else if (d.kind === 'counter' && choice.startsWith('counter:')) {
      const uid = Number(choice.split(':')[1]);
      const card = w.game.players[w.joyboy].hand.find((x) => x.uid === uid)!;
      const idx = handIndex(w, w.joyboy, uid, card.num);
      answer(w, choice);
      const mods = target !== undefined ? newBattleMods(before, w.game, target) : [];
      const amount = mods.reduce((t, m) => t + m.amount, 0);
      lot(w, ['MoveHandCardToDiscard', { iCardIdx: idx }], ['AddCounterAmount', { iCounter: amount }]);
      w.handled.uids.push(uid);
      w.handled.mods.push(...mods.map((m) => ({ uid: m.uid, amount: m.amount })));
    } else {
      if (d.inEffect && d.tag === 'trigger') w.c.triggers = (w.c.triggers ?? 0) + 1;
      // effets d'un [Déclenchement] : traduits depuis l'état d'avant les dégâts (instantané de l'effet en cours)
      // (après un premier [Déclenchement] déjà traduit : depuis l'état visible à la question, qui le contient déjà)
      if (w.c.step === 'trigger' && d.inEffect) w.base = w.c.triggered?.length ? before : effectStart(before);
      answer(w, choice);
      // Évènement [Contre] (et ses questions) : son bonus au défenseur part en AddCounterAmount
      if (w.c.step === 'block' && target !== undefined && !w.game.decision?.inEffect) {
        const base = d.inEffect ? effectStart(before) : before;
        for (const m of newBattleMods(base, w.game, target)) {
          lot(w, ['AddCounterAmount', { iCounter: m.amount }]);
          w.handled.mods.push({ uid: m.uid, amount: m.amount });
        }
      }
    }
    followDefense(w);
    return done(w);
  }
  answer(w, choice);
  if (w.c.phase === 'attack') followAttack(w);
  return done(w);
}

/** État d'avant l'effet en cours (les questions d'un effet se rejouent depuis cet instantané). */
function effectStart(s: GameState): GameState {
  const snap = s.pending[0]?.snapshot;
  return snap ? (JSON.parse(snap) as GameState) : s;
}
