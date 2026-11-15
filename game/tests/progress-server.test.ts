// Progression du joueur côté serveur (server/game-progress.js, étape J), sur une base temporaire : la partie guidée est
// vérifiée (IA adoucie) et donne l'exploit « Premiers pas » (Berry + 1 booster, une seule fois) ; exploits et missions
// calculés sur les parties vérifiées ; prime et paliers ; profil ; coffre de la semaine dans l'extension de l'arc.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { heuristicChooser } from '../ai/heuristic.ts';
import type { GameConfig, GameRecord } from '../coach/archive.ts';
import type { GameStats } from '../coach/review.ts';
import { act, newGame } from '../engine/engine.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { BOUNTY, EXPLOITS, RANK_BERRY, rankOf, type Progress } from '../progress/catalog.ts';
import { gentleChoice, LEARN_CONFIG } from '../ui/learn/lessons.ts';
import { remember, withTicket } from './seed-tickets.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-progression-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const paths = { db: '../../server/db.js', records: '../../server/game-records.js', economy: '../../server/game-economy.js', progress: '../../server/game-progress.js', seeds: '../../server/game-seeds.js' };
const { db, setMeta } = await import(paths.db);
const records = await import(paths.records);
const eco = await import(paths.economy);
const prog = await import(paths.progress);
const seedServer = await import(paths.seeds);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const [A, B] = [1, 2];
for (const id of [A, B]) {
  db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, `pirate${id}`, `pirate${id}@example.invalid`, 'scrypt$essai', '2026-09-01T10:00:00Z');
}
const user = (id: number) => ({ id, pseudo: `pirate${id}`, guest: false });
setMeta(eco.OPENED_KEY, '2026-10-15T08:00:00.000Z');
const HUMAN: PlayerId = 0;
const NOW = new Date('2026-11-16T11:00:00.000Z');   // lundi 16 novembre 2026, midi à Paris

// Une partie guidée jouée par l'IA simple pour le joueur, contre l'IA adoucie ; won : celle qu'on cherche
function guided(won: boolean, gentle = true): { initial: GameState; final: GameState } {
  for (let seed = 1; seed < 200; seed++) {
    const start = newGame({ decks: [LEARN_CONFIG.myDeck, LEARN_CONFIG.aiDeck], names: ['Toi', 'IA'], first: HUMAN, seed });
    const initial = JSON.parse(JSON.stringify(start)) as GameState;
    let s = start;
    while (s.winner === null) {
      const d = s.decision!;
      const c = heuristicChooser(s, d);
      s = act(s, d.player === HUMAN || !gentle ? c : gentleChoice(s, c));
    }
    if ((s.winner === HUMAN) === won) return remember({ initial, final: s }, seed);
  }
  throw new Error('aucune partie guidée trouvée');
}

let n = 0;
function store(userId: number, g: { initial: GameState; final: GameState }, config: Partial<GameConfig>): string {
  const id = `2026-11-16_12-00-${String(n++).padStart(3, '0')}_essai-progression`;
  const rec: GameRecord = {
    format: 1, id, engine: 'essai', startedAt: '2026-11-16T10:00:00.000Z', updatedAt: '2026-11-16T10:30:00.000Z',
    endedAt: '2026-11-16T10:30:00.000Z', status: g.final.winner === HUMAN ? 'won' : 'lost', turns: g.final.turn,
    config: { myDeck: LEARN_CONFIG.myDeck, aiDeck: LEARN_CONFIG.aiDeck, level: 1, first: 'me', ...config } as GameConfig,
    human: HUMAN, wentFirst: true, initial: g.initial, steps: g.final.history.slice(g.initial.history.length),
    decisions: [], reviews: [], undos: [], stats: {} as GameStats, log: [],
  };
  const sent = withTicket(seedServer.issueSeed, userId, rec);
  records.saveRecord(userId, sent.id, sent, JSON.stringify(sent));
  return sent.id;
}

const read = (id: number): Progress => prog.progress(user(id), NOW);
const exploit = (p: Progress, id: string) => p.exploits.find((e) => e.id === id)!;

test('progression : un compte neuf, Mousse, rien à récupérer, 3 missions du jour', () => {
  const p = read(B);
  assert.equal(p.bounty.amount, 0);
  assert.equal(p.bounty.rank.id, 'mousse');
  assert.equal(p.bounty.next?.id, 'matelot');
  assert.equal(p.toClaim, 0);
  assert.equal(p.exploits.length, EXPLOITS.length);
  assert.ok(p.exploits.every((e) => !e.done && !e.claimed));
  assert.equal(p.missions.items.length, 3);
  assert.equal(new Set(p.missions.items.map((m) => m.id)).size, 3);
  // un débutant ne reçoit ni la mission en ligne ni celle contre l'IA Confirmé
  assert.ok(p.missions.items.every((m) => m.id !== 'jour:en-ligne' && m.id !== 'jour:confirme'));
  assert.equal(p.missions.day, '2026-11-16');
  assert.equal(p.missions.week, '2026-11-16');
  // le même tirage à chaque lecture du jour
  assert.deepEqual(read(B).missions.items.map((m) => m.id), p.missions.items.map((m) => m.id));
  assert.equal(p.name, 'pirate2');
  assert.equal(prog.progress({ id: B, pseudo: '~essai-x', guest: true }, NOW).name, 'Pirate sans nom');
});

test('progression : la partie guidée gagnée est vérifiée (IA adoucie) et donne « Premiers pas »', () => {
  const id = store(A, guided(true), { learn: true } as Partial<GameConfig>);
  const reward = eco.claimReward(A, id, NOW);
  assert.equal(reward.refused, undefined, JSON.stringify(reward.refused));
  assert.equal(reward.mode, 'guidee');
  assert.equal(reward.won, true);
  const p = read(A);
  const first = exploit(p, 'premiers-pas');
  assert.equal(first.done, true);
  assert.equal(first.claimed, false);
  assert.deepEqual(first.boosters, { set: 'OP03', count: 1 });
  assert.ok(exploit(p, 'victoire-1').done, 'première victoire');
  assert.ok(p.toClaim >= 2);
  // prime : une partie, une victoire niveau 1, deux exploits de bronze
  assert.equal(p.bounty.amount, BOUNTY.game + BOUNTY.win[1] + 2 * BOUNTY.exploit.bronze);
  // récupérer : Berry et un booster OP03, une seule fois
  const before = eco.wallet(A, NOW).balance;
  const got = prog.claimExploit(user(A), 'premiers-pas', NOW);
  assert.equal(got.already, false);
  assert.equal(got.berry, RANK_BERRY.bronze);
  assert.equal(got.boosters.length, 1);
  assert.equal(got.boosters[0].set, 'OP03');
  assert.equal(eco.wallet(A, NOW).balance, before + RANK_BERRY.bronze);
  const again = prog.claimExploit(user(A), 'premiers-pas', NOW);
  assert.equal(again.already, true);
  assert.equal(again.berry, 0);
  assert.equal(again.boosters.length, 0);
  assert.equal(eco.wallet(A, NOW).balance, before + RANK_BERRY.bronze);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_boosters WHERE user_id = ? AND source = 'exploit premiers-pas'").get(A).n, 1);
  assert.equal(exploit(got.progress, 'premiers-pas').claimed, true);
});

test('progression : la partie guidée avec une IA qui n’est pas l’IA adoucie ne compte pas', () => {
  // l'IA simple sans adoucissement contre plus souvent : une partie où elle a contré sans être à sa dernière Vie
  for (let tries = 0; tries < 30; tries++) {
    const g = guided(true, false);
    const id = store(B, g, { learn: true } as Partial<GameConfig>);
    const reward = eco.claimReward(B, id, NOW);
    if (reward.refused) {
      assert.equal(reward.refused.code, 'ai_mismatch');
      assert.equal(exploit(read(B), 'premiers-pas').done, false);
      return;
    }
  }
  assert.fail('aucune partie où l’IA simple contre trop tôt');
});

test('progression : un exploit pas obtenu ne se récupère pas ; un exploit inconnu non plus', () => {
  assert.throws(() => prog.claimExploit(user(B), 'victoires-50', NOW), (e: { code: string }) => e.code === 'not_done');
  assert.throws(() => prog.claimExploit(user(B), 'n-existe-pas', NOW), (e: { code: string }) => e.code === 'not_found');
});

test('progression : missions du jour remplies avec les parties vérifiées, récupérées une fois', () => {
  const p = read(A);
  const done = p.missions.items.filter((m) => m.done);
  for (const m of p.missions.items) assert.ok(m.have <= m.need);
  for (const m of done) {
    const got = prog.claimMission(user(A), m.id, NOW);
    assert.equal(got.berry, m.berry);
    assert.equal(prog.claimMission(user(A), m.id, NOW).berry, 0);
  }
  const open = p.missions.items.find((m) => !m.done);
  if (open) assert.throws(() => prog.claimMission(user(A), open.id, NOW), (e: { code: string }) => e.code === 'not_done');
  assert.throws(() => prog.claimMission(user(A), 'jour:pas-ce-jour', NOW), (e: { code: string }) => e.code === 'not_found');
  // le lendemain : un autre tirage, rien de rempli
  const tomorrow = prog.progress(user(A), new Date('2026-11-17T11:00:00.000Z'));
  assert.equal(tomorrow.missions.day, '2026-11-17');
  assert.ok(tomorrow.missions.items.every((m: { have: number; id: string }) => m.have === 0 || m.id === 'jour:booster'));
  // la semaine : 1 victoire sur 8
  assert.equal(p.missions.weekly.have, 1);
  assert.throws(() => prog.claimMission(user(A), 'semaine', NOW), (e: { code: string }) => e.code === 'not_done');
});

test('progression : paliers de prime, titre et Leader favori', () => {
  assert.equal(rankOf(0).rank.id, 'mousse');
  assert.equal(rankOf(3_000_000).rank.id, 'matelot');
  assert.equal(rankOf(2_999_999).rank.id, 'mousse');
  assert.equal(rankOf(600_000_000).next, null);
  const p = prog.setProfile(user(A), { title: 'premiers-pas', leader: 'OP01-001' }, NOW);
  assert.deepEqual(p.profile, { title: 'premiers-pas', leader: 'OP01-001' });
  assert.deepEqual(prog.setProfile(user(A), { title: 'rang:mousse' }, NOW).profile, { title: 'rang:mousse', leader: 'OP01-001' });
  assert.throws(() => prog.setProfile(user(A), { title: 'victoires-50' }, NOW), /pas encore gagné/);
  assert.throws(() => prog.setProfile(user(A), { title: 'rang:legende' }, NOW), /pas encore gagné/);
  assert.throws(() => prog.setProfile(user(A), { leader: 'OP01-016' }, NOW), /Leader inconnu/);
  assert.deepEqual(prog.setProfile(user(A), { title: null, leader: null }, NOW).profile, { title: null, leader: null });
});

test('progression : le coffre de la semaine suit l’arc en cours', () => {
  assert.equal(eco.chestSet(B), 'OP03');
  db.prepare("INSERT INTO game_adventure (user_id, arc, started_at) VALUES (?, 'east-blue', ?)").run(B, NOW.toISOString());
  assert.equal(eco.chestSet(B), 'OP03');
  db.prepare("INSERT INTO game_adventure (user_id, arc, started_at) VALUES (?, 'alabasta', ?)").run(B, NOW.toISOString());
  assert.equal(eco.chestSet(B), 'OP04');
  assert.equal(eco.wallet(B, NOW).chest.set, 'OP04');
});
