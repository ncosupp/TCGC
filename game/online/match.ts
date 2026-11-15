// Partie en ligne entre deux joueurs : le serveur garde l'état complet et arbitre avec le moteur ; chaque joueur ne
// reçoit que sa vue (engine/view.ts) et n'envoie que l'identifiant de son choix, avec le numéro du coup.
// Ce module ne touche ni au disque ni au réseau : le serveur (server/game-online.js) s'occupe de la base et du temps
// réel, ce qui permet de tout tester ici.
import { buildRecord, type GameRecord } from '../coach/archive.ts';
import { shownNumbers, visibleLooks, type DeckLooks } from '../data/looks.ts';
import type { Move } from '../coach/review.ts';
import { playableErrors } from '../engine/deckRules.ts';
import { DECKS, isAdventureOnly, isCustomDeck, type DeckList } from '../engine/decks.ts';
import { act, newGame } from '../engine/engine.ts';
import { rng128From } from '../engine/rng.ts';
import type { GameState, HistoryEntry, PlayerId } from '../engine/types.ts';
import { historyFor, viewFor } from '../engine/view.ts';

export type Seat = PlayerId;  // 0 : l'hôte (qui a créé la salle), 1 : l'invité
// error : le moteur a levé une erreur sur un choix (ou s'est arrêté sans décision ni vainqueur) ; abandoned : personne n'a
// joué depuis IDLE_DAYS jours. Dans les deux cas la partie s'arrête sans perdant et ne rapporte rien.
export type MatchStatus = 'waiting' | 'playing' | 'over' | 'cancelled' | 'expired' | 'error' | 'abandoned';

// Ce qui a arrêté une partie en erreur, pour la rejouer et corriger le moteur : l'état d'avant (Match.state, inchangé)
// et ce choix suffisent. Reste côté serveur (jamais dans la vue d'un joueur).
export interface MatchFailure {
  seat: Seat;
  seq: number;
  choice: string;
  message: string;
  stack?: string;
  at: string;
}

export interface MatchPlayer {
  userId: number;
  name: string;
  deck: string;      // identifiant : deck du registre, ou PERSO-... (deck personnalisé du joueur)
  list?: DeckList;   // deck personnalisé : sa liste, lue dans la base par le serveur ; jamais envoyée à l'adversaire
  hold?: boolean;    // deck d'aventure (cartes de la Cale) : le serveur a vérifié que le joueur en possède toutes les cartes
  looks?: DeckLooks; // visuels choisis du deck personnalisé (cosmétique : jamais dans le moteur)
}

export interface Match {
  id: string;
  code: string | null;        // code de la salle, tant qu'elle attend un adversaire
  host: MatchPlayer;
  guest: MatchPlayer | null;
  status: MatchStatus;
  engine: string;             // version du programme au lancement
  initial: GameState | null;
  state: GameState | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;   // salle en attente : fermée à cette date
  startedAt: string | null;
  endedAt: string | null;
  failure?: MatchFailure;     // statut 'error' : le choix qui a fait lever le moteur
  public?: boolean;           // salle publique : listée pour tous les joueurs (« Salles publiques » du salon)
}

// Une salle publique en attente, telle que la voient les autres joueurs : le nom de l'hôte, son Leader et le nom de son
// deck (le Leader est public dès le début de la partie ; la liste d'un deck perso reste secrète)
export interface OpenRoom {
  code: string;
  host: string;
  leader: string | null;
  deckName: string;
  createdAt: string;
  expiresAt: string | null;
}

export function openRoomOf(m: Match): OpenRoom | null {
  if (!m.public || m.status !== 'waiting' || !m.code) return null;
  return {
    code: m.code, host: m.host.name, leader: m.host.list?.leader ?? DECKS[m.host.deck]?.leader ?? null, deckName: deckName(m.host),
    createdAt: m.createdAt, expiresAt: m.expiresAt,
  };
}

// Ce que reçoit un joueur
export interface MatchView {
  id: string;
  status: MatchStatus;
  code: string | null;        // seulement pour l'hôte d'une salle en attente
  seat: Seat;
  you: { name: string; deck: string; deckName: string; hold?: true };   // hold : deck d'aventure (absent sinon)
  opponent: { name: string; deck: string; deckName: string; hold?: true } | null;
  public?: true;              // salle publique en attente (la salle d'attente le dit)
  seq: number;                // numéro du coup attendu (à renvoyer avec le choix)
  state: GameState | null;    // vue expurgée
  expiresAt: string | null;
  // visuels de chaque joueur (absent : visuels de base et DON!! standard) ; ceux de l'adversaire seulement pour les
  // cartes que la vue montre déjà, sa liste restant secrète
  looks?: { [seat in Seat]?: DeckLooks };
}

export class MatchError extends Error {
  code: string;
  status: number;
  expose = true;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Code de salle : 6 caractères sans ambiguïté à la lecture (ni 0/O, ni 1/I/L)
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const WAIT_MINUTES = 15;
// Partie en cours sans aucun coup depuis ce nombre de jours : arrêtée sans perdant (server/game-online.js, expireRooms)
export const IDLE_DAYS = 7;

export function checkDeck(deck: unknown, list?: DeckList): string {
  // les adversaires de l'aventure ne se jouent pas en ligne
  if (typeof deck === 'string' && DECKS[deck] && !isAdventureOnly(deck)) return deck;
  if (typeof deck === 'string' && isCustomDeck(deck) && list?.id === deck) {
    if (playableErrors(list.leader, list.cards).length) throw new MatchError('invalid_deck', 'Ce deck n’est pas jouable : ouvre-le dans l’éditeur pour voir pourquoi');
    return deck;
  }
  throw new MatchError('invalid_deck', 'Deck inconnu');
}

const deckName = (p: MatchPlayer) => p.list?.name ?? DECKS[p.deck]?.name ?? p.deck;
const holdDeck = (p: MatchPlayer | null | undefined) => p?.hold === true;
const holdMark = (p: MatchPlayer) => (holdDeck(p) ? { hold: true as const } : {});

// Partie « entre decks d'aventure » : les deux joueurs jouent un deck d'aventure (préparation du classé de l'étape 3)
export const holdMatch = (m: Match) => holdDeck(m.host) && holdDeck(m.guest);

export function createMatch(id: string, code: string, host: MatchPlayer, now: Date, engine: string): Match {
  checkDeck(host.deck, host.list);
  return {
    id, code, host, guest: null, status: 'waiting', engine, initial: null, state: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + WAIT_MINUTES * 60_000).toISOString(),
    startedAt: null, endedAt: null,
  };
}

export function seatOf(m: Match, userId: number): Seat | null {
  if (m.host.userId === userId) return 0;
  if (m.guest?.userId === userId) return 1;
  return null;
}

// L'invité rejoint la salle : la partie commence (qui joue en premier est tiré au sort par le moteur).
// seed : 4 entiers tirés par crypto (server/game-online.js), pour le générateur de 128 bits des parties en ligne (la
// graine de 31 bits d'avant se retrouvait par force brute à partir de sa main de départ) ; un nombre seul garde
// l'ancien générateur (tests, parties d'avant le 14 novembre 2026).
export function joinMatch(m: Match, guest: MatchPlayer, now: Date, seed: number | readonly number[]) {
  checkDeck(guest.deck, guest.list);
  if (m.status !== 'waiting' || (m.expiresAt && m.expiresAt < now.toISOString())) throw new MatchError('room_closed', 'Cette salle n’est plus ouverte', 410);
  if (guest.userId === m.host.userId) throw new MatchError('own_room', 'C’est ta propre salle : envoie le code à ton ami');
  m.guest = guest;
  m.code = null;
  m.expiresAt = null;
  m.status = 'playing';
  const random = typeof seed === 'number' ? { seed } : { rng128: rng128From(seed) };
  m.initial = newGame({ decks: [m.host.list ?? m.host.deck, guest.list ?? guest.deck], names: [m.host.name, guest.name], ...random, first: 'random' });
  m.state = m.initial;
  m.startedAt = m.updatedAt = now.toISOString();
}

// Un choix d'un joueur : refusé s'il ne lui revient pas, s'il arrive en retard (numéro du coup) ou s'il n'existe pas
export function play(m: Match, seat: Seat, seq: number, choice: string, now: Date) {
  const s = m.state;
  if (m.status !== 'playing' || !s) throw new MatchError('not_playing', 'La partie n’est pas en cours', 409);
  if (seq !== s.history.length) throw new MatchError('stale', 'Ce coup a déjà été joué', 409);
  if (!s.decision || s.decision.player !== seat) throw new MatchError('not_your_turn', 'Ce n’est pas à toi de choisir', 409);
  if (typeof choice !== 'string' || !s.decision.options.some((o) => o.id === choice)) throw new MatchError('invalid_choice', 'Choix impossible');
  m.updatedAt = now.toISOString();
  // Une erreur du moteur (une carte mal codée, un cas imprévu) ne doit pas bloquer la partie pour toujours : elle
  // s'arrête sans perdant, l'état d'avant reste tel quel et le choix est noté (le serveur le journalise). Même chose
  // pour un état sans décision ni vainqueur, où plus personne ne pourrait jouer.
  let next: GameState;
  try {
    next = act(s, choice);
    if (next.winner === null && !next.decision) throw new Error('Le moteur s’est arrêté sans décision ni vainqueur');
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    m.failure = { seat, seq, choice, message: e.message, ...(e.stack ? { stack: e.stack } : {}), at: m.updatedAt };
    stop(m, 'error', now);
    return;
  }
  m.state = next;
  if (m.state.winner !== null) {
    m.status = 'over';
    m.endedAt = m.updatedAt;
  }
}

// Partie arrêtée sans perdant (erreur du moteur, partie laissée à l'abandon) : l'état reste celui du dernier coup joué
export function stop(m: Match, status: 'error' | 'abandoned', now: Date) {
  if (m.status !== 'playing') throw new MatchError('not_playing', 'La partie n’est pas en cours', 409);
  m.status = status;
  m.updatedAt = m.endedAt = now.toISOString();
}

// Partie en cours où personne n'a joué depuis IDLE_DAYS jours
export const idle = (m: Match, now: Date) => m.status === 'playing' && now.getTime() - Date.parse(m.updatedAt) > IDLE_DAYS * 86_400_000;

export function resign(m: Match, seat: Seat, now: Date) {
  if (m.status !== 'playing' || !m.state) throw new MatchError('not_playing', 'La partie n’est pas en cours', 409);
  const s = structuredClone(m.state);
  const name = s.players[seat].name;
  s.winner = seat === 0 ? 1 : 0;
  s.winReason = `${name} abandonne la partie`;
  s.log.push({ turn: s.turn, player: null, text: s.winReason });
  s.decision = null;
  s.battle = null;
  s.pending = [];
  s.flow = { stage: 'over' };
  m.state = s;
  m.status = 'over';
  m.updatedAt = m.endedAt = now.toISOString();
}

// Visuels envoyés à un joueur : les siens en entier, ceux de l'adversaire réduits aux cartes de sa vue
function looksFor(seat: Seat, me: MatchPlayer, opp: MatchPlayer | null, state: GameState | null): MatchView['looks'] {
  const theirs = opp?.looks && visibleLooks(opp.looks, shownNumbers(state));
  const looks: NonNullable<MatchView['looks']> = {};
  if (me.looks && Object.keys(me.looks).length) looks[seat] = me.looks;
  if (theirs && Object.keys(theirs).length) looks[seat === 0 ? 1 : 0] = theirs;
  return Object.keys(looks).length ? looks : undefined;
}

export function viewOf(m: Match, seat: Seat): MatchView {
  const me = seat === 0 ? m.host : m.guest!;
  const opp = seat === 0 ? m.guest : m.host;
  const state = m.state ? viewFor(m.state, seat) : null;
  const looks = looksFor(seat, me, opp, state);
  return {
    id: m.id,
    status: m.status,
    code: seat === 0 && m.status === 'waiting' ? m.code : null,
    seat,
    you: { name: me.name, deck: me.deck, deckName: deckName(me), ...holdMark(me) },
    opponent: opp ? { name: opp.name, deck: opp.deck, deckName: deckName(opp), ...holdMark(opp) } : null,
    seq: m.state?.history.length ?? 0,
    state,
    expiresAt: m.expiresAt,
    ...(looks ? { looks } : {}),
    ...(m.public && m.status === 'waiting' ? { public: true as const } : {}),
  };
}

// La partie terminée, telle qu'elle est rangée dans « Mes parties » de chaque joueur (sans analyse du coach : il
// était désactivé pendant la partie). Les décisions du joueur sont retrouvées en rejouant les coups.
// holdDeck / opponentHoldDeck : présents (true) seulement pour un deck d'aventure.
export function recordFor(m: Match, seat: Seat, now: Date): GameRecord & { mode: 'online'; opponent: string; holdDeck?: true; opponentHoldDeck?: true } {
  if (!m.initial || !m.state || !m.guest || !m.startedAt) throw new MatchError('not_started', 'La partie n’a pas commencé', 409);
  const moves: Move[] = [];
  let s = m.initial;
  for (const h of m.state.history) {
    if (!s.decision) break;
    if (h.player === seat) moves.push({ id: moves.length + 1, state: s, choice: h.choice });
    s = act(s, h.choice);
  }
  const me = seat === 0 ? m.host : m.guest;
  const opp = seat === 0 ? m.guest : m.host;
  const p = (n: number) => String(n).padStart(2, '0');
  const d = new Date(m.startedAt);
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const rec = buildRecord({
    id: `${stamp}_${me.deck}-contre-${opp.deck}_en-ligne`,
    engine: m.engine,
    startedAt: m.startedAt,
    now: now.toISOString(),
    endedAt: m.endedAt ?? undefined,
    config: { myDeck: me.deck, aiDeck: opp.deck, level: 0, first: 'random', myDeckName: deckName(me), aiDeckName: deckName(opp) },
    human: seat,
    initial: m.initial,
    current: m.state,
    moves,
    reviews: new Map(),
    extra: new Map(),
    undos: [],
    abandoned: m.status !== 'over',
  });
  // La partie rangée ne contient que ce que le joueur a pu voir (game-decks.js : la liste d'un deck n'est jamais envoyée
  // à l'adversaire) : état de départ vu par lui (main, deck et Vies adverses en cartes « ? », générateur retiré), ses
  // lignes du journal, ses coups et le type des décisions publiques de l'adversaire. Elle ne se rejoue donc plus coup par
  // coup (« Mes parties » n'en montre que les statistiques et le journal) ; la partie complète reste dans game_matches,
  // côté serveur.
  const seen = expurgated(rec, m, seat);
  // visuels : les siens, et ceux de l'adversaire pour les cartes vues pendant la partie
  const looks: NonNullable<GameRecord['looks']> = {};
  if (me.looks && Object.keys(me.looks).length) looks[seat] = me.looks;
  const theirs = opp.looks && visibleLooks(opp.looks, shownNumbers(viewFor(m.state, seat)));
  if (theirs && Object.keys(theirs).length) looks[seat === 0 ? 1 : 0] = theirs;
  return {
    ...seen, mode: 'online', opponent: opp.name, ...(Object.keys(looks).length ? { looks } : {}),
    ...(holdDeck(me) ? { holdDeck: true as const } : {}), ...(holdDeck(opp) ? { opponentHoldDeck: true as const } : {}),
  };
}

// Enregistrement d'une partie en ligne réduit à ce que le joueur a vu (voir recordFor)
function expurgated(rec: GameRecord, m: Match, seat: Seat): GameRecord {
  const base = m.initial!.history.length;
  // coups gardés : les siens et les décisions publiques de l'adversaire, sans libellé (positions renumérotées pour les
  // décisions du joueur)
  const kept = new Map<number, number>();
  const steps: HistoryEntry[] = [];
  m.state!.history.slice(base).forEach((h, i) => {
    const [shown] = historyFor([h], seat);
    if (!shown) return;
    kept.set(i, steps.length);
    steps.push(shown);
  });
  return {
    ...rec,
    initial: viewFor(m.initial!, seat),
    steps,
    decisions: rec.decisions.flatMap((d) => (kept.has(d.step) ? [{ ...d, step: kept.get(d.step)! }] : [])),
    log: rec.log.filter((l) => l.only === undefined || l.only === seat),
  };
}
