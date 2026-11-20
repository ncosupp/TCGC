// Tâche O5.3 (audit O5.0, § 3.3 à 3.5) : les attentes du combat. Attaque reçue pendant une question d'effet de joy-boy
// (CD2, retenue puis ouverte), combat inconnu du moteur joué d'après le miroir, réponses sûres de chaque étape
// (combatDefault, pour l'échelle anti-impasse), remise de la main après une réaction pendant un combat (combatHandBack,
// dont le [Déclenchement] en cours de l'hôte) et files « joueur courant » (R9). Mêmes tables que combat.test.ts
// (moteur, miroir, écho de l'hôte), helpers recopiés pour ne pas toucher ce fichier.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invariantErrors } from '../../engine/invariants.ts';
import { power } from '../../engine/rules.ts';
import type { Card, FieldCard, GameState, PlayerId } from '../../engine/types.ts';
import {
  combatAnswer, combatDefault, combatHandBack, createCombat, currentQueueUid, handleCombatRpc, mirrorOptions, routesTo,
  safeChoice, waiting, type CombatResult, type CombatState,
} from '../../online/optcgsim/combat.ts';
import { applyExternal, externalIndexOf } from '../../online/optcgsim/external.ts';
import { applyRpc, baseName, createMirror, type Mirror, type MirrorCardX } from '../../online/optcgsim/mirror.ts';
import type { External, Rpc, Seat, Zone } from '../../online/optcgsim/types.ts';
import { scenario } from '../helpers.ts';

const OPTCGSIM = 0;
const JOYBOY = 1;
const OBJET: Record<Seat, number> = { 0: 1, 1: 2 };  // objets réseau des fixtures : 1 = hôte, 2 = joy-boy

// ---------------------------------------------------------------------------------------------------- table

/** Cartes du deck renommées (la composition notée dans la partie suit : invariants). */
function prendre(s: GameState, p: PlayerId, nums: string[]): Card[] {
  return nums.map((num) => {
    const c = s.players[p].deck.pop()!;
    c.num = num;
    return c;
  });
}
const champ = (c: Card, extra: Partial<FieldCard> = {}): FieldCard => ({ uid: c.uid, num: c.num, rested: false, don: 0, playedTurn: 1, usedOpt: [], ...extra });

function recomposer(s: GameState) {
  for (const P of s.players) {
    const cards: Record<string, number> = {};
    for (const c of [...P.deck, ...P.hand, ...P.trash, ...P.life, ...P.chars, ...(P.stage ? [P.stage] : [])]) cards[c.num] = (cards[c.num] ?? 0) + 1;
    P.list = { leader: P.leader.num, cards };
  }
}

interface Mise {
  leaders?: [string, string];
  hand?: [string[], string[]];
  life?: [string[], string[]];  // dessus d'abord
  chars?: [{ num: string; rested?: boolean; don?: number }[], { num: string; rested?: boolean; don?: number }[]];
  leaderDon?: [number, number];
  active?: PlayerId;
}

/** Partie au tour 5, phase principale de `active` (OPTCGSim par défaut), décrite carte par carte. */
function partie(m: Mise = {}): GameState {
  return scenario(['ST-01', 'ST-01'], (s) => {
    for (const p of [0, 1] as PlayerId[]) {
      const P = s.players[p];
      P.deck.push(...P.hand, ...P.life, ...P.chars);
      P.hand = []; P.life = []; P.chars = [];
      if (m.leaders) P.leader.num = m.leaders[p];
      P.hand = prendre(s, p, m.hand?.[p] ?? []);
      P.life = prendre(s, p, m.life?.[p] ?? ['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077']);
      P.chars = (m.chars?.[p] ?? []).map((x) => champ(prendre(s, p, [x.num])[0], { rested: x.rested ?? false, don: x.don ?? 0 }));
      P.leader.don = m.leaderDon?.[p] ?? 0;
      P.leader.rested = false;
      const attached = P.leader.don + P.chars.reduce((t, c) => t + c.don, 0);
      P.donRested = 2; P.donActive = Math.min(4, 8 - attached); P.donDeck = 10 - P.donRested - P.donActive - attached;
    }
    recomposer(s);
  }, m.active ?? OPTCGSIM);
}

/** Miroir de la même table, chaque carte avec son uid (ordre d'OPTCGSim : dessus d'une pile = dernier élément). */
function miroirDe(s: GameState): Mirror {
  const m = createMirror();
  let iid = 1000;
  const carte = (c: Card, extra: Partial<MirrorCardX> = {}): MirrorCardX => ({ code: c.num, uid: c.uid, iid: iid++, ...extra });
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p], M = m.players[p];
    M.name = P.name;
    M.leader = carte(P.leader, { faceUp: true, ...(P.leader.don ? { attachedDon: P.leader.don } : {}), ...(P.leader.rested ? { rested: true } : {}) });
    M.zones.leader = [M.leader];
    M.zones.deck = [...P.deck].reverse().map((c) => carte(c));
    M.zones.life = [...P.life].reverse().map((c) => carte(c));
    M.zones.hand = P.hand.map((c) => carte(c));
    M.zones.trash = P.trash.map((c) => carte(c));
    M.zones.deploy = P.chars.map((c) => carte(c, { ...(c.rested ? { rested: true } : {}), ...(c.don ? { attachedDon: c.don } : {}) }));
    M.zones.donCost = [
      ...Array.from({ length: P.donRested }, () => ({ code: 'DON', iid: iid++, rested: true })),
      ...Array.from({ length: P.donActive }, () => ({ code: 'DON', iid: iid++ })),
    ];
    M.zones.donDeck = Array.from({ length: P.donDeck }, () => ({ code: 'DON', iid: iid++ }));
  }
  m.turnPlayer = s.active as Seat;
  m.actingPlayer = s.active as Seat;
  m.turn = s.turn;
  m.nextIid = iid;
  return m;
}

interface Table { game: GameState; mirror: Mirror; combat: CombatState; lots: string[][]; envoyes: Rpc[][]; notes: string[] }

function table(m: Mise = {}): Table {
  const game = partie(m);
  return { game, mirror: miroirDe(game), combat: createCombat(), lots: [], envoyes: [], notes: [] };
}

/** Mutation du miroir (positions OPTCGSim) traduite pour le moteur (rôle de inbound, tâche O2.2), d'après les uid. */
function versMoteur(e: External, avant: Mirror, s: GameState): External {
  const pos = (player: Seat, zone: Zone, index: number) => {
    if (zone === 'leader' || index === -1) return -1;
    if (zone === 'donCost' || zone === 'donDeck') return index;
    const uid = avant.players[player].zones[zone][index]?.uid;
    // sans uid : même ordre que le moteur, sauf les piles (deck, Vie) dont le dessus est en fin de liste
    if (uid === undefined) return zone === 'deck' || zone === 'life' ? avant.players[player].zones[zone].length - 1 - index : index;
    const i = externalIndexOf(s, player, zone, uid);
    assert.ok(i !== null, `carte ${index} de ${zone} introuvable dans le moteur`);
    return i;
  };
  switch (e.kind) {
    case 'move': {
      const top = e.at !== undefined && e.at === avant.players[e.player].zones[e.to].length - (e.from === e.to ? 1 : 0);
      const at = e.to === 'deck' || e.to === 'life' ? (top ? 0 : undefined) : undefined;
      const { at: _ignore, ...rest } = e;
      return { ...rest, index: pos(e.player, e.from, e.index), ...(at !== undefined ? { at } : {}) };
    }
    case 'rest': case 'activate':
      if (e.zone === 'donCost') return { ...e, index: e.kind === 'rest' ? 0 : s.players[e.player].donActive };
      return { ...e, index: e.zone === 'leader' ? 0 : pos(e.player, e.zone, e.index) };
    case 'attachDon': case 'detachDon': case 'power': case 'cost':
      return { ...e, target: pos(e.player, 'deploy', e.target) };
    default:
      return e;
  }
}

function absorber(t: Table, r: CombatResult, avant: Mirror) {
  t.combat = r.combat;
  t.game = r.game;
  t.notes.push(...r.notes);
  for (const e of r.externals) t.game = applyExternal(t.game, versMoteur(e, avant, t.game), { joyboy: JOYBOY });
  for (const l of r.send) {
    t.lots.push(l.map((x) => baseName(x.name)));
    t.envoyes.push(l);
    for (const x of l) echo(t, x);
  }
}

/** L'hôte renvoie l'action de joy-boy à tous : la ClientRpc s'applique au miroir, jamais au moteur. */
function echo(t: Table, x: Rpc) {
  assert.match(x.name, /ServerRpc$/);
  assert.equal(x.object, OBJET[JOYBOY]);
  const c: Rpc = { ...x, name: `${baseName(x.name)}ClientRpc` };
  const r = applyRpc(t.mirror, c, JOYBOY, mirrorOptions(t.combat, t.game));
  t.mirror = r.state;
  const res = handleCombatRpc(t.combat, t.game, c, JOYBOY, r.externals, { mirror: t.mirror, object: OBJET[JOYBOY] });
  assert.deepEqual(res.send, [], 'un écho ne fait rien envoyer');
  t.combat = res.combat;
  t.notes.push(...res.notes);
}

/** Une RPC du joueur OPTCGSim : miroir, combat, puis mutations restantes au moteur. */
function recu(t: Table, name: string, values: Record<string, unknown> = {}) {
  const c: Rpc = { name: `${name}ClientRpc`, object: OBJET[OPTCGSIM], behaviour: 0, values };
  const avant = t.mirror;
  const r = applyRpc(t.mirror, c, OPTCGSIM, mirrorOptions(t.combat, t.game));
  t.mirror = r.state;
  absorber(t, handleCombatRpc(t.combat, t.game, c, OPTCGSIM, r.externals, { mirror: t.mirror, object: OBJET[JOYBOY] }), avant);
}

/** ResolveAttack d'OPTCGSim puis son verdict (Log.CombatResult, i1/i2) : par défaut, les puissances du moteur. */
function resout(t: Table, verdict?: [number, number], issue?: string) {
  const b = t.game.battle!;
  const v = verdict ?? [power(t.game, b.attacker), power(t.game, b.target)];
  recu(t, 'ResolveAttack');
  assert.equal(t.combat.step, 'verdict', 'le moteur attend le verdict du jeu');
  assert.equal(t.game.battle?.step, 'damage');
  recu(t, 'TranslateLogLine', { s: 'Log.CombatResult', bPlayer: false, s1: '', s2: '', i1: v[0], i2: v[1] });
  const ok = v[0] >= v[1];
  recu(t, 'TranslateLogLine', { s: issue ?? (ok ? 'Log.LeaderHit' : 'Log.AttackFail'), bPlayer: false, s1: '', s2: '', i1: -999, i2: -999 });
}

function repond(t: Table, choix: string | RegExp) {
  const d = t.game.decision;
  assert.ok(d, 'aucune décision');
  const id = typeof choix === 'string' ? choix : d.options.find((o) => choix.test(o.id) || choix.test(o.label))?.id;
  assert.ok(id && d.options.some((o) => o.id === id), `choix ${String(choix)} absent : ${d.options.map((o) => o.id).join(', ')}`);
  assert.ok(routesTo(t.combat, id));
  absorber(t, combatAnswer(t.combat, t.game, id, { mirror: t.mirror, object: OBJET[JOYBOY] }), t.mirror);
}

/** L'attaque d'OPTCGSim, comme dans les fixtures : TapCard, SetupAttack, SelectBlocker. */
function attaqueOptcgsim(t: Table, attaquant: number, cible: number) {
  recu(t, 'TapCard', { iCardIndex: attaquant, clientId: 0 });
  recu(t, 'SetupAttack', { iAttackerIdx: attaquant, iDefenderIdx: cible, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1, clientId: 0 });
  assert.equal(waiting(t.combat, t.game), true, 'joy-boy attend la fin des effets [En attaquant]');
  recu(t, 'SelectBlocker', { bDontQueue: false });
}

const RENDRE = ['AllOnKOResolved', 'SwitchTurns', 'ResetActionPhase', 'NoMorePendingActions'];
const RESOUDRE = ['AllOnKOResolved', 'ResolveAttack'];

/** Le miroir et le moteur voient la même table ; `notes` : écarts attendus (sous-chaînes), dans l'ordre. */
function memeTable(t: Table, notes: string[] = []) {
  assert.equal(t.notes.length, notes.length, `écarts notés : ${t.notes.join(' | ')}`);
  notes.forEach((n, i) => assert.ok(t.notes[i].includes(n), `écart ${i} : ${t.notes[i]}`));
  assert.deepEqual(t.mirror.errors, [], 'miroir sans écart');
  if (!t.game.decision?.inEffect) assert.deepEqual(invariantErrors(t.game), []);
  for (const p of [0, 1] as Seat[]) {
    const P = t.game.players[p], M = t.mirror.players[p].zones;
    assert.equal(M.life.length, P.life.length, `vies du joueur ${p}`);
    assert.equal(M.hand.length, P.hand.length, `main du joueur ${p}`);
    assert.deepEqual(M.deploy.map((c) => c.code), P.chars.map((c) => c.num), `terrain du joueur ${p}`);
    assert.deepEqual(M.deploy.map((c) => c.rested === true), P.chars.map((c) => c.rested), `Personnages épuisés du joueur ${p}`);
    assert.deepEqual([...M.trash.map((c) => c.code)].sort(), [...P.trash.map((c) => c.num)].sort(), `Défausse du joueur ${p}`);
  }
}

const VIES = ['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'];
const GERMA = ['OP06-078', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'];  // GERMA 66 : [Déclenchement] (pioche)
const ctx = (t: Table) => ({ mirror: t.mirror, object: OBJET[JOYBOY] });

/** Repli sûr de l'échelle (combatDefault), absorbé comme une réponse du joueur. */
function repli(t: Table): CombatResult | null {
  const r = combatDefault(t.combat, t.game, ctx(t));
  if (r) absorber(t, r, t.mirror);
  return r;
}

// ---------------------------------------------------------------------------------------------------- CD2 : attaque retenue

test('CD2 : attaque reçue pendant la question du [Déclenchement] : retenue, puis jouée après la réponse (pas de SwitchTurns)', () => {
  const t = table({ chars: [[{ num: 'OP04-077' }], []], life: [VIES, GERMA] });
  attaqueOptcgsim(t, -1, -1);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE]);
  assert.equal(t.game.decision?.tag, 'trigger');
  // l'hôte n'attend pas la fin de la phase de déclenchement : il attaque avec Ideo (TapCard attend dans le backlog de
  // la session pendant l'effet : ici, posé sur le miroir seul ; le combat épuise l'attaquant dans le moteur)
  t.mirror = applyRpc(t.mirror, { name: 'TapCardClientRpc', object: OBJET[OPTCGSIM], behaviour: 0, values: { iCardIndex: 0, clientId: 0 } }, OPTCGSIM).state;
  recu(t, 'SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1, clientId: 0 });
  recu(t, 'SelectBlocker', { bDontQueue: false });
  assert.equal(t.lots.length, 2, 'rien envoyé tant que la question est ouverte');
  assert.equal(t.combat.step, 'trigger', 'le combat précédent continue');
  assert.deepEqual(t.combat.queued?.select, true, 'attaque retenue, SelectBlocker noté');
  assert.equal(waiting(t.combat, t.game), false, 'la question reste montrée au joueur');
  assert.equal(t.game.decision?.tag, 'trigger');
  repond(t, 'hand');
  // fin de la phase de déclenchement sans SwitchTurns (l'hôte a déjà repris la main), puis la nouvelle défense :
  // Ideo 2000 contre Leader 5000, repoussée
  assert.deepEqual(t.lots.slice(2), [['AllOnKOResolved'], ['NoBlocker'], RESOUDRE]);
  assert.equal(t.combat.phase, 'idle');
  assert.equal(t.combat.queued, undefined);
  assert.equal(t.game.players[JOYBOY].life.length, 4);
  memeTable(t, ['SetupAttack pendant un combat', 'attaque retenue']);
});

test('CD2 : attaque retenue hors combat (étape « deferred ») ; l’effet fini par l’échelle, l’attaque s’ouvre et se joue', () => {
  const t = table({ chars: [[{ num: 'EB04-023' }], []], life: [VIES, GERMA] });
  attaqueOptcgsim(t, -1, -1);
  assert.equal(t.game.decision?.tag, 'trigger');
  // la question vient d'ailleurs (par exemple une réaction) : le combat n'en sait rien
  t.combat = createCombat();
  t.lots = [];
  t.mirror = applyRpc(t.mirror, { name: 'TapCardClientRpc', object: OBJET[OPTCGSIM], behaviour: 0, values: { iCardIndex: 0, clientId: 0 } }, OPTCGSIM).state;
  recu(t, 'SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1, clientId: 0 });
  assert.equal(t.combat.phase, 'defense');
  assert.equal(t.combat.step, 'deferred');
  assert.equal(waiting(t.combat, t.game), false);
  assert.ok(routesTo(t.combat, 'hand'), 'la réponse du joueur passe par le combat');
  recu(t, 'SelectBlocker', { bDontQueue: false });
  assert.deepEqual(t.lots, []);
  // l'échelle répond à sa place : [Déclenchement] non activé ; l'effet est traduit par la session (effectsBefore), après
  // les mutations de l'hôte qu'elle tient en attente : l'attaque s'ouvre à l'appel suivant
  const r = repli(t);
  assert.equal(r?.effectsBefore, 0);
  assert.deepEqual(t.lots, []);
  assert.equal(t.game.decision?.inEffect ?? false, false);
  assert.equal(t.combat.step, 'deferred');
  // la RPC suivante de l'hôte (le chrono, chaque seconde) : la défense (double attaque de Chaka et Pell)
  recu(t, 'SetTimer', { fServerTime: 600, fClientTime: 599 });
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, ['PlayerDrawLife', 'MoveToSecondLifeTrigger'], RENDRE]);
  assert.equal(t.combat.phase, 'idle');
  assert.equal(t.game.players[JOYBOY].life.length, 2);
  memeTable(t, ['attaque retenue']);
});

// ---------------------------------------------------------------------------------------------------- d'après le miroir

test('attaquant inconnu du moteur : combat joué d’après le miroir (NoBlocker, ResolveAttack, seconde vie, main rendue)', () => {
  const t = table();
  // une carte du terrain OPTCGSim que le moteur n'a pas (Chaka et Pell 9000 [Double attaque])
  t.mirror.players[OPTCGSIM].zones.deploy.push({ code: 'EB04-023', iid: 9001 });
  recu(t, 'SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1 });
  assert.equal(t.combat.step, 'blind');
  assert.equal(waiting(t.combat, t.game), false);
  assert.deepEqual(t.lots, []);
  recu(t, 'SelectBlocker', { bDontQueue: false });
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, ['PlayerDrawLife', 'MoveToSecondLifeTrigger'], RENDRE]);
  assert.equal(t.mirror.players[JOYBOY].zones.life.length, 3, 'le miroir a pris les deux vies');
  assert.equal(t.combat.phase, 'idle');
  assert.ok(t.notes.some((n) => n.includes('d’après le miroir')), t.notes.join(' | '));
});

test('attaque inconnue, repoussée d’après le miroir : rien de plus que la résolution', () => {
  const t = table();
  t.mirror.players[OPTCGSIM].zones.deploy.push({ code: 'OP04-077', iid: 9001 });  // Ideo 2000
  recu(t, 'SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1 });
  recu(t, 'SelectBlocker', { bDontQueue: false });
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE]);
  assert.equal(t.mirror.players[JOYBOY].zones.life.length, 5);
  assert.equal(t.combat.phase, 'idle');
});

// ---------------------------------------------------------------------------------------------------- réponses sûres

test('safeChoice : ne pas bloquer, ne plus contrer, [Déclenchement] non activé, « non » sinon le premier choix', () => {
  const d = (kind: string, ids: string[], extra = {}) => ({ player: 1, kind, prompt: '', options: ids.map((id) => ({ id, label: id })), ...extra }) as never;
  assert.equal(safeChoice(d('blocker', ['block:4', 'noblock'])), 'noblock');
  assert.equal(safeChoice(d('counter', ['counter:7', 'pass'])), 'pass');
  assert.equal(safeChoice(d('effect', ['trigger', 'hand'], { inEffect: true, tag: 'trigger' })), 'hand');
  assert.equal(safeChoice(d('effect', ['card:3', 'none'], { inEffect: true })), 'none');
  assert.equal(safeChoice(d('effect', ['yes', 'no'], { inEffect: true })), 'no');
  assert.equal(safeChoice(d('effect', ['card:3', 'card:4'], { inEffect: true })), 'card:3');
});

test('combatDefault : bloqueur et contres proposés au joueur : NoBlocker, passer, la main rendue', () => {
  const t = table({ hand: [[], ['OP07-107']], chars: [[{ num: 'EB04-023' }], [{ num: 'OP04-077' }]] });
  attaqueOptcgsim(t, 0, -1);
  assert.equal(t.game.decision?.kind, 'blocker');
  repli(t);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, ['PlayerDrawLife', 'MoveToSecondLifeTrigger'], RENDRE]);
  assert.equal(t.combat.phase, 'idle');
  assert.equal(t.game.players[JOYBOY].hand.filter((c) => c.num === 'OP07-107').length, 1, 'aucun contre joué');
  memeTable(t);
  assert.equal(repli(t), null, 'plus de combat : rien à faire');
});

test('combatDefault : [Déclenchement] en attente : non activé, la main rendue', () => {
  const t = table({ life: [VIES, GERMA] });
  attaqueOptcgsim(t, -1, -1);
  assert.equal(t.game.decision?.tag, 'trigger');
  repli(t);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, RENDRE]);
  assert.equal(t.game.players[JOYBOY].hand.at(-1)?.num, 'OP06-078');
  memeTable(t);
});

test('combatDefault : joy-boy attaque, l’hôte décide (sa pendule) : rien ; effets [En attaquant] : réponse par défaut', () => {
  let t = table({ active: JOYBOY });
  repond(t, `attack:${t.game.players[JOYBOY].leader.uid}:${t.game.players[OPTCGSIM].leader.uid}`);
  assert.equal(t.combat.step, 'block');
  assert.equal(repli(t), null);
  // OP16-104 Catarina Devon : question de son [En attaquant]
  t = table({ active: JOYBOY, chars: [[{ num: 'OP04-077' }], [{ num: 'OP16-104' }]] });
  repond(t, `attack:${t.game.players[JOYBOY].chars[0].uid}:${t.game.players[OPTCGSIM].leader.uid}`);
  assert.equal(t.game.decision?.inEffect && t.game.decision.player, JOYBOY);
  const r = repli(t);
  assert.ok(r);
  assert.equal(t.combat.step, 'block');
  assert.deepEqual(t.lots.at(-1), ['SelectBlocker']);
  assert.notEqual(r.effectsBefore, undefined, 'les effets [En attaquant] restent à traduire par la session');
});

test('combatDefault : défense en attente de SelectBlocker (effets [En attaquant] de l’hôte) : rien à faire', () => {
  const t = table({ chars: [[{ num: 'EB04-023' }], []] });
  recu(t, 'TapCard', { iCardIndex: 0, clientId: 0 });
  recu(t, 'SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1 });
  assert.equal(t.combat.step, 'onAttack');
  assert.equal(repli(t), null);
});

// ---------------------------------------------------------------------------------------------------- remise de la main

test('combatHandBack : remise de la main après une réaction, selon l’étape du combat (GLS ResolveAction)', () => {
  const noms = (c: CombatState) => combatHandBack(c)?.rpcs.map(([n]) => n);
  assert.equal(combatHandBack(createCombat()), null, 'hors combat : handBackFor');
  // joy-boy défend
  assert.deepEqual(noms({ phase: 'defense', step: 'block' }), ['AllOnKOResolved']);
  assert.deepEqual(noms({ phase: 'defense', step: 'block', blockSent: true }), ['AllOnKOResolved', 'NoBlocker']);
  assert.deepEqual(noms({ phase: 'defense', step: 'onAttack' }), ['AllOnKOResolved']);
  const fin = combatHandBack({ phase: 'defense', step: 'trigger' })!;
  assert.deepEqual(fin.rpcs.map(([n]) => n), RENDRE);
  assert.equal(fin.combat.phase, 'idle', 'la phase de déclenchement est finie');
  assert.deepEqual(noms({ phase: 'defense', step: 'handBack', queued: { attacker: 1, target: 2 } }), ['AllOnKOResolved'], 'l’hôte attaque déjà');
  // joy-boy attaque
  assert.deepEqual(noms({ phase: 'attack', step: 'onAttack' }), ['AllOnKOResolved']);
  assert.deepEqual(noms({ phase: 'attack', step: 'block' }), ['AllOnKOResolved', 'SwitchTurns']);
  assert.deepEqual(noms({ phase: 'attack', step: 'block', blockDone: true }), ['AllOnKOResolved', 'SwitchTurns', 'NoBlocker'], 'le [Contre] de l’hôte : il retrouve « résoudre l’attaque »');
  const snap = { attacker: 6000, target: 5000, attackerUid: 1, targetUid: 2, attackerNum: 'X', defender: 0 as Seat, leader: true, double: false, banish: false, lifeUids: [3], asks: [true] };
  assert.deepEqual(noms({ phase: 'attack', step: 'handBack', snap: { ...snap, outcome: 'hit' } }), ['SwitchTurns', 'DoNoTrigger'], '[Déclenchement] de l’hôte en cours');
  assert.deepEqual(noms({ phase: 'attack', step: 'handBack', snap: { ...snap, leader: false, outcome: 'ko' } }), ['AllOnKOResolved', 'SwitchTurns']);
});

test('joy-boy attaque : SetBlocker / NoBlocker de l’hôte notés (blockDone), pour la remise de la main aux contres', () => {
  const t = table({ active: JOYBOY });
  repond(t, `attack:${t.game.players[JOYBOY].leader.uid}:${t.game.players[OPTCGSIM].leader.uid}`);
  assert.equal(t.combat.blockDone, undefined);
  recu(t, 'NoBlocker');
  assert.equal(t.combat.blockDone, true);
});

// ---------------------------------------------------------------------------------------------------- R9

test('R9 : file « joueur courant » pendant la défense de joy-boy : son Personnage est rendu pour la file de la session', () => {
  const t = table({ chars: [[{ num: 'EB04-023' }], [{ num: 'OP04-077' }, { num: 'OP04-077' }]] });
  attaqueOptcgsim(t, 0, -1);
  assert.equal(t.mirror.actingPlayer, JOYBOY, 'à joy-boy de défendre');
  const r: Rpc = { name: 'QueueCurrentPlayerKOQueueClientRpc', object: OBJET[OPTCGSIM], behaviour: 0, values: { iDeployIdx: 1 } };
  const res = handleCombatRpc(t.combat, t.game, r, OPTCGSIM, [], ctx(t));
  assert.deepEqual(res.queue, [t.game.players[JOYBOY].chars[1].uid]);
  assert.deepEqual(res.send, []);
  // quand l'hôte agit, « joueur courant » est l'hôte : ce sont ses Personnages, pas ceux de joy-boy
  const m = structuredClone(t.mirror);
  m.actingPlayer = OPTCGSIM;
  assert.equal(currentQueueUid(m, r), undefined);
  assert.equal(currentQueueUid(t.mirror, { ...r, name: 'QueueOpponentPlayerKOQueueClientRpc' }), undefined, 'les files « adversaire » restent à reaction.ts');
});

test('CD2 : attaquant retenu parti du moteur avant l’ouverture : combat joué d’après le miroir', () => {
  const t = table({ chars: [[{ num: 'EB04-023' }], []], life: [VIES, GERMA] });
  attaqueOptcgsim(t, -1, -1);
  t.combat = createCombat();
  t.lots = [];
  recu(t, 'SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1 });
  recu(t, 'SelectBlocker', { bDontQueue: false });
  assert.equal(t.combat.step, 'deferred');
  repli(t);
  // Chaka et Pell a quitté le moteur (effet en attente chez la session, par exemple) : le miroir l'a encore
  t.game = structuredClone(t.game);
  const P = t.game.players[OPTCGSIM];
  P.trash.push(P.chars.pop()!);
  recu(t, 'SetTimer', { fServerTime: 600, fClientTime: 599 });
  assert.ok(t.notes.some((n) => n.includes('partis du moteur')), t.notes.join(' | '));
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, ['PlayerDrawLife', 'MoveToSecondLifeTrigger'], RENDRE]);
  assert.equal(t.combat.phase, 'idle');
});
