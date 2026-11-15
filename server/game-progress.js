// Progression du joueur (étape J) : prime, exploits et missions, calculés à la lecture à partir des données déjà
// vérifiées par le serveur. Rien de ce que dit le navigateur n'entre dans le calcul :
//   - journal des Berry (game_ledger) : une ligne « partie » par partie rejouée et vérifiée (claimReward), avec son mode
//     (ia, chapitre, guidee, en-ligne), le résultat, l'adversaire (« ia:<deck>:<niveau> ») et le Leader joué ;
//   - chapitres gagnés (game_progress), Cale (game_inventory), boosters ouverts (game_boosters).
// Récupérer une récompense écrit une ligne du journal par credit() (raison « exploit » ou « mission ») : l'index unique
// du journal garantit qu'elle ne compte qu'une fois. Définitions et montants : game/progress/catalog.ts.
//   GET  /api/game/progress                 prime, exploits, missions du jour et de la semaine, profil
//   POST /api/game/exploits/:id/claim       récupérer la récompense d'un exploit obtenu
//   POST /api/game/missions/:id/claim       récupérer la récompense d'une mission remplie (« jour:gagner-1 », « semaine »)
//   PUT  /api/game/profile                  titre affiché et Leader favori { title, leader }
import crypto from 'node:crypto';
import { cardData } from '../game/engine/cards/index.ts';
import { ARCS } from '../game/adventure/arcs.ts';
import { arcFinished } from '../game/adventure/progress.ts';
import { BOOSTER_SETS } from '../game/boosters/sets/index.ts';
import {
  BOUNTY, BOUNTY_RANKS, COLOR_NAMES, COLORS, EXPLOITS, MISSIONS, MISSIONS_PER_DAY, RANK_BERRY, WEEKLY_MISSION, exploitById, rankOf,
} from '../game/progress/catalog.ts';
import { rateLimit } from './auth.js';
import { db, transaction } from './db.js';
import { addBoosters, credit, newBoosterId, parisDay, weekStart } from './game-economy.js';
import { refuse } from './game-verify.js';

// Rareté de base d'une carte : celle de la description des boosters, sinon celle du catalogue
const BOOSTER_RARITY = new Map();
for (const s of Object.values(BOOSTER_SETS)) {
  for (const [rarity, list] of Object.entries(s.cards)) for (const number of list) BOOSTER_RARITY.set(number, rarity);
}
const rarityOf = (number) => BOOSTER_RARITY.get(number) ?? cardData()[number]?.rarity ?? null;
const colorsOf = (leader) => (typeof leader === 'string' ? cardData()[leader]?.colors ?? [] : []);

// Les cartes d'une extension (toutes raretés de sa description de boosters)
const setCards = (set) => Object.values(BOOSTER_SETS[set]?.cards ?? {}).flat();

// ---------- Faits vérifiés ----------

function games(userId) {
  return db.prepare("SELECT day, detail FROM game_ledger WHERE user_id = ? AND reason = 'partie' ORDER BY id").all(userId).map((r) => {
    const d = JSON.parse(r.detail);
    const reward = d.reward ?? {};
    const level = /^ia:.*:(\d)$/.exec(d.opponent ?? '')?.[1];
    return { day: r.day, mode: reward.mode, won: reward.won === true, level: level ? Number(level) : null, leader: d.leader ?? null };
  });
}

function facts(userId) {
  const list = games(userId);
  const wins = list.filter((g) => g.won);
  const chapters = new Set(db.prepare('SELECT chapter FROM game_progress WHERE user_id = ? AND wins > 0').all(userId).map((r) => r.chapter));
  const opened = db.prepare('SELECT opened_at FROM game_boosters WHERE user_id = ? AND opened_at IS NOT NULL').all(userId).map((r) => r.opened_at);
  const inventory = db.prepare('SELECT number, variant FROM game_inventory WHERE user_id = ? AND count > 0').all(userId);
  const numbers = new Set(inventory.map((r) => r.number));
  const colors = new Set(wins.flatMap((g) => colorsOf(g.leader)));
  const arc = (id) => ARCS.find((a) => a.id === id);
  const challenges = (a) => (a ? a.chapters.filter((c) => c.optional) : ARCS.flatMap((x) => x.chapters.filter((c) => c.optional)));
  const solo = (g) => g.mode === 'ia' || g.mode === 'chapitre' || g.mode === 'guidee';
  const op03 = setCards('OP03');
  return {
    list, opened,
    measures: {
      learnWon: list.some((g) => g.mode === 'guidee' && g.won) ? 1 : 0,
      chapters: [...chapters].filter((id) => ARCS.some((a) => a.chapters.some((c) => c.id === id && !c.optional))).length,
      'arc:east-blue': arc('east-blue') && arcFinished(arc('east-blue'), chapters) ? 1 : 0,
      'arc:alabasta': arc('alabasta') && arcFinished(arc('alabasta'), chapters) ? 1 : 0,
      challenges: challenges().filter((c) => chapters.has(c.id)).length,
      'challenges:east-blue': challenges(arc('east-blue')).every((c) => chapters.has(c.id)) && challenges(arc('east-blue')).length ? 1 : 0,
      wins: wins.length,
      expertWins: wins.filter((g) => solo(g) && g.level === 3).length,
      colorsWon: COLORS.filter((c) => colors.has(c)).length,
      onlineGames: list.filter((g) => g.mode === 'en-ligne').length,
      onlineWins: wins.filter((g) => g.mode === 'en-ligne').length,
      boostersOpened: opened.length,
      distinctCards: numbers.size,
      srFound: [...numbers].some((n) => rarityOf(n) === 'SR') ? 1 : 0,
      secFound: inventory.some((r) => r.variant !== 'base' || rarityOf(r.number) === 'SEC') ? 1 : 0,
      'album:OP03': op03.filter((n) => numbers.has(n)).length,
      games: list.length,
      days: new Set(list.map((g) => g.day)).size,
    },
    chapters,
  };
}

// Seuil d'un exploit : l'album demande toutes les cartes de l'extension
const needOf = (e) => (e.measure === 'album:OP03' ? setCards('OP03').length : e.need);

const claimedRefs = (userId, reason) => new Set(db.prepare('SELECT ref FROM game_ledger WHERE user_id = ? AND reason = ?').all(userId, reason).map((r) => r.ref));

function exploitStates(userId, f) {
  const claimed = claimedRefs(userId, 'exploit');
  return EXPLOITS.map((e) => {
    const need = needOf(e);
    const have = Math.min(need, f.measures[e.measure] ?? 0);
    return {
      id: e.id, family: e.family, rank: e.rank, name: e.name, text: e.text, have, need, done: have >= need,
      claimed: claimed.has(e.id), berry: RANK_BERRY[e.rank], ...(e.boosters ? { boosters: e.boosters } : {}),
    };
  });
}

// ---------- Prime ----------

function bountyOf(f, exploits) {
  let amount = f.list.length * BOUNTY.game;
  for (const g of f.list) {
    if (!g.won) continue;
    amount += g.mode === 'en-ligne' ? BOUNTY.online : BOUNTY.win[g.level] ?? 0;
  }
  // chapitres de l'histoire et défis, une fois chacun
  amount += ARCS.flatMap((a) => a.chapters).filter((c) => f.chapters.has(c.id)).length * BOUNTY.chapter;
  for (const e of exploits) if (e.done) amount += BOUNTY.exploit[e.rank];
  return { amount, ...rankOf(amount) };
}

// ---------- Missions ----------

// Tirage du jour : le même pour un compte et un jour, sans rien garder (empreinte du compte et du jour)
function draw(userId, day, f) {
  const bytes = crypto.createHash('sha256').update(`missions:${userId}:${day}`).digest();
  const pool = MISSIONS.filter((m) => !m.online || f.measures.onlineGames > 0)
    .filter((m) => m.measure !== 'strongWins' || f.list.length >= 3);
  // mélange de Fisher-Yates avec les octets de l'empreinte
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  // pas deux missions de victoires simples le même jour
  const picked = [];
  for (const m of order) {
    if (picked.length >= MISSIONS_PER_DAY) break;
    if (m.measure === 'wins' && picked.some((p) => p.measure === 'wins')) continue;
    picked.push(m);
  }
  const color = COLORS[bytes[20] % COLORS.length];
  return { picked, color };
}

function missionStates(userId, now, f) {
  const day = parisDay(now);
  const week = weekStart(day);
  const today = f.list.filter((g) => g.day === day);
  const { picked, color } = draw(userId, day, f);
  const claimed = claimedRefs(userId, 'mission');
  const measure = (m) => {
    switch (m.measure) {
      case 'games': return today.length;
      case 'wins': return today.filter((g) => g.won).length;
      case 'strongWins': return today.filter((g) => g.won && (g.mode === 'en-ligne' || (g.level ?? 0) >= 2)).length;
      case 'colorWins': return today.filter((g) => g.won && colorsOf(g.leader).includes(color)).length;
      case 'chapterGames': return today.filter((g) => g.mode === 'chapitre').length;
      case 'boostersOpened': return f.opened.filter((at) => parisDay(new Date(at)) === day).length;
      case 'onlineGames': return today.filter((g) => g.mode === 'en-ligne').length;
      default: return 0;
    }
  };
  const items = picked.map((m) => {
    const have = Math.min(m.need, measure(m));
    return {
      id: `jour:${m.id}`, title: m.title.replace('{couleur}', COLOR_NAMES[color]), have, need: m.need, berry: m.berry,
      done: have >= m.need, claimed: claimed.has(`${day}:${m.id}`),
    };
  });
  const weekWins = f.list.filter((g) => g.won && g.day >= week).length;
  const weekly = {
    id: WEEKLY_MISSION.id, title: WEEKLY_MISSION.title, have: Math.min(WEEKLY_MISSION.need, weekWins), need: WEEKLY_MISSION.need,
    berry: WEEKLY_MISSION.berry, done: weekWins >= WEEKLY_MISSION.need, claimed: claimed.has(`s${week}`),
  };
  return { day, week, items, weekly };
}

// ---------- Profil ----------

const profileRow = (userId) => db.prepare('SELECT title, leader FROM game_profile WHERE user_id = ?').get(userId) ?? { title: null, leader: null };

function pirateName(user) {
  return user.guest ? 'Pirate sans nom' : user.pseudo;
}

// ---------- Lecture ----------

export function progress(user, now = new Date()) {
  const f = facts(user.id);
  const exploits = exploitStates(user.id, f);
  const missions = missionStates(user.id, now, f);
  const toClaim = exploits.filter((e) => e.done && !e.claimed).length
    + missions.items.filter((m) => m.done && !m.claimed).length + (missions.weekly.done && !missions.weekly.claimed ? 1 : 0);
  const profile = profileRow(user.id);
  return { bounty: bountyOf(f, exploits), exploits, missions, toClaim, profile: { title: profile.title, leader: profile.leader }, name: pirateName(user) };
}

// ---------- Récupérer ----------

export function claimExploit(user, id, now = new Date()) {
  const def = typeof id === 'string' ? exploitById(id) : undefined;
  if (!def) throw refuse('not_found', 'Exploit inconnu', 404);
  return transaction(() => {
    const state = exploitStates(user.id, facts(user.id)).find((e) => e.id === id);
    if (!state.done) throw refuse('not_done', `Exploit pas encore obtenu : ${def.text.toLowerCase()}`, 409);
    const ids = def.boosters ? Array.from({ length: def.boosters.count }, newBoosterId) : [];
    const { already } = credit(user.id, 'exploit', def.id, RANK_BERRY[def.rank],
      { label: `Exploit : ${def.name}`, ...(ids.length ? { boosters: ids.length, boosterIds: ids } : {}) }, now);
    const boosters = !already && ids.length ? addBoosters(user.id, def.boosters.set, `exploit ${def.id}`, ids, now.toISOString()) : [];
    return { progress: progress(user, now), berry: already ? 0 : RANK_BERRY[def.rank], boosters, already };
  });
}

export function claimMission(user, id, now = new Date()) {
  return transaction(() => {
    const m = missionStates(user.id, now, facts(user.id));
    const item = id === WEEKLY_MISSION.id ? m.weekly : m.items.find((x) => x.id === id);
    if (!item) throw refuse('not_found', 'Cette mission n’est pas parmi celles d’aujourd’hui', 404);
    if (!item.done) throw refuse('not_done', `Mission pas encore remplie : ${item.title.toLowerCase()} (${item.have}/${item.need})`, 409);
    const ref = item.id === WEEKLY_MISSION.id ? `s${m.week}` : `${m.day}:${item.id.slice(5)}`;
    const { already } = credit(user.id, 'mission', ref, item.berry, { label: `Mission : ${item.title}` }, now);
    return { progress: progress(user, now), berry: already ? 0 : item.berry, boosters: [], already };
  });
}

// Titre : un exploit obtenu ou un palier atteint ; Leader : n'importe quel Leader du jeu (portrait de l'avis)
export function setProfile(user, body, now = new Date()) {
  const p = progress(user, now);
  const current = profileRow(user.id);
  let { title, leader } = current;
  if (body && 'title' in body) {
    const t = body.title;
    if (t === null || t === '') title = null;
    else if (typeof t === 'string' && (p.exploits.some((e) => e.id === t && e.done) || (t.startsWith('rang:') && rankReached(p.bounty.amount, t.slice(5))))) title = t;
    else throw refuse('bad_request', 'Ce titre n’est pas encore gagné');
  }
  if (body && 'leader' in body) {
    const l = body.leader;
    if (l === null || l === '') leader = null;
    else if (typeof l === 'string' && cardData()[l]?.category === 'LEADER') leader = l;
    else throw refuse('bad_request', 'Leader inconnu');
  }
  db.prepare(`INSERT INTO game_profile (user_id, title, leader, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET title = excluded.title, leader = excluded.leader, updated_at = excluded.updated_at`)
    .run(user.id, title, leader, now.toISOString());
  return progress(user, now);
}

const rankReached = (amount, id) => BOUNTY_RANKS.some((r) => r.id === id && r.min <= amount);

// ---------- Routes (le compte est déjà vérifié par requireUser) ----------

function limit(key, max, windowMs) {
  try {
    rateLimit(key, max, windowMs);
  } catch {
    throw refuse('rate_limited', 'Trop de demandes : réessaie dans quelques minutes', 429);
  }
}

export function progressRoutes(app) {
  app.get('/api/game/progress', (req, res) => {
    limit(`progress:${req.user.id}`, 240, 10 * 60_000);
    res.setHeader('Cache-Control', 'no-store');
    res.json(progress(req.user));
  });
  app.post('/api/game/exploits/:id/claim', (req, res) => {
    limit(`claim:${req.user.id}`, 60, 60_000);
    res.json(claimExploit(req.user, req.params.id));
  });
  app.post('/api/game/missions/:id/claim', (req, res) => {
    limit(`claim:${req.user.id}`, 60, 60_000);
    res.json(claimMission(req.user, req.params.id));
  });
  app.put('/api/game/profile', (req, res) => {
    limit(`profile:${req.user.id}`, 60, 60_000);
    res.json(setProfile(req.user, req.body));
  });
}
