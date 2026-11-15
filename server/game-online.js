// Parties en ligne entre deux joueurs (onglet Jouer) : salle avec un code à transmettre à un ami, partie arbitrée par
// le serveur (game/online/match.ts), envoi en temps réel de la vue de chaque joueur par un flux SSE (Server-Sent
// Events). Le flux passe par le bloc nginx existant : pas de tampon (X-Accel-Buffering) et un signe de vie toutes les
// 25 s, sous le délai de 120 s de nginx.
// Un deck d'aventure (mode 'aventure', cartes de la Cale) n'entre dans une partie que si son joueur possède encore toutes
// ses cartes (holdErrors, relu dans la Cale au moment de créer la salle et au moment où la partie commence).
//   POST /api/game/matches                 créer une salle { deck, public? }
//   GET  /api/game/matches/open            les salles publiques en attente (des autres joueurs)
//   POST /api/game/matches/join            rejoindre une salle { code, deck }
//   GET  /api/game/matches/current         mes salles et parties en cours
//   GET  /api/game/matches/:id             ma vue de la partie
//   GET  /api/game/matches/:id/events      flux de ma vue, à chaque changement
//   POST /api/game/matches/:id/act         mon choix { seq, choice }
//   POST /api/game/matches/:id/resign      abandonner
//   POST /api/game/matches/:id/cancel      fermer ma salle en attente
//   POST /api/game/matches/:id/rematch     proposer ou accepter la revanche d'une partie finie (étape J)
//   POST /api/game/matches/:id/react       une réaction prédéfinie { reaction } (étape J)
//   POST   /api/game/queue                 trouver un adversaire { deck } : rejoint un joueur qui attend, sinon attend
//   DELETE /api/game/queue                 quitter la file
//   GET    /api/game/queue/stats           joueurs passés en ligne aujourd'hui, joueurs qui attendent
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  checkClock, checkDeck, CODE_ALPHABET, CODE_RE, createMatch, idle, IDLE_DAYS, isReaction, joinMatch, MatchError, offerRematch, openRoomOf, play,
  recordFor, rematchFirst, resign, seatOf, stop, viewOf, WAIT_MINUTES,
} from '../game/online/match.ts';
import { ipKey, rateLimit } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { deckLooks, deckOf, holdErrors } from './game-decks.js';
import { gameCards } from './game-cards.js';
import { saveRecord } from './game-records.js';
import { ENGINE } from './version.js';

// ---------- Stockage : en mémoire pendant la partie, dans la base après chaque coup ----------

const live = new Map(); // id -> partie

function save(m) {
  db.prepare(`INSERT INTO game_matches (id, code, host_id, guest_id, status, data, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET code = excluded.code, guest_id = excluded.guest_id, status = excluded.status,
      data = excluded.data, updated_at = excluded.updated_at, expires_at = excluded.expires_at`)
    .run(m.id, m.code, m.host.userId, m.guest?.userId ?? null, m.status, zlib.gzipSync(JSON.stringify(m)), m.createdAt, m.updatedAt, m.expiresAt);
  live.set(m.id, m);
}

// Une partie, depuis la mémoire ou la base (après un redémarrage du serveur, elle reprend où elle en était)
function load(id) {
  if (live.has(id)) return live.get(id);
  const row = typeof id === 'string' ? db.prepare('SELECT data FROM game_matches WHERE id = ?').get(id) : null;
  if (!row) return null;
  const m = JSON.parse(zlib.gunzipSync(Buffer.from(row.data)).toString('utf8'));
  live.set(m.id, m);
  return m;
}

// (tests)
export const loadMatch = (id) => load(id);

// Partie dont le compte connecté est l'un des joueurs
function mine(req) {
  return mineOf(req.user.id, req.params.id);
}

function mineOf(userId, id) {
  const m = load(id);
  const seat = m ? seatOf(m, userId) : null;
  if (!m || seat === null) throw new MatchError('unknown_match', 'Partie introuvable', 404);
  return { m, seat };
}

function newCode() {
  for (let i = 0; i < 20; i++) {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
    if (!db.prepare("SELECT 1 FROM game_matches WHERE code = ? AND status = 'waiting'").get(code)) return code;
  }
  throw new MatchError('busy', 'Réessaie dans un instant', 503);
}

function requireCards() {
  if (!gameCards()) throw new MatchError('cards_loading', 'Informations des cartes en cours de téléchargement, réessaie dans un instant', 503);
}

// Problèmes d'un deck d'aventure : cartes qui manquent dans la Cale de son joueur (échangées depuis, par exemple)
function holdProblems(p) {
  return p.hold ? holdErrors(p.userId, p.list.leader, p.list.cards) : [];
}

// Premier problème (et le nombre des autres) ; others : message pour l'autre joueur (« sa Cale » au lieu de « ta Cale »)
function holdMessage(errors, others = false) {
  const more = errors.length > 1 ? ` (et ${errors.length - 1} autre${errors.length > 2 ? 's' : ''})` : '';
  return `${others ? errors[0].replace(/ta Cale/g, 'sa Cale') : errors[0]}${more}`;
}

// Deck personnalisé : relu dans la base (seulement ceux du compte) ; sa liste reste côté serveur. Un deck d'aventure est
// refusé s'il lui manque des cartes. Ses visuels (looks) sont gardés à part : la liste jouée par le moteur n'en a pas.
// Nom montré à l'adversaire pour un compte d'essai (son pseudo technique, « ~essai-… », ne lui dit rien)
export const GUEST_NAME = 'Invité';

export function player(user, deck) {
  const saved = typeof deck === 'string' && deck.startsWith('PERSO-') ? deckOf(user.id, deck) : null;
  const looks = saved ? deckLooks(user.id, saved) : {};
  const list = saved ? { ...saved } : undefined;
  if (list) delete list.looks;
  const p = {
    userId: user.id, name: user.guest ? GUEST_NAME : user.pseudo, deck: checkDeck(deck, list), ...(list ? { list } : {}), ...(list?.mode === 'aventure' ? { hold: true } : {}),
    ...(Object.keys(looks).length ? { looks } : {}),
  };
  const errors = holdProblems(p);
  if (errors.length) {
    throw new MatchError('hold_incomplete', `Il manque des cartes dans ta Cale pour jouer « ${list.name} » : ${holdMessage(errors)}. `
      + 'Elles ont pu être échangées contre des Berry : corrige le deck dans « Mes decks » ou choisis-en un autre.', 409);
  }
  return p;
}

// ---------- Temps réel ----------

const streams = new Map(); // id -> Set<{ seat, userId, res, at }>

// Flux ouverts en même temps par un compte, toutes parties confondues : au-delà, le plus ancien est fermé (souvent une
// connexion morte que le réseau n'a pas encore signalée ; un onglet bien vivant se reconnecte tout seul)
export const MAX_STREAMS_PER_USER = 6;
let streamCounter = 0;

function makeRoom(userId) {
  const own = [];
  for (const set of streams.values()) for (const x of set) if (x.userId === userId) own.push(x);
  own.sort((a, b) => a.at - b.at);
  for (const x of own.slice(0, Math.max(0, own.length - MAX_STREAMS_PER_USER + 1))) x.close();
}

// Nombre de flux ouverts par un compte (tests)
export function streamCount(userId) {
  let n = 0;
  for (const set of streams.values()) for (const x of set) if (x.userId === userId) n++;
  return n;
}

const online = (id, seat) => [...(streams.get(id) ?? [])].some((x) => x.seat === seat);

// Dernière réaction de chaque partie (en mémoire seulement : elle ne sert qu'à l'instant)
const reactions = new Map(); // id -> { seat, reaction, n }

function payload(m, seat) {
  const r = reactions.get(m.id);
  return JSON.stringify({ ...viewOf(m, seat), opponentOnline: online(m.id, seat === 0 ? 1 : 0), ...(r ? { reaction: r } : {}) });
}

function broadcast(m) {
  for (const x of streams.get(m.id) ?? []) x.res.write(`data: ${payload(m, x.seat)}\n\n`);
}

setInterval(() => {
  for (const set of streams.values()) for (const x of set) x.res.write(': ping\n\n');
}, 25_000).unref();

// ---------- Fin de partie : rangée dans « Mes parties » des deux joueurs ----------

function archive(m, log) {
  const now = new Date();
  for (const seat of [0, 1]) {
    const userId = seat === 0 ? m.host.userId : m.guest?.userId;
    if (!userId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) continue;
    try {
      const rec = recordFor(m, seat, now);
      saveRecord(userId, rec.id, rec, JSON.stringify(rec));
    } catch (err) {
      log(`Partie en ligne ${m.id} : enregistrement impossible pour le joueur ${seat} :`, err.message);
    }
  }
}

// Chrono : les parties dont le joueur qui doit jouer n'a plus de temps se finissent (vérifié toutes les 5 s)
export function checkClocks(log = console.log, now = new Date()) {
  for (const m of live.values()) {
    if (m.status !== 'playing' || !checkClock(m, now)) continue;
    save(m);
    broadcast(m);
    archive(m, log);
    log(`Partie en ligne ${m.id} : ${m.state.winReason}`);
  }
}

// Compte supprimé : ses salles et parties en ligne disparaissent
export function forgetUser(userId) {
  for (const [id, m] of live) if (m.host.userId === userId || m.guest?.userId === userId) live.delete(id);
  db.prepare('DELETE FROM game_matches WHERE host_id = ? OR guest_id = ?').run(userId, userId);
}

// ---------- Salles ----------

function close(m, status, now) {
  m.status = status;
  m.code = null;
  m.updatedAt = now.toISOString();
  save(m);
  broadcast(m);
}

// Créer une salle : le compte en est l'hôte ; isPublic : la salle est listée pour tous (« Salles publiques »)
export function openRoom(user, deck, now = new Date(), isPublic = false) {
  const host = player(user, deck);  // deck vérifié d'abord : un deck refusé ne ferme pas la salle en cours
  // une seule salle en attente par compte : la précédente est fermée
  for (const row of db.prepare("SELECT id FROM game_matches WHERE host_id = ? AND status = 'waiting'").all(user.id)) {
    close(load(row.id), 'cancelled', now);
  }
  const m = createMatch(crypto.randomBytes(16).toString('base64url'), newCode(), host, now, ENGINE);
  if (isPublic) m.public = true;
  save(m);
  return m;
}

// Les salles publiques en attente, sauf celles du compte (les plus récentes d'abord, 30 au plus)
export function openRooms(userId, now = new Date()) {
  const rows = db.prepare(`SELECT id FROM game_matches WHERE status = 'waiting' AND host_id != ? AND expires_at > ?
    ORDER BY created_at DESC LIMIT 60`).all(userId, now.toISOString());
  return rows.map((r) => load(r.id)).map((m) => (m ? openRoomOf(m) : null)).filter(Boolean).slice(0, 30);
}

// État secret du générateur de la partie (128 bits, game/engine/rng.ts) : il ne quitte jamais le serveur
function secretSeed() {
  const bytes = crypto.randomBytes(16);
  return [0, 4, 8, 12].map((i) => bytes.readUInt32LE(i));
}

// Rejoindre la salle d'un ami avec son code : la partie commence
export function enterRoom(user, rawCode, deck, now = new Date()) {
  const code = String(rawCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const row = CODE_RE.test(code) ? db.prepare("SELECT id FROM game_matches WHERE code = ? AND status = 'waiting'").get(code) : null;
  if (!row) throw new MatchError('unknown_room', 'Aucune salle ouverte avec ce code', 404);
  const m = load(row.id);
  const guest = player(user, deck);
  // l'hôte a pu échanger des cartes de son deck d'aventure depuis l'ouverture de la salle : elle se ferme
  const hostErrors = guest.userId === m.host.userId ? [] : holdProblems(m.host);
  if (hostErrors.length) {
    close(m, 'cancelled', now);
    throw new MatchError('host_hold_incomplete', `${m.host.name} n'a plus toutes les cartes de son deck d'aventure (${holdMessage(hostErrors, true)}) : `
      + 'la salle est fermée. Demande-lui d’en ouvrir une nouvelle.', 409);
  }
  joinMatch(m, guest, now, secretSeed());
  save(m);
  broadcast(m);
  return m;
}

// Abandonner : la partie est finie et rangée dans « Mes parties » des deux joueurs
export function giveUp(user, id, log, now = new Date()) {
  const { m, seat } = mineOf(user.id, id);
  resign(m, seat, now);
  save(m);
  broadcast(m);
  archive(m, log);
  return m;
}

// Un choix d'un joueur, arbitré par le moteur. Une erreur du moteur arrête la partie sans perdant (statut 'error',
// game/online/match.ts) : elle est journalisée avec de quoi la rejouer (la partie complète reste dans game_matches,
// avec l'état d'avant le choix, et le choix dans failure) ; les deux joueurs la voient arrêtée et la retrouvent dans
// « Mes parties », sans gain.
export function playMove(user, id, seq, choice, log, now = new Date()) {
  const { m, seat } = mineOf(user.id, id);
  play(m, seat, Number(seq), choice, now);
  save(m);
  broadcast(m);
  if (m.status === 'over') {
    archive(m, log);
    log(`Partie en ligne terminée : ${m.host.name} contre ${m.guest.name}, ${m.state.winReason}`);
  } else if (m.status === 'error') {
    const f = m.failure;
    const d = m.state.decision;
    log(`Partie en ligne ${m.id} arrêtée par une erreur du moteur (${m.host.name} contre ${m.guest.name}, tour ${m.state.turn}, `
      + `coup ${f.seq}, joueur ${f.seat}, décision ${d?.kind ?? '?'}${d?.tag ? ` / ${d.tag}` : ''}, choix « ${f.choice} ») : ${f.message}`);
    if (f.stack) log(f.stack);
    log(`  la partie complète (état d'avant le choix et choix) est gardée dans game_matches, id ${m.id}, statut error`);
    archive(m, log);
  }
  return m;
}

// Flux temps réel d'un joueur : sa vue à chaque changement. Renvoie la fonction qui le retire (connexion fermée).
export function attachStream(m, seat, userId, res) {
  makeRoom(userId);
  let open = true;
  const detach = () => {
    if (!open) return;
    open = false;
    const set = streams.get(m.id);
    set?.delete(entry);
    if (set && !set.size) streams.delete(m.id);
    const current = live.get(m.id);
    if (current) broadcast(current); // l'adversaire voit que je suis parti
    // partie finie que plus personne ne regarde : elle quitte la mémoire (relue dans la base au besoin)
    if (current && !streams.has(m.id) && current.status !== 'waiting' && current.status !== 'playing') live.delete(m.id);
  };
  const entry = { seat, userId, res, at: ++streamCounter, close: () => { detach(); res.end(); } };
  if (!streams.has(m.id)) streams.set(m.id, new Set());
  streams.get(m.id).add(entry);
  res.write('retry: 3000\n\n');
  broadcast(m); // ma vue, et à l'adversaire : je suis là
  return detach;
}

// ---------- File d'attente « Trouver un adversaire » (étape J) ----------

const waitingQueueRooms = (where, args, now) => db.prepare(`SELECT id FROM game_matches WHERE status = 'waiting' AND expires_at > ? ${where}
  ORDER BY created_at`).all(now.toISOString(), ...args).map((r) => load(r.id)).filter((m) => m && m.queue);

// Entrer dans la file : un autre joueur attend, on rejoint sa salle (le plus ancien d'abord) ; sinon on attend dans sa
// propre salle de file (gardée et renouvelée si on y est déjà avec le même deck)
export function enterQueue(user, deck, now = new Date()) {
  const me = player(user, deck);   // deck vérifié d'abord
  for (const m of waitingQueueRooms('AND host_id != ?', [user.id], now)) {
    if (holdProblems(m.host).length) {
      close(m, 'cancelled', now);
      continue;
    }
    for (const mine of waitingQueueRooms('AND host_id = ?', [user.id], now)) close(mine, 'cancelled', now);
    joinMatch(m, me, now, secretSeed());
    save(m);
    broadcast(m);
    return { status: 'matched', id: m.id };
  }
  const [mine] = waitingQueueRooms('AND host_id = ?', [user.id], now);
  if (mine && mine.host.deck === me.deck) {
    mine.expiresAt = new Date(now.getTime() + WAIT_MINUTES * 60_000).toISOString();
    save(mine);
    return { status: 'waiting', id: mine.id, since: mine.createdAt };
  }
  const m = openRoom(user, deck, now, false);
  m.queue = true;
  save(m);
  return { status: 'waiting', id: m.id, since: m.createdAt };
}

export function leaveQueue(user, now = new Date()) {
  for (const m of waitingQueueRooms('AND host_id = ?', [user.id], now)) close(m, 'cancelled', now);
}

// Joueurs passés en ligne depuis 24 h (parties commencées), et joueurs qui attendent dans la file en ce moment
export function queueStats(userId, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const today = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT host_id AS u FROM game_matches WHERE updated_at > ? AND guest_id IS NOT NULL
    UNION SELECT guest_id FROM game_matches WHERE updated_at > ? AND guest_id IS NOT NULL)`).get(since, since).n;
  const waiting = waitingQueueRooms('AND host_id != ?', [userId], now).length;
  return { today, waiting };
}

// ---------- Revanche ----------

// Les deux joueurs l'ont demandée : nouvelle partie, mêmes decks (revérifiés), celui qui avait joué second commence
export function askRematch(user, id, now = new Date()) {
  const { m, seat } = mineOf(user.id, id);
  if (m.rematch?.next) return m;
  if (offerRematch(m, seat)) {
    const hostErrors = holdProblems(m.host);
    const guestErrors = holdProblems(m.guest);
    if (hostErrors.length || guestErrors.length) {
      m.rematch.offers = [];
      save(m);
      broadcast(m);
      throw new MatchError('hold_incomplete', 'Un deck d’aventure n’a plus toutes ses cartes : la revanche est impossible avec ces decks', 409);
    }
    const next = createMatch(crypto.randomBytes(16).toString('base64url'), newCode(), m.host, now, ENGINE);
    joinMatch(next, m.guest, now, secretSeed(), { first: rematchFirst(m) });
    save(next);
    m.rematch.next = next.id;
  }
  save(m);
  broadcast(m);
  return m;
}

// ---------- Routes (le compte est déjà vérifié par requireUser) ----------

export function onlineRoutes(app, { log }) {
  setInterval(() => checkClocks(log), 5000).unref();

  app.post('/api/game/queue', (req, res) => {
    rateLimit(`queue:${req.user.id}`, 60, 10 * 60_000);
    requireCards();
    const r = enterQueue(req.user, req.body?.deck);
    if (r.status === 'matched') log(`File d'attente : ${req.user.pseudo} trouve un adversaire`);
    res.json(r);
  });
  app.delete('/api/game/queue', (req, res) => {
    leaveQueue(req.user);
    res.json({ ok: true });
  });
  app.get('/api/game/queue/stats', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(queueStats(req.user.id));
  });
  app.post('/api/game/matches/:id/rematch', (req, res) => {
    rateLimit(`rematch:${req.user.id}`, 30, 10 * 60_000);
    const m = askRematch(req.user, req.params.id);
    res.json({ ok: true, next: m.rematch?.next ?? null });
  });
  app.post('/api/game/matches/:id/react', (req, res) => {
    const { m, seat } = mine(req);
    if (m.status !== 'playing' && m.status !== 'over') throw new MatchError('not_playing', 'La partie n’est pas en cours', 409);
    if (!isReaction(req.body?.reaction)) throw new MatchError('bad_reaction', 'Réaction inconnue');
    // une réaction toutes les 4 secondes au plus
    try { rateLimit(`react:${req.user.id}`, 1, 4000); } catch { throw new MatchError('rate_limited', 'Une réaction à la fois', 429); }
    const prev = reactions.get(m.id);
    reactions.set(m.id, { seat, reaction: req.body.reaction, n: (prev?.n ?? 0) + 1 });
    broadcast(m);
    res.json({ ok: true });
  });

  app.post('/api/game/matches', (req, res) => {
    rateLimit(`room:${req.user.id}`, 20, 10 * 60_000);
    requireCards();
    const m = openRoom(req.user, req.body?.deck, new Date(), req.body?.public === true);
    log(`Salle ${m.public ? 'publique ' : ''}${m.code} créée par ${req.user.pseudo}`);
    res.status(201).json(viewOf(m, 0));
  });

  app.post('/api/game/matches/join', (req, res) => {
    // un code se devine difficilement (près d'un milliard de possibilités) ; les essais sont limités
    rateLimit(`join:${req.user.id}`, 20, 10 * 60_000);
    rateLimit(`join-ip:${ipKey(req)}`, 40, 10 * 60_000);
    requireCards();
    const m = enterRoom(req.user, req.body?.code, req.body?.deck);
    log(`Partie en ligne : ${m.host.name} contre ${m.guest.name}`);
    res.json(viewOf(m, 1));
  });

  app.get('/api/game/matches/open', (req, res) => {
    rateLimit(`open:${req.user.id}`, 120, 10 * 60_000);
    res.setHeader('Cache-Control', 'no-store');
    res.json(openRooms(req.user.id));
  });

  app.get('/api/game/matches/current', (req, res) => {
    const rows = db.prepare(`SELECT id FROM game_matches WHERE (host_id = ? OR guest_id = ?) AND status IN ('waiting', 'playing')
      ORDER BY updated_at DESC LIMIT 5`).all(req.user.id, req.user.id);
    const now = new Date().toISOString();
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map((r) => load(r.id)).filter((m) => m && !(m.status === 'waiting' && m.expiresAt < now)).map((m) => {
      const seat = seatOf(m, req.user.id);
      const opp = seat === 0 ? m.guest : m.host;
      const me = seat === 0 ? m.host : m.guest;
      return { id: m.id, status: m.status, code: seat === 0 ? m.code : null, opponent: opp?.name ?? null, deck: me.deck, deckName: me.list?.name ?? null, hold: me.hold === true, ...(m.queue ? { queue: true } : {}) };
    }));
  });

  app.get('/api/game/matches/:id', (req, res) => {
    const { m, seat } = mine(req);
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(payload(m, seat));
  });

  app.get('/api/game/matches/:id/events', (req, res) => {
    const { m, seat } = mine(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    req.on('close', attachStream(m, seat, req.user.id, res));
  });

  app.post('/api/game/matches/:id/act', (req, res) => {
    rateLimit(`act:${req.user.id}`, 300, 60_000);
    const m = playMove(req.user, req.params.id, req.body?.seq, req.body?.choice, log);
    res.json({ ok: true, seq: m.state.history.length });
  });

  app.post('/api/game/matches/:id/resign', (req, res) => {
    giveUp(req.user, req.params.id, log);
    res.json({ ok: true });
  });

  app.post('/api/game/matches/:id/cancel', (req, res) => {
    const { m, seat } = mine(req);
    if (seat !== 0 || m.status !== 'waiting') throw new MatchError('not_waiting', 'Cette salle ne peut plus être fermée', 409);
    m.status = 'cancelled';
    m.code = null;
    m.updatedAt = new Date().toISOString();
    save(m);
    broadcast(m);
    res.json({ ok: true });
  });
}

// Salles en attente dont le délai est passé : fermées ; parties en cours où personne n'a joué depuis IDLE_DAYS jours :
// arrêtées sans perdant, rangées dans « Mes parties » des deux joueurs, et retirées de la mémoire (vérifié toutes les
// heures)
export function expireRooms(log = console.log, at = new Date()) {
  const now = at.toISOString();
  const cutoff = new Date(at.getTime() - IDLE_DAYS * 86_400_000).toISOString();
  for (const row of db.prepare("SELECT id FROM game_matches WHERE status = 'playing' AND updated_at < ?").all(cutoff)) {
    const m = load(row.id);
    if (!m || !idle(m, at)) continue;
    stop(m, 'abandoned', at);
    save(m);
    broadcast(m);
    archive(m, log);
    log(`Partie en ligne ${m.id} (${m.host.name} contre ${m.guest?.name}) arrêtée : aucun coup depuis ${IDLE_DAYS} jours`);
  }
  for (const row of db.prepare("SELECT id FROM game_matches WHERE status = 'waiting' AND expires_at < ?").all(now)) {
    const m = load(row.id);
    m.status = 'expired';
    m.code = null;
    save(m);
    broadcast(m);
  }
  // les parties finies quittent la mémoire
  for (const [id, m] of live) if (m.status !== 'waiting' && m.status !== 'playing' && !streams.has(id)) live.delete(id);
}
