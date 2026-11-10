// OP01 (tâche S19) : un test par effet des cartes codées à la main (condition vraie et fausse), les Q&A officielles appliquées, et les
// effets des recettes que le banc d'essai ne sait pas mesurer ([Contre] pour la carte attaquée, [Déclenchement] et attaquant du banc).
// Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recipeEntry } from '../engine/cards/index.ts';
import { playableErrors } from '../engine/deckRules.ts';
import type { DeckList } from '../engine/decks.ts';
import { act, advance } from '../engine/engine.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { def, handCost, hasKeyword, knows, power, removeByEffect } from '../engine/rules.ts';
import type { EffectCtx, GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, hasOption, inHand, logHas, play, setChars, setDeckTop, setDon, setHand, setLife, tag } from './helpers.ts';
import { charUid, counterGain, leaderUid, list, scene } from './eb-scene.ts';

const V1 = 'ST21-004';   // rouge, coût 1, 3000 (un effet)
const V3 = 'ST21-006';   // rouge, coût 3, 5000, sans effet
const V4 = 'ST21-008';   // rouge, coût 4, 6000, {Straw Hat Crew}, sans effet
const G1 = 'OP16-023';   // vert, coût 1, 3000, sans effet
const G5 = 'EB05-015';   // vert, coût 5, 7000, <Slash>, sans effet
const P4 = 'EB05-032';   // violet, coût 4, 6000, <Strike>, sans effet
const SN3 = 'OP14-008';  // rouge, coût 3, {Supernovas}, sans effet
const SN6 = 'OP14-007';  // rouge, coût 6, {Supernovas}, sans effet
const ENEL = 'OP05-100';
const SABO = 'OP05-001';
const ROSI = 'OP05-030';
const op01 = (...n: number[]) => n.map((k) => `OP01-${String(k).padStart(3, '0')}`);
const ALL = [V1, V3, V4, G1, G5, P4, SN3, SN6, ENEL, ROSI, 'ST10-008',
  ...op01(4, 8, 11, 21, 24, 26, 27, 29, 38, 44, 47, 50, 51, 57, 58, 63, 67, 69, 72, 75, 85, 86, 88, 89, 94, 96, 98, 99, 100, 105, 113, 116, 118, 119)];
const deck = (leader: string): DeckList => list(leader, ALL);
const OPP = () => deck('OP05-002');

// Un effet du joueur `p` hors d'une partie (KO par un effet adverse...) : chaque question reçoit la première réponse, sauf `answers`
const ctxOf = (s: GameState, p: PlayerId, num: string, answers: string[] = []): EffectCtx => ({
  s, me: p, opp: p === 0 ? 1 : 0, source: -1, num, pending: { kind: 'system', source: -1, num, controller: p, answers: [] } as unknown as EffectCtx['pending'],
  ask: (spec) => { const a = answers.find((x) => spec.options.some((o) => o.id === x)); return a ?? spec.options[0].id; },
});
// L'effet `run` sur une copie de la partie, puis la partie avance (effets en attente résolus par les questions)
const runOn = (s: GameState, run: (g: GameState) => void) => { const g = structuredClone(s); g.decision = null; run(g); return advance(g); };
// Le joueur `p` ne bloque pas et ne joue pas de [Contre]
const passes = (s: GameState, p: PlayerId) => {
  while (s.decision?.player === p && (s.decision.kind === 'blocker' || s.decision.kind === 'counter')) s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  return s;
};
const ownChars = (s: GameState, p: PlayerId) => s.players[p].chars.map((c) => c.num);

test('OP01 : toutes les cartes jouables sauf Kurozumi Semimaru (doute) ; ST01 jouable', () => {
  for (let k = 1; k <= 121; k++) {
    const n = `OP01-${String(k).padStart(3, '0')}`;
    if (n === 'OP01-099') assert.equal(confidence(n), 'doubt');
    else assert.ok(['verified', 'coded', 'auto'].includes(confidence(n)), `${n} : ${confidence(n)}`);
  }
  for (let k = 1; k <= 17; k++) {
    const n = `ST01-${String(k).padStart(3, '0')}`;
    assert.ok(['verified', 'coded', 'auto'].includes(confidence(n)), `${n} : ${confidence(n)}`);
  }
  for (const n of op01(21, 94, 96, 113)) assert.equal(recipeEntry(n), undefined, `${n} : codée à la main, sans recette`);
  assert.equal(recipeEntry('OP01-099')?.handCoded, true);
});

test('Trafalgar Law (OP01-002, Leader) : avec 5 Personnages, en renvoyer 1 puis jouer un Personnage d’une autre couleur de coût 5 ou moins', () => {
  const setup = (chars: string[]) => (g: GameState) => { setChars(g, 0, chars.map((num) => ({ num }))); setHand(g, 0, [G5, 'OP01-024', SN6]); setDon(g, 0, 2); };
  let s = scene([deck('OP01-002'), OPP()], setup([V1, V3, V4, G1, SN3]));
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(tag(s), 'returnOwn');
  s = choose(s, `card:${charUid(s, 0, V3)}`);   // rouge
  assert.equal(tag(s), 'playFree');
  assert.ok(!hasOption(s, `card:${inHand(s, 0, 'OP01-024')}`), 'rouge : même couleur');
  assert.ok(!hasOption(s, `card:${inHand(s, 0, V3)}`), 'celui qui vient d’être renvoyé');
  s = choose(s, `card:${inHand(s, 0, G5)}`);
  assert.ok(ownChars(s, 0).includes(G5) && !ownChars(s, 0).includes(V3));
  assert.equal(s.players[0].chars.length, 5);
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`), 'une fois par tour');
  coherent(s);
  // un vert renvoyé : un rouge de coût 5 ou moins (pas SN6, coût 6)
  s = scene([deck('OP01-002'), OPP()], setup([V1, V3, V4, G1, SN3]));
  s = choose(act(s, `act:${leaderUid(s, 0)}`), `card:${charUid(s, 0, G1)}`);
  assert.ok(hasOption(s, `card:${inHand(s, 0, 'OP01-024')}`) && !hasOption(s, `card:${inHand(s, 0, SN6)}`) && !hasOption(s, `card:${inHand(s, 0, G5)}`));
  // 4 Personnages : le coût est payé, rien ne se passe
  s = scene([deck('OP01-002'), OPP()], setup([V1, V3, V4, G1]));
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].chars.length, 4);
  assert.equal(s.players[0].donActive, 0);
});

test('Monkey.D.Luffy (OP01-003, Leader) : ➃ : un Personnage {Supernovas} ou {Straw Hat Crew} de coût 5 ou moins redressé et +1000', () => {
  let s = scene([deck('OP01-003'), OPP()], (g) => {
    setChars(g, 0, [{ num: SN3, extra: { rested: true } }, { num: SN6, extra: { rested: true } }, { num: V3, extra: { rested: true } }, { num: V4, extra: { rested: true } }]);
    setDon(g, 0, 4);
  });
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(tag(s), 'ownGrant');
  assert.ok(hasOption(s, `card:${charUid(s, 0, V4)}`), '{Straw Hat Crew}');
  assert.ok(!hasOption(s, `card:${charUid(s, 0, SN6)}`), 'coût 6');
  assert.ok(!hasOption(s, `card:${charUid(s, 0, V3)}`), 'autre type');
  const u = charUid(s, 0, SN3);
  s = choose(s, `card:${u}`);
  assert.equal(s.players[0].chars.find((c) => c.uid === u)!.rested, false);
  assert.equal(power(s, u), def(SN3).power! + 1000);
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`), 'une fois par tour');
  coherent(s);
});

test('Usopp (OP01-004) : [DON!! x1] [Votre tour] [Une fois par tour] l’adversaire active un Événement : piocher 1 carte', () => {
  // l'adversaire joue ses deux Événements [Contre] pendant mon attaque
  const run = (don: number) => {
    let s = scene([deck('OP01-001'), OPP()], (g) => {
      setChars(g, 0, [{ num: 'OP01-004', extra: { don } }]);
      setDon(g, 0, 0);
      setHand(g, 1, ['OP01-029', 'OP01-029']);
      setDon(g, 1, 2);
    });
    const before = s.players[0].hand.length;
    s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
    while (s.decision?.player === 1 && s.decision.kind === 'blocker') s = act(s, 'noblock');
    const drawn: number[] = [];
    for (let k = 0; k < 2; k++) {
      assert.equal(s.decision?.kind, 'counter');
      s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
      drawn.push(s.players[0].hand.length - before);
    }
    return drawn;
  };
  assert.deepEqual(run(1), [1, 1], 'une carte, une seule fois par tour');
  assert.deepEqual(run(0), [0, 0], 'sans DON!!');
});

test('Gordon (OP01-011) : [Jouée] une carte de la main au-dessous du deck : piocher 1 carte ; rien sans autre carte en main', () => {
  let s = scene([deck('OP01-001'), OPP()], (g) => { setHand(g, 0, ['OP01-011', V1]); setDon(g, 0, 5); });
  const v = inHand(s, 0, V1);
  s = play(s, 'OP01-011');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');   // une seule carte en main : placée d'office
  assert.equal(s.players[0].deck.at(-1)!.uid, v);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.decision?.kind, 'main');
  coherent(s);
  s = play(scene([deck('OP01-001'), OPP()], (g) => { setHand(g, 0, ['OP01-011']); setDon(g, 0, 5); }), 'OP01-011');
  assert.equal(s.decision?.kind, 'main', 'pas de question');
});

test('Franky (OP01-021) : [DON!! x1] peut attaquer un Personnage adverse redressé', () => {
  const s0 = (don: number) => scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP01-021', extra: { don } }]); setChars(g, 1, [{ num: V3 }]); setDon(g, 0, 0); });
  let s = s0(1);
  assert.ok(hasOption(s, `attack:${charUid(s, 0, 'OP01-021')}:${charUid(s, 1, V3)}`));
  s = s0(0);
  assert.ok(!hasOption(s, `attack:${charUid(s, 0, 'OP01-021')}:${charUid(s, 1, V3)}`));
});

test('Monkey D. Luffy (OP01-024) : [DON!! x2] pas de KO en combat par un Personnage <Strike> ; se donner 2 DON!! épuisées', () => {
  const defend = (attacker: string, don: number) => {
    let s = scene([deck('OP01-001'), OPP()], (g) => {
      setChars(g, 0, [{ num: 'OP01-024', extra: { rested: true, don } }]);
      setDon(g, 0, 0);
      setHand(g, 0, []);
      setChars(g, 1, [{ num: attacker }]);
    }, 1);
    s = attack(s, charUid(s, 1, attacker), charUid(s, 0, 'OP01-024'));
    return passes(s, 0);
  };
  assert.ok(ownChars(defend(P4, 2), 0).includes('OP01-024'), '<Strike> : pas de KO');
  assert.ok(!ownChars(defend(G5, 2), 0).includes('OP01-024'), '<Slash> : KO');
  assert.ok(!ownChars(defend(P4, 1), 0).includes('OP01-024'), '1 DON!! : KO');
  let s = scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP01-024' }]); setDon(g, 0, 0, 3); });
  const u = charUid(s, 0, 'OP01-024');
  s = act(s, `act:${u}`);
  assert.equal(s.players[0].chars[0].don, 2);
  assert.equal(s.players[0].donRested, 1);
  assert.ok(!hasOption(s, `act:${u}`));
});

test('Radical Beam (OP01-029) : [Contre] +2000, et +2000 de plus avec 2 Vies ou moins', () => {
  const setup = (life: number) => (g: GameState) => { setHand(g, 0, ['OP01-029']); setDon(g, 0, 1); setLife(g, 0, Array(life).fill(V1)); setChars(g, 0, []); };
  assert.equal(counterGain(scene([deck('OP01-001'), OPP()], setup(3), 1), 'OP01-029').gain, 2000);
  assert.equal(counterGain(scene([deck('OP01-001'), OPP()], setup(2), 1), 'OP01-029').gain, 4000);
  assert.ok(def('OP01-029').onTrigger);
});

test('Kanjuro (OP01-038) : [En cas de KO] une carte de sa main dans la Défausse ; [DON!! x1] [En attaquant] KO épuisé coût 2', () => {
  let s = scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP01-038' }]); setHand(g, 0, [V1, V3]); });
  s = runOn(s, (g) => { removeByEffect(ctxOf(g, 1, 'OP01-027'), charUid(g, 0, 'OP01-038'), 'ko'); });
  assert.equal(s.players[0].hand.length, 1);
  assert.ok(s.players[0].trash.some((c) => c.num === V1 || c.num === V3));
  coherent(s);
  s = scene([deck('OP01-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP01-038', extra: { don: 1 } }]); setDon(g, 0, 0);
    setChars(g, 1, [{ num: V1, extra: { rested: true } }, { num: V3, extra: { rested: true } }]);
  });
  s = attack(s, charUid(s, 0, 'OP01-038'), leaderUid(s, 1));
  assert.equal(tag(s), 'oppKo');
  assert.ok(!hasOption(s, `card:${charUid(s, 1, V3)}`), 'coût 3');
  s = choose(s, `card:${charUid(s, 1, V1)}`);
  assert.ok(!ownChars(s, 1).includes(V1));
});

test('Eustass "Captain" Kidd (OP01-051) : [DON!! x1] [Tour adverse] épuisé, seul lui peut être attaqué ; s’épuiser pour jouer un coût 3', () => {
  const s0 = (don: number) => scene([deck('OP01-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP01-051', extra: { rested: true, don } }, { num: V3, extra: { rested: true } }]); setDon(g, 0, 0);
    setChars(g, 1, [{ num: V4 }]);
  }, 1);
  let s = s0(1);
  const a = charUid(s, 1, V4);
  assert.ok(hasOption(s, `attack:${a}:${charUid(s, 0, 'OP01-051')}`));
  assert.ok(!hasOption(s, `attack:${a}:${leaderUid(s, 0)}`) && !hasOption(s, `attack:${a}:${charUid(s, 0, V3)}`));
  s = s0(0);
  assert.ok(hasOption(s, `attack:${a}:${leaderUid(s, 0)}`), 'sans DON!!');
  s = scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP01-051' }]); setHand(g, 0, [V1, V4]); });
  const k = charUid(s, 0, 'OP01-051');
  s = act(s, `act:${k}`);
  assert.equal(tag(s), 'playFree');
  assert.ok(!hasOption(s, `card:${inHand(s, 0, V4)}`), 'coût 4');
  s = choose(s, `card:${inHand(s, 0, V1)}`);
  assert.ok(ownChars(s, 0).includes(V1));
  assert.equal(s.players[0].chars.find((c) => c.uid === k)!.rested, true);
});

test('Crocodile (OP01-062, Leader) : [DON!! x1] après un Événement, piocher s’il a 4 cartes ou moins, une fois par tour', () => {
  // Round Table : −10000 à un Personnage adverse (sa question d'abord), puis la pioche
  const s0 = (hand: string[], don = 1) => scene([deck('OP01-062'), OPP()], (g) => { g.players[0].leader.don = don; g.players[0].donDeck -= don; setHand(g, 0, hand); setDon(g, 0, 8); setChars(g, 1, [{ num: V3 }]); });
  const play27 = (s: GameState) => { s = play(s, 'OP01-027'); return tag(s) === 'oppPower' ? choose(s, `card:${charUid(s, 1, V3)}`) : s; };
  let s = play27(s0(['OP01-027', 'OP01-027', V1, V1]));
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.equal(s.players[0].hand.length, 4);
  s = play27(s);
  assert.equal(s.decision?.kind, 'main', 'déjà pioché ce tour-ci');
  // 5 cartes après l'Événement : rien (Q&A)
  s = play27(s0(['OP01-027', V1, V1, V3, V3, V4]));
  assert.equal(s.decision?.kind, 'main');
  // refus : la limite n'est pas prise
  s = choose(play27(s0(['OP01-027', 'OP01-027', V1])), 'no');
  s = play27(s);
  assert.equal(tag(s), 'may');
  // sans DON!! donnée au Leader : rien
  s = play27(s0(['OP01-027', V1], 0));
  assert.equal(s.decision?.kind, 'main');
});

test('Arlong (OP01-063) : [DON!! x1] s’épuiser : un Événement révélé dans la main adverse, la Vie du dessus sous son deck', () => {
  const s0 = (oppHand: string[], don = 1) => scene([deck('OP01-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP01-063', extra: { don } }]); setDon(g, 0, 0);
    setHand(g, 1, oppHand); setLife(g, 1, [V3, V4]);
  });
  let s = s0(['OP01-029']);
  const a = charUid(s, 0, 'OP01-063');
  s = act(s, `act:${a}`);
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.equal(s.players[1].life.length, 1);
  assert.equal(s.players[1].deck.at(-1)!.num, V3);
  assert.ok(knows(s, 0, s.players[1].hand[0].uid));
  coherent(s);
  s = act(s0([V1]), `act:${a}`);
  assert.equal(s.decision?.kind, 'main', 'pas un Événement');
  assert.equal(s.players[1].life.length, 2);
  s = s0(['OP01-029'], 0);
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP01-063')}`), 'sans DON!!');
});

test('Crocodile (OP01-067) : [DON!! x1] Événements bleus de la main −1, jamais moins de 0 (Q&A)', () => {
  const s = scene([deck('OP01-001'), OPP()], (g) => {
    setChars(g, 0, [{ num: 'OP01-067', extra: { don: 1 } }, { num: 'OP01-067', extra: { don: 1 } }, { num: 'OP01-067' }]); setDon(g, 0, 0);
    setHand(g, 0, ['OP01-089', 'OP01-088', 'OP01-029']);
  });
  assert.equal(handCost(s, 0, s.players[0].hand[0]), 1, 'coût 3, deux Crocodile avec DON!!');
  assert.equal(handCost(s, 0, s.players[0].hand[1]), 0, 'coût 1 : 0, pas moins');
  assert.equal(handCost(s, 0, s.players[0].hand[2]), 1, 'rouge');
});

test('Caesar Clown (OP01-069) : [En cas de KO] un [Smiley] joué de son deck, puis le deck mélangé', () => {
  let s = scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP01-069' }]); });
  s = runOn(s, (g) => { removeByEffect(ctxOf(g, 1, 'OP01-027'), charUid(g, 0, 'OP01-069'), 'ko'); });
  assert.equal(tag(s), 'playFree');
  s = choose(s, (o) => o.num === 'OP01-072');
  assert.ok(ownChars(s, 0).includes('OP01-072'));
  assert.ok(logHas(s, 'mélange son deck'));
  coherent(s);
});

test('Pacifista (OP01-075) : autant d’exemplaires qu’on veut', () => {
  const copies = (e: string[]) => e.filter((x) => x.includes('exemplaires'));
  assert.deepEqual(copies(playableErrors('OP01-060', { 'OP01-075': 10, 'OP01-070': 4 })), []);
  assert.equal(copies(playableErrors('OP01-060', { 'OP01-075': 4, 'OP01-070': 5 })).length, 1);
  assert.ok(def('OP01-075').keywords.includes('Blocker'));
});

test('Mr.3 (OP01-085) : [Jouée] avec un Leader {Baroque Works}, un Personnage adverse de coût 4 ou moins ne peut pas attaquer', () => {
  const s0 = (leader: string) => scene([deck(leader), OPP()], (g) => { setHand(g, 0, ['OP01-085']); setDon(g, 0, 5); setChars(g, 1, [{ num: V4 }, { num: G5 }]); });
  let s = play(s0('OP01-062'), 'OP01-085');
  assert.equal(tag(s), 'oppLock');
  assert.ok(!hasOption(s, `card:${charUid(s, 1, G5)}`), 'coût 5');
  const u = charUid(s, 1, V4);
  s = choose(s, `card:${u}`);
  assert.ok(s.mods.some((m) => m.uid === u && m.stat === 'cantAttack' && m.until === s.turn + 1));
  s = play(s0('OP01-001'), 'OP01-085');
  assert.equal(s.decision?.kind, 'main', 'autre Leader');
});

test('Kurozumi Orochi (OP01-098) : [Jouée] une [Artificial Devil Fruit SMILE] du deck en main, puis le deck mélangé', () => {
  let s = play(scene([deck('OP01-001'), OPP()], (g) => { setHand(g, 0, ['OP01-098']); setDon(g, 0, 5); }), 'OP01-098');
  assert.equal(tag(s), 'pick');
  s = choose(s, (o) => o.num === 'OP01-116');
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP01-116'));
  assert.ok(knows(s, 1, s.players[0].hand.find((c) => c.num === 'OP01-116')!.uid), 'révélée');
  assert.ok(logHas(s, 'mélange son deck'));
  coherent(s);
});

test('Kurozumi Semimaru (OP01-099, en doute) : ses autres Personnages {Kurozumi Clan} pas mis KO en combat', () => {
  const s0 = (target: string) => {
    let s = scene([deck('OP01-001'), OPP()], (g) => {
      setChars(g, 0, [{ num: 'OP01-099', extra: { rested: true } }, { num: 'OP01-100', extra: { rested: true } }]); setHand(g, 0, []);
      setChars(g, 1, [{ num: V4 }]);
    }, 1);
    s = attack(s, charUid(s, 1, V4), charUid(s, 0, target));
    return passes(s, 0);
  };
  assert.ok(ownChars(s0('OP01-100'), 0).includes('OP01-100'));
  assert.ok(!ownChars(s0('OP01-099'), 0).includes('OP01-099'), 'lui-même : KO');
});

test('Bao Huang (OP01-105) : [Jouée] 2 cartes de la main adverse révélées ensemble', () => {
  const s = play(scene([deck('OP01-001'), OPP()], (g) => { setHand(g, 0, ['OP01-105']); setDon(g, 0, 5); setHand(g, 1, [V1, V3, V4]); }), 'OP01-105');
  assert.equal(s.players[1].hand.filter((c) => knows(s, 0, c.uid)).length, 2);
});

test('Holedem (OP01-113) : [En cas de KO] jusqu’à 1 DON!! épuisée : on peut refuser (Q&A)', () => {
  const s0 = scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, [{ num: 'OP01-113' }]); setDon(g, 0, 2); });
  let s = runOn(s0, (g) => { removeByEffect(ctxOf(g, 1, 'OP01-027'), charUid(g, 0, 'OP01-113'), 'ko'); });
  assert.equal(tag(s), 'may');
  const deckDon = s.players[0].donDeck;
  assert.equal(choose(s, 'no').players[0].donDeck, deckDon);
  s = choose(s, 'yes');
  assert.equal(s.players[0].donRested, 1);
  assert.equal(s.players[0].donDeck, deckDon - 1);
});

test('Trafalgar Law (OP01-047) : coût par un effet : Enel (OP05-100) remplacé, le coût n’est pas payé et rien n’est joué (Q&A)', () => {
  const s0 = () => scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, [{ num: ENEL }]); setHand(g, 0, ['OP01-047', V1]); setDon(g, 0, 5); setLife(g, 0, [V3, V3]); });
  let s = play(s0(), 'OP01-047');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  s = choose(s, `card:${charUid(s, 0, ENEL)}`);
  assert.equal(tag(s), 'replace');
  const kept = choose(s, 'yes');
  assert.ok(ownChars(kept, 0).includes(ENEL));
  assert.equal(kept.players[0].life.length, 1);
  assert.equal(kept.decision?.kind, 'main', 'rien n’est joué');
  s = choose(s, 'no');
  assert.equal(tag(s), 'playFree');
  s = choose(s, `card:${inHand(s, 0, V1)}`);
  assert.ok(ownChars(s, 0).includes(V1) && s.players[0].hand.some((c) => c.num === ENEL));
  coherent(s);
});

test('Kaido (OP01-094) : tous les KO dans un même effet : Sabo (OP05-001) tous ou aucun, Rosinante (OP05-030) les sauve tous (Q&A)', () => {
  const s0 = (oppLeader: string, opp: { num: string; extra?: object }[]) => scene([deck('OP01-061'), deck(oppLeader)], (g) => {
    setChars(g, 0, [{ num: V1 }]); setHand(g, 0, ['OP01-094']); setDon(g, 0, 10);
    setChars(g, 1, opp); g.players[1].leader.don = 1; g.players[1].donDeck -= 1;
  });
  let s = play(s0(SABO, [{ num: V3 }, { num: V4 }]), 'OP01-094');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.equal(tag(s), 'replace');
  const yes = choose(s, 'yes');
  assert.deepEqual(ownChars(yes, 1).sort(), [V3, V4].sort(), 'les deux restent, une seule question');
  assert.deepEqual(ownChars(yes, 0), ['OP01-094'], 'les siens aussi, sauf lui');
  const no = choose(s, 'no');
  assert.equal(no.players[1].chars.length, 0);
  // Rosinante redressée, avec 2 Personnages épuisés : sa mise en Défausse sauve les deux (Q&A)
  s = choose(play(s0('OP05-002', [{ num: ROSI }, { num: V3, extra: { rested: true } }, { num: V4, extra: { rested: true } }]), 'OP01-094'), 'yes');
  assert.equal(tag(s), 'replace');
  s = choose(s, (o) => o.id !== 'none' && o.id !== 'no');
  assert.deepEqual(ownChars(s, 1).sort(), [V3, V4].sort());
  assert.ok(s.players[1].trash.some((c) => c.num === ROSI));
  coherent(s);
  // sans Leader {Animal Kingdom Pirates} : DON!! −6 payable, rien ensuite (Q&A)
  s = choose(play(scene([deck('OP01-001'), OPP()], (g) => { setHand(g, 0, ['OP01-094']); setDon(g, 0, 10); setChars(g, 1, [{ num: V3 }]); }), 'OP01-094'), 'yes');
  assert.ok(ownChars(s, 1).includes(V3));
});

test('King (OP01-096) : DON!! −2 : un coût 3 ou moins et un autre coût 2 ou moins, KO ensemble ; une seule cible possible (Q&A)', () => {
  const s0 = (opp: { num: string; extra?: object }[]) => scene([deck('OP01-061'), deck('OP05-002')], (g) => { setHand(g, 0, ['OP01-096']); setDon(g, 0, 7); setChars(g, 1, opp); });
  let s = choose(play(s0([{ num: V1 }, { num: V3 }, { num: V4 }]), 'OP01-096'), 'yes');
  assert.equal(tag(s), 'oppKo');
  assert.ok(!hasOption(s, `card:${charUid(s, 1, V4)}`), 'coût 4');
  s = choose(s, `card:${charUid(s, 1, V3)}`);
  assert.ok(!hasOption(s, `card:${charUid(s, 1, V3)}`), 'une autre carte');
  s = choose(s, `card:${charUid(s, 1, V1)}`);
  assert.deepEqual(ownChars(s, 1), [V4]);
  // Rosinante (redressée) et un Personnage épuisé : son remplacement est proposé avant son propre KO
  s = choose(play(s0([{ num: ROSI }, { num: V1, extra: { rested: true } }]), 'OP01-096'), 'yes');
  s = choose(s, `card:${charUid(s, 1, ROSI)}`);
  s = choose(s, `card:${charUid(s, 1, V1)}`);
  assert.equal(tag(s), 'replace');
  s = choose(s, (o) => o.id !== 'none' && o.id !== 'no');
  assert.deepEqual(ownChars(s, 1), [V1]);
  coherent(s);
});

test('Kaido (OP01-061, Leader) : [DON!! x1] [Votre tour] [Une fois par tour] un Personnage adverse mis KO : 1 DON!! redressée', () => {
  const s0 = (don: number, active: PlayerId = 0) => scene([deck('OP01-061'), OPP()], (g) => { g.players[0].leader.don = don; setDon(g, 0, 0); setChars(g, 1, [{ num: V1 }, { num: V3 }]); }, active);
  const koOpp = (s: GameState, num: string) => runOn(s, (g) => { removeByEffect(ctxOf(g, 0, 'OP01-027'), charUid(g, 1, num), 'ko'); });
  let s = koOpp(s0(1), V1);
  assert.equal(s.players[0].donActive, 1);
  s = koOpp(s, V3);
  assert.equal(s.players[0].donActive, 1, 'une fois par tour');
  assert.equal(koOpp(s0(0), V1).players[0].donActive, 0, 'sans DON!!');
  assert.equal(koOpp(s0(1, 1), V1).players[0].donActive, 0, 'tour adverse');
});

test('Shachi (OP01-044) : sans [Penguin], jouer un [Penguin] de la main (pas « Shachi & Penguin » : Q&A)', () => {
  const s0 = (chars: string[]) => scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 0, chars.map((num) => ({ num }))); setHand(g, 0, ['OP01-044', 'OP01-050', 'ST10-008']); setDon(g, 0, 5); });
  let s = play(s0([]), 'OP01-044');
  assert.equal(tag(s), 'playFree');
  assert.ok(!hasOption(s, `card:${inHand(s, 0, 'ST10-008')}`));
  s = choose(s, `card:${inHand(s, 0, 'OP01-050')}`);
  assert.ok(ownChars(s, 0).includes('OP01-050'));
  s = play(s0(['OP01-050']), 'OP01-044');
  assert.equal(s.decision?.kind, 'main', 'déjà un [Penguin]');
});

test('Cavendish (OP01-008) : coût « 1 carte de la Vie en main » : celle du dessus (règle 3-10-2), puis [Initiative]', () => {
  let s = play(scene([deck('OP01-001'), OPP()], (g) => { setHand(g, 0, ['OP01-008']); setDon(g, 0, 5); setLife(g, 0, [V1, V3]); }), 'OP01-008');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.ok(s.players[0].hand.some((c) => c.num === V1));
  assert.equal(s.players[0].life[0].num, V3);
  const u = charUid(s, 0, 'OP01-008');
  assert.ok(hasKeyword(s, 0, s.players[0].chars.find((c) => c.uid === u)!, 'Rush'));
});

// ---------- Recettes que le banc ne sait pas mesurer ([Contre] pour la carte attaquée, [Déclenchement]) ----------

test('[Contre] des recettes d’OP01 : gain de la carte attaquée, puis la suite', () => {
  const s0 = (hand: string[], life = 3) => scene([deck('OP01-001'), OPP()], (g) => {
    setHand(g, 0, hand); setDon(g, 0, 4); setLife(g, 0, Array(life).fill(V1));
    setChars(g, 0, [{ num: V3, extra: { rested: true } }]);
    setChars(g, 1, [{ num: V1 }, { num: V4, extra: { rested: true } }]);
  }, 1);
  // Red Hawk : +4000, puis KO d'un Personnage adverse de 4000 ou moins
  let r = counterGain(s0(['OP01-026']), 'OP01-026', (s) => (tag(s) === 'oppKo' ? choose(s, `card:${charUid(s, 1, V1)}`) : s));
  assert.equal(r.gain, 4000);
  assert.ok(!ownChars(r.s, 1).includes(V1));
  // Paradise Waterfall : +2000, puis un de ses Personnages redressé
  r = counterGain(s0(['OP01-057']), 'OP01-057', (s) => (tag(s) ? choose(s, `card:${charUid(s, 0, V3)}`) : s));
  assert.equal(r.gain, 2000);
  assert.equal(r.s.players[0].chars[0].rested, false);
  // Punk Gibson : +4000, puis un Personnage adverse de coût 4 ou moins épuisé
  r = counterGain(s0(['OP01-058']), 'OP01-058', (s) => (tag(s) === 'oppRest' ? choose(s, `card:${charUid(s, 1, V1)}`) : s));
  assert.equal(r.gain, 4000);
  assert.ok(r.s.players[1].chars.find((c) => c.num === V1)!.rested);
  // Overheat : +4000, puis un Personnage redressé de coût 3 ou moins renvoyé en main (pas un épuisé)
  r = counterGain(s0(['OP01-086']), 'OP01-086', (s) => {
    if (tag(s) !== 'bounce') return s;
    assert.ok(!hasOption(s, `card:${charUid(s, 1, V4)}`));
    return choose(s, `card:${charUid(s, 1, V1)}`);
  });
  assert.equal(r.gain, 4000);
  assert.ok(r.s.players[1].hand.some((c) => c.num === V1));
  // Desert Spada : +2000, puis les 3 cartes du dessus toutes au-dessus ou toutes au-dessous (Q&A)
  r = counterGain(s0(['OP01-088']), 'OP01-088', (s) => { while (s.decision && s.decision.player === 0 && s.decision.inEffect) s = act(s, s.decision.options[0].id); return s; });
  assert.equal(r.gain, 2000);
  // Ulti-Mortar : DON!! −2 : +2000, puis piocher 1 carte (obligatoire : Q&A)
  r = counterGain(s0(['OP01-118']), 'OP01-118', (s) => (tag(s) === 'may' ? choose(s, 'yes') : s));
  assert.equal(r.gain, 2000);
  assert.ok(logHas(r.s, 'pioche 1 carte') || r.s.players[0].hand.length === 1);
  // Thunder Bagua : +4000, puis avec 2 Vies ou moins, 1 DON!! épuisée
  for (const [life, don] of [[3, 0], [2, 1]] as const) {
    const s = s0(['OP01-119'], life);
    const deckDon = s.players[0].donDeck;
    r = counterGain(s, 'OP01-119');
    assert.equal(r.gain, 4000);
    assert.equal(deckDon - r.s.players[0].donDeck, don, `${life} Vies`);
  }
});

test('[Déclenchement] des recettes d’OP01 (Paradise Waterfall, Overheat)', () => {
  const s0 = scene([deck('OP01-001'), OPP()], (g) => { setChars(g, 1, [{ num: V4, extra: { rested: true } }, { num: V1 }]); });
  let s = runOn(s0, (g) => def('OP01-057').onTrigger!(ctxOf(g, 0, 'OP01-057', [`card:${charUid(g, 1, V4)}`])));
  assert.ok(!ownChars(s, 1).includes(V4), 'KO d’un épuisé de coût 4 ou moins');
  s = runOn(s0, (g) => def('OP01-086').onTrigger!(ctxOf(g, 0, 'OP01-086', [`card:${charUid(g, 1, V4)}`])));
  assert.ok(s.players[1].hand.some((c) => c.num === V4), 'renvoyé en main, coût 4');
});
