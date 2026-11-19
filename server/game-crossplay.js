// Parties croisées avec OPTCGSim (étape O, tâche O3.1) : le serveur rejoint la salle d'un joueur OPTCGSim (connexion
// UDP sortante, game/online/optcgsim/session.ts) au nom d'un joueur joy-boy, qui joue dans son navigateur comme une
// partie en ligne : sa vue arrive par un flux SSE, ses choix repartent par /act. La session vit en mémoire du serveur :
// un rechargement du navigateur la retrouve ; un redémarrage du serveur la coupe (le jeu OPTCGSim voit le départ).
// À la fin, la partie est rangée comme une partie en ligne (game_matches, statut 'over' ou 'error', marquée
// `crossplay`, hôte -1 : le joueur OPTCGSim n'a pas de compte) et dans « Mes parties » du joueur : les gains (Berry,
// exploits, missions, prime, classement) passent par le même chemin que les parties en ligne (game-economy.js,
// judgeOnline ; Décision 3 : « une victoire est une victoire »).
// Cartes inconnues de joy-boy dans le deck OPTCGSim (Décision 4) : relevées dans crossplay_unknown_cards (panneau
// d'administration), message aux deux joueurs, abandon ; aucune partie n'est rangée.
// Journal du serveur : jamais de pseudo ni d'identifiant (numéro court de la session seulement).
//   POST /api/game/crossplay                 rejoindre une salle OPTCGSim { code, deck }
//   GET  /api/game/crossplay/current         ma partie croisée en cours (ou null)
//   GET  /api/game/crossplay/:id             ma vue
//   GET  /api/game/crossplay/:id/events      flux de ma vue, à chaque changement
//   POST /api/game/crossplay/:id/act         mon choix { seq, choice }
//   POST /api/game/crossplay/:id/resign      abandonner
//   GET  /api/admin/crossplay/unknown        cartes inconnues relevées (administrateurs)
// Réglage : TCGC_CROSSPLAY_MAX (parties croisées simultanées sur le serveur, 4 par défaut ; 0 les ferme).
// Diagnostic (tâche O3.2) : TCGC_CROSSPLAY_JOURNAL=<dossier hors du dépôt> écrit le journal complet de chaque partie
// (lots NGO, RPC décodées, lignes de la session, bilan), au format du banc, lisible par scripts/optcgsim/anonymiser.mjs.
// Il contient des pseudos et des identifiants Unity : jamais dans le dépôt (refusé), à n'activer que pour les essais.
import '../game/engine/cards/index.ts'; // avant le moteur (00-regles-communes § 6)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { DECKS } from '../game/engine/decks.ts';
import { creerJournal, journaliser } from '../game/online/optcgsim/journal.ts';
import { HANDSHAKE } from '../game/online/optcgsim/netcode.ts';
import { crossplayRecord, SessionError, setOf, startSession } from '../game/online/optcgsim/session.ts';
import { connect as realConnect, parseRoomCode } from '../game/online/optcgsim/transport.ts';
import { rateLimit, requireAdmin } from './auth.js';
import { db } from './db.js';
import { gameCards } from './game-cards.js';
import { player } from './game-online.js';
import { saveRecord } from './game-records.js';
import { ENGINE } from './version.js';

/** Hôte des parties croisées dans game_matches : le joueur OPTCGSim n'a pas de compte joy-boy. */
export const OPTCGSIM_HOST = -1;
const DEFAULT_MAX = 4;
/** Une partie finie reste lisible (écran de fin, gain) pendant ce temps, puis quitte la mémoire. */
const KEEP_ENDED_MS = 30 * 60_000;
const NAME_MAX = 24;

const refuse = (code, message, status = 400) => Object.assign(new Error(message), { code, status, expose: true });

export function crossplayMax() {
  const n = Number(process.env.TCGC_CROSSPLAY_MAX ?? DEFAULT_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Dossier du journal complet des parties (TCGC_CROSSPLAY_JOURNAL), ou null ; refusé dans le dépôt (pseudos). */
export function journalDir() {
  const d = process.env.TCGC_CROSSPLAY_JOURNAL;
  if (!d) return null;
  const abs = path.resolve(d);
  if ((abs + path.sep).toLowerCase().startsWith((REPO + path.sep).toLowerCase())) return null;
  return abs;
}

/** Ouvre le journal complet d'une partie ; null sans dossier ou si le fichier ne peut pas s'ouvrir. */
function openJournal(short, log) {
  const dir = journalDir();
  if (!dir) {
    if (process.env.TCGC_CROSSPLAY_JOURNAL) log(`Partie croisée ${short} : journal refusé (dossier dans le dépôt)`);
    return null;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `site-${new Date().toISOString().replace(/[:.]/g, '-')}-${short}.log`);
    const stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {});
    const j = creerJournal((t) => { if (!stream.writableEnded) stream.write(t); });
    return { file, j, close: () => stream.end() };
  } catch (err) {
    log(`Partie croisée ${short} : journal impossible :`, err.message);
    return null;
  }
}

const sessions = new Map(); // id -> { id, short, s, userId, deck, deckName, createdAt, recordId, streams, ended }

const active = () => [...sessions.values()].filter((e) => !e.ended);
const currentOf = (userId) => active().find((e) => e.userId === userId) ?? null;

function entryOf(userId, id) {
  const e = sessions.get(id);
  if (!e || e.userId !== userId) throw refuse('unknown_match', 'Partie introuvable (le serveur a pu redémarrer)', 404);
  return e;
}

/** Deck joy-boy (registre ou deck perso) au format d'OPTCGSim : le Leader et 50 codes. */
function crossDeck(p) {
  const list = p.list ?? DECKS[p.deck];
  const cards = Object.entries(list.cards).flatMap(([c, n]) => Array(n).fill(c));
  return { leader: list.leader, cards };
}

// ---------- Vue ----------

function payload(e) {
  const v = e.s.snapshot();
  return JSON.stringify({ id: e.id, ...v, you: { name: e.name, deck: e.deck, deckName: e.deckName }, recordId: e.recordId ?? null });
}

function broadcast(e) {
  const data = payload(e);
  for (const res of e.streams) res.write(`data: ${data}\n\n`);
}

setInterval(() => {
  for (const e of sessions.values()) for (const res of e.streams) res.write(': ping\n\n');
}, 25_000).unref();

// ---------- Fin de partie ----------

/**
 * Décisions 4 et 8 : une ligne par code, le nombre de parties concernées augmente à chaque partie. `uncoded` : carte
 * connue de joy-boy mais sans effet codé (la partie a continué) ; sinon carte inconnue (la partie a été concédée).
 */
export function noteUnknown(unknown, now = new Date(), uncoded = false) {
  const at = now.toISOString();
  const up = db.prepare(`INSERT INTO crossplay_unknown_cards (code, set_code, games, copies, uncoded, first_seen, last_seen) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET games = games + 1, copies = MAX(copies, excluded.copies), uncoded = excluded.uncoded, last_seen = excluded.last_seen`);
  const byCode = new Map();
  for (const u of unknown) byCode.set(u.code, (byCode.get(u.code) ?? 0) + u.count);
  for (const [code, copies] of byCode) up.run(code, setOf(code), copies, uncoded ? 1 : 0, at, at);
}

export function unknownCards() {
  return db.prepare(`SELECT code, set_code AS "set", games, copies, uncoded, first_seen AS firstSeen, last_seen AS lastSeen
    FROM crossplay_unknown_cards ORDER BY uncoded, games DESC, code`).all().map((r) => ({ ...r, uncoded: Number(r.uncoded) === 1 }));
}

const stampOf = (iso) => {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date(iso);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

/** La partie finie, rangée comme une partie en ligne (game_matches) et dans « Mes parties » du joueur. */
function archive(e, end, log, now = new Date()) {
  const s = e.s;
  const initial = s.initialState(), final = s.finalState(), startedAt = s.startedAt();
  if (!initial || !final || !startedAt) return;
  const snap = s.snapshot();
  const opp = snap.opponent ?? { name: 'Joueur OPTCGSim', leader: null };
  const st = s.stats();
  const m = {
    id: e.id, code: null,
    host: { userId: OPTCGSIM_HOST, name: opp.name, deck: 'OPTCGSim' },
    guest: { userId: e.userId, name: e.name, deck: e.deck, ...(e.list ? { list: e.list } : {}) },
    status: end.winner === null ? 'error' : 'over',
    engine: ENGINE, initial, state: final,
    createdAt: e.createdAt, updatedAt: end.at, expiresAt: null, startedAt, endedAt: end.at,
    // marque « croisée » : de quoi ajouter une vérification plus tard (Décision 3) sans perdre l'historique
    crossplay: {
      version: HANDSHAKE.gameVersion, opponent: s.opponentKey(), opponentLeader: opp.leader, end: end.kind, resigned: end.resigned,
      stats: { received: st.received, sent: st.sent, decisions: st.decisions, notes: st.notes, mirrorErrors: st.mirrorErrors },
    },
    ...(end.winner === null ? { failure: { seat: 1, seq: snap.seq, choice: '', message: end.reason, at: end.at } } : {}),
  };
  db.prepare(`INSERT INTO game_matches (id, code, host_id, guest_id, status, data, created_at, updated_at, expires_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL)`)
    .run(m.id, OPTCGSIM_HOST, e.userId, m.status, zlib.gzipSync(JSON.stringify(m)), m.createdAt, m.updatedAt);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(e.userId)) return;
  try {
    const rec = crossplayRecord({
      id: `${stampOf(startedAt)}_${e.deck}-contre-OPTCGSim_croisee`, engine: ENGINE, startedAt, now, endedAt: end.at,
      initial, final, moves: s.moves(), myDeck: e.deck, myDeckName: e.deckName, opponent: opp.name, opponentLeader: opp.leader,
      abandoned: m.status !== 'over',
    });
    saveRecord(e.userId, rec.id, rec, JSON.stringify(rec));
    e.recordId = rec.id;
  } catch (err) {
    log(`Partie croisée ${e.short} : enregistrement impossible :`, err.message);
  }
}

function ended(e, end, log) {
  e.ended = true;
  if (e.journal) {
    const st = e.s.stats();
    e.journal.j.ligne('BILAN', JSON.stringify({ issue: `${end.kind} : ${end.reason}`, winner: end.winner, ...st, cartesInconnues: e.s.unknownCards().map((u) => u.code) }));
    setTimeout(() => e.journal.close(), 2500).unref(); // les derniers lots (abandon, fermeture) passent encore
  }
  try {
    if (end.kind === 'unknown') noteUnknown(e.s.unknownCards());
    else archive(e, end, log);
    if (e.s.uncodedCards().length) noteUnknown(e.s.uncodedCards(), new Date(), true);
  } catch (err) {
    log(`Partie croisée ${e.short} : fin mal enregistrée :`, err.message);
  }
  log(`Partie croisée ${e.short} finie : ${end.kind}, ${end.winner === null ? 'sans vainqueur' : end.winner === 1 ? 'victoire du joueur joy-boy' : 'défaite du joueur joy-boy'}`);
  broadcast(e);
  setTimeout(() => {
    for (const res of e.streams) res.end();
    sessions.delete(e.id);
  }, KEEP_ENDED_MS).unref();
}

// ---------- Sessions ----------

/**
 * Rejoindre une salle OPTCGSim. options : connect / transport (faux transport des tests), idleMs, randomInt (mélanges
 * tirés d'avance, tests), log.
 */
export function joinCrossplay(user, body, { log = console.log, connect, transport, idleMs, randomInt } = {}) {
  const code = String(body?.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  try { parseRoomCode(code); } catch { throw refuse('bad_code', 'Code de salle OPTCGSim illisible : il commence par P, W, E… (celui que montre OPTCGSim)'); }
  if (code.length < 5) throw refuse('bad_code', 'Code de salle OPTCGSim trop court');
  const mine = currentOf(user.id);
  if (mine) throw Object.assign(refuse('already_playing', 'Tu as déjà une partie OPTCGSim en cours', 409), { id: mine.id });
  if (active().length >= crossplayMax()) throw refuse('busy', 'Trop de parties OPTCGSim en cours sur le serveur : réessaie dans quelques minutes', 503);
  const p = player(user, body?.deck); // deck vérifié (deck perso du compte, deck d'aventure : Cale relue)
  const id = crypto.randomBytes(16).toString('base64url');
  const short = id.slice(0, 6);
  const name = (p.name || 'joy-boy').slice(0, NAME_MAX);
  const e = {
    id, short, userId: user.id, name, deck: p.deck, deckName: p.list?.name ?? DECKS[p.deck]?.name ?? p.deck, list: p.list,
    createdAt: new Date().toISOString(), recordId: null, streams: new Set(), ended: false, s: null,
  };
  const journal = openJournal(short, log);
  const deck = crossDeck(p);
  let joined = connect;
  if (journal) {
    journal.j.ligne(`Partie croisée ${short} (site) : salle ${code[0]}…, OPTCGSim ${HANDSHAKE.gameVersion}, deck ${p.deck} (leader ${deck.leader})`);
    const base = connect ?? realConnect;
    joined = async (c, opts) => journaliser(await base(c, { ...opts, log: (l) => { journal.j.ligne(l); opts?.log?.(l); } }), journal.j);
    e.journal = journal;
  }
  e.s = startSession({
    code, deck, name, connect: joined, transport, idleMs, randomInt,
    log: (line) => { log(`Partie croisée ${short} : ${line}`); journal?.j.ligne(`>>> ${line}`); },
  });
  sessions.set(id, e);
  e.s.onChange(() => broadcast(e));
  e.s.done.then((end) => ended(e, end, log));
  log(`Partie croisée ${short} : un joueur rejoint une salle OPTCGSim${journal ? ` (journal : ${path.basename(journal.file)})` : ''}`);
  return e;
}

/** Ferme toutes les sessions (arrêt du serveur, tests). */
export function closeAllCrossplay() {
  for (const e of sessions.values()) if (!e.ended) e.s.close();
}

// (tests)
export const crossplaySession = (id) => sessions.get(id) ?? null;

// ---------- Routes (le compte est déjà vérifié par requireUser) ----------

function sessionError(err) {
  if (err instanceof SessionError) throw refuse(err.code, err.message, err.status);
  throw err;
}

export function crossplayRoutes(app, options = {}) {
  const log = options.log ?? console.log;

  app.get('/api/admin/crossplay/unknown', requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(unknownCards());
  });

  app.post('/api/game/crossplay', (req, res) => {
    rateLimit(`crossplay:${req.user.id}`, 20, 10 * 60_000);
    if (!gameCards()) throw refuse('cards_loading', 'Informations des cartes en cours de téléchargement, réessaie dans un instant', 503);
    try {
      const e = joinCrossplay(req.user, req.body, { ...options, log });
      res.status(201).type('application/json').send(payload(e));
    } catch (err) {
      if (err.code === 'already_playing') return res.status(409).json({ code: err.code, error: err.message, id: err.id });
      throw err;
    }
  });

  app.get('/api/game/crossplay/current', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const e = currentOf(req.user.id);
    res.json(e ? { id: e.id, status: e.s.snapshot().status, deck: e.deck, deckName: e.deckName } : null);
  });

  app.get('/api/game/crossplay/:id', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(payload(entryOf(req.user.id, req.params.id)));
  });

  app.get('/api/game/crossplay/:id/events', (req, res) => {
    const e = entryOf(req.user.id, req.params.id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // trois flux au plus par partie (onglets, connexions mortes pas encore signalées) : le plus ancien est fermé
    while (e.streams.size >= 3) {
      const [old] = e.streams;
      e.streams.delete(old);
      old.end();
    }
    e.streams.add(res);
    res.write('retry: 3000\n\n');
    res.write(`data: ${payload(e)}\n\n`);
    req.on('close', () => e.streams.delete(res));
  });

  app.post('/api/game/crossplay/:id/act', (req, res) => {
    rateLimit(`act:${req.user.id}`, 300, 60_000);
    const e = entryOf(req.user.id, req.params.id);
    try { e.s.answer(Number(req.body?.seq), req.body?.choice); } catch (err) { sessionError(err); }
    res.json({ ok: true, seq: e.s.snapshot().seq });
  });

  app.post('/api/game/crossplay/:id/resign', (req, res) => {
    const e = entryOf(req.user.id, req.params.id);
    e.s.concede();
    res.json({ ok: true });
  });
}
