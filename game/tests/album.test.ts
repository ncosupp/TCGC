// Album des extensions (game/ui/adventure/album.ts, étape J) : cartes trouvées / total par extension et par rareté, une
// parallèle compte pour sa carte, versions spéciales à part, « il te manque », meilleure extension à compléter
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOSTER_SETS } from '../boosters/sets/index.ts';
import { albumOf, bestToComplete, missingText } from '../ui/adventure/album.ts';

const op03 = BOOSTER_SETS.OP03;
const total = Object.values(op03.cards).flat().length;

test('album : une Cale vide, tout manque', () => {
  const a = albumOf('OP03', {})!;
  assert.equal(a.base.total, total);
  assert.equal(a.base.have, 0);
  assert.equal(a.missing.total, total);
  assert.equal(a.missing.sr, op03.cards.SR.length);
  assert.equal(a.slots.length, total);
  assert.ok(a.specials.total > 0);
  assert.match(missingText(a), new RegExp(`^Il te manque ${total} cartes, dont ${op03.cards.SR.length} SR et ${op03.cards.SEC.length} SEC$`));
  assert.equal(albumOf('XX99', {}), null);
});

test('album : une parallèle compte pour sa carte et pour les versions spéciales', () => {
  const v = op03.hits.flatMap((h) => h.versions)[0];
  const common = op03.cards.C[0];
  const a = albumOf('OP03', { [`${v.number}|${v.variant}`]: 1, [common]: 3 })!;
  assert.equal(a.base.have, v.number === common ? 1 : 2);
  assert.equal(a.specials.have, 1);
  assert.equal(a.slots.find((s) => s.number === common)!.owned, 3);
  assert.equal(a.byRarity.C.have, 1);
});

test('album : base complète, et l’extension la moins avancée est le meilleur choix', () => {
  const all = Object.fromEntries(Object.values(op03.cards).flat().map((n) => [n, 1]));
  const full = albumOf('OP03', all)!;
  assert.equal(full.missing.total, 0);
  assert.equal(missingText(full), 'Base complète !');
  const op04 = albumOf('OP04', {})!;
  assert.equal(bestToComplete([full, op04]), 'OP04');
  assert.equal(bestToComplete([full]), null);
});
