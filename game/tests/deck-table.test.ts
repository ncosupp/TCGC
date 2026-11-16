// « La table », l'éditeur de deck de la refonte du jeu (game/ui/builder/table.ts) : règles d'ajout (4 exemplaires,
// Cale du deck d'aventure, deck complet), piles par coût, composition, conseil, Ranked, changement de Leader.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import {
  advice, canAdd, composition, deckTotal, filterReserve, fits, keepForLeader, leaderChoices, maxCopies, outOfHold, pileOf,
  rankedEligible, reservePool, type Composition,
} from '../ui/builder/table.ts';
import { def } from '../engine/rules.ts';

const LUFFY = 'ST01-001';   // Leader rouge
const pool = reservePool(LUFFY, 'libre', null);
const char = pool.find((n) => CARDS[n].category === 'CHARACTER' && CARDS[n].counter === 1000)!;
const other = pool.find((n) => n !== char && CARDS[n].category === 'CHARACTER')!;

test('table : la réserve d’un deck libre propose les cartes de la couleur du Leader, triées par coût', () => {
  assert.ok(pool.length > 50);
  for (const n of pool) assert.ok(CARDS[n].colors.every((c) => CARDS[LUFFY].colors.includes(c)), n);
  for (let i = 1; i < pool.length; i++) assert.ok((CARDS[pool[i - 1]].cost ?? 0) <= (CARDS[pool[i]].cost ?? 0));
  assert.ok(!pool.includes(LUFFY));
});

test('table : en aventure, la réserve ne garde que la Cale, et le maximum suit ses exemplaires', () => {
  const hold = { [char]: 2, [other]: 7, [LUFFY]: 1 };
  assert.deepEqual(reservePool(LUFFY, 'aventure', hold).sort(), [char, other].sort());
  assert.equal(maxCopies(def(char), 'aventure', hold), 2);
  assert.equal(maxCopies(def(other), 'aventure', hold), 4);
  assert.equal(maxCopies(def(char), 'libre', hold), 4);
  assert.equal(canAdd({ [char]: 1 }, char, 'aventure', hold), 'ok');
  assert.equal(canAdd({ [char]: 2 }, char, 'aventure', hold), 'hold');
  assert.equal(canAdd({ [other]: 4 }, other, 'aventure', hold), 'max');
  assert.equal(canAdd({ [char]: 4 }, char, 'libre', null), 'max');
});

test('table : 50 cartes au plus', () => {
  const cards = Object.fromEntries(pool.slice(0, 13).map((n) => [n, 4]));
  cards[pool[0]] = 2;
  assert.equal(deckTotal(cards), 50);
  assert.equal(canAdd(cards, pool[20], 'libre', null), 'full');
});

test('table : piles de 0 à 7+, composition et contres', () => {
  assert.equal(pileOf(null), 0);
  assert.equal(pileOf(3), 3);
  assert.equal(pileOf(10), 7);
  const cards = { [char]: 4, [other]: 2 };
  const c = composition(cards);
  assert.equal(c.total, 6);
  assert.equal(c.piles.reduce((s, n) => s + n, 0), 6);
  assert.equal(c.characters, 6);
  assert.ok(c.c1000 >= 4);
  assert.equal(c.c1000 + c.c2000 + c.noCounter, c.characters);
});

test('table : conseil de composition, dans l’ordre des seuils', () => {
  const base: Composition = { piles: [0, 8, 8, 8, 6, 2, 1, 1], characters: 40, events: 8, stages: 2, c1000: 14, c2000: 8, noCounter: 18, total: 50 };
  assert.deepEqual(advice(base), { key: 'balanced' });
  assert.deepEqual(advice({ ...base, c2000: 5 }), { key: 'fewCounters', n: 5 });
  assert.deepEqual(advice({ ...base, c2000: 5, total: 19 }), { key: 'balanced' });
  assert.deepEqual(advice({ ...base, piles: [0, 6, 6, 6, 6, 6, 6, 6] }), { key: 'heavy' });
  assert.deepEqual(advice({ ...base, piles: [10, 14, 4, 4, 10, 2, 3, 3] }), { key: 'fewEarly' });
});

test('table : Ranked seulement si chaque carte est dans la Cale, Leader compris, et le deck complet', () => {
  const cards = Object.fromEntries(pool.slice(0, 12).map((n) => [n, 4]));
  cards[pool[12]] = 2;
  const hold = Object.fromEntries([[LUFFY, 1], ...pool.slice(0, 13).map((n) => [n, 4])]);
  assert.equal(outOfHold(cards, hold), 0);
  assert.equal(rankedEligible(LUFFY, cards, hold), true);
  assert.equal(rankedEligible(LUFFY, cards, { ...hold, [LUFFY]: 0 }), false);
  assert.equal(outOfHold(cards, { ...hold, [pool[0]]: 1 }), 3);
  assert.equal(rankedEligible(LUFFY, { ...cards, [pool[12]]: 1 }, hold), false);
});

test('table : changer de Leader retire les cartes d’une autre couleur', () => {
  const green = leaderChoices('libre', null).find((l) => CARDS[l.num].colors.length === 1 && CARDS[l.num].colors[0] === 'Green')!.num;
  const kept = keepForLeader(green, { [char]: 4 });
  assert.deepEqual(kept, {});
  assert.ok(fits(LUFFY, char) && !fits(green, char));
});

test('table : filtres de la réserve combinés (coût, contre, nom, Cale)', () => {
  const k = pileOf(CARDS[char].cost);
  const byCost = filterReserve(pool, { source: 'all', cost: k, attr: null }, null);
  assert.ok(byCost.includes(char) && byCost.every((n) => pileOf(CARDS[n].cost) === k));
  const both = filterReserve(pool, { source: 'all', cost: k, attr: 'c1' }, null);
  assert.ok(both.includes(char) && both.every((n) => CARDS[n].counter === 1000));
  assert.deepEqual(filterReserve(pool, { source: 'cale', cost: null, attr: null }, { [other]: 1 }), [other]);
  assert.ok(filterReserve(pool, { source: 'all', cost: null, attr: null, query: CARDS[char].name.slice(0, 5) }, null).includes(char));
});

test('table : en aventure, les Leaders de la Cale passent devant', () => {
  const list = leaderChoices('aventure', { [LUFFY]: 1 });
  assert.equal(list[0].num, LUFFY);
  assert.equal(list[0].inHold, true);
  assert.equal(list.filter((l) => l.inHold).length, 1);
});
