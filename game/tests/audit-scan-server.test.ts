// Scan après l'audit du 14 novembre 2026 (server/scan.js) : une image trop grande une fois décompressée (« bombe de
// décompression ») ou illisible est refusée avant tout calcul, avec une erreur prévue (400) et non une erreur interne
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import sharp from 'sharp';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-audit-scan-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const dbModule = '../../server/db.js';
const scanModule = '../../server/scan.js';
const { db } = await import(dbModule);
const scan = await import(scanModule);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('scan : une image de 64 millions de pixels (quelques Ko compressée) est refusée', async () => {
  const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(bomb.length < 1_000_000);
  await assert.rejects(scan.identify(bomb), (err: { code?: string; status?: number }) => err.code === 'invalid_image' && err.status === 400);
});

test('scan : des octets qui ne sont pas une image sont refusés comme image illisible', async () => {
  await assert.rejects(scan.identify(Buffer.from('pas une image')), (err: { code?: string }) => err.code === 'invalid_image');
});

test('scan : une image normale passe le contrôle (reconnue, ou en attente de l’index s’il n’est pas construit)', async () => {
  const photo = await sharp({ create: { width: 600, height: 840, channels: 3, background: '#468' } }).jpeg().toBuffer();
  const out = await scan.identify(photo, { limit: 3 }).catch((err: Error) => err);
  if (out instanceof Error) assert.match(out.message, /index de reconnaissance/);
  else assert.ok(Array.isArray(out.matches));
});
