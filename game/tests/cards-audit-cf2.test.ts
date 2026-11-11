// Audit des cartes codées avant l'étape C (tâche CF.2) : l'outil (scripts/game/cards-audit.ts), les erreurs du traducteur et
// du compilateur qu'il a trouvées, et les corrections du code ancien (cartes hors des decks du registre). Numéros et valeurs
// seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import { act } from '../engine/engine.ts';
import { def, hasKeyword, isNegated, power } from '../engine/rules.ts';
import { currentBehavior, maxChooser } from '../engine/recipes/bench.ts';
import { compileRecipe } from '../engine/recipes/compile.ts';
import { compareBehaviors } from '../engine/recipes/crosscheck.ts';
import { parseCard } from '../engine/recipes/parse/index.ts';
import type { GameState } from '../engine/types.ts';
import { auditCard, legacyCards } from '../../scripts/game/cards-audit.ts';
import { choose, coherent, hasOption, play, setChars, setDon, setHand, tag } from './helpers.ts';
import { charUid, leaderTyped, list, scene } from './eb-scene.ts';

const parse = (num: string) => parseCard({ num, effectEn: CARDS[num].effectEn ?? '', triggerEn: CARDS[num].triggerEn });
const V3 = 'ST21-006';   // coût 3, 5000, sans effet
const PLAIN = 'OP05-002';
const SMALL = 'OP01-010'; // coût 1, 3000

test('outil d’audit : 811 cartes codées avant l’étape C, comparaison code à la main ↔ recette', () => {
  const legacy = legacyCards();
  assert.equal(legacy.size, 811);
  assert.equal(legacy.get('ST01-001'), 'st01');
  // une carte identique, une carte non traduite
  assert.equal(auditCard('OP12-034', 'meta-mihawk', 8).status, 'identique');
  assert.equal(auditCard('OP06-043', 'fam-kuzan', 8).status, 'non traduite');
});

test('traducteur : un attribut relié par « or » est un OU (n° 4102)', () => {
  for (const num of ['OP12-028', 'OP12-034']) {
    const p = parse(num);
    assert.ok(p.ok, num);
    const json = JSON.stringify(p.recipe);
    assert.ok(json.includes('"anyOf":[{"attribute":"Slash"},{"color":["Green"],"category":["EVENT"]}]'), `${num} : ${json}`);
  }
  const p = parse('ST12-003');
  assert.ok(p.ok && JSON.stringify(p.recipe).includes('"anyOf":[{"types":["Muggy Kingdom"]},{"attribute":"Slash"}]'));
});

test('traducteur : coût « 1 Personnage ... sous le deck de son propriétaire » sans « of your » : pas lu comme les siens (n° 4103)', () => {
  for (const num of ['OP04-055', 'OP06-043']) assert.equal(parse(num).ok, false, num);
});

test('compilateur : « vous pouvez défausser 2 cartes. Si vous le faites » pas proposé avec 1 carte (n° 4104, OP15-020)', () => {
  const p = parse('OP15-020');
  assert.ok(p.ok);
  const c = compileRecipe(p.recipe);
  assert.ok(c.ok);
  for (const chooser of [maxChooser(), maxChooser({ refuse: true, none: true })]) {
    const res = compareBehaviors('OP15-020', currentBehavior('OP15-020'), c.behavior, { situations: 20, chooser });
    assert.deepEqual(res.differ, [], 'code à la main et recette identiques');
  }
});

const effectQs = (s: GameState) => {
  while (s.decision?.player === 0 && s.decision.kind === 'effect' && s.decision.tag !== 'donUpTo') {
    s = act(s, s.decision.options.find((o) => o.id.startsWith('card:'))?.id ?? s.decision.options[0].id);
  }
  return s;
};

test('« Puis » sous la condition (n° 1983) : Brochette OP12-078 ne fait rien sans la condition', () => {
  for (const fewer of [true, false]) {
    let s = scene([list(PLAIN, ['OP12-078', V3]), list(PLAIN, [V3])], (g) => {
      setHand(g, 0, ['OP12-078']); setDon(g, 0, fewer ? 5 : 9); g.players[1].donActive = 7; g.players[1].donDeck = 3;
      setChars(g, 1, [{ num: V3 }]);
    });
    const hand = s.players[0].hand.length;
    s = effectQs(play(s, 'OP12-078'));
    assert.equal(s.players[0].hand.length, hand - 1 + (fewer ? 1 : 0), 'pioche seulement avec la condition');
    assert.equal(s.mods.some((m) => m.uid === charUid(s, 1, V3) && m.stat === 'power'), fewer, '−3000 seulement avec la condition');
    coherent(s);
  }
});

test('« Jusqu’à N » DON!! (n° 1994) et « Puis » : Ulti et Page One OP17-060, 0 DON!! possible, KO quand même', () => {
  const AKP = leaderTyped('Animal Kingdom Pirates');
  let s = scene([list(AKP, ['OP17-060', V3]), list(PLAIN, [V3, SMALL])], (g) => {
    setHand(g, 0, ['OP17-060']); setDon(g, 0, 6); setChars(g, 1, [{ num: SMALL }]);
  });
  const deckDon = s.players[0].donDeck;
  s = play(s, 'OP17-060');
  assert.equal(tag(s), 'donUpTo');
  assert.ok(hasOption(s, 'none'));
  s = effectQs(choose(s, 'none'));
  assert.equal(s.players[0].donDeck, deckDon, 'aucune DON!! ajoutée');
  assert.equal(s.players[1].chars.length, 0, 'le KO a lieu');
  // sans Leader {Animal Kingdom Pirates} : ni DON!! ni KO
  s = scene([list(PLAIN, ['OP17-060', V3]), list(PLAIN, [V3, SMALL])], (g) => {
    setHand(g, 0, ['OP17-060']); setDon(g, 0, 6); setChars(g, 1, [{ num: SMALL }]);
  });
  s = effectQs(play(s, 'OP17-060'));
  assert.equal(s.players[1].chars.length, 1);
  coherent(s);
});

test('Regarder 5 cartes, au-dessus ou au-dessous : toutes ensemble (n° 1660), X.Drake OP05-055', () => {
  let s = scene([list(PLAIN, ['OP05-055', V3]), list(PLAIN, [V3])], (g) => { setHand(g, 0, ['OP05-055']); setDon(g, 0, 6); });
  const top5 = s.players[0].deck.slice(0, 5).map((c) => c.uid);
  s = play(s, 'OP05-055');
  assert.equal(tag(s), 'scry');
  assert.deepEqual(s.decision!.options.map((o) => o.id).sort(), ['bottom', 'top']);
  s = choose(s, 'bottom');
  while (s.decision?.player === 0 && s.decision.kind === 'effect') s = act(s, s.decision.options.some((o) => o.id === 'keep') ? 'keep' : s.decision.options[0].id);
  assert.deepEqual(s.players[0].deck.slice(-5).map((c) => c.uid).sort(), [...top5].sort(), 'les 5 au-dessous ensemble');
  coherent(s);
});

test('Gol D. Roger (OP13-064, lecture 1, n° 4110) : son Leader et ses Personnages sans « Roger Pirates » annulés tant qu’il est en jeu', () => {
  const ROGER_LEADER = 'OP13-003';
  const BLOCKER = 'OP02-012';   // [Bloqueur], sans type « Roger Pirates »
  const mk = (withRoger: boolean) => scene([list(ROGER_LEADER, ['OP13-064', BLOCKER, V3]), list(PLAIN, [BLOCKER, V3])], (g) => {
    setChars(g, 0, [...(withRoger ? [{ num: 'OP13-064' }] : []), { num: BLOCKER }]);
    setChars(g, 1, [{ num: BLOCKER }]);
    setDon(g, 0, 5);
  });
  const without = mk(false);
  const withR = mk(true);
  const lead = (s: GameState) => s.players[0].leader.uid;
  assert.equal(power(without, lead(without)), def(ROGER_LEADER).power! - 2000, 'sans Roger : le malus du Leader');
  assert.equal(power(withR, lead(withR)), def(ROGER_LEADER).power!, 'avec Roger : Leader annulé, plus de malus');
  assert.ok(isNegated(withR, charUid(withR, 0, BLOCKER)), 'son Personnage sans le type : annulé');
  assert.ok(!hasKeyword(withR, 0, withR.players[0].chars.find((c) => c.num === BLOCKER)!, 'Blocker'), 'plus de [Bloqueur]');
  assert.ok(!isNegated(withR, charUid(withR, 0, 'OP13-064')), 'Roger lui-même : non');
  assert.ok(!isNegated(withR, charUid(withR, 1, BLOCKER)), 'les cartes adverses : non');
  assert.ok(!isNegated(without, charUid(without, 0, BLOCKER)));
});

test('Gol D. Roger (OP13-064) : [Jouée] DON!! −3 : Leader +2000, tous les Personnages adverses −2000', () => {
  let s = scene([list('OP13-003', ['OP13-064', V3]), list(PLAIN, [V3, SMALL])], (g) => {
    setHand(g, 0, ['OP13-064']); setDon(g, 0, 10); setChars(g, 1, [{ num: V3 }, { num: SMALL }]);
  });
  s = play(s, 'OP13-064');
  if (s.decision?.tag === 'may' || s.decision?.options.some((o) => o.id === 'yes')) s = choose(s, 'yes');
  assert.equal(s.players[0].donActive + s.players[0].donRested + s.players[0].leader.don, 10 - 3, 'DON!! −3');
  assert.equal(power(s, charUid(s, 1, V3)), 5000 - 2000);
  assert.equal(power(s, charUid(s, 1, SMALL)), 3000 - 2000);
  assert.ok(s.mods.some((m) => m.uid === s.players[0].leader.uid && m.stat === 'power' && m.amount === 2000));
  coherent(s);
});

test('Sabo OP05-007 (n° 4111) : puissance totale 4000 ou moins, une puissance négative compte', () => {
  const s0 = scene([list(PLAIN, ['OP05-007', V3]), list(PLAIN, [V3, SMALL])], (g) => {
    setHand(g, 0, ['OP05-007']); setDon(g, 0, 10); setChars(g, 1, [{ num: V3 }, { num: SMALL }]);
  });
  // V3 (5000) à −2000 : 3000 ; SMALL (3000) à −2000 : 1000 → total 4000 : les deux
  const v3 = charUid(s0, 1, V3);
  const small = charUid(s0, 1, SMALL);
  s0.mods.push({ uid: v3, stat: 'power', amount: -2000, until: 'turn', source: 'essai' }, { uid: small, stat: 'power', amount: -2000, until: 'turn', source: 'essai' });
  let s = play(s0, 'OP05-007');
  s = choose(choose(s, `card:${v3}`), `card:${small}`);
  assert.equal(s.players[1].chars.length, 0, 'les deux mis KO (3000 + 1000)');
  // SMALL à −5000 (−2000 de puissance) : V3 à 5000 + (−2000) = 3000 ≤ 4000, proposé alors que 5000 seul dépasse
  const s1 = scene([list(PLAIN, ['OP05-007', V3]), list(PLAIN, [V3, SMALL])], (g) => {
    setHand(g, 0, ['OP05-007']); setDon(g, 0, 10); setChars(g, 1, [{ num: V3 }, { num: SMALL }]);
  });
  s1.mods.push({ uid: charUid(s1, 1, SMALL), stat: 'power', amount: -5000, until: 'turn', source: 'essai' });
  s = play(s1, 'OP05-007');
  assert.ok(hasOption(s, `card:${charUid(s1, 1, V3)}`), '5000 proposé grâce à la puissance négative');
  s = choose(s, `card:${charUid(s1, 1, V3)}`);
  // au-dessus de la borne, « aucun autre » n'est plus proposé : la carte négative est prise d'office
  assert.equal(s.players[1].chars.length, 0);
  coherent(s);
});

test('Jewelry Bonney PRB02-004 (n° 4113) : refuser de redresser ne prend pas la limite d’une fois par tour', () => {
  let s = scene([list(PLAIN, ['PRB02-004', V3]), list(PLAIN, [V3, SMALL])], (g) => {
    setChars(g, 0, [{ num: 'PRB02-004' }]); setDon(g, 0, 0, 2); setChars(g, 1, [{ num: V3 }, { num: SMALL }]);
  }, 1);
  s = act(s, `attack:${charUid(s, 1, V3)}:${s.players[0].leader.uid}`);
  assert.equal(tag(s), 'donUpTo');
  s = choose(s, 'none');
  assert.equal(s.players[0].donActive, 0);
  while (s.decision?.player === 0) s = act(s, s.decision.kind === 'blocker' ? 'noblock' : s.decision.kind === 'counter' ? 'pass' : s.decision.options[0].id);
  while (s.decision?.player === 1 && s.decision.kind !== 'main') s = act(s, s.decision.options[0].id);
  s = act(s, `attack:${charUid(s, 1, SMALL)}:${s.players[0].leader.uid}`);
  assert.equal(tag(s), 'donUpTo', 'la deuxième attaque propose encore');
  s = choose(s, 'n:1');
  assert.equal(s.players[0].donActive, 1);
});
