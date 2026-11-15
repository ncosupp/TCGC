// Comptes après l'audit du 14 novembre 2026 (server/auth.js), sur une base temporaire : adresses regroupées pour les
// limites (IPv6 par /64), connexion freinée par identifiant, nettoyage des sessions et essais expirés
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-audit-auth-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const dbModule = '../../server/db.js';
const authModule = '../../server/auth.js';
const { db } = await import(dbModule);
const auth = await import(authModule);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
function client(addr = `10.1.0.${++n}`) {
  const res = () => {
    const out = { statusCode: 200, body: null as unknown, setHeader: () => {} };
    return Object.assign(out, { status: (c: number) => { out.statusCode = c; return out; }, json: (b: unknown) => { out.body = b; return out; } });
  };
  const req = (body: unknown = {}) => ({ ip: addr, secure: false, body, headers: { cookie: '' }, user: null });
  return { req, res };
}

test('limites : une IPv6 compte pour son /64, une IPv4 pour elle-même', () => {
  const key = (ip: string, prefix?: number) => auth.ipKey({ ip }, prefix);
  assert.equal(key('203.0.113.7'), '203.0.113.7');
  assert.equal(key('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(key('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(key('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(key('2001:0db8:0001:0002::'), '2001:db8:1:2::/64');
  assert.equal(key('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(key('2001:db8:1:2:aaaa::1', 3), '2001:db8:1::/48');
  assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:1:3::1'));
});

test('connexion : 10 échecs sur un identifiant le freinent, quelle que soit l’adresse ; une bonne connexion ne compte pas', async () => {
  await auth.signup(client().req({ pseudo: 'Nami', email: 'nami@exemple.fr', password: 'motdepasse' }), client().res());
  for (let i = 0; i < 3; i++) await auth.login(client().req({ identifier: 'Nami', password: 'motdepasse' }), client().res());
  for (let i = 0; i < 10; i++) {
    await assert.rejects(auth.login(client().req({ identifier: 'nami@exemple.fr', password: 'mauvais' }), client().res()), /invalid_credentials/);
  }
  // 11e essai depuis une autre adresse, même avec le bon mot de passe : freiné
  await assert.rejects(auth.login(client().req({ identifier: 'NAMI@exemple.fr', password: 'motdepasse' }), client().res()), /too_many_attempts/);
  // un autre compte n'est pas touché
  await auth.signup(client().req({ pseudo: 'Usopp', email: 'usopp@exemple.fr', password: 'motdepasse' }), client().res());
  assert.equal((await auth.login(client().req({ identifier: 'Usopp', password: 'motdepasse' }), client().res())).pseudo, 'Usopp');
});

test('essais : un même /64 ne crée pas plus de 5 essais par heure', () => {
  for (let i = 1; i <= 5; i++) auth.startGuest(client(`2001:db8:5:5::${i}`).req(), client().res());
  assert.throws(() => auth.startGuest(client('2001:db8:5:5::99').req(), client().res()), /too_many_attempts/);
  // une autre adresse peut encore essayer : le plafond commun n'a compté que les essais permis
  assert.ok(auth.startGuest(client('198.51.100.1').req(), client().res()).guest);
});

test('nettoyage : sessions et liens expirés, essais abandonnés effacés ; le reste gardé', () => {
  const past = '2020-01-01T00:00:00.000Z';
  const user = db.prepare("SELECT id FROM users WHERE pseudo = 'Nami'").get().id;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run('vieille', user, past, past);
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run('vieux', user, past);
  const guest = auth.startGuest(client().req(), client().res());
  db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(past, guest.id);
  const done = auth.purgeExpired();
  assert.ok(done.sessions >= 2);
  assert.equal(done.resets, 1);
  assert.equal(done.guests, 1);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(guest.id), undefined);
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE user_id = ?').get(user), 'session valide gardée');
});
