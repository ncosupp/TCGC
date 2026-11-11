// Boosters OP04 (tâche 5.4) : liste officielle cohérente avec le catalogue, composition des boosters, taux sur
// 100 000 boosters, garanties d'un display. Taux attendus : game/docs/boosters.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOSTER_SIZE, DISPLAY_SIZE, openBooster, openDisplay } from '../boosters/open.ts';
import { BOOSTER_SETS, findVersion, versionImageUrl } from '../boosters/sets/index.ts';
import type { PulledCard, Rand } from '../boosters/types.ts';
import { CARDS, cardData } from '../engine/cards/index.ts';
import { ECONOMY } from '../economy/config.ts';

function seeded(seed: number): Rand {
  let s = seed | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OP04 = BOOSTER_SETS.OP04;
const hit = (c: PulledCard) => c.variant !== 'base';
const count = (cards: PulledCard[], f: (c: PulledCard) => boolean) => cards.filter(f).length;
const isBase = (rarity: string) => (c: PulledCard) => c.variant === 'base' && c.rarity === rarity;
const near = (observed: number, expected: number, label: string) =>
  assert.ok(Math.abs(observed - expected) <= 5 * Math.sqrt(expected) + 1, `${label} : ${observed} pour ${expected.toFixed(1)} attendus`);

// Surprises par display : 2 lots de (111 + 2 × 77) / 312
const HITS = 2 * (111 + 2 * 77) / 312;
const TOTAL_WEIGHT = OP04.hits.reduce((a, h) => a + h.weight, 0);

test('boosters OP04 : liste officielle (119 cartes, 25 parallèles, 5 cartes SP) cohérente avec le catalogue', () => {
  const sizes = Object.fromEntries(Object.entries(OP04.cards).map(([r, list]) => [r, list.length]));
  assert.deepEqual(sizes, { L: 6, C: 45, UC: 30, R: 26, SR: 10, SEC: 2 });
  const numbers = Object.values(OP04.cards).flat();
  assert.equal(new Set(numbers).size, 119);
  const catalog = Object.keys(cardData()).filter((n) => n.startsWith('OP04-'));
  assert.deepEqual([...catalog].sort(), [...numbers].sort());
  for (const [rarity, list] of Object.entries(OP04.cards)) {
    for (const n of list) {
      assert.ok(CARDS[n], `${n} jouable`);
      // la 119 (Rosinante, SEC) est rangée « SP CARD » par la liste du catalogue
      const expected = n === 'OP04-119' ? 'SP CARD' : rarity;
      assert.equal(cardData()[n]?.rarity, expected, `${n} : rareté du catalogue`);
    }
  }
  const versions = OP04.hits.flatMap((h) => h.versions);
  assert.equal(versions.filter((v) => v.variant === 'parallele').length, 24);
  assert.equal(versions.filter((v) => v.variant === 'manga').length, 1);
  assert.equal(versions.filter((v) => v.variant === 'sp').length, 5);
  assert.equal(new Set(versions.map((v) => v.imageId)).size, versions.length);
  for (const v of versions) {
    assert.ok(CARDS[v.number], `${v.number} absent du catalogue`);
    assert.match(v.imageId, new RegExp(`^${v.number}_p\\d$`));
    assert.equal(findVersion(v.number, v.variant), v);
    // le visuel existe dans la liste anglaise du catalogue
    const ids = cardData()[v.number] as unknown as { versions?: { imageId: string; lang: string }[] };
    if (ids.versions) assert.ok(ids.versions.some((x) => x.lang === 'en' && x.imageId === v.imageId), `${v.imageId} absent de la liste anglaise`);
    if (v.variant === 'parallele') assert.ok(OP04.cards[v.rarity as keyof typeof OP04.cards].includes(v.number));
  }
  for (const n of [...OP04.cards.SR, ...OP04.cards.SEC, ...OP04.cards.L]) assert.ok(findVersion(n, 'parallele'), n);
  assert.equal(versionImageUrl('OP04-083', 'manga'), 'img-en-hd/OP04-083_p2.webp');
  assert.equal(versionImageUrl('OP02-099', 'sp'), 'img-en-hd/OP02-099_p2.webp');
});

test('boosters OP04 : boutique au même barème qu’OP03, coffre de la semaine resté OP03', () => {
  assert.deepEqual(ECONOMY.shop.OP04, ECONOMY.shop.OP03);
  assert.equal(ECONOMY.weeklyChest.set, 'OP03');
});

test('boosters OP04 : composition, taux sur 100 000 boosters et garanties d’un display', () => {
  assert.equal(BOOSTER_SIZE, OP04.commons + OP04.uncommons + 2);
  assert.deepEqual(openBooster('OP04', seeded(5)), openBooster('OP04', seeded(5)));
  const rand = seeded(2026);
  const n = 100_000;
  const tally: Record<string, number> = {};
  const add = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  for (let i = 0; i < n; i++) {
    const b = openBooster('OP04', rand);
    assert.equal(b.set, 'OP04');
    assert.equal(b.cards.length, BOOSTER_SIZE);
    if (i < 3000) {
      const commons = count(b.cards, isBase('C'));
      assert.ok(commons === 7 || commons === 8);
      assert.equal(count(b.cards, isBase('UC')), 3);
      assert.equal(count(b.cards, (c) => c.variant === 'base' && ['R', 'SR', 'SEC'].includes(c.rarity)), 1);
      assert.equal(new Set(b.cards.map((c) => `${c.number}|${c.variant}`)).size, BOOSTER_SIZE);
      for (const c of b.cards) assert.ok(CARDS[c.number], c.number);
    }
    for (const c of b.cards) {
      if (hit(c)) {
        add('hits');
        add(OP04.hits.find((h) => h.versions.some((v) => v.number === c.number && v.variant === c.variant))?.id ?? '?');
      } else add(c.rarity);
    }
  }
  const per = (perDisplay: number) => (n * perDisplay) / DISPLAY_SIZE;
  near(tally.SR ?? 0, per(7), 'SR');
  near(tally.L ?? 0, per(7), 'L');
  near(tally.SEC ?? 0, per(2 * 124 / 312), 'SEC');
  near(tally.hits ?? 0, per(HITS), 'surprises');
  for (const h of OP04.hits) near(tally[h.id] ?? 0, per((HITS * h.weight) / TOTAL_WEIGHT), h.id);
  assert.equal(tally['?'], undefined);
  assert.equal(tally.UC, 3 * n);

  const d = seeded(31);
  for (let i = 0; i < 300; i++) {
    const display = openDisplay('OP04', d);
    assert.equal(display.length, DISPLAY_SIZE);
    const cards = display.flatMap((b) => b.cards);
    const sr = count(cards, isBase('SR')), leaders = count(cards, isBase('L'));
    const sec = count(cards, isBase('SEC')), hits = count(cards, hit);
    assert.ok(sr >= 6 && sr <= 8 && leaders >= 6 && leaders <= 8);
    assert.ok(sec <= 2 && sec + hits >= 2 && sec + hits <= 4);
  }
});
