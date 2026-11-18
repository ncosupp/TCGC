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
import { cardData } from '../../engine/cards/index.ts'; // avant le moteur (00-regles-communes § 6)
import type { GameState } from '../../engine/types.ts';
import { historyFor, viewFor } from '../../engine/view.ts';
import {
  COMBAT_RPCS, combatAnswer, createCombat, handleCombatRpc, mirrorOptions, routesTo, waiting, type CombatState,
} from './combat.ts';
import { answerExternal } from './external.ts';
import { createTable, joyboyView, receive, withGame, type CrossTable, type UnknownCard } from './inbound.ts';
import { applyRpc, baseName, type Mirror, type MirrorOptions } from './mirror.ts';
import { HANDSHAKE, MESSAGE_TYPE, NetcodeClient, type NgoMessage } from './netcode.ts';
import { translateOutbound } from './outbound.ts';
import { decode, rpcMessage } from './rpc.ts';
import { connect as realConnect, parseRoomCode, type Transport, type TransportOptions } from './transport.ts';
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
}

/** Bilan sans données personnelles, pour le journal du serveur. */
export interface SessionStats { received: number; sent: number; decisions: number; notes: number; mirrorErrors: number; unstuck: number }

export interface SessionOptions {
  /** Code de la salle OPTCGSim (« P… », « W… », « E… »…). */
  code: string;
  deck: CrossDeck;
  /** Pseudo affiché dans OPTCGSim. */
  name: string;
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
const DESYNC_TEXT = 'joy-boy et OPTCGSim ne voient plus la même table : la partie est arrêtée, sans perdant. Désolé !';
const MIRROR_REASON: Record<string, string> = {
  'touché sans vie': 'Leader touché sans Vie', abandon: 'abandon', effet: 'effet d’une carte',
};

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

  let status: SessionStatus = 'connecting';
  let message: string | null = 'Connexion à la salle OPTCGSim…';
  let transport: Transport | null = null, client: NetcodeClient | null = null, object: number | null = null;
  let table: CrossTable = createTable({ joyboy: 1 });
  let combat: CombatState = createCombat();
  let vu: Mirror | null = null;
  let opening: 'attente' | 'main' | 'vies' = 'attente';
  let initial: GameState | null = null, final: GameState | null = null, started: string | null = null;
  let seq = 0, end: SessionEnd | null = null, idleTimer: ReturnType<typeof setTimeout> | null = null;
  const own: Move[] = [];
  const notes = new Set<string>();
  const stats: SessionStats = { received: 0, sent: 0, decisions: 0, notes: 0, mirrorErrors: 0, unstuck: 0 };
  const stuckSeconds = o.stuckSeconds ?? 20;
  let clockRef: number | null = null, stuckTold = false;
  let resolveDone!: (e: SessionEnd) => void;
  const done = new Promise<SessionEnd>((r) => { resolveDone = r; });
  const maxTimer = setTimeout(() => concede('durée maximale atteinte', 'idle'), o.maxMs ?? 90 * 60_000);
  maxTimer.unref?.();

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
    if (vu.turnPlayer !== 1) { note(['session figée pendant le tour de l’hôte'], 'garde-fou'); return; }
    stats.unstuck++;
    note([`session figée au tour ${vu.turn} : fin de tour forcée`], 'garde-fou');
    combat = createCombat();
    const fin = d?.player === 1 && !d.inEffect && d.options.find((x) => x.id === 'end');
    if (fin) {
      table = withGame(table, answerExternal(e, 'end', { joyboy: 1 }), { mirror: optsMiroir() }).table;
      outbound(e, game()!, 'end', 'all');
    } else {
      send([toServer('AttemptingToEndTurn'), toServer('AddLogLine', { s: 'Log.EndTurn', bPlayer: true, s1: '', s2: '', i1: -999, i2: -999 }),
        toServer('EndTurn')], true);
    }
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
    if (table.backlog.length || waiting(combat, e, 1)) return false;
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
      vu = structuredClone(table.mirror);
      initial = structuredClone(game()!);
      started = new Date().toISOString();
      status = 'playing';
      message = null;
      log(`table partagée prête (leader adverse ${table.mirror.players[0].leader.code || '?'})`);
    }
    if (!game()) return;
    if (n === 'ChooseTurnOrder') openGame();
    // 3. conséquences d'une RPC de l'hôte (nos échos ne font que confirmer ce que le moteur a déjà)
    if (sender === 0 && opening === 'vies' && game()!.flow.stage !== 'mulligan' && combat.phase === 'idle' && !table.backlog.length && !table.held) {
      outbound(game()!, game()!, undefined, 'self');
    }
    if (table.mirror.over) finishGame(table.mirror.over);
    else if (sender === 0 && r.name === 'SetTimerClientRpc') watchClock(r.values.fClientTime);
  }

  function onMessage(m: NgoMessage) {
    if (m.type !== MESSAGE_TYPE.ClientRpc || end) return;
    let r: Rpc;
    try { r = decode(m.payload); } catch (e) { note([`RPC illisible : ${(e as Error).message}`], 'réception'); return; }
    stats.received++;
    const sender: Seat = r.object === object ? 1 : 0;
    try {
      onRpc(r, sender);
    } catch (e) {
      log(`erreur sur ${r.name} : ${(e as Error).message}`);
      stop('desync', DESYNC_TEXT, true);
      return;
    }
    afterChange();
  }

  function afterChange() {
    stats.mirrorErrors = table.mirror.errors.length;
    armIdle();
    changed();
  }

  // ---------- fins
  function settle(e: Omit<SessionEnd, 'at'>, closeAfter: number) {
    if (end) return;
    end = { ...e, at: new Date().toISOString() };
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
    log(`fin : ${e.kind}, ${e.winner === null ? 'sans vainqueur' : e.winner === 1 ? 'victoire de joy-boy' : 'défaite de joy-boy'} (${stats.received} RPC reçues, ${stats.sent} envoyées, ${stats.decisions} décisions, ${stats.notes} écarts)`);
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
    const t = await (o.connect ?? realConnect)(o.code, { ...o.transport, log: o.transport?.log });
    if (end) { t.close(); return; }
    transport = t;
    t.onClose?.((reason) => {
      if (end) return;
      if (status === 'playing' && /quitté la salle/.test(reason)) {
        // le jeu a quitté la salle : abandon du joueur OPTCGSim, sauf si le moteur avait déjà tranché (coup fatal dont
        // l'écho n'est jamais arrivé)
        const w = game()?.winner;
        if (w === 0 || w === 1) settle({ kind: 'game', winner: w, resigned: null, reason: w === 1 ? 'Victoire' : 'Défaite' }, 0);
        else settle({ kind: 'left', winner: 1, resigned: 0, reason: 'Ton adversaire OPTCGSim a quitté la partie' }, 0);
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
        rpc('SetNameServerRpc', { sName: o.name, bSpectator: false }),
        rpc('MakeEmptyDeckListServerRpc', { iDeckSize: o.deck.cards.length }),
        rpc('LoadLeaderServerRpc', { sCardID: o.deck.leader, sPatron: '', sDeviceID: device, sPlayerName: o.name, sPlayerID: t.userId ?? '' }),
        ...o.deck.cards.map((c, i) => rpc('LoadDeckCardServerRpc', { sCardID: c, iIdx: i })),
        rpc('SetMyTurnRollServerRpc', { iRoll: 0 }), // tirage 0 : l'hôte gagne et choisit qui commence
      ]);
      changed();
    });
    client.start(style);
    changed();
  })().catch((e: Error) => {
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
      return {
        status, seq, state,
        opponent: opp.name || opp.leader.code ? { name: opp.name || 'Joueur OPTCGSim', leader: opp.leader.code || null } : null,
        message: end ? end.reason : message,
        unknown: table.unknown.filter((u) => u.seat === 0),
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
