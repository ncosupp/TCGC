// Visuels publics après l'audit du 14 novembre 2026 (server/images.js, bandai-fr.js, game-cards.js), sur une base
// temporaire : un identifiant inconnu du catalogue ne déclenche aucune requête vers TCGplayer ou Bandai, et ne laisse
// aucun fichier .missing
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-audit-images-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const paths = { db: '../../server/db.js', images: '../../server/images.js', fr: '../../server/bandai-fr.js', cards: '../../server/game-cards.js' };
const { db } = await import(paths.db);
const images = await import(paths.images);
const fr = await import(paths.fr);
const cards = await import(paths.cards);

const realFetch = globalThis.fetch;
const asked: string[] = [];
globalThis.fetch = (async (url: string) => {
  asked.push(String(url));
  return new Response(null, { status: 404 });
}) as typeof fetch;

after(() => {
  globalThis.fetch = realFetch;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('miniatures : un identifiant inconnu ne télécharge rien et ne crée pas de .missing', async () => {
  const unknown = 987_654_321;
  assert.equal(await images.downloadThumb(unknown), null);
  assert.deepEqual(asked, []);
  assert.equal(existsSync(images.thumbPath(unknown).replace(/\.jpg$/, '.missing')), false);
});

test('grands visuels VF et VO : seuls ceux de la liste officielle et du catalogue sont demandés', async () => {
  assert.equal(await fr.frLargeImage('ZZ99-999'), null);
  assert.equal(await cards.enLargeImage('ZZ99-999'), null);
  assert.equal(cards.knownGameImage('ZZ99-999'), false);
  assert.deepEqual(asked, []);
  // un visuel connu mais absent chez Bandai : demandé une fois, pas redemandé avant un jour
  const id = 'ZZ98-001_p9';
  db.prepare("INSERT INTO fr_cards (image_id, number, name) VALUES (?, 'ZZ98-001', 'Essai')").run(id);
  assert.equal(await fr.frLargeImage(id), null);
  assert.equal(await fr.frLargeImage(id), null);
  assert.equal(asked.length, 1);
});
