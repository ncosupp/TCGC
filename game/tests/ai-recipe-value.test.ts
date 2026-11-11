// IA simple et valeur lue dans les recettes (tâche CF.1) : les cartes des decks du registre gardent leurs décisions, les
// autres sont jouées d'après ce que dit leur recette. Numéros et valeurs, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heuristicChooser } from '../ai/heuristic.ts';
import { counterGain, generic, LEGACY_DECK_IDS, legacyCard, recipeOf, timingValue } from '../ai/recipeValue.ts';
import { handCoded } from '../engine/cards/index.ts';
import { DECKS } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { addMod, power } from '../engine/rules.ts';
import type { Decision, GameState, PlayerId } from '../engine/types.ts';
import { charUid, leaderNamed, leaderUid, list, scene } from './eb-scene.ts';
import { attack, choose, setChars, setDon, setHand, setLife } from './helpers.ts';

const L = 'OP10-099';     // Leader de ST-36, sans effet à activer
const OPP = 'ST-36';
const SMALL = 'ST36-004'; // Personnage de ST-36, coût 1, 2000
const BIG = 'ST36-005';   // Personnage de ST-36, coût 6, 7000
const MINE = 'OP10-111';  // Personnage de ST-36, coût 1, 2000 (de mon côté)
const FILL = 'OP10-101';  // Personnage de ST-36 sans effet, pour la main
const ask = (s: GameState, d: Partial<Decision>): string =>
  heuristicChooser(s, { player: 0 as PlayerId, kind: 'effect', prompt: '', options: [], ...d } as Decision);

test('les cartes des 23 decks d’avant gardent les décisions d’avant (pas de recette lue, pas de réponse générique)', () => {
  for (const d of LEGACY_DECK_IDS.map((id) => DECKS[id])) {
    for (const num of [d.leader, ...Object.keys(d.cards)]) {
      assert.ok(legacyCard(num), num);
      assert.equal(generic(num), false, num);
      assert.equal(recipeOf(num), undefined, num);
    }
  }
  assert.equal(recipeOf('OP04-079'), undefined, 'codée à la main : pas de recette');
  assert.ok(handCoded('OP04-079'));
  assert.ok(recipeOf('EB01-049'), 'recette vérifiée');
});

test('valeur d’un [Jouée] « KO coût 2 ou moins » : la cible qui existe, rien sans cible', () => {
  const me = list(L, ['EB01-049'], OPP);
  const none = scene([me, OPP], (g) => { setChars(g, 1, []); });
  assert.equal(timingValue(none, 0, 'EB01-049', 'onPlay'), 0);
  const one = scene([me, OPP], (g) => { setChars(g, 1, [{ num: SMALL }]); });
  assert.ok(timingValue(one, 0, 'EB01-049', 'onPlay')! > 2, 'un Personnage de coût 2 à mettre KO');
});

test('[Déclenchement] d’une recette : activé s’il retire une carte, gardé en main s’il ne fait rien', () => {
  const me = list(L, ['OP07-096'], OPP);
  const trigger = (s: GameState) => ask(s, { tag: 'trigger', options: [{ id: 'trigger', label: '', num: 'OP07-096' }, { id: 'hand', label: '' }] });
  assert.equal(trigger(scene([me, OPP], (g) => { setChars(g, 1, []); })), 'hand');
  assert.equal(trigger(scene([me, OPP], (g) => { setChars(g, 1, [{ num: SMALL }]); })), 'trigger');
});

test('Orlumbus (OP04-079) : activé seulement si une carte de la main met alors KO un Personnage adverse', () => {
  const me = list(L, ['OP04-079', 'ST08-015'], OPP);
  const setup = (withKo: boolean) => scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP04-079' }]);
    setChars(g, 1, [{ num: BIG }]);   // coût 6 (−4 : 2)
    setHand(g, 0, withKo ? ['ST08-015'] : []);
    setDon(g, 0, 3);
  });
  const main = (s: GameState) => heuristicChooser(s, s.decision!);
  assert.ok(!main(setup(false)).startsWith('act:'), 'sans carte qui en profite : jamais (il mettrait KO un de ses Personnages pour rien)');
  assert.ok(main(setup(true)).startsWith('act:'), 'avec « KO coût 2 ou moins » en main : −4, puis KO');
});

test('Shanks (P-051) : défausse juste ce qu’il faut pour passer', () => {
  const me = list(L, ['P-051'], OPP);
  const run = (gap: number) => {
    let s = scene([me, OPP], (g) => {
      setChars(g, 0, [{ num: 'P-051' }]);
      setHand(g, 0, [FILL, FILL, FILL]);
      addMod(g, { uid: g.players[1].leader.uid, stat: 'power', amount: 9000 - 5000 + gap, until: 'turn', source: 'test' });
    });
    s = attack(s, charUid(s, 0, 'P-051'), leaderUid(s, 1));
    assert.equal(s.decision?.tag, 'mayCount');
    return heuristicChooser(s, s.decision!);
  };
  assert.equal(run(-1000), 'n:0', 'il passe déjà');
  assert.equal(run(1000), 'n:1', '+1000 manquants (l’égalité suffit à l’attaquant) : 1 carte');
  assert.equal(run(2000), 'n:2');
  assert.equal(run(5000), 'n:0', 'trop cher contre le Leader');
});

test('Le monde continue (P-059) : utilisé avec un Leader [Uta], autant de Personnages qu’il faut', () => {
  const uta = leaderNamed('Uta');
  const me = list(uta, ['P-059'], OPP);
  let s = scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: MINE }, { num: MINE }, { num: MINE }]);
    setHand(g, 0, ['P-059']);
    setDon(g, 0, 0, 0);
    g.players[0].donActive = 2;
    setLife(g, 0, [FILL]);
    addMod(g, { uid: g.players[1].leader.uid, stat: 'power', amount: 3000, until: 'turn', source: 'test' });
  }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker') s = choose(s, 'noblock');
  assert.equal(s.decision?.kind, 'counter');
  const pick = heuristicChooser(s, s.decision!);
  assert.ok(pick.startsWith('cevent:'), `Contre joué (${pick})`);
  s = act(s, pick);
  assert.equal(s.decision?.tag, 'mayCount');
  const atk = power(s, leaderUid(s, 1));
  const need = Math.ceil((atk - power(s, leaderUid(s, 0)) + 1000) / 2000);
  assert.ok(need >= 1 && need <= 3);
  assert.equal(heuristicChooser(s, s.decision!), `n:${need}`);
});

test('Kingdom Come (EB01-059) : pas au prix de 3 Vies pour un petit Personnage ; avec 1 Vie, oui', () => {
  const me = list(L, ['EB01-059'], OPP);
  const setup = (life: number) => scene([me, OPP], (g) => {
    setChars(g, 1, [{ num: SMALL }]);
    setHand(g, 0, ['EB01-059']);
    setDon(g, 0, 6);
    setLife(g, 0, ['OP10-109', 'OP12-113', 'P-085', 'OP10-114'].slice(0, life));
  });
  assert.ok(!heuristicChooser(setup(4), setup(4).decision!).startsWith('event:'));
  assert.ok(heuristicChooser(setup(1), setup(1).decision!).startsWith('event:'));
});

test('Bon Clay (EB01-061) : copie la puissance du Personnage adverse le plus fort, et seulement s’il est plus fort', () => {
  const s = scene([list(L, ['EB01-061'], OPP), OPP], (g) => {
    setChars(g, 0, [{ num: 'EB01-061' }]);
    setChars(g, 1, [{ num: SMALL }, { num: BIG }]);
  });
  const self = charUid(s, 0, 'EB01-061');
  const weak = charUid(s, 1, SMALL);
  const strong = charUid(s, 1, BIG);
  const options = [{ id: `card:${weak}`, label: '', uid: weak }, { id: `card:${strong}`, label: '', uid: strong }, { id: 'none', label: '' }];
  assert.equal(ask(s, { tag: 'oppLock', source: self, options }), `card:${strong}`, 'le plus fort (7000), pas le plus précieux');
  addMod(s, { uid: self, stat: 'basePower', amount: 8000, until: 'turn', source: 'test' });
  assert.equal(ask(s, { tag: 'oppLock', source: self, options }), 'none', 'tous plus faibles que lui : rien');
});

test('« Votre adversaire renvoie N DON!! » : une épuisée d’abord ; hors de son tour, une donnée avant une redressée', () => {
  const s = scene([list(L, ['OP02-085'], OPP), OPP], () => {});
  const src = s.players[1].leader.uid;   // la question vient d'une carte adverse ; source : une carte du terrain
  const options = [{ id: 'rested', label: '' }, { id: `card:${leaderUid(s, 0)}`, label: '', uid: leaderUid(s, 0) }, { id: 'active', label: '' }];
  // source à recette (OP02-085, adverse) : on la pose dans la main adverse pour que la question la retrouve
  s.players[1].hand.push({ uid: 9999, num: 'OP02-085' });
  void src;
  assert.equal(ask(s, { tag: 'oppPayDon', source: 9999, options }), 'rested');
  assert.equal(ask({ ...s, active: 1 }, { tag: 'oppPayDon', source: 9999, options: options.slice(1) }), `card:${leaderUid(s, 0)}`);
});

test('[Contre] d’une recette : puissance lue dans la recette (condition comprise)', () => {
  const s = scene([list(L, ['EB03-011'], OPP), OPP], () => {});
  // EB03-011 : +4000 seulement avec un Leader [Nefeltari Vivi]
  assert.equal(counterGain(s, 0, 'EB03-011', leaderUid(s, 0)), 0);
  const vivi = scene([list(leaderNamed('Nefeltari Vivi'), ['EB03-011'], OPP), OPP], () => {});
  assert.equal(counterGain(vivi, 0, 'EB03-011', leaderUid(vivi, 0)), 4000);
});

test('Mr.2 (ST08-013) : met KO le Personnage adverse du combat (et lui-même) seulement si l’échange est bon', () => {
  const run = (foe: string, boost: number) => {
    let s = scene([list(L, ['ST08-013'], OPP), OPP], (g) => {
      setChars(g, 0, [{ num: 'ST08-013', extra: { don: 1 } }]);
      setChars(g, 1, [{ num: foe, extra: { rested: true } }]);
      addMod(g, { uid: g.players[1].chars[0].uid, stat: 'power', amount: boost, until: 'turn', source: 'test' });
    });
    s = attack(s, charUid(s, 0, 'ST08-013'), charUid(s, 1, foe));
    while (s.decision && s.decision.player === 1) s = act(s, heuristicChooser(s, s.decision));
    assert.equal(s.decision?.tag, 'may', s.decision?.prompt ?? '');
    return heuristicChooser(s, s.decision!);
  };
  assert.equal(run(BIG, 1000), 'yes', 'un coût 6 de 8000 contre lui');
  assert.equal(run(SMALL, 6000), 'no', 'un coût 1 renforcé pour le tour : pas contre lui');
});

test('Troupe Super Canard (OP04-009) : −5000 à son Leader seulement s’il passe encore contre le Leader adverse', () => {
  const run = (boost: number) => {
    const s = scene([list(L, ['OP04-009'], OPP), OPP], (g) => {
      setChars(g, 0, [{ num: 'OP04-009' }]);
      addMod(g, { uid: g.players[0].leader.uid, stat: 'power', amount: boost, until: 'turn', source: 'test' });
    });
    return ask(s, { tag: 'may', source: charUid(s, 0, 'OP04-009'), options: [{ id: 'yes', label: '' }, { id: 'no', label: '' }] });
  };
  assert.equal(run(0), 'no', 'le Leader ne passerait plus');
  assert.equal(run(6000), 'yes', 'encore assez fort avec −5000');
});
