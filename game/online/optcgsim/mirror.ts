// Miroir des zones OPTCGSim (tâche O1.2) : la table telle que le jeu la voit, dans l'ordre exact de ses listes.
//
// OPTCGSim désigne les cartes par leur position dans une zone (iIdx, iCardIndex, iDeployIdx ; -1 = leader). Le miroir
// tient donc les mêmes listes, dans le même ordre, que GameplayLogicScript (Lgo_MyDeck, Lgo_MyHand, Lgo_MyDeploy…),
// pour les deux joueurs, et traduit chaque RPC qui change la table en mutations externes (types.ts) pour le moteur.
//
// Conventions reprises du jeu (lues dans les fonctions *_Internal de GameplayLogicScript) :
// - le dessus d'une pile (deck, vies, DON) est le DERNIER élément de la liste ; « dessous » = indice 0 ;
// - une carte qui arrive en main, en défausse, sur le terrain ou dans une zone de coût va à la fin de la liste, sauf
//   les DON inclinées (DrawRestedDon, DetachSpecificDon) qui vont en tête de la zone de coût ;
// - une RPC est exécutée chez l'autre joueur (« if (!IsOwner) ») : « My… » / sans préfixe agit sur les zones de celui
//   qui l'envoie, « …Opponent… » / « Opp… » / « Enemy… » sur celles de l'autre ;
// - la puissance au combat est calculée chez chacun (ResolveAttack_Internal) : les vies perdues et le KO du défenseur
//   ne sont pas envoyés, le miroir les déduit (voir resolveAttack).
//
// Le miroir est pur : applyRpc rend un nouvel état (copie) et la liste des mutations externes, sans lever d'erreur sur
// une RPC incohérente (l'écart est noté dans state.errors : en partie réelle, le jeu fait foi).
//
// À qui appliquer quoi : l'hôte renvoie chaque action à tous les clients en …ClientRpc, y compris celles de joy-boy
// (objet réseau de joy-boy, fixtures du 17 nov.). On applique donc chaque ClientRpc reçue une fois, avec pour
// `sender` le propriétaire de l'objet (hôte = 0, joy-boy = 1), et pas en plus la …ServerRpc que joy-boy envoie.

import type { External, MirrorCard, MirrorPlayer, MirrorState, Rpc, Seat, Zone } from './types.ts';

// ---------------------------------------------------------------------------------------------------- types du miroir

/** Échéance d'un bonus, comme les champs de LiveCard (cardCombatPower, cardPowerToOwnersTurnEnd…). */
export type Expiry = 'battle' | 'turn' | 'ownersEnd' | 'oppEnd' | 'start' | 'field';

export interface Modifier { kind: 'power' | 'cost'; delta: number; until: Expiry; base?: boolean }

/** Carte du miroir : `iid` identifie la carte dans le miroir (comme le GameObject du jeu), `uid` celle du moteur. */
export interface MirrorCardX extends MirrorCard {
  iid: number;
  /** bSkipNextActive : ne se redresse pas à la prochaine phase de redressement. */
  frozen?: boolean;
  mods?: Modifier[];
  /** Statuts accordés par effet (GrantCardBlocker, SilenceCard, SetMyCantAttack…) : nom de la RPC → valeur. */
  flags?: Record<string, unknown>;
  /** Capacités déjà utilisées ce tour (SetCardAbilityUsed) : indices d'action. */
  used?: number[];
}

export interface MirrorPlayerX extends MirrorPlayer {
  leader: MirrorCardX;
  zones: Record<Zone, MirrorCardX[]>;
  /** Statuts du joueur (SetNoDrawFromLife, SetGlobalTenacity…). */
  flags?: Record<string, unknown>;
}

export interface BattleSide { seat: Seat; iid: number }
export interface Battle { attacker: BattleSide; defender: BattleSide; counter: number }

export interface Mirror extends MirrorState {
  players: [MirrorPlayerX, MirrorPlayerX];
  nextIid: number;
  /** Joueur qui commence (ChooseTurnOrder). */
  first?: Seat;
  battle?: Battle;
  over?: { loser: Seat; reason: string };
  /** Écarts : RPC qui désigne une carte absente, puissance inconnue… (vide si tout est cohérent). */
  errors: string[];
  /** RPC reçues que le miroir ne sait pas appliquer (nom → nombre). */
  unhandled: Record<string, number>;
}

/** Mutations rendues par le miroir : celles du contrat (le retrait d'une DON attachée, detachDon, y est entré en O1). */
export type MirrorExternal = External;

/** Ce que le miroir doit savoir d'une carte pour résoudre un combat (fourni par l'appelant : catalogue joy-boy). */
export interface CardStats { power?: number | null; keywords?: readonly string[]; maxDon?: number }
export interface MirrorOptions {
  stats?: (code: string) => CardStats | undefined;
  /**
   * Puissance d'une carte au moment du combat, effets passifs compris (ex. leader Sabo OP13-004 : −1000 avec 4 vies
   * ou plus). Le miroir ne connaît pas les effets des cartes : sans ce calcul (branché sur le moteur joy-boy par le
   * combat, tâche O2.3), il prend puissance imprimée + bonus reçus + 1000 par DON attachée pour l'attaquant.
   */
  power?: (state: Mirror, seat: Seat, card: MirrorCardX, attacking: boolean) => number | undefined;
}

export interface ApplyResult { state: Mirror; externals: MirrorExternal[] }

/** Nombres de cartes par zone, dans l'ordre d'une ligne `RZ1|CHK` du jeu. */
export interface ZoneCounts {
  deck: number; hand: number; deploy: number; life: number; donDeck: number; donCost: number; trash: number;
  stage: number; leader: number; attachedDon: number;
}

export const ZONES: readonly Zone[] = ['deck', 'hand', 'life', 'deploy', 'stage', 'leader', 'trash', 'donDeck', 'donCost'];
export const DON = 'DON';
const FIELD: ReadonlySet<Zone> = new Set(['deploy', 'leader', 'stage', 'donCost']);

// ---------------------------------------------------------------------------------------------------- création

function emptyPlayer(next: () => number, maxDon = 10): MirrorPlayerX {
  const leader: MirrorCardX = { code: '', iid: next(), faceUp: true };
  const zones = Object.fromEntries(ZONES.map((z) => [z, []])) as unknown as Record<Zone, MirrorCardX[]>;
  zones.leader.push(leader);
  for (let i = 0; i < maxDon; i++) zones.donDeck.push({ code: DON, iid: next() });
  return { name: '', leader, zones };
}

/** Table vide, comme le jeu avant la mise en place : un leader inconnu et 10 DON par joueur, decks vides. */
export function createMirror(): Mirror {
  let n = 1;
  const next = () => n++;
  const players: [MirrorPlayerX, MirrorPlayerX] = [emptyPlayer(next), emptyPlayer(next)];
  return { players, turnPlayer: 0, actingPlayer: 0, turn: 0, nextIid: n, errors: [], unhandled: {} };
}

/** Copie profonde (structuredClone garde le lien leader ↔ zones.leader[0]). */
export function cloneMirror(state: Mirror): Mirror {
  return structuredClone(state);
}

// ---------------------------------------------------------------------------------------------------- lecture

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function counts(state: MirrorState, seat: Seat): ZoneCounts {
  const z = state.players[seat].zones;
  const attachedDon = [...z.leader, ...z.deploy].reduce((t, c) => t + (c.attachedDon ?? 0), 0);
  return {
    deck: z.deck.length, hand: z.hand.length, deploy: z.deploy.length, life: z.life.length, donDeck: z.donDeck.length,
    donCost: z.donCost.length, trash: z.trash.length, stage: z.stage.length, leader: z.leader.length, attachedDon,
  };
}

/** Carte à une position OPTCGSim (-1 = leader pour la zone `deploy`). */
export function cardAt(state: Mirror, seat: Seat, zone: Zone, index: number): MirrorCardX | undefined {
  const p = state.players[seat];
  if (index === -1 && (zone === 'deploy' || zone === 'leader')) return p.leader;
  return p.zones[zone][index];
}

/** Position OPTCGSim d'une carte du moteur (uid), -1 si absente. */
export function indexOfUid(state: Mirror, seat: Seat, zone: Zone, uid: number): number {
  return state.players[seat].zones[zone].findIndex((c) => c.uid === uid);
}

/** Retrouve une carte du miroir par son iid. */
export function locate(state: Mirror, iid: number): { seat: Seat; zone: Zone; index: number; card: MirrorCardX } | undefined {
  for (const seat of [0, 1] as const) {
    for (const zone of ZONES) {
      const index = state.players[seat].zones[zone].findIndex((c) => c.iid === iid);
      if (index >= 0) return { seat, zone, index, card: state.players[seat].zones[zone][index] };
    }
  }
  return undefined;
}

/** Nom d'une RPC sans son suffixe (DrawCardClientRpc et DrawCardServerRpc → DrawCard). */
export const baseName = (name: string): string => name.replace(/(Client|Server)Rpc$/, '');

// ---------------------------------------------------------------------------------------------------- contexte

interface Ctx { s: Mirror; out: MirrorExternal[]; opts: MirrorOptions; rpc: string; v: Record<string, unknown> }

const num = (ctx: Ctx, k: string, d = 0): number => (typeof ctx.v[k] === 'number' ? (ctx.v[k] as number) : d);
const bool = (ctx: Ctx, k: string): boolean => ctx.v[k] === true;
const str = (ctx: Ctx, k: string): string => (typeof ctx.v[k] === 'string' ? (ctx.v[k] as string) : '');
const zoneOf = (ctx: Ctx, seat: Seat, z: Zone): MirrorCardX[] => ctx.s.players[seat].zones[z];
const fail = (ctx: Ctx, msg: string) => { ctx.s.errors.push(`${ctx.rpc} : ${msg}`); };

function newCard(ctx: Ctx, code: string): MirrorCardX {
  return { code, iid: ctx.s.nextIid++ };
}

/** Le leader (-1) ou le Personnage n° idx. */
function target(ctx: Ctx, seat: Seat, idx: number): MirrorCardX | undefined {
  const c = idx === -1 ? ctx.s.players[seat].leader : zoneOf(ctx, seat, 'deploy')[idx];
  if (!c) fail(ctx, `pas de carte ${idx} sur le terrain du joueur ${seat}`);
  return c;
}

/** Une carte quitte le terrain : DON attachées rendues inclinées (ReturnCardDon), effets effacés (ResetCardEffects). */
function leaveField(ctx: Ctx, seat: Seat, card: MirrorCardX) {
  const n = card.attachedDon ?? 0;
  for (let i = 0; i < n; i++) zoneOf(ctx, seat, 'donCost').unshift({ ...newCard(ctx, DON), rested: true });
  delete card.attachedDon; delete card.mods; delete card.flags; delete card.used; delete card.frozen; delete card.rested;
}

/**
 * Déplace la carte n° index de `from` vers `to` (dessus = fin de liste, dessous = début) et note la mutation externe.
 * `index` = 'top' prend le dessus de la pile.
 */
function move(ctx: Ctx, seat: Seat, from: Zone, index: number | 'top', to: Zone, where: 'top' | 'bottom',
  patch: { rested?: boolean; faceUp?: boolean } = {}): MirrorCardX | undefined {
  const src = zoneOf(ctx, seat, from);
  const i = index === 'top' ? src.length - 1 : index;
  const card = src[i];
  if (!card || i < 0) { fail(ctx, `pas de carte ${index} en ${from} (joueur ${seat}, ${src.length} carte(s))`); return undefined; }
  src.splice(i, 1);
  if (from === 'deploy' || from === 'leader' || from === 'stage') leaveField(ctx, seat, card);
  if (!FIELD.has(to)) { delete card.rested; delete card.frozen; }
  if (to === 'life') { if (patch.faceUp) card.faceUp = true; else delete card.faceUp; } else if (from === 'life') delete card.faceUp;
  if (patch.rested !== undefined && FIELD.has(to)) { if (patch.rested) card.rested = true; else delete card.rested; }
  const dst = zoneOf(ctx, seat, to);
  const at = where === 'top' ? dst.length : 0;
  dst.splice(at, 0, card);
  const ext: External = { kind: 'move', player: seat, from, index: i, to, at };
  if (FIELD.has(to)) ext.rested = card.rested === true;
  ctx.out.push(ext);
  return card;
}

function repeat(n: number, f: () => unknown) {
  for (let k = 0; k < n; k++) if (f() === undefined) break;
}

/** Permutation « 3-0-2-1 » : nouvelle[j] = ancienne[ordre[j]] (ShuffleWithString). */
function permute(ctx: Ctx, list: MirrorCardX[], text: string): number[] | undefined {
  const order = text.replace(/-$/, '').split('-').map(Number).slice(0, list.length);
  const ok = order.length === list.length && new Set(order).size === list.length && order.every((x) => x >= 0 && x < list.length);
  if (!ok) { fail(ctx, `mélange invalide pour ${list.length} carte(s)`); return undefined; }
  const before = [...list];
  list.splice(0, list.length, ...order.map((j) => before[j]));
  return order;
}

function setRest(ctx: Ctx, seat: Seat, zone: Zone, index: number, card: MirrorCardX | undefined, rested: boolean) {
  if (!card) return;
  if (rested) card.rested = true; else delete card.rested;
  ctx.out.push({ kind: rested ? 'rest' : 'activate', player: seat, zone, index });
}

// ---------------------------------------------------------------------------------------------------- DON

/** TapDon_Internal : d'abord les DON actives non gelées, de la première à la dernière, puis les gelées. */
function tapDon(ctx: Ctx, seat: Seat, count: number) {
  const z = zoneOf(ctx, seat, 'donCost');
  let n = 0;
  for (const pass of [0, 1]) {
    z.forEach((d, i) => {
      if (n < count && !d.rested && (pass === 1 || !d.frozen)) { n++; setRest(ctx, seat, 'donCost', i, d, true); }
    });
  }
  if (n !== count) fail(ctx, `${n} DON inclinée(s) sur ${count}`);
}

/** UntapDon_Internal : de la dernière à la première, d'abord les gelées inclinées. */
function untapDon(ctx: Ctx, seat: Seat, count: number) {
  const z = zoneOf(ctx, seat, 'donCost');
  let n = 0;
  for (const pass of [0, 1]) {
    for (let i = z.length - 1; i >= 0 && n < count; i--) {
      const d = z[i];
      if (d.rested && (pass === 1 || d.frozen)) { n++; setRest(ctx, seat, 'donCost', i, d, false); }
    }
  }
  if (n !== count) fail(ctx, `${n} DON redressée(s) sur ${count}`);
}

function attachDon(ctx: Ctx, seat: Seat, cardIdx: number, donIdx: number) {
  const t = target(ctx, seat, cardIdx);
  const z = zoneOf(ctx, seat, 'donCost');
  const d = z[donIdx];
  if (!t) return;
  if (!d) { fail(ctx, `pas de DON ${donIdx} (joueur ${seat})`); return; }
  z.splice(donIdx, 1);
  t.attachedDon = (t.attachedDon ?? 0) + 1;
  ctx.out.push({ kind: 'attachDon', player: seat, target: cardIdx, donIndex: donIdx, rested: d.rested === true });
}

/** FindRestedDon : la première DON inclinée (non gelée d'abord si on l'attache chez l'adversaire). */
function findRestedDon(ctx: Ctx, seat: Seat, friendly: boolean): number {
  const z = zoneOf(ctx, seat, 'donCost');
  if (!friendly) { const i = z.findIndex((d) => d.rested && !d.frozen); if (i >= 0) return i; }
  return z.findIndex((d) => d.rested);
}

/** DetachSpecificDon (vers la zone de coût, inclinée, en tête) ou ReturnDonFromCard (vers le deck DON, active). */
function detachDon(ctx: Ctx, seat: Seat, cardIdx: number, donIdx: number, to: 'donCost' | 'donDeck') {
  const t = target(ctx, seat, cardIdx);
  if (!t) return;
  if (donIdx < 0 || donIdx >= (t.attachedDon ?? 0)) { fail(ctx, `pas de DON ${donIdx} attachée à ${cardIdx}`); return; }
  t.attachedDon = (t.attachedDon ?? 0) - 1;
  if (!t.attachedDon) delete t.attachedDon;
  const d = newCard(ctx, DON);
  if (to === 'donCost') { d.rested = true; zoneOf(ctx, seat, 'donCost').unshift(d); } else zoneOf(ctx, seat, 'donDeck').push(d);
  ctx.out.push({ kind: 'detachDon', player: seat, target: cardIdx, donIndex: donIdx, to, rested: to === 'donCost' });
}

// ---------------------------------------------------------------------------------------------------- bonus

/** Échéance du contrat la plus proche ; les bonus qui durent plus longtemps qu'un tour sont réémis à chaque tour. */
const contractUntil = (until: Expiry): 'turn' | 'battle' | 'ownersEnd' => (until === 'battle' || until === 'ownersEnd' ? until : 'turn');

function addMod(ctx: Ctx, seat: Seat, idx: number, kind: 'power' | 'cost', delta: number, until: Expiry, base = false) {
  const c = target(ctx, seat, idx);
  if (!c || !delta) return;
  (c.mods ??= []).push(base ? { kind, delta, until, base } : { kind, delta, until });
  ctx.out.push({ kind, player: seat, target: idx, delta, until: contractUntil(until) });
}

/** Remplace le total d'une famille de bonus (SetCardCost, ChangeCardBasePower) par une nouvelle valeur. */
function setMod(ctx: Ctx, seat: Seat, idx: number, kind: 'power' | 'cost', value: number, until: Expiry, base: boolean, onlyIfGreater = false) {
  const c = target(ctx, seat, idx);
  if (!c) return;
  const same = (m: Modifier) => m.kind === kind && m.until === until && (m.base ?? false) === base;
  const current = (c.mods ?? []).filter(same).reduce((t, m) => t + m.delta, 0);
  if (onlyIfGreater && current !== 0 && current >= value) return;
  if (value === current) return;
  c.mods = (c.mods ?? []).filter((m) => !same(m));
  if (value) c.mods.push(base ? { kind, delta: value, until, base } : { kind, delta: value, until });
  if (!c.mods.length) delete c.mods;
  ctx.out.push({ kind, player: seat, target: idx, delta: value - current, until: contractUntil(until) });
}

function setFlag(ctx: Ctx, seat: Seat, idx: number, name: string, value: unknown) {
  const c = target(ctx, seat, idx);
  if (!c) return;
  if (value === false || value === 0) { if (c.flags) { delete c.flags[name]; if (!Object.keys(c.flags).length) delete c.flags; } } else (c.flags ??= {})[name] = value;
}

const fieldCards = (p: MirrorPlayerX): MirrorCardX[] => [p.leader, ...p.zones.deploy, ...p.zones.stage];

/** Retire les bonus échus (le moteur fait de même de son côté avec l'échéance reçue). */
function expire(ctx: Ctx, test: (m: Modifier, owner: Seat) => boolean) {
  for (const seat of [0, 1] as const) {
    for (const c of fieldCards(ctx.s.players[seat])) {
      if (!c.mods) continue;
      c.mods = c.mods.filter((m) => !test(m, seat));
      if (!c.mods.length) delete c.mods;
    }
  }
}

/** Bonus encore actifs au début d'un tour mais que le moteur a laissés échoir (« turn ») : on les réémet. */
function reemit(ctx: Ctx) {
  for (const seat of [0, 1] as const) {
    const p = ctx.s.players[seat];
    const cards: [number, MirrorCardX][] = [[-1, p.leader], ...p.zones.deploy.map((c, i) => [i, c] as [number, MirrorCardX])];
    for (const [idx, c] of cards) {
      for (const m of c.mods ?? []) {
        if (m.until === 'oppEnd' || m.until === 'start' || m.until === 'field') ctx.out.push({ kind: m.kind, player: seat, target: idx, delta: m.delta, until: 'turn' });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------- tours

/** PlayerUntap : DON attachées rendues inclinées en tête, puis tout se redresse sauf ce qui est gelé. */
function refresh(ctx: Ctx, seat: Seat) {
  const p = ctx.s.players[seat];
  for (const c of [p.leader, ...p.zones.deploy]) {
    const n = c.attachedDon ?? 0;
    for (let i = 0; i < n; i++) p.zones.donCost.unshift({ ...newCard(ctx, DON), rested: true });
    delete c.attachedDon;
  }
  for (const c of [p.leader, ...p.zones.deploy, ...p.zones.donCost, ...p.zones.stage]) {
    if (c.frozen) delete c.frozen; else delete c.rested;
  }
}

/** Fin du tour de `ender` (EndTurn_Internal + phase de redressement de l'autre). */
function endTurn(ctx: Ctx, ender: Seat, extraTurn = false) {
  const next = extraTurn ? ender : other(ender);
  expire(ctx, (m, owner) => m.until === 'battle' || m.until === 'turn' || (m.until === 'ownersEnd' && owner === ender)
    || (m.until === 'oppEnd' && owner !== ender) || (m.until === 'start' && owner === next));
  ctx.s.battle = undefined;
  ctx.s.turnPlayer = next;
  ctx.s.actingPlayer = next;
  ctx.s.turn++;
  refresh(ctx, next);
  for (const p of ctx.s.players) for (const c of fieldCards(p)) delete c.used;
  ctx.out.push({ kind: 'turn', to: next });
  reemit(ctx);
}

// ---------------------------------------------------------------------------------------------------- combat

const hasKeyword = (ctx: Ctx, c: MirrorCardX, k: string) => (ctx.opts.stats?.(c.code)?.keywords ?? []).some((x) => x.toLowerCase() === k.toLowerCase());

/** Puissance d'une carte comme CardPower : calcul fourni (options.power) ou, à défaut, sans les effets passifs. */
export function battlePower(state: Mirror, seat: Seat, card: MirrorCardX, attacking: boolean, options: MirrorOptions = {}): number | undefined {
  const exact = options.power?.(state, seat, card, attacking);
  if (exact !== undefined) return exact;
  const base = options.stats?.(card.code)?.power;
  if (base == null) return undefined;
  const mods = (card.mods ?? []).filter((m) => m.kind === 'power').reduce((t, m) => t + m.delta, 0);
  const don = attacking && state.turnPlayer === seat ? 1000 * (card.attachedDon ?? 0) : 0;
  return base + mods + don;
}

/** Fin d'un combat : bonus de combat effacés, plus d'attaque en cours. */
function endBattle(ctx: Ctx) {
  expire(ctx, (m) => m.until === 'battle');
  ctx.s.battle = undefined;
}

/** Perd une vie (DrawFromLife / TrashLife) ; plus de vie : la partie est perdue. */
function loseLife(ctx: Ctx, seat: Seat, banish: boolean): boolean {
  if (!zoneOf(ctx, seat, 'life').length) { ctx.s.over ??= { loser: seat, reason: 'touché sans vie' }; return false; }
  move(ctx, seat, 'life', 'top', banish ? 'trash' : 'hand', 'top');
  return true;
}

/** ResolveAttack_Internal : attaquant ≥ défenseur + contre → vie(s) perdue(s) ou Personnage mis KO. */
function resolveAttack(ctx: Ctx) {
  const b = ctx.s.battle;
  if (!b) { fail(ctx, 'pas d’attaque en cours'); return; }
  const atk = locate(ctx.s, b.attacker.iid), def = locate(ctx.s, b.defender.iid);
  if (!atk || !def || (def.zone !== 'deploy' && def.zone !== 'leader')) { endBattle(ctx); ctx.s.actingPlayer = b.attacker.seat; return; }
  const pa = battlePower(ctx.s, atk.seat, atk.card, true, ctx.opts), pd = battlePower(ctx.s, def.seat, def.card, false, ctx.opts);
  if (pa === undefined || pd === undefined) {
    fail(ctx, `puissance inconnue (${atk.card.code || '?'} contre ${def.card.code || '?'}) : combat non résolu`);
    endBattle(ctx); ctx.s.actingPlayer = b.attacker.seat; return;
  }
  const hit = pa >= pd + b.counter;
  let leaderHit = false;
  if (hit && def.zone === 'leader') {
    leaderHit = true;
    const banish = hasKeyword(ctx, atk.card, 'Banish') || atk.card.flags?.GrantCardBanish === true || atk.card.flags?.GrantCardTempBanish === true;
    const double = hasKeyword(ctx, atk.card, 'Double Attack') || atk.card.flags?.GrantCardDoubleAttack === true || atk.card.flags?.GrantCardTempDoubleAttack === true;
    // Double attaque sans bannissement : une seule vie ici ; la seconde arrive après la phase de déclenchement, envoyée
    // par le défenseur (TriggerEnd_DoubleAttack : PlayerDrawLife puis MoveToSecondLifeTrigger). Avec bannissement, les
    // deux vies partent ensemble (CardDestroyedInBattle). Correction de la tâche O2.3.
    if (loseLife(ctx, def.seat, banish) && double && banish && zoneOf(ctx, def.seat, 'life').length) loseLife(ctx, def.seat, banish);
  } else if (hit && !def.card.flags?.GrantCardCombatImmune && !def.card.flags?.GrantCardImmune) {
    move(ctx, def.seat, 'deploy', def.index, 'trash', 'top');
  }
  if (atk.card.flags) { delete atk.card.flags.GrantCardTempBanish; delete atk.card.flags.GrantCardTempDoubleAttack; }
  endBattle(ctx);
  // Un leader touché passe par la phase de déclenchement : c'est le défenseur qui rend la main (SwitchTurns).
  if (!leaderHit) ctx.s.actingPlayer = b.attacker.seat;
}

// ---------------------------------------------------------------------------------------------------- RPC

type Handler = (ctx: Ctx, me: Seat, opp: Seat) => void;

/** Famille d'une RPC, pour le rapport de couverture. */
export type Family = 'mise en place' | 'déplacement' | 'DON' | 'inclinaison' | 'vies' | 'bonus' | 'statut' | 'combat' | 'tour' | 'sans effet';

const H: Record<string, [Family, Handler]> = {};
const def = (family: Family, names: string[], h: Handler) => { for (const n of names) H[n] = [family, h]; };
/** Variante « My » (zones de l'envoyeur) et variante « Opponent » (zones de l'autre) d'une même action. */
const both = (family: Family, mine: string[], theirs: string[], h: (ctx: Ctx, seat: Seat) => void) => {
  def(family, mine, (ctx, me) => h(ctx, me));
  def(family, theirs, (ctx, _me, opp) => h(ctx, opp));
};

// Mise en place
def('mise en place', ['SetName'], (ctx, me) => { if (!bool(ctx, 'bSpectator')) ctx.s.players[me].name = str(ctx, 'sName'); });
def('mise en place', ['MakeEmptyDeckList'], (ctx, me) => {
  ctx.s.players[me].zones.deck = Array.from({ length: num(ctx, 'iDeckSize') }, () => newCard(ctx, ''));
});
def('mise en place', ['LoadDeckCard'], (ctx, me) => {
  const deck = zoneOf(ctx, me, 'deck'), i = num(ctx, 'iIdx', -1);
  if (i < 0) { fail(ctx, 'indice absent'); return; }
  while (deck.length <= i) deck.push(newCard(ctx, ''));
  deck[i].code = str(ctx, 'sCardID');
});
def('mise en place', ['LoadLeader'], (ctx, me) => {
  const p = ctx.s.players[me];
  p.leader.code = str(ctx, 'sCardID');
  if (str(ctx, 'sPlayerName')) p.name = str(ctx, 'sPlayerName');
  const max = ctx.opts.stats?.(p.leader.code)?.maxDon;
  if (max !== undefined && max < 10) while (p.zones.donDeck.length > max) p.zones.donDeck.shift();
});
def('mise en place', ['ChooseTurnOrder'], (ctx, me, opp) => {
  // iFirst est vu du joueur qui reçoit la RPC : 0 = lui (l'autre), 1 = l'envoyeur.
  const first = num(ctx, 'iFirst') === 1 ? me : opp;
  ctx.s.first = first; ctx.s.turnPlayer = first; ctx.s.actingPlayer = first; ctx.s.turn = 1;
});

// Deck, main, défausse, terrain, scène
both('déplacement', ['DrawCard'], ['OpponentDrawCard', 'DrawCardOpponent'], (ctx, s) => repeat(num(ctx, 'iCount'), () => move(ctx, s, 'deck', 'top', 'hand', 'top')));
def('déplacement', ['DrawSpecificCard'], (ctx, me) => { move(ctx, me, 'deck', num(ctx, 'iCardIndex'), 'hand', 'top'); });
def('déplacement', ['DrawCardFromDeck'], (ctx, me) => { move(ctx, me, 'deck', num(ctx, 'iDeckIdx'), 'hand', 'top'); });
def('déplacement', ['DrawCardFromTrash'], (ctx, me) => { move(ctx, me, 'trash', num(ctx, 'iTrashIdx'), 'hand', 'top'); });
def('déplacement', ['MillCard'], (ctx, me) => repeat(num(ctx, 'iCount'), () => move(ctx, me, 'deck', 'top', 'trash', 'top')));
def('déplacement', ['MoveDeckCardToTrash'], (ctx, me) => { move(ctx, me, 'deck', num(ctx, 'iCardIndex'), 'trash', 'top'); });
def('déplacement', ['MoveDeckCardToTop'], (ctx, me) => { move(ctx, me, 'deck', num(ctx, 'iCardIndex'), 'deck', 'top'); });
def('déplacement', ['MoveDeckCardToBottom'], (ctx, me) => { move(ctx, me, 'deck', num(ctx, 'iCardIndex'), 'deck', 'bottom'); });
def('déplacement', ['MoveDeckCardToStage'], (ctx, me) => { move(ctx, me, 'deck', num(ctx, 'iIdx'), 'stage', 'top'); });
both('déplacement', ['PlayCardFromDeck'], ['OpponentPlayCardFromDeck'], (ctx, s) => { move(ctx, s, 'deck', num(ctx, 'iCardIndex'), 'deploy', 'top', { rested: bool(ctx, 'bRested') }); });
both('déplacement', ['MoveHandToDeck'], ['MoveOpponentHandToDeck'], (ctx, s) => { while (zoneOf(ctx, s, 'hand').length) move(ctx, s, 'hand', 0, 'deck', 'top'); });
def('déplacement', ['MoveHandCardToDeckTop'], (ctx, me) => { move(ctx, me, 'hand', num(ctx, 'iCardIdx'), 'deck', 'top'); });
both('déplacement', ['MoveHandCardToDeckBottom'], ['MoveOppHandCardToDeckBottom'], (ctx, s) => { move(ctx, s, 'hand', num(ctx, 'iCardIdx'), 'deck', 'bottom'); });
both('déplacement', ['MoveHandCardToDiscard'], ['MoveOpponentHandCardToDiscard'], (ctx, s) => { move(ctx, s, 'hand', num(ctx, 'iCardIdx'), 'trash', 'top'); });
def('déplacement', ['MoveHandCardToDeploy'], (ctx, me) => { move(ctx, me, 'hand', num(ctx, 'iIdx'), 'deploy', 'top', { rested: bool(ctx, 'bRested') }); });
def('déplacement', ['MoveHandCardToStage'], (ctx, me) => { move(ctx, me, 'hand', num(ctx, 'iIdx'), 'stage', 'top'); });
def('déplacement', ['MoveTrashCardToDeploy'], (ctx, me) => { move(ctx, me, 'trash', num(ctx, 'iIdx'), 'deploy', 'top', { rested: bool(ctx, 'bRested') }); });
def('déplacement', ['MoveTrashCardToStage'], (ctx, me) => { move(ctx, me, 'trash', num(ctx, 'iIdx'), 'stage', 'top'); });
both('déplacement', ['MoveTrashCardToDeckBottom'], ['MoveOppTrashCardToDeckBottom'], (ctx, s) => { move(ctx, s, 'trash', num(ctx, 'iCardIdx'), 'deck', 'bottom'); });
both('déplacement', ['ReturnCardToMyHand'], ['ReturnCardToOpponentsHand'], (ctx, s) => { move(ctx, s, 'deploy', num(ctx, 'iDeployIdx'), 'hand', 'top'); });
both('déplacement', ['ReturnCardToMyDeckBottom'], ['ReturnCardToOpponentsDeckBottom'], (ctx, s) => { move(ctx, s, 'deploy', num(ctx, 'iDeployIdx'), 'deck', 'bottom'); });
both('déplacement', ['DiscardFromSelfDeploy'], ['DiscardFromDeploy'], (ctx, s) => {
  const i = num(ctx, 'iCardIndex');
  if (i === -1) fail(ctx, 'le leader ne va pas en défausse'); else move(ctx, s, 'deploy', i, 'trash', 'top');
});
both('déplacement', ['MoveStageCardToHand'], ['MoveOppStageCardToHand'], (ctx, s) => { if (zoneOf(ctx, s, 'stage').length) move(ctx, s, 'stage', 0, 'hand', 'top'); });
both('déplacement', ['MoveStageCardToTrash'], ['MoveOpponentStageCardToTrash'], (ctx, s) => { if (zoneOf(ctx, s, 'stage').length) move(ctx, s, 'stage', 0, 'trash', 'top'); });
both('déplacement', ['MoveStageCardToDeckBottom'], ['MoveOpponentStageCardToDeckBottom'], (ctx, s) => { if (zoneOf(ctx, s, 'stage').length) move(ctx, s, 'stage', 0, 'deck', 'bottom'); });
both('déplacement', ['ShuffleDeck'], ['ShuffleOpponentDeck'], (ctx, s) => {
  const order = permute(ctx, zoneOf(ctx, s, 'deck'), str(ctx, 's_ShuffleString'));
  if (order) ctx.out.push({ kind: 'shuffle', player: s, order });
});
both('déplacement', ['ShuffleHand'], ['ShuffleOpponentHand'], (ctx, s) => { permute(ctx, zoneOf(ctx, s, 'hand'), str(ctx, 's_ShuffleString')); });
def('déplacement', ['ChangeCardDefinition'], (ctx, me) => {
  const c = zoneOf(ctx, me, 'hand')[num(ctx, 'iCardIndex')];
  if (c) c.code = str(ctx, 'sDef'); else fail(ctx, 'pas de carte en main à cet indice');
});
def('déplacement', ['ZoroDon'], (ctx, me) => {
  const c = move(ctx, me, 'hand', num(ctx, 'iHandIdx'), 'donCost', 'top');
  if (c) c.code = DON;
});

// Vies
both('vies', ['PopulateLifeDeck'], ['PopulateOpponentLifeDeck'], (ctx, s) => repeat(num(ctx, 'iLifeCount'), () => move(ctx, s, 'deck', 'top', 'life', 'top')));
both('vies', ['SendDeckToLife'], ['SendOpponentDeckToLife'], (ctx, s) => { move(ctx, s, 'deck', 'top', 'life', 'top'); });
def('vies', ['SendDeckToBottomLife'], (ctx, me) => { move(ctx, me, 'deck', 'top', 'life', 'bottom'); });
def('vies', ['MoveSpecificDeckCardToLife'], (ctx, me) => { move(ctx, me, 'deck', num(ctx, 'iCardIndex'), 'life', 'top', { faceUp: bool(ctx, 'bForceFaceUp') }); });
both('vies', ['PlayerDrawLife'], ['OpponentDrawLife'], (ctx, s) => repeat(num(ctx, 'iCount'), () => move(ctx, s, 'life', 'top', 'hand', 'top')));
def('vies', ['PlayerDrawBottomLife'], (ctx, me) => repeat(num(ctx, 'iCount'), () => move(ctx, me, 'life', 0, 'hand', 'top')));
both('vies', ['TrashLife'], ['TrashOpponentLife'], (ctx, s) => repeat(num(ctx, 'iCount'), () => move(ctx, s, 'life', 'top', 'trash', 'top')));
def('vies', ['TrashBottomLife'], (ctx, me) => repeat(num(ctx, 'iCount'), () => move(ctx, me, 'life', 0, 'trash', 'top')));
def('vies', ['TrashSpecificLife'], (ctx, me) => { move(ctx, me, 'life', num(ctx, 'iIdx'), 'trash', 'top'); });
def('vies', ['BottomDeckOpponentLife'], (ctx, _me, opp) => repeat(num(ctx, 'iCount'), () => move(ctx, opp, 'life', 0, 'deck', 'bottom')));
def('vies', ['MoveLifeToDeck'], (ctx, me) => { move(ctx, me, 'life', num(ctx, 'iLifeIdx'), 'deck', 'top'); });
both('vies', ['MoveMyLifeToTop'], ['MoveOpponentLifeToTop'], (ctx, s) => { move(ctx, s, 'life', num(ctx, 'iLifeIdx'), 'life', 'top', { faceUp: zoneOf(ctx, s, 'life')[num(ctx, 'iLifeIdx')]?.faceUp }); });
both('vies', ['MoveMyTopLifeBottom'], ['MoveOpponentTopLifeBottom'], (ctx, s) => {
  const z = zoneOf(ctx, s, 'life');
  if (z.length) move(ctx, s, 'life', 'top', 'life', 'bottom', { faceUp: z[z.length - 1].faceUp });
});
both('vies', ['SendDeployCardToMyLife'], ['SendDeployCardToOpponentLife'], (ctx, s) => {
  move(ctx, s, 'deploy', num(ctx, 'iDeployIdx'), 'life', bool(ctx, 'bTop') ? 'top' : 'bottom', { faceUp: bool(ctx, 'bForceFaceUp') });
});
def('vies', ['SendTrashCardToMyLife'], (ctx, me) => { move(ctx, me, 'trash', num(ctx, 'iTrashIdx'), 'life', 'top', { faceUp: bool(ctx, 'bForceFaceUp') }); });
def('vies', ['SendHandCardToMyLife'], (ctx, me) => {
  move(ctx, me, 'hand', num(ctx, 'iHandIdx'), 'life', bool(ctx, 'bTop') ? 'top' : 'bottom', { faceUp: bool(ctx, 'bForceFaceUp') });
});
def('vies', ['PlayCardFromLife'], (ctx, me) => { move(ctx, me, 'life', num(ctx, 'iLifeIndex'), 'deploy', 'top', { rested: bool(ctx, 'bRested') }); });
const faceUp = (ctx: Ctx, c: MirrorCardX | undefined, up: boolean) => { if (!c) fail(ctx, 'pas de vie à cet indice'); else if (up) c.faceUp = true; else delete c.faceUp; };
def('vies', ['RevealTopLife'], (ctx, me) => { const z = zoneOf(ctx, me, 'life'); faceUp(ctx, z[z.length - 1], true); });
def('vies', ['FlipLifeUp'], (ctx, me) => { const z = zoneOf(ctx, me, 'life'); for (let k = 0; k < num(ctx, 'iCount'); k++) faceUp(ctx, z[z.length - 1 - k], true); });
def('vies', ['FlipBotLifeUp'], (ctx, me) => { const z = zoneOf(ctx, me, 'life'); for (let k = 0; k < num(ctx, 'iCount'); k++) faceUp(ctx, z[k], true); });
def('vies', ['FlipLifeDown'], (ctx, me) => { faceUp(ctx, zoneOf(ctx, me, 'life')[num(ctx, 'iLifeIdx')], false); });

// DON
both('DON', ['DrawDon'], ['DrawDonForOpponent'], (ctx, s) => repeat(num(ctx, 'iCount'), () => move(ctx, s, 'donDeck', 'top', 'donCost', 'top', { rested: false })));
both('DON', ['DrawRestedDon'], ['DrawRestedDonForOpponent'], (ctx, s) => repeat(num(ctx, 'iCount'), () => move(ctx, s, 'donDeck', 'top', 'donCost', 'bottom', { rested: true })));
both('DON', ['TapDon'], ['TapOpponentDon'], (ctx, s) => tapDon(ctx, s, num(ctx, 'iCount')));
def('DON', ['UntapDon'], (ctx, me) => untapDon(ctx, me, num(ctx, 'iCount')));
def('DON', ['ReturnDon'], (ctx, me) => { move(ctx, me, 'donCost', num(ctx, 'iDonIdx'), 'donDeck', 'top'); });
both('DON', ['AttachDonToCard'], ['AttachDonToEnemyCard'], (ctx, s) => attachDon(ctx, s, num(ctx, 'iCardIdx'), num(ctx, 'iDonIdx')));
def('DON', ['AttachRestedDon', 'AttachEnemyRestedDon'], (ctx, me, opp) => {
  const enemy = baseName(ctx.rpc) === 'AttachEnemyRestedDon', s = enemy ? opp : me;
  for (let k = 0; k < num(ctx, 'iDonCount'); k++) {
    const i = findRestedDon(ctx, s, !enemy);
    if (i < 0) { fail(ctx, 'pas de DON inclinée à attacher'); break; }
    attachDon(ctx, s, num(ctx, 'iCardIdx'), i);
  }
});
def('DON', ['DetachDonFromCard'], (ctx, me) => detachDon(ctx, me, num(ctx, 'iCardIdx'), num(ctx, 'iDonIdx'), 'donCost'));
def('DON', ['ReturnDonFromCard'], (ctx, me) => detachDon(ctx, me, num(ctx, 'iCardIdx'), num(ctx, 'iDonIdx'), 'donDeck'));
def('DON', ['TransferAttachedDon'], (ctx, me) => {
  const from = target(ctx, me, num(ctx, 'iSourceIdx')), to = target(ctx, me, num(ctx, 'iCardIdx'));
  if (!from || !to || !from.attachedDon) { fail(ctx, 'pas de DON à transférer'); return; }
  from.attachedDon--; if (!from.attachedDon) delete from.attachedDon;
  to.attachedDon = (to.attachedDon ?? 0) + 1;
  ctx.out.push({ kind: 'detachDon', player: me, target: num(ctx, 'iSourceIdx'), donIndex: 0, to: 'donCost', rested: true });
  ctx.out.push({ kind: 'attachDon', player: me, target: num(ctx, 'iCardIdx'), donIndex: 0, rested: true });
});
both('DON', ['FreezeSelfDonCard'], ['FreezeOpponentDonCard'], (ctx, s) => {
  const z = zoneOf(ctx, s, 'donCost');
  const d = z.find((x) => x.rested && !x.frozen) ?? z.find((x) => x.rested);
  if (d) d.frozen = true; else fail(ctx, 'pas de DON inclinée à geler');
});

// Inclinaison
both('inclinaison', ['TapCard'], ['TapOpponentCard'], (ctx, s) => {
  const i = num(ctx, 'iCardIndex');
  setRest(ctx, s, i === -1 ? 'leader' : 'deploy', Math.max(i, 0), target(ctx, s, i), true);
});
both('inclinaison', ['UntapCard'], ['UntapOpponentCard'], (ctx, s) => {
  const i = num(ctx, 'iCardIndex');
  setRest(ctx, s, i === -1 ? 'leader' : 'deploy', Math.max(i, 0), target(ctx, s, i), false);
});
both('inclinaison', ['TapStageCard'], ['TapOpponentStageCard'], (ctx, s) => setRest(ctx, s, 'stage', 0, zoneOf(ctx, s, 'stage')[0], true));
both('inclinaison', ['UntapStage'], ['UntapOpponentStage'], (ctx, s) => { const c = zoneOf(ctx, s, 'stage')[0]; if (c) setRest(ctx, s, 'stage', 0, c, false); });
both('inclinaison', ['FreezeCard'], ['FreezeOpponentCard'], (ctx, s) => { const c = target(ctx, s, num(ctx, 'iCardIndex')); if (c) c.frozen = true; });
def('inclinaison', ['FreezeOpponentStageCard'], (ctx, _me, opp) => { const c = zoneOf(ctx, opp, 'stage')[0]; if (c) c.frozen = true; });

// Bonus de puissance et de coût (iCardIndex / iDeployIdx : -1 = leader)
const power = (until: Expiry, base = false) => (ctx: Ctx, s: Seat) => addMod(ctx, s, num(ctx, 'iCardIndex'), 'power', num(ctx, 'iBuff'), until, base);
both('bonus', ['BuffCardPower'], ['BuffOpponentCardPower'], power('turn'));
both('bonus', ['BuffCardCombat'], ['BuffOpponentCardCombat'], power('battle'));
def('bonus', ['BuffCardCombatBase'], (ctx, me) => power('battle', true)(ctx, me));
both('bonus', ['BuffCardToOppEnd'], ['BuffOpponentCardToOppEnd'], power('oppEnd'));
both('bonus', ['BuffCardToOwnersEnd'], ['BuffOpponentCardToOwnersEnd'], power('ownersEnd'));
both('bonus', ['BuffCardToStart'], ['BuffOpponentCardToStart'], power('start'));
both('bonus', ['ModifyCardBasePower'], ['ModifyOppCardBasePower'], power('field', true));
both('bonus', ['ChangeCardBasePower'], ['ChangeOppCardBasePower'], (ctx, s) => setMod(ctx, s, num(ctx, 'iCardIndex'), 'power', num(ctx, 'iBuff'), 'field', true, true));
def('bonus', ['ChangeCardBasePowerToStart'], (ctx, me) => power('start', true)(ctx, me));
both('bonus', ['ChangeCardBasePowerToOppEnd'], ['ChangeOpponentBasePowerToOppEnd'], power('oppEnd', true));
both('bonus', ['SetMyCardCost'], ['SetCardCost'], (ctx, s) => {
  const i = num(ctx, 'iDeployIdx'), c = target(ctx, s, i);
  if (c?.mods?.some((m) => m.kind === 'cost' && m.until === 'oppEnd')) setMod(ctx, s, i, 'cost', 0, 'oppEnd', false);
  setMod(ctx, s, i, 'cost', num(ctx, 'iChange'), 'field', false);
});
both('bonus', ['ChangeMyCardCost'], ['ChangeOpponentCardCost'], (ctx, s) => addMod(ctx, s, num(ctx, 'iDeployIdx'), 'cost', num(ctx, 'iChange'), 'field'));
def('bonus', ['ChangeCardCostToOppEnd'], (ctx, me) => addMod(ctx, me, num(ctx, 'iDeployIdx'), 'cost', num(ctx, 'iChange'), 'oppEnd'));

// Statuts accordés par effet : notés sur la carte sous le nom de la variante « My » (le moteur joy-boy les recalcule
// avec ses propres effets ; le miroir s'en sert seulement pour le combat : Banish, Double Attack, immunités).
const FLAG_RPCS: [string, string?][] = [
  ['GrantCardImmune', 'GrantOpponentCardImmune'], ['GrantCardCombatImmuneToEnd'], ['GrantCardCombatImmuneToStart'],
  ['GrantCardCombatImmune'], ['SilenceCardToOwnersEnd', 'SilenceOpponentCardToOwnersEnd'], ['GrantCharRushCard', 'GrantCharRushOpponentCard'],
  ['GrantCharStrikeType'], ['RogerSilenceCard', 'RogerSilenceOpponentCard'], ['SilenceCard', 'SilenceOpponentCard'], ['GrantCardTempBanish'],
  ['GrantCardTempDoubleAttack'], ['GrantCardBanish'], ['GrantCardUnblockable'], ['GrantCardBlocker'], ['GrantCardLoseBlocker'],
  ['GrantCardBlockerToOppEnd', 'GrantOppCardBlockerToOppEnd'], ['GrantCardDoubleAttack'], ['SetMyConfusion', 'SetOpponentConfusion'],
  ['SetMyCantUseOnPlay', 'SetOpponentCantUseOnPlay'], ['SetMyCantAttack', 'SetOpponentCantAttack'],
  ['SetMyCantDrawFromEffects', 'SetOpponentCantDrawFromEffects'], ['SetMyCantRest', 'SetOpponentCantRest'], ['SetCharacterEffectImmune'],
  ['SetGlobalEphemeral'],
];
const flagValue = (ctx: Ctx): unknown => {
  const k = Object.keys(ctx.v).find((x) => x !== 'iDeployIdx' && x !== 'clientId');
  return k === undefined ? true : ctx.v[k];
};
// GrantCardLoseBlocker agit sur un Personnage adverse malgré son nom (OppositePlayerState dans le jeu).
def('statut', ['GrantCardLoseBlocker'], (ctx, _me, opp) => setFlag(ctx, opp, num(ctx, 'iDeployIdx'), 'GrantCardLoseBlocker', flagValue(ctx)));
for (const [mine, theirs] of FLAG_RPCS) {
  if (mine === 'GrantCardLoseBlocker') continue;
  both('statut', [mine], theirs ? [theirs] : [], (ctx, s) => setFlag(ctx, s, num(ctx, 'iDeployIdx'), mine, flagValue(ctx)));
}
both('statut', ['GrantEffectToCard'], ['GrantEffectToOpponentCard'], (ctx, s) => setFlag(ctx, s, num(ctx, 'iTargetDeployIdx'), 'GrantEffectToCard', ctx.v.giverStepResolver ?? true));
def('statut', ['TellLeaderCharacterKOd'], (ctx) => { ctx.s.players[ctx.s.turnPlayer].leader.flags = { ...ctx.s.players[ctx.s.turnPlayer].leader.flags, OppCharacterKOd: true }; });
def('statut', ['TellOpponentLeaderCharacterKOd'], (ctx) => { const p = ctx.s.players[other(ctx.s.turnPlayer)]; p.leader.flags = { ...p.leader.flags, OppCharacterKOd: true }; });
def('statut', ['SetNoDrawFromLife', 'SetGlobalTenacity', 'SetAllCharactersImmune'], (ctx, me) => {
  const p = ctx.s.players[me], k = baseName(ctx.rpc), v = flagValue(ctx);
  if (v === false) { if (p.flags) delete p.flags[k]; } else (p.flags ??= {})[k] = v;
});
both('statut', ['SetCardAbilityUsed'], ['SetOpponentCardAbilityUsed'], (ctx, s) => {
  const c = target(ctx, s, num(ctx, 'iCardIndex'));
  if (c && !(c.used ??= []).includes(num(ctx, 'iActionIdx'))) c.used.push(num(ctx, 'iActionIdx'));
});
both('statut', ['SetStageAbilityUsed'], ['SetOpponentStageAbilityUsed'], (ctx, s) => {
  const i = num(ctx, 'iStageIndex'), c = i === -1 ? ctx.s.players[s].leader : zoneOf(ctx, s, 'stage')[i];
  if (!c) { fail(ctx, 'pas de scène à cet indice'); return; }
  if (!(c.used ??= []).includes(num(ctx, 'iActionIdx'))) c.used.push(num(ctx, 'iActionIdx'));
});
def('sans effet', ['RevealHandCard', 'RevealDeckCard', 'RevealOppDeckCard', 'RevealTopCard'], () => {}); // affichage seulement

// Combat
def('combat', ['SetupAttack'], (ctx, me, opp) => {
  const a = target(ctx, me, num(ctx, 'iAttackerIdx')), d = target(ctx, opp, num(ctx, 'iDefenderIdx'));
  if (!a || !d) return;
  ctx.s.battle = { attacker: { seat: me, iid: a.iid }, defender: { seat: opp, iid: d.iid }, counter: 0 };
  ctx.s.actingPlayer = opp;
});
def('combat', ['SetBlocker'], (ctx, me) => {
  const i = num(ctx, 'iBlockerIdx'), c = target(ctx, me, i);
  if (!c) return;
  if (ctx.s.battle) ctx.s.battle.defender = { seat: me, iid: c.iid }; else fail(ctx, 'bloqueur sans attaque');
  setRest(ctx, me, i === -1 ? 'leader' : 'deploy', Math.max(i, 0), c, true);
});
def('combat', ['SetNewDefender'], (ctx) => {
  const b = ctx.s.battle;
  if (!b) { fail(ctx, 'pas d’attaque en cours'); return; }
  const c = target(ctx, b.defender.seat, num(ctx, 'iDefenderIdx'));
  if (c) b.defender = { seat: b.defender.seat, iid: c.iid };
});
def('combat', ['AddCounterAmount'], (ctx) => { if (ctx.s.battle) ctx.s.battle.counter += num(ctx, 'iCounter'); else fail(ctx, 'contre sans attaque'); });
def('combat', ['SetCounterAmount'], (ctx) => { if (ctx.s.battle) ctx.s.battle.counter = num(ctx, 'iCounter'); else fail(ctx, 'contre sans attaque'); });
def('combat', ['ResolveAttack'], (ctx) => resolveAttack(ctx));
def('combat', ['ResolveNoAttack', 'ResolveNoAttackFromAttackerSide'], (ctx) => { const b = ctx.s.battle; endBattle(ctx); if (b) ctx.s.actingPlayer = b.attacker.seat; });
def('combat', ['SwitchTurns'], (ctx) => { ctx.s.actingPlayer = other(ctx.s.actingPlayer); });
// Étapes du combat sans effet sur la table (le combat, tâche O2.3, s'en sert pour savoir où en est l'attaque).
def('sans effet', ['ResetCounterPhase', 'ResetActionPhase', 'NoBlocker', 'SelectBlocker', 'MoveToBlocker', 'EnterBlockPhase', 'EnterTriggerPhase',
  'DoNoTrigger', 'TellOpponentImResolving', 'AllOnKOResolved', 'NoMorePendingActions', 'QueueCurrentPlayerKOQueue', 'QueueOpponentPlayerKOQueue',
  'QueueCurrentPlayerSaveQueue', 'QueueOpponentPlayerSaveQueue', 'CheckForKOdCharacterEffects', 'MoveToSecondLifeTrigger', 'SetOpponentLostLifeFlag'], () => {});

// Tours et fin de partie
def('tour', ['EndTurn'], (ctx, me) => endTurn(ctx, me));
def('tour', ['AnotherTurn'], (ctx, me) => endTurn(ctx, me, true));
def('sans effet', ['AttemptingToEndTurn'], () => {});
def('tour', ['Concede'], (ctx, me) => { ctx.s.over ??= { loser: me, reason: 'abandon' }; });
def('tour', ['WinTheGameEffect'], (ctx, _me, opp) => { ctx.s.over ??= { loser: opp, reason: 'effet' }; });
def('tour', ['LoseTheGameEffect'], (ctx, me) => { ctx.s.over ??= { loser: me, reason: 'effet' }; });

// Sans effet sur la table : journal, discussion, chrono, profil, interface, demandes d'effets à l'autre joueur (ce
// dernier joue alors ses propres RPC de déplacement).
def('sans effet', ['InformVersionOverride', 'VersionMismatch', 'PlayerConnectMessage', 'AcceptCancelMatch', 'AcceptRestart', 'RequestCancelMatch',
  'RequestRestartTurn', 'ReadyForRematch', 'TattleOnMyself', 'RefreshLifePositions', 'StartPlayFromDeck', 'StartOfferDownsideAction',
  'StartOnKOActions', 'AddLogLineOpponent', 'AddChatLine', 'TranslateLogLine', 'AddLogLine', 'TriggerOpponentMultiActions',
  'TriggerOpponentActionFromDeployWithTarget', 'TriggerOpponentActionFromDeploy', 'TriggerOpponentActionFromLeaderWithSaveTarget',
  'TriggerOpponentActionFromLeader', 'ProcOpponentV3Action', 'TriggerOpponentActionFromTrash', 'ForceOpponentActionFromTrash',
  'BeginOpponentActionFromTrash', 'ForceOpponentActionFromDeploy', 'ForceOpponentActionFromOppositeDeploy', 'ForceMainPhaseAction',
  'SetMyTurnRoll', 'GameStart', 'SetSpectateGodMode', 'SetTimer'], () => {});

/** Famille d'une RPC (nom avec ou sans suffixe) ; undefined si le miroir ne la connaît pas. */
export function rpcFamily(name: string): Family | undefined {
  return H[baseName(name)]?.[0];
}

/** Toutes les RPC connues du miroir, par famille (pour le rapport de couverture). */
export function knownRpcs(): Record<string, Family> {
  return Object.fromEntries(Object.entries(H).map(([n, [f]]) => [n, f]));
}

/**
 * Applique une RPC d'OPTCGSim au miroir. `sender` = joueur propriétaire de l'objet réseau sur lequel la RPC est
 * appelée (celui qui a fait l'action). Accepte les deux formes (…ClientRpc reçue de l'hôte, …ServerRpc envoyée par
 * joy-boy) : c'est la même action. Rend un nouvel état et les mutations externes, dans l'ordre.
 */
export function applyRpc(state: Mirror, rpc: Rpc, sender: Seat, options: MirrorOptions = {}): ApplyResult {
  const s = cloneMirror(state);
  const ctx: Ctx = { s, out: [], opts: options, rpc: rpc.name, v: rpc.values ?? {} };
  const h = H[baseName(rpc.name)];
  if (!h) s.unhandled[baseName(rpc.name)] = (s.unhandled[baseName(rpc.name)] ?? 0) + 1;
  else h[1](ctx, sender, other(sender));
  for (const p of s.players) p.leader = p.zones.leader[0];
  return { state: s, externals: ctx.out };
}

/** Applique une suite de RPC ; rend l'état final et toutes les mutations. */
export function applyAll(state: Mirror, rpcs: Iterable<{ rpc: Rpc; sender: Seat }>, options: MirrorOptions = {}): ApplyResult {
  let s = state;
  const externals: MirrorExternal[] = [];
  for (const { rpc, sender } of rpcs) {
    const r = applyRpc(s, rpc, sender, options);
    s = r.state;
    externals.push(...r.externals);
  }
  return { state: s, externals };
}
