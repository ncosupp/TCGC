// Portée de « Si C, A. Puis, B » (chef de projet, intégration avant S12, n° 1983) : la condition couvre B (règles complètes
// 4-10-1 et 4-10-2, Q&A d'EB03-017, OP06-116, OP11-066, OP13-102...). Traducteur, recettes du dépôt, et un échantillon de
// cartes, condition vraie et fausse. Numéros et valeurs ; les phrases sont construites ici.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocking, compareTexts } from '../engine/recipes/compare.ts';
import { FAMILIES, parseCard } from '../engine/recipes/parse/index.ts';
import { coverRecipe, hasUncoveredThen } from '../engine/recipes/scope.ts';
import { RECIPE_SETS } from '../engine/recipes/sets/index.ts';
import type { Recipe } from '../engine/recipes/types.ts';
import { act } from '../engine/engine.ts';
import type { GameState } from '../engine/types.ts';
import { charUid, leaderNamed, leaderTyped, list, scene } from './eb-scene.ts';
import { choose, coherent, play, setChars, setDon, setHand, setLife } from './helpers.ts';

const OPP = 'ST-36';
const steps = (text: string) => {
  const r = parseCard({ num: 'ZZ99-001', effectEn: text, triggerEn: null }, FAMILIES);
  assert.ok(r.ok, text);
  return r.recipe.abilities[0].steps;
};
const life = { kind: 'life', side: 'own', cmp: 'le', n: 2 } as const;
const draw1 = { action: { kind: 'draw', n: 1 } } as const;
const trash1 = { action: { kind: 'discard', n: 1 } } as const;
const resolve = (s: GameState) => {
  for (let i = 0; i < 30 && s.decision?.inEffect; i++) s = act(s, s.decision.options[0].id);
  return s;
};

test('traducteur : la condition couvre tout ce qui suit « Then », sous toutes les formes', () => {
  const COND = 'If you have 2 or less Life cards';
  // deux « Then » de suite ; un « and » après « Then »
  assert.deepEqual(steps(`[On Play] ${COND}, draw 1 card. Then, trash 1 card from your hand. Then, draw 1 card.`),
    [{ cond: life, group: [draw1, { ...trash1, link: 'then' }, { ...draw1, link: 'then' }] }]);
  assert.deepEqual(steps(`[On Play] ${COND}, draw 1 card. Then, trash 1 card from your hand and draw 1 card.`),
    [{ cond: life, group: [draw1, { ...trash1, link: 'then' }, { ...draw1, link: 'and' }] }]);
  // « If C, A and B. Then, D » : tout dans le même groupe
  assert.deepEqual(steps(`[On Play] ${COND}, draw 1 card and trash 1 card from your hand. Then, draw 1 card.`),
    [{ cond: life, group: [draw1, { ...trash1, link: 'and' }, { ...draw1, link: 'then' }] }]);
  // « A if C. Then, B » (Q&A d'OP05-047)
  assert.deepEqual(steps('[On Play] Draw 1 card if you have 2 or less Life cards. Then, trash 1 card from your hand.'),
    [{ cond: life, group: [draw1, { ...trash1, link: 'then' }] }]);
  // « A. Then, if C, B. Then, D » : A hors de la condition, D dedans
  assert.deepEqual(steps('[On Play] Draw 1 card. Then, if you have 2 or less Life cards, trash 1 card from your hand. Then, draw 1 card.'),
    [draw1, { link: 'then', cond: life, group: [trash1, { ...draw1, link: 'then' }] }]);
  // « If C, you may A. Then, B »
  assert.deepEqual(steps(`[On Play] ${COND}, you may draw 1 card. Then, trash 1 card from your hand.`),
    [{ cond: life, group: [{ may: [draw1] }, { ...trash1, link: 'then' }] }]);
  // dans une option de « Choose one: » (forme de la Q&A d'OP06-116)
  const chosen = steps(`[Main] Choose one:\n• Draw 1 card.\n• ${COND}, draw 1 card. Then, trash 1 card from your hand.`);
  assert.ok('chooseOne' in chosen[0]);
  assert.deepEqual(chosen[0].chooseOne[1], [{ cond: life, group: [draw1, { ...trash1, link: 'then' }] }]);
  // « Then » seul : rien ne change (4-10-2 : un « Then » qui ne fait rien n'empêche pas la suite)
  assert.deepEqual(steps('[On Play] Draw 1 card. Then, trash 1 card from your hand.'), [draw1, { ...trash1, link: 'then' }]);
  // « If C, you may A. If you do, B » : le lien dépend déjà de l'étape conditionnelle, la recette ne change pas
  assert.deepEqual(steps(`[On Play] ${COND}, you may draw 1 card. If you do, trash 1 card from your hand.`),
    [{ may: [draw1], cond: life }, { ...trash1, link: 'ifYouDo' }]);
});

test('recettes du dépôt : aucune condition ne laisse dehors ce qui la suit ; compare le signale pour une recette écrite à la main', () => {
  const flat = RECIPE_SETS.flatMap((set) => Object.entries(set.entries).filter(([, e]) => e.recipe && hasUncoveredThen(e.recipe)).map(([n]) => n));
  assert.deepEqual(flat, []);
  const recipe: Recipe = { num: 'ZZ99-001', abilities: [{ timing: 'onPlay', steps: [{ ...draw1, cond: life }, { ...trash1, link: 'then' }] }] };
  const text = '[On Play] If you have 2 or less Life cards, draw 1 card. Then, trash 1 card from your hand.';
  assert.ok(blocking(compareTexts(recipe, { en: text })).some((e) => e.kind === 'lien'));
  assert.equal(blocking(compareTexts(coverRecipe(recipe), { en: text })).length, 0, 'même phrase, recette juste');
  assert.equal(hasUncoveredThen(coverRecipe(recipe)), false);
});

test('EB03-003 (recette, Q&A) : Leader [Uta] : piocher 2 ; autre Leader : rien', () => {
  const run = (lead: string) => {
    const s0 = scene([list(lead, ['EB03-003', 'ST36-004']), OPP], (g) => { setHand(g, 0, ['EB03-003']); setDon(g, 0, 5); });
    const before = s0.players[0].hand.length;
    const s = resolve(play(s0, 'EB03-003'));
    coherent(s);
    return s.players[0].hand.length - before + 1;
  };
  assert.equal(run(leaderNamed('Uta')), 2);
  assert.equal(run(leaderTyped('Navy')), 0);
});

test('OP13-102 (recette, Q&A) : assez peu de Vies : piocher 1 puis épuiser ; plus de Vies que l\'adversaire : ni l\'un ni l\'autre', () => {
  const me = list('OP13-100', ['OP13-102']);
  const setup = (mine: number, theirs: number) => scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP13-102' }]);
    setChars(g, 1, [{ num: 'ST36-004' }]);
    setLife(g, 0, Array<string>(mine).fill('ST36-004'));
    setLife(g, 1, Array<string>(theirs).fill('ST36-004'));
  });
  let s = setup(3, 3);
  const hand = s.players[0].hand.length;
  s = choose(s, `act:${charUid(s, 0, 'OP13-102')}`);
  s = choose(s, (o) => o.id.startsWith('card:'));
  assert.equal(s.players[0].hand.length, hand + 1);
  assert.equal(s.players[1].chars[0].rested, true);
  coherent(s);
  // condition fausse : le coût se paie (Q&A), ni pioche ni épuisement
  s = setup(4, 3);
  const before = s.players[0].hand.length;
  s = resolve(choose(s, `act:${charUid(s, 0, 'OP13-102')}`));
  assert.equal(s.players[0].hand.length, before);
  assert.equal(s.players[1].chars[0].rested, false);
  coherent(s);
});

test('EB04-038 (code à la main) : autant de DON!! ou moins : piocher puis 1 DON!! ; plus de DON!! que l\'adversaire : rien', () => {
  const me = list('OP12-061', ['EB04-038']);
  const run = (mine: number, theirs: number) => {
    const s0 = scene([me, OPP], (g) => { setHand(g, 0, ['EB04-038']); setDon(g, 0, mine); setDon(g, 1, theirs); });
    const deck = s0.players[0].donDeck;
    const hand = s0.players[0].hand.length;
    const s = resolve(play(s0, 'EB04-038'));
    coherent(s);
    return { don: deck - s.players[0].donDeck, drew: s.players[0].hand.length - hand + 1 };
  };
  assert.deepEqual(run(9, 10), { don: 1, drew: 1 });
  assert.deepEqual(run(9, 5), { don: 0, drew: 0 });
});

test('Léo OP10-057 (code à la main, n° 2813 corrigé) : sans le Leader [Usopp], le coût se propose (n° 1000) mais ni défausse ni recherche', () => {
  const run = (lead: string) => {
    const s0 = scene([list(lead, ['OP10-057', 'ST36-004']), OPP], (g) => { setHand(g, 0, ['OP10-057', 'ST36-004']); setDon(g, 0, 5); });
    const s = play(s0, 'OP10-057');
    return { s, before: s0.players[0].hand.length, asked: s.decision?.inEffect ?? false, tag: s.decision?.tag };
  };
  const without = run(leaderTyped('Navy'));
  assert.equal(without.tag, 'mayIdle');
  const paid = choose(without.s, 'yes');
  const paid2 = paid.decision?.tag === 'restCost' ? choose(paid, (o) => o.id.startsWith('card:')) : paid;
  assert.equal(paid2.decision?.kind, 'main', 'coût payé, rien ne suit');
  assert.equal(without.s.players[0].hand.length, without.before - 1);
  assert.equal(without.s.players[0].trash.length, 0);
  assert.equal(run(leaderNamed('Usopp')).asked, true);
});
