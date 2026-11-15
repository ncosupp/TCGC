// Comptes et sessions : inscription (pseudo, e-mail, mot de passe), connexion, déconnexion, suppression.
// - compte d'essai : créé d'un geste pour découvrir l'appli, transformé plus tard en vrai compte (données gardées)
// - mots de passe hachés avec scrypt (sel aléatoire), jamais stockés ni journalisés en clair
// - session = jeton aléatoire dans un cookie HttpOnly ; la base ne garde que son hachage SHA-256
// - nombre de tentatives de connexion / inscription limité par adresse IP
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { db, LEGACY_USER, transaction } from './db.js';
import { mailConfigured, publicUrl, sendMail } from './mail.js';

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'tcgc_session';
const SESSION_DAYS = 30;
// Un essai est gardé tant qu'on revient au moins une fois tous les GUEST_DAYS jours (session prolongée à chaque visite)
const GUEST_DAYS = 90;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export class AuthError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------- Mots de passe ----------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [algo, N, r, p, salt, expected] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expectedBuf = Buffer.from(expected, 'base64');
  const hash = await scrypt(password, Buffer.from(salt, 'base64'), expectedBuf.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(hash, expectedBuf);
}

// Empreinte factice : une connexion avec un identifiant inconnu prend autant de temps qu'avec un mauvais mot de passe
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

// ---------- Validation ----------

export const PSEUDO_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanSignup({ pseudo, email, password }) {
  pseudo = String(pseudo ?? '').trim();
  email = String(email ?? '').trim().toLowerCase();
  password = String(password ?? '');
  if (!PSEUDO_RE.test(pseudo)) throw new AuthError('invalid_pseudo');
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new AuthError('invalid_email');
  if (password.length < 8 || password.length > 200) throw new AuthError('weak_password');
  return { pseudo, email, password };
}

// ---------- Limitation des tentatives ----------

const attempts = new Map(); // clé -> { count, resetAt }

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count++;
  if (entry.count > max) throw new AuthError('too_many_attempts', 429);
}

// Échecs comptés à part (connexion par identifiant) : `tooMany` regarde sans compter, `countFailure` compte un échec.
// Une bonne connexion n'est pas comptée : seul celui qui se trompe 10 fois de suite est freiné.
function tooMany(key, max) {
  const entry = attempts.get(key);
  return Boolean(entry && entry.resetAt >= Date.now() && entry.count >= max);
}

function countFailure(key, windowMs) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + windowMs });
  else entry.count++;
}

// Adresse de la requête pour les limites : une IPv6 est regroupée par son /64 (un abonné reçoit en général tout un
// /64, il pourrait sinon changer d'adresse à chaque essai), ou par son /48 (`prefix` = 3 : bloc d'un hébergeur) ; une
// IPv4 écrite en IPv6 (::ffff:1.2.3.4) redevient IPv4
export function ipKey(req, prefix = 4) {
  const ip = String(req.ip ?? req.socket?.remoteAddress ?? '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('%')[0].toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, prefix).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/${prefix * 16}`;
}

// Nettoyage périodique des compteurs expirés
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.resetAt < now) attempts.delete(key);
}, 10 * 60_000).unref();

// ---------- Sessions ----------

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const parts = [`${COOKIE}=${token}`, `Path=${config.publicPath}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  // Derrière HTTPS (directement ou via un proxy déclaré avec TRUST_PROXY), le cookie n'est jamais envoyé en clair
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function startSession(req, res, userId, days = SESSION_DAYS) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, now.toISOString(), expires.toISOString());
  setSessionCookie(req, res, token, days * 86400);
}

export function publicUser(user) {
  return {
    id: user.id, pseudo: user.pseudo, email: user.guest ? '' : user.email, createdAt: user.created_at,
    priceSource: user.price_source, keepCopies: user.keep_copies, guest: Boolean(user.guest),
    // adresse confirmée par le lien envoyé à l'inscription (sans objet pendant un essai)
    emailVerified: !user.guest && Boolean(user.email_verified_at),
    ...(user.admin ? { admin: true } : {}),
  };
}

// Middleware : req.user = utilisateur connecté (ou null)
export function loadUser(req, res, next) {
  req.user = null;
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = db.prepare(`
      SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash(token), new Date().toISOString());
    // compte suspendu par un administrateur : comme déconnecté
    req.user = row && !row.disabled_at ? row : null;
    // dernière visite (panneau d'administration), au plus une fois par heure
    if (req.user && !(Date.parse(row.last_seen_at ?? '') > Date.now() - 3600_000)) {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    }
    // Essai : la session est prolongée à chaque visite (au plus une fois par jour)
    if (row?.guest && Date.parse(row.session_expires) < Date.now() + (GUEST_DAYS - 1) * 86400_000) {
      const expires = new Date(Date.now() + GUEST_DAYS * 86400_000).toISOString();
      db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expires, tokenHash(token));
      setSessionCookie(req, res, token, GUEST_DAYS * 86400);
    }
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 'unauthorized', error: 'Connexion requise' });
  next();
}

// Fonctions où d'autres membres voient le compte (partage public, échanges, parties en ligne) : pas pendant un essai
// Panneau d'administration : réservé aux comptes marqués admin (scripts/admin.js)
export function requireAdmin(req, res, next) {
  if (!req.user?.admin) return res.status(403).json({ code: 'admin_only', error: 'Réservé aux administrateurs' });
  next();
}

export function requireMember(req, res, next) {
  if (req.user?.guest) return res.status(403).json({ code: 'members_only', error: 'Crée ton compte pour utiliser cette fonction' });
  next();
}

// ---------- Actions ----------

export async function signup(req, res) {
  rateLimit(`signup:${ipKey(req)}`, 10, 60 * 60_000);
  const { pseudo, email, password } = cleanSignup(req.body ?? {});
  if (db.prepare('SELECT 1 FROM users WHERE pseudo = ?').get(pseudo)) throw new AuthError('pseudo_taken', 409);
  emailFree(req, email);
  const passwordHash = await hashPassword(password);

  const user = transaction(() => {
    const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const { lastInsertRowid } = db.prepare('INSERT INTO users (pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(pseudo, email, passwordHash, new Date().toISOString());
    const id = Number(lastInsertRowid);
    // Le tout premier compte récupère la collection saisie avant l'arrivée des comptes
    if (first) {
      db.prepare('UPDATE collection SET user_id = ? WHERE user_id = ?').run(id, LEGACY_USER);
      db.prepare('UPDATE value_history SET user_id = ? WHERE user_id = ?').run(id, LEGACY_USER);
    }
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  });
  startSession(req, res, user.id);
  sendVerification(user, mailLang(req)).catch(() => {}); // déjà noté dans le journal
  return user;
}

// Essai sans compte : un utilisateur sans identifiant utilisable (pseudo hors du format permis, e-mail en .invalid,
// mot de passe impossible), marqué guest. Création limitée par adresse IP et au total, contre les robots.
export function startGuest(req, res) {
  // par adresse d'abord : une seule adresse (ou un seul /64, un seul /48) ne peut pas épuiser le plafond commun
  rateLimit(`guest:${ipKey(req)}`, 5, 60 * 60_000);
  if (ipKey(req, 3) !== ipKey(req)) rateLimit(`guest:${ipKey(req, 3)}`, 20, 60 * 60_000);
  rateLimit('guest:all', 300, 60 * 60_000);
  const id = crypto.randomBytes(8).toString('hex');
  const { lastInsertRowid } = db.prepare(`INSERT INTO users (pseudo, email, password_hash, created_at, guest)
    VALUES (?, ?, '!', ?, 1)`).run(`~essai-${id}`, `${id}@essai.invalid`, new Date().toISOString());
  startSession(req, res, Number(lastInsertRowid), GUEST_DAYS);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(lastInsertRowid));
}

// L'essai devient un vrai compte : pseudo, e-mail et mot de passe choisis, toutes les données gardées
export async function upgradeGuest(req, res) {
  rateLimit(`signup:${ipKey(req)}`, 10, 60 * 60_000);
  if (!req.user.guest) throw new AuthError('not_guest', 409);
  const { pseudo, email, password } = cleanSignup(req.body ?? {});
  if (db.prepare('SELECT 1 FROM users WHERE pseudo = ? AND id != ?').get(pseudo, req.user.id)) throw new AuthError('pseudo_taken', 409);
  emailFree(req, email, req.user.id);
  const passwordHash = await hashPassword(password);
  transaction(() => {
    db.prepare('UPDATE users SET pseudo = ?, email = ?, password_hash = ?, guest = 0, created_at = ?, email_verified_at = NULL WHERE id = ?')
      .run(pseudo, email, passwordHash, new Date().toISOString(), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  });
  startSession(req, res, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  sendVerification(user, mailLang(req)).catch(() => {});
  return user;
}

// ---------- Adresse e-mail : déjà prise, confirmation ----------

const log = (...args) => console.log(new Date().toLocaleTimeString('fr-FR'), ...args);
const VERIFY_HOURS = 48;

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

// Langue des e-mails : celle de l'interface si elle est donnée, sinon celle du navigateur
function mailLang(req) {
  const asked = req.body?.lang ?? String(req.headers?.['accept-language'] ?? '').slice(0, 2);
  return asked === 'en' ? 'en' : 'fr';
}

// Envoie un e-mail en arrière-plan ; sans envoi configuré (essai en local), le message est écrit dans le journal
function deliver(to, mail, vars, what) {
  const text = fill(mail.text, vars);
  if (!mailConfigured()) {
    log(`E-mail non envoyé (pas de SMTP configuré) à ${to} : ${mail.subject}\n${text}`);
    return Promise.resolve();
  }
  return sendMail({ to, subject: mail.subject, text })
    .then(() => log(`E-mail envoyé (${what})`))
    .catch((err) => { log(`E-mail non envoyé (${what}) : ${err.message}`); throw err; });
}

const VERIFY_MAIL = {
  fr: {
    subject: 'Ma Collection : confirme ton adresse e-mail',
    text: "Bonjour {pseudo},\n\nOuvre ce lien pour confirmer l'adresse e-mail de ton compte Ma Collection (valable 48 heures) :\n\n{link}\n\nUne adresse confirmée te permet de retrouver ton compte si tu oublies ton mot de passe. Si tu n'as pas créé de compte, ignore ce message.\n",
  },
  en: {
    subject: 'My Collection: confirm your email address',
    text: 'Hi {pseudo},\n\nOpen this link to confirm the email address of your My Collection account (valid for 48 hours):\n\n{link}\n\nA confirmed address lets you recover your account if you forget your password. If you did not create an account, ignore this message.\n',
  },
};

const TAKEN_MAIL = {
  fr: {
    subject: 'Ma Collection : tu as déjà un compte',
    text: "Bonjour,\n\nQuelqu'un (toi, sans doute) a voulu créer un compte Ma Collection avec cette adresse e-mail, mais elle a déjà un compte : {pseudo}.\n\nPour t'y connecter, utilise ce pseudo ou cette adresse. Si tu as oublié ton mot de passe, choisis « Mot de passe oublié » sur l'écran de connexion.{verify}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message.\n",
    verify: "\n\nL'adresse de ce compte n'a jamais été confirmée : ouvre d'abord ce lien (valable 48 heures), « Mot de passe oublié » marchera ensuite :\n\n{link}",
  },
  en: {
    subject: 'My Collection: you already have an account',
    text: 'Hi,\n\nSomeone (probably you) tried to create a My Collection account with this email address, but it already has an account: {pseudo}.\n\nTo log in, use this username or this address. If you forgot your password, choose "Forgot password" on the login screen.{verify}\n\nIf you did not ask for this, ignore this message.\n',
    verify: '\n\nThe address of this account was never confirmed: open this link first (valid for 48 hours), then "Forgot password" will work:\n\n{link}',
  },
};

// Lien de confirmation (valable VERIFY_HOURS) pour l'adresse actuelle du compte
function verifyLink(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + VERIFY_HOURS * 3600_000).toISOString();
  transaction(() => {
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO email_verifications (token_hash, user_id, email, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), user.id, user.email, expires);
  });
  return `${publicUrl}api/auth/verify-email?token=${token}`;
}

export function sendVerification(user, lang) {
  if (user.guest || user.email_verified_at) return Promise.resolve();
  const mail = VERIFY_MAIL[lang === 'en' ? 'en' : 'fr'];
  return deliver(user.email, mail, { pseudo: user.pseudo, link: verifyLink(user) }, `confirmation de l'adresse de ${user.pseudo}`);
}

// Inscription avec une adresse qui a déjà un compte : la réponse ne dit pas à qui (message neutre), et le titulaire de
// l'adresse reçoit un e-mail qui lui rappelle son compte (au plus 3 par heure et par adresse). Un compte dont l'adresse
// n'a jamais été confirmée (adresse saisie par quelqu'un d'autre ?) : l'e-mail donne aussi un lien de confirmation.
function emailFree(req, email, selfId = 0) {
  const owner = db.prepare('SELECT * FROM users WHERE email = ? AND id != ?').get(email, selfId);
  if (!owner) return;
  try {
    rateLimit(`taken:${email}`, 3, 60 * 60_000);
    if (!owner.guest && !owner.disabled_at) {
      const mail = TAKEN_MAIL[mailLang(req)];
      const verify = owner.email_verified_at ? '' : fill(mail.verify, { link: verifyLink(owner) });
      deliver(owner.email, mail, { pseudo: owner.pseudo, verify }, `adresse déjà prise (${owner.pseudo})`).catch(() => {});
    }
  } catch {
    // déjà prévenu plusieurs fois cette heure-ci
  }
  throw new AuthError('email_check', 409, "Cette adresse e-mail ne peut pas servir pour un nouveau compte. Si elle est à toi, un e-mail vient d'y être envoyé pour t'aider à retrouver ton compte.");
}

// Lien de confirmation ouvert : l'adresse du compte est confirmée si elle n'a pas changé depuis l'envoi
export function verifyEmail(token) {
  const row = db.prepare('SELECT * FROM email_verifications WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash(String(token ?? '')), new Date().toISOString());
  if (!row) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user || user.email !== row.email) return null;
  transaction(() => {
    db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(new Date().toISOString(), user.id);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
  });
  return user;
}

// Renvoyer le lien (Réglages) : 3 fois par heure au plus
export function resendVerification(req) {
  if (req.user.guest) throw new AuthError('not_member', 403);
  if (req.user.email_verified_at) return false;
  rateLimit(`verify:${req.user.id}`, 3, 60 * 60_000);
  sendVerification(req.user, mailLang(req)).catch(() => {});
  return true;
}

export async function login(req, res) {
  rateLimit(`login:${ipKey(req)}`, 20, 15 * 60_000);
  const identifier = String(req.body?.identifier ?? '').trim().slice(0, 254);
  const password = String(req.body?.password ?? '');
  // aussi par identifiant (10 échecs en 15 min), quelle que soit l'adresse : contre un essai réparti sur beaucoup d'IP
  const idKey = `login-id:${identifier.toLowerCase()}`;
  if (tooMany(idKey, 10)) throw new AuthError('too_many_attempts', 429);
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR pseudo = ?').get(identifier.toLowerCase(), identifier);
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    countFailure(idKey, 15 * 60_000);
    throw new AuthError('invalid_credentials', 401);
  }
  if (user.disabled_at) throw new AuthError('account_disabled', 403);
  startSession(req, res, user.id);
  return user;
}

export function logout(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  setSessionCookie(req, res, '', 0);
}

// ---------- Mot de passe oublié ----------

const RESET_MINUTES = 60;

const RESET_MAIL = {
  fr: {
    subject: 'Ma Collection : réinitialisation du mot de passe',
    text: "Bonjour {pseudo},\n\nTu as demandé à changer le mot de passe de ton compte Ma Collection. Ouvre ce lien pour en choisir un nouveau (valable 1 heure) :\n\n{link}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message : ton mot de passe actuel reste valable.\n",
  },
  en: {
    subject: 'My Collection: password reset',
    text: 'Hi {pseudo},\n\nYou asked to change the password of your My Collection account. Open this link to choose a new one (valid for 1 hour):\n\n{link}\n\nIf you did not ask for this, ignore this message: your current password still works.\n',
  },
};

// Envoie un lien de réinitialisation à l'adresse indiquée, si un compte existe. La réponse est la même dans tous les
// cas, et l'e-mail part en arrière-plan : on ne peut pas savoir si une adresse a un compte.
export function requestPasswordReset(req, log = console.log) {
  if (!mailConfigured()) throw new AuthError('mail_unavailable', 503);
  rateLimit(`forgot:${ipKey(req)}`, 5, 60 * 60_000);
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new AuthError('invalid_email');
  rateLimit(`forgot:${email}`, 3, 60 * 60_000);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // seulement vers une adresse confirmée : une adresse saisie par quelqu'un d'autre ne reçoit pas de lien
  if (!user || user.disabled_at || user.guest || !user.email_verified_at) return;
  sendResetLink(user, req.body?.lang, log).catch(() => {}); // déjà noté dans le journal
}

// Crée un lien de réinitialisation (valable RESET_MINUTES) et l'envoie par e-mail en arrière-plan. Aussi utilisé par le
// panneau d'administration. Renvoie la promesse de l'envoi.
export function sendResetLink(user, lang, log = console.log) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + RESET_MINUTES * 60_000).toISOString();
  transaction(() => {
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), user.id, expires);
  });
  const mail = RESET_MAIL[lang === 'en' ? 'en' : 'fr'];
  const vars = { pseudo: user.pseudo, link: `${publicUrl}#reset/${token}` };
  return sendMail({ to: user.email, subject: mail.subject, text: mail.text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) })
    .then(() => log(`E-mail de réinitialisation envoyé à ${user.pseudo}`))
    .catch((err) => { log(`E-mail de réinitialisation non envoyé (${user.pseudo}) : ${err.message}`); throw err; });
}

// Nouveau mot de passe avec un lien valide : toutes les sessions ouvertes sont fermées, puis l'utilisateur est connecté
export async function resetPassword(req, res) {
  rateLimit(`reset:${ipKey(req)}`, 10, 15 * 60_000);
  const token = String(req.body?.token ?? '');
  const password = String(req.body?.password ?? '');
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?').get(tokenHash(token), new Date().toISOString());
  if (!row) throw new AuthError('invalid_reset');
  if (password.length < 8 || password.length > 200) throw new AuthError('weak_password');
  const passwordHash = await hashPassword(password);
  transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
  });
  startSession(req, res, row.user_id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
}

// Changer son mot de passe (Réglages), en donnant l'actuel : les autres sessions sont fermées, celle-ci est renouvelée
export async function changePassword(req, res) {
  rateLimit(`password:${req.user.id}`, 10, 15 * 60_000);
  if (req.user.guest) throw new AuthError('not_member', 403);
  const ok = await verifyPassword(String(req.body?.current ?? ''), req.user.password_hash);
  if (!ok) throw new AuthError('wrong_password', 403);
  const password = String(req.body?.password ?? '');
  if (password.length < 8 || password.length > 200) throw new AuthError('weak_password');
  const passwordHash = await hashPassword(password);
  transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(req.user.id);
  });
  startSession(req, res, req.user.id);
}

// Supprime le compte et tout ce qui s'y rattache : collection, recherches, lien de partage, notifications, échanges,
// historique de valeur, parties du jeu, sessions
// (un essai n'a pas de mot de passe : il s'efface sans)
export async function deleteAccount(req, res) {
  rateLimit(`delete:${req.user.id}`, 10, 15 * 60_000);
  if (!req.user.guest) {
    const ok = await verifyPassword(String(req.body?.password ?? ''), req.user.password_hash);
    if (!ok) throw new AuthError('wrong_password', 403);
  }
  purgeUser(req.user.id);
  setSessionCookie(req, res, '', 0);
}

// Efface un compte et ses données (les tables du jeu sont vidées par un déclencheur, voir db.js)
export function purgeUser(id) {
  transaction(() => {
    db.prepare('DELETE FROM collection WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM wishlist WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM hunts WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM shares WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM trade_seen WHERE user_id = ? OR other_id = ?').run(id, id);
    db.prepare('DELETE FROM value_history WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM game_records WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM game_decks WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
}

// Essais abandonnés (plus aucune session valide : déconnecté, ou pas revenu depuis GUEST_DAYS jours) : effacés
export function purgeAbandonedGuests(now = new Date().toISOString()) {
  const ids = db.prepare(`SELECT id FROM users u WHERE guest = 1
    AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?)`).all(now).map((r) => r.id);
  ids.forEach(purgeUser);
  return ids.length;
}

// Sessions, liens de réinitialisation expirés et essais abandonnés : effacés au démarrage du serveur puis toutes les
// heures (server/index.js). Renvoie ce qui a été effacé.
export function purgeExpired(now = new Date().toISOString()) {
  const sessions = Number(db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes);
  const resets = Number(db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now).changes)
    + Number(db.prepare('DELETE FROM email_verifications WHERE expires_at <= ?').run(now).changes);
  const guests = purgeAbandonedGuests(now);
  return { sessions, resets, guests };
}
