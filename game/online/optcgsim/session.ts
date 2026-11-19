// Une partie croisée (tâche O3.1) : un joueur joy-boy (siège 1, celui qui rejoint) contre un joueur OPTCGSim (siège 0,
// l'hôte de la salle). Connexion (transport.ts, netcode.ts), mise en place (nom, leader, 50 cartes), boucle de jeu, fin.
//
// La boucle reprend le schéma du banc d'essai (`piloteIA` de scripts/optcgsim/banc.mjs, validé par deux parties
// réelles le 18 nov.), avec un humain à la place de l'IA. Pour chaque ClientRpc reçue (hôte, et écho de nos actions :
// `sender` = propriétaire de l'objet réseau) :
// 1. combat (O2.3) d'abord, si un combat est en cours ou si la RPC en relève : `handleCombatRpc` ;
// 2. inbound (O2.2) : `receive` sur la table croisée, avec `mirrorOptions` du combat ;
// 3. après une RPC de l'hôte, hors ouverture et hors combat : outbound (O2.1) sur nos propres zones (`scope: 'self'`),
//    pour la pioche, les DON!! et les réactions de nos cartes ;
// 4. la décision du joueur joy-boy, quand elle lui revient vraiment (pas de mutation en attente, pas de combat qui attend
//    OPTCGSim), est montrée dans sa vue. Sa réponse (`answer`) : l'ouverture (garder ou repiocher) part directement en
//    RPC (le moteur ne joue pas l'ouverture d'une partie croisée, 4350) ; pendant un combat, `combatAnswer` ; sinon
//    `answerExternal` (jamais `act()`) puis `translateOutbound`.
// `vu` est la table telle qu'OPTCGSim la verra : nos ServerRpc y sont appliquées à l'envoi, les ClientRpc de l'hôte à
// réception, nos échos jamais.
//
// Fins : victoire ou défaite (le miroir a vu la fin : Vie, abandon, effet), abandon du joueur joy-boy (`concede`), le jeu
// quitte la salle (abandon de l'hôte : victoire de joy-boy), connexion perdue ou trop d'écarts entre les deux tables
// (partie arrêtée sans perdant), joueur joy-boy absent trop longtemps (abandon en son nom), cartes inconnues de joy-boy
// dans le deck OPTCGSim (Décision 4 : relevé, message aux deux joueurs, abandon, sans enregistrement de partie).
// Rien ici ne touche au disque : server/game-crossplay.js garde les sessions, la base et le temps réel.
import crypto from 'node:crypto';
import { buildRecord, type GameRecord } from '../../coach/archive.ts';
import type { Move } from '../../coach/review.ts';
import { cardData, cardStatus } from '../../engine/cards/index.ts'; // avant le moteur (00-regles-communes § 6)
import type { CardData, GameState } from '../../engine/types.ts';
import { findField } from '../../engine/rules.ts';
import { historyFor, viewFor } from '../../engine/view.ts';
import {
  COMBAT_RPCS, combatAnswer, createCombat, handleCombatRpc, mirrorOptions, routesTo, waiting, type CombatState,
} from './combat.ts';
import { answerExternal, forceDecision } from './external.ts';
import {
  ALLY_REMOVAL, answerForOpponent, applyForced, FORCED_HAND_BACK, forcedKindOf, forcedOptions, type ForcedKind, answerOutgoing, HAND_BACK, OPTCGSIM_REPLACE_ACTION, queuedUid, reactionOf, replaceVictim, settlePending,
  uniqueDeckId, REMOVAL, replacementsFor, resolveQueued, runReplacement, type ReplacementAsk,
} from './reaction.ts';
import { compareTables, createTable, joyboyView, knownCard, realign, receive, withGame, type CrossTable, type UnknownCard } from './inbound.ts';
import { applyRpc, baseName, type Mirror, type MirrorOptions } from './mirror.ts';
import { HANDSHAKE, MESSAGE_TYPE, NetcodeClient, type NgoMessage } from './netcode.ts';
import { translateOutbound } from './outbound.ts';
import { decode, rpcMessage } from './rpc.ts';
import { LEFT, connect as realConnect, parseRoomCode, type Transport, type TransportOptions } from './transport.ts';
import type { Rpc, Seat } from './types.ts';

// ---------------------------------------------------------------------------------------------------- types

/** Deck au format d'OPTCGSim : le Leader et les 50 cartes (codes, une entrée par exemplaire). */
export interface CrossDeck { leader: string; cards: string[] }

export type SessionStatus = 'connecting' | 'setup' | 'playing' | 'over' | 'stopped';

/**
 * Comment la partie s'est finie. `kind` : 'game' (fin de partie vue par OPTCGSim), 'concede' (joy-boy abandonne),
 * 'left' (le jeu a quitté la salle en pleine partie), 'unknown' (cartes inconnues, Décision 4), 'idle' (joueur joy-boy
 * absent), 'desync' (trop d'écarts), 'lost' (connexion perdue), 'failed' (connexion impossible ou erreur).
 */
export interface SessionEnd {
  kind: 'game' | 'concede' | 'left' | 'unknown' | 'idle' | 'desync' | 'lost' | 'failed';
  /** Vainqueur (0 = OPTCGSim, 1 = joy-boy), null : partie arrêtée sans perdant. */
  winner: Seat | null;
  /** Siège qui a abandonné (null : partie allée à son terme ou arrêtée). */
  resigned: Seat | null;
  /** Raison lisible par le joueur (sans pseudo). */
  reason: string;
  at: string;
  /**
   * Où la session s'est arrêtée (tâche O4.2) : 'connect' (avant l'approbation de l'hôte : salle déjà prise, refusée,
   * fermée ou injoignable), 'setup' (connecté, mais la partie n'a pas commencé : hôte qui ne lance pas, départ avant le
   * lancement), 'playing' (partie commencée). Une fin 'failed' en 'connect' ou 'setup' n'a rien coûté à personne : le
   * repli de la file peut essayer une autre salle sans rien dire au joueur.
   */
  stage?: 'connect' | 'setup' | 'playing';
}

/** Ce que voit le joueur joy-boy (envoyé par le serveur, comme la vue d'une partie en ligne). */
export interface SessionSnapshot {
  status: SessionStatus;
  /** Numéro de la réponse attendue (à renvoyer avec le choix). */
  seq: number;
  /** Vue du moteur pour le joueur joy-boy ; sa décision n'y figure que quand elle lui revient. */
  state: GameState | null;
  opponent: { name: string; leader: string | null } | null;
  /** Message à montrer (attente, avertissement, cartes inconnues). */
  message: string | null;
  unknown: UnknownCard[];
  end: SessionEnd | null;
  /**
   * Informations des cartes du deck OPTCGSim connues de joy-boy mais pas encore jouables (Décision 8) : le navigateur
   * ne reçoit que les cartes jouables au chargement (playableCards) ; sans elles, la vue d'une de ces cartes posée par
   * l'hôte faisait tomber la page (écart n° 5 de O3.2, OP18-092). Absent quand il n'y en a pas.
   */
  cards?: Record<string, CardData>;
  /**
   * Chrono d'OPTCGSim (tâche O4.4, salles à minuteur) : pendule de 1050 s par joueur pour toute la partie, tenue par
   * l'hôte (`SetTimerClientRpc`, chaque seconde). `me` : temps restant du joueur joy-boy, `opponent` : celui du joueur
   * OPTCGSim (secondes, à l'instant `at`) ; `running` : celui dont le temps baisse (null : aucun, partie finie). La vue
   * n'est pas renvoyée à chaque seconde : le navigateur décompte lui-même depuis la réception. Absent sans minuteur.
   */
  clock?: SessionClock | null;
}

/** Chrono d'OPTCGSim vu par le joueur joy-boy (voir `SessionSnapshot.clock`). */
export interface SessionClock { me: number; opponent: number; running: Seat | null; at: string }

/** Bilan sans données personnelles, pour le journal du serveur. */
export interface SessionStats { received: number; sent: number; decisions: number; notes: number; mirrorErrors: number; unstuck: number }

export interface SessionOptions {
  /** Code de la salle OPTCGSim (« P… », « W… », « E… »…). */
  code: string;
  deck: CrossDeck;
  /** Pseudo affiché dans OPTCGSim. */
  name: string;
  /**
   * Compte joy-boy du joueur (tâche O4.2, salles publiques) : présent, le joueur est présenté à l'hôte sous le nom
   * `<pseudo>#NNNN` (`publicName`), avec 4 chiffres stables pour ce compte. Absent (parties par code), le pseudo seul.
   */
  account?: string | number;
  /**
   * Délai de lancement (tâche O4.2) : si la partie n'a pas commencé dans ce délai après le départ de la connexion (hôte
   * qui ne lance pas, salle qui ne répond pas), la session part proprement, sans message ni abandon : fin 'failed',
   * stage 'connect' ou 'setup'. Absent : pas de délai (parties par code, l'hôte est un ami qui attend).
   */
  startMs?: number;
  /** Remplace transport.connect (faux transport des tests). */
  connect?: (code: string, opts: TransportOptions) => Promise<Transport>;
  /** Options passées à connect (faux fetch et faux udp des tests). */
  transport?: TransportOptions;
  /** Journal sans données personnelles. */
  log?: (line: string) => void;
  /** Joueur joy-boy sans réponse pendant ce temps alors que c'est à lui : abandon en son nom (10 min). */
  idleMs?: number;
  /** Durée maximale d'une partie : abandon en son nom (90 min). */
  maxMs?: number;
  /** Écarts distincts (combat, inbound, outbound) au-delà desquels la partie est arrêtée (25). */
  maxNotes?: number;
  /** Délai entre la fin vue par le miroir et la fermeture de la connexion (2 s). */
  closeDelayMs?: number;
  /** Tirage des mélanges (tests). */
  randomInt?: (max: number) => number;
  /**
   * Garde-fou (repris du banc, O2.4-d) : chrono de joy-boy (SetTimer) en baisse depuis ce nombre de secondes sans envoi
   * de notre part, alors qu'aucune décision n'attend le joueur : la session est figée ; elle le journalise et, à son
   * tour, le finit (20 s).
   */
  stuckSeconds?: number;
}

export class SessionError extends Error {
  code: string;
  status: number;
  expose = true;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface CrossplaySession {
  readonly joinCode: string;
  readonly deck: CrossDeck;
  snapshot(): SessionSnapshot;
  /** Réponse du joueur joy-boy à sa décision (numéro `seq` de la vue). */
  answer(seq: number, choice: string): void;
  /** Abandon au nom du joueur joy-boy. */
  concede(reason?: string): void;
  /** Chaque changement de la vue (et la fin). Rend la fonction qui désabonne. */
  onChange(handler: () => void): () => void;
  /** État du moteur à la création de la table croisée, et état final (vainqueur posé). */
  initialState(): GameState | null;
  finalState(): GameState | null;
  /** Décisions du joueur joy-boy (pour « Mes parties »). */
  moves(): Move[];
  /** Cartes inconnues de joy-boy dans le deck OPTCGSim (Décision 4). */
  unknownCards(): UnknownCard[];
  /** Cartes du deck OPTCGSim connues de joy-boy mais dont l'effet n'est pas codé (Décision 8 : relevées, la partie continue). */
  uncodedCards(): UnknownCard[];
  /** Ce qui identifie l'adversaire sans le nommer (empreinte du pseudo et de l'identifiant Unity). */
  opponentKey(): string | null;
  stats(): SessionStats;
  startedAt(): string | null;
  /** Résout à la fin de la partie. */
  readonly done: Promise<SessionEnd>;
  /** Ferme la connexion (abandonne d'abord si la partie est en cours). */
  close(): void;
}

// ---------------------------------------------------------------------------------------------------- textes

/** Message envoyé dans le chat d'OPTCGSim et montré au joueur joy-boy (Décision 4). */
export function unknownMessage(codes: string[]): string {
  return `joy-boy ne sait pas encore jouer ${codes.length > 1 ? 'ces cartes' : 'cette carte'} : ${codes.join(', ')}. `
    + 'La partie est concédée pour ne bloquer personne ; les cartes sont notées pour être ajoutées.';
}
/** Fins au temps (pendule d'OPTCGSim à 0 : défaite immédiate de ce joueur, sans fin de tour). */
export const TIME_UP = { me: 'Temps écoulé', opponent: 'Temps écoulé pour ton adversaire OPTCGSim' } as const;
/** La vue est renvoyée pour le chrono au plus toutes les 10 s (et quand le chrono qui tourne change). */
const CLOCK_BROADCAST_MS = 10_000;
const DESYNC_TEXT = 'joy-boy et OPTCGSim ne voient plus la même table : la partie est arrêtée, sans perdant. Désolé !';
const MIRROR_REASON: Record<string, string> = {
  'touché sans vie': 'Leader touché sans Vie', abandon: 'abandon', effet: 'effet d’une carte',
};

/** Longueur maximale du pseudo dans `publicName` (24 caractères en tout avec « #NNNN »). */
const PUBLIC_PSEUDO_MAX = 19;
/**
 * Nom sous lequel un joueur joy-boy se présente dans une salle publique d'OPTCGSim (décision O4 du 19 nov.) :
 * `<pseudo>#NNNN`, 4 chiffres tirés d'une empreinte du compte (stables d'une partie à l'autre, sans révéler
 * l'identifiant). Le pseudo est nettoyé : OPTCGSim l'affiche en texte enrichi (TextMeshPro), donc ni `<` ni `>` ; ni `#`
 * (réservé au suffixe) ni caractère de contrôle.
 */
export function publicName(pseudo: string, account: string | number): string {
  const clean = String(pseudo ?? '').replace(/[\u0000-\u001f\u007f<>#]/g, '').replace(/\s+/g, ' ').trim();
  const base = [...clean].slice(0, PUBLIC_PSEUDO_MAX).join('').trim() || 'joy-boy';
  const digits = crypto.createHash('sha256').update(`joy-boy:compte:${account}`).digest().readUInt32BE(0) % 10_000;
  return `${base}#${String(digits).padStart(4, '0')}`;
}

/** Set d'un code de carte (« OP18-092 » → « OP18 », « P-012 » → « P »). */
export const setOf = (code: string): string => code.split('-')[0] || code;

// ---------------------------------------------------------------------------------------------------- la session

/** Lance une partie croisée : la connexion part tout de suite, la session rend compte de chaque étape par `onChange`. */
export function startSession(o: SessionOptions): CrossplaySession {
  const { style, joinCode } = parseRoomCode(o.code); // code illisible : erreur tout de suite
  if (!o.deck?.leader || o.deck.cards.length !== 50) throw new SessionError('invalid_deck', 'Un Leader et 50 cartes sont attendus', 400);
  const log = o.log ?? (() => {});
  const idleMs = o.idleMs ?? 10 * 60_000;
  const maxNotes = o.maxNotes ?? 25;
  const randomInt = o.randomInt ?? ((n: number) => crypto.randomInt(n));
  const handlers = new Set<() => void>();
  const name = o.account !== undefined && o.account !== null && o.account !== '' ? publicName(o.name, o.account) : o.name;
  /** Annule la connexion en cours si la session finit avant (arrêt, délai de lancement). */
  const abort = new AbortController();

  let status: SessionStatus = 'connecting';
  let message: string | null = 'Connexion à la salle OPTCGSim…';
  let transport: Transport | null = null, client: NetcodeClient | null = null, object: number | null = null;
  let table: CrossTable = createTable({ joyboy: 1 });
  let combat: CombatState = createCombat();
  let vu: Mirror | null = null;
  let opening: 'attente' | 'main' | 'vies' = 'attente';
  let initial: GameState | null = null, final: GameState | null = null, started: string | null = null;
  /** Raison de fin donnée par le transport (départ du jeu, silence, notre réseau coupé, fermeture par joy-boy). */
  let closedBy: string | null = null;
  let seq = 0, end: SessionEnd | null = null, idleTimer: ReturnType<typeof setTimeout> | null = null;
  const own: Move[] = [];
  let uncoded: UnknownCard[] = [];
  /** Décision 8 : cartes du deck adverse connues de joy-boy mais sans effet codé (lues dans le miroir à la mise en place). */
  /** Cartes du deck OPTCGSim (Leader compris) que le navigateur n'a pas reçues : connues mais pas encore jouables. */
  let extraCards: Record<string, CardData> | undefined;
  function opponentCardData(): Record<string, CardData> | undefined {
    const p = table.mirror.players[0];
    const data = cardData();
    const out: Record<string, CardData> = {};
    for (const c of [p.leader, ...p.zones.deck, ...p.zones.hand, ...p.zones.life]) {
      if (c.code && data[c.code] && knownCard(c.code) && cardStatus(c.code) === 'todo') out[c.code] = data[c.code];
    }
    return Object.keys(out).length ? out : undefined;
  }
  function findUncoded(): UnknownCard[] {
    const p = table.mirror.players[0];
    const counts = new Map<string, number>();
    for (const c of [p.leader, ...p.zones.deck, ...p.zones.hand, ...p.zones.life]) {
      if (!c.code || !knownCard(c.code) || cardStatus(c.code) !== 'todo') continue;
      counts.set(c.code, (counts.get(c.code) ?? 0) + 1);
    }
    return [...counts].sort().map(([code, count]) => ({ seat: 0 as Seat, code, count }));
  }
  const notes = new Set<string>();
  const stats: SessionStats = { received: 0, sent: 0, decisions: 0, notes: 0, mirrorErrors: 0, unstuck: 0 };
  const stuckSeconds = o.stuckSeconds ?? 20;
  let clockRef: number | null = null, stuckTold = false;
  // ---------- chrono d'OPTCGSim (O4.4)
  /** Salle à minuteur (GameStartClientRpc.bTimerLobby) ; null : pas encore su. */
  let timerLobby: boolean | null = null;
  /** Dernier chrono reçu (secondes) : le nôtre, celui de l'hôte, celui qui baisse, et quand (ms). */
  let clock: { me: number; opponent: number; running: Seat | null; at: number } | null = null;
  let clockShownAt = 0, clockShownRunning: Seat | null = null;
  /** Fin vue par OPTCGSim (Log.Win / Log.Lose de l'hôte, avant Log.Timeout) : vainqueur. */
  let hostVerdict: Seat | null = null;
  let clockExpiry: ReturnType<typeof setTimeout> | null = null;
  /** Ce chrono ne justifie pas de renvoyer la vue (onMessage). */
  let quietTick = false;
  let resolveDone!: (e: SessionEnd) => void;
  const done = new Promise<SessionEnd>((r) => { resolveDone = r; });
  const maxTimer = setTimeout(() => concede('durée maximale atteinte', 'idle'), o.maxMs ?? 90 * 60_000);
  maxTimer.unref?.();
  // délai de lancement (O4.2) : départ propre, sans message dans le chat ni abandon (la partie n'a pas commencé)
  const startTimer = o.startMs !== undefined ? setTimeout(() => {
    if (end || status === 'playing') return;
    log(`partie non lancée par l'hôte au bout de ${Math.round(o.startMs! / 1000)} s : départ`);
    stop('failed', status === 'connecting' ? 'La salle OPTCGSim ne répond pas' : 'L’hôte OPTCGSim n’a pas lancé la partie', false);
  }, o.startMs) : null;
  startTimer?.unref?.();

  const changed = () => { for (const h of handlers) { try { h(); } catch { /* un abonné défaillant ne bloque pas la partie */ } } };
  const game = () => table.game;
  const optsMiroir = (): MirrorOptions | undefined => (game() ? mirrorOptions(combat, game()!) : undefined);
  const ctxCombat = () => ({ mirror: vu!, joyboy: 1 as Seat, object: object ?? undefined });
  const toServer = (n: string, values: Record<string, unknown> = {}): Rpc => ({ name: `${n}ServerRpc`, object: object ?? 0, behaviour: 0, values });

  // ---------- envoi
  function sendRaw(rpcs: Rpc[]) {
    if (!client || !rpcs.length) return;
    stats.sent += rpcs.length;
    clockRef = null;
    client.send(rpcs.map((r) => rpcMessage(r.name, r.values, { object: object ?? undefined })));
  }
  /** Envoie des ServerRpc ; `apply` : les poser sur `vu` (outbound et combat l'ont déjà fait). */
  function send(rpcs: Rpc[], apply: boolean) {
    if (!rpcs.length || end) return;
    if (apply && vu) for (const r of rpcs) vu = applyRpc(vu, r, 1, optsMiroir()).state;
    sendRaw(rpcs);
  }
  function note(list: string[] | undefined, what: string) {
    for (const e of list ?? []) {
      const t = `${what} : ${e}`;
      if (notes.has(t)) continue;
      notes.add(t);
      stats.notes = notes.size;
      log(`écart (${what}) : ${e}`);
    }
    if (notes.size > maxNotes && !end) stop('desync', DESYNC_TEXT, true);
  }
  function shuffle(): Rpc {
    const order = [...Array(vu!.players[1].zones.deck.length).keys()];
    for (let j = 0; j < order.length; j++) { const k = j + randomInt(order.length - j); [order[j], order[k]] = [order[k], order[j]]; }
    return toServer('ShuffleDeck', { s_ShuffleString: order.join('-') });
  }
  function outbound(before: GameState, after: GameState, choice: string | undefined, scope: 'all' | 'self') {
    const out = translateOutbound(vu!, after, { seat: 1, before, choice, scope, object: object ?? undefined, mirror: optsMiroir() });
    note(out.problems, 'outbound');
    send(out.rpcs, false);
    vu = out.mirror;
  }

  /**
   * Lots d'un pas de combat. Les effets des cartes de joy-boy pendant ce pas (ses [En attaquant]) ne sont pas dans
   * `send` : combat.ts dit où ils vont (`effectsBefore`, avant SelectBlocker) et outbound les traduit (correction O2.4-d,
   * essai réel n° 4 : sans eux, le jeu et le moteur ne voyaient plus le même combat).
   */
  function sendCombat(res: { send: Rpc[][]; effectsBefore?: number }, before: GameState | null) {
    const k = res.effectsBefore ?? res.send.length;
    for (const l of res.send.slice(0, k)) send(l, true);
    if (res.effectsBefore !== undefined && before && game()) outbound(before, game()!, undefined, 'all');
    for (const l of res.send.slice(k)) send(l, true);
  }

  /** Garde-fou (O2.4-d) : `ours` = notre chrono (SetTimer), qui ne baisse que quand le jeu attend une action de joy-boy. */
  function watchClock(ours: unknown) {
    if (typeof ours !== 'number' || !vu || !game() || end) return;
    if (actionable() || clockRef === null || ours > clockRef) { clockRef = ours; stuckTold = false; return; }
    if (clockRef - ours < stuckSeconds || stuckTold) return;
    stuckTold = true;
    const e = game()!, d = e.decision;
    log(`session figée depuis ${Math.round(clockRef - ours)} s : tour ${vu.turn} à ${vu.turnPlayer === 1 ? 'joy-boy' : 'l’hôte'}, `
      + `décision ${d ? `${d.player}/${d.kind}${d.tag ? `/${d.tag}` : ''}` : 'aucune'}, combat ${combat.phase}/${combat.step}, `
      + `backlog ${table.backlog.length}, carte retenue ${table.held ? 'oui' : 'non'}`);
    // Une décision montrée au joueur joy-boy n'arrive jamais ici (actionable : chrono remis à zéro) : un humain prend son
    // temps, c'est le chrono d'absence (idleMs) qui s'en charge. Une question d'effet retenue (à joy-boy ou au joueur
    // OPTCGSim) est un écart de la session : on le relève, sans jamais finir le tour au milieu d'un effet.
    if (d?.inEffect) {
      note([`question d'effet (joueur ${d.player}, ${d.tag ?? d.kind}) retenue par la session`], 'garde-fou');
      return;
    }
    if (vu.turnPlayer !== 1) { note(['session figée pendant le tour de l’hôte'], 'garde-fou'); return; }
    stats.unstuck++;
    note([`session figée au tour ${vu.turn} : fin de tour forcée`], 'garde-fou');
    combat = createCombat();
    const fin = d?.player === 1 && d.options.find((x) => x.id === 'end');
    if (fin) {
      table = withGame(table, answerExternal(e, 'end', { joyboy: 1 }), { mirror: optsMiroir() }).table;
      outbound(e, game()!, 'end', 'all');
    } else {
      send([toServer('AttemptingToEndTurn'), toServer('AddLogLine', { s: 'Log.EndTurn', bPlayer: true, s1: '', s2: '', i1: -999, i2: -999 }),
        toServer('EndTurn')], true);
    }
  }

  /** Défaite au temps de `loser` (pendule d'OPTCGSim à 0). L'hôte ne quitte pas la salle : la session conclut elle-même. */
  function timeUp(loser: Seat, why: string) {
    if (end || status !== 'playing') return;
    log(`temps écoulé pour ${loser === 1 ? 'joy-boy' : 'l’hôte'} (${why})`);
    settle({ kind: 'game', winner: loser === 1 ? 0 : 1, resigned: null, reason: loser === 1 ? TIME_UP.me : TIME_UP.opponent }, o.closeDelayMs ?? 2000);
  }
  /**
   * Chrono (SetTimerClientRpc de l'hôte) : `fClientTime` = le nôtre, `fServerTime` = celui de l'hôte. Rend true si la vue
   * doit être renvoyée (premier chrono, l'autre joueur doit agir, 10 s depuis le dernier envoi, fin au temps).
   */
  function onTimer(v: Record<string, unknown>): boolean {
    const me = Number(v.fClientTime), opp = Number(v.fServerTime);
    if (!Number.isFinite(me) || !Number.isFinite(opp) || timerLobby === false) return false;
    const prev = clock;
    const running: Seat | null = !prev ? null : me < prev.me ? 1 : opp < prev.opponent ? 0 : prev.running;
    clock = { me, opponent: opp, running, at: Date.now() };
    if (clockExpiry) { clearTimeout(clockExpiry); clockExpiry = null; }
    if (status === 'playing') {
      if (me <= 0) { timeUp(1, 'chrono à 0'); return true; }
      if (opp <= 0) { timeUp(0, 'chrono à 0'); return true; }
      // l'hôte peut finir la partie au temps sans envoyer le chrono à 0 : plus aucun chrono après la dernière seconde
      const left = running === null ? null : running === 1 ? me : opp;
      if (running !== null && left !== null && left < 5) {
        clockExpiry = setTimeout(() => { clockExpiry = null; timeUp(running, 'plus de chrono après la dernière seconde'); }, (left + 2.5) * 1000);
        clockExpiry.unref?.();
      }
    }
    const loud = !prev || running !== clockShownRunning || Date.now() - clockShownAt >= CLOCK_BROADCAST_MS;
    if (loud) { clockShownAt = Date.now(); clockShownRunning = running; }
    return loud;
  }
  /** Lignes du journal de l'hôte : fin de partie au temps (Log.Win / Log.Lose, puis Log.Timeout). */
  function onHostLog(line: unknown) {
    if (line === 'Log.Win') hostVerdict = 0;
    else if (line === 'Log.Lose') hostVerdict = 1;
    else if (line === 'Log.Timeout') {
      // le perdant : celui dont le chrono est au plus bas (le jeu vient de le voir à 0), sinon le verdict de l'hôte
      const loser: Seat | null = clock ? (clock.me <= clock.opponent ? 1 : 0) : hostVerdict === null ? null : hostVerdict === 0 ? 1 : 0;
      if (loser !== null) timeUp(loser, 'fin de partie d’OPTCGSim');
    }
  }
  /** Chrono et fin au temps (O4.4), pour une RPC de l'hôte. */
  function onClockRpc(r: Rpc, n: string) {
    if (r.name === 'GameStartClientRpc') {
      timerLobby = r.values.bTimerLobby === true;
      if (!timerLobby) clock = null;
    } else if (r.name === 'SetTimerClientRpc') {
      quietTick = !onTimer(r.values);
    } else if (/LogLine/.test(n) && typeof r.values.s === 'string') {
      onHostLog(r.values.s);
    }
  }
  /** Le chrono à l'instant de la vue (le temps de celui qui joue a baissé depuis le dernier SetTimer). */
  function clockView(): SessionClock | null {
    if (timerLobby === false || !clock) return null;
    const running = end ? null : clock.running;
    const spent = running === null ? 0 : Math.max(0, (Date.now() - clock.at) / 1000);
    const round = (x: number) => Math.max(0, Math.round(x * 10) / 10);
    return { me: round(clock.me - (running === 1 ? spent : 0)), opponent: round(clock.opponent - (running === 0 ? spent : 0)), running, at: new Date().toISOString() };
  }

  // ---------- réactions demandées par OPTCGSim (écart n° 2 de O3.2, reaction.ts)
  /** Nos Personnages mis en file par l'hôte (uid du miroir), dans l'ordre reçu. */
  let queued: number[] = [];
  let handBack = false;
  /** Réaction en cours : Personnages encore à traiter (ordre du jeu), à retirer, état du moteur en construction. */
  interface Reaction {
    removal: number; ko: boolean; supported: boolean; victims: number[]; toRemove: number[]; saved: number;
    base: GameState; cur: GameState; step: { replacer: number; victim: number; answers: string[] } | null;
  }
  let reaction: Reaction | null = null;
  function onHostReaction(r: Rpc) {
    const uid = queuedUid(table.mirror, r);
    if (uid !== undefined) { if (!queued.includes(uid)) queued.push(uid); return; }
    const re = reactionOf(r);
    if (!re) return;
    // la suite du lot (TriggerOpponentMultiActions…) passe d'abord
    const t = setTimeout(() => {
      try {
        if (re.forced && r.values.bForcedOpp === true) startForced(r);
        else if (re.forced) refuseForced(re.removal, false);
        else startReaction(re.removal);
      } catch (e) { log(`erreur sur une réaction : ${(e as Error).message}`); stop('desync', DESYNC_TEXT, true); }
      afterChange();
    }, 0);
    t.unref?.();
  }
  /**
   * Repli sûr (écart documenté) : action imposée par un effet OPTCGSim (bForcedOpp) ou offre de [Déclenchement]
   * (bTriggerChance), que joy-boy ne sait pas encore jouer : refusée, et la main est rendue pour ne bloquer personne.
   */
  function refuseForced(removal: number, forcedOpp: boolean) {
    if (end || !game()) return;
    queued = [];
    note([`${forcedOpp ? 'action imposée' : 'offre de [Déclenchement]'} par OPTCGSim (retrait ${removal}) : refusée`], 'réaction');
    if (forcedOpp) handBackForced();
    else send(HAND_BACK.map((n) => toServer(n)), true);
  }
  /** Rendre la main après une action imposée : SwitchTurns puis la liste d'actions (vide), comme le jeu. */
  function handBackForced() {
    send(FORCED_HAND_BACK.map((n) => toServer(n, n === 'TriggerOpponentMultiActions' ? { aTransfer: [], bDontStartAny: false } : {})), true);
  }
  /** Action imposée en cours : genre lu dans le texte de la carte, choix restant à faire, état de départ. */
  let forced: { kind: ForcedKind; left: number; code: string; base: GameState } | null = null;
  /** Carte du deck OPTCGSim (code) d'après l'identifiant OPTCGSim reçu (iActor : (indice de chargement + 1) × 10, 1 = Leader). */
  function hostCardOf(iActor: number): string | null {
    const id = Math.abs(iActor);
    if (id === 1) return table.mirror.players[0].leader.code || null;
    return hostCodes[id / 10 - 1] ?? null;
  }
  function startForced(r: Rpc) {
    if (end || !game() || !vu) return;
    queued = [];
    const code = hostCardOf(Number(r.values.iActor));
    const kind = code ? forcedKindOf(cardData()[code]?.effectEn) : null;
    const e = game()!;
    if (!code || !kind || !forcedOptions(e, kind).length) {
      note([`action imposée par OPTCGSim (${code ?? '?'}, retrait ${String(r.values.eRemoval)}) : ${kind ? 'aucune carte à choisir' : 'genre non reconnu'}, main rendue sans effet`], 'réaction');
      handBackForced();
      return;
    }
    forced = { kind, left: kind.count, code, base: e };
    log(`action imposée par OPTCGSim (${code}) : ${kind.kind === 'discard' ? `défausser ${kind.count}` : `retirer ${kind.count} Personnage(s)`}`);
    askForced();
  }
  function askForced() {
    const F = forced!, e = game()!;
    const options = forcedOptions(e, F.kind);
    if (!F.left || !options.length) { finishForced(); return; }
    const name = cardData()[F.code]?.name ?? F.code;
    const what = F.kind.kind === 'discard' ? 'la carte de ta main à défausser'
      : F.kind.to === 'hand' ? 'le Personnage à renvoyer dans ta main' : F.kind.to === 'deck' ? 'le Personnage à placer au-dessous de ton deck'
        : F.kind.ko ? 'le Personnage à mettre KO' : 'le Personnage à placer dans ta Défausse';
    table = withGame(table, forceDecision(e, { player: 1, prompt: `${name} (ton adversaire OPTCGSim) : choisis ${what}${F.left > 1 ? ` (${F.left} restantes)` : ''}.`, options, tag: 'forced' }), { mirror: optsMiroir() }).table;
  }
  function answerForced(choice: string) {
    const F = forced!;
    const e = game()!;
    const clean = { ...e, decision: F.base.decision };
    table = withGame(table, applyForced(clean, F.kind, Number(choice.split(':')[1])), { mirror: optsMiroir() }).table;
    F.left--;
    askForced();
  }
  function finishForced() {
    const F = forced!;
    forced = null;
    const e = game()!;
    if (e.decision?.tag === 'forced' && !e.decision.inEffect) table = withGame(table, { ...e, decision: F.base.decision }, { mirror: optsMiroir() }).table;
    outbound(F.base, game()!, undefined, 'self');
    handBackForced();
  }
  function startReaction(removal: number) {
    if (end || !game() || !vu) return;
    const how = REMOVAL[removal];
    if (!how) note([`réaction : retrait ${removal} non pris en charge, Personnages laissés en jeu`], 'réaction');
    // ResolvePendingKOs parcourt la file depuis la fin
    reaction = {
      removal, ko: Boolean(how?.ko), supported: Boolean(how), victims: [...queued].reverse(), toRemove: [], saved: 0,
      base: game()!, cur: game()!, step: null,
    };
    queued = [];
    advanceReaction();
  }
  /** Question au joueur joy-boy, sur l'état en construction (la décision du moteur est remise à la fin). */
  function askReaction(spec: ReplacementAsk) {
    const R = reaction!;
    const options = spec.options.map((x) => ({ ...x }));
    table = withGame(table, forceDecision(R.cur, { player: 1, prompt: spec.prompt, options, tag: spec.tag ?? 'replace', ...(spec.cards ? { cards: spec.cards } : {}) }), { mirror: optsMiroir() }).table;
  }
  function advanceReaction() {
    const R = reaction!;
    while (R.victims.length) {
      const v = R.victims[0];
      const f = findField(R.cur, v);
      if (!R.supported || !f) { R.victims.shift(); continue; }
      const options = replacementsFor(R.cur, 1, v, R.ko);
      if (!options.length) { R.toRemove.push(v); R.victims.shift(); continue; }
      const name = cardData()[f.card.num]?.name ?? f.card.num;
      askReaction({
        prompt: `${name} va ${R.ko ? 'être mis KO' : 'quitter le terrain'} à cause d'un effet de ton adversaire OPTCGSim. Utiliser un effet de remplacement ?`,
        options: [...options, { id: 'none', label: 'Non' }], tag: 'replace',
      });
      return;
    }
    // fin : retraits (et leurs [En cas de KO]), puis RPC et main rendue
    const res = resolveQueued(R.cur, R.toRemove, R.removal);
    log(`réaction demandée par OPTCGSim : ${res.removed} Personnage(s) retiré(s), ${R.saved} sauvé(s) par un remplacement`);
    reaction = null;
    table = withGame(table, res.game, { mirror: optsMiroir() }).table;
    // nos zones seulement : le reste de la table est déjà celui du jeu
    outbound(R.base, game()!, undefined, 'self');
    handBack = true;
    maybeHandBack();
  }
  function answerReaction(choice: string) {
    const R = reaction!;
    if (!R.step) {
      const v = R.victims[0];
      if (choice === 'none') { R.toRemove.push(v); R.victims.shift(); advanceReaction(); return; }
      R.step = { replacer: Number(choice.split(':')[1]), victim: v, answers: [] };
    } else R.step.answers.push(choice);
    const r = runReplacement(R.cur, 1, R.step.replacer, R.step.victim, R.step.answers);
    if ('ask' in r) { askReaction(r.ask); return; }
    R.cur = r.game;
    R.saved++;
    R.step = null;
    R.victims.shift();
    advanceReaction();
  }
  /** La main revient à OPTCGSim une fois nos effets ([En cas de KO]) résolus. */
  function maybeHandBack() {
    if (!handBack || end) return;
    const d = game()?.decision;
    if (d?.player === 1 && d.inEffect) return;
    handBack = false;
    send(HAND_BACK.map((n) => toServer(n)), true);
  }

  // ---------- ouverture
  function openGame() {
    if (opening !== 'attente' || !vu) return;
    opening = 'main';
    send([shuffle()], true);
    send([toServer('DrawCard', { iCount: 5 })], true);
  }
  function answerOpening(e: GameState, choice: string) {
    if (opening !== 'main') return;
    opening = 'vies';
    if (choice === 'mulligan') {
      send([toServer('MoveHandToDeck')], true);
      send([shuffle()], true);
      send([toServer('DrawCard', { iCount: 5 })], true);
    }
    const lives = cardData()[e.players[1].leader.num]?.life ?? 5;
    send([toServer('PopulateLifeDeck', { iLifeCount: lives })], true);
  }

  // ---------- décision du joueur joy-boy
  /** La décision lui revient vraiment : rien n'attend OPTCGSim. */
  function actionable(): boolean {
    const e = game(), d = e?.decision;
    if (end || status !== 'playing' || !e || !d || d.player !== 1 || e.winner !== null) return false;
    if (waiting(combat, e, 1)) return false;
    // Mutations en attente : elles ne s'appliquent qu'une fois l'effet en cours du moteur résolu (inbound, drain). Pendant
    // une question d'effet de joy-boy (sa carte : le moteur écarte celles d'OPTCGSim), elles attendent donc sa réponse :
    // la cacher bloquait tout (essai O3.2 du 18 nov., Sanji OP17-082 « pioche 2, défausse 2 » : les échos de la pose et
    // de la pioche restaient en attente, la défausse n'était jamais proposée, le garde-fou finissait le tour).
    if (table.backlog.length && !d.inEffect) return false;
    // la question « garder sa main ? » n'est posée qu'une fois (ouverture jouée en RPC)
    if (d.kind === 'mulligan' && opening !== 'main') return false;
    return true;
  }
  /** Le chrono d'absence part quand une décision lui revient, et seulement pour une nouvelle décision. */
  let idleFor: number | null = null;
  function armIdle() {
    if (!actionable()) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null; idleFor = null;
      return;
    }
    if (idleFor === seq && idleTimer) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleFor = seq;
    idleTimer = setTimeout(() => concede('trop longtemps sans jouer', 'idle'), idleMs);
    idleTimer.unref?.();
  }

  function answer(at: number, choice: string) {
    if (end) throw new SessionError('not_playing', 'La partie est finie');
    if (at !== seq) throw new SessionError('stale', 'Ce coup a déjà été joué');
    if (!actionable()) throw new SessionError('not_your_turn', 'Ce n’est pas à toi de choisir');
    const e = game()!, d = e.decision!;
    if (typeof choice !== 'string' || !d.options.some((x) => x.id === choice)) throw new SessionError('invalid_choice', 'Choix impossible', 400);
    seq++;
    stats.decisions++;
    try {
      if (d.kind === 'mulligan') answerOpening(e, choice);
      else if (forced) { own.push({ id: own.length + 1, state: e, choice }); answerForced(choice); }
      else if (reaction) { own.push({ id: own.length + 1, state: e, choice }); answerReaction(choice); }
      else {
        own.push({ id: own.length + 1, state: e, choice });
        if (routesTo(combat, choice)) {
          const r = combatAnswer(combat, e, choice, ctxCombat());
          combat = r.combat;
          note(r.notes, 'combat');
          table = withGame(table, r.game, { mirror: optsMiroir() }).table;
          sendCombat(r, e);
        } else {
          table = withGame(table, answerExternal(e, choice, { joyboy: 1 }), { mirror: optsMiroir() }).table;
          outbound(e, game()!, choice, 'all');
        }
        maybeHandBack();
      }
    } catch (err) {
      log(`erreur sur une réponse (${d.kind}) : ${(err as Error).message}`);
      stop('desync', DESYNC_TEXT, true);
      return;
    }
    afterChange();
  }

  // ---------- réception
  function onRpc(r: Rpc, sender: Seat) {
    const n = baseName(r.name);
    // le lancement (salle à minuteur ?) arrive avant la table partagée
    if (sender === 0 && r.name === 'GameStartClientRpc') onClockRpc(r, n);
    if (sender === 0 && game()) onHostReaction(r);
    if (sender === 0 && game() && status === 'playing') unblockFor(r, n);
    if (sender === 0 && outgoing && n === 'NoMorePendingActions') {
      const t = setTimeout(() => {
        try { finishOutgoing(); } catch (err) { log(`erreur sur la réponse du joueur OPTCGSim : ${(err as Error).message}`); stop('desync', DESYNC_TEXT, true); }
        afterChange();
      }, 0);
      t.unref?.();
    }
    // 1. combat (avant inbound)
    if (game() && (combat.phase !== 'idle' || COMBAT_RPCS.has(n))) {
      const after = applyRpc(table.mirror, r, sender, optsMiroir());
      if (sender === 0 && vu) vu = applyRpc(vu, r, 0, optsMiroir()).state;
      const res = handleCombatRpc(combat, game()!, r, sender, after.externals, ctxCombat());
      combat = res.combat;
      note(res.notes, 'combat');
      const beforeCombat = game();
      table = withGame(table, res.game, { mirror: optsMiroir() }).table;
      sendCombat(res, beforeCombat);
    } else if (sender === 0 && vu) vu = applyRpc(vu, r, 0, optsMiroir()).state;
    // 2. inbound
    const before = game();
    const res = receive(table, r, sender, { mirror: optsMiroir() });
    table = res.table;
    note(res.errors, 'inbound');
    if (end) return;
    if (!before && game()) {
      const unknown = table.unknown.filter((u) => u.seat === 0);
      if (unknown.length) { refuseUnknown(unknown); return; }
      uncoded = findUncoded();
      extraCards = opponentCardData();
      if (uncoded.length) log(`cartes adverses sans effet codé (la partie continue) : ${uncoded.map((u) => u.code).join(', ')}`);
      vu = structuredClone(table.mirror);
      hostLoad = new Map(table.mirror.players[0].zones.deck.flatMap((c, i) => (c.uid === undefined ? [] : [[c.uid, i] as [number, number]])));
      hostCodes = table.mirror.players[0].zones.deck.map((c) => c.code);
      initial = structuredClone(game()!);
      started = new Date().toISOString();
      status = 'playing';
      if (startTimer) clearTimeout(startTimer);
      message = null;
      log(`table partagée prête (leader adverse ${table.mirror.players[0].leader.code || '?'})`);
    }
    if (!game()) return;
    if (n === 'ChooseTurnOrder') openGame();
    // 3. conséquences d'une RPC de l'hôte (nos échos ne font que confirmer ce que le moteur a déjà)
    if (sender === 0 && opening === 'vies' && game()!.flow.stage !== 'mulligan' && combat.phase === 'idle' && !table.backlog.length && !table.held) {
      outbound(game()!, game()!, undefined, 'self');
    }
    if (sender === 0 && status === 'playing' && opening === 'vies') realignIfNeeded(n);
    if (table.mirror.over) finishGame(table.mirror.over);
    else if (sender === 0 && r.name === 'SetTimerClientRpc') watchClock(r.values.fClientTime);
    if (sender === 0 && r.name !== 'GameStartClientRpc') onClockRpc(r, n);
  }

  function onMessage(m: NgoMessage) {
    if (m.type !== MESSAGE_TYPE.ClientRpc || end) return;
    let r: Rpc;
    try { r = decode(m.payload); } catch (e) { note([`RPC illisible : ${(e as Error).message}`], 'réception'); return; }
    stats.received++;
    const sender: Seat = r.object === object ? 1 : 0;
    const mark = () => `${seq}|${stats.sent}|${stats.notes}|${stats.unstuck}|${message}|${status}`;
    const before = mark();
    quietTick = false;
    try {
      onRpc(r, sender);
    } catch (e) {
      log(`erreur sur ${r.name} : ${(e as Error).message}`);
      stop('desync', DESYNC_TEXT, true);
      return;
    }
    // chrono seul (chaque seconde) : pas de vue renvoyée, sauf s'il a fait bouger autre chose (garde-fou, fin)
    const quiet = quietTick && !end && before === mark();
    quietTick = false;
    afterChange(quiet);
  }

  /** Indice de chargement des cartes du deck OPTCGSim (uid du moteur → iIdx de LoadDeckCard), pour leur identifiant. */
  let hostLoad = new Map<number, number>();
  /** Codes du deck OPTCGSim dans l'ordre de chargement (identifiants OPTCGSim des cartes). */
  let hostCodes: string[] = [];
  /** Remplacement transmis au joueur OPTCGSim (écart n° 3), en attendant qu'il rende la main. */
  let outgoing: { victim: number; replacer: number; trash: number[]; deck: number } | null = null;
  /** Questions d'un effet de joy-boy au joueur OPTCGSim, hors combat (reaction.ts). */
  function opponentQuestions() {
    const e = game();
    if (end || !e || !vu || outgoing || combat.phase !== 'idle' || e.decision?.player !== 0 || !e.decision.inEffect) return;
    const d = e.decision;
    // remplacement d'un Personnage de l'hôte : transmis à OPTCGSim quand on connaît l'action de la carte qui remplace
    if (d.tag === 'replace') {
      const victim = replaceVictim(e);
      const replacer = d.options.find((o) => o.uid !== undefined && OPTCGSIM_REPLACE_ACTION[findField(e, o.uid)?.card.num ?? ''] !== undefined)?.uid;
      const vIdx = victim === null ? -1 : vu.players[0].zones.deploy.findIndex((c) => c.uid === victim);
      const load = replacer === undefined ? undefined : hostLoad.get(replacer);
      if (victim !== null && replacer !== undefined && vIdx >= 0 && load !== undefined) {
        const num = findField(e, replacer)!.card.num;
        const ko = !/quitter le terrain/.test(d.prompt);
        outgoing = { victim, replacer, trash: vu.players[0].zones.trash.map((c) => c.uid ?? -1), deck: vu.players[0].zones.deck.length };
        log(`remplacement transmis au joueur OPTCGSim (${num} pour ${findField(e, victim)?.card.num ?? '?'})`);
        send([
          toServer('QueueOpponentPlayerSaveQueue', { iDeployIdx: vIdx }), toServer('SwitchTurns'), toServer('AllOnKOResolved'),
          toServer('ProcOpponentV3Action', {
            iActor: -uniqueDeckId(load), iAction: OPTCGSIM_REPLACE_ACTION[num], eRemoval: ko ? ALLY_REMOVAL.ko : ALLY_REMOVAL.other,
            bForcedOpp: false, iStartOnStep: 0, iRemovalPlayer: 0, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false,
          }),
          toServer('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false }),
        ], true);
        return;
      }
    }
    const res = answerForOpponent(e);
    if (!res.answered.length) return;
    for (const tag of new Set(res.answered)) note([`question d'effet posée au joueur OPTCGSim (${tag}) : tranchée par joy-boy`], 'repli');
    table = withGame(table, res.game, { mirror: optsMiroir() }).table;
    outbound(e, game()!, undefined, 'all');
  }
  /** Échange deux identifiants de cartes (même numéro) dans les deux miroirs. */
  function relabel(a: number, b: number) {
    for (const m of [table.mirror, vu!]) {
      for (const z of Object.values(m.players[0].zones)) for (const c of z) { if (c.uid === a) c.uid = b; else if (c.uid === b) c.uid = a; }
    }
  }
  /** L'hôte a rendu la main : on reporte dans le moteur ce qu'il a fait (remplacement utilisé ou Personnage parti). */
  function finishOutgoing() {
    const o = outgoing, e = game();
    if (!o || end || !e) return;
    outgoing = null;
    const m = table.mirror.players[0].zones;
    const saved = m.deploy.some((c) => c.uid === o.victim);
    // cartes passées de la Défausse au-dessous du deck (dessous = début de la zone dans le miroir), dans leur ordre d'arrivée
    const added = Math.max(0, m.deck.length - o.deck);
    const moved = m.deck.slice(0, added).reverse().filter((c) => o.trash.includes(c.uid ?? -2));
    log(`réponse du joueur OPTCGSim : ${saved ? `remplacement utilisé (${moved.length} carte(s) de sa Défausse sous son deck)` : 'pas de remplacement, Personnage retiré'}`);
    const g = answerOutgoing(e, o.replacer, saved, saved ? moved.map((c) => c.code) : []);
    // cartes de même numéro : le moteur a pu en choisir une autre que l'hôte (une question par numéro) ; les miroirs
    // prennent l'identifiant du moteur (pour le jeu, c'est la même carte) et les tables restent identiques
    if (saved && !(g.decision?.player === 0 && g.decision.inEffect)) {
      const engBottom = g.players[0].deck.slice(-moved.length).map((c) => c.uid);
      const hostUids = moved.map((c) => c.uid!);
      engBottom.forEach((u, i) => { const h = hostUids[i]; if (h !== undefined && h !== u) relabel(h, u); hostUids.forEach((x, j) => { if (x === u) hostUids[j] = h; }); });
    }
    table = withGame(table, g, { mirror: optsMiroir() }).table;
    outbound(e, game()!, undefined, 'self');
  }


  // ---------- sécurité (Décision 9) : OPTCGSim fait foi, joy-boy s'adapte au lieu de rester bloqué
  // Quand le jeu continue (une RPC de l'hôte qui change la table) alors que le moteur attend encore une décision qui ne
  // peut plus venir (question d'effet en suspens, réaction transmise sans réponse), la session (1) relève un écart daté,
  // (2) termine la décision en suspens par un repli sûr (« Non », sinon un choix par défaut), (3) applique la RPC et, si
  // les deux tables divergent ensuite, réaligne le moteur sur le miroir ; (4) le joueur voit « désynchronisation
  // corrigée ». Seul le seuil d'écarts (Décision 7) arrête la partie.
  /** RPC de l'hôte qui ne changent pas la table, ou font partie d'un échange en cours (réactions). */
  const QUIET = new Set(['SetTimer', 'AddLogLine', 'TranslateLogLine', 'AddChatLine', 'SetCardAbilityUsed', 'AllOnKOResolved',
    'QueueOpponentPlayerSaveQueue', 'QueueOpponentPlayerKOQueue', 'SwitchTurns', 'ProcOpponentV3Action', 'TriggerOpponentMultiActions',
    'ResetActionPhase', 'NoMorePendingActions', 'TellOpponentImResolving']);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function notice(text: string) {
    message = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { noticeTimer = null; if (!end && message === text) { message = null; changed(); } }, 8000);
    noticeTimer.unref?.();
  }
  const stamp = () => `[${new Date().toISOString().slice(11, 19)}] tour ${vu?.turn ?? '?'}`;
  /** L'hôte agit : rien ne doit rester en suspens chez nous qui l'empêcherait d'être suivi. */
  function unblockFor(r: Rpc, n: string) {
    const e = game();
    if (!e || QUIET.has(n)) return;
    const acts = COMBAT_RPCS.has(n) || n === 'EndTurn' || n === 'AttemptingToEndTurn' || applyRpc(table.mirror, r, 0, optsMiroir()).externals.length > 0;
    if (!acts) return;
    // remplacement transmis : on attend ses déplacements, mais pas une fin de tour ou une attaque
    if (outgoing) {
      if (n === 'EndTurn' || n === 'AttemptingToEndTurn' || n === 'SetupAttack') {
        note([`${stamp()} : l'hôte reprend la main (${n}) sans rendre la réaction transmise : réponse prise telle quelle`], 'désynchronisation');
        finishOutgoing();
        notice('Désynchronisation corrigée avec OPTCGSim : la partie continue.');
      }
      return;
    }
    // réaction reçue dont le joueur n'a pas fini les choix : terminée par « Non »
    if (reaction) {
      note([`${stamp()} : l'hôte reprend la main (${n}) pendant la réaction en cours : remplacements refusés`], 'désynchronisation');
      let guard = 0;
      while (reaction && guard++ < 20) {
        const d = game()?.decision;
        const pick = d?.options.find((o) => o.id === 'none') ?? d?.options[0];
        if (!pick) break;
        answerReaction(pick.id);
      }
      notice('Désynchronisation corrigée avec OPTCGSim : la partie continue.');
      return;
    }
    if (combat.phase !== 'idle' || !e.decision?.inEffect) return;
    // question d'effet en suspens (au joueur joy-boy ou au joueur OPTCGSim) : terminée par défaut
    const { game: g, closed } = settlePending(e);
    note([`${stamp()} : l'hôte joue (${n}) alors qu'une question d'effet attendait (joueur ${closed!.player}, ${closed!.tag}) : effet terminé par défaut`], 'désynchronisation');
    seq++;
    table = withGame(table, g, { mirror: optsMiroir() }).table;
    outbound(e, game()!, undefined, 'all');
    if (handBack) maybeHandBack();
    notice('Désynchronisation corrigée avec OPTCGSim : une décision en suspens a été passée, la partie continue.');
  }
  /** Après une RPC de l'hôte : si les tables divergent alors que rien n'est en cours, le moteur suit le miroir. */
  function realignIfNeeded(n: string) {
    const e = game();
    if (!e || !vu || QUIET.has(n) || outgoing || reaction || combat.phase !== 'idle' || e.decision?.inEffect || table.backlog.length || table.held) return;
    if (e.flow.stage === 'mulligan' || e.flow.stage === 'over') return;
    // nos propres zones seulement quand tous nos échos sont revenus (sinon le moteur est simplement en avance)
    const echoesBack = JSON.stringify(vu.players[1].zones) === JSON.stringify(table.mirror.players[1].zones);
    const diff = compareTables(table);
    if (!diff.length) return;
    const seats: Seat[] = echoesBack ? [0, 1] : [0];
    // seulement l'ordre des cartes d'une zone (cartes de même numéro choisies autrement, Défausse dans un autre ordre) :
    // corrigé sans bruit ; une carte qui n'est pas au même endroit est un vrai écart
    const orderOnly = diff.every((x) => /, (deck|défausse|vie) : /.test(x)) && sameMembers(table, seats);
    const res = realign(table, seats);
    if (!res.fixed.length) return;
    table = res.table;
    vu = structuredClone(table.mirror);
    if (orderOnly) { log(`${stamp()} : ordre réaligné sur le jeu (${res.fixed.join(', ')})`); return; }
    note([`${stamp()} : tables différentes après ${n} (${diff.slice(0, 2).join(' ; ')}) : moteur réaligné (${res.fixed.join(', ')})`], 'désynchronisation');
    notice('Désynchronisation corrigée avec OPTCGSim : la table a été réalignée.');
  }
  /** Mêmes cartes dans chaque zone (l'ordre mis à part) entre le miroir et le moteur. */
  function sameMembers(t: CrossTable, seats: Seat[]): boolean {
    const e = t.game!;
    const key = (ids: (number | undefined)[]) => ids.map((x) => x ?? -1).sort((a, b) => a - b).join(',');
    return seats.every((seat) => {
      const m = t.mirror.players[seat].zones, P = e.players[seat];
      return key(m.deck.map((c) => c.uid)) === key(P.deck.map((c) => c.uid)) && key(m.trash.map((c) => c.uid)) === key(P.trash.map((c) => c.uid))
        && key(m.life.map((c) => c.uid)) === key(P.life.map((c) => c.uid));
    });
  }

  function afterChange(quiet = false) {
    try { opponentQuestions(); } catch (err) { log(`erreur sur une question au joueur OPTCGSim : ${(err as Error).message}`); stop('desync', DESYNC_TEXT, true); return; }
    stats.mirrorErrors = table.mirror.errors.length;
    armIdle();
    if (!quiet) changed();
  }

  // ---------- fins
  function settle(e: Omit<SessionEnd, 'at'>, closeAfter: number) {
    if (end) return;
    const stage = status === 'connecting' ? 'connect' : status === 'setup' ? 'setup' : 'playing';
    end = { ...e, at: new Date().toISOString(), stage };
    status = e.kind === 'game' || e.kind === 'concede' || e.kind === 'left' || e.kind === 'idle' ? 'over' : 'stopped';
    if (game()) {
      const s = structuredClone(game()!);
      if (e.winner !== null) s.winner = e.winner;
      if (e.winner !== null || !s.winReason) s.winReason = e.reason;
      s.decision = null;
      s.flow = e.winner !== null ? { stage: 'over' } : s.flow;
      final = s;
    }
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    if (startTimer) clearTimeout(startTimer);
    if (clockExpiry) clearTimeout(clockExpiry);
    if (!transport) abort.abort(); // connexion pas encore établie : on n'attend pas son délai
    // la cause précise de la fin de connexion (transport.ts), pour les diagnostics sans journal RPC (production)
    log(`fin : ${e.kind}, ${e.winner === null ? 'sans vainqueur' : e.winner === 1 ? 'victoire de joy-boy' : 'défaite de joy-boy'}${closedBy ? ` (connexion : ${closedBy})` : ''} (${stats.received} RPC reçues, ${stats.sent} envoyées, ${stats.decisions} décisions, ${stats.notes} écarts)`);
    const t = setTimeout(() => { try { transport?.close(); } catch { /* déjà fermée */ } }, closeAfter);
    t.unref?.();
    resolveDone(end);
    changed();
  }
  function finishGame(over: NonNullable<Mirror['over']>) {
    const winner: Seat = over.loser === 1 ? 0 : 1;
    const why = MIRROR_REASON[over.reason] ?? over.reason;
    const reason = over.reason === 'abandon'
      ? (over.loser === 1 ? 'Tu as abandonné la partie' : 'Ton adversaire OPTCGSim abandonne la partie')
      : `${winner === 1 ? 'Victoire' : 'Défaite'} (${why})`;
    settle({ kind: 'game', winner, resigned: over.reason === 'abandon' ? over.loser : null, reason }, o.closeDelayMs ?? 2000);
  }
  /** Abandon au nom du joueur joy-boy. */
  function concede(reason = 'Tu as abandonné la partie', kind: 'concede' | 'idle' = 'concede') {
    if (end) return;
    if (object != null) sendRaw([toServer('Concede')]);
    if (status !== 'playing') { settle({ kind: 'failed', winner: null, resigned: null, reason: 'Partie quittée avant de commencer' }, 500); return; }
    const text = kind === 'idle' ? `Abandon : ${reason}` : reason;
    settle({ kind, winner: 0, resigned: 1, reason: text }, 500);
  }
  /** Partie arrêtée sans perdant ; `tell` : prévenir le joueur OPTCGSim et concéder pour ne pas le bloquer. */
  function stop(kind: 'desync' | 'lost' | 'failed', reason: string, tell: boolean) {
    if (end) return;
    if (tell && object != null) sendRaw([toServer('AddChatLine', { s: reason }), toServer('Concede')]);
    message = reason;
    settle({ kind, winner: null, resigned: null, reason }, 500);
  }
  /** Décision 4 : relevé (par le serveur, via unknownCards), message aux deux joueurs, abandon. */
  function refuseUnknown(unknown: UnknownCard[]) {
    const codes = [...new Set(unknown.map((u) => u.code))].sort();
    const text = unknownMessage(codes);
    log(`cartes inconnues de joy-boy dans le deck adverse : ${codes.join(', ')}`);
    message = text;
    if (object != null) sendRaw([toServer('AddChatLine', { s: text }), toServer('Concede')]);
    settle({ kind: 'unknown', winner: null, resigned: null, reason: text }, o.closeDelayMs ?? 2000);
  }

  // ---------- connexion et mise en place
  (async () => {
    log(`connexion à une salle ${style} (OPTCGSim ${HANDSHAKE.gameVersion}), leader ${o.deck.leader}`);
    const t = await (o.connect ?? realConnect)(o.code, { ...o.transport, log: o.transport?.log, signal: abort.signal });
    if (end) { t.close(); return; }
    transport = t;
    t.onClose?.((reason) => {
      closedBy = reason;
      if (end) return;
      if (status === 'connecting') {
        // fermée avant l'approbation : salle déjà prise (un client déjà connecté), partie déjà lancée, version ou format
        // refusés (ApprovalCheck d'OPTCGSim, sans raison envoyée) : échec silencieux, une autre salle peut être essayée
        log(`connexion refusée par l'hôte (${reason})`);
        stop('failed', 'Salle OPTCGSim déjà prise ou fermée', false);
        return;
      }
      // Le jeu est parti (transport.ts, LEFT) : Disconnect du Relay ou de SimpleConnection, ou silence alors que le
      // serveur Relay nous répond encore. Décision 7 : abandon du joueur OPTCGSim, victoire du joueur joy-boy, sauf si le
      // moteur avait déjà tranché (coup fatal dont l'écho n'est jamais arrivé). Une vraie coupure de notre côté (LOST) :
      // partie arrêtée sans perdant.
      if (status === 'playing' && reason.includes(LEFT)) {
        log(`l'adversaire est parti (${reason})`);
        const w = game()?.winner;
        if (w === 0 || w === 1) settle({ kind: 'game', winner: w, resigned: null, reason: w === 1 ? 'Victoire' : 'Défaite' }, 0);
        else settle({ kind: 'left', winner: 1, resigned: 0, reason: 'Ton adversaire OPTCGSim a quitté la partie : victoire' }, 0);
      } else stop('lost', status === 'playing' ? 'Connexion perdue avec OPTCGSim : la partie est arrêtée, sans perdant' : `Connexion terminée : ${reason}`, false);
    });
    client = new NetcodeClient(t);
    client.onMessage(onMessage);
    client.onReady(({ playerObject }) => {
      object = playerObject;
      status = 'setup';
      message = 'Connecté : en attente de l’adversaire OPTCGSim…';
      const device = crypto.randomBytes(20).toString('hex');
      const rpc = (n: string, v: Record<string, unknown>) => rpcMessage(n, v, { object: playerObject });
      client!.completeSync([
        rpc('VersionCheckServerRpc', { sVersion: HANDSHAKE.gameVersion }),
        rpc('SetNameServerRpc', { sName: name, bSpectator: false }),
        rpc('MakeEmptyDeckListServerRpc', { iDeckSize: o.deck.cards.length }),
        rpc('LoadLeaderServerRpc', { sCardID: o.deck.leader, sPatron: '', sDeviceID: device, sPlayerName: name, sPlayerID: t.userId ?? '' }),
        ...o.deck.cards.map((c, i) => rpc('LoadDeckCardServerRpc', { sCardID: c, iIdx: i })),
        rpc('SetMyTurnRollServerRpc', { iRoll: 0 }), // tirage 0 : l'hôte gagne et choisit qui commence
      ]);
      changed();
    });
    client.start(style);
    changed();
  })().catch((e: Error) => {
    if (end) return; // session déjà finie (arrêt, délai de lancement) : la connexion annulée n'est pas une erreur
    log(`connexion impossible : ${e.message}`);
    stop('failed', `Impossible de rejoindre la salle : ${e.message}`, false);
  });

  return {
    joinCode,
    deck: o.deck,
    snapshot() {
      const view = joyboyView(table).view;
      let state: GameState | null = view;
      if (final) state = viewFor(final, 1);
      else if (state && !actionable() && state.decision?.player === 1) state = { ...state, decision: null };
      const opp = table.mirror.players[0];
      const clockNow = clockView();
      return {
        status, seq, state,
        opponent: opp.name || opp.leader.code ? { name: opp.name || 'Joueur OPTCGSim', leader: opp.leader.code || null } : null,
        message: end ? end.reason : message,
        unknown: table.unknown.filter((u) => u.seat === 0),
        ...(extraCards ? { cards: extraCards } : {}),
        ...(clockNow ? { clock: clockNow } : {}),
        end,
      };
    },
    answer,
    concede: (reason?: string) => concede(reason),
    onChange(h) { handlers.add(h); return () => { handlers.delete(h); }; },
    initialState: () => initial,
    finalState: () => final,
    moves: () => own,
    unknownCards: () => table.unknown.filter((u) => u.seat === 0),
    uncodedCards: () => uncoded,
    opponentKey() {
      const p = table.mirror.players[0];
      if (!p.name) return null;
      return crypto.createHash('sha256').update(`optcgsim:${p.name}`).digest('base64url').slice(0, 16);
    },
    stats: () => ({ ...stats }),
    startedAt: () => started,
    done,
    close() {
      if (!end) {
        if (status === 'playing') concede('Partie fermée par le serveur');
        else stop('failed', 'Partie fermée', false);
      }
      try { transport?.close(); } catch { /* déjà fermée */ }
    },
  };
}

// ---------------------------------------------------------------------------------------------------- « Mes parties »

/**
 * La partie croisée telle qu'elle est rangée dans « Mes parties » du joueur joy-boy : comme une partie en ligne
 * (mode 'online', réduite à ce qu'il a vu), marquée `crossplay` (pour une vérification plus tard).
 */
export function crossplayRecord(x: {
  id: string; engine: string; startedAt: string; now: Date; endedAt: string; initial: GameState; final: GameState; moves: Move[];
  myDeck: string; myDeckName: string; opponent: string; opponentLeader: string | null; abandoned: boolean;
}): GameRecord & { mode: 'online'; opponent: string; crossplay: true } {
  const rec = buildRecord({
    id: x.id, engine: x.engine, startedAt: x.startedAt, now: x.now.toISOString(), endedAt: x.endedAt,
    config: { myDeck: x.myDeck, aiDeck: 'OPTCGSim', level: 0, first: 'random', myDeckName: x.myDeckName, aiDeckName: `OPTCGSim${x.opponentLeader ? ` · ${x.opponentLeader}` : ''}` },
    human: 1, initial: x.initial, current: x.final, moves: x.moves, reviews: new Map(), extra: new Map(), undos: [], abandoned: x.abandoned,
  });
  const base = x.initial.history.length;
  const kept = new Map<number, number>();
  const steps = x.final.history.slice(base).flatMap((h, i) => {
    const [shown] = historyFor([h], 1);
    if (!shown) return [];
    kept.set(i, kept.size);
    return [shown];
  });
  return {
    ...rec,
    initial: viewFor(x.initial, 1),
    steps,
    decisions: rec.decisions.flatMap((d) => (kept.has(d.step) ? [{ ...d, step: kept.get(d.step)! }] : [])),
    log: rec.log.filter((l) => l.only === undefined || l.only === 1),
    mode: 'online', opponent: x.opponent, crossplay: true,
  };
}
