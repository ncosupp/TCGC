// joy-boy -> OPTCGSim (tâche O2.1) : traduit les changements d'état du moteur en RPC du jeu OPTCGSim.
//
// Principe : après chaque coup (ou chaque mutation externe à laquelle ses cartes réagissent), on compare le miroir des
// zones (mirror.ts, la table telle que le jeu adverse la voit) à l'état du moteur, et on produit les …ServerRpc qui
// amènent le miroir à l'état du moteur, dans l'ordre où le jeu les enverrait :
//   1. l'action principale du choix (jouer : TapDon, journal, MoveHandCardToDeploy ; donner une DON!! : journal,
//      AttachDonToCard ; Évènement : TapDon, MoveHandCardToDiscard...) ;
//   2. les conséquences, zone par zone : le terrain qui part, la main, la Défausse, la Vie, le deck (pioches, recherches,
//      mélange), l'ordre de la Vie, les DON!!, l'inclinaison, les bonus ;
//   3. la fin du tour (AttemptingToEndTurn, journal, EndTurn) quand le moteur a changé de tour.
// Chaque RPC produite est appliquée aussitôt à une copie du miroir (applyRpc, siège de l'envoyeur) : les indices
// (iIdx, iCardIndex, iDonIdx...) sont toujours calculés sur la table telle qu'elle sera au moment où le jeu les lira.
// La copie finale est rendue : elle doit être égale au moteur (compareMirror), c'est la vérification de la tâche.
//
// Cartes : le miroir désigne les cartes par position, le moteur par uid. bindUids pose sur chaque carte du miroir l'uid
// de la carte du moteur qui lui correspond (même position, sinon même code : deux exemplaires d'une carte cachée se
// valent). Le pont garde le miroir lié et y applique les échos (…ClientRpc) de l'hôte : les uids suivent les cartes.
//
// Hors de cette tâche : le combat (SetupAttack, SelectBlocker, NoBlocker, AddCounterAmount, ResolveAttack...) est fait
// par combat.ts (O2.3) ; ici, les conséquences d'un combat (carte épuisée pour attaquer, Vie perdue, KO, carte défaussée
// pour contrer) passent comme les autres changements d'état. Les effets du joueur OPTCGSim ne sont jamais traduits :
// son jeu les envoie lui-même (sa pioche, ses DON!!, son redressement).
import { def, handCost } from '../../engine/rules.ts';
import type { Card, FieldCard, GameState, Modifier } from '../../engine/types.ts';
import handshake from './handshake.json' with { type: 'json' };
import { applyRpc, cloneMirror, createMirror, DON, other, type Expiry, type Mirror, type MirrorCardX, type MirrorOptions, type MirrorPlayerX, type Modifier as MirrorModifier } from './mirror.ts';
import { rpcEntry } from './rpc.ts';
import type { Rpc, Seat, Zone } from './types.ts';

// ---------------------------------------------------------------------------------------------------- options

export interface OutboundOptions {
  /** Siège de celui qui envoie (le joueur joy-boy, 1 par défaut ; les tests s'en servent aussi pour l'autre siège). */
  seat?: Seat;
  /** État du moteur avant le coup : sert au coût payé, à la carte source des lignes de journal et aux bonus ajoutés. */
  before?: GameState;
  /** Choix qui a mené à cet état (« play:12 », « don:3 », « event:40 », « act:7 », « mulligan »...). */
  choice?: string;
  /**
   * 'all' (par défaut) : les zones de l'envoyeur et ce que ses effets font chez l'adversaire (KO, renvoi en main, Vie,
   * DON!! épuisées, bonus) ; 'self' : seulement ses propres zones.
   */
  scope?: 'all' | 'self';
  /** Lignes de journal (AddLogLine, que l'hôte relaie en TranslateLogLine) : oui par défaut. */
  logs?: boolean;
  /** Objet réseau du joueur qui envoie (synchro de scène ; 2 dans les fixtures) et comportement (0). */
  object?: number;
  behaviour?: number;
  /** Options du miroir (stats des cartes : nombre de DON!! des Leaders...), passées à applyRpc. */
  mirror?: MirrorOptions;
  /**
   * Fin de tour en deux temps (tâche O5.6, audit T3) : la ligne « Log.EndTurn » et `EndTurn` ne vont pas dans `rpcs`
   * mais dans `endTurn`, que la session envoie plus tard (quand l'hôte n'a pas pris la main pendant la fin du tour, ou
   * l'a rendue). Le miroir rendu ne les contient pas (la table telle qu'OPTCGSim la voit pendant la fin du tour) : la
   * session les y pose à l'envoi. Sans effet sur un tour en plus (`AnotherTurn`).
   */
  holdEndTurn?: boolean;
  /**
   * La fin du tour de l'envoyeur est déjà partie (AttemptingToEndTurn envoyé, EndTurn retenu) : le moteur est au tour
   * suivant, pas encore le miroir ; seules les conséquences sont traduites, pas une seconde fin de tour.
   */
  endTurnUnderway?: boolean;
}

export interface OutboundResult {
  /** …ServerRpc à envoyer, dans l'ordre. */
  rpcs: Rpc[];
  /** Le miroir après ces RPC (lié aux uids du moteur) : égal au moteur si `problems` est vide. */
  mirror: Mirror;
  /** `holdEndTurn` : la fin du tour retenue (journal, EndTurn), à envoyer après `rpcs`. */
  endTurn?: Rpc[];
  /** Ce qui n'a pas pu être traduit (aucune RPC du jeu ne le fait) ou ce que le miroir a refusé. */
  problems: string[];
}

// ---------------------------------------------------------------------------------------------------- vue du moteur

/** Zones qui contiennent des cartes (pas les DON!!). */
type CardZone = Exclude<Zone, 'donDeck' | 'donCost'>;
const CARD_ZONES: readonly CardZone[] = ['deck', 'hand', 'life', 'trash', 'deploy', 'stage', 'leader'];
const FIELD_ZONES: ReadonlySet<CardZone> = new Set(['deploy', 'stage', 'leader']);

/** Les zones du moteur dans l'ordre du miroir : deck et Vie du dessous vers le dessus (dessus = dernier). */
type View = Record<CardZone, Card[]>;
interface Loc { zone: CardZone; index: number; card: Card }

/**
 * La Vie qu'un joueur a déjà posée chez OPTCGSim alors que le moteur ne la pose qu'après les deux mains de départ
 * (5-2-1-7) : le jeu pose la sienne dès qu'il garde ou repioche. Tant que le moteur est à l'étape des mains, ces cartes
 * comptent comme déjà en Vie (les n cartes du dessus du deck, la n-ième au-dessus).
 */
function lifePending(e: GameState, seat: Seat, mirrorLife: number, decided: boolean): boolean {
  if (e.flow.stage !== 'mulligan' || e.players[seat].life.length) return false;
  if (mirrorLife > 0 || decided) return true;
  return seat === e.first && e.flow.player !== seat;
}

const leaderLife = (num: string): number => {
  try { return def(num).life ?? 5; } catch { return 5; }
};

function viewOf(e: GameState, seat: Seat, pendingLife: boolean): View {
  const P = e.players[seat];
  let deck = [...P.deck];
  let life = [...P.life].reverse();
  if (pendingLife) {
    const n = Math.min(leaderLife(P.leader.num), deck.length);
    life = deck.slice(0, n);
    deck = deck.slice(n);
  }
  return {
    deck: deck.reverse(), hand: [...P.hand], life, trash: [...P.trash], deploy: [...P.chars],
    stage: P.stage ? [P.stage] : [], leader: [P.leader],
  };
}

function locations(v: View): Map<number, Loc> {
  const m = new Map<number, Loc>();
  for (const zone of CARD_ZONES) v[zone].forEach((card, index) => m.set(card.uid, { zone, index, card }));
  return m;
}

// ---------------------------------------------------------------------------------------------------- liaison des uids

/**
 * Pose sur les cartes du miroir les uids des cartes du moteur (copie) : même zone et même position d'abord, puis même
 * zone et même code, puis même code ailleurs (deck chargé avant le mélange et la pioche de départ).
 */
export function bindUids(mirror: Mirror, engine: GameState, pending: [boolean, boolean] = [false, false]): Mirror {
  const w = cloneMirror(mirror);
  for (const seat of [0, 1] as const) bindSeat(w, engine, seat, viewOf(engine, seat, pending[seat]));
  return w;
}

function bindSeat(w: Mirror, e: GameState, seat: Seat, v: View) {
  const p = w.players[seat];
  p.leader.uid = e.players[seat].leader.uid;
  const used = new Set<number>([p.leader.uid]);
  for (const zone of CARD_ZONES) for (const c of p.zones[zone]) if (c.uid !== undefined) used.add(c.uid);
  const free = (c: Card) => !used.has(c.uid);
  const take = (m: MirrorCardX, c: Card | undefined) => {
    if (!c || !free(c) || (m.code && m.code !== c.num)) return false;
    m.uid = c.uid;
    if (!m.code) m.code = c.num;
    used.add(c.uid);
    return true;
  };
  const zones = CARD_ZONES.filter((z) => z !== 'leader');
  for (const zone of zones) p.zones[zone].forEach((m, i) => { if (m.uid === undefined) take(m, v[zone][i]); });
  for (const zone of zones) for (const m of p.zones[zone]) if (m.uid === undefined) take(m, v[zone].find((c) => free(c) && c.num === m.code));
  const everywhere = zones.flatMap((z) => v[z]);
  for (const zone of zones) for (const m of p.zones[zone]) if (m.uid === undefined) take(m, everywhere.find((c) => free(c) && c.num === m.code));
}

// ---------------------------------------------------------------------------------------------------- miroir du moteur

/** Classe d'échéance du miroir pour une modification du moteur (`until`), vue du tour `turn` joué par `active`. */
export function expiryOf(until: Modifier['until'], owner: Seat, turn: number, active: Seat): Expiry | undefined {
  if (until === 'battle') return 'battle';
  if (until === 'turn' || until === turn) return 'turn';
  if (typeof until !== 'number' || until < turn) return undefined;
  const playerAt = (until - turn) % 2 === 0 ? active : other(active);
  return playerAt === owner ? 'ownersEnd' : 'oppEnd';
}

/**
 * Un miroir égal à l'état du moteur (uids liés) : pour reprendre une partie, et pour les tests. Les DON!! épuisées sont
 * en tête de la zone de coût, comme celles que le jeu y remet.
 */
export function mirrorFromEngine(e: GameState): Mirror {
  const s = createMirror();
  let iid = 1;
  const mk = (c: Card, extra: Partial<MirrorCardX> = {}): MirrorCardX => ({ code: c.num, uid: c.uid, iid: iid++, ...extra });
  const field = (c: FieldCard, seat: Seat): MirrorCardX => {
    const m = mk(c);
    if (c.rested) m.rested = true;
    if (c.don) m.attachedDon = c.don;
    const mods: MirrorModifier[] = [];
    for (const x of e.mods) {
      if (x.uid !== c.uid || (x.stat !== 'power' && x.stat !== 'cost')) continue;
      const until = expiryOf(x.until, seat, e.turn, e.active);
      if (until) mods.push({ kind: x.stat, delta: x.amount, until: x.stat === 'cost' && until !== 'oppEnd' ? 'field' : until });
    }
    if (mods.length) m.mods = mods;
    return m;
  };
  s.players = ([0, 1] as const).map((seat) => {
    const P = e.players[seat];
    const leader = field(P.leader, seat);
    leader.faceUp = true;
    const zones: MirrorPlayerX['zones'] = {
      deck: [...P.deck].reverse().map((c) => mk(c)),
      hand: P.hand.map((c) => mk(c)),
      life: [...P.life].reverse().map((c) => mk(c, c.faceUp ? { faceUp: true } : {})),
      deploy: P.chars.map((c) => field(c, seat)),
      stage: P.stage ? [field(P.stage, seat)] : [],
      leader: [leader],
      trash: P.trash.map((c) => mk(c)),
      donDeck: Array.from({ length: P.donDeck }, () => ({ code: DON, iid: iid++ })),
      donCost: [
        ...Array.from({ length: P.donRested }, () => ({ code: DON, iid: iid++, rested: true })),
        ...Array.from({ length: P.donActive }, () => ({ code: DON, iid: iid++ })),
      ],
    };
    return { name: P.name, leader, zones };
  }) as unknown as [MirrorPlayerX, MirrorPlayerX];
  s.turn = e.turn;
  s.turnPlayer = e.active;
  s.actingPlayer = e.decision?.player ?? e.active;
  s.first = e.first;
  s.nextIid = iid;
  return s;
}

// ---------------------------------------------------------------------------------------------------- comparaison

/**
 * Écarts entre le miroir et le moteur (vide : la table d'OPTCGSim est celle du moteur). Deck et Vie dans l'ordre (le
 * dessus compte), main, Défausse et terrain comme ensembles, état des cartes du terrain, DON!!, tour. `mods` : compare
 * aussi les bonus de puissance et de coût posés par effet (hors bonus « pendant ce combat », qui sont ceux du combat).
 */
export function compareMirror(mirror: Mirror, e: GameState, opts: { mods?: boolean; pending?: [boolean, boolean] } = {}): string[] {
  const out: string[] = [];
  // une carte que le moteur tient hors des zones (Vie révélée pendant son [Déclenchement]) n'est pas un écart
  const known = new Set([0, 1].flatMap((p) => [...locations(viewOf(e, p as Seat, false)).keys()]));
  const held = (c: { uid?: number }) => c.uid === undefined || known.has(c.uid) || (opts.pending?.some(Boolean) ?? false);
  const key = (c: { uid?: number; code?: string; num?: string }) => (c.uid !== undefined ? `#${c.uid}` : (c.code ?? c.num ?? '?'));
  for (const seat of [0, 1] as const) {
    const p = mirror.players[seat];
    const P = e.players[seat];
    const pending = opts.pending?.[seat] ?? lifePending(e, seat, p.zones.life.length, false);
    const v = viewOf(e, seat, pending);
    const say = (t: string) => out.push(`joueur ${seat} : ${t}`);
    for (const zone of ['deck', 'life'] as const) {
      const a = p.zones[zone].filter(held).map(key).join(' '), b = v[zone].map((c) => `#${c.uid}`).join(' ');
      if (a !== b) say(`${zone} [${a}] au lieu de [${b}]`);
    }
    p.zones.life.filter(held).forEach((c, i) => {
      if (Boolean(c.faceUp) !== Boolean(v.life[i]?.faceUp)) say(`Vie n° ${i} ${c.faceUp ? 'face visible' : 'face cachée'} à tort`);
    });
    for (const zone of ['hand', 'trash', 'deploy', 'stage'] as const) {
      const a = p.zones[zone].filter(held).map(key).sort().join(' '), b = v[zone].map((c) => `#${c.uid}`).sort().join(' ');
      if (a !== b) say(`${zone} {${a}} au lieu de {${b}}`);
    }
    const fieldPairs: [MirrorCardX, FieldCard][] = [[p.leader, P.leader]];
    for (const c of P.chars) { const m = p.zones.deploy.find((x) => x.uid === c.uid); if (m) fieldPairs.push([m, c]); }
    if (P.stage && p.zones.stage[0]?.uid === P.stage.uid) fieldPairs.push([p.zones.stage[0], P.stage]);
    for (const [m, c] of fieldPairs) {
      if (Boolean(m.rested) !== c.rested) say(`${c.num} ${m.rested ? 'épuisé' : 'redressé'} à tort`);
      if ((m.attachedDon ?? 0) !== c.don) say(`${c.num} : ${m.attachedDon ?? 0} DON!! au lieu de ${c.don}`);
      if (opts.mods) {
        for (const kind of ['power', 'cost'] as const) {
          const a = (m.mods ?? []).filter((x) => x.kind === kind && x.until !== 'battle').reduce((t, x) => t + x.delta, 0);
          const b = e.mods.filter((x) => x.uid === c.uid && x.stat === kind && x.until !== 'battle').reduce((t, x) => t + x.amount, 0);
          if (a !== b) say(`${c.num} : bonus de ${kind} ${a} au lieu de ${b}`);
        }
      }
    }
    const active = p.zones.donCost.filter((d) => !d.rested).length, rested = p.zones.donCost.length - active;
    if (active !== P.donActive || rested !== P.donRested) say(`DON!! ${active} redressée(s) et ${rested} épuisée(s) au lieu de ${P.donActive} et ${P.donRested}`);
    if (p.zones.donDeck.length !== P.donDeck) say(`deck DON!! ${p.zones.donDeck.length} au lieu de ${P.donDeck}`);
  }
  if (e.flow.stage !== 'mulligan' && e.flow.stage !== 'setup') {
    if (mirror.turn !== e.turn) out.push(`tour ${mirror.turn} au lieu de ${e.turn}`);
    else if (mirror.turnPlayer !== e.active) out.push(`tour du joueur ${mirror.turnPlayer} au lieu de ${e.active}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- mise en place

export interface SetupIdentity {
  name: string;
  /** Identifiant d'appareil et de joueur Unity annoncés par LoadLeader (le pont les tient de son identification). */
  deviceId?: string;
  playerId?: string;
  patron?: string;
  /** Tirage pour l'ordre du tour (0 : l'hôte gagne et choisit, comme le prototype). */
  roll?: number;
  /** Version annoncée (VersionCheck) : celle du catalogue par défaut ; null : pas de VersionCheck. */
  version?: string | null;
}

/**
 * Mise en place du joueur `seat` (GameStartMultiplayer + LoadMyDeck) : version, nom, deck vide, Leader, les cartes du
 * deck une par une (triées par code, comme une liste de deck : le mélange envoyé à l'ouverture donne l'ordre du moteur),
 * puis le tirage.
 */
export function setupRpcs(e: GameState, seat: Seat, who: SetupIdentity, target: { object?: number; behaviour?: number } = {}): Rpc[] {
  const P = e.players[seat];
  const cards = [...P.deck, ...P.hand, ...P.life, ...P.trash, ...P.chars, ...(P.stage ? [P.stage] : [])].map((c) => c.num).sort();
  const r = (base: string, values: Record<string, unknown> = {}) => makeRpc(base, values, target.object ?? 2, target.behaviour ?? 0);
  const version = who.version === undefined ? handshake.gameVersion : who.version;
  return [
    ...(version === null ? [] : [r('VersionCheck', { sVersion: version })]),
    r('SetName', { sName: who.name, bSpectator: false }),
    r('MakeEmptyDeckList', { iDeckSize: cards.length }),
    r('LoadLeader', { sCardID: P.leader.num, sPatron: who.patron ?? '', sDeviceID: who.deviceId ?? '', sPlayerName: who.name, sPlayerID: who.playerId ?? '' }),
    ...cards.map((code, i) => r('LoadDeckCard', { sCardID: code, iIdx: i })),
    r('SetMyTurnRoll', { iRoll: who.roll ?? 0 }),
  ];
}

// ---------------------------------------------------------------------------------------------------- planification

function makeRpc(base: string, values: Record<string, unknown>, object: number, behaviour: number): Rpc {
  const name = `${base}ServerRpc`;
  const entry = rpcEntry(name);
  if (!entry || entry.sens !== 'client->hote') throw new Error(`RPC absente du catalogue : ${name}`);
  for (const w of entry.ecritures) if (!(w.param in values)) throw new Error(`${name} : paramètre ${w.param} manquant`);
  return { name, object, behaviour, values };
}

/** Nom de carte tel que le jeu l'écrit dans son journal (CardName) : « Nom [<mark><link="code">code</link></mark>] ». */
export function cardName(code: string): string {
  let name = code;
  try { name = def(code).name; } catch { /* carte inconnue de joy-boy : son code */ }
  return `${name} [<mark><link="${code}">${code}</link></mark>]`;
}

interface Ctx {
  w: Mirror;
  e: GameState;
  me: Seat;
  out: Rpc[];
  problems: string[];
  logs: boolean;
  object: number;
  behaviour: number;
  mopts: MirrorOptions;
  views: [View, View];
  locs: [Map<number, Loc>, Map<number, Loc>];
  /** Carte dont l'effet cause les conséquences (code) : la carte jouée ou activée, ou la source de la question. */
  source?: string;
}

function send(ctx: Ctx, base: string, values: Record<string, unknown> = {}) {
  const rpc = makeRpc(base, values, ctx.object, ctx.behaviour);
  const n = ctx.w.errors.length;
  ctx.w = applyRpc(ctx.w, rpc, ctx.me, ctx.mopts).state;
  if (ctx.w.errors.length > n) ctx.problems.push(...ctx.w.errors.slice(n).map((x) => `miroir : ${x}`));
  ctx.out.push(rpc);
}

function logLine(ctx: Ctx, key: string, s1 = '', s2 = '', i1 = -999, i2 = -999) {
  if (ctx.logs) send(ctx, 'AddLogLine', { s: key, bPlayer: true, s1, s2, i1, i2 });
}

const mine = (ctx: Ctx, seat: Seat) => seat === ctx.me;
/** Nom de la variante d'une RPC : la sienne (« My ») ou celle qui vise l'adversaire. */
const pick = (ctx: Ctx, seat: Seat, own: string, opp: string | null): string | null => (mine(ctx, seat) ? own : opp);
const zoneOf = (ctx: Ctx, seat: Seat, zone: Zone): MirrorCardX[] => ctx.w.players[seat].zones[zone];
const indexIn = (ctx: Ctx, seat: Seat, zone: Zone, uid: number) => zoneOf(ctx, seat, zone).findIndex((c) => c.uid === uid);
const dest = (ctx: Ctx, seat: Seat, uid: number | undefined): Loc | undefined => (uid === undefined ? undefined : ctx.locs[seat].get(uid));
const engineCard = (ctx: Ctx, seat: Seat, uid: number | undefined) => dest(ctx, seat, uid)?.card;
const fieldIndex = (ctx: Ctx, seat: Seat, uid: number): number => (ctx.w.players[seat].leader.uid === uid ? -1 : indexIn(ctx, seat, 'deploy', uid));
/** Carte que le moteur tient hors des zones le temps d'une question (Vie révélée pour son [Déclenchement]). */
const limbo = (e: GameState, uid: number): boolean => ![0, 1].some((p) => locations(viewOf(e, p as Seat, false)).has(uid));
const srcName = (ctx: Ctx) => (ctx.source ? cardName(ctx.source) : '');

function cannot(ctx: Ctx, seat: Seat, what: string) {
  ctx.problems.push(`joueur ${seat} : ${what} (aucune RPC d'OPTCGSim ne le fait)`);
}

/** Première carte d'une zone du miroir dont la destination dans le moteur n'est pas cette zone. */
function nextLeaving(ctx: Ctx, seat: Seat, zone: CardZone, skip: Set<number>): { index: number; card: MirrorCardX; to: Loc | undefined } | undefined {
  const z = zoneOf(ctx, seat, zone);
  for (let index = z.length - 1; index >= 0; index--) {
    const card = z[index];
    if (card.uid === undefined || skip.has(card.uid)) continue;
    const to = dest(ctx, seat, card.uid);
    // carte hors de toute zone du moteur (carte de Vie révélée pendant son [Déclenchement]) : elle attend
    if (!to && limbo(ctx.e, card.uid)) continue;
    if (!to || to.zone !== zone) return { index, card, to };
  }
  return undefined;
}

// ---------- 1. Le terrain qui part (KO, renvoi en main, au deck, en Vie)

function fieldExits(ctx: Ctx, seat: Seat) {
  const skip = new Set<number>();
  for (let guard = 0; guard < 60; guard++) {
    const l = nextLeaving(ctx, seat, 'deploy', skip) ?? nextLeaving(ctx, seat, 'stage', skip);
    if (!l) return;
    const uid = l.card.uid!;
    const stage = zoneOf(ctx, seat, 'stage').includes(l.card);
    const to = l.to?.zone;
    const name = cardName(l.card.code);
    let base: string | null = null;
    let values: Record<string, unknown> = {};
    if (to === 'trash') {
      base = stage ? pick(ctx, seat, 'MoveStageCardToTrash', 'MoveOpponentStageCardToTrash') : pick(ctx, seat, 'DiscardFromSelfDeploy', 'DiscardFromDeploy');
      values = stage ? {} : { iCardIndex: l.index };
      if (base) { if (ctx.source && ctx.source !== l.card.code) logLine(ctx, 'Log.ActionDestroy', srcName(ctx), name); else logLine(ctx, 'Log.TrashCard', name); }
    } else if (to === 'hand') {
      base = stage ? pick(ctx, seat, 'MoveStageCardToHand', 'MoveOppStageCardToHand') : pick(ctx, seat, 'ReturnCardToMyHand', 'ReturnCardToOpponentsHand');
      values = stage ? {} : { iDeployIdx: l.index };
      if (base) logLine(ctx, mine(ctx, seat) ? 'Log.SelfToHand' : 'Log.OpponentToHand', srcName(ctx) || name, name);
    } else if (to === 'deck') {
      base = stage ? pick(ctx, seat, 'MoveStageCardToDeckBottom', 'MoveOpponentStageCardToDeckBottom') : pick(ctx, seat, 'ReturnCardToMyDeckBottom', 'ReturnCardToOpponentsDeckBottom');
      values = stage ? {} : { iDeployIdx: l.index };
      if (base) logLine(ctx, mine(ctx, seat) ? 'Log.ActionDeckBottomSelf' : 'Log.ActionDeckBottomOpponent', srcName(ctx) || name, name);
    } else if (to === 'life' && !stage) {
      base = pick(ctx, seat, 'SendDeployCardToMyLife', 'SendDeployCardToOpponentLife');
      const top = l.to!.index === ctx.views[seat].life.length - 1;
      values = { iDeployIdx: l.index, bForceFaceUp: l.to!.card.faceUp === true, bTop: top };
      if (base) logLine(ctx, top ? 'Log.AddCharacterToLife' : 'Log.AddCharacterToBottomLife', srcName(ctx) || name, name);
    }
    if (base) send(ctx, base, values);
    else { skip.add(uid); cannot(ctx, seat, `${l.card.code} du terrain vers ${to ?? 'nulle part'}`); }
  }
}

// ---------- 2. La main qui part (défausse, terrain, deck, Vie)

function handExits(ctx: Ctx, seat: Seat) {
  const hand = zoneOf(ctx, seat, 'hand');
  // toute la main vers le deck (mulligan, « mélangez votre main dans votre deck ») : MoveHandToDeck
  if (hand.length >= 2 && hand.every((c) => dest(ctx, seat, c.uid)?.zone === 'deck')) {
    send(ctx, pick(ctx, seat, 'MoveHandToDeck', 'MoveOpponentHandToDeck')!);
    return;
  }
  const skip = new Set<number>();
  for (let guard = 0; guard < 100; guard++) {
    const l = nextLeaving(ctx, seat, 'hand', skip);
    if (!l) return;
    const to = l.to;
    const name = cardName(l.card.code);
    let base: string | null = null;
    let values: Record<string, unknown> = {};
    if (to?.zone === 'trash') {
      base = pick(ctx, seat, 'MoveHandCardToDiscard', 'MoveOpponentHandCardToDiscard');
      values = { iCardIdx: l.index };
      if (ctx.source && ctx.source !== l.card.code) logLine(ctx, 'Log.ActionTrashCard', srcName(ctx), name); else logLine(ctx, 'Log.TrashCard', name);
    } else if (to?.zone === 'deploy' && mine(ctx, seat)) {
      base = 'MoveHandCardToDeploy';
      values = { iIdx: l.index, bRested: (to.card as FieldCard).rested === true };
      if (ctx.source && ctx.source !== l.card.code) logLine(ctx, 'Log.ActionDeploy', srcName(ctx), name); else logLine(ctx, 'Log.Deploy', name);
    } else if (to?.zone === 'stage' && mine(ctx, seat)) {
      base = 'MoveHandCardToStage';
      values = { iIdx: l.index };
      logLine(ctx, 'Log.Deploy', name);
    } else if (to?.zone === 'deck') {
      const top = to.index >= ctx.views[seat].deck.length / 2;
      base = mine(ctx, seat) ? (top ? 'MoveHandCardToDeckTop' : 'MoveHandCardToDeckBottom') : 'MoveOppHandCardToDeckBottom';
      values = { iCardIdx: l.index };
      logLine(ctx, 'Log.SendCardToBottom');
    } else if (to?.zone === 'life' && mine(ctx, seat)) {
      base = 'SendHandCardToMyLife';
      values = { iHandIdx: l.index, bForceFaceUp: to.card.faceUp === true, bTop: to.index === ctx.views[seat].life.length - 1 };
      logLine(ctx, 'Log.AddToLife', srcName(ctx) || name);
    }
    if (base) send(ctx, base, values);
    else { skip.add(l.card.uid!); cannot(ctx, seat, `${l.card.code} de la main vers ${to?.zone ?? 'nulle part'}`); }
  }
}

// ---------- 3. La Défausse qui part

function trashExits(ctx: Ctx, seat: Seat) {
  const skip = new Set<number>();
  for (let guard = 0; guard < 100; guard++) {
    const l = nextLeaving(ctx, seat, 'trash', skip);
    if (!l) return;
    const to = l.to;
    const name = cardName(l.card.code);
    let base: string | null = null;
    let values: Record<string, unknown> = {};
    if (to?.zone === 'hand' && mine(ctx, seat)) {
      base = 'DrawCardFromTrash';
      values = { iTrashIdx: l.index };
      logLine(ctx, 'Log.DrawFromTrash', name);
    } else if (to?.zone === 'deploy' && mine(ctx, seat)) {
      base = 'MoveTrashCardToDeploy';
      values = { iIdx: l.index, bRested: (to.card as FieldCard).rested === true };
      if (ctx.source && ctx.source !== l.card.code) logLine(ctx, 'Log.PlayOtherFromTrash', srcName(ctx), name); else logLine(ctx, 'Log.PlayFromTrash', name);
    } else if (to?.zone === 'stage' && mine(ctx, seat)) {
      base = 'MoveTrashCardToStage';
      values = { iIdx: l.index };
      logLine(ctx, 'Log.PlayFromTrash', name);
    } else if (to?.zone === 'deck') {
      base = pick(ctx, seat, 'MoveTrashCardToDeckBottom', 'MoveOppTrashCardToDeckBottom');
      values = { iCardIdx: l.index };
      logLine(ctx, 'Log.SendTrashToDeckBottom', srcName(ctx) || name, name);
    } else if (to?.zone === 'life' && mine(ctx, seat)) {
      base = 'SendTrashCardToMyLife';
      values = { iTrashIdx: l.index, bForceFaceUp: to.card.faceUp === true };
    }
    if (base) send(ctx, base, values);
    else { skip.add(l.card.uid!); cannot(ctx, seat, `${l.card.code} de la Défausse vers ${to?.zone ?? 'nulle part'}`); }
  }
}

// ---------- 4. La Vie qui part (dégâts, effets)

function lifeExits(ctx: Ctx, seat: Seat) {
  const skip = new Set<number>();
  const own = mine(ctx, seat);
  for (let guard = 0; guard < 60; guard++) {
    const l = nextLeaving(ctx, seat, 'life', skip);
    if (!l) return;
    const life = zoneOf(ctx, seat, 'life');
    const top = life.length - 1;
    const to = l.to?.zone;
    const name = cardName(l.card.code);
    // les cartes du dessus qui vont au même endroit partent ensemble
    let run = 0;
    for (let i = top; i >= 0 && life[i].uid !== undefined && dest(ctx, seat, life[i].uid)?.zone === to && to !== 'life'; i--) run++;
    const toTop = () => send(ctx, pick(ctx, seat, 'MoveMyLifeToTop', 'MoveOpponentLifeToTop')!, { iLifeIdx: l.index });
    if (to === 'hand') {
      if (l.index === top) send(ctx, pick(ctx, seat, 'PlayerDrawLife', 'OpponentDrawLife')!, { iCount: Math.max(run, 1) });
      else if (l.index === 0 && own) send(ctx, 'PlayerDrawBottomLife', { iCount: 1 });
      else { toTop(); send(ctx, pick(ctx, seat, 'PlayerDrawLife', 'OpponentDrawLife')!, { iCount: 1 }); }
    } else if (to === 'trash') {
      logLine(ctx, 'Log.TrashLife', name);
      if (l.index === top) send(ctx, pick(ctx, seat, 'TrashLife', 'TrashOpponentLife')!, { iCount: Math.max(run, 1) });
      else if (l.index === 0 && own) send(ctx, 'TrashBottomLife', { iCount: 1 });
      else if (own) send(ctx, 'TrashSpecificLife', { iIdx: l.index });
      else { toTop(); send(ctx, 'TrashOpponentLife', { iCount: 1 }); }
    } else if (to === 'deck') {
      if (own) { send(ctx, 'MoveLifeToDeck', { iLifeIdx: l.index }); logLine(ctx, 'Log.AddToDeckFromLife', srcName(ctx) || name); }
      else {
        if (l.index !== 0) { toTop(); send(ctx, 'MoveOpponentTopLifeBottom'); }
        send(ctx, 'BottomDeckOpponentLife', { iCount: 1 });
      }
    } else if (to === 'deploy' && own) {
      send(ctx, 'PlayCardFromLife', { iLifeIndex: l.index, bRested: (l.to!.card as FieldCard).rested === true });
      logLine(ctx, 'Log.Deploy', name);
    } else { skip.add(l.card.uid!); cannot(ctx, seat, `${l.card.code} de la Vie vers ${to ?? 'nulle part'}`); }
  }
}

// ---------- 5. Le deck : sorties (pioche, recherche, meule, Vie, terrain), ordre, mélange

/** Au-delà, remettre le deck en ordre carte par carte serait plus long qu'un mélange (et c'en est un dans le moteur). */
const REORDER_LIMIT = 8;

/**
 * Le plus long segment contigu de `target` (du dessous vers le dessus) déjà dans le bon ordre relatif dans `current` :
 * les cartes au-dessous iront au-dessous une à une, celles au-dessus au-dessus, le segment ne bouge pas.
 */
function keptSegment(current: number[], target: number[]): [number, number] {
  const pos = new Map(current.map((u, i) => [u, i]));
  let best: [number, number] = [0, -1];
  for (let a = 0; a < target.length; a++) {
    let b = a;
    while (b + 1 < target.length && pos.get(target[b + 1])! > pos.get(target[b])!) b++;
    if (b - a > best[1] - best[0]) best = [a, b];
  }
  return best;
}

function deckStep(ctx: Ctx, seat: Seat, opening: boolean) {
  const own = mine(ctx, seat);
  const v = ctx.views[seat];
  const target = v.deck.map((c) => c.uid);
  const inTarget = new Set(target);
  const deck = () => zoneOf(ctx, seat, 'deck');
  const missing = target.filter((u) => indexIn(ctx, seat, 'deck', u) < 0);
  if (missing.length) cannot(ctx, seat, `${missing.length} carte(s) à remettre dans le deck`);
  const exits = () => deck().filter((c) => c.uid !== undefined && !inTarget.has(c.uid));
  const kept = () => deck().map((c) => c.uid!).filter((u) => inTarget.has(u));
  const ordered = () => kept().join(' ') === target.filter((u) => !missing.includes(u)).join(' ');
  const reorderCost = () => { const [a, b] = keptSegment(kept(), target); return target.length - (b - a + 1); };
  const shuffleNeeded = (opening && own) || (!ordered() && reorderCost() > REORDER_LIMIT);

  if (shuffleNeeded && !missing.length) {
    // après le mélange, tout ce qui sort du deck sort par le dessus, dans l'ordre où on l'envoie
    const rank: Record<string, number> = { hand: 0, life: 1, trash: 2, deploy: 3, stage: 4 };
    const out = exits().map((c) => ({ c, to: dest(ctx, seat, c.uid)! })).filter((x) => x.to)
      .sort((x, y) => rank[x.to.zone] - rank[y.to.zone] || x.to.index - y.to.index);
    // la Vie se remplit par le dessus : la première posée finit au-dessous
    const order = [...target, ...out.map((x) => x.c.uid!).reverse()];
    const before = deck().map((c) => c.uid);
    send(ctx, pick(ctx, seat, 'ShuffleDeck', 'ShuffleOpponentDeck')!, { s_ShuffleString: order.map((u) => before.indexOf(u)).join('-') });
  }

  // sorties
  const group = (zone: CardZone) => {
    const d = deck();
    let n = 0;
    for (let i = d.length - 1; i >= 0 && dest(ctx, seat, d[i].uid)?.zone === zone && !inTarget.has(d[i].uid!); i--) n++;
    return n;
  };
  const skip = new Set<number>();
  for (let guard = 0; guard < 120; guard++) {
    const left = exits().filter((c) => !skip.has(c.uid!));
    if (!left.length) break;
    const d = deck();
    const topCard = d[d.length - 1];
    const topTo = dest(ctx, seat, topCard?.uid)?.zone;
    const topIsExit = topCard && !inTarget.has(topCard.uid!) && !skip.has(topCard.uid!);
    const hand = left.filter((c) => dest(ctx, seat, c.uid)?.zone === 'hand');
    // pioche : les cartes du dessus vers la main
    if (topIsExit && topTo === 'hand' && (group('hand') === hand.length || shuffleNeeded)) {
      const n = group('hand');
      if (own) {
        if (ctx.source) logLine(ctx, 'Log.ActionDrawCard', srcName(ctx), '', n); else logLine(ctx, 'Log.DrawCard', '', '', n);
        send(ctx, 'DrawCard', { iCount: n });
      } else for (let k = 0; k < n; k++) skip.add(d[d.length - 1 - k].uid!); // sa pioche : son jeu l'envoie
      continue;
    }
    // recherche : une carte précise vers la main
    if (hand.length) {
      const c = hand[hand.length - 1];
      if (own) {
        if (ctx.source) logLine(ctx, 'Log.DrawFromTopDeck', srcName(ctx), cardName(c.code));
        send(ctx, 'DrawSpecificCard', { iCardIndex: d.indexOf(c) });
      } else { skip.add(c.uid!); cannot(ctx, seat, `${c.code} du deck vers la main`); }
      continue;
    }
    const c = topIsExit ? topCard : left[left.length - 1];
    const to = dest(ctx, seat, c.uid);
    if (!to) { skip.add(c.uid!); if (!limbo(ctx.e, c.uid!)) cannot(ctx, seat, `${c.code} du deck vers nulle part`); continue; }
    const i = d.indexOf(c);
    const atTop = i === d.length - 1;
    if (to.zone === 'trash' && own) {
      const n = atTop ? group('trash') : 0;
      if (n > 0) { if (ctx.source) logLine(ctx, 'Log.MillCards', srcName(ctx), '', n); send(ctx, 'MillCard', { iCount: n }); }
      else send(ctx, 'MoveDeckCardToTrash', { iCardIndex: i });
    } else if (to.zone === 'life') {
      const faceUp = to.card.faceUp === true;
      const life = zoneOf(ctx, seat, 'life');
      const n = atTop ? group('life') : 0;
      if (own && n > 0 && !life.length && n === left.length && !faceUp) send(ctx, 'PopulateLifeDeck', { iLifeCount: n });
      else if (own && (faceUp || !atTop)) send(ctx, 'MoveSpecificDeckCardToLife', { iCardIndex: i, bForceFaceUp: faceUp });
      else if (own) send(ctx, to.index === 0 && life.length ? 'SendDeckToBottomLife' : 'SendDeckToLife');
      else if (atTop) send(ctx, 'SendOpponentDeckToLife');
      else { skip.add(c.uid!); cannot(ctx, seat, `${c.code} du deck vers la Vie`); }
      if (own && ctx.source && n !== left.length) logLine(ctx, 'Log.AddDeckToLife', srcName(ctx));
    } else if (to.zone === 'deploy') {
      if (ctx.source) logLine(ctx, 'Log.ActionDeploy', srcName(ctx), cardName(c.code)); else logLine(ctx, 'Log.Deploy', cardName(c.code));
      send(ctx, pick(ctx, seat, 'PlayCardFromDeck', 'OpponentPlayCardFromDeck')!, { iCardIndex: i, bRested: (to.card as FieldCard).rested === true });
    } else if (to.zone === 'stage' && own) {
      logLine(ctx, 'Log.Deploy', cardName(c.code));
      send(ctx, 'MoveDeckCardToStage', { iIdx: i });
    } else { skip.add(c.uid!); cannot(ctx, seat, `${c.code} du deck vers ${to.zone}`); }
  }

  // ordre des cartes qui restent
  if (missing.length || ordered()) return;
  if (!own) { cannot(ctx, seat, 'remettre le deck adverse en ordre'); return; }
  if (reorderCost() > REORDER_LIMIT) {
    const before = deck().map((c) => c.uid);
    send(ctx, 'ShuffleDeck', { s_ShuffleString: target.map((u) => before.indexOf(u)).join('-') });
    return;
  }
  const [a, b] = keptSegment(kept(), target);
  if (a > 0) logLine(ctx, 'Log.TopDeckToBottom');
  for (let k = a - 1; k >= 0; k--) send(ctx, 'MoveDeckCardToBottom', { iCardIndex: indexIn(ctx, seat, 'deck', target[k]) });
  if (b < target.length - 1) logLine(ctx, 'Log.TopDeckToTop');
  for (let k = b + 1; k < target.length; k++) send(ctx, 'MoveDeckCardToTop', { iCardIndex: indexIn(ctx, seat, 'deck', target[k]) });
}

// ---------- 6. Ordre et faces de la Vie

function lifeOrder(ctx: Ctx, seat: Seat) {
  const own = mine(ctx, seat);
  const target = ctx.views[seat].life;
  const life = () => zoneOf(ctx, seat, 'life');
  const uids = () => life().map((c) => c.uid);
  if (life().length !== target.length || target.some((c) => !uids().includes(c.uid))) return; // déjà signalé ailleurs
  let k = 0;
  while (k < target.length && uids()[k] === target[k].uid) k++;
  for (let i = k; i < target.length; i++) {
    send(ctx, pick(ctx, seat, 'MoveMyLifeToTop', 'MoveOpponentLifeToTop')!, { iLifeIdx: uids().indexOf(target[i].uid) });
  }
  // faces : retourner face cachée une à une, face visible par le dessus (ou le dessous)
  const wrong = () => life().map((c, i) => (Boolean(c.faceUp) !== Boolean(target[i].faceUp) ? i : -1)).filter((i) => i >= 0);
  for (const i of wrong()) {
    if (target[i].faceUp) continue;
    if (own) send(ctx, 'FlipLifeDown', { iLifeIdx: i }); else cannot(ctx, seat, 'retourner une Vie adverse face cachée');
  }
  const up = wrong();
  if (!up.length) return;
  const n = life().length;
  const fromTop = n - Math.min(...up), fromBottom = Math.max(...up) + 1;
  const topOk = target.slice(n - fromTop).every((c) => c.faceUp), bottomOk = target.slice(0, fromBottom).every((c) => c.faceUp);
  if (own && topOk) send(ctx, 'FlipLifeUp', { iCount: fromTop });
  else if (own && bottomOk) send(ctx, 'FlipBotLifeUp', { iCount: fromBottom });
  else cannot(ctx, seat, 'retourner une Vie face visible au milieu');
}

// ---------- 7. DON!!

function donStep(ctx: Ctx, seat: Seat) {
  const own = mine(ctx, seat);
  const P = ctx.e.players[seat];
  const cost = () => zoneOf(ctx, seat, 'donCost');
  const active = () => cost().filter((d) => !d.rested).length;
  const donDeck = () => zoneOf(ctx, seat, 'donDeck').length;
  const p = ctx.w.players[seat];
  const holders = (): [MirrorCardX, FieldCard][] => {
    const out: [MirrorCardX, FieldCard][] = [[p.leader, P.leader]];
    for (const c of P.chars) { const m = zoneOf(ctx, seat, 'deploy').find((x) => x.uid === c.uid); if (m) out.push([m, c]); }
    return out;
  };
  // DON!! reprises à une carte : vers la zone de Coût, épuisées (DetachDonFromCard) ; celles qui partent au deck DON!!
  // (DON!! −X) y vont ensuite depuis la zone de Coût, les épuisées d'abord, comme returnDon
  for (const [m, c] of holders()) {
    for (let k = (m.attachedDon ?? 0) - c.don; k > 0; k--) {
      if (!own) { cannot(ctx, seat, `reprendre une DON!! donnée à ${c.num}`); break; }
      send(ctx, 'DetachDonFromCard', { iCardIdx: fieldIndex(ctx, seat, c.uid), iDonIdx: 0 });
    }
  }
  const back = P.donDeck - donDeck();
  if (back > 0 && own && ctx.source) logLine(ctx, 'Log.DonMinus', srcName(ctx), '', back);
  for (let k = back; k > 0 && cost().length; k--) {
    if (!own) { cannot(ctx, seat, 'renvoyer une DON!! adverse dans son deck'); break; }
    const i = cost().findIndex((d) => d.rested);
    send(ctx, 'ReturnDon', { iDonIdx: i >= 0 ? i : cost().length - 1 });
  }
  // DON!! prises du deck DON!! : redressées tant qu'il en manque, épuisées pour le reste
  const draw = (n: number) => {
    const up = Math.max(0, Math.min(n, P.donActive - active()));
    if (!own) { cannot(ctx, seat, `ajouter ${n} DON!! adverse(s)`); return; }
    if (up) { if (ctx.source) logLine(ctx, 'Log.ActionDrawDon', srcName(ctx), '', up); else logLine(ctx, 'Log.DrawDon', '', '', up); send(ctx, 'DrawDon', { iCount: up }); }
    if (n - up) { logLine(ctx, 'Log.DrawRestedDon', srcName(ctx) || cardName(P.leader.num), '', n - up); send(ctx, 'DrawRestedDon', { iCount: n - up }); }
  };
  // DON!! données : une redressée tant qu'il y en a en trop, sinon une épuisée
  for (const [m, c] of holders()) {
    for (let k = c.don - (m.attachedDon ?? 0); k > 0; k--) {
      const idx = fieldIndex(ctx, seat, c.uid);
      const surplus = active() + Math.max(0, donDeck() - P.donDeck) - P.donActive;
      const rested = cost().length - active();
      if (!cost().length && donDeck() > P.donDeck) { draw(1); }
      if (active() > 0 && (surplus > 0 || rested === 0)) {
        let i = -1;
        cost().forEach((d, j) => { if (!d.rested && (!d.frozen || i < 0)) i = j; });
        send(ctx, pick(ctx, seat, 'AttachDonToCard', 'AttachDonToEnemyCard')!, { iCardIdx: idx, iDonIdx: i });
      } else if (cost().length) {
        logLine(ctx, 'Log.AttachRestedDon', srcName(ctx) || cardName(c.num), cardName(c.num), 1);
        send(ctx, pick(ctx, seat, 'AttachRestedDon', 'AttachEnemyRestedDon')!, { iDonCount: 1, iCardIdx: idx });
      } else { cannot(ctx, seat, `donner une DON!! à ${c.num} : aucune DON!!`); break; }
    }
  }
  if (donDeck() > P.donDeck) draw(donDeck() - P.donDeck);
  // inclinaison des DON!! qui restent
  const k = active() - P.donActive;
  if (k > 0) {
    if (ctx.source) logLine(ctx, 'Log.RestDon', srcName(ctx), '', k);
    send(ctx, pick(ctx, seat, 'TapDon', 'TapOpponentDon')!, { iCount: k });
  } else if (k < 0) {
    if (!own) cannot(ctx, seat, 'redresser des DON!! adverses');
    else { if (ctx.source) logLine(ctx, 'Log.ActionActivateDon', srcName(ctx), '', -k); send(ctx, 'UntapDon', { iCount: -k }); }
  }
}

// ---------- 8. Épuiser, redresser

function restStep(ctx: Ctx, seat: Seat) {
  const P = ctx.e.players[seat];
  const p = ctx.w.players[seat];
  const pairs: [MirrorCardX, FieldCard, number][] = [[p.leader, P.leader, -1]];
  for (const c of P.chars) { const i = indexIn(ctx, seat, 'deploy', c.uid); if (i >= 0) pairs.push([p.zones.deploy[i], c, i]); }
  for (const [m, c, i] of pairs) {
    if (Boolean(m.rested) === c.rested) continue;
    const other = ctx.source && ctx.source !== c.num;
    if (other) logLine(ctx, c.rested ? 'Log.SetOtherRest' : 'Log.SetOtherActive', srcName(ctx), cardName(c.num));
    send(ctx, c.rested ? pick(ctx, seat, 'TapCard', 'TapOpponentCard')! : pick(ctx, seat, 'UntapCard', 'UntapOpponentCard')!, { iCardIndex: i });
  }
  const st = p.zones.stage[0];
  if (P.stage && st?.uid === P.stage.uid && Boolean(st.rested) !== P.stage.rested) {
    send(ctx, P.stage.rested ? pick(ctx, seat, 'TapStageCard', 'TapOpponentStageCard')! : pick(ctx, seat, 'UntapStage', 'UntapOpponentStage')!);
  }
}

// ---------- 9. Bonus de puissance et de coût posés par les effets

const POWER_RPC: Record<Expiry, [string, string] | undefined> = {
  turn: ['BuffCardPower', 'BuffOpponentCardPower'], battle: ['BuffCardCombat', 'BuffOpponentCardCombat'],
  ownersEnd: ['BuffCardToOwnersEnd', 'BuffOpponentCardToOwnersEnd'], oppEnd: ['BuffCardToOppEnd', 'BuffOpponentCardToOppEnd'],
  start: undefined, field: undefined,
};

/** Modifications de `after` absentes de `before` (multiensemble : deux bonus identiques comptent pour deux). */
function modsDiff(before: Modifier[], after: Modifier[]): { added: Modifier[]; removed: Modifier[] } {
  const k = (m: Modifier) => JSON.stringify([m.uid, m.stat, m.amount, m.until, m.source, m.num ?? null, m.keyword ?? null]);
  const count = new Map<string, number>();
  for (const m of before) count.set(k(m), (count.get(k(m)) ?? 0) + 1);
  const added: Modifier[] = [];
  for (const m of after) { const n = count.get(k(m)) ?? 0; if (n > 0) count.set(k(m), n - 1); else added.push(m); }
  const left = new Map(count);
  const removed = before.filter((m) => { const n = left.get(k(m)) ?? 0; if (n > 0) { left.set(k(m), n - 1); return true; } return false; });
  return { added, removed };
}

function modsStep(ctx: Ctx, before: GameState, seats: Seat[]) {
  const { added, removed } = modsDiff(before.mods, ctx.e.mods);
  const where = (uid: number): { seat: Seat; idx: number; num: string } | undefined => {
    for (const seat of seats) {
      const idx = fieldIndex(ctx, seat, uid);
      if (idx >= -1 && (idx >= 0 || ctx.w.players[seat].leader.uid === uid)) return { seat, idx, num: (engineCard(ctx, seat, uid) ?? { num: '' }).num };
    }
    return undefined;
  };
  // classe d'échéance vue du tour du miroir (celui où le jeu lira la RPC)
  const cls = (m: Modifier, seat: Seat) => expiryOf(m.until, seat, ctx.w.turn, ctx.w.turnPlayer);
  for (const m of added) {
    const t = where(m.uid);
    if (!t) continue;
    const own = mine(ctx, t.seat);
    if (m.stat === 'power') {
      const c = cls(m, t.seat);
      const names = c ? POWER_RPC[c] : undefined;
      if (!names || !m.amount) { if (m.amount) cannot(ctx, t.seat, `bonus de puissance jusqu'au tour ${String(m.until)}`); continue; }
      logLine(ctx, c === 'battle' ? 'Log.CombatBuff' : 'Log.ActionBuff', srcName(ctx) || cardName(t.num), cardName(t.num), m.amount);
      send(ctx, own ? names[0] : names[1], { iCardIndex: t.idx, iBuff: m.amount });
    } else if (m.stat === 'cost') {
      if (!m.amount) continue;
      const c = cls(m, t.seat);
      logLine(ctx, 'Log.ChangeCost', srcName(ctx) || cardName(t.num), cardName(t.num), m.amount);
      send(ctx, own && c === 'oppEnd' ? 'ChangeCardCostToOppEnd' : own ? 'ChangeMyCardCost' : 'ChangeOpponentCardCost', { iDeployIdx: t.idx, iChange: m.amount });
    } else if (m.stat === 'noRefresh') {
      if (t.idx < -1) continue;
      logLine(ctx, 'Log.GrantFreeze', srcName(ctx) || cardName(t.num), cardName(t.num));
      send(ctx, own ? 'FreezeCard' : 'FreezeOpponentCard', { iCardIndex: t.idx });
    } else if (m.stat === 'basePower') {
      cannot(ctx, t.seat, `puissance de base de ${t.num} (mod. ${m.amount})`);
    }
  }
  // un bonus de coût posé sans échéance chez OPTCGSim (pour le tour, ou chez l'adversaire) est retiré quand le moteur l'oublie
  for (const m of removed) {
    if (m.stat !== 'cost' || !m.amount) continue;
    const t = where(m.uid);
    if (!t) continue;
    const c = expiryOf(m.until, t.seat, before.turn, before.active);
    if (mine(ctx, t.seat) && c === 'oppEnd') continue;
    send(ctx, mine(ctx, t.seat) ? 'ChangeMyCardCost' : 'ChangeOpponentCardCost', { iDeployIdx: t.idx, iChange: -m.amount });
  }
}

// ---------------------------------------------------------------------------------------------------- action principale

function primary(ctx: Ctx, before: GameState, choice: string) {
  const me = ctx.me;
  const [kind, id] = choice.split(':');
  const uid = Number(id);
  const B = before.players[me];
  const inHand = B.hand.find((c) => c.uid === uid);
  const now = dest(ctx, me, uid);
  const handIdx = () => indexIn(ctx, me, 'hand', uid);
  const pay = (card: Card) => {
    let cost = 0;
    try { cost = handCost(before, me, card); } catch { cost = 0; }
    cost = Math.min(cost, zoneOf(ctx, me, 'donCost').filter((d) => !d.rested).length);
    if (cost > 0) send(ctx, 'TapDon', { iCount: cost });
  };
  // repiocher (ShuffleHandIntoDeck) : toute la main au deck d'abord, le mélange et la pioche suivent
  if (choice === 'mulligan' && before.decision?.kind === 'mulligan' && before.decision.player === me) {
    if (zoneOf(ctx, me, 'hand').length) send(ctx, 'MoveHandToDeck');
    return;
  }
  if ((kind === 'play' || kind === 'event' || kind === 'cevent') && inHand) {
    if (handIdx() < 0) { ctx.source = inHand.num; return; }
    const name = cardName(inHand.num);
    if (kind === 'play' && (now?.zone === 'deploy' || now?.zone === 'stage')) {
      fieldExits(ctx, me); // 5 Personnages : celui qui laisse sa place part d'abord ; Lieu remplacé
      ctx.source = inHand.num;
      pay(inHand);
      logLine(ctx, 'Log.Deploy', name);
      if (now.zone === 'deploy') send(ctx, 'MoveHandCardToDeploy', { iIdx: handIdx(), bRested: (now.card as FieldCard).rested === true });
      else send(ctx, 'MoveHandCardToStage', { iIdx: handIdx() });
    } else if (kind !== 'play') {
      ctx.source = inHand.num;
      pay(inHand);
      logLine(ctx, kind === 'cevent' ? 'Log.UseCounter' : 'Log.ActivateMainOther', name, name);
      if (now?.zone === 'trash') send(ctx, 'MoveHandCardToDiscard', { iCardIdx: handIdx() });
    } else ctx.source = inHand.num;
    return;
  }
  const f = [B.leader, ...B.chars, ...(B.stage ? [B.stage] : [])].find((c) => c.uid === uid);
  if (kind === 'act' && f) {
    ctx.source = f.num;
    logLine(ctx, 'Log.ActivateMainOther', cardName(f.num), cardName(f.num));
    return;
  }
  if (kind === 'don' && f && (now?.zone === 'leader' || now?.zone === 'deploy')) {
    const idx = fieldIndex(ctx, me, uid);
    const m = idx === -1 ? ctx.w.players[me].leader : zoneOf(ctx, me, 'deploy')[idx];
    const cost = zoneOf(ctx, me, 'donCost');
    let i = -1;
    cost.forEach((d, j) => { if (!d.rested && (!d.frozen || i < 0)) i = j; });
    if (!m || i < 0 || (now.card as FieldCard).don <= (m.attachedDon ?? 0)) return;
    logLine(ctx, 'Log.AttachDonMulti', cardName(f.num), '', 1, (m.attachedDon ?? 0) + 1);
    send(ctx, 'AttachDonToCard', { iCardIdx: idx, iDonIdx: i });
    return;
  }
  // réponse à une question d'effet, contre, attaque... : la carte en jeu est la source des lignes de journal
  const src = before.decision?.source;
  const all = [before.players[0], before.players[1]].flatMap((p) => [p.leader, ...p.chars, ...(p.stage ? [p.stage] : []), ...p.hand, ...p.trash]);
  const s = all.find((c) => c.uid === (src ?? uid));
  if (s && (src !== undefined || kind === 'counter')) ctx.source = s.num;
}

// ---------------------------------------------------------------------------------------------------- traduction

interface Pass { opp: 'all' | 'moves' | 'none' }

function consequences(ctx: Ctx, pass: Pass, before?: GameState) {
  const order: [Seat, boolean][] = [[ctx.me, true], [other(ctx.me), false]];
  for (const [seat, own] of order) {
    if (!own && pass.opp === 'none') continue;
    fieldExits(ctx, seat);
    handExits(ctx, seat);
    trashExits(ctx, seat);
    lifeExits(ctx, seat);
    const started = ctx.e.flow.stage !== 'setup' && ctx.e.flow.stage !== 'mulligan';
    if (own || (pass.opp === 'all' && started)) deckStep(ctx, seat, own && isOpening(ctx, seat));
    lifeOrder(ctx, seat);
    if (own || (pass.opp === 'all' && started)) {
      if (own) donStep(ctx, seat);
      else opponentDon(ctx, seat);
      restStep(ctx, seat);
    }
  }
  if (before) modsStep(ctx, before, pass.opp === 'none' ? [ctx.me] : [ctx.me, other(ctx.me)]);
}

/** Ce que les effets de l'envoyeur font aux DON!! adverses : épuiser, donner (pas d'ajout ni de redressement : c'est son jeu). */
function opponentDon(ctx: Ctx, seat: Seat) {
  const P = ctx.e.players[seat];
  const p = ctx.w.players[seat];
  const active = () => p.zones.donCost.filter((d) => !d.rested).length;
  const pending = p.zones.donDeck.length !== P.donDeck;
  for (const c of [P.leader, ...P.chars]) {
    const m = c.uid === p.leader.uid ? p.leader : p.zones.deploy.find((x) => x.uid === c.uid);
    if (!m || pending) continue;
    for (let k = c.don - (m.attachedDon ?? 0); k > 0 && p.zones.donCost.length; k--) {
      send(ctx, 'AttachEnemyRestedDon', { iDonCount: 1, iCardIdx: fieldIndex(ctx, seat, c.uid) });
    }
  }
  const k = active() - P.donActive;
  if (k > 0 && !pending && p.zones.donCost.length === P.donActive + P.donRested) {
    if (ctx.source) logLine(ctx, 'Log.RestOpponentDon', srcName(ctx), '', k);
    send(ctx, 'TapOpponentDon', { iCount: k });
  }
}

/** Ouverture : le deck chargé n'est pas encore mélangé (rien hors du deck chez OPTCGSim, la main du moteur est tirée). */
function isOpening(ctx: Ctx, seat: Seat): boolean {
  const z = ctx.w.players[seat].zones;
  return ctx.e.flow.stage === 'mulligan' && !z.hand.length && !z.life.length && !z.trash.length && ctx.e.players[seat].hand.length > 0;
}

/**
 * Traduit en RPC OPTCGSim ce qui sépare le miroir de l'état du moteur, pour le joueur `opts.seat` (1 par défaut). Le
 * miroir reçu n'est pas modifié ; celui qui est rendu est l'état prévu après ces RPC (et les uids liés).
 */
export function translateOutbound(mirror: Mirror, engine: GameState, opts: OutboundOptions = {}): OutboundResult {
  const me = opts.seat ?? 1;
  const decided = (seat: Seat) => opts.seat === seat && (opts.choice === 'keep' || opts.choice === 'mulligan');
  const pending: [boolean, boolean] = [
    lifePending(engine, 0, mirror.players[0].zones.life.length, decided(0)),
    lifePending(engine, 1, mirror.players[1].zones.life.length, decided(1)),
  ];
  const views: [View, View] = [viewOf(engine, 0, pending[0]), viewOf(engine, 1, pending[1])];
  const ctx: Ctx = {
    w: bindUids(mirror, engine, pending), e: engine, me, out: [], problems: [], logs: opts.logs ?? true,
    object: opts.object ?? 2, behaviour: opts.behaviour ?? 0, mopts: opts.mirror ?? {}, views, locs: [locations(views[0]), locations(views[1])],
  };
  if (opts.before && opts.choice) primary(ctx, opts.before, opts.choice);
  const self = opts.scope === 'self';
  const started = engine.flow.stage !== 'setup' && engine.flow.stage !== 'mulligan';
  let endTurn: Rpc[] | undefined;
  if (started && engine.turn > ctx.w.turn && ctx.w.turnPlayer === me && opts.endTurnUnderway) {
    consequences(ctx, { opp: self ? 'none' : 'moves' }, opts.before);
  } else if (started && engine.turn > ctx.w.turn && ctx.w.turnPlayer === me) {
    // fin du tour de l'envoyeur : ses effets de fin de tour, puis la fin du tour en deux temps ; le redressement du
    // joueur suivant est fait par le miroir (EndTurn), sa pioche et ses DON!! par son jeu
    consequences(ctx, { opp: self ? 'none' : 'moves' }, opts.before);
    const extra = engine.active === me;
    send(ctx, 'AttemptingToEndTurn');
    const k = ctx.out.length, w = ctx.w;
    logLine(ctx, extra ? 'Log.TakeAnotherTurn' : 'Log.EndTurn');
    send(ctx, extra ? 'AnotherTurn' : 'EndTurn');
    if (extra) consequences(ctx, { opp: 'none' });
    else if (opts.holdEndTurn) { endTurn = ctx.out.splice(k); ctx.w = w; }
  } else {
    consequences(ctx, { opp: self ? 'none' : 'all' }, opts.before);
  }
  if (opts.choice === 'mulligan' && opts.before?.decision?.kind === 'mulligan' && opts.before.decision.player === me) logLine(ctx, 'Log.Mulligan');
  return { rpcs: ctx.out, mirror: ctx.w, problems: ctx.problems, ...(endTurn ? { endTurn } : {}) };
}

/** RPC que ce module peut envoyer (sans suffixe) : pour le rapport de couverture et les tests. */
export const OUTBOUND_RPCS: readonly string[] = [
  'VersionCheck', 'SetName', 'MakeEmptyDeckList', 'LoadLeader', 'LoadDeckCard', 'SetMyTurnRoll', 'AddLogLine',
  'ShuffleDeck', 'ShuffleOpponentDeck', 'DrawCard', 'DrawSpecificCard', 'DrawCardFromTrash', 'MillCard', 'MoveDeckCardToTrash',
  'MoveDeckCardToTop', 'MoveDeckCardToBottom', 'MoveDeckCardToStage', 'PlayCardFromDeck', 'OpponentPlayCardFromDeck',
  'MoveHandToDeck', 'MoveOpponentHandToDeck', 'MoveHandCardToDeckTop', 'MoveHandCardToDeckBottom', 'MoveOppHandCardToDeckBottom',
  'MoveHandCardToDiscard', 'MoveOpponentHandCardToDiscard', 'MoveHandCardToDeploy', 'MoveHandCardToStage', 'MoveTrashCardToDeploy',
  'MoveTrashCardToStage', 'MoveTrashCardToDeckBottom', 'MoveOppTrashCardToDeckBottom', 'ReturnCardToMyHand', 'ReturnCardToOpponentsHand',
  'ReturnCardToMyDeckBottom', 'ReturnCardToOpponentsDeckBottom', 'DiscardFromSelfDeploy', 'DiscardFromDeploy', 'MoveStageCardToHand',
  'MoveOppStageCardToHand', 'MoveStageCardToTrash', 'MoveOpponentStageCardToTrash', 'MoveStageCardToDeckBottom',
  'MoveOpponentStageCardToDeckBottom', 'PopulateLifeDeck', 'SendDeckToLife', 'SendOpponentDeckToLife', 'SendDeckToBottomLife',
  'MoveSpecificDeckCardToLife', 'PlayerDrawLife', 'OpponentDrawLife', 'PlayerDrawBottomLife', 'TrashLife', 'TrashOpponentLife',
  'TrashBottomLife', 'TrashSpecificLife', 'BottomDeckOpponentLife', 'MoveLifeToDeck', 'MoveMyLifeToTop', 'MoveOpponentLifeToTop',
  'MoveOpponentTopLifeBottom', 'SendDeployCardToMyLife', 'SendDeployCardToOpponentLife', 'SendTrashCardToMyLife', 'SendHandCardToMyLife',
  'PlayCardFromLife', 'FlipLifeUp', 'FlipBotLifeUp', 'FlipLifeDown', 'DrawDon', 'DrawRestedDon', 'TapDon', 'TapOpponentDon', 'UntapDon',
  'ReturnDon', 'AttachDonToCard', 'AttachDonToEnemyCard', 'AttachRestedDon', 'AttachEnemyRestedDon', 'DetachDonFromCard',
  'ReturnDonFromCard', 'TapCard', 'TapOpponentCard', 'UntapCard', 'UntapOpponentCard', 'TapStageCard', 'TapOpponentStageCard',
  'UntapStage', 'UntapOpponentStage', 'BuffCardPower', 'BuffOpponentCardPower', 'BuffCardCombat', 'BuffOpponentCardCombat',
  'BuffCardToOppEnd', 'BuffOpponentCardToOppEnd', 'BuffCardToOwnersEnd', 'BuffOpponentCardToOwnersEnd', 'ChangeMyCardCost',
  'ChangeOpponentCardCost', 'ChangeCardCostToOppEnd', 'FreezeCard', 'FreezeOpponentCard', 'AttemptingToEndTurn', 'EndTurn', 'AnotherTurn',
];
