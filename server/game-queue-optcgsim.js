// Repli de la file « Trouver un adversaire » sur les salles publiques d'OPTCGSim (étape O, tâche O4.3 ; étude
// Plan-aventure/etudes/crossplay-partie-rapide.md, § 4 et 6, et consignes O4.3 du 19 nov.).
//
// Un joueur joy-boy qui attend dans la file depuis TCGC_CROSSPLAY_FILE_DELAI (10 s), présent sur l'écran de recherche,
// est envoyé dans la première salle publique OPTCGSim libre (Western, version gelée) : joy-boy ne crée jamais de salle,
// il ne fait que rejoindre. La file joy-boy reste prioritaire : avant chaque essai, un autre joueur joy-boy visible
// dans la file passe devant.
//
// - Une seule boucle pour tout le serveur (toutes les 500 ms tant que quelqu'un attend), pas une minuterie par joueur.
// - Un seul éclaireur (LobbyScout, O4.1) : une lecture de la liste toutes les 5 s au plus, seulement si un joueur
//   présent attend depuis 8 s (lecture faite un peu avant le premier essai, à 10 s).
// - Passages : à 10 s, puis toutes les 5 s ; les joueurs sont servis du plus ancien au plus récent, une salle chacun,
//   réservée en mémoire (code -> compte) avant la connexion et rendue à la fin de l'essai.
// - Essai : la salle de file est mise de côté (invisible des autres joueurs), joinCrossplay part (compte présenté sous
//   `<pseudo>#NNNN`, 45 s pour que l'hôte lance, 8 s pour se connecter). Partie lancée → la salle de file est fermée
//   (« partie OPTCGSim ») ; échec avant la partie (stage 'connect' ou 'setup') → salle en quarantaine 5 min, salle
//   suivante (3 essais au plus par passage), sans rien dire au joueur.
// - Annulation (DELETE /api/game/queue) : l'essai est coupé (connexion annulée, réservation rendue).
// - Présence : GET /api/game/queue?present=1|0 (toutes les 3 s, navigateur) ; repli seulement si la dernière
//   interrogation date de moins de 6 s et dit present=1.
//
//   GET /api/game/queue    { status: 'waiting' | 'matched' | 'optcgsim' | 'none', id, since, phase, delaiMs }
//
// Réglages : TCGC_CROSSPLAY_FILE (1 par défaut ; 0 coupe le repli), TCGC_CROSSPLAY_FILE_DELAI (secondes, 10),
// TCGC_CROSSPLAY_FILE_FORMATS (Western), TCGC_CROSSPLAY_FILE_FILTRE (serveur d'essai seulement : ne viser que les salles
// dont le nom contient ce texte), TCGC_CROSSPLAY_FILE_ESSAI=1 (serveur d'essai seulement : une salle inventée et une
// connexion qui échoue au bout de 2 s, pour voir les phases sans contacter Unity). Le plafond TCGC_CROSSPLAY_MAX est
// partagé avec les parties par code.
// Journal : jamais de pseudo ni de code de salle complet.
import { DEFAULT_STYLES, LobbyScout } from '../game/online/optcgsim/lobbies.ts';
import { crossplayRefusal, joinCrossplay } from './game-crossplay.js';
import {
  closeQueueForOptcgsim, matchQueued, queueRooms, queueRoomWaiting, queueStatus, setQueueAside, setQueueHooks,
} from './game-online.js';

const PRODUCTION = () => process.env.NODE_ENV === 'production';

/** Repli permis (TCGC_CROSSPLAY_FILE, 1 par défaut). */
export function fallbackEnabled() {
  const raw = process.env.TCGC_CROSSPLAY_FILE?.trim();
  return !(raw === '0' || raw?.toLowerCase() === 'non' || raw?.toLowerCase() === 'false');
}

/** Délai avant le repli, en ms (TCGC_CROSSPLAY_FILE_DELAI en secondes, 10 par défaut). */
export function fallbackDelayMs() {
  const raw = process.env.TCGC_CROSSPLAY_FILE_DELAI?.trim();
  const n = Number(raw ? raw : 10);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : 10_000;
}

/** Formats visés (TCGC_CROSSPLAY_FILE_FORMATS, « Western » par défaut). */
export function fallbackStyles() {
  const raw = process.env.TCGC_CROSSPLAY_FILE_FORMATS?.trim();
  const list = raw ? raw.split(/[,; ]+/).map((s) => s.trim()).filter(Boolean) : [];
  return list.length ? list : [...DEFAULT_STYLES];
}

/** Filtre sur le nom des salles (serveur d'essai seulement ; ignoré en production). */
export function fallbackFilter() {
  const raw = process.env.TCGC_CROSSPLAY_FILE_FILTRE?.trim();
  return raw && !PRODUCTION() ? raw : undefined;
}

/** Mode d'essai sans Unity (TCGC_CROSSPLAY_FILE_ESSAI=1), refusé en production. */
export function trialMode() {
  return process.env.TCGC_CROSSPLAY_FILE_ESSAI?.trim() === '1' && !PRODUCTION();
}

export const PASS_MS = 5000;          // un passage toutes les 5 s après le délai
export const PREFETCH_MS = 2000;      // lecture de la liste 2 s avant le premier passage (8 s)
export const PRESENCE_MS = 6000;      // interrogation de moins de 6 s
export const QUARANTINE_MS = 5 * 60_000;
export const ATTEMPTS_PER_PASS = 3;
export const START_MS = 45_000;
export const CONNECT_TIMEOUT_MS = 8000;
const TICK_MS = 500;

// ---------- Mode d'essai : salle inventée, connexion qui échoue (aucun accès à Unity) ----------

/** Éclaireur d'essai : une salle Western inventée, dont le code change toutes les 30 s (la quarantaine n'épuise pas l'essai). */
export function trialScout(now = Date.now) {
  return {
    async rooms({ exclude = [] } = {}) {
      const bucket = Math.floor(now() / 30_000) % 100_000;
      const code = `WESSAI${String(bucket).padStart(5, '0')}`;
      const ex = new Set(exclude);
      if (ex.has(code)) return [];
      const at = new Date(now()).toISOString();
      return [{ lobbyId: `essai-${bucket}`, code, style: 'Western', version: '1.45b', cardData: '0', timed: true, leader: null, created: at, lastUpdated: at }];
    },
    state: () => ({ pausedUntil: null, lastError: null }),
  };
}

/** Connexion d'essai : échoue au bout de 2 s (ou tout de suite si elle est annulée). */
export function trialConnect(code, opts = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('salle d’essai (TCGC_CROSSPLAY_FILE_ESSAI) : connexion refusée')), 2000);
    opts.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('connexion annulée')); }, { once: true });
  });
}

// ---------- Le repli ----------

/**
 * Crée le repli. options (tests) : now (horloge en ms), scout (faux éclaireur : `rooms({ exclude, only })`), connect et
 * transport (faux transport), randomInt, log, loop (false : pas de minuterie, les tests appellent `tick()`).
 */
export function createQueueFallback(options = {}) {
  const log = options.log ?? console.log;
  const now = options.now ?? Date.now;
  const loopOn = options.loop !== false;

  const presence = new Map();     // userId -> { at, present, user }
  const reserved = new Map();     // code de salle OPTCGSim -> userId
  const quarantine = new Map();   // code -> fin de quarantaine (ms)
  const nextPass = new Map();     // id de la salle de file -> prochain passage (ms)
  const prefetched = new Set();   // salles de file dont la lecture anticipée est faite
  const trials = new Map();       // userId -> { roomId, cancelled, entry, promise }
  let scout = options.scout ?? null;
  let timer = null, ticking = false;

  function theScout() {
    if (options.scout) return options.scout;
    if (trialMode()) return (scout ??= trialScout(now));
    // un seul éclaireur pour tout le serveur, créé à la première demande ; sous node --test, sans faux fetch, il rend []
    return (scout ??= new LobbyScout({ styles: fallbackStyles(), log: (l) => log(`File OPTCGSim : ${l}`) }));
  }
  const connectFn = () => options.connect ?? (trialMode() ? trialConnect : undefined);

  function quarantined(t) {
    for (const [code, until] of quarantine) if (until <= t) quarantine.delete(code);
    return [...quarantine.keys()];
  }
  const excluded = (t) => [...reserved.keys(), ...quarantined(t)];

  function isPresent(userId, t) {
    const p = presence.get(userId);
    return Boolean(p && p.present && t - p.at < PRESENCE_MS);
  }

  async function freeRooms(t) {
    const list = await theScout().rooms({ exclude: excluded(t), only: fallbackFilter() });
    const ex = new Set(excluded(t));
    return list.filter((r) => !ex.has(r.code));
  }

  // ----- un essai (async, la boucle ne l'attend pas)

  /** Attend que la session soit lancée ('playing') ou finie. */
  function outcome(e) {
    return new Promise((resolve) => {
      let off = () => {};
      const check = () => { if (e.s.snapshot().status === 'playing') { off(); resolve({ playing: true }); } };
      off = e.s.onChange(check);
      check();
      e.s.done.then((end) => { off(); resolve({ playing: false, end }); });
    });
  }

  async function runTrial(room, user, first, trial) {
    let candidate = first;
    for (let attempt = 0; attempt < ATTEMPTS_PER_PASS && !trial.cancelled; attempt++) {
      const t = now();
      if (attempt > 0) {
        // la file joy-boy d'abord : un joueur arrivé pendant l'essai passe devant OPTCGSim
        if (matchQueued(room.id, new Date(t))) { log('File OPTCGSim : un joueur joy-boy est arrivé pendant l’essai, partie joy-boy'); return; }
        candidate = (await freeRooms(t))[0] ?? null;
        if (trial.cancelled) break;
      }
      if (!candidate) break;
      if (!queueRoomWaiting(room.id, new Date(now()))) break;
      const code = candidate.code;
      reserved.set(code, user.id);
      let e;
      try {
        e = joinCrossplay(user, { code, deck: room.deck }, {
          log, origin: 'file', account: user.id, startMs: START_MS, connect: connectFn(),
          transport: { ...options.transport, timeoutMs: CONNECT_TIMEOUT_MS }, randomInt: options.randomInt,
          onEnd: () => { if (reserved.get(code) === user.id) reserved.delete(code); },
        });
      } catch (err) {
        reserved.delete(code);
        log(`File OPTCGSim : essai impossible (${err.code ?? err.message})`);
        break; // deck refusé, serveur plein, partie déjà en cours : on n'insiste pas pendant ce passage
      }
      trial.entry = e;
      if (trial.cancelled) e.s.close();
      const r = await outcome(e);
      trial.entry = null;
      if (r.playing) {
        if (trial.cancelled) { e.s.close(); return; }
        closeQueueForOptcgsim(room.id, e.id, new Date(now()));
        log(`File OPTCGSim : partie lancée dans une salle ${candidate.style} (session ${e.short})`);
        return;
      }
      if (reserved.get(code) === user.id) reserved.delete(code);
      if (trial.cancelled) break;
      if (r.end.stage !== 'playing') quarantine.set(code, now() + QUARANTINE_MS);
      log(`File OPTCGSim : salle ${code[0]}… ${r.end.stage === 'connect' ? 'injoignable ou déjà prise' : 'non lancée'} (${r.end.kind}), salle suivante`);
      candidate = null;
    }
  }

  function startTrial(room, user, first) {
    const trial = { roomId: room.id, cancelled: false, entry: null, promise: null };
    trials.set(user.id, trial);
    setQueueAside(room.id, true);
    trial.promise = runTrial(room, user, first, trial)
      .catch((err) => log('File OPTCGSim : essai en erreur :', err.message))
      .finally(() => {
        trials.delete(user.id);
        setQueueAside(room.id, false); // sans effet si la salle est fermée (partie lancée, joueur parti, partie joy-boy)
        nextPass.set(room.id, now() + PASS_MS);
      });
    return trial;
  }

  // ----- la boucle

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const t = now();
      const date = new Date(t);
      const rooms = queueRooms(date);
      const ids = new Set(rooms.map((r) => r.id));
      for (const id of nextPass.keys()) if (!ids.has(id)) nextPass.delete(id);
      for (const id of prefetched) if (!ids.has(id)) prefetched.delete(id);
      if (!rooms.length && !trials.size) { stopLoop(); return; }
      if (!fallbackEnabled()) return;
      const delay = fallbackDelayMs();
      const visible = rooms.filter((r) => !r.aside && !trials.has(r.userId));
      const ready = visible.filter((r) => isPresent(r.userId, t));
      // lecture anticipée : un joueur présent attend depuis 8 s
      const early = ready.filter((r) => t - Date.parse(r.since) >= delay - PREFETCH_MS && !prefetched.has(r.id));
      if (early.length) {
        for (const r of early) prefetched.add(r.id);
        if (early.some((r) => t - Date.parse(r.since) < delay) && crossplayRefusal(-1) !== 'busy') await freeRooms(t);
      }
      const due = ready.filter((r) => t - Date.parse(r.since) >= delay && t >= (nextPass.get(r.id) ?? 0));
      let free = null;
      for (const r of due) {
        // la file joy-boy d'abord (un autre joueur visible ?), puis OPTCGSim
        if (!queueRoomWaiting(r.id, date) || trials.has(r.userId)) continue;
        if (matchQueued(r.id, date)) { log('File OPTCGSim : deux joueurs joy-boy réunis par la file'); continue; }
        nextPass.set(r.id, t + PASS_MS);
        const refusal = crossplayRefusal(r.userId);
        if (refusal) continue; // plafond atteint ou partie croisée déjà en cours : pas d'essai
        free ??= await freeRooms(t);
        const pick = free.find((x) => !reserved.has(x.code));
        if (!pick) continue; // moins de salles que de joueurs : les plus anciens passent
        if (!queueRoomWaiting(r.id, new Date(now())) || !isPresent(r.userId, now())) continue; // parti pendant la lecture
        // la réservation est posée tout de suite par l'essai (partie synchrone de runTrial) : le joueur suivant ne vise
        // pas la même salle
        startTrial(r, presence.get(r.userId).user, pick);
      }
    } catch (err) {
      log('File OPTCGSim : boucle en erreur :', err.message);
    } finally {
      ticking = false;
    }
  }

  function ensureLoop() {
    if (!loopOn || timer) return;
    timer = setInterval(() => { void tick(); }, TICK_MS);
    timer.unref?.();
  }
  function stopLoop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // ----- ce que voient les routes

  /** Une interrogation du navigateur (ou une entrée dans la file) : présence notée, boucle relancée. */
  function seen(user, present) {
    if (present !== undefined) presence.set(user.id, { at: now(), present: Boolean(present), user: { id: user.id, pseudo: user.pseudo, guest: user.guest } });
    ensureLoop();
  }

  /** Départ de la file : l'essai en cours est coupé (connexion annulée, réservation rendue par la fin de session). */
  function leave(user) {
    const trial = trials.get(user.id);
    if (!trial) return;
    trial.cancelled = true;
    trial.entry?.s.close();
  }

  /** Réponse de GET /api/game/queue. */
  function status(userId) {
    const t = now();
    const q = queueStatus(userId, new Date(t));
    // repli coupé (TCGC_CROSSPLAY_FILE=0) : delaiMs 0, la page n'annonce ni décompte ni salle OPTCGSim
    const delaiMs = fallbackEnabled() ? fallbackDelayMs() : 0;
    let phase = null;
    if (q.status === 'waiting') {
      if (!fallbackEnabled()) phase = 'joyboy';
      else if (trials.has(userId) || q.aside) phase = 'optcgsim-connexion';
      else phase = t - Date.parse(q.since) >= delaiMs ? 'optcgsim-recherche' : 'joyboy';
    }
    return { status: q.status, id: q.id, since: q.since, phase, delaiMs };
  }

  function install() {
    setQueueHooks({ enter: (user, present) => seen(user, present), leave: (user) => leave(user) });
  }

  return {
    tick, seen, leave, status, install, ensureLoop, stopLoop, looping: () => Boolean(timer),
    /** (tests) réservations, quarantaine, essais en cours, et attente de la fin des essais en cours. */
    reservations: () => new Map(reserved),
    quarantined: () => quarantined(now()),
    trialOf: (userId) => trials.get(userId) ?? null,
    settled: () => Promise.all([...trials.values()].map((x) => x.promise)),
  };
}

// ---------- Routes (le compte est déjà vérifié par requireUser) ----------

let shared = null;

export function queueFallbackRoutes(app, { log = console.log } = {}) {
  if (trialMode()) log('File OPTCGSim : mode d’essai (TCGC_CROSSPLAY_FILE_ESSAI=1) : salle inventée, aucune connexion à Unity');
  else if (process.env.TCGC_CROSSPLAY_FILE_ESSAI?.trim() === '1') log('File OPTCGSim : TCGC_CROSSPLAY_FILE_ESSAI refusé en production');
  shared = createQueueFallback({ log });
  shared.install();

  app.get('/api/game/queue', (req, res) => {
    const p = req.query?.present;
    shared.seen(req.user, p === '1' ? true : p === '0' ? false : undefined);
    res.setHeader('Cache-Control', 'no-store');
    res.json(shared.status(req.user.id));
  });
}
