// OP08 et ST14 (tâche S11) : un test par effet des cartes codées à la main (condition vraie et fausse), les réponses des
// Q&A officielles, et les recettes que le banc d'essai ne sait pas mesurer ([Contre] « pendant ce combat », coût « épuisez
// ce Lieu », [Déclenchement], [En attaquant] qui change l'issue du combat, cible mise KO après une baisse : 01-contrats.md
// § 15.4). Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import type { DeckList } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { fieldCost, koCharacter, power } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { viewFor } from '../engine/view.ts';
import { charUid, counterGain, leaderUid, list, oppLeaderDon, scene } from './eb-scene.ts';
import { attack, choose, hasOption, keepOrder, logHas, play, setChars, setDeckTop, setDon, setHand, setLife } from './helpers.ts';

const F = 'ST-21';      // deck d'appoint
const OPP = 'ST-21';
const CHOPPER_L = 'OP08-001';
const MINKS_L = 'OP08-021';
const AKP_L = 'OP08-057';
const BIG_MOM_L = 'OP08-058';
const SHANDIAN_L = 'OP08-098';
const KUJA_L = 'OP14-041';
const LUFFY_L = 'ST14-001';
const NEUTRAL_L = 'ST21-001';
const BIG = 'ST14-012';   // Personnage de coût 8
const yes = (s: GameState) => choose(s, 'yes');
const no = (s: GameState) => choose(s, 'no');
const stageOf = (g: GameState, p: PlayerId, num: string) => { g.players[p].stage = { uid: 9000 + p, num, rested: false, don: 0, playedTurn: 0, usedOpt: [] }; };

// Répond « non » aux [Bloqueur], passe les [Contre] et garde les cartes de Vie en main tant que c'est au joueur `p`
function passAll(s: GameState, p: PlayerId): GameState {
  for (let i = 0; i < 20 && s.decision?.player === p; i++) {
    const d = s.decision;
    if (d.kind === 'blocker') s = choose(s, 'noblock');
    else if (d.kind === 'counter') s = act(s, 'pass');
    else if (d.tag === 'trigger') s = choose(s, 'hand');
    else break;
  }
  return s;
}

// [Déclenchement] de la carte du dessus de ma Vie, révélée par une attaque du Leader adverse
function triggerFromLife(me: DeckList, top: string, extra: (g: GameState) => void, opp: DeckList | string = OPP): GameState {
  let s = scene([me, opp], (g) => {
    setLife(g, 0, [top, ...g.players[0].life.slice(1).map((c) => c.num)]);
    oppLeaderDon(g, 3);
    extra(g);
  }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.equal(s.decision?.tag, 'trigger', `[Déclenchement] attendu (${s.decision?.prompt})`);
  return choose(s, 'trigger');
}

test('OP08 et ST14 : toutes les cartes jouables ou en doute ; seule OP08-046 est en doute', () => {
  const op = Object.keys(CARDS).filter((num) => num.startsWith('OP08-'));
  const st = Object.keys(CARDS).filter((num) => num.startsWith('ST14-'));
  assert.equal(op.length, 119);
  assert.equal(st.length, 17);
  const all = [...op, ...st];
  assert.deepEqual(all.filter((num) => !['verified', 'coded', 'auto', 'doubt'].includes(confidence(num))), []);
  assert.deepEqual(all.filter((num) => confidence(num) === 'doubt'), ['OP08-046']);
});

test('Chopper (Leader OP08-001) : 1 DON!! épuisée à chacun de jusqu’à 3 Personnages {Animal} ou {Drum Kingdom}, une fois par tour', () => {
  const at = (rested: number) => scene([list(CHOPPER_L, ['OP08-009', 'OP08-003'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-009' }, { num: 'OP08-003' }, { num: 'ST21-008' }, { num: 'ST21-005' }]);
    setDon(g, 0, 0, rested);
  });
  let s = at(5);
  const lead = leaderUid(s, 0);
  s = act(s, `act:${lead}`);
  // pas de Personnage hors type ; chacun une fois seulement (Q&A : pas 2 DON!! à la même carte)
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 0, 'ST21-005')));
  for (const n of ['OP08-009', 'OP08-003', 'ST21-008']) s = choose(s, (o) => o.uid === charUid(s, 0, n));
  for (const c of s.players[0].chars) assert.equal(c.don, c.num === 'ST21-005' ? 0 : 1);
  assert.equal(s.players[0].donRested, 2);
  assert.ok(!hasOption(s, `act:${lead}`));
  // moins de DON!! que de cibles : pas plus de choix que de DON!!
  s = at(1);
  s = act(s, `act:${leaderUid(s, 0)}`);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP08-009'));
  assert.equal(s.players[0].donRested, 0);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].chars.reduce((n, c) => n + c.don, 0), 1);
  // aucune DON!! épuisée : rien ne se passe
  s = at(0);
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].chars.reduce((n, c) => n + c.don, 0), 0);
});

test('Kuromarimo et Chess (OP08-004, 005) : condition sur l’autre, -2000 appliqué même si Kuromarimo met ensuite la cible KO', () => {
  const me = list(NEUTRAL_L, ['OP08-004', 'OP08-005'], F);
  // Chess : -2000 puis Kuromarimo de la main ; Kuromarimo met KO (avec Chess sur le terrain) une cible de 3000 ou moins
  let s = scene([me, OPP], (g) => {
    setChars(g, 1, [{ num: 'ST21-014' }]);
    setHand(g, 0, ['OP08-005', 'OP08-004']);
    setDon(g, 0, 10);
  });
  s = play(s, 'OP08-005');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-014'));
  assert.equal(power(s, charUid(s, 1, 'ST21-014')), 4000);
  s = choose(s, (o) => o.num === 'OP08-004' || /card:/.test(o.id));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP08-004'));
  assert.equal(s.players[0].hand.length, 0);
  // avec déjà un Kuromarimo : on ne joue pas le second
  s = scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-004' }]);
    setHand(g, 0, ['OP08-005', 'OP08-004']);
    setDon(g, 0, 10);
  });
  s = play(s, 'OP08-005');
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].hand.length, 1);
  // Kuromarimo sans Chess : pas de KO
  s = scene([me, OPP], (g) => {
    setChars(g, 1, [{ num: 'ST21-013' }]);
    setHand(g, 0, ['OP08-004']);
    setDon(g, 0, 10);
  });
  s = play(s, 'OP08-004');
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[1].chars.length, 1);
});

test('Chessmarimo (OP08-006) : [Votre tour] +2000 avec [Kuromarimo] et [Chess] dans la Défausse (Q&A : un autre Chessmarimo ne compte pas)', () => {
  const at = (trash: string[], active: PlayerId = 0) => {
    const s = scene([list(NEUTRAL_L, ['OP08-006', 'OP08-004', 'OP08-005'], F), OPP], (g) => {
      setChars(g, 0, [{ num: 'OP08-006' }]);
      g.players[0].trash = trash.map((num, i) => ({ uid: 8000 + i, num }));
    }, active);
    return power(s, charUid(s, 0, 'OP08-006'));
  };
  assert.equal(at(['OP08-004', 'OP08-005']), 8000);
  assert.equal(at(['OP08-004', 'OP08-006']), 6000);
  assert.equal(at(['OP08-005']), 6000);
  assert.equal(at(['OP08-004', 'OP08-005'], 1), 6000);
});

test('Hiriluk (OP08-016) : tous les [Tony Tony.Chopper] +2000 seulement avec ce Leader ; Dalton (OP08-008) : Vie pour [Initiative]', () => {
  const at = (leader: string) => scene([list(leader, ['OP08-016', 'OP08-007'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-016' }, { num: 'OP08-007' }, { num: 'ST21-005' }]);
  });
  let s = at(CHOPPER_L);
  s = act(s, `act:${charUid(s, 0, 'OP08-016')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  assert.ok(s.players[0].chars.find((c) => c.num === 'OP08-016')!.rested);
  assert.equal(power(s, charUid(s, 0, 'OP08-007')), CARDS['OP08-007'].power! + 2000);
  assert.equal(power(s, charUid(s, 0, 'ST21-005')), 4000);
  // autre Leader : le coût payé ne donne rien (activer, c'est payer)
  s = at(NEUTRAL_L);
  s = act(s, `act:${charUid(s, 0, 'OP08-016')}`);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(power(s, charUid(s, 0, 'OP08-007')), CARDS['OP08-007'].power!);
});

test('I’d Never Shoot You (OP08-017) : [Contre] +4000 pour le combat puis −1000 pour le tour ; [Déclenchement] +1000', () => {
  const me = list(NEUTRAL_L, ['OP08-017'], F);
  let { s, gain } = counterGain(scene([me, OPP], (g) => {
    setHand(g, 0, ['OP08-017']);
    setDon(g, 0, 10);
    oppLeaderDon(g, 1);
  }, 1), 'OP08-017', (g) => choose(g, (o) => o.uid === leaderUid(g, 1)));   // le +4000 va à la carte attaquée (n° 20)
  assert.equal(gain, 4000);
  assert.ok(logHas(s, /reçoit −1000/));
  s = triggerFromLife(me, 'OP08-017', () => {});
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  assert.ok(logHas(s, /\+1000/));
});

test('Munch-Munch Mutation (OP08-019) : +3000 même sans Personnage adverse (Q&A) ; [Déclenchement] KO de 5000 ou moins', () => {
  const me = list(NEUTRAL_L, ['OP08-019'], F);
  let s = scene([me, OPP], (g) => {
    setHand(g, 0, ['OP08-019']);
    setChars(g, 0, [{ num: 'ST21-005' }]);
    setChars(g, 1, []);
    setDon(g, 0, 10);
  });
  s = play(s, 'OP08-019');
  s = choose(s, (o) => o.uid === charUid(s, 0, 'ST21-005'));
  assert.equal(power(s, charUid(s, 0, 'ST21-005')), 7000);
  s = triggerFromLife(me, 'OP08-019', (g) => setChars(g, 1, [{ num: 'ST21-006' }, { num: 'ST21-014' }]));
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, 'ST21-014')), '6000 de puissance : non');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'ST21-006'));
});

test('Pekoms (OP08-029) : redressé, protège les {Minks} de coût 3 ou moins autres que [Pekoms] des effets (pas du combat)', () => {
  const at = (rested: boolean, target = 'OP08-035') => scene([list(NEUTRAL_L, ['OP08-029', 'OP08-035'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-029', extra: { rested } }, { num: target }]);
  });
  let s = at(false);
  assert.equal(koCharacter(s, charUid(s, 0, 'OP08-035'), 'effect', 1), false);
  s = at(false);
  assert.equal(koCharacter(s, charUid(s, 0, 'OP08-035'), 'effect', 0), false, 'ses propres effets aussi');
  s = at(true);
  assert.equal(koCharacter(s, charUid(s, 0, 'OP08-035'), 'effect', 1), true, 'épuisé : plus de protection');
  s = at(false);
  assert.equal(koCharacter(s, charUid(s, 0, 'OP08-035'), 'battle', 1), true, 'combat');
  s = at(false);
  assert.equal(koCharacter(s, charUid(s, 0, 'OP08-029'), 'effect', 1), true, 'pas lui-même');
  s = at(false, 'ST21-005');
  assert.equal(koCharacter(s, charUid(s, 0, 'ST21-005'), 'effect', 1), true, 'pas {Minks}');
});

test('Comrade (OP08-038) : les Personnages présents protégés des effets adverses jusqu’au prochain tour adverse, pas ceux joués ensuite (Q&A)', () => {
  const me = list(NEUTRAL_L, ['OP08-038', 'ST21-010'], F);
  let s = scene([me, OPP], (g) => {
    setHand(g, 0, ['OP08-038', 'ST21-010']);
    setChars(g, 0, [{ num: 'ST21-005' }, { num: 'ST21-006' }, { num: 'ST21-013' }]);
    setDon(g, 0, 10);
  });
  s = play(s, 'OP08-038');
  s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'ST21-005'));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'ST21-006'));
  assert.equal(s.players[0].chars.filter((c) => c.rested).length, 2);
  s = play(s, 'ST21-010');
  const copy = () => structuredClone(s);
  assert.equal(koCharacter(copy(), charUid(s, 0, 'ST21-013'), 'effect', 1), false, 'présent à la résolution');
  assert.equal(koCharacter(copy(), charUid(s, 0, 'ST21-013'), 'battle', 1), true, 'combat');
  assert.equal(koCharacter(copy(), charUid(s, 0, 'ST21-013'), 'effect', 0), true, 'ses propres effets');
  assert.equal(koCharacter(copy(), charUid(s, 0, 'ST21-010'), 'effect', 1), true, 'joué ensuite');
  // moins de 2 Personnages : pas de paiement possible
  s = scene([me, OPP], (g) => { setHand(g, 0, ['OP08-038']); setChars(g, 0, [{ num: 'ST21-005' }]); setDon(g, 0, 10); });
  s = play(s, 'OP08-038');
  assert.equal(s.decision?.kind, 'main');
  // [Déclenchement]
  s = triggerFromLife(me, 'OP08-038', (g) => setChars(g, 1, [{ num: 'ST21-006' }]));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.ok(s.players[1].chars[0].rested);
});

test('Zou (OP08-039) : épuiser le Lieu redresse 1 DON!! avec un Leader {Minks} ; [Fin de votre tour] redresse un {Minks}, quel que soit le Leader (Q&A)', () => {
  const at = (leader: string) => scene([list(leader, ['OP08-035'], F), OPP], (g) => {
    stageOf(g, 0, 'OP08-039');
    setChars(g, 0, [{ num: 'OP08-035', extra: { rested: true } }]);
    setDon(g, 0, 2, 2);
  });
  let s = at(MINKS_L);
  s = act(s, `act:${s.players[0].stage!.uid}`);
  if (s.decision?.tag === 'may') s = yes(s);
  assert.ok(s.players[0].stage!.rested);
  assert.equal(s.players[0].donActive, 3);
  s = at(NEUTRAL_L);
  s = act(s, 'end');
  if (s.decision?.player === 0 && s.decision.options.some((o) => o.uid === s.players[0].chars[0].uid)) s = choose(s, (o) => o.uid === s.players[0].chars[0].uid);
  assert.equal(s.players[0].chars[0].rested, false);
});

test('Aphelandra (OP08-041) : renvoi en main, puis sous le deck un coût 1 ou moins, seulement avec un Leader {Kuja Pirates}', () => {
  const at = (leader: string) => scene([list(leader, ['OP08-041'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-041' }]);
    setChars(g, 1, [{ num: 'ST21-013' }, { num: 'ST21-005' }]);
  });
  let s = at(KUJA_L);
  s = act(s, `act:${charUid(s, 0, 'OP08-041')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  assert.equal(s.players[0].chars.length, 0);
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP08-041'));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-013'));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'ST21-013'));
  // autre Leader : le coût payé ne donne rien
  s = at(NEUTRAL_L);
  s = act(s, `act:${charUid(s, 0, 'OP08-041')}`);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[1].chars.length, 2);
});

test('Weevil (OP08-042) : [DON!! x1] [En attaquant] renvoie en main un Personnage de coût 3 ou moins, de l’un ou l’autre camp', () => {
  const me = list(NEUTRAL_L, ['OP08-042'], F);
  const at = (don: number) => scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-042', extra: { don } }, { num: 'ST21-013' }]);
    setChars(g, 1, [{ num: 'ST21-006' }, { num: 'ST21-014' }]);
  });
  let s = at(1);
  s = attack(s, charUid(s, 0, 'OP08-042'), leaderUid(s, 1));
  assert.ok(s.decision!.options.some((o) => o.uid === charUid(s, 0, 'ST21-013')), 'les siens aussi');
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, 'ST21-014')), 'coût 5 : non');
  const hand = s.players[1].hand.length;
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.equal(s.players[1].hand.length, hand + 1);
  s = at(0);
  s = attack(s, charUid(s, 0, 'OP08-042'), leaderUid(s, 1));
  assert.notEqual(s.decision?.tag, 'bounce');
  assert.equal(s.players[1].chars.length, 2);
});

test('Shakuyaku (OP08-046, en doute mais prête) : retrait par son effet, 5 cartes en main adverse, puis elle s’épuise', () => {
  const at = (handOpp: string[], rested = false) => scene([list(KUJA_L, ['OP08-046', 'OP08-041'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-046', extra: { rested } }, { num: 'OP08-041' }]);
    setChars(g, 1, [{ num: 'ST21-013' }]);
    setHand(g, 1, handOpp);
  });
  const five = ['ST21-005', 'ST21-006', 'ST21-008', 'ST21-010', 'ST21-014'];
  let s = at(five);
  const before = s.players[1].deck.length;
  s = act(s, `act:${charUid(s, 0, 'OP08-041')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-013'));   // Aphelandra : sous le deck
  for (let i = 0; i < 5 && s.decision?.player === 1; i++) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[1].hand.length, 4);
  assert.ok(s.players[1].deck.length >= before + 1);
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP08-046')!.rested, true);
  // moins de 5 cartes : rien, le « Puis » compris (n° 3001)
  s = at(five.slice(0, 4));
  s = act(s, `act:${charUid(s, 0, 'OP08-041')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-013'));
  assert.equal(s.players[1].hand.length, 4);
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP08-046')!.rested, false);
  // déjà épuisée : l'effet joue quand même (Q&A)
  s = at(five, true);
  s = act(s, `act:${charUid(s, 0, 'OP08-041')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-013'));
  for (let i = 0; i < 5 && s.decision?.player === 1; i++) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[1].hand.length, 4);
});

test('King (Leader OP08-057) : DON!! −2, choix : piocher avec 5 cartes ou moins, ou −2 de coût', () => {
  const at = (hand: string[]) => scene([list(AKP_L, [], F), OPP], (g) => {
    setHand(g, 0, hand);
    setChars(g, 1, [{ num: 'ST21-006' }]);
    setDon(g, 0, 4);
  });
  let s = at(['ST21-005']);
  s = act(s, `act:${leaderUid(s, 0)}`);
  if (s.decision?.tag === 'may') s = yes(s);
  assert.equal(s.players[0].donActive, 2);
  const options = s.decision!.options.map((o) => o.id);
  assert.equal(options.length, 2);
  s = act(s, options[0]);
  assert.equal(s.players[0].hand.length, 2);
  s = at(['ST21-005']);
  s = act(s, `act:${leaderUid(s, 0)}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = act(s, s.decision!.options[1].id);
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.equal(fieldCost(s, charUid(s, 1, 'ST21-006')), 1);
});

test('Pudding (Leader OP08-058) : retourner 2 Vies du dessus pour 1 DON!! épuisée ; refusé si l’une est déjà face visible ou s’il n’y en a qu’une (Q&A)', () => {
  const at = (extra: (g: GameState) => void) => scene([list(BIG_MOM_L, [], F), OPP], (g) => { setDon(g, 0, 3); extra(g); });
  let s = at(() => {});
  const don = s.players[0].donRested;
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.equal(s.decision?.tag, 'may');
  s = yes(s);
  assert.ok(s.players[0].life[0].faceUp && s.players[0].life[1].faceUp);
  assert.ok(!s.players[0].life[2]?.faceUp);
  assert.equal(s.players[0].donRested, don + 1);
  s = at((g) => { g.players[0].life[1].faceUp = true; });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.notEqual(s.decision?.tag, 'may');
  s = at((g) => { g.players[0].life = g.players[0].life.slice(0, 1); });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.notEqual(s.decision?.tag, 'may');
});

test('Kaido (OP08-079) : sans « joué ce tour », rien après le coût, le « Puis » compris (Q&A) ; joué ce tour : Défausse et défausse adverse', () => {
  const at = (playedTurn: number) => scene([list(NEUTRAL_L, ['OP08-079'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-079', extra: { playedTurn } }]);
    setChars(g, 1, [{ num: 'ST21-014' }]);
    setHand(g, 0, ['ST21-005']);
    setHand(g, 1, ['ST21-006', 'ST21-008']);
  });
  let s = at(5);
  s = act(s, `act:${charUid(s, 0, 'OP08-079')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  while (s.decision?.player === 0 && s.decision.options.some((o) => s.players[0].hand.some((c) => c.uid === o.uid))) s = act(s, s.decision.options[0].id);
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-014'));
  assert.equal(s.players[1].chars.length, 0);
  assert.ok(s.players[1].trash.some((c) => c.num === 'ST21-014'));
  for (let i = 0; i < 3 && s.decision?.player === 1; i++) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[1].hand.length, 1);
  // un autre tour : le coût se paie, puis rien (Q&A) : ni Défausse du Personnage adverse, ni défausse adverse
  s = at(3);
  s = act(s, `act:${charUid(s, 0, 'OP08-079')}`);
  while (s.decision?.player === 0 && s.decision.options.some((o) => s.players[0].hand.some((c) => c.uid === o.uid))) s = act(s, s.decision.options[0].id);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.players[1].chars.length, 1);
  assert.equal(s.players[1].hand.length, 2);
});

test('People’s Dreams (OP08-096) : [Contre] +5000 si la carte du dessus a un coût de 6 ou plus ; [Déclenchement] Personnage noir de coût 3 ou moins', () => {
  const me = list(NEUTRAL_L, ['OP08-096', BIG, 'ST14-006'], F);
  const at = (top: string) => counterGain(scene([me, OPP], (g) => {
    setHand(g, 0, ['OP08-096']);
    setDeckTop(g, 0, [top]);
    setDon(g, 0, 10);
    oppLeaderDon(g, 1);
  }, 1), 'OP08-096', (x) => (x.decision?.player === 0 && x.decision.options.some((o) => o.uid === leaderUid(x, 0)) ? choose(x, (o) => o.uid === leaderUid(x, 0)) : x));
  let r = at(BIG);
  assert.equal(r.gain, 5000);
  assert.ok(r.s.players[0].trash.some((c) => c.num === BIG));
  r = at('ST21-005');
  assert.equal(r.gain, 0);
  assert.ok(r.s.players[0].trash.some((c) => c.num === 'ST21-005'));
  let s = triggerFromLife(me, 'OP08-096', (g) => { g.players[0].trash = [{ uid: 8000, num: 'ST14-006' }, { uid: 8001, num: 'ST21-005' }, { uid: 8002, num: BIG }]; });
  assert.equal(s.decision!.options.filter((o) => o.uid !== undefined).length, 1, 'ni autre couleur, ni coût 8');
  s = choose(s, (o) => o.uid === 8000);
  assert.ok(s.players[0].chars.some((c) => c.num === 'ST14-006'));
});

test('Héliceratops (OP08-097) : avec un Leader {Animal Kingdom Pirates}, −2 de coût puis KO de coût 0 ; sans lui, rien, le « Puis » compris (n° 3001) ; [Déclenchement]', () => {
  const at = (leader: string) => scene([list(leader, ['OP08-097'], F), OPP], (g) => {
    setHand(g, 0, ['OP08-097']);
    setChars(g, 1, [{ num: 'ST21-005' }, { num: 'ST21-006' }]);
    setDon(g, 0, 10);
  });
  let s = at(AKP_L);
  s = play(s, 'OP08-097');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'ST21-005'));
  s = at(NEUTRAL_L);
  s.players[1].chars[0].num = 'ST21-005';
  s.mods.push({ uid: s.players[1].chars[0].uid, stat: 'cost', amount: -2, until: 'turn', source: 'essai' });
  s = play(s, 'OP08-097');
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[1].chars.length, 2);
  s = triggerFromLife(list(NEUTRAL_L, ['OP08-097'], F), 'OP08-097', (g) => setChars(g, 1, [{ num: 'ST21-006' }, { num: 'ST21-014' }]));
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, 'ST21-014')));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'ST21-006'));
});

test('Kalgara (Leader OP08-098) : joue un {Shandian Warrior} de coût au plus ses DON!!, puis Vie en main ; sans Vie, joue quand même (Q&A)', () => {
  const me = list(SHANDIAN_L, ['OP15-103', 'OP08-099'], F);
  const at = (life: boolean) => scene([me, OPP], (g) => {
    g.players[0].leader.don = 1;
    setHand(g, 0, ['OP15-103', 'OP08-099']);
    setDon(g, 0, 3);
    if (!life) g.players[0].life = [];
  });
  let s = at(true);
  const lifeCount = s.players[0].life.length;
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  // 4 DON!! sur le terrain : le coût 3 oui, le coût 6 non
  const opts = s.decision!.options.filter((o) => o.uid !== undefined);
  assert.equal(opts.length, 1);
  s = act(s, opts[0].id);
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP15-103'));
  assert.equal(s.players[0].life.length, lifeCount - 1);
  s = at(false);
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = act(s, s.decision!.options.find((o) => o.uid !== undefined)!.id);
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP15-103'));
  // refus : pas de Vie prise
  s = at(true);
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = choose(s, 'none');
  assert.equal(s.players[0].life.length, lifeCount);
});

test('South Bird (OP08-100) : 7 cartes, joue jusqu’à 1 [Upper Yard] (le Lieu), le reste sous le deck', () => {
  const me = list(NEUTRAL_L, ['OP08-100', 'OP05-117'], F);
  const at = (top: string[]) => scene([me, OPP], (g) => { setHand(g, 0, ['OP08-100']); setDeckTop(g, 0, top); setDon(g, 0, 10); });
  let s = at(['ST21-005', 'OP05-117', 'ST21-006']);
  const deck = s.players[0].deck.length;
  s = play(s, 'OP08-100');
  assert.equal(s.decision?.tag, 'playFree');
  s = choose(s, (o) => o.num === 'OP05-117');
  for (let i = 0; i < 20 && s.decision?.tag === 'bottomOrder'; i++) s = keepOrder(s) === s ? choose(s, () => true) : keepOrder(s);
  assert.equal(s.players[0].stage?.num, 'OP05-117');
  assert.equal(s.players[0].deck.length, deck - 1);
  s = at(['ST21-005', 'ST21-006']);
  s = play(s, 'OP08-100');
  assert.notEqual(s.decision?.tag, 'playFree');
  for (let i = 0; i < 20 && s.decision?.tag === 'bottomOrder'; i++) s = keepOrder(s) === s ? choose(s, () => true) : keepOrder(s);
  assert.equal(s.players[0].stage, null);
  assert.equal(s.players[0].deck.length, deck);
});

test('Angel (OP08-101) : Vie dans la Défausse, à la fin du tour la carte du dessus du deck dans la Vie, même si elle a quitté le terrain ; Leader exigé', () => {
  const at = (leader: string) => scene([list(leader, ['OP08-101', BIG], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-101' }]);
    setLife(g, 0, ['ST21-005', 'ST21-006']);
    setDeckTop(g, 0, [BIG]);
  });
  let s = at(BIG_MOM_L);
  const u = charUid(s, 0, 'OP08-101');
  s = act(s, `act:${u}`);
  if (s.decision?.tag === 'may') s = yes(s);
  assert.equal(s.players[0].life.length, 1);
  assert.ok(s.players[0].trash.some((c) => c.num === 'ST21-005'));
  assert.ok(!hasOption(s, `act:${u}`), 'une fois par tour');
  s.players[0].chars = [];   // quitte le terrain : l'effet différé reste
  s = act(s, 'end');
  assert.equal(s.players[0].life.length, 2);
  assert.equal(s.players[0].life[0].num, BIG);
  s = at(NEUTRAL_L);
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP08-101')}`));
});

test('Opera (OP08-102) : KO d’un coût au plus égal à sa Vie, lue à la résolution', () => {
  const me = list(NEUTRAL_L, ['OP08-102'], F);
  const at = (life: string[]) => scene([me, OPP], (g) => {
    setHand(g, 0, ['OP08-102', 'ST21-005']);
    setLife(g, 0, life);
    setChars(g, 1, [{ num: 'ST21-013' }, { num: 'ST21-006' }]);
    setDon(g, 0, 10);
  });
  let s = at(['ST21-008', 'ST21-010']);
  s = play(s, 'OP08-102');
  s = yes(s);
  while (s.decision?.options.some((o) => s.players[0].hand.some((c) => c.uid === o.uid))) s = act(s, s.decision.options[0].id);
  assert.ok(s.decision!.options.some((o) => o.uid === charUid(s, 1, 'ST21-013')));
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, 'ST21-006')));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-013'));
  assert.equal(s.players[1].chars.length, 1);
});

test('Bonney (OP08-105) : [DON!! x1] [Votre tour] une fois par tour, quand une carte quitte la Vie adverse (Q&A : toute cause, même ajout ensuite)', () => {
  const me = list(NEUTRAL_L, ['OP08-105'], F);
  const at = (don: number, active: PlayerId = 0) => scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-105', extra: { don } }, { num: 'ST21-014' }]);
    setHand(g, 0, ['ST21-005']);
    setChars(g, 1, []);
    setLife(g, 1, ['ST21-006', 'ST21-008', 'ST21-010']);
    g.players[0].leader.don = 1;
    if (active === 1) oppLeaderDon(g, 3);
  }, active);
  // dégâts sur la Vie adverse : pioche 2, défausse 1
  let s = at(1);
  const hand = s.players[0].hand.length;
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = passAll(s, 1);
  assert.equal(s.decision?.player, 0);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, hand + 1);
  // une seule fois par tour
  s = attack(s, charUid(s, 0, 'ST21-014'), leaderUid(s, 1));
  s = passAll(s, 1);
  assert.equal(s.players[0].hand.length, hand + 1);
  // sans DON!! : rien
  s = at(0);
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = passAll(s, 1);
  assert.equal(s.players[0].hand.length, hand);
  // ma propre Vie qui part : rien
  s = at(1);
  s.players[0].life.shift();
  s = act(s, 'end');
  assert.equal(s.players[0].hand.length, hand);
  // au tour adverse : seule la carte de Vie arrive en main
  s = at(1, 1);
  s.players[1].life.shift();
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = passAll(s, 0);
  assert.equal(s.players[0].hand.length, hand + 1);
});

test('Bonney (OP08-105) : un même effet qui retire une carte de Vie puis en ajoute une est vu (Q&A), réordonner non ; l’identifiant ne sort pas de la vue', () => {
  const me = list(NEUTRAL_L, ['OP08-105'], F);
  const base = () => scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-105', extra: { don: 1 } }]);
    setLife(g, 1, ['ST21-006', 'ST21-008', 'ST21-010']);
  });
  // la Vie adverse est changée directement, puis la décision suivante relance la boucle du moteur (lifeWatch)
  let s = base();
  assert.ok(s.lifeSeen);
  assert.equal(viewFor(s, 1).lifeSeen, undefined);
  const hand = s.players[0].hand.length;
  const L = s.players[1].life;
  const gone = L.shift()!;
  s.players[1].hand.push(gone);
  L.unshift(s.players[1].deck.shift()!);
  s = act(s, 'end');
  assert.ok(s.players[0].hand.length >= hand + 1, 'l’effet s’est déclenché');
  s = base();
  s.players[1].life.reverse();
  const h2 = s.players[0].hand.length;
  s = act(s, 'end');
  assert.equal(s.players[0].hand.length, h2, 'réordonner ne déclenche rien');
});

test('Bonney (OP08-105) : le [Déclenchement] adverse se résout d’abord, puis son effet (Q&A)', () => {
  const me = list(NEUTRAL_L, ['OP08-105'], F);
  let s = scene([me, list(NEUTRAL_L, ['OP08-017'], F)], (g) => {
    setChars(g, 0, [{ num: 'OP08-105', extra: { don: 1 } }]);
    setLife(g, 1, ['OP08-017', 'ST21-008']);
    g.players[0].leader.don = 1;
  });
  const hand = s.players[0].hand.length;
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.equal(s.decision?.tag, 'trigger');
  s = choose(s, 'trigger');
  assert.equal(s.players[0].hand.length, hand, 'pas encore de pioche');
  assert.equal(s.decision?.player, 1);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.decision?.player, 0);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, hand + 1);
});

test('Noland (OP08-109) : {Shandian Warrior} et un Personnage [Kalgara] (pas le Leader) pour la Vie', () => {
  const at = (chars: { num: string }[]) => scene([list(SHANDIAN_L, ['OP08-109', 'OP08-099'], F), OPP], (g) => {
    setHand(g, 0, ['OP08-109']); setChars(g, 0, chars); setDon(g, 0, 10);
  });
  let s = at([{ num: 'OP08-099' }]);
  const life = s.players[0].life.length;
  s = play(s, 'OP08-109');
  if (s.decision?.tag === 'may') s = yes(s);
  else if (s.decision?.kind !== 'main') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].life.length, life + 1);
  s = at([]);
  s = play(s, 'OP08-109');
  assert.equal(s.players[0].life.length, life);
});

test('Wiper (OP08-110) : 5 cartes : 1 [Upper Yard] en main, le reste sous le deck, puis joue un [Upper Yard] de sa main', () => {
  const me = list(SHANDIAN_L, ['OP08-110', 'OP05-117'], F);
  let s = scene([me, OPP], (g) => { setHand(g, 0, ['OP08-110']); setDeckTop(g, 0, ['ST21-005', 'OP05-117']); setDon(g, 0, 10); });
  s = play(s, 'OP08-110');
  s = choose(s, (o) => o.num === 'OP05-117');
  for (let i = 0; i < 20 && s.decision?.tag === 'bottomOrder'; i++) s = keepOrder(s) === s ? choose(s, () => true) : keepOrder(s);
  assert.equal(s.decision?.tag, 'playFree');
  s = choose(s, (o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === 'OP05-117'));
  assert.equal(s.players[0].stage?.num, 'OP05-117');
});

test('S-Shark (OP08-111) : [DON!! x1] [En attaquant] pas de [Bloqueur] pendant ce combat ; [Déclenchement] se joue avec 2 Vies ou moins', () => {
  const me = list(NEUTRAL_L, ['OP08-111'], F);
  let s = scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-111', extra: { don: 1 } }]);
    setChars(g, 1, [{ num: 'ST21-007' }]);
  });
  s = attack(s, charUid(s, 0, 'OP08-111'), leaderUid(s, 1));
  assert.notEqual(s.decision?.kind, 'blocker');
  s = triggerFromLife(me, 'OP08-111', (g) => {
    setLife(g, 0, ['OP08-111', 'ST21-005', 'ST21-006']);
    setHand(g, 0, ['ST21-010']);
  });
  s = yes(s);
  while (s.decision?.options.some((o) => s.players[0].hand.some((c) => c.uid === o.uid))) s = act(s, s.decision.options[0].id);
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP08-111'));
  // 3 Vies après la révélation : le coût n'est pas proposé
  s = triggerFromLife(me, 'OP08-111', (g) => {
    setLife(g, 0, ['OP08-111', 'ST21-005', 'ST21-006', 'ST21-008']);
    setHand(g, 0, ['ST21-010']);
  });
  assert.ok(!s.players[0].chars.some((c) => c.num === 'OP08-111'));
  assert.equal(s.players[0].hand.some((c) => c.num === 'ST21-010'), true);
});

test('S-Hawk (OP08-114) : [DON!! x1] avec moins de Vie : +2000 même hors combat <Tranche> (Q&A)', () => {
  const at = (don: number, mine: number) => scene([list(NEUTRAL_L, ['OP08-114'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP08-114', extra: { don } }]);
    g.players[0].life = g.players[0].life.slice(0, mine);
  });
  const base = CARDS['OP08-114'].power!;
  let s = at(1, 1);
  assert.equal(power(s, charUid(s, 0, 'OP08-114')), base + 1000 + 2000);
  s = at(0, 1);
  assert.equal(power(s, charUid(s, 0, 'OP08-114')), base);
  s = at(1, s.players[1].life.length);
  assert.equal(power(s, charUid(s, 0, 'OP08-114')), base + 1000);
});

test('The Earth Will Not Lose (OP08-115) : Leader {Shandian Warrior} : +3000 pour le combat puis [Upper Yard] ; sans lui, rien, le « Puis » compris (n° 3001)', () => {
  const at = (leader: string) => counterGain(scene([list(leader, ['OP08-115', 'OP05-117'], F), OPP], (g) => {
    setHand(g, 0, ['OP08-115', 'OP05-117']);
    setDon(g, 0, 10);
    oppLeaderDon(g, 1);
  }, 1), 'OP08-115', (x) => {
    let y = x;
    if (y.decision?.options.some((o) => o.uid === leaderUid(y, 0))) y = choose(y, (o) => o.uid === leaderUid(y, 0));
    if (y.decision?.tag === 'playFree') y = choose(y, (o) => o.uid !== undefined);
    return y;
  });
  let r = at(SHANDIAN_L);
  assert.equal(r.gain, 3000);
  assert.equal(r.s.players[0].stage?.num, 'OP05-117');
  r = at(NEUTRAL_L);
  assert.equal(r.gain, 0);
  assert.equal(r.s.players[0].stage, null);
  const s = triggerFromLife(list(NEUTRAL_L, ['OP08-115'], F), 'OP08-115', () => {});
  assert.ok(s.decision?.options.length);
});

test('Burn Bazooka (OP08-116) : [Contre] +4000 ; Vie en main facultative, si oui {Shandian Warrior} de la main dans la Vie face visible', () => {
  const me = list(SHANDIAN_L, ['OP08-116', 'OP15-103'], F);
  const at = () => scene([me, OPP], (g) => {
    setHand(g, 0, ['OP08-116', 'OP15-103']);
    setDon(g, 0, 10);
    oppLeaderDon(g, 1);
  }, 1);
  // oui
  let r = counterGain(at(), 'OP08-116', (x) => {
    let y = yes(x);
    if (y.decision?.tag === 'lifeSide') y = choose(y, 'top');
    y = act(y, y.decision!.options.find((o) => y.players[0].hand.some((c) => c.uid === o.uid && c.num === 'OP15-103'))!.id);
    return y;
  });
  assert.equal(r.gain, 4000);
  assert.equal(r.s.players[0].life.some((c) => c.num === 'OP15-103' && c.faceUp), true);
  // non : ni Vie prise ni carte placée
  const life = at().players[0].life.length;
  r = counterGain(at(), 'OP08-116', no);
  assert.equal(r.gain, 4000);
  assert.ok(!r.s.players[0].life.some((c) => c.num === 'OP15-103'));
  assert.equal(r.s.players[0].hand.filter((c) => c.num === 'OP15-103').length, 1);
  assert.ok(r.s.players[0].life.length <= life);
});

test('Rayleigh (OP08-118) : −3000 et −2000 sur deux Personnages différents, puis KO de 3000 ou moins sur un troisième (Q&A)', () => {
  const me = list(NEUTRAL_L, ['OP08-118'], F);
  let s = scene([me, OPP], (g) => {
    setHand(g, 0, ['OP08-118']);
    setChars(g, 1, [{ num: 'ST21-014' }, { num: 'ST21-008' }, { num: 'ST21-013' }]);
    setDon(g, 0, 10);
  });
  s = play(s, 'OP08-118');
  const a = charUid(s, 1, 'ST21-014');
  const b = charUid(s, 1, 'ST21-008');
  s = choose(s, (o) => o.uid === a);
  assert.ok(!s.decision!.options.some((o) => o.uid === a), 'l’autre doit être différent');
  s = choose(s, (o) => o.uid === b);
  assert.equal(power(s, a), 3000);
  assert.equal(power(s, b), 4000);
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-013'));
  assert.equal(s.players[1].chars.length, 2);
  // la baisse dure jusqu'à la fin du prochain tour adverse
  s = act(s, 'end');
  assert.equal(power(s, a), 3000);
  // « jusqu'à » : on peut ne donner que −2000
  s = scene([me, OPP], (g) => { setHand(g, 0, ['OP08-118']); setChars(g, 1, [{ num: 'ST21-014' }]); setDon(g, 0, 10); });
  s = play(s, 'OP08-118');
  s = choose(s, 'none');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-014'));
  assert.equal(power(s, charUid(s, 1, 'ST21-014')), 4000);
});

test('Luffy (Leader ST14-001) : [DON!! x1] +1 de coût à ses Personnages sur le terrain ; +1000 avec un coût 8 ou plus ; Sanji compté à 6 par lui-même (Q&A)', () => {
  const at = (don: number, chars: string[]) => scene([list(LUFFY_L, ['ST14-003', BIG], F), OPP], (g) => {
    g.players[0].leader.don = don;
    setChars(g, 0, chars.map((num) => ({ num })));
    setHand(g, 0, ['ST14-003']);
    setChars(g, 1, [{ num: 'ST21-006' }]);
    setDon(g, 0, 9);
  });
  let s = at(1, ['ST21-005']);
  assert.equal(fieldCost(s, charUid(s, 0, 'ST21-005')), 3);
  assert.equal(power(s, leaderUid(s, 0)), 6000);
  s = at(1, [BIG]);
  assert.equal(power(s, leaderUid(s, 0)), 7000);
  s = at(0, [BIG]);
  assert.equal(fieldCost(s, charUid(s, 0, BIG)), 8);
  assert.equal(power(s, leaderUid(s, 0)), 5000);
  // Q&A : Sanji joué sans autre Personnage, coût 5 + 1
  s = at(1, []);
  s = play(s, 'ST14-003');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.equal(s.players[1].chars.length, 0);
  s = at(0, []);
  s = play(s, 'ST14-003');
  assert.equal(s.players[1].chars.length, 1);
});

test('Haredas (ST14-008) : +2 de coût à un {Straw Hat Crew} noir, puis pioche et défausse avec un coût 8 ou plus', () => {
  const at = (cost8: boolean) => scene([list(LUFFY_L, ['ST14-008', 'ST14-002', BIG], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'ST14-008' }, { num: 'ST14-002' }, ...(cost8 ? [{ num: BIG }] : [])]);
    setHand(g, 0, ['ST21-005']);
  });
  let s = at(false);
  s = act(s, `act:${charUid(s, 0, 'ST14-008')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'ST14-002'));
  assert.equal(fieldCost(s, charUid(s, 0, 'ST14-002')), 5);
  assert.equal(s.players[0].hand.length, 1);
  s = at(true);
  s = act(s, `act:${charUid(s, 0, 'ST14-008')}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'ST14-002'));
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[0].trash.length >= 1, true);
});

test('Nami (ST14-006) : [Jouée] 6 cartes ou moins en main et un coût 8 ou plus pour piocher', () => {
  const at = (hand: string[], chars: string[]) => scene([list(LUFFY_L, ['ST14-006', BIG, 'ST21-005', 'ST21-006', 'ST21-008', 'ST21-010', 'ST21-013', 'ST21-014', 'ST21-007'], F), OPP], (g) => {
    setHand(g, 0, ['ST14-006', ...hand]); setChars(g, 0, chars.map((num) => ({ num }))); setDon(g, 0, 10);
  });
  let s = at([], [BIG]);
  s = play(s, 'ST14-006');
  assert.equal(s.players[0].hand.length, 1);
  s = at([], []);
  s = play(s, 'ST14-006');
  assert.equal(s.players[0].hand.length, 0);
  s = at(['ST21-005', 'ST21-006', 'ST21-008', 'ST21-010', 'ST21-013', 'ST21-014', 'ST21-007'], [BIG]);
  s = play(s, 'ST14-006');
  assert.equal(s.players[0].hand.length, 7);
});

test('Gum-Gum Giant Rifle (ST14-014) : [Contre] +3000 avec un coût 8 ou plus ; [Déclenchement] Personnage de coût 2 ou moins de la Défausse en main', () => {
  const me = list(LUFFY_L, ['ST14-014', BIG], F);
  const at = (chars: string[]) => counterGain(scene([me, OPP], (g) => {
    setHand(g, 0, ['ST14-014']); setChars(g, 0, chars.map((num) => ({ num }))); setDon(g, 0, 10); oppLeaderDon(g, 1);
  }, 1), 'ST14-014', (x) => (x.decision?.options.some((o) => o.uid === leaderUid(x, 0)) ? choose(x, (o) => o.uid === leaderUid(x, 0)) : x));
  assert.equal(at([BIG]).gain, 3000);
  assert.equal(at([]).gain, 0);
  let s = triggerFromLife(me, 'ST14-014', (g) => { g.players[0].trash = [{ uid: 8000, num: 'ST14-008' }, { uid: 8001, num: 'ST21-006' }]; });
  assert.ok(!s.decision!.options.some((o) => o.uid === 8001));
  s = choose(s, (o) => o.uid === 8000);
  assert.ok(s.players[0].hand.some((c) => c.num === 'ST14-008'));
});

test('ST14-015 et ST14-016 : [Déclenchement] (coût 8 ou plus exigé pour la première)', () => {
  const me = list(LUFFY_L, ['ST14-015', 'ST14-016', BIG], F);
  let s = triggerFromLife(me, 'ST14-015', (g) => { setChars(g, 0, [{ num: BIG }]); setChars(g, 1, [{ num: 'ST21-006' }]); });
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.equal(s.players[1].chars.length, 0);
  s = triggerFromLife(me, 'ST14-015', (g) => { setChars(g, 0, []); setChars(g, 1, [{ num: 'ST21-006' }]); });
  assert.equal(s.players[1].chars.length, 1);
  s = triggerFromLife(me, 'ST14-016', (g) => setChars(g, 1, [{ num: 'ST21-006' }]));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-006'));
  assert.equal(s.players[1].chars.length, 0);
});
