// Parties enregistrées après l'audit du 14 novembre 2026 (server/game-records.js), sur une base temporaire : quota par
// compte (nombre et taille), les plus anciennes parties finies cèdent la place, les parties en cours jamais
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-audit-records-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const dbModule = '../../server/db.js';
const recordsModule = '../../server/game-records.js';
const { db } = await import(dbModule);
const records = await import(recordsModule);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const { count: MAX } = records.RECORDS_QUOTA;

function save(userId: number, n: number, status = 'won', extra = '') {
  const id = `partie-${String(n).padStart(4, '0')}`;
  const at = new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString();
  const rec = { format: 1, id, status, startedAt: at, updatedAt: at, config: { level: 1 }, extra };
  records.saveRecord(userId, id, rec, JSON.stringify(rec));
  return id;
}
const ids = (userId: number) => db.prepare('SELECT id FROM game_records WHERE user_id = ? ORDER BY id').all(userId).map((r: { id: string }) => r.id);

test('quota : au-delà de 300 parties, la plus ancienne partie finie est effacée', () => {
  for (let i = 0; i < MAX; i++) save(1, i, i === 0 ? 'playing' : 'won');
  assert.equal(ids(1).length, MAX);
  save(1, MAX);
  const kept = ids(1);
  assert.equal(kept.length, MAX);
  assert.ok(kept.includes('partie-0000'), 'partie en cours gardée');
  assert.ok(!kept.includes('partie-0001'), 'plus ancienne partie finie effacée');
  // mettre à jour une partie déjà enregistrée n'efface rien
  save(1, MAX);
  assert.equal(ids(1).length, MAX);
  // un autre compte n'est pas touché
  save(2, 1);
  assert.deepEqual(ids(2), ['partie-0001']);
});

test('quota : un compte rempli de parties en cours ne peut plus en ajouter', () => {
  for (let i = 0; i < MAX; i++) save(3, i, 'playing');
  assert.throws(() => save(3, MAX, 'playing'), (err: { code?: string; status?: number }) => err.code === 'records_quota' && err.status === 413);
});

test('quota : la taille compte aussi (50 Mo compressés par compte)', () => {
  const big = records.RECORDS_QUOTA.bytes;
  // parties peu compressibles d'environ 900 Ko : la taille stockée dépasse le quota avant le nombre
  const noise = (seed: number) => {
    let x = seed;
    return Array.from({ length: 900_000 }, () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return String.fromCharCode(33 + (x % 90)); }).join('');
  };
  const n = Math.ceil(big / 800_000) + 2;
  for (let i = 0; i < n; i++) save(4, i, 'won', noise(i));
  const size = db.prepare('SELECT SUM(length(record)) AS s FROM game_records WHERE user_id = 4').get().s;
  assert.ok(size <= big, `${size} octets gardés`);
  assert.ok(ids(4).includes(`partie-${String(n - 1).padStart(4, '0')}`), 'la dernière partie est gardée');
});

test('envoi : une partie de plus de 4 Mo une fois décompressée est refusée', async () => {
  const { gzipSync } = await import('node:zlib');
  const huge = gzipSync(Buffer.alloc(5 * 1024 * 1024, 32));
  assert.throws(() => records.readRecordBody(huge, true), (err: { code?: string }) => err.code === 'invalid_record');
});
