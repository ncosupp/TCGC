// Recherche des cartes par code (server/cards.js), sur une base temporaire : un code complet ne trouve que lui, un
// numéro tapé en partie (« OP14-0 », saisie du Scanner) trouve les codes qui commencent ainsi
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-search-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const dbModule = '../../server/db.js';
const cardsModule = '../../server/cards.js';
const { db } = await import(dbModule);
const { searchCards, viewerOf } = await import(cardsModule);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('serveur : recherche par code complet ou par début de code', () => {
  db.prepare("INSERT INTO sets (group_id, name) VALUES (1, 'OP-14')").run();
  const add = db.prepare('INSERT INTO cards (product_id, group_id, name, full_name, number) VALUES (?, 1, ?, ?, ?)');
  [['OP14-001', 'Law'], ['OP14-002', 'Urouge'], ['OP14-012', 'Bepo'], ['OP14-120', 'Kid'], ['OP15-001', 'Luffy']]
    .forEach(([number, name], i) => add.run(100 + i, name, name, number));
  const numbers = (q: string) => searchCards(viewerOf({ id: 1, price_source: 'cardmarket' }), { q }).cards.map((c: { number: string }) => c.number).sort();

  assert.deepEqual(numbers('OP14-001'), ['OP14-001'], 'code complet : exact');
  assert.deepEqual(numbers('op14 001'), ['OP14-001'], 'casse et espace');
  assert.deepEqual(numbers('OP14-0'), ['OP14-001', 'OP14-002', 'OP14-012'], 'début de numéro');
  assert.deepEqual(numbers('OP14-01'), ['OP14-001', 'OP14-012'], 'deux chiffres : complété (001) ou début (01x)');
  assert.deepEqual(numbers('OP14-1'), ['OP14-001', 'OP14-120'], 'un chiffre : complété (001) ou début (1xx)');
});
