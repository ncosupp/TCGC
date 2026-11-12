// Chasses : un utilisateur suit les cartes qu'il veut réunir à travers tous les sets (« toutes les Leader alt. »,
// « toutes les SR », « les Manga »...), définies par une rareté, une version et une couleur.
import { huntProgress, searchCards } from './cards.js';
import { db } from './db.js';
import { CARD_KINDS } from './versions.js';

export const HUNT_RARITIES = ['L', 'SEC', 'SR', 'R', 'UC', 'C', 'TR', 'PR', 'DON!!'];
// Versions proposées : toutes les versions ('') ou un genre de versions.js, 'special' = toute version non normale
export const HUNT_KINDS = ['', 'special', ...CARD_KINDS.filter((k) => k !== 'other')];
export const HUNT_COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

// Erreur renvoyée telle quelle au navigateur (gestionnaire d'erreurs de index.js)
function invalidHunt() {
  return Object.assign(new Error('Chasse invalide'), { status: 400, expose: true, code: 'invalid_hunt' });
}

// Critères d'une chasse venus du navigateur : vérifiés, '' = tous ; au moins un critère
export function cleanHunt(body = {}) {
  const pick = (value, allowed) => {
    const v = String(value ?? '');
    if (v && !allowed.includes(v)) throw invalidHunt();
    return v;
  };
  const hunt = { rarity: pick(body.rarity, HUNT_RARITIES), kind: pick(body.kind, HUNT_KINDS), color: pick(body.color, HUNT_COLORS) };
  if (!hunt.rarity && !hunt.kind && !hunt.color) throw invalidHunt();
  return hunt;
}

function withProgress(viewer, row) {
  const hunt = { id: row.id, rarity: row.rarity, kind: row.kind, color: row.color, createdAt: row.created_at };
  return { ...hunt, ...huntProgress(viewer, hunt) };
}

export function listHunts(viewer) {
  return db.prepare('SELECT * FROM hunts WHERE user_id = ? ORDER BY created_at, id').all(viewer.userId)
    .map((row) => withProgress(viewer, row));
}

export function getHunt(viewer, id) {
  const row = db.prepare('SELECT * FROM hunts WHERE user_id = ? AND id = ?').get(viewer.userId, Number(id));
  return row ? withProgress(viewer, row) : null;
}

// Une chasse identique existante est rendue telle quelle
export function createHunt(viewer, body) {
  const hunt = cleanHunt(body);
  db.prepare(`INSERT INTO hunts (user_id, rarity, kind, color, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, rarity, kind, color) DO NOTHING`)
    .run(viewer.userId, hunt.rarity, hunt.kind, hunt.color, new Date().toISOString());
  const { id } = db.prepare('SELECT id FROM hunts WHERE user_id = ? AND rarity = ? AND kind = ? AND color = ?')
    .get(viewer.userId, hunt.rarity, hunt.kind, hunt.color);
  return getHunt(viewer, id);
}

export function deleteHunt(viewer, id) {
  return db.prepare('DELETE FROM hunts WHERE user_id = ? AND id = ?').run(viewer.userId, Number(id)).changes > 0;
}

// Avant de créer une chasse : combien de cartes elle compte et combien on en a
export function previewHunt(viewer, body) {
  return huntProgress(viewer, cleanHunt(body));
}

// Cartes d'une chasse, chacune une seule fois ; status : 'owned' ou 'missing'
export function huntCards(viewer, hunt, { status, sort = 'set', limit, offset } = {}) {
  return searchCards(viewer, {
    rarity: hunt.rarity, kind: hunt.kind, color: hunt.color, unique: true, status, sort, limit, offset,
  });
}
