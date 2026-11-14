// Graines du serveur (server/game-seeds.js, audit du 14 novembre 2026, P1-1 et P1-8), sur une base temporaire : une
// partie contre l'IA ne rapporte que si elle a commencé avec une graine donnée par le serveur à ce compte, pour ces
// decks et ce niveau, une seule fois, à l'heure notée par le serveur ; le niveau 4 (IA entraînée) ne rapporte rien,
// ni en partie libre ni pour le défi de Mihawk ; une partie trop longue n'est pas rejouée
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { EAST_BLUE } from '../adventure/east-blue.ts';
import { heuristicChooser } from '../ai/heuristic.ts';
import type { GameConfig, GameRecord } from '../coach/archive.ts';
import type { GameStats } from '../coach/review.ts';
import type { GameReward } from '../economy/types.ts';
import type { DeckList } from '../engine/decks.ts';
import { act, newGame } from '../engine/engine.ts';
import type { GameState, PlayerId } from '../engine/types.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-audit-seeds-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const paths = {
  express: 'express', db: '../../server/db.js', decks: '../../server/game-decks.js', records: '../../server/game-records.js',
  economy: '../../server/game-economy.js', adventure: '../../server/game-adventure.js', seeds: '../../server/game-seeds.js',
  verify: '../../server/game-verify.js',
};
const { db, setMeta } = await import(paths.db);
const decks = await import(paths.decks);
const records = await import(paths.records);
const eco = await import(paths.economy);
const adv = await import(paths.adventure);
const seeds = await import(paths.seeds);
const verify = await import(paths.verify);
const { default: express } = await import(paths.express);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const [A, B] = [1, 2];
for (const id of [A, B]) {
  db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, `joueur${id}`, `joueur${id}@example.invalid`, 'scrypt$essai', '2026-09-01T10:00:00Z');
}
setMeta(eco.OPENED_KEY, '2026-10-15T08:00:00.000Z');

const HUMAN: PlayerId = 0;
const [C1] = [...EAST_BLUE.chapters].sort((a, b) => a.order - b.order).filter((c) => !c.optional);
const MIHAWK = EAST_BLUE.chapters.find((c) => c.id === 'eb-defi-mihawk')!;
const NOW = new Date('2026-10-20T11:00:00.000Z');
const STARTED = new Date('2026-10-20T10:00:00.000Z');

interface Game { initial: GameState; final: GameState; seed: number }

function play(mine: DeckList, aiDeck: string, seed: number): Game {
  const start = newGame({ decks: [mine, aiDeck], names: ['Toi', 'IA'], seed, first: 'random' });
  const initial = JSON.parse(JSON.stringify(start)) as GameState;
  let s = start;
  while (s.winner === null) s = act(s, heuristicChooser(s, s.decision!));
  return { initial, final: s, seed };
}

function win(mine: DeckList, aiDeck: string, from = 1): Game {
  for (let seed = from; seed < from + 150; seed++) {
    const g = play(mine, aiDeck, seed);
    if (g.final.winner === HUMAN) return g;
  }
  throw new Error('aucune partie gagnée trouvée');
}

let count = 0;
function store(userId: number, g: Game, config: Partial<GameConfig> & { seedTicket?: string }): string {
  const id = `2026-10-20_12-00-${String(count++).padStart(3, '0')}_essai-graines`;
  const rec: GameRecord = {
    format: 1, id, engine: 'essai', startedAt: STARTED.toISOString(), updatedAt: '2026-10-20T10:30:00.000Z',
    endedAt: '2026-10-20T10:30:00.000Z', status: g.final.winner === HUMAN ? 'won' : 'lost', turns: g.final.turn,
    config: { myDeck: '', aiDeck: C1.opponent.deck, level: C1.opponent.level, first: 'random', ...config } as GameConfig,
    human: HUMAN, wentFirst: g.initial.first === HUMAN, initial: g.initial, steps: g.final.history.slice(g.initial.history.length),
    decisions: [], reviews: [], undos: [], stats: {} as GameStats, log: [],
  };
  records.saveRecord(userId, id, rec, JSON.stringify(rec));
  return id;
}

const ticket = (userId: number, myDeck: string, seed: number, at = STARTED, aiDeck = C1.opponent.deck, level = C1.opponent.level) =>
  seeds.issueSeed(userId, { myDeck, aiDeck, level }, at, seed).ticket as string;
const claim = (userId: number, id: string): GameReward => eco.claimReward(userId, id, NOW);

const deckId = adv.startArc(A, EAST_BLUE.id, NOW).deckId as string;
const mine = decks.deckOf(A, deckId) as DeckList;
const game = win(mine, C1.opponent.deck);

test('graines : le serveur ne donne pas de graine pour le niveau 4 ni pour des decks illisibles', () => {
  assert.throws(() => seeds.issueSeed(A, { myDeck: deckId, aiDeck: C1.opponent.deck, level: 4 }), /ne rapporte rien/);
  assert.throws(() => seeds.issueSeed(A, { myDeck: '../x y', aiDeck: C1.opponent.deck, level: 1 }), /Decks/);
  const t = seeds.issueSeed(A, { myDeck: deckId, aiDeck: C1.opponent.deck, level: 1 });
  assert.ok(Number.isInteger(t.seed) && t.seed >= -(2 ** 31) && t.seed < 2 ** 31);
  // une partie lancée avec cette graine commence comme le serveur l'attend (graine retrouvée depuis l'état de départ)
  const start = newGame({ decks: [mine, C1.opponent.deck], names: ['Toi', 'IA'], seed: t.seed, first: 'random' });
  const rec = { human: HUMAN, config: { first: 'random' }, initial: JSON.parse(JSON.stringify(start)) };
  assert.equal(verify.startSeed(rec, C1.opponent.deck), t.seed);
});

test('graines : une victoire sans graine du serveur est enregistrée mais ne rapporte rien, ni Berry ni chapitre', () => {
  const id = store(A, game, { myDeck: deckId });
  assert.ok(records.recordBlob(A, id), 'partie enregistrée');
  assert.equal(claim(A, id).refused?.code, 'no_seed');
  assert.throws(() => adv.chapterResult(A, C1.id, id, NOW), (err: { code?: string; message: string }) =>
    err.code === 'no_seed' && /victoire non comptée/.test(err.message));
  assert.equal(adv.adventureState(A).chapters[C1.id].wins, 0);
});

test('graines : une graine différente, d’un autre compte ou pour un autre adversaire ne compte pas', () => {
  const other = store(A, game, { myDeck: deckId, seedTicket: ticket(A, deckId, game.seed + 1) });
  assert.equal(claim(A, other).refused?.code, 'seed_mismatch');
  const stolen = store(A, game, { myDeck: deckId, seedTicket: ticket(B, deckId, game.seed) });
  assert.equal(claim(A, stolen).refused?.code, 'no_seed');
  const elsewhere = store(A, game, { myDeck: deckId, seedTicket: ticket(A, deckId, game.seed, STARTED, 'ST-01', 1) });
  assert.equal(claim(A, elsewhere).refused?.code, 'seed_mismatch');
});

test('graines : avec la graine du serveur, la victoire compte (chapitre puis Berry) ; la graine ne sert qu’une fois', () => {
  const t = ticket(A, deckId, game.seed);
  const id = store(A, game, { myDeck: deckId, seedTicket: t });
  const result = adv.chapterResult(A, C1.id, id, NOW);
  assert.equal(result.firstWin, true);
  // le gain de la même partie : même graine, même partie, accepté
  const reward = claim(A, id);
  assert.equal(reward.refused, undefined);
  assert.ok(reward.total > 0);
  // la même graine pour une autre partie (copie de l'enregistrement) : refusée
  const copy = store(A, game, { myDeck: deckId, seedTicket: t });
  assert.equal(claim(A, copy).refused?.code, 'seed_used');
  assert.throws(() => adv.chapterResult(A, C1.id, copy, NOW), (err: { code?: string }) => err.code === 'seed_used');
});

test('graines : l’heure de début qui compte est celle du serveur, pas celle de l’enregistrement', () => {
  const g = win(mine, C1.opponent.deck, 300);
  // graine donnée avant l'ouverture de l'économie, enregistrement qui prétend une heure récente
  const id = store(A, g, { myDeck: deckId, seedTicket: ticket(A, deckId, g.seed, new Date('2026-10-14T10:00:00.000Z')) });
  assert.equal(claim(A, id).refused?.code, 'before_economy');
});

test('niveau 4 : ni Berry pour une partie libre, ni victoire pour le défi de Mihawk', () => {
  const free = store(A, game, { myDeck: deckId, aiDeck: C1.opponent.deck, level: 4 });
  const r = claim(A, free);
  assert.equal(r.refused?.code, 'not_verified');
  assert.match(r.refused!.message, /IA entraînée/);
  // chapitres d'avant le défi gagnés : le défi est ouvert
  for (const c of EAST_BLUE.chapters.filter((x) => !x.optional && x.order < MIHAWK.order)) {
    db.prepare('INSERT OR IGNORE INTO game_progress (user_id, chapter, wins, first_win_at) VALUES (?, ?, 1, ?)').run(A, c.id, NOW.toISOString());
  }
  const forged = store(A, game, { myDeck: deckId, aiDeck: MIHAWK.opponent.deck, level: 4 });
  assert.throws(() => adv.chapterResult(A, MIHAWK.id, forged, NOW), (err: { code?: string; message: string }) =>
    err.code === 'not_verified' && /IA entraînée/.test(err.message));
  assert.equal(adv.adventureState(A).chapters[MIHAWK.id].wins, 0);
});

test('rejeu : une partie de plus de 2 000 coups n’est pas rejouée', () => {
  const rec = { config: {}, human: 0, initial: { players: [{}, {}] }, steps: Array.from({ length: verify.MAX_STEPS + 1 }, () => ({})), decisions: [] };
  assert.throws(() => verify.checkShape(rec), /trop de coups/);
});

test('graines : POST /api/game/seed répond { ticket, seed, issuedAt }', async () => {
  const app = express();
  app.use(express.json());
  app.use((req: { user: unknown }, _res: unknown, next: () => void) => { req.user = { id: B }; next(); });
  seeds.seedRoutes(app);
  app.use((err: { status?: number; code?: string; message: string }, _req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, _next: unknown) =>
    res.status(err.status ?? 500).json({ code: err.code, error: err.message }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/api/game/seed`;
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const ok = await post({ myDeck: 'ST-01', aiDeck: 'ST-02', level: 2 });
    assert.equal(ok.status, 200);
    const t = await ok.json();
    assert.equal(typeof t.ticket, 'string');
    assert.ok(Number.isInteger(t.seed));
    assert.equal(db.prepare('SELECT user_id FROM game_seeds WHERE id = ?').get(t.ticket).user_id, B);
    assert.equal((await post({ myDeck: 'ST-01', aiDeck: 'ST-02', level: 4 })).status, 400);
  } finally {
    listener.close();
  }
});

test('graines : effacées après 30 jours', () => {
  const old = ticket(B, 'ST-01', 1, new Date('2026-09-01T10:00:00.000Z'));
  assert.ok(seeds.purgeSeeds(new Date('2026-10-20T10:00:00.000Z')) >= 1);
  assert.equal(db.prepare('SELECT 1 FROM game_seeds WHERE id = ?').get(old), undefined);
});
