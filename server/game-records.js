// Parties du jeu (onglet Jouer) : chaque partie appartient à un compte. La partie complète (état de départ, coups des
// deux joueurs, analyses du coach...) est gardée compressée ; son résumé léger sert à la liste « Mes parties », à la
// progression et au bilan des victoires.
import zlib from 'node:zlib';
import { db } from './db.js';

export const RECORD_ID = /^[\w-]{1,120}$/;
const HEAVY = ['initial', 'steps', 'log'];
const STATUSES = ['playing', 'won', 'lost', 'abandoned'];
// Taille maximale d'une partie une fois décompressée (une partie fait environ 130 Ko) : protège des envois piégés
const MAX_JSON = 4 * 1024 * 1024;
// Envoi d'une partie (corps de la requête, compressé ou non) : 1 Mo au plus (server/index.js)
export const MAX_BODY = '1mb';
// Quota par compte : 300 parties et 50 Mo (compressés) au plus. Au-delà, les plus anciennes parties finies sont
// effacées pour faire de la place ; une partie ne peut pas remplir le disque d'un serveur partagé.
export const RECORDS_QUOTA = { count: 300, bytes: 50 * 1024 * 1024 };

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid_record', status: 400, expose: true });
}

// Corps de la requête d'enregistrement : la partie en JSON, compressée (gzip) ou non
export function readRecordBody(buffer, gzipped) {
  let text;
  try {
    text = (gzipped ? zlib.gunzipSync(buffer, { maxOutputLength: MAX_JSON }) : buffer).toString('utf8');
  } catch {
    throw invalid('Partie illisible');
  }
  if (text.length > MAX_JSON) throw invalid('Partie trop volumineuse');
  try {
    return { rec: JSON.parse(text), text };
  } catch {
    throw invalid('Partie illisible');
  }
}

// Enregistre (ou met à jour) une partie. Une version plus ancienne que celle déjà enregistrée est ignorée (envois en
// retard de la file de secours du navigateur).
export function saveRecord(userId, id, rec, text) {
  if (!RECORD_ID.test(id)) throw invalid('Identifiant de partie invalide');
  if (!rec || typeof rec !== 'object' || rec.id !== id) throw invalid('Identifiant incohérent');
  if (typeof rec.format !== 'number' || !STATUSES.includes(rec.status) || typeof rec.startedAt !== 'string'
    || typeof rec.updatedAt !== 'string' || !rec.config || typeof rec.config !== 'object') {
    throw invalid("Ce fichier n'est pas une partie");
  }
  const summary = { ...rec };
  for (const key of HEAVY) delete summary[key];
  const blob = zlib.gzipSync(text);
  makeRoom(userId, id, blob.length);
  db.prepare(`INSERT INTO game_records (user_id, id, mode, status, summary, record, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET status = excluded.status, summary = excluded.summary, record = excluded.record,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= game_records.updated_at`)
    .run(userId, id, rec.mode === 'online' ? 'online' : 'solo', rec.status, JSON.stringify(summary), blob, rec.startedAt, rec.updatedAt);
}

// Quota du compte avant d'enregistrer `id` (bytes : sa taille compressée) : les plus anciennes parties finies sont
// effacées tant que le compte dépasserait le quota ; s'il ne reste que des parties en cours, l'envoi est refusé
function makeRoom(userId, id, bytes) {
  const others = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(record)), 0) AS size FROM game_records WHERE user_id = ? AND id != ?')
    .get(userId, id);
  let count = Number(others.n) + 1;
  let size = Number(others.size) + bytes;
  if (count <= RECORDS_QUOTA.count && size <= RECORDS_QUOTA.bytes) return;
  const oldest = db.prepare(`SELECT id, length(record) AS size FROM game_records WHERE user_id = ? AND id != ? AND status != 'playing'
    ORDER BY updated_at, id`).all(userId, id);
  const drop = db.prepare('DELETE FROM game_records WHERE user_id = ? AND id = ?');
  for (const old of oldest) {
    if (count <= RECORDS_QUOTA.count && size <= RECORDS_QUOTA.bytes) break;
    drop.run(userId, old.id);
    count--;
    size -= Number(old.size);
  }
  if (count > RECORDS_QUOTA.count || size > RECORDS_QUOTA.bytes) {
    throw Object.assign(new Error('Trop de parties en cours enregistrées sur ce compte'), { code: 'records_quota', status: 413, expose: true });
  }
}

// Résumés de toutes les parties d'un compte, de la plus ancienne à la plus récente (texte JSON prêt à envoyer)
export function recordSummariesJson(userId) {
  const rows = db.prepare('SELECT summary FROM game_records WHERE user_id = ? ORDER BY started_at').all(userId);
  return `[${rows.map((r) => r.summary).join(',')}]`;
}

// Partie complète, compressée (gzip)
export function recordBlob(userId, id) {
  const row = db.prepare('SELECT record FROM game_records WHERE user_id = ? AND id = ?').get(userId, id);
  return row ? Buffer.from(row.record) : null;
}
