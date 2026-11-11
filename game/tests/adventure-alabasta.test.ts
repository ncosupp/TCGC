// Données de l'arc Alabasta (tâche 5.5) : decks des adversaires légaux et jouables, chapitres dans l'ordre de
// l'histoire, dialogues, portraits, récompenses (boosters OP04, Berry, recrues rouges) et place sur la carte du monde.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADVENTURE_DECKS } from '../adventure/decks.ts';
import { ALABASTA_DECKS } from '../adventure/decks-alabasta.ts';
import { ALABASTA } from '../adventure/alabasta.ts';
import { EAST_BLUE } from '../adventure/east-blue.ts';
import { chapterStatuses, currentChapter } from '../adventure/progress.ts';
import { LANDMARKS, chapterPoint, findRegion, sideTrips, voyage } from '../adventure/world.ts';
import { ECONOMY } from '../economy/config.ts';
import { CARDS, cardStatus } from '../engine/cards/index.ts';
import { playableErrors } from '../engine/deckRules.ts';
import { DECKS, deckSize } from '../engine/decks.ts';

const story = [...ALABASTA.chapters].sort((a, b) => a.order - b.order).filter((c) => !c.optional);

test('Alabasta : decks AV-AL légaux et jouables, série AVENTURE, à la fin du registre', () => {
  const ids = Object.keys(ALABASTA_DECKS);
  assert.ok(ids.length >= 7);
  for (const [id, d] of Object.entries(ALABASTA_DECKS)) {
    assert.equal(d.id, id);
    assert.match(id, /^AV-AL-[A-Z0-9-]+$/);
    assert.equal(d.series, 'AVENTURE');
    assert.equal(deckSize(d), 50, id);
    assert.deepEqual(playableErrors(d.leader, d.cards), [], id);
    assert.equal(DECKS[id], d, `${id} absent du registre`);
    assert.ok(!ADVENTURE_DECKS[id], `${id} en double avec East Blue`);
  }
  // les decks d'Alabasta sont les derniers du registre (graines de l'empreinte)
  assert.deepEqual(Object.keys(DECKS).slice(-ids.length), ids);
});

test('Alabasta : chapitres al-<n>-<lieu> dans l’ordre de l’histoire, tous les decks servent, niveau Débutant', () => {
  assert.equal(new Set(ALABASTA.chapters.map((c) => c.id)).size, ALABASTA.chapters.length);
  for (const c of ALABASTA.chapters) {
    assert.match(c.id, c.optional ? /^al-defi-[a-z-]+$/ : /^al-\d-[a-z-]+$/, c.id);
    assert.ok(ALABASTA_DECKS[c.opponent.deck], `${c.id} : deck ${c.opponent.deck}`);
    // tâche 5.8 : tout l'arc au niveau Débutant, comme East Blue (la difficulté vient des listes)
    assert.equal(c.opponent.level, 1, `${c.id} : niveau ${c.opponent.level}`);
  }
  assert.deepEqual(story.map((c) => c.place), ['Reverse Mountain', 'Whisky Peak', 'Little Garden', 'Royaume de Drum', 'Yuba', 'Rainbase', 'Alubarna']);
  const challenges = ALABASTA.chapters.filter((c) => c.optional).length;
  assert.ok(challenges >= 1 && challenges <= 3, `${challenges} défis`);
  const used = new Set(ALABASTA.chapters.map((c) => c.opponent.deck));
  for (const id of Object.keys(ALABASTA_DECKS)) assert.ok(used.has(id), `${id} ne sert à aucun chapitre`);
});

test('Alabasta : le premier chapitre exige la fin d’East Blue, les défis ne bloquent pas l’histoire', () => {
  assert.equal(ALABASTA.requiresArc, 'east-blue');
  const lastEb = [...EAST_BLUE.chapters].sort((a, b) => a.order - b.order).filter((c) => !c.optional).pop()!;
  assert.deepEqual(story[0].requires, [lastEb.id]);
  assert.equal(chapterStatuses(ALABASTA, new Set())[story[0].id], 'locked');
  // l'arc exige East Blue fini en entier (tâche 5.7), pas seulement son dernier chapitre
  const ebDone = new Set(EAST_BLUE.chapters.filter((c) => !c.optional).map((c) => c.id));
  assert.equal(currentChapter(ALABASTA, new Set([lastEb.id])), undefined);
  assert.equal(currentChapter(ALABASTA, ebDone), story[0].id);
  // toute l'histoire gagnée sans les défis : rien n'est verrouillé
  const wins = new Set([...ebDone, ...story.map((c) => c.id)]);
  assert.equal(currentChapter(ALABASTA, wins), undefined);
  assert.ok(Object.values(chapterStatuses(ALABASTA, wins)).every((s) => s !== 'locked'));
});

test('Alabasta : dialogues de 3 à 6 répliques, portraits de cartes jouables', () => {
  for (const c of ALABASTA.chapters) {
    for (const [part, lines] of Object.entries({ intro: c.intro, victory: c.victory, defeat: c.defeat })) {
      assert.ok(lines.length >= 3 && lines.length <= 6, `${c.id} ${part} : ${lines.length} répliques`);
      for (const line of lines) {
        assert.ok(line.text.trim() && !/provisoire/i.test(line.text), `${c.id} ${part} : « ${line.text} »`);
        assert.ok(line.who || !line.card, `${c.id} : la narration n'a pas de portrait`);
        if (!line.card) continue;
        assert.ok(CARDS[line.card], `${c.id} : portrait ${line.card} absent du catalogue`);
        assert.notEqual(cardStatus(line.card), 'todo', `${c.id} : portrait ${line.card} pas jouable`);
      }
    }
  }
});

test('Alabasta : récompenses (boosters OP04, Berry du barème, Chopper à Drum et Vivi à la fin, rouges et jouables)', () => {
  const { firstWin, firstWinFinal, firstWinBonus } = ECONOMY.adventure;
  const final = story[story.length - 1];
  const recruits: Record<string, string> = {};
  let total = 0;
  for (const c of ALABASTA.chapters) {
    const packs = c.rewards.filter((r) => r.kind === 'booster');
    assert.ok(packs.length, `${c.id} : pas de booster`);
    for (const r of c.rewards) {
      if (r.kind === 'booster') { assert.equal(r.set, 'OP04', c.id); total += r.count; }
      if (r.kind === 'berry') assert.equal(r.amount, c.optional ? firstWinBonus : c === final ? firstWinFinal : firstWin, c.id);
      if (r.kind === 'card') {
        assert.notEqual(cardStatus(r.number), 'todo', `${c.id} : recrue ${r.number} pas jouable`);
        assert.deepEqual(CARDS[r.number].colors, ['Red'], `${c.id} : recrue ${r.number}`);
        recruits[c.id] = CARDS[r.number].names[0];
      }
      assert.notEqual(r.kind, 'deck', `${c.id} : pas de deck offert`);
    }
  }
  assert.deepEqual(recruits, { 'al-4-drum': 'Tony Tony.Chopper', [final.id]: 'Nefeltari Vivi' });
  assert.ok(total >= 17 && total <= 26, `${total} boosters sur l'arc`);
});

test('Alabasta : îles dans Grand Line, assez espacées, sur la route après Reverse Mountain', () => {
  const region = findRegion(ALABASTA.region)!;
  assert.ok(region.open);
  const points = ALABASTA.chapters.map((c) => {
    assert.ok(c.map.x >= 0 && c.map.x <= 1 && c.map.y >= 0 && c.map.y <= 1, c.id);
    return { id: c.id, ...chapterPoint(ALABASTA, c) };
  });
  for (const [i, a] of points.entries()) {
    for (const b of points.slice(i + 1)) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 50, `${a.id} et ${b.id} trop proches`);
    for (const l of LANDMARKS) assert.ok(Math.hypot(a.x - l.x, a.y - l.y) >= 40, `${a.id} trop proche de ${l.name}`);
  }
  const stops = voyage([EAST_BLUE, ALABASTA]).map((s) => s.id);
  const at = stops.indexOf('reverse-mountain');
  assert.deepEqual(stops.slice(at + 1, at + 1 + story.length), story.map((c) => c.id));
  assert.equal(stops[at + 1 + story.length], 'marie-joie');
  for (const c of ALABASTA.chapters.filter((x) => x.optional)) {
    assert.ok(sideTrips([ALABASTA]).some((t) => t.chapter === c.id), c.id);
  }
});
