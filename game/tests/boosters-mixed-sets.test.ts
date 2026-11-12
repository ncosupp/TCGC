// Boosters de plusieurs extensions en attente en même temps (correctif : « l'écran annonce des OP04 mais ce sont des
// OP03 qui s'ouvrent », et inversement) : coffre de la semaine OP03, récompense d'Alabasta OP04, achats OP03 et OP04.
// Ce que l'écran annonce (bouton de la carte, titre et paquets de l'écran d'ouverture, rangés par useBoosterOpening)
// doit être ce que le serveur tire, paquet par paquet, sur une base temporaire.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ALABASTA } from '../adventure/alabasta.ts';
import { ECONOMY } from '../economy/config.ts';
import type { Purchase } from '../economy/types.ts';
import type { AdventureState, OpenedBooster } from '../ui/adventure/api.ts';
import { countBySet, groupBySet, setsText } from '../ui/economy/boosterSets.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-boosters-melanges-'));
process.env.TCGC_DB = join(dir, 'essai.db');

const paths = { db: '../../server/db.js', economy: '../../server/game-economy.js', adventure: '../../server/game-adventure.js' };
const { db } = await import(paths.db);
const eco = await import(paths.economy);
const adv = await import(paths.adventure);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const A = 1;
db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(A, 'joueur1', 'joueur1@example.invalid', 'scrypt$essai', '2026-10-01T10:00:00Z');

const T = (iso: string) => new Date(iso);
const prefix = (number: string) => number.slice(0, number.indexOf('-'));

// Boosters donnés comme le font le coffre (game-economy.js, addBoosters) et un chapitre (game-adventure.js, grant)
function give(set: string, source: string, at: string, n: number) {
  const insert = db.prepare('INSERT INTO game_boosters (id, user_id, set_code, source, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < n; i++) insert.run(`${source.replace(/\W+/g, '-')}-${i}`, A, set, source, at);
}

test('boosters OP03 et OP04 en attente ensemble : le set annoncé est le set tiré, paquet par paquet', () => {
  const chapter = ALABASTA.chapters[0];
  const reward = chapter.rewards.find((r) => r.kind === 'booster');
  assert.ok(reward && reward.kind === 'booster' && reward.set === 'OP04', 'Alabasta rapporte des boosters OP04');
  assert.equal(ECONOMY.weeklyChest.set, 'OP03');

  // coffre de la semaine (OP03, le plus ancien), puis récompense d'Alabasta (OP04), puis la boutique (OP04 et OP03)
  give(ECONOMY.weeklyChest.set, 'coffre', '2026-11-09T10:00:00.000Z', ECONOMY.weeklyChest.boosters);
  give(reward.set, `chapitre ${chapter.id}`, '2026-11-10T10:00:00.000Z', reward.count);
  eco.credit(A, 'essai', 'depart', 1000, { label: 'Essai' }, T('2026-11-10T11:00:00.000Z'));
  const op04: Purchase = eco.buy(A, 'OP04', 'booster', 'achat-essai-op04', T('2026-11-11T10:00:00.000Z'));
  const op03: Purchase = eco.buy(A, 'OP03', 'booster', 'achat-essai-op03', T('2026-11-11T10:05:00.000Z'));
  assert.deepEqual([op04.boosters.map((b) => b.set), op03.boosters.map((b) => b.set)], [['OP04'], ['OP03']]);

  // ce que la carte et la Cale reçoivent : du plus ancien au plus récent, les deux extensions mêlées
  const state: AdventureState = adv.adventureState(A);
  const pending = state.boosters;
  assert.deepEqual(pending.map((b) => b.set), ['OP03', 'OP03', 'OP04', 'OP04', 'OP04', 'OP03']);

  // le bouton de la carte annonce chaque extension avec son nombre (avant : l'extension du premier booster seule)
  assert.deepEqual(countBySet(pending), [{ set: 'OP03', count: 3 }, { set: 'OP04', count: 3 }]);
  assert.equal(setsText(pending), '3 OP03 et 3 OP04');

  // l'écran d'ouverture range les boosters par extension et montre chaque paquet avec la sienne ; le serveur tire
  // chaque paquet au moment où on l'ouvre
  const slots = groupBySet(pending);
  assert.deepEqual(slots.map((b) => b.set), ['OP03', 'OP03', 'OP03', 'OP04', 'OP04', 'OP04']);
  assert.deepEqual(new Set(slots.map((b) => b.id)), new Set(pending.map((b) => b.id)), 'aucun booster perdu ni ajouté');
  const drawn: string[] = [];
  for (const slot of slots) {
    const { content }: OpenedBooster = adv.openWonBooster(A, slot.id);
    assert.equal(content.set, slot.set, `booster ${slot.id} (${slot.source}) : annoncé ${slot.set}, tiré ${content.set}`);
    // les cartes de base viennent de l'extension annoncée (les cartes SP sont d'autres extensions)
    for (const c of content.cards.filter((x) => x.variant !== 'sp')) assert.equal(prefix(c.number), slot.set, `${c.number} dans un booster ${slot.set}`);
    drawn.push(content.set);
  }
  assert.deepEqual(countBySet(drawn.map((set) => ({ set }))), countBySet(pending));
  assert.deepEqual(adv.adventureState(A).boosters, [], 'tous ouverts');
});

test('rangement par extension : ordre stable, rien de perdu', () => {
  const list = [{ id: 'a', set: 'OP04' }, { id: 'b', set: 'OP03' }, { id: 'c', set: 'OP04' }, { id: 'd', set: 'OP05' }, { id: 'e', set: 'OP03' }];
  assert.deepEqual(groupBySet(list).map((b) => b.id), ['a', 'c', 'b', 'e', 'd']);
  assert.equal(setsText(list), '2 OP04, 2 OP03 et 1 OP05');
  assert.equal(setsText([{ set: 'OP04' }]), '1 OP04');
  assert.deepEqual(groupBySet([]), []);
});
