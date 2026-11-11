// Decks de démarrage ST-15 à ST-29 (tâche 5.3) : chaque deck du registre STARTERS_B passe les règles de construction
// et n'a que des cartes jouables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../engine/cards/index.ts';
import { STARTERS_B } from '../engine/starters-b.ts';
import { DECKS, deckSize, type DeckList } from '../engine/decks.ts';
import { deckErrors } from '../engine/deckRules.ts';
import { cardStatus } from '../engine/cards/index.ts';

test('STARTERS_B : decks valides, 50 cartes, tous jouables, dans le registre', () => {
  for (const [id, deck] of Object.entries<DeckList>(STARTERS_B)) {
    assert.equal(deck.id, id);
    assert.equal(deck.series, id);
    assert.equal(DECKS[id], deck, `${id} absent de DECKS`);
    assert.equal(deckSize(deck), 50, `${id} : taille`);
    assert.deepEqual(deckErrors(deck.leader, deck.cards), [], id);
    for (const num of [deck.leader, ...Object.keys(deck.cards)]) {
      assert.notEqual(cardStatus(num), 'todo', `${id} : ${num} non jouable`);
    }
  }
});
