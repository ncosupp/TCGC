// Vérification d'une partie enregistrée (game_records), commune à l'aventure (game-adventure.js : victoire d'un
// chapitre) et à l'économie (game-economy.js : gain d'une partie). Le serveur ne croit pas l'enregistrement envoyé par
// le navigateur : il vérifie que la partie commence comme une vraie partie du moteur, la rejoue coup par coup et, pour
// les Berry, compare les coups de l'IA à ceux qu'aurait joués l'IA simple (étude 2.1, § 5.3).
import { isDeepStrictEqual } from 'node:util';
import zlib from 'node:zlib';
// Ordre d'import libre depuis le registre des cartes en module feuille (engine/cards/registry.ts, audit P2-2).
import { cardData } from '../game/engine/cards/index.ts';
import { heuristicChooser } from '../game/ai/heuristic.ts';
import { gentleChoice } from '../game/ui/learn/lessons.ts';
import { CUSTOM_SERIES } from '../game/engine/decks.ts';
import { act, newGame } from '../game/engine/engine.ts';
import { ipKey, rateLimit } from './auth.js';
import { RECORD_ID, recordBlob } from './game-records.js';

// Une partie normale fait quelques centaines de coups (mesure du 14 nov. 2026 : 130 coups en moyenne pour les parties
// enregistrées, 297 au plus sur 300 parties IA simple contre IA simple) : au-delà de 2 000, le rejeu (synchrone, sur
// l'unique processus du serveur) coûterait trop cher
export const MAX_STEPS = 2000;
// Durée maximale d'un rejeu (une partie se rejoue en quelques dizaines de millisecondes)
export const MAX_REPLAY_MS = 3000;
const MAX_JSON = 4 * 1024 * 1024; // comme game-records.js

// Rejeux (fin d'un chapitre, gain d'une partie) : chaque rejeu occupe le serveur, ils sont limités par adresse (/64 en
// IPv6) et pour tout le serveur, en plus des limites par compte des routes
export function replayLimits(req) {
  try {
    rateLimit(`replay-ip:${ipKey(req)}`, 60, 60_000);
    rateLimit('replay:all', 300, 60_000);
  } catch {
    throw refuse('rate_limited', 'Trop de demandes : réessaie dans quelques minutes', 429);
  }
}

export function refuse(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

export function invalidGame(detail) {
  return refuse('invalid_game', `Partie invalide : ${detail}`);
}

export function requireCards() {
  if (!Object.keys(cardData()).length) {
    throw refuse('cards_loading', 'Informations des cartes en cours de téléchargement, réessaie dans un instant', 503);
  }
}

// La partie enregistrée du compte, décompressée
export function readRecord(userId, recordId) {
  const blob = typeof recordId === 'string' && RECORD_ID.test(recordId) ? recordBlob(userId, recordId) : null;
  if (!blob) throw refuse('unknown_record', 'Partie introuvable', 404);
  try {
    return JSON.parse(zlib.gunzipSync(blob, { maxOutputLength: MAX_JSON }).toString('utf8'));
  } catch {
    throw invalidGame('enregistrement illisible');
  }
}

export const validList = (list) => list && typeof list === 'object' && typeof list.leader === 'string' && list.cards
  && typeof list.cards === 'object' && Object.values(list.cards).every((n) => Number.isInteger(n) && n > 0 && n <= 50);

// Les champs dont le rejeu a besoin : deux joueurs, des coups, le joueur humain
export function checkShape(rec) {
  if (!rec || typeof rec !== 'object' || !rec.config || typeof rec.config !== 'object') throw invalidGame('enregistrement illisible');
  const { human } = rec;
  if ((human !== 0 && human !== 1) || !Array.isArray(rec.initial?.players) || rec.initial.players.length !== 2
    || !Array.isArray(rec.steps) || !Array.isArray(rec.decisions)) {
    throw invalidGame('enregistrement incomplet');
  }
  if (rec.steps.length > MAX_STEPS) throw invalidGame('trop de coups');
}

// La partie commence exactement comme une partie créée par le moteur avec ces decks : même ordre des cartes mélangées,
// mêmes mains, même premier joueur. Le hasard du moteur avance d'un pas fixe à chaque tirage, et le nombre de tirages
// avant la première décision ne dépend pas du mélange : l'état du hasard au départ donne la graine de la partie.
// aiDeck : identifiant d'un deck du registre, ou liste (deck personnalisé joué par l'IA). Renvoie la graine de la
// partie, ou null si elle ne commence pas comme une partie du moteur.
export function startSeed(rec, aiDeck) {
  const { initial, human } = rec;
  const ai = human === 0 ? 1 : 0;
  const names = initial.players.map((p) => p?.name);
  if (!names.every((n) => typeof n === 'string' && n.length <= 40) || !Number.isInteger(initial.rng)) return null;
  const mine = initial.players[human];
  if (!validList(mine?.list)) return null;
  const decks = [];
  decks[human] = { id: mine.deckId, name: '', series: CUSTOM_SERIES, leader: mine.list.leader, cards: mine.list.cards };
  decks[ai] = aiDeck;
  const first = rec.config.first === 'me' ? human : rec.config.first === 'ai' ? ai : 'random';
  try {
    const probe = newGame({ decks, names, first, seed: 0 });
    const seed = (initial.rng - probe.rng) | 0;
    const fresh = newGame({ decks, names, first, seed });
    return isDeepStrictEqual(JSON.parse(JSON.stringify(fresh)), initial) ? seed : null;
  } catch {
    return null;
  }
}

export const freshStart = (rec, aiDeck) => startSeed(rec, aiDeck) !== null;

// Rejoue la partie coup par coup (comme replayRecord de game/coach/archive.ts) et renvoie l'état final. Avec `aiLevel`,
// compare aussi chaque décision de l'IA (l'autre joueur que `rec.human`) au choix de l'IA simple :
// - `forced` : décisions qui devaient être celles de l'IA simple et ne le sont pas (toutes au niveau 1 ; aux niveaux 2
//   et 3, les décisions au milieu d'un effet, que l'IA laisse toujours à l'IA simple : voir App.tsx et mcChoose) ;
// - `free` / `agreed` : décisions avec un vrai choix, et parmi elles celles identiques à l'IA simple.
// Les décisions à une seule option ne comptent pas. Le niveau 4 (IA entraînée) n'est pas comparé. gentle : partie guidée,
// l'IA simple y est adoucie (gentleChoice : elle ne contre que pour sa dernière Vie).
export function replayGame(rec, aiLevel, { gentle = false } = {}) {
  const ai = rec.human === 0 ? 1 : 0;
  const check = aiLevel === 1 || aiLevel === 2 || aiLevel === 3;
  const agreement = { forced: 0, free: 0, agreed: 0 };
  let s = rec.initial;
  const started = Date.now();
  for (const [i, h] of rec.steps.entries()) {
    if (i % 50 === 49 && Date.now() - started > MAX_REPLAY_MS) throw invalidGame('partie trop longue à vérifier');
    const d = s.decision;
    if (!d || !h || d.player !== h.player || !d.options.some((o) => o.id === h.choice)) {
      throw invalidGame(`la partie ne se rejoue plus à l’identique à partir du coup ${i + 1} (le programme a changé depuis)`);
    }
    if (check && h.player === ai && d.options.length > 1) {
      const expected = heuristicChooser(s, d);
      const same = (gentle ? gentleChoice(s, expected) : expected) === h.choice;
      if (aiLevel === 1 || d.inEffect) {
        if (!same) agreement.forced++;
      } else {
        agreement.free++;
        if (same) agreement.agreed++;
      }
    }
    try {
      s = act(s, h.choice);
    } catch (err) {
      throw invalidGame(err.message);
    }
  }
  return { final: s, agreement };
}
