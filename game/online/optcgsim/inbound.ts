// OPTCGSim -> joy-boy (tâche O2.2) : chaque RPC reçue de l'hôte passe par le miroir (mirror.ts), ses mutations sont
// traduites des positions d'OPTCGSim vers celles du moteur et appliquées (external.ts), puis on rend la vue du joueur
// joy-boy (view.ts), comme pour une partie en ligne.
//
// La table croisée (CrossTable) réunit le miroir et l'état du moteur. Le lien entre les deux est l'identifiant `uid` :
// chaque carte du miroir porte celui de la carte du moteur (posé quand les deux decks sont chargés, voir build). Les
// mutations rendues par le miroir désignent des positions du miroir, calculées pas à pas ; on les rejoue sur une ombre
// des zones (Shadow) pour savoir quelle carte (uid) chacune déplace, puis on cherche cette carte dans le moteur au moment
// de l'appliquer (externalIndexOf). Les positions des deux côtés peuvent donc différer (main réordonnée, moteur en
// avance) sans que la traduction se trompe de carte.
//
// Qui applique quoi. Chaque ClientRpc reçue s'applique une fois au miroir, y compris l'écho des actions de joy-boy
// (`sender` = joy-boy). Le moteur, lui, a souvent déjà fait ce que dit un écho (coups de joy-boy joués dans le moteur,
// combat résolu par le moteur) : toute mutation est donc un « rattrapage » qui n'est appliqué que si le moteur est en
// retard sur le miroir :
// - une carte n'est déplacée que si le moteur l'a encore dans la zone de départ (déjà arrivée : rien à faire) ;
// - DON!! (pioche, renvoi, inclinaison, DON!! données) : appliquées tant que les nombres du moteur diffèrent de ceux du
//   miroir après ce pas ; un mélange, s'il change l'ordre du deck du moteur ;
// - bonus de puissance et de coût : seulement ceux du joueur OPTCGSim (ceux de joy-boy viennent du moteur), et, quand le
//   miroir les réémet au changement de tour, seulement ceux que le joueur OPTCGSim a donnés (foreignMods) ;
// - changement de tour : toujours pour le joueur OPTCGSim, pour un écho seulement si le moteur n'y est pas déjà.
// Ainsi l'ouverture (mélange, main, mulligan, Vie), qui n'est pas jouée par le moteur dans une partie croisée, est
// reprise des RPC des deux joueurs, et les coups de joy-boy déjà faits par le moteur ne sont pas rejoués.
//
// Cartes inconnues de joy-boy (Décision 4 de l'étape O) : carte « opaque » (code, nom, coût et puissance si on les
// connaît, `describe`), enregistrée sous `optcgsim:<code>` ; la session les relève (unknownCards), prévient et concède.
import '../../engine/cards/index.ts';
import { CARDS, HIDDEN } from '../../engine/cards/registry.ts';
import { advanceShared, RULES_VERSION } from '../../engine/engine.ts';
import { donTotal, findField, log, power as enginePower, reveal } from '../../engine/rules.ts';
import type { Card, CardDef, Category, FieldCard, GameState, PlayerState } from '../../engine/types.ts';
import { viewFor } from '../../engine/view.ts';
import { applyExternal, externalIndexOf, type ExternalOptions } from './external.ts';
import {
  applyRpc, baseName, createMirror, DON, type Expiry, type Mirror, type MirrorCardX, type MirrorOptions, other,
} from './mirror.ts';
import type { External, Rpc, Seat, Zone } from './types.ts';

// ---------------------------------------------------------------------------------------------------- types

/** Ce qu'on sait d'une carte que joy-boy ne connaît pas (catalogue OPTCGSim, s'il existe). */
export interface OpaqueInfo { name?: string; cost?: number | null; power?: number | null; life?: number | null; category?: Category }
export interface UnknownCard { seat: Seat; code: string; count: number }

export interface InboundOptions {
  /** Ce qu'on sait d'une carte inconnue de joy-boy (nom, coût, puissance). */
  describe?: (code: string) => OpaqueInfo | undefined;
  /** Options du miroir (stats, puissance au combat) ; par défaut : catalogue joy-boy et puissance du moteur. */
  mirror?: MirrorOptions;
}

/** Mutation en attente, désignée par l'uid de la carte (positions du moteur calculées au moment de l'appliquer). */
/** `echo` : RPC envoyée par joy-boy (écho de ses actions, ou ResolveAttack quand il défend). */
type Op = { by: Seat; cause?: ExternalOptions['cause']; rpc: string; echo?: boolean } & (
  | { op: 'move'; player: Seat; uid: number; code: string; from: Zone; to: Zone; dist: number; rested?: boolean }
  | { op: 'donDraw'; player: Seat; rested: boolean; deckAfter: number }
  | { op: 'donReturn'; player: Seat; restedSrc: boolean; deckAfter: number }
  | { op: 'donRest'; player: Seat; rest: boolean; activeAfter: number }
  | { op: 'attach'; player: Seat; uid: number; rested: boolean; donAfter: number }
  | { op: 'detach'; player: Seat; uid: number; to: 'donCost' | 'donDeck'; rested: boolean; donAfter: number }
  | { op: 'rest'; player: Seat; uid: number; zone: Zone; rest: boolean }
  | { op: 'mod'; player: Seat; uid: number; kind: 'power' | 'cost'; delta: number; until: 'turn' | 'battle' | 'ownersEnd' }
  | { op: 'shuffle'; player: Seat; deck: number[] }
  | { op: 'turn'; to: Seat; echo: boolean }
  | { op: 'reveal'; uid: number }
);

/** Bonus donné par le joueur OPTCGSim et qui dure plus d'un tour (réémis par le miroir à chaque tour). */
interface ModMark { iid: number; kind: 'power' | 'cost'; delta: number; until: Expiry }

export interface CrossTable {
  mirror: Mirror;
  /** État du moteur, créé quand les deux decks sont chargés dans le miroir. */
  game: GameState | null;
  joyboy: Seat;
  seed: number;
  /** Mutations pas encore appliquées : le moteur attend une réponse au milieu d'un effet. */
  backlog: Op[];
  /** Carte inclinée par le joueur OPTCGSim, en attendant de savoir si c'est pour attaquer (SetupAttack). */
  held: { ops: Op[]; seat: Seat; index: number } | null;
  foreignMods: ModMark[];
  /** Dernier tour où le joueur actif a changé la table (sa première pioche d'un tour est celle de la phase de Pioche). */
  acted: number;
  unknown: UnknownCard[];
  /** Écarts : mutation impossible, moteur et miroir désynchronisés, RPC non traduite. */
  errors: string[];
}

export interface InboundResult {
  table: CrossTable;
  /** Mutations appliquées au moteur, en positions du moteur. */
  applied: External[];
  /** Écarts apparus pendant cet appel. */
  errors: string[];
  /** Vue du joueur joy-boy (null tant que le moteur n'est pas créé) et cartes opaques qu'elle montre. */
  view: GameState | null;
  opaque: (OpaqueInfo & { uid: number; code: string })[];
  over?: Mirror['over'];
}

// ---------------------------------------------------------------------------------------------------- cartes opaques

const OPAQUE = 'optcgsim:';
export const isOpaque = (num: string): boolean => num.startsWith(OPAQUE);
export const opaqueCode = (num: string): string => num.slice(OPAQUE.length);
/** joy-boy connaît-il cette carte ? */
export const knownCard = (code: string): boolean => Boolean(code) && code !== HIDDEN && !isOpaque(code) && Boolean(CARDS[code]);

function opaqueDef(num: string, code: string, info: OpaqueInfo | undefined, leader: boolean): CardDef {
  return {
    number: num, imageId: '', lang: 'fr', rarity: '', category: leader ? 'LEADER' : info?.category ?? 'CHARACTER',
    name: info?.name ?? `Carte inconnue (${code || '?'})`, names: [], cost: info?.cost ?? null,
    life: leader ? info?.life ?? 5 : null, power: info?.power ?? null, counter: null, colors: [], types: [], typeLabels: [],
    attributes: [], effect: '', trigger: null, effectEn: '', triggerEn: null, keywords: [], blocks: [],
  };
}

/** Numéro de carte du moteur pour un code OPTCGSim : le code lui-même, ou une carte opaque créée pour l'occasion. */
export function engineNum(code: string, describe?: InboundOptions['describe'], leader = false): string {
  if (knownCard(code)) return code;
  const num = `${OPAQUE}${code}${leader ? ':L' : ''}`;
  CARDS[num] ??= opaqueDef(num, code, describe?.(code), leader);
  return num;
}

// ---------------------------------------------------------------------------------------------------- table

/** Table croisée vide : le miroir attend la mise en place des deux joueurs. */
export function createTable(opts: { joyboy?: Seat; seed?: number; mirror?: Mirror } = {}): CrossTable {
  return {
    mirror: opts.mirror ?? createMirror(), game: null, joyboy: opts.joyboy ?? 1, seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
    backlog: [], held: null, foreignMods: [], acted: -1, unknown: [], errors: [],
  };
}

const deckLoaded = (m: Mirror, seat: Seat) => {
  const p = m.players[seat];
  return Boolean(p.leader.code) && p.zones.deck.length > 0 && p.zones.deck.every((c) => c.code);
};

/** Cartes des deux decks que joy-boy ne connaît pas (Décision 4 : la session les enregistre, prévient et concède). */
export const unknownCards = (t: CrossTable): UnknownCard[] => t.unknown;

/** Crée l'état du moteur depuis le miroir : deck dans l'ordre du miroir (dessus = fin de liste), uid posés des deux côtés. */
function build(t: CrossTable, opts: InboundOptions) {
  const m = t.mirror;
  let uid = 1;
  const unknown: UnknownCard[] = [];
  const player = (seat: Seat): PlayerState => {
    const mp = m.players[seat];
    const counts: Record<string, number> = {};
    const missing: Record<string, number> = {};
    if (!knownCard(mp.leader.code)) missing[mp.leader.code] = 1;
    const deck: Card[] = [...mp.zones.deck].reverse().map((c) => {
      const num = engineNum(c.code, opts.describe);
      if (!knownCard(c.code)) missing[c.code] = (missing[c.code] ?? 0) + 1;
      counts[num] = (counts[num] ?? 0) + 1;
      c.uid = uid++;
      return { uid: c.uid, num };
    });
    for (const [code, count] of Object.entries(missing)) unknown.push({ seat, code, count });
    const leaderNum = engineNum(mp.leader.code, opts.describe, true);
    mp.leader.uid = uid++;
    const leader: FieldCard = { uid: mp.leader.uid, num: leaderNum, rested: false, don: 0, playedTurn: 0, usedOpt: [] };
    return {
      name: mp.name || `Joueur ${seat + 1}`, deckId: seat === t.joyboy ? 'joyboy' : 'optcgsim', list: { leader: leaderNum, cards: counts },
      leader, deck, hand: [], trash: [], life: [], chars: [], stage: null, donDeck: donTotal(leaderNum), donActive: 0, donRested: 0,
      turns: 0, discardedTurn: 0,
    };
  };
  const players: [PlayerState, PlayerState] = [player(0), player(1)];
  const s: GameState = {
    rng: t.seed, nextUid: uid, turn: 0, active: 0, first: 0, players, mods: [], delayed: [], peek: [null, null], battle: null,
    flow: { stage: 'mulligan', player: other(t.joyboy) }, pending: [], decision: null, winner: null, winReason: null,
    log: [], history: [], rules: RULES_VERSION,
  };
  log(s, null, 'Partie croisée avec OPTCGSim : mise en place');
  t.unknown = unknown;
  t.game = advanceShared(s, t.joyboy);
}

// ---------------------------------------------------------------------------------------------------- ombre des zones

interface Entry { iid: number; uid?: number; code: string; rested: boolean; don: number }
type Shadow = [Record<Zone, Entry[]>, Record<Zone, Entry[]>];

function shadowOf(m: Mirror): Shadow {
  const entry = (c: MirrorCardX): Entry => ({ iid: c.iid, uid: c.uid, code: c.code, rested: c.rested === true, don: c.attachedDon ?? 0 });
  return m.players.map((p) => Object.fromEntries(Object.entries(p.zones).map(([z, cards]) => [z, cards.map(entry)]))) as Shadow;
}

const FIELD_ZONES: ReadonlySet<Zone> = new Set(['deploy', 'stage', 'leader']);

/** Le leader (-1) ou le Personnage n° idx de l'ombre. */
const holderOf = (sh: Shadow, seat: Seat, idx: number): Entry | undefined => (idx === -1 ? sh[seat].leader[0] : sh[seat].deploy[idx]);

// ---------------------------------------------------------------------------------------------------- traduction

class InboundError extends Error {}
const num = (rpc: Rpc, k: string, d = 0): number => (typeof rpc.values?.[k] === 'number' ? (rpc.values[k] as number) : d);

const LONG_LIVED: ReadonlySet<Expiry> = new Set(['oppEnd', 'start', 'field']);

/** Mutations du miroir (positions du miroir) → mutations en attente (uid). */
function translate(t: CrossTable, before: Mirror, after: Mirror, rpc: Rpc, sender: Seat, externals: External[]): Op[] {
  const sh = shadowOf(before);
  const name = baseName(rpc.name);
  const foreign = sender !== t.joyboy;
  const opening = !t.game || t.game.flow.stage === 'mulligan';
  const by: Seat = name === 'ResolveAttack' && before.battle ? before.battle.attacker.seat : sender;
  const drawPhase = name === 'DrawCard' && !opening && sender === before.turnPlayer && t.acted !== before.turn && num(rpc, 'iCount') === 1;
  const base = { by, rpc: name, ...(foreign ? {} : { echo: true }) };
  const ops: Op[] = [];
  const need = (e: Entry | undefined, what: string): Entry => {
    if (!e) throw new InboundError(`${name} : ${what} absente de l'ombre du miroir`);
    if (e.uid === undefined) throw new InboundError(`${name} : ${what} (${e.code || '?'}) sans lien avec le moteur`);
    return e;
  };
  let afterTurn = false;
  for (const ext of externals) {
    switch (ext.kind) {
      case 'move': {
        const z = sh[ext.player];
        if (ext.from === 'donDeck' && ext.to === 'donCost') {
          z.donDeck.pop();
          z.donCost.splice(ext.at ?? z.donCost.length, 0, { iid: -1, code: DON, rested: ext.rested === true, don: 0 });
          ops.push({ ...base, op: 'donDraw', player: ext.player, rested: ext.rested === true, deckAfter: z.donDeck.length });
          break;
        }
        if (ext.from === 'donCost' && ext.to === 'donDeck') {
          const [d] = z.donCost.splice(ext.index, 1);
          z.donDeck.push({ iid: -1, code: DON, rested: false, don: 0 });
          ops.push({ ...base, op: 'donReturn', player: ext.player, restedSrc: d?.rested === true, deckAfter: z.donDeck.length });
          break;
        }
        if (ext.from === 'donDeck' || ext.from === 'donCost' || ext.to === 'donDeck' || ext.to === 'donCost') {
          // ZoroDon (carte de la main devenue DON!!) : sans équivalent dans le moteur
          throw new InboundError(`${name} : déplacement ${ext.from} → ${ext.to} sans équivalent dans le moteur`);
        }
        const [e] = z[ext.from].splice(ext.index, 1);
        const card = need(e, `carte ${ext.index} (${ext.from})`);
        if (FIELD_ZONES.has(ext.from)) {
          for (let k = 0; k < card.don; k++) z.donCost.unshift({ iid: -1, code: DON, rested: true, don: 0 });
          card.don = 0;
        }
        card.rested = ext.rested === true;
        const at = ext.at ?? z[ext.to].length;
        z[ext.to].splice(at, 0, card);
        let cause: ExternalOptions['cause'];
        if (ext.from === 'deploy' && ext.to === 'trash') cause = name === 'ResolveAttack' ? 'battleKo' : /^DiscardFrom(Self)?Deploy$/.test(name) ? 'ko' : undefined;
        else if (ext.from === 'hand' && ext.to === 'trash' && name === 'MoveOpponentHandCardToDiscard') cause = 'discard';
        else if (ext.from === 'deck' && ext.to === 'hand' && !opening && !drawPhase) cause = 'effect';
        ops.push({
          ...base, ...(cause ? { cause } : {}), op: 'move', player: ext.player, uid: card.uid!, code: card.code, from: ext.from, to: ext.to,
          dist: z[ext.to].length - 1 - at, ...(ext.rested !== undefined ? { rested: ext.rested } : {}),
        });
        break;
      }
      case 'rest':
      case 'activate': {
        const z = sh[ext.player];
        const rest = ext.kind === 'rest';
        if (ext.zone === 'donCost') {
          const d = z.donCost[ext.index];
          if (d) d.rested = rest;
          ops.push({ ...base, op: 'donRest', player: ext.player, rest, activeAfter: z.donCost.filter((x) => !x.rested).length });
          break;
        }
        const e = need(z[ext.zone][ext.zone === 'leader' ? 0 : ext.index], `carte ${ext.index} (${ext.zone})`);
        e.rested = rest;
        ops.push({ ...base, op: 'rest', player: ext.player, uid: e.uid!, zone: ext.zone, rest });
        break;
      }
      case 'attachDon': {
        sh[ext.player].donCost.splice(ext.donIndex, 1);
        const h = need(holderOf(sh, ext.player, ext.target), `porteur ${ext.target}`);
        h.don++;
        ops.push({ ...base, op: 'attach', player: ext.player, uid: h.uid!, rested: ext.rested === true, donAfter: h.don });
        break;
      }
      case 'detachDon': {
        const h = need(holderOf(sh, ext.player, ext.target), `porteur ${ext.target}`);
        h.don = Math.max(0, h.don - 1);
        if (ext.to === 'donCost') sh[ext.player].donCost.unshift({ iid: -1, code: DON, rested: ext.rested ?? true, don: 0 });
        else sh[ext.player].donDeck.push({ iid: -1, code: DON, rested: false, don: 0 });
        ops.push({ ...base, op: 'detach', player: ext.player, uid: h.uid!, to: ext.to, rested: ext.rested ?? true, donAfter: h.don });
        break;
      }
      case 'power':
      case 'cost': {
        const h = need(holderOf(sh, ext.player, ext.target), `cible ${ext.target}`);
        // bonus réémis au changement de tour : seulement ceux que le joueur OPTCGSim a donnés
        const mine = afterTurn
          ? t.foreignMods.some((x) => x.iid === h.iid && x.kind === ext.kind && x.delta === ext.delta)
          : foreign;
        if (mine) ops.push({ ...base, op: 'mod', player: ext.player, uid: h.uid!, kind: ext.kind, delta: ext.delta, until: ext.until });
        break;
      }
      case 'shuffle': {
        const deck = sh[ext.player].deck;
        const permuted = ext.order.map((j) => deck[j]);
        deck.splice(0, deck.length, ...permuted);
        ops.push({ ...base, op: 'shuffle', player: ext.player, deck: [...permuted].reverse().map((e) => need(e, 'carte du deck').uid!) });
        break;
      }
      case 'turn': {
        afterTurn = true;
        const z = sh[ext.to];
        for (const c of [...z.leader, ...z.deploy]) {
          for (let k = 0; k < c.don; k++) z.donCost.unshift({ iid: -1, code: DON, rested: true, don: 0 });
          c.don = 0;
        }
        for (const c of [...z.leader, ...z.deploy, ...z.stage, ...z.donCost]) c.rested = false;
        ops.push({ ...base, op: 'turn', to: ext.to, echo: !foreign });
        break;
      }
    }
  }
  // cartes montrées par le joueur OPTCGSim (le miroir n'en fait rien : affichage seulement)
  if (foreign) {
    const z = sh[sender], zo = sh[other(sender)];
    const shown = name === 'RevealHandCard' ? z.hand[num(rpc, 'iHandIdx', -1)]
      : name === 'RevealDeckCard' ? z.deck[num(rpc, 'iDeckIdx', -1)]
        : name === 'RevealTopCard' ? z.deck[z.deck.length - 1]
          : name === 'RevealOppDeckCard' ? zo.deck[num(rpc, 'iDeckIdx', -1)] : undefined;
    if (shown?.uid !== undefined) ops.push({ ...base, op: 'reveal', uid: shown.uid });
  }
  if (name === 'ChangeCardDefinition') throw new InboundError(`${name} : une carte en main change de numéro, sans équivalent dans le moteur`);
  if (foreign && !afterTurn) markForeignMods(t, before, after);
  if (!opening && ops.length && sender === before.turnPlayer) t.acted = before.turn;
  return ops;
}

/** Retient les bonus durables que le joueur OPTCGSim vient de donner (comparaison avant / après, carte par carte). */
function markForeignMods(t: CrossTable, before: Mirror, after: Mirror) {
  const mods = (m: Mirror) => {
    const out = new Map<number, ModMark[]>();
    for (const p of m.players) {
      for (const c of [p.leader, ...p.zones.deploy, ...p.zones.stage]) {
        out.set(c.iid, (c.mods ?? []).filter((x) => LONG_LIVED.has(x.until)).map((x) => ({ iid: c.iid, kind: x.kind, delta: x.delta, until: x.until })));
      }
    }
    return out;
  };
  const was = mods(before);
  for (const [iid, now] of mods(after)) {
    const old = [...(was.get(iid) ?? [])];
    for (const x of now) {
      const k = old.findIndex((o) => o.kind === x.kind && o.delta === x.delta && o.until === x.until);
      if (k >= 0) old.splice(k, 1);
      else t.foreignMods.push(x);
    }
  }
}

/** Oublie les bonus marqués qui ne sont plus sur leur carte. */
function pruneForeignMods(t: CrossTable) {
  const live = new Map<number, ModMark[]>();
  for (const p of t.mirror.players) {
    for (const c of [p.leader, ...p.zones.deploy, ...p.zones.stage]) {
      live.set(c.iid, (c.mods ?? []).filter((x) => LONG_LIVED.has(x.until)).map((x) => ({ iid: c.iid, kind: x.kind, delta: x.delta, until: x.until })));
    }
  }
  t.foreignMods = t.foreignMods.filter((x) => {
    const l = live.get(x.iid);
    const k = l?.findIndex((o) => o.kind === x.kind && o.delta === x.delta && o.until === x.until) ?? -1;
    if (k < 0) return false;
    l!.splice(k, 1);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------- application

function zoneLength(s: GameState, p: Seat, zone: Zone): number {
  const P = s.players[p];
  switch (zone) {
    case 'deck': return P.deck.length;
    case 'hand': return P.hand.length;
    case 'life': return P.life.length;
    case 'trash': return P.trash.length;
    case 'deploy': return P.chars.length;
    case 'stage': return P.stage ? 1 : 0;
    default: return 1;
  }
}

/** Index de mutation (-1 = Leader) d'un porteur de DON!! ou d'une cible de bonus, par uid. */
function holderIndex(s: GameState, p: Seat, uid: number): number {
  if (s.players[p].leader.uid === uid) return -1;
  const i = s.players[p].chars.findIndex((c) => c.uid === uid);
  if (i < 0) throw new InboundError(`carte ${uid} absente du terrain du joueur ${p} dans le moteur`);
  return i;
}
const holderCard = (s: GameState, p: Seat, uid: number): FieldCard => {
  const i = holderIndex(s, p, uid);
  return i === -1 ? s.players[p].leader : s.players[p].chars[i];
};

/** Carte d'un joueur dans le moteur, où qu'elle soit (hors Leader). */
const cardOf = (s: GameState, p: Seat, uid: number): Card | undefined => {
  const P = s.players[p];
  return [...P.deck, ...P.hand, ...P.life, ...P.trash, ...P.chars, ...(P.stage ? [P.stage] : [])].find((c) => c.uid === uid);
};
/** Numéro du moteur et code du miroir désignent-ils la même carte (opaque comprise) ? */
const sameCard = (num: string, code: string) => num === code || (isOpaque(num) && num.startsWith(`${OPAQUE}${code}`));

/** Mutation du moteur pour une mutation en attente ; null : le moteur y est déjà. */
function resolveOp(s: GameState, op: Op): External | null {
  switch (op.op) {
    case 'move': {
      const i = externalIndexOf(s, op.player, op.from, op.uid);
      if (i === null) {
        if (externalIndexOf(s, op.player, op.to, op.uid) !== null) return null;
        // écho dépassé : le moteur a déjà fait ce déplacement puis un autre (carte piochée puis posée, Vie passée en main
        // puis défaussée par son [Déclenchement]). Admis pour un écho seulement, et si c'est bien la même carte.
        const ailleurs = op.echo ? cardOf(s, op.player, op.uid) : undefined;
        if (ailleurs && sameCard(ailleurs.num, op.code)) return null;
        if (ailleurs) throw new InboundError(`${op.rpc} : la carte ${op.uid} est ${ailleurs.num} dans le moteur, ${op.code} dans le miroir`);
        throw new InboundError(`${op.rpc} : carte ${op.code} (${op.uid}) ni en ${op.from} ni en ${op.to} dans le moteur`);
      }
      const card = cardOf(s, op.player, op.uid)!;
      if (!sameCard(card.num, op.code)) {
        throw new InboundError(`${op.rpc} : la carte ${op.uid} est ${card.num} dans le moteur, ${op.code} dans le miroir`);
      }
      // carte opaque posée sur le terrain : de la catégorie de la zone (le jeu OPTCGSim fait foi)
      if (isOpaque(card.num) && (op.to === 'deploy' || op.to === 'stage')) CARDS[card.num].category = op.to === 'stage' ? 'STAGE' : 'CHARACTER';
      const room = zoneLength(s, op.player, op.to) - (op.from === op.to ? 1 : 0);
      const deckLike = op.to === 'deck' || op.to === 'life';
      const at = deckLike ? (op.dist >= room ? undefined : op.dist) : op.dist <= 0 ? undefined : Math.max(0, room - op.dist);
      return {
        kind: 'move', player: op.player, from: op.from, index: i, to: op.to, ...(at !== undefined ? { at } : {}),
        ...(op.rested !== undefined ? { rested: op.rested } : {}),
      };
    }
    case 'donDraw':
      if (s.players[op.player].donDeck <= op.deckAfter) return null;
      return { kind: 'move', player: op.player, from: 'donDeck', index: 0, to: 'donCost', rested: op.rested };
    case 'donReturn': {
      const P = s.players[op.player];
      if (P.donDeck >= op.deckAfter) return null;
      const rested = op.restedSrc ? P.donRested > 0 : P.donActive === 0;
      return { kind: 'move', player: op.player, from: 'donCost', index: rested ? P.donActive : 0, to: 'donDeck' };
    }
    case 'donRest': {
      const P = s.players[op.player];
      if (op.rest ? P.donActive <= op.activeAfter || !P.donActive : P.donActive >= op.activeAfter || !P.donRested) return null;
      return { kind: op.rest ? 'rest' : 'activate', player: op.player, zone: 'donCost', index: op.rest ? 0 : P.donActive };
    }
    case 'attach': {
      const target = holderIndex(s, op.player, op.uid);
      if (holderCard(s, op.player, op.uid).don >= op.donAfter) return null;
      const P = s.players[op.player];
      return { kind: 'attachDon', player: op.player, target, donIndex: op.rested ? P.donActive : 0, rested: op.rested };
    }
    case 'detach': {
      const target = holderIndex(s, op.player, op.uid);
      if (holderCard(s, op.player, op.uid).don <= op.donAfter) return null;
      return { kind: 'detachDon', player: op.player, target, donIndex: 0, to: op.to, rested: op.rested };
    }
    case 'rest': {
      const index = op.zone === 'deploy' ? externalIndexOf(s, op.player, 'deploy', op.uid) : 0;
      if (index === null) throw new InboundError(`${op.rpc} : carte ${op.uid} absente du terrain dans le moteur`);
      return { kind: op.rest ? 'rest' : 'activate', player: op.player, zone: op.zone, index };
    }
    case 'mod':
      return { kind: op.kind, player: op.player, target: holderIndex(s, op.player, op.uid), delta: op.delta, until: op.until };
    case 'shuffle': {
      const deck = s.players[op.player].deck;
      const where = new Map(deck.map((c, i) => [c.uid, i]));
      if (op.deck.length !== deck.length || op.deck.some((u) => !where.has(u))) {
        throw new InboundError(`${op.rpc} : le deck du moteur (${deck.length}) n'a pas les cartes du deck du miroir (${op.deck.length})`);
      }
      if (op.deck.every((u, i) => deck[i].uid === u)) return null;
      return { kind: 'shuffle', player: op.player, order: op.deck.map((u) => where.get(u)!) };
    }
    case 'turn':
      if (s.flow.stage === 'over') return null;
      if (op.echo && s.active === op.to) return null;
      return { kind: 'turn', to: op.to };
    case 'reveal':
      return null;
  }
}

/** Applique les mutations en attente, tant que le moteur n'attend pas de réponse au milieu d'un effet. */
function drain(t: CrossTable, applied: External[], errors: string[]) {
  while (t.backlog.length && t.game && !t.game.decision?.inEffect) {
    const op = t.backlog.shift()!;
    try {
      if (op.op === 'reveal') {
        const s = structuredClone(t.game);
        reveal(s, [op.uid], 'both');
        t.game = s;
        continue;
      }
      const ext = resolveOp(t.game, op);
      if (!ext) continue;
      const opts: ExternalOptions = { joyboy: t.joyboy, by: op.by, ...(op.cause ? { cause: op.cause } : {}) };
      t.game = applyExternal(t.game, ext, opts);
      applied.push(ext);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
}

/** Ouverture : la question de la main de départ va au joueur joy-boy quand il a sa main et pas encore de Vie ; quand les
 * deux joueurs ont leur Vie, le premier tour commence (le moteur ne joue pas l'ouverture d'une partie croisée). */
function opening(t: CrossTable) {
  const s0 = t.game;
  if (!s0 || s0.flow.stage !== 'mulligan' || t.backlog.length || t.held) return;
  const m = t.mirror;
  const life = (seat: Seat) => m.players[seat].zones.life.length;
  if (m.first !== undefined && life(0) > 0 && life(1) > 0) {
    const s = structuredClone(s0);
    s.turn = 1;
    s.first = m.first;
    s.active = m.first;
    s.decision = null;
    s.flow = { stage: 'refresh' };
    log(s, null, `${s.players[m.first].name} joue en premier`);
    t.game = advanceShared(s, t.joyboy);
    return;
  }
  const j = t.joyboy;
  const want: Seat = m.players[j].zones.hand.length > 0 && life(j) === 0 ? j : other(j);
  if (s0.flow.player !== want) {
    const s = structuredClone(s0);
    s.flow = { stage: 'mulligan', player: want };
    s.decision = null;
    t.game = advanceShared(s, t.joyboy);
  }
}

/** Vies face visible : le contrat des mutations ne les porte pas, on recopie celles du miroir. */
function syncFaceUp(t: CrossTable) {
  if (!t.game || t.backlog.length) return;
  let s: GameState | null = null;
  for (const seat of [0, 1] as const) {
    for (const c of t.mirror.players[seat].zones.life) {
      if (c.uid === undefined) continue;
      const e = (s ?? t.game).players[seat].life.find((x) => x.uid === c.uid);
      if (!e || Boolean(e.faceUp) === Boolean(c.faceUp)) continue;
      s ??= structuredClone(t.game);
      const target = s.players[seat].life.find((x) => x.uid === c.uid)!;
      if (c.faceUp) target.faceUp = true; else delete target.faceUp;
    }
  }
  if (s) t.game = s;
}

/** Options du miroir par défaut : puissance et mots-clés du catalogue joy-boy, puissance exacte calculée par le moteur. */
function mirrorOptions(t: CrossTable, opts: InboundOptions): MirrorOptions {
  const game = t.game;
  return {
    stats: (code) => {
      if (!knownCard(code)) return undefined;
      const d = CARDS[code];
      return { power: d.power, keywords: d.keywords, ...(d.category === 'LEADER' ? { maxDon: donTotal(code) } : {}) };
    },
    power: (_m, seat, card) => {
      if (!game || card.uid === undefined) return undefined;
      const f = findField(game, card.uid);
      return f && f.player === seat ? enginePower(game, card.uid) : undefined;
    },
    ...opts.mirror,
  };
}

// ---------------------------------------------------------------------------------------------------- entrée

const isAttackTap = (t: CrossTable, before: Mirror, rpc: Rpc, sender: Seat) =>
  baseName(rpc.name) === 'TapCard' && sender !== t.joyboy && before.turnPlayer === sender && !before.battle;

/**
 * Une RPC reçue de l'hôte OPTCGSim. `sender` = propriétaire de l'objet réseau (0 = hôte, 1 = joy-boy pour l'écho de ses
 * propres actions). Les …ServerRpc (envoyées par joy-boy) sont ignorées : seule leur réponse …ClientRpc compte.
 * Rend une nouvelle table (celle reçue n'est pas modifiée), les mutations appliquées au moteur et la vue de joy-boy.
 */
export function receive(table: CrossTable, rpc: Rpc, sender: Seat, opts: InboundOptions = {}): InboundResult {
  const t = structuredClone(table);
  const applied: External[] = [];
  const errors: string[] = [];
  if (/ServerRpc$/.test(rpc.name)) return finish(t, applied, errors, opts);
  const before = t.mirror;
  const { state: after, externals } = applyRpc(before, rpc, sender, mirrorOptions(t, opts));
  const mirrorErrors = after.errors.slice(before.errors.length);
  errors.push(...mirrorErrors.map((e) => `miroir : ${e}`));
  t.mirror = after;
  if (!t.game) {
    if (deckLoaded(after, 0) && deckLoaded(after, 1)) build(t, opts);
    return finish(t, applied, errors, opts);
  }
  let ops: Op[] = [];
  try {
    ops = translate(t, before, after, rpc, sender, externals);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  // inclinaison du joueur OPTCGSim : attaque si la RPC suivante qui compte est son SetupAttack avec cette carte
  if (t.held) {
    const attack = baseName(rpc.name) === 'SetupAttack' && sender === t.held.seat && num(rpc, 'iAttackerIdx') === t.held.index;
    if (attack || ops.length || baseName(rpc.name) === 'SetupAttack') {
      for (const o of t.held.ops) if (attack) o.cause = 'attack';
      t.backlog.push(...t.held.ops);
      t.held = null;
    }
  }
  if (ops.length && isAttackTap(t, before, rpc, sender)) t.held = { ops, seat: sender, index: num(rpc, 'iCardIndex') };
  else t.backlog.push(...ops);
  drain(t, applied, errors);
  return finish(t, applied, errors, opts);
}

/** Alias du contrat de la tâche O0. */
export const translateInbound = receive;

/** Applique ce qui attend encore (inclinaison mise de côté, mutations bloquées par un effet en cours). */
export function flush(table: CrossTable, opts: InboundOptions = {}): InboundResult {
  const t = structuredClone(table);
  const applied: External[] = [];
  const errors: string[] = [];
  if (t.held) { t.backlog.push(...t.held.ops); t.held = null; }
  drain(t, applied, errors);
  return finish(t, applied, errors, opts);
}

/** Remplace l'état du moteur (après une réponse du joueur joy-boy, answerExternal) et applique ce qui attendait. */
export function withGame(table: CrossTable, game: GameState, opts: InboundOptions = {}): InboundResult {
  const t = structuredClone(table);
  t.game = structuredClone(game);
  const applied: External[] = [];
  const errors: string[] = [];
  drain(t, applied, errors);
  return finish(t, applied, errors, opts);
}

function finish(t: CrossTable, applied: External[], errors: string[], opts: InboundOptions): InboundResult {
  opening(t);
  syncFaceUp(t);
  pruneForeignMods(t);
  t.errors.push(...errors);
  const { view, opaque } = joyboyView(t, opts);
  return { table: t, applied, errors, view, opaque, ...(t.mirror.over ? { over: t.mirror.over } : {}) };
}

// ---------------------------------------------------------------------------------------------------- vue

/** Vue du joueur joy-boy : view.ts, et les cartes opaques montrées de dos, avec ce qu'on en sait à côté. */
export function joyboyView(t: CrossTable, opts: InboundOptions = {}): Pick<InboundResult, 'view' | 'opaque'> {
  if (!t.game) return { view: null, opaque: [] };
  const v = viewFor(t.game, t.joyboy);
  const opaque: InboundResult['opaque'] = [];
  const hide = <C extends Card>(c: C): C => {
    if (!isOpaque(c.num)) return c;
    const code = opaqueCode(c.num).replace(/:L$/, '');
    const d = CARDS[c.num];
    opaque.push({ uid: c.uid, code, name: d?.name, cost: d?.cost ?? null, power: d?.power ?? null, ...opts.describe?.(code) });
    return { ...c, num: HIDDEN };
  };
  for (const P of v.players) {
    P.leader = hide(P.leader);
    P.chars = P.chars.map(hide);
    if (P.stage) P.stage = hide(P.stage);
    for (const z of ['deck', 'hand', 'life', 'trash'] as const) P[z] = P[z].map(hide);
    if (P.list) {
      P.list = { leader: isOpaque(P.list.leader) ? HIDDEN : P.list.leader, cards: Object.fromEntries(Object.entries(P.list.cards).filter(([n]) => !isOpaque(n))) };
    }
  }
  return { view: v, opaque };
}

// ---------------------------------------------------------------------------------------------------- contrôle

/**
 * Réaligne le moteur sur le miroir (Décision 9 de l'étape O : OPTCGSim fait foi, joy-boy s'adapte au lieu de rester
 * bloqué). Pour chaque joueur, les cartes du moteur (retrouvées par leur uid) sont rangées dans les zones et l'ordre du
 * miroir : deck, main, Vie, Défausse, Personnages, Lieu ; puis les DON!! (deck, redressées, épuisées, données) et
 * l'inclinaison. Une carte du miroir que le moteur ne connaît pas (uid absent) : ce joueur n'est pas touché. Ne touche ni
 * au tour ni aux décisions. Rend la nouvelle table et les zones corrigées (« joueur 0, deck »…).
 */
export function realign(table: CrossTable, seats: Seat[] = [0, 1]): { table: CrossTable; fixed: string[] } {
  const t = structuredClone(table);
  const s = t.game;
  const fixed: string[] = [];
  if (!s) return { table: t, fixed };
  for (const seat of seats) {
    const m = t.mirror.players[seat].zones, P = s.players[seat];
    const all = new Map<number, Card>();
    for (const c of [...P.deck, ...P.hand, ...P.life, ...P.trash, ...P.chars, ...(P.stage ? [P.stage] : [])]) all.set(c.uid, c);
    const wanted = [...m.deck, ...m.hand, ...m.life, ...m.trash, ...m.deploy, ...m.stage];
    if (wanted.some((c) => c.uid === undefined || !all.has(c.uid))) continue;
    const plain = (c: MirrorCardX): Card => {
      const e = all.get(c.uid!)!;
      const out: Card = { uid: e.uid, num: e.num };
      if (c.faceUp) out.faceUp = true;
      return out;
    };
    const field = (c: MirrorCardX): FieldCard => {
      const e = all.get(c.uid!)! as Partial<FieldCard> & Card;
      return {
        uid: e.uid, num: e.num, rested: Boolean(c.rested), don: c.attachedDon ?? 0,
        playedTurn: e.playedTurn ?? s.turn, usedOpt: e.usedOpt ?? [], ...(e.battledCharTurn !== undefined ? { battledCharTurn: e.battledCharTurn } : {}),
      };
    };
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    const set = <K extends 'deck' | 'hand' | 'life' | 'trash'>(zone: K, cards: MirrorCardX[], label: string) => {
      const target = cards.map((c) => c.uid!);
      if (same(P[zone].map((c) => c.uid), target)) return;
      P[zone] = cards.map(plain) as PlayerState[K];
      fixed.push(`joueur ${seat}, ${label}`);
    };
    set('deck', [...m.deck].reverse(), 'deck');
    // main : l'ordre du moteur est gardé si ce sont les mêmes cartes
    const handIds = m.hand.map((c) => c.uid!);
    if (!same([...P.hand.map((c) => c.uid)].sort((a, b) => a - b), [...handIds].sort((a, b) => a - b))) set('hand', m.hand, 'main');
    set('life', [...m.life].reverse(), 'vie');
    set('trash', m.trash, 'défausse');
    const chars = m.deploy.map(field);
    const charsKey = (cs: FieldCard[]) => cs.map((c) => `${c.uid}:${c.rested ? 1 : 0}:${c.don}`).join(',');
    if (charsKey(P.chars) !== charsKey(chars)) { P.chars = chars; fixed.push(`joueur ${seat}, personnages`); }
    const stage = m.stage[0] ? field(m.stage[0]) : null;
    if ((P.stage?.uid ?? -1) !== (stage?.uid ?? -1)) { P.stage = stage; fixed.push(`joueur ${seat}, lieu`); }
    const lead = m.leader[0];
    if (lead && (Boolean(lead.rested) !== P.leader.rested || (lead.attachedDon ?? 0) !== P.leader.don)) {
      P.leader = { ...P.leader, rested: Boolean(lead.rested), don: lead.attachedDon ?? 0 };
      fixed.push(`joueur ${seat}, leader`);
    }
    const don: [number, number, number] = [m.donDeck.length, m.donCost.filter((d) => !d.rested).length, m.donCost.filter((d) => d.rested).length];
    if (don[0] !== P.donDeck || don[1] !== P.donActive || don[2] !== P.donRested) {
      [P.donDeck, P.donActive, P.donRested] = don;
      fixed.push(`joueur ${seat}, DON!!`);
    }
  }
  if (fixed.length) {
    // les mutations en attente décrivaient l'ancien état
    t.backlog = [];
    t.held = null;
  }
  return { table: t, fixed };
}

/** Écarts entre le miroir et le moteur, zone par zone (vide quand la table est alignée). Pour les tests et la session. */
export function compareTables(t: CrossTable): string[] {
  const s = t.game;
  if (!s) return [];
  const out: string[] = [];
  for (const seat of [0, 1] as const) {
    const m = t.mirror.players[seat].zones, P = s.players[seat];
    const uids = (cards: MirrorCardX[]) => cards.map((c) => c.uid ?? -1);
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    const check = (zone: string, mirror: number[], engine: number[]) => {
      if (!same(mirror, engine)) out.push(`joueur ${seat}, ${zone} : miroir [${mirror.join(',')}] ≠ moteur [${engine.join(',')}]`);
    };
    check('deck', uids(m.deck).reverse(), P.deck.map((c) => c.uid));
    check('vie', uids(m.life).reverse(), P.life.map((c) => c.uid));
    check('défausse', uids(m.trash), P.trash.map((c) => c.uid));
    check('personnages', uids(m.deploy), P.chars.map((c) => c.uid));
    check('lieu', uids(m.stage), P.stage ? [P.stage.uid] : []);
    check('main', uids(m.hand).sort((a, b) => a - b), P.hand.map((c) => c.uid).sort((a, b) => a - b));
    const donM = [m.donDeck.length, m.donCost.filter((d) => !d.rested).length, m.donCost.filter((d) => d.rested).length];
    const donE = [P.donDeck, P.donActive, P.donRested];
    if (!same(donM, donE)) out.push(`joueur ${seat}, DON!! (deck, redressées, épuisées) : miroir ${donM.join('/')} ≠ moteur ${donE.join('/')}`);
    const attached = (c: MirrorCardX) => c.attachedDon ?? 0;
    check('DON!! données', [attached(m.leader[0]), ...m.deploy.map(attached)], [P.leader.don, ...P.chars.map((c) => c.don)]);
    check('épuisés', [m.leader[0], ...m.deploy].map((c) => (c.rested ? 1 : 0)), [P.leader, ...P.chars].map((c) => (c.rested ? 1 : 0)));
  }
  return out;
}
