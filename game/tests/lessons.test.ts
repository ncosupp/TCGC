// « Apprendre à jouer » (game/ui/learn/lessons.ts) : sur de vraies parties de la partie guidée (ST-01 contre la Marine de Morgan, tu
// commences), chaque leçon arrive au bon moment, une seule fois, et toutes les leçons de base sont vues
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heuristicChooser } from '../ai/heuristic.ts';
import { act, newGame } from '../engine/engine.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { gentleChoice, LEARN_CONFIG, LESSON_ORDER, lessonFor, lessonPreempts, lessonStillFits, lessonText, nextShown, type LessonId } from '../ui/learn/lessons.ts';

const HUMAN: PlayerId = 0;

// Une partie entière jouée par l'IA simple des deux côtés ; renvoie les leçons dans l'ordre où elles arrivent, avec
// l'état qui les a appelées
function lessonsOf(seed: number): { id: LessonId; s: GameState }[] {
  let s = newGame({ decks: [LEARN_CONFIG.myDeck, LEARN_CONFIG.aiDeck], names: ['Toi', 'IA'], first: HUMAN, seed });
  const seen = new Set<LessonId>();
  const out: { id: LessonId; s: GameState }[] = [];
  for (let i = 0; i < 3000 && s.winner === null && s.decision; i++) {
    const id = lessonFor(s, HUMAN, seen);
    if (id) {
      assert.ok(!seen.has(id), `${id} : une seule fois`);
      seen.add(id);
      out.push({ id, s });
      assert.ok(lessonStillFits(id, s, HUMAN), `${id} : la leçon convient à la situation qui l'appelle`);
    }
    s = act(s, heuristicChooser(s, s.decision));
  }
  assert.notEqual(s.winner, null, `partie ${seed} finie`);
  assert.equal(lessonFor(s, HUMAN, new Set()), null, 'plus de leçon une fois la partie finie');
  return out;
}

test('leçons : la main de départ, puis les DON!!, puis le tour de l’IA ; les bases toujours vues', () => {
  const counts = new Map<LessonId, number>();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const list = lessonsOf(seed);
    const ids = list.map((l) => l.id);
    assert.equal(ids[0], 'welcome', `partie ${seed} : ${ids.join(', ')}`);
    assert.equal(ids[1], 'don');
    assert.equal(list[0].s.decision?.kind, 'mulligan');
    assert.equal(list[1].s.decision?.kind, 'main');
    assert.equal(list[1].s.turn, 1, 'les DON!! dès ton premier tour');
    for (const base of ['oppTurn', 'attack', 'life'] as LessonId[]) assert.ok(ids.includes(base), `partie ${seed} : ${base} manque (${ids.join(', ')})`);
    // le tour de l'IA vient après ton premier tour, l'attaque pas avant ton deuxième tour
    assert.ok(ids.indexOf('oppTurn') > ids.indexOf('don'));
    const attack = list.find((l) => l.id === 'attack')!;
    assert.ok(attack.s.turn >= 3 && attack.s.active === HUMAN);
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // sur 8 parties, l'IA t'attaque et tu peux contrer au moins une fois
  assert.ok((counts.get('counter') ?? 0) > 0, 'leçon du Contre vue');
});

test('leçons : un texte pour chacune, au toucher et à la souris', () => {
  for (const id of LESSON_ORDER) {
    for (const touch of [true, false]) {
      const l = lessonText(id, touch);
      assert.equal(l.id, id);
      assert.ok(l.title.length > 3 && l.text.length > 40, id);
      assert.doesNotMatch(l.text, /undefined/);
    }
  }
  assert.match(lessonText('don', true).text, /Touche/);
  assert.match(lessonText('don', false).text, /Clique/);
});

test('leçons : la partie guidée se joue avec des decks du registre, contre l’IA Débutant, toi en premier', () => {
  assert.deepEqual({ ...LEARN_CONFIG }, { myDeck: 'ST-01', aiDeck: 'AV-EB-MORGAN', first: 'me', level: 1, learn: true });
});

// Comme la bulle (LessonBubble.tsx) : un joueur qui lit chaque leçon pendant `reads` décisions avant « Compris »
function shownOf(seed: number, reads: number): LessonId[] {
  let s = newGame({ decks: [LEARN_CONFIG.myDeck, LEARN_CONFIG.aiDeck], names: ['Toi', 'IA'], first: HUMAN, seed });
  const seen = new Set<LessonId>();
  const shown: LessonId[] = [];
  let current: LessonId | null = null;
  let age = 0;
  for (let i = 0; i < 3000 && s.winner === null && s.decision; i++) {
    const next = nextShown(current, s, HUMAN, seen);
    if (next !== current) { current = next; age = 0; if (next) shown.push(next); }
    if (current && s.decision.player === HUMAN && ++age > reads) current = null;  // « Compris »
    s = act(s, heuristicChooser(s, s.decision));
  }
  return shown;
}

test('leçons : une leçon pas encore lue n’est remplacée que par une situation urgente', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const reads of [0, 2, 5]) {
      const shown = shownOf(seed, reads);
      assert.equal(new Set(shown).size, shown.length, 'chaque leçon une fois');
      assert.deepEqual(shown.slice(0, 2), ['welcome', 'don']);
      assert.ok(shown.includes('attack'), `partie ${seed}, ${reads} lectures : ${shown.join(', ')}`);
    }
  }
  assert.equal(lessonPreempts('counter'), true);
  assert.equal(lessonPreempts('giveDon'), false);
});

test('partie guidée : l’IA ne contre que pour sauver sa dernière Vie, et la partie se gagne le plus souvent', () => {
  let wins = 0;
  let counters = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    let s = newGame({ decks: [LEARN_CONFIG.myDeck, LEARN_CONFIG.aiDeck], names: ['Toi', 'IA'], first: HUMAN, seed });
    for (let i = 0; i < 4000 && s.winner === null && s.decision; i++) {
      const d = s.decision;
      let c = heuristicChooser(s, d);
      if (d.player !== HUMAN) {
        c = gentleChoice(s, c);
        if (d.kind === 'counter' && c !== 'pass') {
          counters++;
          assert.equal(s.players[d.player].life.length, 0, 'contre seulement sans Vie');
        }
      }
      s = act(s, c);
    }
    if (s.winner === HUMAN) wins++;
  }
  assert.ok(wins / N >= 0.85, `${wins} victoires sur ${N}`);
  assert.ok(counters > 0, 'l’IA contre encore au moment décisif');
});
