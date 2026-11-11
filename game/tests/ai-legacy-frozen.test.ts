// Liste figée des decks d'avant (tâche 5.1) : ajouter un deck au registre ne retire pas l'IA générique à ses cartes.
// Fichier à part : le registre est modifié AVANT le premier appel à legacyCard (l'ensemble est calculé une fois).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generic, LEGACY_DECK_IDS, legacyCard, recipeOf } from '../ai/recipeValue.ts';
import { DECKS } from '../engine/decks.ts';

const NEW = 'EB01-049';   // carte avec une recette vérifiée, dans aucun des 23 decks d'avant

test('les 23 decks d’avant sont dans le registre, avant tous les autres', () => {
  assert.equal(LEGACY_DECK_IDS.length, 23);
  assert.deepEqual(Object.keys(DECKS).slice(0, 23), [...LEGACY_DECK_IDS]);
});

test('une carte d’un deck ajouté au registre garde l’IA générique', () => {
  const id = 'TEST-5.1';
  DECKS[id] = { id, name: 'Deck de test', series: 'TEST', leader: 'ST01-001', cards: { [NEW]: 4 } };
  try {
    assert.equal(legacyCard(NEW), false);
    assert.ok(generic(NEW));
    assert.ok(recipeOf(NEW), 'sa recette est lue');
    assert.ok(legacyCard('ST01-001'), 'une carte d’un deck d’avant le reste');
  } finally {
    delete DECKS[id];
  }
});

test('les fichiers d’ajout de l’étape 5 sont branchés à la fin du registre', async () => {
  const { STARTERS_A } = await import('../engine/starters-a.ts');
  const { STARTERS_B } = await import('../engine/starters-b.ts');
  const { ALABASTA_DECKS } = await import('../adventure/decks-alabasta.ts');
  const added = [...Object.keys(STARTERS_A), ...Object.keys(STARTERS_B), ...Object.keys(ALABASTA_DECKS)];
  assert.deepEqual(Object.keys(DECKS).slice(23), added);
  for (const id of added) assert.equal(DECKS[id], { ...STARTERS_A, ...STARTERS_B, ...ALABASTA_DECKS }[id]);
});

test('arc Alabasta : région Grand Line, boosters OP04, branché dans ARCS après East Blue', async () => {
  const { ALABASTA } = await import('../adventure/alabasta.ts');
  const { ARCS } = await import('../adventure/arcs.ts');
  assert.equal(ALABASTA.id, 'alabasta');
  assert.equal(ALABASTA.region, 'grand-line');
  assert.equal(ALABASTA.boosterSet, 'OP04');
  assert.equal(ALABASTA.requiresArc, 'east-blue');
  assert.deepEqual(ARCS.map((a) => a.id), ['east-blue', 'alabasta'], 'branché par la tâche 5.7');
});
