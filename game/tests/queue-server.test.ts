// Jeu en ligne de l'étape J (server/game-online.js, game/online/match.ts), sur une base temporaire : file « Trouver un
// adversaire » (appariement, salle gardée, quitter), chrono (le temps ne coule que pour celui qui décide, +5 s par
// décision, défaite au temps), revanche (les deux la demandent, celui qui avait joué second commence), réactions.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { heuristicChooser } from '../ai/heuristic.ts';
import { checkClock, CLOCK, isReaction, MatchError, offerRematch, play, timeLeft, viewOf, type Match } from '../online/match.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-file-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const paths = { db: '../../server/db.js', online: '../../server/game-online.js' };
const { db } = await import(paths.db);
const online = await import(paths.online);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const A = { id: 1, pseudo: 'Luffy' };
const B = { id: 2, pseudo: 'Zoro' };
const C = { id: 3, pseudo: 'Nami' };
for (const u of [A, B, C]) {
  db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(u.id, u.pseudo, `joueur${u.id}@example.invalid`, 'scrypt$essai', '2026-10-19T10:00:00Z');
}
const t0 = new Date('2026-11-16T18:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);

test('file : le premier attend dans une salle cachée, le second le rejoint, la partie commence', () => {
  const first = online.enterQueue(A, 'ST-01', t0);
  assert.equal(first.status, 'waiting');
  // pas dans les salles publiques
  assert.deepEqual(online.openRooms(B.id, t0), []);
  // revenir dans la file avec le même deck garde la même salle
  assert.equal(online.enterQueue(A, 'ST-01', at(30)).id, first.id);
  assert.deepEqual(online.queueStats(B.id, at(31)), { today: 0, waiting: 1 });
  const second = online.enterQueue(B, 'ST-02', at(60));
  assert.deepEqual(second, { status: 'matched', id: first.id });
  assert.equal(online.queueStats(C.id, at(61)).today, 2);
  // un deck inconnu est refusé
  assert.throws(() => online.enterQueue(C, 'PAS-UN-DECK', at(62)), (e: unknown) => e instanceof MatchError && e.code === 'invalid_deck');
  // quitter la file ferme la salle
  const mine = online.enterQueue(C, 'ST-01', at(63));
  assert.equal(mine.status, 'waiting');
  online.leaveQueue(C, at(64));
  assert.equal(online.enterQueue(A, 'ST-01', at(65)).status, 'waiting', 'C n’attend plus : A attend à son tour');
  online.leaveQueue(A, at(66));
});

test('chrono : 25 min chacun, le temps ne coule que pour celui qui décide, +5 s par décision', () => {
  const room = online.openRoom(A, 'ST-01', t0);
  const m: Match = online.enterRoom(B, room.code, 'ST-02', t0);
  assert.ok(m.clock);
  assert.deepEqual(m.clock.left, [CLOCK.reserve, CLOCK.reserve]);
  const seat = m.state!.decision!.player;
  const other = seat === 0 ? 1 : 0;
  assert.equal(timeLeft(m, seat, at(10)), CLOCK.reserve - 10_000);
  assert.equal(timeLeft(m, other, at(10)), CLOCK.reserve);
  play(m, seat, m.state!.history.length, heuristicChooser(m.state!, m.state!.decision!), at(10));
  assert.equal(m.clock.left[seat], CLOCK.reserve - 10_000 + CLOCK.increment);
  const v = viewOf(m, 0, at(11));
  assert.equal(v.clock?.now, at(11).toISOString());
  // le joueur qui doit jouer laisse filer tout son temps : défaite au temps
  const who = m.clock.seat!;
  const name = m.state!.players[who].name;
  assert.equal(checkClock(m, at(20)), false);
  assert.equal(checkClock(m, at(10 + 26 * 60)), true);
  assert.equal(m.status, 'over');
  assert.equal(m.state!.winner, who === 0 ? 1 : 0);
  assert.equal(m.state!.winReason, `${name} n’a plus de temps`);
  assert.throws(() => play(m, who, m.state!.history.length, 'x', at(10 + 26 * 60)), (e: unknown) => e instanceof MatchError && e.code === 'not_playing');
});

test('revanche : les deux la demandent, mêmes decks, celui qui avait joué second commence', () => {
  const room = online.openRoom(A, 'ST-01', t0);
  const m: Match = online.enterRoom(B, room.code, 'ST-02', t0);
  assert.throws(() => offerRematch(m, 0), (e: unknown) => e instanceof MatchError && e.code === 'not_over');
  online.giveUp(A, m.id, () => undefined, at(5));
  const once = online.askRematch(A, m.id, at(6));
  assert.deepEqual(once.rematch, { offers: [0], next: null });
  // la même demande deux fois ne fait rien de plus
  assert.deepEqual(online.askRematch(A, m.id, at(7)).rematch, { offers: [0], next: null });
  const both = online.askRematch(B, m.id, at(8));
  assert.ok(both.rematch.next);
  const next = online.askRematch(B, m.id, at(9));
  assert.equal(next.rematch.next, both.rematch.next, 'une seule revanche');
  // la nouvelle partie : mêmes joueurs et decks, l'autre premier joueur
  const row = db.prepare('SELECT host_id, guest_id, status FROM game_matches WHERE id = ?').get(both.rematch.next);
  assert.deepEqual({ ...row }, { host_id: A.id, guest_id: B.id, status: 'playing' });
  const r: Match = online.loadMatch(both.rematch.next);
  assert.equal(r.state!.first, m.state!.first === 0 ? 1 : 0);
  assert.equal(r.host.deck, 'ST-01');
  assert.equal(r.guest!.deck, 'ST-02');
});

test('réactions : six prédéfinies seulement', () => {
  for (const r of ['bonne-chance', 'bien-joue', 'gg', 'merci', 'oups', 'reflechis']) assert.ok(isReaction(r));
  assert.equal(isReaction('insulte libre'), false);
  assert.equal(isReaction(3), false);
});
