// Tâche O3.1 : les parties croisées côté serveur (server/game-crossplay.js), sur une base temporaire et un faux jeu
// OPTCGSim (faux-jeu.ts, aucun accès réseau) : partie rangée comme une partie en ligne marquée « croisée », gain par le
// même chemin que les parties en ligne (Décision 3), cartes inconnues relevées pour l'administrateur (Décision 4),
// limites (une partie par compte, parties simultanées), journal sans pseudo.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import zlib from 'node:zlib';
import { avecCartes, ENTRANTS, fauxJeu, joueurIA } from './faux-jeu.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-croisee-'));
process.env.TCGC_DB = join(dir, 'essai.db');

// modules du serveur (JavaScript) : chemins dans des variables, comme dans decks-server.test.ts
const paths = { db: '../../../server/db.js', crossplay: '../../../server/game-crossplay.js', economy: '../../../server/game-economy.js', records: '../../../server/game-records.js' };
const { db } = await import(paths.db);
const cp = await import(paths.crossplay);
const economy = await import(paths.economy);
const records = await import(paths.records);

after(() => {
  cp.closeAllCrossplay();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const A = { id: 1, pseudo: 'Nami' };
const B = { id: 2, pseudo: 'Usopp' };
for (const u of [A, B]) {
  db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(u.id, u.pseudo, `joueur${u.id}@example.invalid`, 'scrypt$essai', '2026-10-19T10:00:00Z');
}

function rejoindre(user: typeof A, jeu = fauxJeu(), extra: Record<string, unknown> = {}) {
  const lignes: string[] = [];
  const e = cp.joinCrossplay(user, { code: 'p1a2b3c', deck: 'ST-01' }, { log: (...l: unknown[]) => lignes.push(l.join(' ')), connect: async () => jeu.transport, ...extra });
  return { e, jeu, lignes };
}

test('serveur : partie croisée jouée, rangée comme une partie en ligne marquée « croisée », gain réclamé', async () => {
  const { e, lignes } = rejoindre(A);
  joueurIA(e.s);
  const fin = await e.s.done;
  assert.equal(fin.winner, 1);
  // game_matches : hôte -1 (OPTCGSim), statut over, marque crossplay
  const row = db.prepare('SELECT * FROM game_matches WHERE id = ?').get(e.id);
  assert.equal(row.host_id, cp.OPTCGSIM_HOST);
  assert.equal(row.guest_id, A.id);
  assert.equal(row.status, 'over');
  const m = JSON.parse(zlib.gunzipSync(Buffer.from(row.data)).toString('utf8'));
  assert.equal(m.crossplay.resigned, 0);
  assert.equal(m.crossplay.version, '1.45b');
  assert.ok(m.crossplay.opponent && !JSON.stringify(m.crossplay).includes('Hote#'), 'empreinte de l’adversaire, pas son pseudo');
  // « Mes parties »
  assert.ok(e.recordId, 'enregistrement rangé');
  const rec = JSON.parse(zlib.gunzipSync(records.recordBlob(A.id, e.recordId)).toString('utf8'));
  assert.equal(rec.mode, 'online');
  assert.equal(rec.crossplay, true);
  assert.equal(rec.status, 'won');
  // gain : même chemin qu'une partie en ligne (l'adversaire OPTCGSim a abandonné : pas de partie trop courte)
  const gain = economy.claimReward(A.id, e.recordId, new Date());
  assert.equal(gain.refused, undefined, JSON.stringify(gain.refused));
  assert.equal(gain.mode, 'en-ligne');
  assert.ok(gain.total > 0);
  const ledger = db.prepare("SELECT detail FROM game_ledger WHERE user_id = ? AND reason = 'partie'").get(A.id);
  assert.match(ledger.detail, /croisee:/);
  assert.match(ledger.detail, /optcgsim:/);
  assert.match(ledger.detail, /\(OPTCGSim\)/);
  // une fois seulement
  assert.equal(economy.claimReward(A.id, e.recordId, new Date()).already, true);
  // journal du serveur : ni le pseudo du joueur joy-boy, ni celui de l'adversaire
  const texte = lignes.join('\n');
  assert.match(texte, /Partie croisée \w+ finie : game, victoire/);
  assert.ok(!/Nami|Hote#/.test(texte), texte);
});

test('serveur : abandon du joueur joy-boy, pas de gain (comme en ligne)', async () => {
  const { e } = rejoindre(B);
  joueurIA(e.s);
  await new Promise<void>((r) => { const off = e.s.onChange(() => { if (e.s.snapshot().status === 'playing' && e.s.stats().decisions >= 2) { off(); r(); } }); });
  e.s.concede();
  await e.s.done;
  assert.ok(e.recordId);
  const gain = economy.claimReward(B.id, e.recordId, new Date());
  assert.equal(gain.refused?.code, 'abandoned');
  assert.equal(gain.total, 0);
});

test('serveur : cartes inconnues relevées pour l’administrateur, aucune partie rangée', async () => {
  for (let i = 0; i < 2; i++) {
    const { e } = rejoindre(A, fauxJeu(avecCartes(['OP18-092', 'OP18-092', 'OP18-094'])));
    const fin = await e.s.done;
    assert.equal(fin.kind, 'unknown');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_matches WHERE id = ?').get(e.id).n, 0);
    assert.equal(e.recordId, null);
  }
  const rows = cp.unknownCards();
  assert.deepEqual(rows.map((r: { code: string; set: string; games: number; copies: number }) => [r.code, r.set, r.games, r.copies]),
    [['OP18-092', 'OP18', 2, 2], ['OP18-094', 'OP18', 2, 1]]);
});

test('serveur : une partie croisée par compte, limite du serveur, code illisible', async () => {
  const lent = fauxJeu(ENTRANTS, { arret: 0 });
  const { e } = rejoindre(A, lent);
  assert.throws(() => rejoindre(A), (err: { code?: string; id?: string }) => err.code === 'already_playing' && err.id === e.id);
  process.env.TCGC_CROSSPLAY_MAX = '1';
  try {
    assert.throws(() => rejoindre(B), (err: { code?: string }) => err.code === 'busy');
  } finally { delete process.env.TCGC_CROSSPLAY_MAX; }
  assert.throws(() => cp.joinCrossplay(B, { code: '?123456', deck: 'ST-01' }), (err: { code?: string }) => err.code === 'bad_code');
  assert.throws(() => cp.joinCrossplay(B, { code: 'P123456', deck: 'NOPE' }), (err: { code?: string }) => err.code === 'invalid_deck');
  e.s.close();
  const fin = await e.s.done;
  assert.equal(fin.winner, null);
});
