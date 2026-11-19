// Tâche O4.3 : repli de la file « Trouver un adversaire » sur les salles publiques d'OPTCGSim
// (server/game-queue-optcgsim.js), sur une base temporaire, avec une horloge simulée, un faux éclaireur et un faux
// `connect` (aucun accès à Unity) : joueur joy-boy d'abord, 10 s, puis une salle toutes les 5 s ; réservation, quarantaine,
// annulation, plusieurs joueurs, présence, plafond, contrat de GET /api/game/queue, mode d'essai.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { PublicRoom } from '../online/optcgsim/types.ts';
import { fauxJeu, tirage } from './optcgsim/faux-jeu.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-file-croisee-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const paths = {
  db: '../../server/db.js', online: '../../server/game-online.js', crossplay: '../../server/game-crossplay.js',
  fallback: '../../server/game-queue-optcgsim.js',
};
const { db } = await import(paths.db);
const online = await import(paths.online);
const cp = await import(paths.crossplay);
const fb = await import(paths.fallback);

after(() => {
  cp.closeAllCrossplay();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

type User = { id: number; pseudo: string; guest?: number };
const USERS: User[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, pseudo: `Joueur${i + 1}` }));
for (const u of USERS) {
  db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(u.id, u.pseudo, `joueur${u.id}@example.invalid`, 'scrypt$essai', '2026-10-19T10:00:00Z');
}
let nextUser = 0;
const newUser = () => USERS[nextUser++];

const room = (code: string): PublicRoom => ({
  lobbyId: `fiche-${code}`, code, style: 'Western', version: '1.45b', cardData: '0', timed: true, leader: null,
  created: '2026-11-19T10:00:00Z', lastUpdated: '2026-11-19T10:00:00Z',
});

type Mode = 'refuse' | 'attend' | 'partie';
interface Appel { code: string; opts: { timeoutMs?: number; signal?: AbortSignal }; aborted: boolean }

/** Un banc : horloge simulée (chaque test a son heure de départ), faux éclaireur, faux connect, repli installé. */
let base = Date.parse('2026-11-19T08:00:00Z');
function banc({ salles = [] as PublicRoom[], modes = {} as Record<string, Mode> } = {}) {
  base += 3_600_000; // une heure plus tard : les salles de file des tests précédents ont expiré
  const t0 = base;
  let clock = t0;
  const lignes: string[] = [];
  const appels: Appel[] = [];
  const scout = {
    salles, lectures: [] as number[],
    async rooms({ exclude = [] as string[], only }: { exclude?: string[]; only?: string } = {}) {
      scout.lectures.push((clock - t0) / 1000);
      return scout.salles.filter((r) => !exclude.includes(r.code) && (!only || r.code.includes(only)));
    },
  };
  const jeux: ReturnType<typeof fauxJeu>[] = [];
  const connect = (code: string, opts: Appel['opts']) => {
    const a: Appel = { code, opts, aborted: false };
    appels.push(a);
    const mode = modes[code] ?? 'refuse';
    if (mode === 'refuse') return Promise.reject(new Error('salle déjà prise'));
    if (mode === 'partie') { const j = fauxJeu(); jeux.push(j); return Promise.resolve(j.transport); }
    return new Promise((_, reject) => {
      opts.signal?.addEventListener('abort', () => { a.aborted = true; reject(new Error('connexion annulée')); }, { once: true });
    });
  };
  const f = fb.createQueueFallback({ now: () => clock, scout, connect, randomInt: tirage(), loop: false, log: (...l: unknown[]) => lignes.push(l.join(' ')) });
  f.install();
  const present = new Set<User>();
  const at = (s = (clock - t0) / 1000) => new Date(t0 + s * 1000);
  /** Avance l'horloge jusqu'à `s` secondes, par pas de 500 ms : chaque joueur présent interroge, la boucle passe. */
  async function jusqua(s: number) {
    while (clock < t0 + s * 1000) {
      clock = Math.min(t0 + s * 1000, clock + 500);
      for (const u of present) f.seen(u, true);
      await f.tick();
    }
  }
  function entre(u: User, deck = 'ST-01', estPresent = true) {
    const r = online.enterQueue(u, deck, at());
    if (estPresent) { present.add(u); f.seen(u, true); }
    return r;
  }
  function part(u: User) {
    present.delete(u);
    online.leaveQueue(u, at());
  }
  /** Laisse les essais en cours aller au bout (connexion, mise en place du faux jeu). */
  async function essais() {
    for (let i = 0; i < 400; i++) {
      await f.settled();
      await new Promise((r) => setTimeout(r, 5));
      if (!USERS.some((u) => f.trialOf(u.id))) break;
    }
  }
  return { f, scout, appels, jeux, lignes, jusqua, entre, part, essais, present, at, t: () => (clock - t0) / 1000 };
}

/** Attend qu'un essai ait appelé connect (le faux connect est appelé à l'intérieur de la session, en asynchrone). */
async function attendre(cond: () => boolean, ms = 2000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('file : un joueur joy-boy arrive à 5 s → partie joy-boy, aucun essai OPTCGSim, éclaireur pas sollicité', async () => {
  const b = banc({ salles: [room('WAAAA01')], modes: { WAAAA01: 'partie' } });
  const A = newUser(), B = newUser();
  assert.equal(b.entre(A).status, 'waiting');
  await b.jusqua(5);
  assert.deepEqual(b.f.status(A.id).phase, 'joyboy');
  const r = b.entre(B);
  assert.equal(r.status, 'matched');
  await b.jusqua(20);
  assert.equal(b.appels.length, 0);
  assert.deepEqual(b.scout.lectures, []);
  assert.deepEqual(b.f.status(A.id), { status: 'matched', id: r.id, since: null, phase: null, delaiMs: 10000 });
  assert.equal(b.f.status(B.id).status, 'matched');
});

test('file : seul pendant 10 s → lecture à 8 s, partie OPTCGSim lancée à 10 s, salle de file fermée', async () => {
  const b = banc({ salles: [room('WBBBB01')], modes: { WBBBB01: 'partie' } });
  const A = newUser(), C = newUser();
  const w = b.entre(A);
  await b.jusqua(7.5);
  assert.deepEqual(b.scout.lectures, [], 'rien avant 8 s');
  const s = b.f.status(A.id);
  assert.equal(s.status, 'waiting');
  assert.equal(s.id, w.id);
  assert.equal(s.since, w.since);
  assert.equal(s.phase, 'joyboy');
  assert.equal(s.delaiMs, 10000);
  await b.jusqua(9.5);
  assert.deepEqual(b.scout.lectures, [8], 'lecture anticipée à 8 s');
  assert.equal(b.appels.length, 0, 'pas d’essai avant 10 s');
  await b.jusqua(10);
  assert.equal(b.f.status(A.id).phase, 'optcgsim-connexion');
  assert.equal(online.queueStats(C.id, b.at()).waiting, 0, 'salle mise de côté : invisible des autres');
  await attendre(() => b.appels.length === 1);
  assert.equal(b.appels[0].code, 'WBBBB01');
  assert.equal(b.appels[0].opts.timeoutMs, 8000);
  assert.ok(b.f.reservations().get('WBBBB01') === A.id, 'salle réservée');
  await b.essais();
  const fin = b.f.status(A.id);
  assert.equal(fin.status, 'optcgsim');
  assert.equal(fin.phase, null);
  const e = cp.crossplaySession(fin.id);
  assert.ok(e, 'session croisée');
  assert.equal(e.origin, 'file');
  assert.equal(e.s.snapshot().status, 'playing');
  // nom présenté à l'hôte : <pseudo>#NNNN (compte), via SetName
  const noms = b.jeux[0].rpcs().filter((r) => r.name === 'SetNameServerRpc').map((r) => r.values.sName as string);
  assert.match(noms[0], new RegExp(`^${A.pseudo}#\\d{4}$`));
  // la salle de file est fermée, jamais comptée comme une partie joy-boy ; un nouveau joueur ne la rejoint pas
  assert.equal(online.queueRoomWaiting(w.id, b.at()), false);
  assert.equal(online.loadMatch(w.id).optcgsim, fin.id);
  assert.equal(b.entre(C).status, 'waiting');
  b.part(C);
  e.s.close();
  await e.s.done;
  assert.equal(b.f.reservations().size, 0, 'réservation rendue à la fin de la partie');
  assert.ok(!b.lignes.join('\n').includes(A.pseudo), 'journal sans pseudo');
});

test('file : arrêt à 9,9 s → aucune connexion ; arrêt pendant l’essai → connexion annulée, réservation rendue', async () => {
  const b = banc({ salles: [room('WCCCC01')], modes: { WCCCC01: 'attend' } });
  const A = newUser();
  b.entre(A);
  await b.jusqua(9.5);
  b.part(A);
  await b.jusqua(20);
  assert.equal(b.appels.length, 0);
  assert.equal(b.f.status(A.id).status, 'none');

  const A2 = newUser();
  b.entre(A2);
  await b.jusqua(b.t() + 10);
  await attendre(() => b.appels.length === 1);
  assert.equal(b.f.status(A2.id).phase, 'optcgsim-connexion');
  assert.equal(b.f.reservations().get('WCCCC01'), A2.id);
  b.part(A2);
  await b.essais();
  assert.equal(b.appels[0].aborted, true, 'connexion annulée par le signal');
  assert.equal(b.f.reservations().size, 0);
  assert.equal(cp.crossplayRefusal(A2.id), null, 'aucune session restante');
  assert.equal(b.f.status(A2.id).status, 'none');
  assert.ok(!b.f.quarantined().includes('WCCCC01'), 'une annulation ne met pas la salle en quarantaine');
});

test('file : deux joueurs, deux salles → deux salles différentes ; deux joueurs, une salle → le plus ancien', async () => {
  const b = banc({ salles: [room('WDDDD01'), room('WDDDD02')], modes: { WDDDD01: 'attend', WDDDD02: 'attend' } });
  const A = newUser(), B = newUser();
  b.entre(A);
  // B arrive après A, dans sa propre salle de file : impossible tant que A attend (B le rejoindrait). On fait donc
  // attendre B ailleurs : A est mis de côté le temps de son essai, B arrive alors et ouvre sa salle.
  await b.jusqua(10);
  await attendre(() => b.appels.length === 1);
  assert.equal(b.entre(B).status, 'waiting', 'A est mis de côté : B attend dans sa salle');
  await b.jusqua(20.5);
  await attendre(() => b.appels.length === 2);
  assert.deepEqual(b.appels.map((a) => a.code).sort(), ['WDDDD01', 'WDDDD02']);
  b.part(A); b.part(B);
  await b.essais();

  const b2 = banc({ salles: [room('WDDDD03')], modes: { WDDDD03: 'attend' } });
  const C = newUser(), D = newUser();
  b2.entre(C);
  await b2.jusqua(10);
  await attendre(() => b2.appels.length === 1);
  b2.entre(D);
  await b2.jusqua(30);
  assert.equal(b2.appels.length, 1, 'une seule salle : le plus ancien l’a, l’autre attend');
  assert.equal(b2.f.reservations().get('WDDDD03'), C.id);
  assert.equal(b2.f.status(D.id).phase, 'optcgsim-recherche');
  b2.part(C); b2.part(D);
  await b2.essais();
});

test('file : refus → salle suivante, quarantaine 5 min, 3 essais au plus par passage', async () => {
  const salles = ['WFFFF01', 'WFFFF02', 'WFFFF03', 'WFFFF04'].map(room);
  const b = banc({ salles, modes: { WFFFF04: 'attend' } });
  const A = newUser();
  b.entre(A);
  await b.jusqua(10);
  await b.essais();
  assert.deepEqual(b.appels.map((a) => a.code), ['WFFFF01', 'WFFFF02', 'WFFFF03'], '3 essais au plus');
  assert.deepEqual(b.f.quarantined().sort(), ['WFFFF01', 'WFFFF02', 'WFFFF03']);
  assert.equal(b.f.reservations().size, 0);
  const s = b.f.status(A.id);
  assert.equal(s.status, 'waiting', 'aucun message : le joueur attend toujours');
  assert.equal(s.phase, 'optcgsim-recherche');
  assert.equal(online.queueStats(newUser().id, b.at()).waiting, 1, 'la salle de file redevient visible');
  // passage suivant : la salle restante
  await b.jusqua(16);
  await attendre(() => b.appels.length === 4);
  assert.equal(b.appels[3].code, 'WFFFF04');
  b.part(A);
  await b.essais();
  // quarantaine finie au bout de 5 min
  await b.jusqua(10 + 5 * 60 + 1);
  assert.deepEqual(b.f.quarantined(), []);
});

test('file : aucune salle → nouvelle lecture toutes les 5 s ; salle apparue à 14 s → prise à 15 s au plus', async () => {
  const b = banc({ salles: [], modes: { WGGGG01: 'attend' } });
  const A = newUser();
  b.entre(A);
  await b.jusqua(13.5);
  assert.deepEqual(b.scout.lectures, [8, 10]);
  assert.equal(b.f.status(A.id).phase, 'optcgsim-recherche');
  await b.jusqua(14);
  b.scout.salles.push(room('WGGGG01'));
  await b.jusqua(15);
  await attendre(() => b.appels.length === 1);
  assert.deepEqual(b.scout.lectures, [8, 10, 15]);
  b.part(A);
  await b.essais();
});

test('file : un joueur joy-boy arrive pendant l’essai, l’essai échoue → les deux joueurs joy-boy sont réunis', async () => {
  const b = banc({ salles: [room('WHHHH01')], modes: { WHHHH01: 'attend' } });
  const A = newUser(), B = newUser();
  b.entre(A);
  await b.jusqua(10);
  await attendre(() => b.appels.length === 1);
  assert.equal(b.entre(B).status, 'waiting', 'A est caché pendant son essai');
  // l'hôte ne répond pas : échec (comme le délai de connexion), sans message
  b.f.trialOf(A.id).entry.s.close();
  await b.essais();
  await b.jusqua(16);
  const a = b.f.status(A.id), bb = b.f.status(B.id);
  assert.equal(a.status, 'matched');
  assert.equal(bb.status, 'matched');
  assert.equal(a.id, bb.id);
  assert.equal(b.appels.length, 1);
});

test('file : plafond TCGC_CROSSPLAY_MAX atteint ou partie croisée déjà en cours → pas d’essai', async () => {
  const b = banc({ salles: [room('WIIII01')], modes: { WIIII01: 'attend' } });
  const A = newUser();
  process.env.TCGC_CROSSPLAY_MAX = '0';
  try {
    b.entre(A);
    await b.jusqua(25);
    assert.equal(b.appels.length, 0);
    assert.deepEqual(b.scout.lectures, [], 'serveur plein : l’éclaireur n’est pas sollicité');
  } finally { delete process.env.TCGC_CROSSPLAY_MAX; }
  b.part(A);

  const A2 = newUser();
  const lent = fauxJeu([], {});
  const e = cp.joinCrossplay(A2, { code: 'P1A2B3C', deck: 'ST-01' }, { connect: async () => lent.transport, log: () => {} });
  b.entre(A2);
  await b.jusqua(b.t() + 20);
  assert.equal(b.appels.length, 0, 'partie croisée déjà en cours pour ce joueur');
  e.s.close();
  await e.s.done;
  b.part(A2);
});

test('file : joueur absent (pas d’interrogation depuis 6 s, ou present=0) → pas d’essai, repris à son retour', async () => {
  const b = banc({ salles: [room('WJJJJ01')], modes: { WJJJJ01: 'attend' } });
  const A = newUser();
  b.entre(A, 'ST-01', false);
  b.f.seen(A, true); // une interrogation à 0 s, puis plus rien
  await b.jusqua(20);
  assert.equal(b.appels.length, 0);
  assert.deepEqual(b.scout.lectures, []);
  // onglet caché : present=0
  for (let s = 20.5; s <= 30; s += 0.5) { b.f.seen(A, false); await b.jusqua(s); }
  assert.equal(b.appels.length, 0);
  // retour : essai au passage suivant
  b.present.add(A);
  await b.jusqua(31);
  await attendre(() => b.appels.length === 1);
  b.part(A);
  await b.essais();
});

test('file : TCGC_CROSSPLAY_FILE=0 coupe le repli ; délai réglable', async () => {
  const b = banc({ salles: [room('WKKKK01')], modes: { WKKKK01: 'attend' } });
  const A = newUser();
  process.env.TCGC_CROSSPLAY_FILE = '0';
  try {
    b.entre(A);
    await b.jusqua(30);
    assert.equal(b.appels.length, 0);
    assert.equal(b.f.status(A.id).phase, 'joyboy');
    assert.equal(b.f.status(A.id).delaiMs, 0, 'repli coupé : pas de décompte côté page');
  } finally { delete process.env.TCGC_CROSSPLAY_FILE; }
  b.part(A);
  for (const [v, ms] of [['', 10000], ['3', 3000], ['2.5', 2500], ['abc', 10000], ['-1', 10000]] as const) {
    process.env.TCGC_CROSSPLAY_FILE_DELAI = v;
    try { assert.equal(fb.fallbackDelayMs(), ms, `TCGC_CROSSPLAY_FILE_DELAI=« ${v} »`); } finally { delete process.env.TCGC_CROSSPLAY_FILE_DELAI; }
  }
  process.env.TCGC_CROSSPLAY_FILE_FORMATS = 'Western, Eastern';
  try { assert.deepEqual(fb.fallbackStyles(), ['Western', 'Eastern']); } finally { delete process.env.TCGC_CROSSPLAY_FILE_FORMATS; }
  assert.deepEqual(fb.fallbackStyles(), ['Western']);
});

test('file : après un redémarrage, l’interrogation relance la boucle', async () => {
  const b = banc({ salles: [room('WLLLL01')], modes: { WLLLL01: 'attend' } });
  const A = newUser();
  b.entre(A);
  // nouveau repli (mémoire vide), boucle réelle : la première interrogation la démarre
  const f2 = fb.createQueueFallback({ log: () => {}, scout: b.scout, connect: () => new Promise(() => {}) });
  assert.equal(f2.looping(), false);
  f2.seen(A, true);
  assert.equal(f2.looping(), true, 'boucle relancée par l’interrogation');
  f2.stopLoop();
  b.part(A);
});

test('file : contrat de GET /api/game/queue (none, waiting, matched)', () => {
  const b = banc();
  const A = newUser(), B = newUser();
  assert.deepEqual(b.f.status(A.id), { status: 'none', id: null, since: null, phase: null, delaiMs: 10000 });
  const w = b.entre(A);
  assert.deepEqual(b.f.status(A.id), { status: 'waiting', id: w.id, since: w.since, phase: 'joyboy', delaiMs: 10000 });
  const m = b.entre(B);
  assert.deepEqual(b.f.status(B.id), { status: 'matched', id: m.id, since: null, phase: null, delaiMs: 10000 });
  assert.deepEqual(b.f.status(A.id), { status: 'matched', id: m.id, since: null, phase: null, delaiMs: 10000 });
});

test('file : mode d’essai (TCGC_CROSSPLAY_FILE_ESSAI=1), refusé en production ; filtre ignoré en production', async () => {
  process.env.TCGC_CROSSPLAY_FILE_ESSAI = '1';
  process.env.TCGC_CROSSPLAY_FILE_FILTRE = 'joyboy-essai';
  const env = process.env.NODE_ENV;
  try {
    assert.equal(fb.trialMode(), true);
    assert.equal(fb.fallbackFilter(), 'joyboy-essai');
    process.env.NODE_ENV = 'production';
    assert.equal(fb.trialMode(), false);
    assert.equal(fb.fallbackFilter(), undefined);
  } finally {
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
    delete process.env.TCGC_CROSSPLAY_FILE_ESSAI;
    delete process.env.TCGC_CROSSPLAY_FILE_FILTRE;
  }
  const scout = fb.trialScout(() => Date.parse('2026-11-19T10:00:00Z'));
  const [r] = await scout.rooms();
  assert.match(r.code, /^W/);
  assert.deepEqual(await scout.rooms({ exclude: [r.code] }), []);
  const ac = new AbortController();
  const p = fb.trialConnect(r.code, { signal: ac.signal });
  ac.abort();
  await assert.rejects(p, /annulée/);
  const t = Date.now();
  await assert.rejects(fb.trialConnect(r.code, {}), /essai/);
  assert.ok(Date.now() - t >= 1900, 'échoue au bout de 2 s');
});
