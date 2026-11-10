// Intégration de la vague S-4 (chef de projet) : « jusqu'à N » DON!! au choix (règle 1-3-5-1, n° 1994), l'adversaire choisit les
// DON!! qu'il renvoie (Q&A d'OP02-085 et voisines, n° 1993), KO d'un même effet avec une carte qui remplace les KO (n° 1995).
// Numéros et valeurs, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heuristicChooser } from '../ai/heuristic.ts';
import { act } from '../engine/engine.ts';
import { compileRecipe } from '../engine/recipes/compile.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { installBehavior } from '../engine/recipes/bench.ts';
import { donOnField } from '../engine/rules.ts';
import type { GameState } from '../engine/types.ts';
import { charUid, list, scene } from './eb-scene.ts';
import { choose, coherent, donMax, expectTag, play, setChars, setDon, setHand } from './helpers.ts';

const F = 'ST-21';
const OPP = 'ST-36';
const V = 'ST21-005';    // Personnage sans effet, coût 2
const V2 = 'ST21-004';   // Personnage sans effet, coût 1

// ---------- n° 1994 : « jusqu'à N » DON!! ----------

test('Venom Road (OP02-091) : « jusqu’à 1 » DON!! ajoutée : le joueur peut n’en prendre aucune ; l’IA prend le maximum', () => {
  const me = list('OP02-071', ['OP02-091'], F);
  const start = () => scene([me, OPP], (g) => { setHand(g, 0, ['OP02-091']); setDon(g, 0, 5); });
  let s = play(start(), 'OP02-091');
  expectTag(s, 'donUpTo');
  assert.deepEqual(s.decision!.options.map((o) => o.id), ['n:1', 'none']);
  assert.equal(heuristicChooser(s, s.decision!), 'n:1', 'l’IA : le maximum, comme avant');
  const deck = s.players[0].donDeck;
  assert.equal(choose(s, 'none').players[0].donDeck, deck, 'aucune : rien d’ajouté');
  s = choose(s, 'n:1');
  assert.equal(s.players[0].donDeck, deck - 1);
  assert.equal(s.players[0].donActive, 5 - 3 + 1, 'redressée');
  coherent(s);
});

test('Uta (OP13-023) : « jusqu’à 2 » DON!! redressées : 2, 1 ou aucune', () => {
  const me = list('OP13-100', ['OP13-023'], F);
  const start = () => scene([me, OPP], (g) => { setHand(g, 0, ['OP13-023']); setDon(g, 0, 4, 3); });
  const s = play(start(), 'OP13-023');
  expectTag(s, 'donUpTo');
  assert.deepEqual(s.decision!.options.map((o) => o.id), ['n:2', 'n:1', 'none']);
  for (const [answer, ready] of [['n:2', 2], ['n:1', 1], ['none', 0]] as const) {
    assert.equal(choose(s, answer).players[0].donActive, s.players[0].donActive + ready, answer);
  }
});

test('Marshall D. Teach (ST17-005) : « jusqu’à 2 » DON!! épuisées données : la carte, puis combien', () => {
  const me = list('ST17-001', ['ST17-005'], F);
  let s = scene([me, OPP], (g) => { setChars(g, 0, [{ num: 'ST17-005' }, { num: V }]); setDon(g, 0, 2, 3); });
  s = act(s, `act:${charUid(s, 0, 'ST17-005')}`);
  while (s.decision?.inEffect && s.decision.tag !== 'donTarget') s = act(s, s.decision.options.find((o) => o.id === 'yes')?.id ?? s.decision.options[0].id);
  expectTag(s, 'donTarget');
  s = choose(s, `card:${charUid(s, 0, V)}`);
  expectTag(s, 'donUpTo');
  const one = choose(s, 'n:1');
  assert.equal(one.players[0].chars.find((c) => c.num === V)!.don, 1);
  assert.equal(donMax(s).players[0].chars.find((c) => c.num === V)!.don, 2);
});

// ---------- n° 1993 : l'adversaire choisit les DON!! qu'il renvoie ----------

test('OP14-065 (recette) : [En cas de KO] l’adversaire renvoie 1 DON!! : il choisit, une DON!! donnée comprise', () => {
  const recipe = compileRecipe({ num: V2, abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'returnDon', n: 1, side: 'opp' } }] }] });
  assert.ok(recipe.ok);
  const restore = installBehavior(V2, recipe.behavior);
  try {
    const me = list('OP14-060', [V2], F);
    let s = scene([me, OPP], (g) => { setHand(g, 0, [V2]); setDon(g, 0, 3); setDon(g, 1, 2, 1); g.players[1].leader.don = 1; g.players[1].donDeck -= 1; });
    const before = donOnField(s, 1);
    s = play(s, V2);
    expectTag(s, 'oppPayDon');
    assert.equal(s.decision!.player, 1);
    assert.deepEqual(s.decision!.options.map((o) => o.id), ['rested', `card:${s.players[1].leader.uid}`, 'active'], 'pas son tour : épuisée, donnée, puis redressée');
    s = choose(s, `card:${s.players[1].leader.uid}`);
    assert.equal(s.players[1].leader.don, 0, 'la DON!! donnée au Leader est renvoyée');
    assert.equal(s.players[1].donRested, 1);
    assert.equal(donOnField(s, 1), before - 1);
    coherent(s);
  } finally {
    restore();
  }
});

// ---------- n° 1995 : KO d'un même effet, Rosinante OP05-030 placée avant des Personnages épuisés ----------

test('« Mettez KO tous les ... » (recette) : Rosinante redressée placée en premier : son remplacement est proposé et sauve les autres (Q&A de Rosinante)', () => {
  const recipe = compileRecipe({ num: V2, abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 'all', upTo: false, filter: { costMax: 5 }, characters: true } } }] }] });
  assert.ok(recipe.ok);
  const restore = installBehavior(V2, recipe.behavior);
  try {
    const me = list('OP14-060', [V2], F);
    const opp = list('OP05-002', ['OP05-030', V], F);
    const start = () => scene([me, opp], (g: GameState) => {
      setHand(g, 0, [V2]);
      setDon(g, 0, 3);
      setChars(g, 1, [{ num: 'OP05-030' }, { num: V, extra: { rested: true } }, { num: V, extra: { rested: true } }]);
    });
    let s = play(start(), V2);
    assert.equal(s.decision?.player, 1, 'le remplacement est proposé au propriétaire de Rosinante');
    s = choose(s, 'yes');
    while (s.decision?.inEffect && s.decision.player === 1) s = choose(s, 'yes');
    assert.deepEqual(s.players[1].chars.map((c) => c.num), [V, V], 'les deux épuisés restent');
    assert.ok(s.players[1].trash.some((c) => c.num === 'OP05-030'));
    coherent(s);
    // refusé : tous mis KO
    s = play(start(), V2);
    while (s.decision?.inEffect && s.decision.player === 1) s = choose(s, 'no');
    assert.equal(s.players[1].chars.length, 0);
  } finally {
    restore();
  }
});

// ---------- Doutes tranchés par l'utilisateur (lecture 1) ----------

test('Alvida (EB03-021) : le second Personnage (coût de base 3 ou moins) est adverse seulement (n° 1996) ; doutes levés', () => {
  const me = list('EB03-001', ['EB03-021', V, V2], F);
  const start = () => scene([me, OPP], (g) => { setHand(g, 0, ['EB03-021', V2]); setDon(g, 0, 6); setChars(g, 0, [{ num: V }]); setChars(g, 1, [{ num: 'ST36-004' }]); });
  let s = play(start(), 'EB03-021');
  s = choose(s, 'yes');                                   // défausser 1 carte
  if (s.decision?.tag !== 'oppRemove') s = choose(s, (o) => o.id.startsWith('card:'));
  const opp = charUid(s, 1, 'ST36-004');
  const mine = charUid(s, 0, V);
  assert.ok(s.decision!.options.some((o) => o.uid === opp), '1er choix : le Personnage adverse');
  s = choose(s, 'none');
  assert.ok(s.decision!.options.some((o) => o.uid === opp), '2e choix : le Personnage adverse de coût 1');
  assert.ok(!s.decision!.options.some((o) => o.uid === mine), '2e choix : pas le mien (coût 2)');
  s = choose(s, (o) => o.uid === opp);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].chars.length, 2);
  coherent(s);
  // refusé : rien
  s = choose(play(start(), 'EB03-021'), 'no');
  assert.equal(s.players[1].chars.length, 1);
  for (const n of ['EB03-021', 'EB05-061', 'OP15-098', 'OP09-093']) assert.equal(confidence(n), 'coded', n);
});
