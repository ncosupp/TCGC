// Liste figée des decks d'avant (tâche 5.1) : ajouter un deck au registre ne retire pas l'IA générique à ses cartes.
// Fichier à part : le registre est modifié AVANT le premier appel à legacyCard (l'ensemble est calculé une fois).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { generic, LEGACY_DECK_IDS, legacyCard, recipeOf } from '../ai/recipeValue.ts';
import { DECKS } from '../engine/decks.ts';

const NEW = 'EB01-049';   // carte avec une recette vérifiée, dans aucun des 23 decks d'avant

test('les 23 decks d’avant sont dans le registre, avant tous les autres', () => {
  assert.equal(LEGACY_DECK_IDS.length, 23);
  assert.deepEqual(Object.keys(DECKS).slice(0, 23), [...LEGACY_DECK_IDS]);
});

// Cartes des 23 decks d'avant, figées par numéro (audit du 14 novembre 2026, P2-7) : figer les identifiants ne
// suffit pas, une carte changée dans l'un de ces decks changerait l'ensemble des cartes qui gardent l'IA d'avant
// (legacyCard) et l'empreinte des parties. LEGACY_LISTS_HASH couvre aussi les quantités (Leader et cartes, deck par deck).
const LEGACY_CARDS = [
  'EB02-011', 'EB02-030', 'EB03-032', 'EB03-035', 'EB04-026', 'EB04-028', 'EB04-031', 'EB04-032', 'EB04-040',
  'EB04-058', 'OP01-016', 'OP01-055', 'OP01-064', 'OP02-052', 'OP02-058', 'OP02-060', 'OP02-093', 'OP02-102',
  'OP02-107', 'OP02-117', 'OP03-014', 'OP03-021', 'OP03-022', 'OP03-023', 'OP03-024', 'OP03-025', 'OP03-026',
  'OP03-027', 'OP03-028', 'OP03-029', 'OP03-030', 'OP03-031', 'OP03-032', 'OP03-033', 'OP03-034', 'OP03-035',
  'OP03-036', 'OP03-037', 'OP03-038', 'OP03-039', 'OP03-089', 'OP03-091', 'OP03-111', 'OP03-118', 'OP04-016',
  'OP04-023', 'OP05-073', 'OP05-077', 'OP06-023', 'OP06-033', 'OP06-038', 'OP07-022', 'OP07-027', 'OP07-064',
  'OP07-076', 'OP07-077', 'OP08-036', 'OP08-051', 'OP08-074', 'OP09-053', 'OP09-054', 'OP09-058', 'OP09-059',
  'OP09-062', 'OP09-077', 'OP09-078', 'OP10-036', 'OP10-067', 'OP10-099', 'OP10-101', 'OP10-103', 'OP10-109',
  'OP10-111', 'OP10-114', 'OP11-001', 'OP11-003', 'OP11-009', 'OP11-012', 'OP11-062', 'OP11-065', 'OP11-066',
  'OP11-068', 'OP11-071', 'OP11-079', 'OP11-081', 'OP11-094', 'OP11-096', 'OP11-099', 'OP12-020', 'OP12-023',
  'OP12-026', 'OP12-027', 'OP12-028', 'OP12-031', 'OP12-034', 'OP12-039', 'OP12-040', 'OP12-042', 'OP12-043',
  'OP12-045', 'OP12-046', 'OP12-047', 'OP12-049', 'OP12-050', 'OP12-052', 'OP12-055', 'OP12-057', 'OP12-071',
  'OP12-090', 'OP12-093', 'OP12-098', 'OP12-113', 'OP13-004', 'OP13-005', 'OP13-007', 'OP13-008', 'OP13-017',
  'OP13-019', 'OP13-021', 'OP13-029', 'OP13-031', 'OP13-076', 'OP13-081', 'OP13-116', 'OP14-015', 'OP14-020',
  'OP14-025', 'OP14-038', 'OP14-039', 'OP15-001', 'OP15-008', 'OP15-009', 'OP15-011', 'OP15-026', 'OP15-028',
  'OP15-036', 'OP15-037', 'OP15-038', 'OP15-058', 'OP15-061', 'OP15-066', 'OP15-067', 'OP15-071', 'OP15-074',
  'OP15-075', 'OP15-076', 'OP15-077', 'OP15-078', 'OP15-088', 'OP15-118', 'OP16-023', 'OP16-041', 'OP16-048',
  'OP16-119', 'OP17-022', 'OP17-031', 'OP17-039', 'OP17-040', 'OP17-041', 'OP17-042', 'OP17-044', 'OP17-045',
  'OP17-046', 'OP17-048', 'OP17-049', 'OP17-054', 'OP17-055', 'OP17-056', 'OP17-058', 'OP17-061', 'OP17-062',
  'OP17-063', 'OP17-065', 'OP17-068', 'OP17-073', 'OP17-074', 'OP17-080', 'OP17-082', 'OP17-083', 'OP17-084',
  'OP17-086', 'OP17-087', 'OP17-089', 'OP17-093', 'OP17-095', 'OP17-102', 'OP17-106', 'OP17-107', 'OP17-109',
  'OP17-110', 'OP17-112', 'OP17-113', 'OP17-114', 'OP17-118', 'OP17-119', 'P-085', 'P-088', 'P-090', 'P-101', 'P-105',
  'ST01-001', 'ST01-002', 'ST01-003', 'ST01-004', 'ST01-005', 'ST01-006', 'ST01-007', 'ST01-008', 'ST01-009',
  'ST01-010', 'ST01-011', 'ST01-012', 'ST01-013', 'ST01-014', 'ST01-015', 'ST01-016', 'ST01-017', 'ST03-011',
  'ST06-002', 'ST06-003', 'ST06-004', 'ST06-006', 'ST06-007', 'ST06-008', 'ST06-009', 'ST06-010', 'ST06-011',
  'ST06-013', 'ST06-016', 'ST10-010', 'ST21-001', 'ST21-002', 'ST21-003', 'ST21-004', 'ST21-005', 'ST21-006',
  'ST21-007', 'ST21-008', 'ST21-009', 'ST21-010', 'ST21-011', 'ST21-012', 'ST21-013', 'ST21-014', 'ST21-015',
  'ST21-016', 'ST21-017', 'ST22-001', 'ST22-002', 'ST22-003', 'ST22-004', 'ST22-005', 'ST22-006', 'ST22-007',
  'ST22-008', 'ST22-009', 'ST22-010', 'ST22-011', 'ST22-012', 'ST22-013', 'ST22-014', 'ST22-015', 'ST22-016',
  'ST22-017', 'ST23-004', 'ST24-005', 'ST25-002', 'ST25-004', 'ST30-001', 'ST30-002', 'ST30-003', 'ST30-004',
  'ST30-005', 'ST30-006', 'ST30-007', 'ST30-008', 'ST30-009', 'ST30-010', 'ST30-011', 'ST30-012', 'ST30-013',
  'ST30-014', 'ST30-015', 'ST30-016', 'ST30-017', 'ST31-001', 'ST31-002', 'ST31-003', 'ST31-004', 'ST31-005',
  'ST32-001', 'ST32-002', 'ST32-003', 'ST32-004', 'ST32-005', 'ST33-001', 'ST33-002', 'ST33-003', 'ST33-004',
  'ST33-005', 'ST34-001', 'ST34-002', 'ST34-003', 'ST34-004', 'ST34-005', 'ST35-001', 'ST35-002', 'ST35-003',
  'ST35-004', 'ST35-005', 'ST36-001', 'ST36-002', 'ST36-003', 'ST36-004', 'ST36-005',
];
const LEGACY_LISTS_HASH = 'e2c2bae36605c4f2';

test('les cartes des 23 decks d’avant sont figées (numéros et quantités)', () => {
  const nums = [...new Set(LEGACY_DECK_IDS.flatMap((id) => [DECKS[id].leader, ...Object.keys(DECKS[id].cards)]))]
    .sort();
  assert.deepEqual(nums.filter((n) => !LEGACY_CARDS.includes(n)), [], 'cartes ajoutées à un deck d’avant');
  assert.deepEqual(LEGACY_CARDS.filter((n) => !nums.includes(n)), [], 'cartes retirées d’un deck d’avant');
  for (const n of LEGACY_CARDS) assert.ok(legacyCard(n), `${n} : IA d'avant`);
  const text = JSON.stringify(LEGACY_DECK_IDS.map((id) => [id, DECKS[id].leader, Object.entries(DECKS[id].cards).sort()]));
  assert.equal(createHash('sha256').update(text).digest('hex').slice(0, 16), LEGACY_LISTS_HASH, 'liste d’un deck d’avant modifiée');
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
