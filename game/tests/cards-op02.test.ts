// OP02 (tâche S18) : un test par effet des cartes codées à la main (condition vraie et fausse), les Q&A officielles appliquées, et les
// effets des recettes que le banc d'essai ne sait pas mesurer ([Contre] pour la carte attaquée, coût « épuisez ce Lieu », [En attaquant]
// qui change l'issue du combat). Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noBaseEffect } from '../engine/cards/bricks.ts';
import { recipeEntry } from '../engine/cards/index.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import type { DeckList } from '../engine/decks.ts';
import { act, advance } from '../engine/engine.ts';
import { canLeaveByEffect, def, fieldCost, handCost, hasKeyword, power, removeByEffect } from '../engine/rules.ts';
import type { EffectCtx, GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, hasOption, logHas, play, setChars, setDeckTop, setDon, setHand, setLife, tag, take, donMax } from './helpers.ts';
import { charUid, counterGain, leaderUid, list, scene } from './eb-scene.ts';

const V1 = 'ST21-004';   // coût 1, 3000 (un effet)
const V3 = 'ST21-006';   // coût 3, 5000, sans effet
const V4 = 'ST21-008';   // coût 4, 6000, sans effet
const op02 = (...n: number[]) => n.map((k) => `OP02-${String(k).padStart(3, '0')}`);
const ALL = [V1, V3, V4, 'OP01-033', ...op02(4, 5, 8, 14, 16, 24, 27, 30, 38, 45, 48, 51, 53, 58, 62, 64, 66, 68, 69, 70, 74, 76, 84, 85, 89, 90, 91, 92, 94, 100, 110, 111, 118, 120)];
const deck = (leader: string): DeckList => list(leader, ALL);
const OPP = () => deck('OP05-002');

// Un effet du joueur `p` hors d'une partie (Déclenchement, KO par un effet) : chaque question reçoit la première réponse, sauf `answers`
const ctxOf = (s: GameState, p: PlayerId, num: string, answers: string[] = []): EffectCtx => ({
  s, me: p, opp: p === 0 ? 1 : 0, source: -1, num, pending: { kind: 'system', source: -1, num, controller: p, answers: [] } as unknown as EffectCtx['pending'],
  ask: (spec) => { const a = answers.find((x) => spec.options.some((o) => o.id === x)); return a ?? spec.options[0].id; },
});
// L'effet `run` sur une copie de la partie, puis la partie avance (effets en attente résolus par les questions)
const runOn = (s: GameState, run: (g: GameState) => void) => { const g = structuredClone(s); g.decision = null; run(g); return advance(g); };
// Le joueur 1 ne bloque pas et ne joue pas de [Contre]
const oppPasses = (s: GameState) => {
  while (s.decision?.player === 1 && (s.decision.kind === 'blocker' || s.decision.kind === 'counter')) s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  return s;
};
const mePass = (s: GameState) => {
  while (s.decision?.player === 0 && (s.decision.kind === 'blocker' || s.decision.kind === 'counter')) s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  return s;
};

test('OP02 : toutes les cartes jouables, aucune en doute', () => {
  for (let k = 1; k <= 121; k++) {
    const n = `OP02-${String(k).padStart(3, '0')}`;
    assert.ok(['verified', 'coded', 'auto'].includes(confidence(n)), `${n} : ${confidence(n)}`);
  }
  for (const n of op02(14, 71, 74, 89, 90, 91)) assert.equal(recipeEntry(n), undefined, `${n} : codée à la main, sans recette`);
  assert.ok(noBaseEffect(def(V3)) && noBaseEffect(def(V4)) && !noBaseEffect(def(V1)));
});

test('Monkey.D.Garp (OP02-002, Leader) : chaque DON!! donnée pendant son tour, −1 de coût à un Personnage adverse', () => {
  let s = scene([deck('OP02-002'), OPP()], (g) => { setChars(g, 0, [{ num: V4 }]); setChars(g, 1, [{ num: V3 }, { num: 'OP02-030' }]); setDon(g, 0, 4); });
  const t = charUid(s, 1, V3);
  s = act(s, `don:${leaderUid(s, 0)}`);
  assert.equal(tag(s), 'oppCost');
  assert.ok(!hasOption(s, `card:${charUid(s, 1, 'OP02-030')}`), 'coût 8 : pas une cible');
  s = choose(s, `card:${t}`);
  assert.equal(fieldCost(s, t), 2);
  s = act(s, `don:${charUid(s, 0, V4)}`);   // à un Personnage aussi
  s = choose(s, `card:${t}`);
  assert.equal(fieldCost(s, t), 1);
  // 2 DON!! données d'un coup par un effet : deux fois (Q&A)
  s = runOn(s, (g) => { g.players[0].donActive -= 2; g.players[0].leader.don += 2; });
  s = choose(s, `card:${t}`);
  s = choose(s, `card:${t}`);
  assert.equal(fieldCost(s, t), -1);   // 3 − 4 : lu 0 pour les effets (coût de 0 ou moins)
  assert.equal(s.decision?.kind, 'main');
  coherent(s);
  // Garp chez l'adversaire : rien quand je donne une DON!! à mon Leader
  let o = scene([OPP(), deck('OP02-002')], (g) => { setChars(g, 1, [{ num: V3 }]); setDon(g, 0, 2); });
  o = act(o, `don:${leaderUid(o, 0)}`);
  assert.equal(o.decision?.kind, 'main');
});

test('Curly Dadan (OP02-005) : regarder jusqu’à 5 cartes, au choix du joueur ; un Personnage rouge de coût 1', () => {
  const setup = (g: GameState) => { setHand(g, 0, ['OP02-005']); setDon(g, 0, 2); setDeckTop(g, 0, [V3, 'OP02-016', V4]); };
  let s = play(scene([deck('OP02-001'), OPP()], setup), 'OP02-005');
  assert.equal(tag(s), 'donCount');
  assert.equal(s.decision!.options[0].id, 'n:5');
  s = choose(s, 'n:1');   // seulement V3 : rien à prendre
  assert.ok(!s.players[0].hand.some((c) => c.num === 'OP02-016'));
  assert.equal(s.players[0].deck[0].num, 'OP02-016');
  s = play(scene([deck('OP02-001'), OPP()], setup), 'OP02-005');
  s = choose(s, 'n:2');
  assert.equal(tag(s), 'pick');
  s = choose(s, (o) => o.num === 'OP02-016');
  while (s.decision?.tag === 'bottomOrder') s = act(s, 'keep');
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP02-016'));
  assert.equal(s.players[0].deck[0].num, V4);
  coherent(s);
});

test('Whitey Bay (OP02-014) : [DON!! x1] peut attaquer un Personnage adverse redressé', () => {
  const s0 = (don: number) => scene([deck('OP02-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-014', extra: { don } }]); setChars(g, 1, [{ num: V3 }]); setDon(g, 0, 0); });
  let s = s0(1);
  assert.ok(hasOption(s, `attack:${charUid(s, 0, 'OP02-014')}:${charUid(s, 1, V3)}`));
  s = s0(0);
  assert.ok(!hasOption(s, `attack:${charUid(s, 0, 'OP02-014')}:${charUid(s, 1, V3)}`));
});

test('Moby Dick (OP02-024) : [Votre tour] avec 1 Vie ou moins, ses [Edward.Newgate] et ses Personnages « Whitebeard Pirates » +2000, une fois', () => {
  const put = (life: number, active: PlayerId = 0) => scene([deck('OP02-001'), OPP()], (g) => {
    g.players[0].stage = { ...take(g, 0, 'OP02-024'), rested: false, don: 0, playedTurn: 0, usedOpt: [] };
    setChars(g, 0, [{ num: 'OP02-004' }, { num: 'OP02-008' }, { num: V3 }]);
    setLife(g, 0, life ? ['OP02-016'] : []);
    if (life > 1) setLife(g, 0, ['OP02-016', 'OP02-016']);
  }, active);
  let s = put(1);
  assert.equal(power(s, leaderUid(s, 0)), 8000);
  assert.equal(power(s, charUid(s, 0, 'OP02-004')), 12000, 'Newgate et « Whitebeard Pirates » : +2000 une seule fois (Q&A)');
  assert.equal(power(s, charUid(s, 0, 'OP02-008')), 6000);
  assert.equal(power(s, charUid(s, 0, V3)), 5000);
  s = put(2);
  assert.equal(power(s, leaderUid(s, 0)), 6000);
  s = put(1, 1);
  assert.equal(power(s, charUid(s, 0, 'OP02-008')), 4000, 'tour adverse');
  // [Déclenchement] jouer cette carte
  assert.ok(def('OP02-024').onTrigger);
});

test('Kin’emon (OP02-025, Leader) : le prochain Personnage {Land of Wano} de coût 3 ou plus joué en payant coûte 1 de moins', () => {
  const setup = (chars: string[]) => (g: GameState) => { setChars(g, 0, chars.map((num) => ({ num }))); setHand(g, 0, [V3, 'OP02-027', 'OP02-038']); setDon(g, 0, 6); };
  let s = scene([deck('OP02-025'), OPP()], setup([V4]));
  const ina = s.players[0].hand.find((c) => c.num === 'OP02-027')!;
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(handCost(s, 0, ina), 2);
  assert.equal(handCost(s, 0, ina, true), 3, 'un effet qui joue de la main lit le coût sans la réduction (Q&A)');
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`), 'une fois par tour');
  s = play(s, V3);   // un autre Personnage joué avant ne l'use pas (Q&A)
  assert.equal(handCost(s, 0, ina), 2);
  s = play(s, 'OP02-027');
  assert.equal(s.players[0].donActive, 6 - 3 - 2);
  const neko = s.players[0].hand.find((c) => c.num === 'OP02-038')!;
  assert.equal(handCost(s, 0, neko), 3, 'utilisée');
  // 2 Personnages : activable, rien ne se passe
  s = scene([deck('OP02-025'), OPP()], setup([V4, V3]));
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(handCost(s, 0, s.players[0].hand.find((c) => c.num === 'OP02-027')!), 3);
});

test('Sanji (OP02-026, Leader) : jouer de sa main un Personnage sans effet de base avec 3 Personnages ou moins redresse 2 DON!!, une fois par tour', () => {
  const s0 = (chars: string[]) => scene([deck('OP02-026'), OPP()], (g) => { setChars(g, 0, chars.map((num) => ({ num }))); setHand(g, 0, [V3, V4, 'OP02-016']); setDon(g, 0, 8, 2); });
  let s = donMax(play(s0([V1, V1]), V3));   // 3 Personnages avec lui
  assert.equal(s.players[0].donActive, 8 - 3 + 2);
  s = play(s, V4);
  assert.equal(s.players[0].donActive, 7 - 4, 'une fois par tour');
  s = play(s0([V1, V1, V1]), V3);   // 4 Personnages avec lui : rien (Q&A)
  assert.equal(s.players[0].donActive, 5);
  s = play(s0([]), 'OP02-016');   // un effet de base : rien
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].donActive, 7);
});

test('Inuarashi (OP02-027) : toutes ses DON!! épuisées, aucun effet adverse ne la retire', () => {
  const s0 = (active: number, rested: number, given = 0) => scene([deck('OP02-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP02-027' }]);
    g.players[0].leader.don = given;
    setDon(g, 0, active, rested);
  });
  let s = s0(0, 5);
  const u = charUid(s, 0, 'OP02-027');
  assert.equal(canLeaveByEffect(s, u, 1), false);
  assert.equal(canLeaveByEffect(s, u, 0), true, 'ses propres effets');
  s = s0(1, 4);
  assert.equal(canLeaveByEffect(s, charUid(s, 0, 'OP02-027'), 1), true);
  s = s0(0, 4, 1);   // une DON!! donnée : la condition est fausse (Q&A)
  assert.equal(canLeaveByEffect(s, charUid(s, 0, 'OP02-027'), 1), true);
  s = s0(0, 0);   // aucune DON!! : faux (n° 3706)
  assert.equal(canLeaveByEffect(s, charUid(s, 0, 'OP02-027'), 1), true);
});

test('Kouzuki Oden (OP02-030) : ➂ se redresse une fois par tour ; [En cas de KO] un Personnage {Land of Wano} vert de coût 3 du deck, puis mélange', () => {
  let s = scene([deck('OP02-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-030', extra: { rested: true } }]); setDon(g, 0, 4); });
  const oden = charUid(s, 0, 'OP02-030');
  s = act(s, `act:${oden}`);
  assert.equal(s.players[0].chars[0].rested, false);
  assert.equal(s.players[0].donActive, 1);
  assert.ok(!hasOption(s, `act:${oden}`));
  // KO par un effet adverse
  s = runOn(s, (g) => { removeByEffect(ctxOf(g, 1, 'OP02-099'), oden, 'ko'); });
  assert.equal(tag(s), 'playFree');
  assert.ok(s.decision!.options.every((o) => o.id === 'none' || ['OP02-027', 'OP02-038', 'OP01-033'].includes(o.num!)), 'coût 3 exactement, vert, {Land of Wano}');
  s = choose(s, (o) => o.num === 'OP02-027');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP02-027'));
  assert.ok(logHas(s, /mélange son deck \(Kouzuki Oden\)/));
  coherent(s);
});

test('Emporio.Ivankov (OP02-051) : piocher jusqu’à 3 cartes en main, puis un Personnage {Impel Down} bleu de coût 6 ou moins', () => {
  let s = play(scene([deck('OP02-049'), OPP()], (g) => { setHand(g, 0, ['OP02-051', 'OP02-058']); setDon(g, 0, 7); }), 'OP02-051');
  assert.equal(tag(s), 'playFree');
  assert.equal(s.players[0].hand.length, 3);
  s = choose(s, (o) => o.num === 'OP02-058');
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options.find((o) => o.id === 'none')?.id ?? s.decision!.options[0].id);
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP02-058'));
  // 4 cartes ou plus : pas de pioche, ni de défausse (Q&A)
  s = play(scene([deck('OP02-049'), OPP()], (g) => { setHand(g, 0, ['OP02-051', V3, V4, V1, 'OP02-016']); setDon(g, 0, 7); }), 'OP02-051');
  assert.equal(s.players[0].hand.length, 4);
});

test('Mr.2 Bon Kurei (OP02-064) : [DON!! x1] [En attaquant] coût payé : un Personnage de coût 2 ou moins sous le deck, puis lui-même à la fin du combat', () => {
  const s0 = (don: number) => scene([deck('OP02-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP02-064', extra: { don } }]); setChars(g, 1, [{ num: V1 }]); setHand(g, 0, [V3]); setDon(g, 0, 0);
  });
  let s = s0(1);
  const mr2 = charUid(s, 0, 'OP02-064');
  const t = charUid(s, 1, V1);
  s = attack(s, mr2, leaderUid(s, 1));
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  if (s.decision?.player === 0 && s.decision.tag !== 'oppRemove') s = choose(s, (o) => o.num === V3 || o.id.startsWith('card:'));
  assert.equal(tag(s), 'oppRemove');
  s = choose(s, `card:${t}`);
  assert.equal(s.players[1].deck.at(-1)!.uid, t);
  s = oppPasses(s);
  assert.equal(s.battle, null);
  assert.ok(!s.players[0].chars.some((c) => c.uid === mr2), 'sous le deck à la fin du combat');
  assert.equal(s.players[0].deck.at(-1)!.uid, mr2);
  coherent(s);
  // coût refusé : il reste
  s = s0(1);
  s = attack(s, charUid(s, 0, 'OP02-064'), leaderUid(s, 1));
  s = oppPasses(choose(s, 'no'));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP02-064'));
  // sans DON!! : rien
  s = s0(0);
  s = oppPasses(attack(s, charUid(s, 0, 'OP02-064'), leaderUid(s, 1)));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP02-064'));
});

test('Impel Down All Stars (OP02-066) : défausser 2 ; avec un Leader {Impel Down}, piocher jusqu’à 2 ; sinon rien (Q&A) ; [Déclenchement] piocher 2', () => {
  const s0 = (leader: string) => scene([deck(leader), OPP()], (g) => { setHand(g, 0, ['OP02-066', V3, V4, V1]); setDon(g, 0, 1); });
  let s = play(s0('OP02-049'), 'OP02-066');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  while (s.decision?.tag !== 'donCount') s = act(s, s.decision!.options[0].id);
  s = choose(s, 'n:1');
  assert.equal(s.players[0].hand.length, 2);
  s = play(s0('OP02-001'), 'OP02-066');
  assert.equal(tag(s), 'mayIdle');
  s = choose(s, 'yes');
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, 1);
  const g = structuredClone(s);
  const before = g.players[0].hand.length;
  def('OP02-066').onTrigger!(ctxOf(g, 0, 'OP02-066'));
  assert.equal(g.players[0].hand.length, before + 2);
});

test('DEATH WINK (OP02-069) : [Contre] +6000, puis piocher jusqu’à 2 cartes en main (cette carte n’y est plus : Q&A)', () => {
  const s0 = scene([deck('OP02-049'), OPP()], (g) => { setHand(g, 0, ['OP02-069', V3]); setDon(g, 0, 3); g.players[1].leader.don = 3; g.players[1].donDeck -= 3; }, 1);
  const { s, gain } = counterGain(s0, 'OP02-069');
  assert.equal(gain, 6000);
  assert.equal(s.players[0].hand.length, 2);
  const g = structuredClone(s0);
  setChars(g, 0, [{ num: 'OP02-030' }]);   // coût 8 : pas de [Déclenchement]
  setChars(g, 1, [{ num: V4 }]);
  def('OP02-069').onTrigger!(ctxOf(g, 0, 'OP02-069'));
  assert.ok(g.players[1].hand.some((c) => c.num === V4));
  assert.ok(g.players[0].chars.some((c) => c.num === 'OP02-030'));
});

test('Magellan (OP02-071, Leader) : [Votre tour] [Une fois par tour] une DON!! renvoyée, la sienne ou une adverse (Q&A) : +1000', () => {
  let s = scene([deck('OP02-071'), OPP()], (g) => { setHand(g, 0, ['OP02-076']); setDon(g, 0, 6); setDon(g, 1, 6); });
  s = play(s, 'OP02-076');
  s = choose(s, 'yes');
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options.find((o) => o.id === 'none')?.id ?? s.decision!.options[0].id);
  assert.equal(power(s, leaderUid(s, 0)), 6000);
  // la DON!! adverse renvoyée par un effet : une fois par tour
  s = runOn(s, (g) => { def('OP02-090').onTrigger!(ctxOf(g, 0, 'OP02-090')); });
  assert.equal(power(s, leaderUid(s, 0)), 6000);
  let o = scene([deck('OP02-071'), OPP()], (g) => { setDon(g, 1, 6); });
  o = runOn(o, (g) => { def('OP02-090').onTrigger!(ctxOf(g, 0, 'OP02-090')); });
  assert.equal(o.players[1].donActive + o.players[1].donRested, 5);
  assert.equal(power(o, leaderUid(o, 0)), 6000, 'la DON!! adverse compte');
  // pendant le tour adverse : rien
  o = scene([deck('OP02-071'), OPP()], (g) => { setDon(g, 1, 6); }, 1);
  o = runOn(o, (g) => { def('OP02-090').onTrigger!(ctxOf(g, 0, 'OP02-090')); });
  assert.equal(power(o, leaderUid(o, 0)), 5000);
});

test('Magellan (OP02-085) : l’adversaire choisit la DON!! renvoyée, une DON!! donnée comprise (Q&A) ; KO pendant le tour adverse : 2', () => {
  let s = scene([deck('OP02-001'), OPP()], (g) => { setHand(g, 0, ['OP02-085']); setDon(g, 0, 6); g.players[1].leader.don = 2; setDon(g, 1, 1, 1); });
  s = play(s, 'OP02-085');
  s = choose(s, 'yes');
  assert.equal(s.decision?.player, 1);
  assert.equal(tag(s), 'oppPayDon');
  assert.deepEqual(s.decision!.options.map((o) => o.id), ['rested', `card:${leaderUid(s, 1)}`, 'active'], 'pendant mon tour : épuisée, donnée, puis redressée');
  s = choose(s, `card:${leaderUid(s, 1)}`);
  assert.equal(s.players[1].leader.don, 1);
  assert.equal(s.players[1].donDeck, 10 - 3);
  coherent(s);
  // mis KO pendant le tour adverse : 2 DON!! adverses
  let o = scene([deck('OP02-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-085' }]); setDon(g, 1, 4); }, 1);
  o = runOn(o, (g) => { removeByEffect(ctxOf(g, 1, 'OP02-099'), charUid(g, 0, 'OP02-085'), 'ko'); });
  while (o.decision?.tag === 'oppPayDon') o = act(o, o.decision.options[0].id);
  assert.equal(o.players[1].donActive, 2);
  // pendant mon tour : rien
  o = scene([deck('OP02-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-085' }]); setDon(g, 1, 4); });
  o = runOn(o, (g) => { removeByEffect(ctxOf(g, 1, 'OP02-099'), charUid(g, 0, 'OP02-085'), 'ko'); });
  assert.equal(o.players[1].donActive, 4);
});

test('Juge des Enfers (OP02-089) : [Contre] DON!! −1 : 2 cartes adverses différentes −3000 ; [Déclenchement] avec 6 DON!! adverses ou plus', () => {
  let s = scene([deck('OP02-071'), OPP()], (g) => { setHand(g, 0, ['OP02-089']); setDon(g, 0, 3); setChars(g, 1, [{ num: V4 }]); g.players[1].leader.don = 1; g.players[1].donDeck -= 1; }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker') s = act(s, 'noblock');
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = choose(s, 'yes');
  assert.equal(tag(s), 'oppPower');
  s = choose(s, `card:${leaderUid(s, 1)}`);
  assert.ok(!hasOption(s, `card:${leaderUid(s, 1)}`), 'pas deux fois la même carte (Q&A)');
  s = choose(s, `card:${charUid(s, 1, V4)}`);
  assert.equal(power(s, charUid(s, 1, V4)), 3000);
  // [Déclenchement]
  const g = structuredClone(s);
  g.players[1].leader.don = 0;
  setDon(g, 1, 5);
  def('OP02-089').onTrigger!(ctxOf(g, 0, 'OP02-089'));
  assert.equal(g.players[1].donActive, 5, '5 DON!! : rien');
  setDon(g, 1, 6);
  def('OP02-089').onTrigger!(ctxOf(g, 0, 'OP02-089'));
  assert.equal(g.players[1].donActive, 5);
});

test('Hydra (OP02-090) et Venom Road (OP02-091) : [Principale]', () => {
  let s = play(scene([deck('OP02-071'), OPP()], (g) => { setHand(g, 0, ['OP02-090', 'OP02-091']); setDon(g, 0, 5); setChars(g, 1, [{ num: V4 }]); }), 'OP02-090');
  s = choose(s, 'yes');
  s = choose(s, `card:${charUid(s, 1, V4)}`);
  assert.equal(power(s, charUid(s, 1, V4)), 3000);
  const before = s.players[0].donActive;
  s = donMax(play(s, 'OP02-091'));
  assert.equal(s.players[0].donActive, before - 3 + 1);
});

test('Isuka (OP02-094) : [DON!! x1] [Une fois par tour] met KO en combat un Personnage adverse : elle se redresse', () => {
  const s0 = (don: number) => scene([deck('OP02-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP02-094', extra: { don } }]); setChars(g, 1, [{ num: V1, extra: { rested: true } }, { num: V1, extra: { rested: true } }]); setDon(g, 0, 0);
  });
  let s = s0(1);
  const isuka = charUid(s, 0, 'OP02-094');
  s = oppPasses(attack(s, isuka, s.players[1].chars[0].uid));
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[1].chars.length, 1);
  assert.equal(s.players[0].chars[0].rested, false);
  s = oppPasses(attack(s, isuka, s.players[1].chars[0].uid));
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].chars[0].rested, true, 'une fois par tour');
  s = s0(0);
  s = oppPasses(attack(s, charUid(s, 0, 'OP02-094'), s.players[1].chars[0].uid));
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].chars[0].rested, true, 'sans DON!!');
});

test('Saldeath (OP02-074) : tous ses Personnages [Blugori] ont [Bloqueur]', () => {
  let s = scene([deck('OP02-071'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-074' }, { num: 'OP02-084' }, { num: 'OP02-084' }]); });
  for (const c of s.players[0].chars) assert.equal(hasKeyword(s, 0, c, 'Blocker'), c.num === 'OP02-084', c.num);
  s = scene([deck('OP02-071'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-084' }]); });
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Blocker'), false);
});

test('Hina (OP02-110) : [En bloquant] un Personnage adverse de coût 6 ou moins ne peut plus attaquer ce tour-ci', () => {
  let s = scene([deck('OP02-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-110' }]); setChars(g, 1, [{ num: V3 }]); g.players[1].leader.don = 3; g.players[1].donDeck -= 3; }, 1);
  const v3 = charUid(s, 1, V3);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = act(s, `block:${charUid(s, 0, 'OP02-110')}`);
  assert.equal(tag(s), 'oppLock');
  s = choose(s, `card:${v3}`);
  s = mePass(s);
  while (s.decision && s.decision.kind !== 'main') s = act(s, s.decision.options[0].id);
  assert.equal(s.active, 1);
  assert.ok(!s.decision!.options.some((o) => o.id.startsWith(`attack:${v3}:`)));
});

test('Joyau sacré de Yasakani (OP02-118) : [Contre] défausser 1 : un de ses Personnages ne peut pas être mis KO pendant ce combat', () => {
  const s0 = () => scene([deck('OP02-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: V3, extra: { rested: true } }]); setHand(g, 0, ['OP02-118', V4]); setDon(g, 0, 1); g.players[1].leader.don = 3; g.players[1].donDeck -= 3;
  }, 1);
  let s = s0();
  const v3 = charUid(s, 0, V3);
  s = attack(s, leaderUid(s, 1), v3);
  while (s.decision?.kind === 'blocker') s = act(s, 'noblock');
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = choose(s, 'yes');
  while (s.decision?.tag !== 'ownGrant') s = act(s, s.decision!.options[0].id);
  s = choose(s, `card:${v3}`);
  s = mePass(s);
  assert.ok(s.players[0].chars.some((c) => c.uid === v3), 'pas mis KO');
  s = s0();
  s = attack(s, leaderUid(s, 1), charUid(s, 0, V3));
  while (s.decision?.kind === 'blocker') s = act(s, 'noblock');
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = mePass(choose(s, 'no'));
  assert.equal(s.players[0].chars.length, 0, 'coût refusé : mis KO');
  // [Déclenchement] un Lieu adverse de coût 3 ou moins
  const g = structuredClone(s);
  g.players[1].stage = { ...take(g, 1, 'OP02-070'), rested: false, don: 0, playedTurn: 0, usedOpt: [] };
  def('OP02-118').onTrigger!(ctxOf(g, 0, 'OP02-118'));
  assert.equal(g.players[1].stage, null);
});

test('Uta (OP02-120) : DON!! −2 : son Leader et ses Personnages du moment +1000 jusqu’au début de son prochain tour', () => {
  let s = play(scene([deck('OP02-001'), OPP()], (g) => { setChars(g, 0, [{ num: V3 }]); setHand(g, 0, ['OP02-120', V4]); setDon(g, 0, 10); }), 'OP02-120');
  s = choose(s, 'yes');
  assert.equal(power(s, leaderUid(s, 0)), 7000);
  assert.equal(power(s, charUid(s, 0, V3)), 6000);
  assert.equal(power(s, charUid(s, 0, 'OP02-120')), 9000);
  assert.equal(s.players[0].donDeck, 2);
  s = act(s, 'end');
  while (s.active === 1 && s.decision?.kind !== 'main') s = act(s, s.decision!.options[0].id);
  assert.equal(power(s, charUid(s, 0, V3)), 6000, 'pendant le tour adverse');
});

test('Recettes : Oni Giri (OP02-045) [Contre] +6000 puis un Personnage sans effet de base de coût 3 ou moins', () => {
  const s0 = scene([deck('OP02-026'), OPP()], (g) => { setHand(g, 0, ['OP02-045', V3, V4]); setDon(g, 0, 3); g.players[1].leader.don = 3; g.players[1].donDeck -= 3; }, 1);
  const { s, gain } = counterGain(s0, 'OP02-045', (x) => (x.decision?.tag === 'playFree' ? choose(x, (o) => o.num === V3) : x));
  assert.equal(gain, 6000);
  assert.ok(s.players[0].chars.some((c) => c.num === V3));
  assert.ok(!s.players[0].chars.some((c) => c.num === V4), 'coût 4 : non');
});

test('Recettes : Lieux OP02-048, OP02-070, OP02-092 (coût « épuisez ce Lieu »)', () => {
  const withStage = (leader: string, stage: string, hand: string[], top: string[] = []) => scene([deck(leader), OPP()], (g) => {
    g.players[0].stage = { ...take(g, 0, stage), rested: false, don: 0, playedTurn: 0, usedOpt: [] };
    setHand(g, 0, hand); setDon(g, 0, 1, 2); setDeckTop(g, 0, top);
  });
  let s = withStage('OP02-025', 'OP02-048', ['OP02-027', V3]);
  s = donMax(act(s, `act:${s.players[0].stage!.uid}`));
  while (s.decision?.kind !== 'main') s = choose(s, (o) => o.num === 'OP02-027' || o.id === 'yes' || o.id.startsWith('card:'));
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(s.players[0].donActive, 2);
  assert.ok(s.players[0].trash.some((c) => c.num === 'OP02-027'));
  // New Kama Land : avec le Leader Ivankov, piocher 1, défausser 1, puis jusqu'à 3 ; sans lui, épuisé et rien (Q&A)
  s = withStage('OP02-049', 'OP02-070', [V3, V4]);
  s = act(s, `act:${s.players[0].stage!.uid}`);
  assert.equal(s.players[0].hand.length, 3);
  while (s.decision?.kind !== 'main') s = act(s, s.decision!.options.find((o) => o.id === 'none')?.id ?? s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, 2);
  s = withStage('OP02-001', 'OP02-070', [V3, V4]);
  s = act(s, `act:${s.players[0].stage!.uid}`);
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(s.players[0].hand.length, 2);
  // Impel Down : défausser 1 et épuiser : regarder 3, une carte {Impel Down}
  s = withStage('OP02-049', 'OP02-092', [V3], [V4, 'OP02-084', V1]);
  s = act(s, `act:${s.players[0].stage!.uid}`);
  while (s.decision?.tag === 'discard' || s.decision?.tag === 'restCost') s = act(s, s.decision.options[0].id);
  assert.equal(tag(s), 'pick');
  assert.deepEqual(s.decision!.options.map((o) => o.num ?? o.id), ['OP02-084', 'none']);
  s = choose(s, (o) => o.num === 'OP02-084');
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP02-084'));
  assert.ok(s.players[0].trash.some((c) => c.num === V3));
  assert.equal(s.players[0].stage!.rested, true);
});

test('Recettes : Monkey.D.Luffy (OP02-062) [En attaquant] défausser 2 : [Double attaque], même sans Personnage renvoyé (Q&A)', () => {
  let s = scene([deck('OP02-049'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP02-062' }]); setChars(g, 1, [{ num: V4 }]); setHand(g, 0, [V3, V1]); setDon(g, 0, 0); setLife(g, 1, [V3, V3, V3]); });
  s = attack(s, charUid(s, 0, 'OP02-062'), leaderUid(s, 1));
  s = choose(s, 'yes');
  while (s.decision?.player === 0 && s.decision.tag !== 'bounce') s = act(s, s.decision.options[0].id);
  assert.equal(tag(s), 'bounce');
  s = choose(s, 'none');
  s = oppPasses(s);
  while (s.decision?.player === 1 && s.decision.kind === 'effect') s = act(s, s.decision.options.find((o) => o.id === 'hand')?.id ?? s.decision.options[0].id);
  assert.equal(s.players[1].life.length, 1, '2 dégâts');
  assert.ok(s.players[1].chars.some((c) => c.num === V4));
});

test('Recettes : Fullbody (OP02-111) [En attaquant] +3000 pendant le combat avec [Jango]', () => {
  const s0 = (jango: boolean) => scene([deck('OP02-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP02-111' }, ...(jango ? [{ num: 'OP02-100' }] : [])]); setDon(g, 0, 0); setChars(g, 1, [{ num: V3, extra: { rested: true } }]);
  });
  let s = s0(true);
  s = oppPasses(attack(s, charUid(s, 0, 'OP02-111'), charUid(s, 1, V3)));
  assert.ok(logHas(s, /Fullbody.*\+3000|\+3000.*Fullbody/), 'gain lu au journal');
  assert.equal(s.players[1].chars.length, 0, '6000 contre 5000');
  s = s0(false);
  s = oppPasses(attack(s, charUid(s, 0, 'OP02-111'), charUid(s, 1, V3)));
  assert.equal(s.players[1].chars.length, 1);
});

test('Recettes : Gum-Gum Rain (OP02-068) [Contre] défausser 1 : +3000 ; [Déclenchement] un Personnage de coût 2 ou moins renvoyé', () => {
  const s0 = scene([deck('OP02-049'), OPP()], (g) => { setHand(g, 0, ['OP02-068', V3]); setDon(g, 0, 0); g.players[1].leader.don = 3; g.players[1].donDeck -= 3; }, 1);
  let r = counterGain(s0, 'OP02-068', (x) => { let y = choose(x, 'yes'); while (y.decision?.tag === 'discard') y = act(y, y.decision.options[0].id); return y; });
  assert.equal(r.gain, 3000);
  r = counterGain(s0, 'OP02-068', (x) => choose(x, 'no'));
  assert.equal(r.gain, 0, 'coût refusé (Q&A)');
  const g = structuredClone(s0);
  setChars(g, 1, [{ num: V1 }]);
  def('OP02-068').onTrigger!(ctxOf(g, 0, 'OP02-068'));
  assert.ok(g.players[1].hand.some((c) => c.num === V1));
});
