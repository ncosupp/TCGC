// Decks de démarrage ST-02 à ST-09 (tâche 5.2) : chacun respecte les règles de construction, ses cartes sont jouables,
// et une partie IA contre IA va au bout.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../engine/cards/index.ts';
import { heuristicChooser } from '../ai/heuristic.ts';
import { playableErrors } from '../engine/deckRules.ts';
import { DECKS, deckSize } from '../engine/decks.ts';
import { act, newGame } from '../engine/engine.ts';
import { STARTERS_A } from '../engine/starters-a.ts';

test('chaque deck de starters-a a 50 cartes, respecte deckRules et n’a que des cartes jouables', () => {
  assert.ok(Object.keys(STARTERS_A).length >= 8);
  for (const [id, d] of Object.entries(STARTERS_A)) {
    assert.equal(d.id, id);
    assert.equal(d.series, id);
    assert.equal(DECKS[id], d);
    assert.equal(deckSize(d), 50, id);
    assert.deepEqual(playableErrors(d.leader, d.cards), [], id);
  }
});

test('une partie IA contre IA (contre ST-01) va au bout pour chaque deck', () => {
  for (const id of Object.keys(STARTERS_A)) {
    let s = newGame({ decks: [id, 'ST-01'], names: ['A', 'B'], seed: 5, first: 0 });
    for (let i = 0; i < 4000 && s.decision && s.winner === null; i++) s = act(s, heuristicChooser(s, s.decision));
    assert.notEqual(s.winner, null, id);
  }
});
