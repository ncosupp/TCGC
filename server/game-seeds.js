// Graines des parties contre l'IA (audit du 14 novembre 2026, P1-1). Le mélange et le premier joueur d'une partie
// viennent de sa graine : choisie par le navigateur, elle permettrait d'essayer des milliers de départs et de ne jouer
// que les meilleurs. Le serveur la tire donc au lancement d'une partie qui peut rapporter (niveaux 1 à 3), pour ce
// compte, ces decks et ce niveau, et note l'heure : une partie ne rapporte (Berry, récompenses de chapitre) que si
// elle a commencé avec une graine du serveur, et une seule partie peut utiliser chaque graine. Une partie lancée sans
// graine (hors ligne, ancienne version de l'appli) est enregistrée et se joue normalement, mais ne rapporte rien.
//   POST /api/game/seed   { myDeck, aiDeck, level }  ->  { ticket, seed, issuedAt }
import crypto from 'node:crypto';
import { rateLimit } from './auth.js';
import { db } from './db.js';
import { refuse } from './game-verify.js';

const DECK = /^[\w.-]{1,80}$/;
// Graines effacées après 30 jours (une partie d'aventure peut être reprise plusieurs jours après ; une graine effacée
// ne peut plus servir, sa partie a déjà compté ou ne comptera plus)
const KEEP_DAYS = 30;

// Niveaux dont les parties libres rapportent des Berry : le niveau 4 (IA entraînée) n'est pas vérifiable par le rejeu
export const REWARDED_LEVELS = [1, 2, 3];
// Niveaux qui reçoivent une graine du serveur : aussi le niveau 4, pour le défi ultime de Mihawk (aventure), qui garde
// sa récompense unique par compte (décision de l'utilisateur du 21 oct. 2026 ; ses coups ne sont pas vérifiés)
export const SEEDED_LEVELS = [1, 2, 3, 4];

export function issueSeed(userId, { myDeck, aiDeck, level } = {}, now = new Date(), seed = crypto.randomBytes(4).readInt32BE(0)) {
  if (typeof myDeck !== 'string' || !DECK.test(myDeck) || typeof aiDeck !== 'string' || !DECK.test(aiDeck)) {
    throw refuse('bad_request', 'Decks de la partie invalides');
  }
  if (!SEEDED_LEVELS.includes(level)) throw refuse('bad_request', 'Niveau inconnu : pas de graine à donner');
  const ticket = crypto.randomBytes(12).toString('base64url');
  const issuedAt = now.toISOString();
  db.prepare('INSERT INTO game_seeds (id, user_id, seed, my_deck, ai_deck, level, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ticket, userId, seed | 0, myDeck, aiDeck, level, issuedAt);
  return { ticket, seed: seed | 0, issuedAt };
}

const REFUSALS = {
  no_seed: 'Partie lancée sans graine du serveur (hors ligne, ou ancienne version de l’appli) : elle ne rapporte rien. Recharge la page avant ta prochaine partie.',
  seed_mismatch: 'Partie invalide : elle ne commence pas avec la graine donnée par le serveur',
  seed_used: 'Cette graine a déjà servi pour une autre partie : celle-ci ne rapporte rien',
};

// La graine de la partie `recordId` (seed : celle de son état de départ, voir startSeed de game-verify.js) a-t-elle
// été donnée par le serveur à ce compte, pour ces decks et ce niveau, sans servir à une autre partie ? Renvoie
// { issuedAt } (heure de début qui fait foi), ou { refused: { code, message } }. La graine est alors liée à la partie.
export function checkSeed(userId, rec, seed, recordId) {
  const id = rec?.config?.seedTicket;
  const row = typeof id === 'string' && id.length <= 40 ? db.prepare('SELECT * FROM game_seeds WHERE id = ? AND user_id = ?').get(id, userId) : null;
  const no = (code) => ({ refused: { code, message: REFUSALS[code] } });
  if (!row) return no('no_seed');
  const { config } = rec;
  if (row.seed !== seed || row.my_deck !== config.myDeck || row.ai_deck !== config.aiDeck || row.level !== config.level) return no('seed_mismatch');
  if (row.record_id && row.record_id !== recordId) return no('seed_used');
  if (!row.record_id) {
    const { changes } = db.prepare('UPDATE game_seeds SET record_id = ? WHERE id = ? AND record_id IS NULL').run(recordId, id);
    if (!changes) return no('seed_used');
  }
  return { issuedAt: row.issued_at };
}

// Graines de plus de KEEP_DAYS jours : effacées (nettoyage horaire de server/index.js)
export function purgeSeeds(now = new Date()) {
  const before = new Date(now.getTime() - KEEP_DAYS * 86400_000).toISOString();
  return Number(db.prepare('DELETE FROM game_seeds WHERE issued_at < ?').run(before).changes);
}

export function seedRoutes(app) {
  app.post('/api/game/seed', (req, res) => {
    try {
      // une partie lancée toutes les 10 s pendant une heure, largement
      rateLimit(`seed:${req.user.id}`, 360, 3600_000);
    } catch {
      throw refuse('rate_limited', 'Trop de parties lancées : réessaie dans quelques minutes', 429);
    }
    res.json(issueSeed(req.user.id, { myDeck: req.body?.myDeck, aiDeck: req.body?.aiDeck, level: req.body?.level }));
  });
}
