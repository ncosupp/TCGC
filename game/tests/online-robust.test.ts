// Parties en ligne (game/online/match.ts), audit du 14 novembre 2026 : une erreur du moteur arrête la partie sans
// perdant au lieu de la bloquer (P1-2), le générateur de 128 bits des parties en ligne (P2-1), parties complètes aux
// choix tirés au hasard, partie laissée à l'abandon.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIDDEN } from '../engine/cards/index.ts';
import { act, newGame } from '../engine/engine.ts';
import { random, rng128From, shuffle } from '../engine/rng.ts';
import type { PlayerId } from '../engine/types.ts';
import { createMatch, idle, IDLE_DAYS, joinMatch, MatchError, play, recordFor, stop, viewOf, type Match } from '../online/match.ts';

const t0 = new Date('2026-11-14T18:00:00Z');
const later = (min: number) => new Date(t0.getTime() + min * 60_000);
const host = { userId: 1, name: 'Luffy', deck: 'ST-35' };
const guest = { userId: 2, name: 'Zoro', deck: 'ST-32' };

function started(seed: number | number[], decks: [string, string] = ['ST-35', 'ST-32']): Match {
  const m = createMatch('partie-essai', 'K7MQ2P', { ...host, deck: decks[0] }, t0, 'test');
  joinMatch(m, { ...guest, deck: decks[1] }, later(1), seed);
  return m;
}

test('générateur : 128 bits pour les parties en ligne, mulberry32 inchangé pour les autres', () => {
  // mulberry32 : mêmes tirages qu'avant (les parties contre l'IA et les anciennes parties en ligne se rejouent)
  const old = { rng: 12345 };
  assert.deepEqual([random(old), random(old), random(old)].map((x) => Math.round(x * 1e9)), [979_728_268, 306_752_264, 484_205_422]);
  // sfc32 : reproductible, et l'état ne se réduit pas à rng
  const a = { rng: 0, rng128: rng128From([1, 2, 3, 4]) };
  const b = { rng: 0, rng128: rng128From([1, 2, 3, 4]) };
  const xs = Array.from({ length: 50 }, () => random(a));
  assert.deepEqual(xs, Array.from({ length: 50 }, () => random(b)));
  assert.equal(a.rng, 0);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.ok(new Set(xs).size === 50);
  // un mot différent : une autre suite
  const c = { rng: 0, rng128: rng128From([1, 2, 3, 5]) };
  assert.notDeepEqual(Array.from({ length: 5 }, () => random(c)), xs.slice(0, 5));
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  shuffle({ rng: 0, rng128: rng128From([9, 9, 9, 9]) }, items);
  assert.deepEqual([...items].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.throws(() => rng128From([1, 2, 3]));
  assert.throws(() => rng128From([1, 2, 3, 0.5]));
});

test('en ligne : la partie tire son hasard de 128 bits, jamais envoyé ; une graine d’un seul nombre garde l’ancien générateur', () => {
  const m = started([0xdeadbeef, 42, 7, 0x12345678]);
  assert.ok(m.initial!.rng128);
  assert.equal(m.initial!.rng, 0);
  for (const seat of [0, 1] as PlayerId[]) {
    const v = JSON.stringify(viewOf(m, seat));
    assert.ok(!v.includes('rng128'));
  }
  // même graine : même partie (le serveur la rejoue depuis l'état de départ)
  assert.deepEqual(started([0xdeadbeef, 42, 7, 0x12345678]).initial, m.initial);
  assert.notDeepEqual(started([0xdeadbeef, 42, 7, 0x12345679]).initial!.players[0].deck, m.initial!.players[0].deck);
  // ancienne graine (parties archivées d'avant le 14 novembre 2026) : état de départ identique à celui du moteur d'avant
  const old = started(5);
  assert.equal(old.initial!.rng128, undefined);
  assert.equal('rng128' in old.initial!, false);
  const solo = newGame({ decks: ['ST-35', 'ST-32'], names: ['Luffy', 'Zoro'], seed: 5, first: 'random' });
  assert.deepEqual(old.initial, solo);
});

test('en ligne : une erreur du moteur arrête la partie sans perdant, au lieu de la bloquer', () => {
  const m = started([1, 2, 3, 4]);
  // faux effet en cours dont l'instantané est illisible : le moteur lève une erreur sur le choix suivant
  const before = m.state!;
  const d = before.decision!;
  before.decision = { ...d, inEffect: true };
  before.pending = [{ snapshot: '{ illisible', answers: [] } as never, ...before.pending];
  const choice = d.options[0].id;
  assert.throws(() => act(before, choice));
  play(m, d.player, before.history.length, choice, later(3));
  assert.equal(m.status, 'error');
  assert.equal(m.state, before, 'l’état d’avant le choix est gardé tel quel');
  assert.equal(m.state!.winner, null);
  assert.equal(m.endedAt, later(3).toISOString());
  assert.equal(m.failure?.choice, choice);
  assert.equal(m.failure?.seat, d.player);
  assert.equal(m.failure?.seq, before.history.length);
  assert.ok(m.failure?.message);
  // plus aucun coup ; la vue dit l'arrêt sans rien de l'erreur ; la partie rangée est « abandonnée », sans gagnant
  assert.throws(() => play(m, d.player, before.history.length, choice, later(4)), (e: unknown) => e instanceof MatchError && e.code === 'not_playing');
  for (const seat of [0, 1] as PlayerId[]) {
    const v = viewOf(m, seat);
    assert.equal(v.status, 'error');
    assert.ok(!JSON.stringify(v).includes('failure'));
    assert.equal(recordFor(m, seat, later(5)).status, 'abandoned');
  }
});

test('en ligne : parties complètes aux choix tirés au hasard, jusqu’au bout, sans erreur du moteur', () => {
  const decks: [string, string][] = [['ST-35', 'ST-32'], ['ST-31', 'ST-36'], ['ST-34', 'ST-33'], ['META-ROBIN-2026-10', 'META-MIHAWK-2026-10'], ['ST-01', 'META-XEBEC-2026-10']];
  let finished = 0;
  for (let g = 0; g < 10; g++) {
    const m = started([g, g * 7919, 0xabcdef ^ g, 31337], decks[g % decks.length]);
    const pick = { rng: 1000 + g };
    let moves = 0;
    while (m.status === 'playing' && moves < 3000) {
      const d = m.state!.decision!;
      play(m, d.player, viewOf(m, d.player).seq, d.options[Math.floor(random(pick) * d.options.length)].id, later(2));
      moves++;
    }
    assert.notEqual(m.status, 'error', `partie ${g} : ${m.failure?.message} (${m.failure?.choice})\n${m.failure?.stack}`);
    if (m.status === 'over') {
      finished++;
      assert.notEqual(m.state!.winner, null);
      for (const seat of [0, 1] as PlayerId[]) {
        const rec = recordFor(m, seat, later(60));
        assert.ok(rec.status === 'won' || rec.status === 'lost');
        assert.ok(!JSON.stringify(rec).includes('rng128'), 'générateur de la partie dans « Mes parties »');
        const opp = rec.initial.players[seat === 0 ? 1 : 0];
        assert.ok([...opp.hand, ...opp.deck, ...opp.life].every((c) => c.num === HIDDEN));
      }
    }
  }
  assert.ok(finished >= 8, `${finished} parties finies sur 10`);
});

test('en ligne : partie laissée à l’abandon, arrêtée sans perdant après IDLE_DAYS jours', () => {
  const m = started([9, 8, 7, 6]);
  const quiet = (days: number) => new Date(Date.parse(m.updatedAt) + days * 86_400_000);
  assert.equal(idle(m, quiet(IDLE_DAYS - 0.1)), false);
  assert.equal(idle(m, quiet(IDLE_DAYS + 0.1)), true);
  stop(m, 'abandoned', quiet(IDLE_DAYS + 0.1));
  assert.equal(m.status, 'abandoned');
  assert.equal(m.state!.winner, null);
  assert.equal(idle(m, quiet(30)), false);
  assert.throws(() => stop(m, 'abandoned', quiet(31)));
  assert.equal(recordFor(m, 0, quiet(8)).status, 'abandoned');
});
