// Adresse e-mail confirmée (server/auth.js, audit du 14 novembre 2026, P1-12), sur une base temporaire : les comptes
// d'avant sont considérés comme confirmés, un nouveau compte reçoit un lien de confirmation, le mot de passe oublié
// ne part que vers une adresse confirmée, et une inscription avec une adresse déjà prise reçoit un refus neutre
// (le titulaire de l'adresse est prévenu par e-mail)
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-audit-email-'));
process.env.TCGC_DB = join(dir, 'essai.db');
// e-mails écrits dans le journal au lieu d'être envoyés (voir server/mail.js)
process.env.SMTP_URL = 'log';
process.env.PUBLIC_URL = 'https://exemple.invalid/';

// Base d'avant la vérification : un compte existant
{
  const old = new DatabaseSync(process.env.TCGC_DB);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, pseudo TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, price_source TEXT NOT NULL DEFAULT 'cardmarket', created_at TEXT NOT NULL)`);
  old.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (1, ?, ?, ?, ?)').run('Ancien', 'ancien@exemple.fr', 'x', '2026-10-01T10:00:00.000Z');
  old.close();
}

const dbModule = '../../server/db.js';
const authModule = '../../server/auth.js';
const { db } = await import(dbModule);
const auth = await import(authModule);

// Messages écrits dans le journal (les e-mails, en quoted-printable)
const logged: string[] = [];
const realLog = console.log;
console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
const decoded = () => logged.join('\n').replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

after(() => {
  console.log = realLog;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
function client() {
  const addr = `10.2.0.${++n}`;
  const res = () => {
    const out = { statusCode: 200, body: null as unknown, setHeader: () => {} };
    return Object.assign(out, { status: (c: number) => { out.statusCode = c; return out; }, json: (b: unknown) => { out.body = b; return out; } });
  };
  const req = (body: unknown = {}) => ({ ip: addr, secure: false, body, headers: { cookie: '' }, user: null as unknown });
  return { req, res };
}

test('e-mail : les comptes d’avant la vérification sont considérés comme confirmés', () => {
  const old = db.prepare('SELECT * FROM users WHERE id = 1').get();
  assert.equal(old.email_verified_at, '2026-10-01T10:00:00.000Z');
  assert.equal(auth.publicUser(old).emailVerified, true);
});

test('e-mail : un nouveau compte reçoit un lien de confirmation, qui confirme l’adresse une fois', async () => {
  const user = await auth.signup(client().req({ pseudo: 'Robin', email: 'robin@exemple.fr', password: 'motdepasse' }), client().res());
  assert.equal(auth.publicUser(user).emailVerified, false);
  await settle();
  const link = /https:\/\/exemple\.invalid\/api\/auth\/verify-email\?token=([\w-]+)/.exec(decoded())?.[1];
  assert.ok(link, 'lien envoyé');
  assert.equal(auth.verifyEmail('mauvais'), null);
  assert.equal(auth.verifyEmail(link)?.id, user.id);
  assert.ok(db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(user.id).email_verified_at);
  assert.equal(auth.verifyEmail(link), null, 'lien à usage unique');
});

test('e-mail : mot de passe oublié seulement vers une adresse confirmée', async () => {
  await auth.signup(client().req({ pseudo: 'Franky', email: 'franky@exemple.fr', password: 'motdepasse' }), client().res());
  const resets = () => db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n;
  const before = resets();
  auth.requestPasswordReset(client().req({ email: 'franky@exemple.fr' }), () => {});
  assert.equal(resets(), before, 'adresse jamais confirmée : aucun lien');
  auth.requestPasswordReset(client().req({ email: 'ancien@exemple.fr' }), () => {});
  assert.equal(resets(), before + 1, 'adresse confirmée : lien envoyé');
});

test('e-mail : inscription avec une adresse déjà prise, refus neutre et e-mail au titulaire', async () => {
  logged.length = 0;
  await assert.rejects(auth.signup(client().req({ pseudo: 'Brook', email: 'ANCIEN@exemple.fr', password: 'motdepasse' }), client().res()),
    (err: { code?: string; status?: number; message: string }) => err.code === 'email_check' && err.status === 409 && !/Ancien/.test(err.message));
  await settle();
  const mail = decoded();
  assert.match(mail, /elle a d.{1,8}un compte : Ancien/);
  // adresse d'un compte jamais confirmé : l'e-mail donne aussi un lien de confirmation
  logged.length = 0;
  await assert.rejects(auth.signup(client().req({ pseudo: 'Jinbe', email: 'franky@exemple.fr', password: 'motdepasse' }), client().res()), /email_check|ne peut pas servir/);
  await settle();
  assert.match(decoded(), /verify-email\?token=/);
});

test('e-mail : renvoyer le lien depuis Réglages, 3 fois par heure', async () => {
  const user = db.prepare("SELECT * FROM users WHERE pseudo = 'Franky'").get();
  const req = { ...client().req(), user };
  for (let i = 0; i < 3; i++) assert.equal(auth.resendVerification(req), true);
  assert.throws(() => auth.resendVerification(req), /too_many_attempts/);
  const verified = { ...client().req(), user: db.prepare('SELECT * FROM users WHERE id = 1').get() };
  assert.equal(auth.resendVerification(verified), false, 'adresse déjà confirmée : rien à envoyer');
});

test('export RGPD : toutes les données du compte en JSON, sans aucun secret', async () => {
  const exportModule = '../../server/export.js';
  const { exportAccount } = await import(exportModule);
  const user = db.prepare("SELECT * FROM users WHERE pseudo = 'Robin'").get();
  db.prepare("INSERT OR IGNORE INTO sets (group_id, code, name) VALUES (1, 'OP01', 'Romance Dawn')").run();
  db.prepare("INSERT OR IGNORE INTO cards (product_id, group_id, name, full_name, number) VALUES (100, 1, 'Luffy', 'Luffy', 'OP01-001')").run();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO collection (user_id, product_id, lang, quantity, added_at, updated_at) VALUES (?, 100, 'fr', 3, ?, ?)").run(user.id, now, now);
  db.prepare("INSERT INTO wishlist (user_id, product_id, lang, target_eur, added_at) VALUES (?, 100, 'en', 5, ?)").run(user.id, now);
  db.prepare("INSERT INTO game_decks (user_id, id, name, leader, cards, created_at, updated_at) VALUES (?, 'PERSO-x', 'Mon deck', 'OP01-001', '{\"OP01-002\":4}', ?, ?)").run(user.id, now, now);
  db.prepare("INSERT INTO game_ledger (user_id, amount, reason, ref, day, at, detail) VALUES (?, 50, 'partie', 'p1', '2026-11-14', ?, '{}')").run(user.id, now);
  db.prepare("INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, lang, created_at) VALUES ('https://fcm.googleapis.com/x', ?, 'cle', 'secret', 'fr', ?)").run(user.id, now);
  const data = exportAccount(user.id);
  assert.equal(data.profil.pseudo, 'Robin');
  assert.equal(data.profil.email, 'robin@exemple.fr');
  assert.deepEqual(data.collection.map((c: { numero: string; quantite: number }) => [c.numero, c.quantite]), [['OP01-001', 3]]);
  assert.equal(data.recherches[0].prixCibleEur, 5);
  assert.deepEqual(data.jeu.decks[0].cartes, { 'OP01-002': 4 });
  assert.equal(data.jeu.berry.journal[0].montant, 50);
  assert.equal(data.appareilsNotifies.length, 1);
  const text = JSON.stringify(data);
  for (const secret of [user.password_hash, 'secret', 'fcm.googleapis.com']) assert.ok(!text.includes(secret), `pas de ${secret}`);
  assert.equal(exportAccount(987654), null);
});
