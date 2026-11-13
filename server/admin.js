// Panneau d'administration (Réglages › Administration), réservé aux comptes marqués admin (scripts/admin.js).
// Chaque action est notée dans admin_log (qui, quoi, sur quel compte). Garde-fous : on ne peut ni se suspendre, ni se
// supprimer, ni se retirer le rôle d'administrateur ; un compte administrateur ne peut pas être supprimé ni suspendu
// (lui retirer le rôle d'abord).
//   GET    /api/admin/overview                 chiffres du site
//   GET    /api/admin/users?q=&filter=&sort=&page=   comptes (50 par page)
//   GET    /api/admin/users/:id                fiche d'un compte
//   PATCH  /api/admin/users/:id                changer le pseudo ou l'e-mail { pseudo?, email? }
//   POST   /api/admin/users/:id/password       { mode: 'temp' } mot de passe provisoire, ou { mode: 'mail' } lien par e-mail
//   POST   /api/admin/users/:id/logout         fermer toutes ses sessions
//   POST   /api/admin/users/:id/berry          donner ou retirer des Berry { amount, note, opId }
//   POST   /api/admin/users/:id/boosters       donner des boosters ou displays { set, kind, count, note, opId }
//   POST   /api/admin/users/:id/boosters/remove  retirer des boosters pas encore ouverts { set, count }
//   POST   /api/admin/users/:id/disable        suspendre / rétablir { disabled }
//   POST   /api/admin/users/:id/admin          donner / retirer le rôle d'administrateur { admin }
//   DELETE /api/admin/users/:id                supprimer le compte et ses données { confirm: pseudo }
//   GET    /api/admin/log?before=              journal des actions (50 par page)
import crypto from 'node:crypto';
import { BOOSTER_SETS } from '../game/boosters/sets/index.ts';
import { ECONOMY } from '../game/economy/config.ts';
import { EMAIL_RE, hashPassword, PSEUDO_RE, purgeUser, rateLimit, requireAdmin, sendResetLink } from './auth.js';
import { db, transaction } from './db.js';
import { credit, history, OPERATION_ID } from './game-economy.js';
import { forgetUser } from './game-online.js';
import { mailConfigured } from './mail.js';

const PAGE = 50;
const MAX_BERRY = 1_000_000;
const BOOSTER_SOURCE = 'Offert par l’équipe';

function refuse(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

const userRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function target(req) {
  const id = Number(req.params.id);
  const user = Number.isSafeInteger(id) ? userRow(id) : null;
  if (!user) throw refuse('not_found', 'Compte introuvable', 404);
  return user;
}

function notSelf(req, user, message) {
  if (user.id === req.user.id) throw refuse('self', message, 409);
}

function opIdOf(body) {
  const opId = body?.opId;
  if (typeof opId !== 'string' || !OPERATION_ID.test(opId)) throw refuse('bad_request', 'Identifiant d’opération invalide');
  return opId;
}

function note(body) {
  return String(body?.note ?? '').trim().slice(0, 120);
}

export function logAction(admin, user, action, detail = {}) {
  db.prepare(`INSERT INTO admin_log (admin_id, admin_pseudo, target_id, target_pseudo, action, detail, at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(admin.id, admin.pseudo, user?.id ?? null, user?.pseudo ?? null, action, JSON.stringify(detail), new Date().toISOString());
}

const toLog = (row) => ({
  id: row.id, at: row.at, action: row.action, admin: row.admin_pseudo, adminId: row.admin_id,
  target: row.target_pseudo, targetId: row.target_id, detail: JSON.parse(row.detail),
});

// ---------- Lecture ----------

const count = (sql, ...args) => db.prepare(sql).get(...args).n;

export function overview(now = new Date()) {
  const ago = (days) => new Date(now.getTime() - days * 86400_000).toISOString();
  return {
    members: count('SELECT COUNT(*) AS n FROM users WHERE guest = 0'),
    guests: count('SELECT COUNT(*) AS n FROM users WHERE guest = 1'),
    admins: count('SELECT COUNT(*) AS n FROM users WHERE admin = 1'),
    disabled: count('SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NOT NULL'),
    newMembers7: count('SELECT COUNT(*) AS n FROM users WHERE guest = 0 AND created_at > ?', ago(7)),
    newMembers30: count('SELECT COUNT(*) AS n FROM users WHERE guest = 0 AND created_at > ?', ago(30)),
    active1: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at > ?', ago(1)),
    active7: count('SELECT COUNT(*) AS n FROM users WHERE last_seen_at > ?', ago(7)),
    copies: count('SELECT COALESCE(SUM(quantity), 0) AS n FROM collection WHERE user_id > 0'),
    games: count('SELECT COUNT(*) AS n FROM game_records'),
    games7: count('SELECT COUNT(*) AS n FROM game_records WHERE started_at > ?', ago(7)),
    online: count("SELECT COUNT(*) AS n FROM game_matches WHERE status IN ('playing', 'over')"),
    berry: count('SELECT COALESCE(SUM(balance), 0) AS n FROM game_wallet'),
    boostersWaiting: count('SELECT COUNT(*) AS n FROM game_boosters WHERE opened_at IS NULL'),
    boostersOpened: count('SELECT COUNT(*) AS n FROM game_boosters WHERE opened_at IS NOT NULL'),
    mail: mailConfigured(),
    sets: Object.keys(BOOSTER_SETS).map((set) => ({ set, boostersPerDisplay: ECONOMY.shop[set]?.boostersPerDisplay ?? 24 })),
  };
}

// Dernière visite : notée depuis l'arrivée du panneau ; avant, la dernière connexion encore ouverte en tient lieu
const SEEN = 'COALESCE(u.last_seen_at, (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id))';

const FILTERS = {
  all: '1 = 1',
  members: 'u.guest = 0',
  guests: 'u.guest = 1',
  admins: 'u.admin = 1',
  disabled: 'u.disabled_at IS NOT NULL',
};
const SORTS = {
  recent: 'u.created_at DESC',
  seen: "COALESCE(seen, '') DESC",
  pseudo: 'u.pseudo COLLATE NOCASE',
  berry: 'balance DESC',
  cards: 'copies DESC',
};

export function listUsers({ q, filter, sort, page }) {
  const where = [FILTERS[filter] ?? FILTERS.members];
  const args = [];
  const text = String(q ?? '').trim();
  if (text) {
    const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(u.pseudo LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR CAST(u.id AS TEXT) = ?)");
    args.push(like, like, text);
  }
  const p = Math.max(0, Math.floor(Number(page) || 0));
  const clause = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${clause}`).get(...args).n;
  const rows = db.prepare(`
    SELECT u.id, u.pseudo, u.email, u.guest, u.admin, u.disabled_at, u.created_at, ${SEEN} AS seen,
      COALESCE((SELECT balance FROM game_wallet w WHERE w.user_id = u.id), 0) AS balance,
      COALESCE((SELECT SUM(quantity) FROM collection c WHERE c.user_id = u.id), 0) AS copies,
      (SELECT COUNT(*) FROM game_records g WHERE g.user_id = u.id) AS games
    FROM users u WHERE ${clause} ORDER BY ${SORTS[sort] ?? SORTS.recent}, u.id DESC LIMIT ? OFFSET ?`)
    .all(...args, PAGE, p * PAGE);
  return {
    total, page: p, pageSize: PAGE,
    users: rows.map((r) => ({
      id: r.id, pseudo: r.pseudo, email: r.guest ? '' : r.email, guest: Boolean(r.guest), admin: Boolean(r.admin),
      disabledAt: r.disabled_at, createdAt: r.created_at, lastSeenAt: r.seen,
      balance: r.balance, copies: r.copies, games: r.games,
    })),
  };
}

export function userDetail(id) {
  const u = userRow(id);
  if (!u) throw refuse('not_found', 'Compte introuvable', 404);
  const one = (sql) => db.prepare(sql).get(id);
  const results = db.prepare('SELECT status, COUNT(*) AS n FROM game_records WHERE user_id = ? GROUP BY status').all(id);
  const games = Object.fromEntries(results.map((r) => [r.status, r.n]));
  const boosters = db.prepare(`SELECT set_code AS "set", SUM(opened_at IS NULL) AS waiting, SUM(opened_at IS NOT NULL) AS opened
    FROM game_boosters WHERE user_id = ? GROUP BY set_code ORDER BY set_code`).all(id);
  const openSessions = db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM sessions WHERE user_id = ? AND expires_at > ?').get(id, new Date().toISOString());
  return {
    id: u.id, pseudo: u.pseudo, email: u.guest ? '' : u.email, guest: Boolean(u.guest), admin: Boolean(u.admin),
    disabledAt: u.disabled_at, createdAt: u.created_at, lastSeenAt: u.last_seen_at ?? openSessions.last,
    sessions: openSessions.n, lastLogin: openSessions.last,
    collection: {
      cards: one('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?').n,
      copies: one('SELECT COALESCE(SUM(quantity), 0) AS n FROM collection WHERE user_id = ?').n,
      wishes: one('SELECT COUNT(*) AS n FROM wishlist WHERE user_id = ?').n,
      hunts: one('SELECT COUNT(*) AS n FROM hunts WHERE user_id = ?').n,
      shared: Boolean(one('SELECT 1 AS n FROM shares WHERE user_id = ?')),
      trades: Boolean(u.trade_enabled),
      devices: one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').n,
    },
    game: {
      games: Object.values(games).reduce((a, b) => a + b, 0), won: games.won ?? 0, lost: games.lost ?? 0,
      online: db.prepare("SELECT COUNT(*) AS n FROM game_matches WHERE (host_id = ? OR guest_id = ?) AND status IN ('playing', 'over')").get(id, id).n,
      decks: one('SELECT COUNT(*) AS n FROM game_decks WHERE user_id = ?').n,
      chapters: one('SELECT COUNT(*) AS n FROM game_progress WHERE user_id = ? AND wins > 0').n,
      hold: one('SELECT COALESCE(SUM(count), 0) AS n FROM game_inventory WHERE user_id = ?').n,
    },
    balance: one('SELECT balance AS n FROM game_wallet WHERE user_id = ?')?.n ?? 0,
    boosters,
    ledger: history(id).entries,
    // SQLite réutilise le n° d'un compte supprimé : seules les actions faites depuis la création de ce compte-ci
    log: db.prepare('SELECT * FROM admin_log WHERE target_id = ? AND at >= ? ORDER BY id DESC LIMIT 20').all(id, u.created_at).map(toLog),
  };
}

export function adminLog(before) {
  const rows = before === undefined
    ? db.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?').all(PAGE + 1)
    : db.prepare('SELECT * FROM admin_log WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, PAGE + 1);
  // lien vers la fiche seulement si le compte visé existe encore (et n'est pas un nouveau compte au même n°)
  const created = db.prepare('SELECT created_at FROM users WHERE id = ?');
  const entries = rows.slice(0, PAGE).map((row) => {
    const at = row.target_id == null ? null : created.get(row.target_id)?.created_at;
    return { ...toLog(row), live: Boolean(at && at <= row.at) };
  });
  return rows.length > PAGE ? { entries, next: entries[PAGE - 1].id } : { entries };
}

// ---------- Actions ----------

// Mot de passe provisoire lisible (sans 0/O, 1/l/I) : « k7mp-x3qd-9wfa »
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function adminRoutes(app, { log = console.log } = {}) {
  app.use('/api/admin', requireAdmin);
  app.use('/api/admin', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') rateLimit(`admin:${req.user.id}`, 120, 60_000);
    next();
  });

  app.get('/api/admin/overview', (req, res) => res.json(overview()));

  app.get('/api/admin/users', (req, res) => res.json(listUsers(req.query)));

  app.get('/api/admin/users/:id', (req, res) => res.json(userDetail(target(req).id)));

  app.patch('/api/admin/users/:id', (req, res) => {
    const user = target(req);
    if (user.guest) throw refuse('guest', 'Compte d’essai : rien à changer', 409);
    const changes = {};
    if (req.body?.pseudo !== undefined) {
      const pseudo = String(req.body.pseudo).trim();
      if (!PSEUDO_RE.test(pseudo)) throw refuse('invalid_pseudo', 'Pseudo invalide (3 à 24 lettres, chiffres, _ . -)');
      if (db.prepare('SELECT 1 FROM users WHERE pseudo = ? AND id != ?').get(pseudo, user.id)) throw refuse('pseudo_taken', 'Ce pseudo est déjà pris', 409);
      if (pseudo !== user.pseudo) changes.pseudo = pseudo;
    }
    if (req.body?.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (email.length > 254 || !EMAIL_RE.test(email)) throw refuse('invalid_email', 'Adresse e-mail invalide');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, user.id)) throw refuse('email_taken', 'Cette adresse a déjà un compte', 409);
      if (email !== user.email) changes.email = email;
    }
    if (Object.keys(changes).length) {
      transaction(() => {
        for (const [column, value] of Object.entries(changes)) db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(value, user.id);
        logAction(req.user, user, 'profile', {
          ...(changes.pseudo ? { pseudo: [user.pseudo, changes.pseudo] } : {}),
          ...(changes.email ? { email: true } : {}),
        });
      });
      log(`Admin ${req.user.pseudo} : profil de ${user.pseudo} modifié`);
    }
    res.json(userDetail(user.id));
  });

  app.post('/api/admin/users/:id/password', async (req, res) => {
    const user = target(req);
    if (user.guest) throw refuse('guest', 'Compte d’essai : pas de mot de passe', 409);
    if (req.body?.mode === 'mail') {
      if (!mailConfigured()) throw refuse('mail_unavailable', 'L’envoi d’e-mails n’est pas configuré sur ce serveur', 503);
      try {
        await sendResetLink(user, 'fr', log);
      } catch {
        throw refuse('mail_failed', 'L’e-mail n’a pas pu partir (voir le journal du serveur)', 502);
      }
      logAction(req.user, user, 'password', { mode: 'mail' });
      return res.json({ ok: true, mode: 'mail', email: user.email });
    }
    const password = tempPassword();
    const hash = await hashPassword(password);
    transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
      logAction(req.user, user, 'password', { mode: 'temp' });
    });
    log(`Admin ${req.user.pseudo} : mot de passe provisoire pour ${user.pseudo}`);
    // montré une seule fois à l'administrateur, jamais enregistré ni journalisé en clair
    res.json({ ok: true, mode: 'temp', password });
  });

  app.post('/api/admin/users/:id/logout', (req, res) => {
    const user = target(req);
    const { changes } = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    logAction(req.user, user, 'logout', { sessions: Number(changes) });
    res.json({ ok: true, sessions: Number(changes) });
  });

  app.post('/api/admin/users/:id/berry', (req, res) => {
    const user = target(req);
    const amount = Number(req.body?.amount);
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > MAX_BERRY) {
      throw refuse('bad_amount', `Montant invalide : un nombre entier, non nul, d’au plus ${MAX_BERRY.toLocaleString('fr-FR')} ฿`);
    }
    const opId = opIdOf(req.body);
    const text = note(req.body);
    const label = text || (amount > 0 ? 'Cadeau de l’équipe' : 'Correction de l’équipe');
    const result = transaction(() => {
      const r = credit(user.id, 'correction', `admin-${opId}`, amount, { label, admin: req.user.id });
      if (!r.already) logAction(req.user, user, 'berry', { amount, note: text });
      return r;
    });
    if (!result.already) log(`Admin ${req.user.pseudo} : ${amount > 0 ? '+' : ''}${amount} ฿ pour ${user.pseudo}`);
    res.json(userDetail(user.id));
  });

  app.post('/api/admin/users/:id/boosters', (req, res) => {
    const user = target(req);
    const set = req.body?.set;
    if (typeof set !== 'string' || !Object.hasOwn(BOOSTER_SETS, set)) throw refuse('bad_set', 'Extension inconnue');
    const kind = req.body?.kind === 'display' ? 'display' : 'booster';
    const n = Number(req.body?.count ?? 1);
    const max = kind === 'display' ? 10 : 100;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw refuse('bad_count', `Nombre invalide : de 1 à ${max}`);
    const perDisplay = ECONOMY.shop[set]?.boostersPerDisplay ?? 24;
    const total = kind === 'display' ? n * perDisplay : n;
    const opId = opIdOf(req.body);
    const text = note(req.body);
    const what = kind === 'display' ? `${n} display${n > 1 ? 's' : ''} ${set}` : `${n} booster${n > 1 ? 's' : ''} ${set}`;
    const at = new Date().toISOString();
    const result = transaction(() => {
      const ids = Array.from({ length: total }, () => crypto.randomBytes(12).toString('base64url'));
      // une ligne à 0 ฿ dans l'historique du joueur : il voit d'où viennent ses boosters (et l'opération ne compte qu'une fois)
      const r = credit(user.id, 'correction', `admin-${opId}`, 0, { label: text || `Cadeau : ${what}`, boosters: total, set, kind, boosterIds: ids, admin: req.user.id });
      if (r.already) return r;
      const insert = db.prepare('INSERT INTO game_boosters (id, user_id, set_code, source, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const id of ids) insert.run(id, user.id, set, BOOSTER_SOURCE, at);
      logAction(req.user, user, 'boosters', { set, kind, count: n, boosters: total, note: text });
      return r;
    });
    if (!result.already) log(`Admin ${req.user.pseudo} : ${what} pour ${user.pseudo}`);
    res.json(userDetail(user.id));
  });

  app.post('/api/admin/users/:id/boosters/remove', (req, res) => {
    const user = target(req);
    const set = req.body?.set;
    const n = Number(req.body?.count ?? 1);
    if (typeof set !== 'string' || !Object.hasOwn(BOOSTER_SETS, set)) throw refuse('bad_set', 'Extension inconnue');
    if (!Number.isSafeInteger(n) || n < 1 || n > 10_000) throw refuse('bad_count', 'Nombre invalide');
    const removed = transaction(() => {
      const ids = db.prepare(`SELECT id FROM game_boosters WHERE user_id = ? AND set_code = ? AND opened_at IS NULL
        ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(user.id, set, n).map((r) => r.id);
      const del = db.prepare('DELETE FROM game_boosters WHERE id = ?');
      for (const id of ids) del.run(id);
      if (ids.length) logAction(req.user, user, 'boosters-remove', { set, boosters: ids.length });
      return ids.length;
    });
    res.json({ ...userDetail(user.id), removed });
  });

  app.post('/api/admin/users/:id/disable', (req, res) => {
    const user = target(req);
    const disabled = req.body?.disabled === true;
    if (disabled) {
      notSelf(req, user, 'Tu ne peux pas suspendre ton propre compte');
      if (user.admin) throw refuse('is_admin', 'Retire d’abord le rôle d’administrateur à ce compte', 409);
    }
    transaction(() => {
      db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(disabled ? new Date().toISOString() : null, user.id);
      if (disabled) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
      }
      logAction(req.user, user, disabled ? 'disable' : 'enable');
    });
    log(`Admin ${req.user.pseudo} : compte ${user.pseudo} ${disabled ? 'suspendu' : 'rétabli'}`);
    res.json(userDetail(user.id));
  });

  app.post('/api/admin/users/:id/admin', (req, res) => {
    const user = target(req);
    const admin = req.body?.admin === true;
    if (!admin) notSelf(req, user, 'Tu ne peux pas te retirer ton propre rôle d’administrateur');
    if (admin && (user.guest || user.disabled_at)) throw refuse('not_member', 'Seul un compte membre actif peut devenir administrateur', 409);
    transaction(() => {
      db.prepare('UPDATE users SET admin = ? WHERE id = ?').run(admin ? 1 : 0, user.id);
      logAction(req.user, user, admin ? 'admin-grant' : 'admin-revoke');
    });
    log(`Admin ${req.user.pseudo} : ${user.pseudo} ${admin ? 'devient' : 'n’est plus'} administrateur`);
    res.json(userDetail(user.id));
  });

  app.delete('/api/admin/users/:id', (req, res) => {
    const user = target(req);
    notSelf(req, user, 'Pour supprimer ton propre compte, passe par Réglages');
    if (user.admin) throw refuse('is_admin', 'Retire d’abord le rôle d’administrateur à ce compte', 409);
    if (String(req.body?.confirm ?? '') !== user.pseudo) throw refuse('confirm', 'Tape le pseudo exact du compte pour confirmer');
    transaction(() => {
      purgeUser(user.id);
      forgetUser(user.id);
      logAction(req.user, user, 'delete', { guest: Boolean(user.guest) });
    });
    log(`Admin ${req.user.pseudo} : compte ${user.pseudo} supprimé avec toutes ses données`);
    res.json({ ok: true });
  });

  app.get('/api/admin/log', (req, res) => {
    const before = req.query.before === undefined ? undefined : Number(req.query.before);
    if (before !== undefined && !(Number.isSafeInteger(before) && before > 0)) throw refuse('bad_request', 'Page invalide');
    res.json(adminLog(before));
  });
}
