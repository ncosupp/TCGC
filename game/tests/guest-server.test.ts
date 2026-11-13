// Essai sans compte (server/auth.js), sur une base temporaire : création, session reconnue, fonctions réservées aux
// membres, transformation en vrai compte avec les données gardées, effacement des essais abandonnés
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-guest-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const dbModule = '../../server/db.js';
const authModule = '../../server/auth.js';
const { db } = await import(dbModule);
const auth = await import(authModule);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let ip = 0;
// Fausse requête / réponse Express : un cookie de session circule de l'une à l'autre
function client() {
  let cookie = '';
  const addr = `10.0.0.${++ip}`;
  const res = () => {
    const out = { statusCode: 200, body: null as unknown, setHeader: (k: string, v: string) => { if (k === 'Set-Cookie') cookie = v.split(';')[0]; } };
    return Object.assign(out, { status: (n: number) => { out.statusCode = n; return out; }, json: (b: unknown) => { out.body = b; return out; } });
  };
  const req = (body: unknown = {}) => ({ ip: addr, secure: false, body, headers: { cookie }, user: null as null | Record<string, unknown> });
  const load = () => { const r = req(); auth.loadUser(r, res(), () => {}); return r.user; };
  return { req, res, load };
}

test('serveur : essai sans compte, puis vrai compte avec les mêmes données', async () => {
  db.prepare("INSERT INTO sets (group_id, name) VALUES (1, 'OP-01')").run();
  db.prepare("INSERT INTO cards (product_id, group_id, name, full_name, number) VALUES (100, 1, 'Luffy', 'Luffy', 'OP01-001')").run();

  const a = client();
  const guest = auth.startGuest(a.req(), a.res());
  assert.equal(guest.guest, 1);
  const pub = auth.publicUser(guest);
  assert.equal(pub.guest, true);
  assert.equal(pub.email, '', 'pas d\'e-mail montré pendant un essai');
  const me = a.load();
  assert.equal(me?.id, guest.id, 'la session de l\'essai est reconnue');

  // Les fonctions vues par d'autres membres sont refusées
  const r = a.req(); r.user = me; const out = a.res(); let passed = false;
  auth.requireMember(r, out, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(out.statusCode, 403);

  // Personne ne peut se connecter avec l'identifiant d'un essai
  await assert.rejects(auth.login(a.req({ identifier: guest.pseudo, password: '!' }), a.res()), /invalid_credentials/);

  const now = new Date().toISOString();
  db.prepare('INSERT INTO collection (user_id, product_id, lang, quantity, added_at, updated_at) VALUES (?, 100, ?, 2, ?, ?)').run(guest.id, 'fr', now, now);

  // Un pseudo déjà pris est refusé, puis l'essai devient un compte sans perdre sa collection
  const b = client();
  await auth.signup(b.req({ pseudo: 'Zoro', email: 'zoro@exemple.fr', password: 'motdepasse' }), b.res());
  const up = a.req({ pseudo: 'zoro', email: 'luffy@exemple.fr', password: 'motdepasse' }); up.user = a.load();
  await assert.rejects(auth.upgradeGuest(up, a.res()), /pseudo_taken/);
  const up2 = a.req({ pseudo: 'Luffy', email: 'luffy@exemple.fr', password: 'motdepasse' }); up2.user = a.load();
  const user = await auth.upgradeGuest(up2, a.res());
  assert.equal(user.id, guest.id);
  assert.equal(user.guest, 0);
  assert.equal(db.prepare('SELECT quantity FROM collection WHERE user_id = ?').get(user.id).quantity, 2, 'collection gardée');
  assert.equal(a.load()?.pseudo, 'Luffy', 'nouvelle session ouverte');
  const logged = await auth.login(client().req({ identifier: 'luffy@exemple.fr', password: 'motdepasse' }), client().res());
  assert.equal(logged.id, guest.id);
});

test('serveur : les essais abandonnés sont effacés, pas les autres', () => {
  const live = client();
  const kept = auth.startGuest(live.req(), live.res());
  const gone = client();
  const left = auth.startGuest(gone.req(), gone.res());
  const now = new Date().toISOString();
  db.prepare('INSERT INTO collection (user_id, product_id, lang, quantity, added_at, updated_at) VALUES (?, 100, ?, 1, ?, ?)').run(left.id, 'fr', now, now);
  auth.logout(gone.req(), gone.res());
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(left.id);

  assert.equal(auth.purgeAbandonedGuests(), 1);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(left.id), undefined);
  assert.equal(db.prepare('SELECT 1 FROM collection WHERE user_id = ?').get(left.id), undefined);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(kept.id), 'essai en cours gardé');
  assert.ok(db.prepare("SELECT 1 FROM users WHERE pseudo = 'Luffy'").get(), 'vrai compte gardé');
});
