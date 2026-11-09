// ST13 (tâche S13) : un test par effet des cartes codées à la main (condition vraie et fausse), et les recettes que le banc
// d'essai ne sait pas mesurer ([Contre] « pendant ce combat », [Déclenchement], convention n° 1000 sur la Vie : § 15.4).
// Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import { act } from '../engine/engine.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { hasKeyword, knows, power } from '../engine/rules.ts';
import type { FieldCard, GameState } from '../engine/types.ts';
import { viewFor } from '../engine/view.ts';
import { charUid, counterGain, leaderUid, list, oppLeaderDon, scene } from './eb-scene.ts';
import { attack, choose, coherent, hasOption, logHas, play, setChars, setDeckTop, setDon, setHand, setLife } from './helpers.ts';

const F = 'ST-21';
const OPP = 'ST-21';
const NEUTRAL_L = 'ST21-001';
const O_STUSSY = 'ST21-006';   // coût 3, 5000
const O_CHOPPER = 'ST21-008';  // coût 4, 6000
const SABO_L = 'ST13-001';
const ACE_L = 'ST13-002';
const LUFFY_L = 'ST13-003';
const SABO5 = 'ST13-008';      // Sabo, coût 5
const ACE5 = 'ST13-011';       // Portgas.D.Ace, coût 5
const LUFFY5 = 'ST13-015';     // Monkey.D.Luffy, coût 5
const yes = (s: GameState) => choose(s, 'yes');
const act0 = (s: GameState, num: string) => act(s, `act:${(num === s.players[0].leader.num ? s.players[0].leader : s.players[0].chars.find((c) => c.num === num) as FieldCard).uid}`);
const faceUp = (g: GameState, ...at: number[]) => { for (const i of at) g.players[0].life[i].faceUp = true; };

test('ST13 : toutes les cartes jouables', () => {
  const nums = Object.keys(CARDS).filter((num) => num.startsWith('ST13-'));
  assert.equal(nums.length, 19);
  assert.deepEqual(nums.filter((num) => !['verified', 'coded', 'auto'].includes(confidence(num))), []);
});

test('Sabo (Leader ST13-001) : [DON!! x1] coût : Personnage coût 3+ et 7000+ (puissance actuelle : Q&A) face visible dans la Vie ; +2000 jusqu’au prochain tour', () => {
  const me = list(SABO_L, [ACE5, O_STUSSY, SABO5], F);
  const at = (don: number, chars: { num: string; extra?: Partial<FieldCard> }[]) => scene([me, OPP], (g) => {
    setChars(g, 0, chars);
    g.players[0].leader.don = don;
    setDon(g, 0, 0);
  });
  const leader = (s: GameState) => `act:${leaderUid(s, 0)}`;
  // sans DON!! : pas d'activation
  let s = at(0, [{ num: ACE5 }, { num: SABO5 }]);
  assert.ok(!hasOption(s, leader(s)));
  // pas de Personnage assez fort : pas d'activation
  s = at(1, [{ num: SABO5 }]);
  assert.ok(!hasOption(s, leader(s)), '6000 : non');
  // 6000 + 1 DON!! donnée : oui (Q&A)
  s = at(1, [{ num: SABO5, extra: { don: 1 } }, { num: ACE5 }]);
  const lifeBefore = s.players[0].life.length;
  const donRested = s.players[0].donRested;
  s = act(s, leader(s));
  assert.ok(hasOption(s, `card:${charUid(s, 0, SABO5)}`));
  const moved = charUid(s, 0, SABO5);
  s = choose(s, (o) => o.uid === moved);
  assert.equal(s.players[0].life.length, lifeBefore + 1);
  assert.equal(s.players[0].life[0].num, SABO5);
  assert.equal(s.players[0].life[0].faceUp, true);
  assert.equal(s.players[0].donRested, donRested + 1, 'la DON!! donnée revient épuisée');
  s = choose(s, (o) => o.uid === charUid(s, 0, ACE5));
  assert.equal(power(s, charUid(s, 0, ACE5)), CARDS[ACE5].power! + 2000);
  assert.ok(s.mods.some((m) => m.uid === charUid(s, 0, ACE5) && m.amount === 2000 && m.until === s.turn + 1), 'jusqu’à la fin du tour adverse');
  assert.ok(!hasOption(s, leader(s)), 'une fois par tour');
  coherent(s);
});

test('Portgas D. Ace (Leader ST13-002) : [DON!! x2] regarder 5 : Personnage de coût 5 face visible dans la Vie, reste dessous ; pas d’autre coût', () => {
  const me = list(ACE_L, [SABO5, O_STUSSY], F);
  const at = (don: number) => scene([me, OPP], (g) => {
    setDeckTop(g, 0, [SABO5, O_STUSSY]);
    g.players[0].leader.don = don;
    setDon(g, 0, 0);
  });
  let s = at(1);
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`));
  s = at(2);
  const size = s.players[0].deck.length;
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(s.decision?.tag, 'lookToLife');
  assert.ok(!s.decision!.options.some((o) => o.num === O_STUSSY), 'coût 3 refusé');
  s = choose(s, (o) => o.num === SABO5);
  while (s.decision?.tag === 'bottomOrder') s = act(s, 'keep');
  assert.equal(s.players[0].life[0].num, SABO5);
  assert.equal(s.players[0].life[0].faceUp, true);
  assert.equal(s.players[0].deck.length, size - 1);
  assert.ok(knows(s, 1, s.players[0].life[0].uid) || s.players[0].life[0].faceUp);
  coherent(s);
});

test('Portgas D. Ace (Leader ST13-002) : [Fin de votre tour] toutes les cartes de Vie face visible à la Défausse, d’où qu’elles viennent (Q&A)', () => {
  let s = scene([list(ACE_L, [], F), OPP], (g) => { faceUp(g, 0, 2); setHand(g, 0, []); setDon(g, 0, 0); });
  const [a, , c, d] = s.players[0].life.map((x) => x.uid);
  const life = s.players[0].life.length;
  s = act(s, 'end');
  assert.equal(s.players[0].life.length, life - 2);
  assert.ok(s.players[0].trash.some((x) => x.uid === a) && s.players[0].trash.some((x) => x.uid === c));
  assert.equal(s.players[0].life[1].uid, d, 'les autres gardent leur ordre');
});

test('Luffy (Leader ST13-003) : la Vie face visible va sous le deck au lieu de la main, sans [Déclenchement] (Q&A) ; face cachée : comme d’habitude', () => {
  const withTrigger = 'EB01-030';
  const me = list(LUFFY_L, [withTrigger], F);
  let s = scene([me, OPP], (g) => {
    setLife(g, 0, [withTrigger, ...g.players[0].life.slice(1).map((c) => c.num)]);
    faceUp(g, 0);
    oppLeaderDon(g, 3);
    setHand(g, 0, []);
  }, 1);
  const hand = s.players[0].hand.length;
  const life = s.players[0].life.length;
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.notEqual(s.decision?.tag, 'trigger');
  assert.equal(s.players[0].life.length, life - 1);
  assert.equal(s.players[0].hand.length, hand);
  assert.equal(s.players[0].deck.at(-1)?.num, withTrigger);
  // face cachée : [Déclenchement] proposé
  s = scene([me, OPP], (g) => {
    setLife(g, 0, [withTrigger, ...g.players[0].life.slice(1).map((c) => c.num)]);
    oppLeaderDon(g, 3);
  }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.equal(s.decision?.tag, 'trigger');
  // un autre Leader : face visible, en main
  s = scene([list(NEUTRAL_L, ['ST21-010'], F), OPP], (g) => {
    faceUp(g, 0);
    oppLeaderDon(g, 3);
    setHand(g, 0, []);
  }, 1);
  const top = s.players[0].life[0].uid;
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  if (s.decision?.tag === 'trigger') s = choose(s, 'hand');
  assert.ok(s.players[0].hand.some((c) => c.uid === top));
});

test('Luffy (Leader ST13-003) + Makino (ST13-012) : carte face visible : sous le deck, coût non payé, rien ne se passe (Q&A)', () => {
  const me = list(LUFFY_L, ['ST13-012'], F);
  const at = (up: boolean) => scene([me, OPP], (g) => {
    setHand(g, 0, ['ST13-012']);
    setDon(g, 0, 1);
    if (up) faceUp(g, 0);
  });
  let s = play(at(true), 'ST13-012');
  const top = s.players[0].life[0].uid;
  const life = s.players[0].life.length;
  s = yes(s);
  s = choose(s, 'top');
  assert.equal(s.players[0].life.length, life - 1);
  assert.equal(s.players[0].deck.at(-1)?.uid, top);
  assert.ok(!s.players[0].hand.some((c) => c.uid === top));
  assert.notEqual(s.decision?.tag, 'lifeOrder', 'coût non payé : pas de relecture');
  // face cachée : le coût est payé, la relecture a lieu
  s = play(at(false), 'ST13-012');
  s = yes(s);
  s = choose(s, 'top');
  assert.equal(s.decision?.tag, 'lifeOrder');
});

test('Luffy (Leader ST13-003) : [DON!! x2] défausser 1 : avec 0 Vie, jusqu’à 2 Personnages de coût 5 de la main et de la Défausse (Q&A) ; sinon rien', () => {
  const me = list(LUFFY_L, [SABO5, ACE5, 'ST21-010'], F);
  const at = (life: number) => scene([me, OPP], (g) => {
    const P = g.players[0];
    setHand(g, 0, [SABO5, 'ST21-010']);
    const i = P.deck.findIndex((c) => c.num === ACE5);
    P.trash.push(...P.deck.splice(i, 1));
    P.life.splice(life);
    P.leader.don = 2;
    setDon(g, 0, 0);
  });
  let s = act0(at(0), LUFFY_L);
  s = choose(s, (o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === 'ST21-010'));
  s = choose(s, (o) => o.num === SABO5);
  s = choose(s, (o) => o.num === ACE5);
  assert.deepEqual(s.players[0].life.map((c) => c.num), [ACE5, SABO5]);
  assert.ok(s.players[0].life.every((c) => c.faceUp));
  assert.ok(!s.players[0].hand.some((c) => c.num === SABO5));
  // avec 1 Vie : coût payé, rien de plus (règles 4-10 : pas de « si » satisfait)
  s = act0(at(1), LUFFY_L);
  s = choose(s, (o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === 'ST21-010'));
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].life.length, 1);
});

test('Barbe Blanche (ST13-004) : +1 Vie, puis 1 carte sur le deck (face cachée : Q&A), les autres gardent leur face (Q&A)', () => {
  const me = list(NEUTRAL_L, ['ST13-004', O_STUSSY], F);
  let s = scene([me, OPP], (g) => {
    setHand(g, 0, ['ST13-004']);
    setDon(g, 0, 6);
    setDeckTop(g, 0, [O_STUSSY]);
    g.players[0].life.splice(3);
    faceUp(g, 1);
  });
  const up = s.players[0].life[1].uid;
  const life = s.players[0].life.length;
  s = play(s, 'ST13-004');
  assert.equal(s.players[0].life[0].num, O_STUSSY);
  assert.equal(s.decision?.tag, 'lifeOrder');
  s = choose(s, (o) => o.uid === up);
  assert.equal(s.players[0].deck[0].uid, up);
  assert.equal(s.players[0].deck[0].faceUp, undefined);
  while (s.decision?.tag === 'lifeOrder') s = act(s, s.decision.options[s.decision.options.length - 1].id);
  assert.equal(s.players[0].life.length, life);
});

test('Barbe Blanche (ST13-004) : une carte face visible relue garde sa face (Q&A)', () => {
  const me = list(NEUTRAL_L, ['ST13-004'], F);
  let s = scene([me, OPP], (g) => {
    setHand(g, 0, ['ST13-004']);
    setDon(g, 0, 6);
    g.players[0].life.splice(2);
    faceUp(g, 1);
  });
  const up = s.players[0].life[1].uid;
  s = play(s, 'ST13-004');
  s = choose(s, (o) => o.uid !== up);
  while (s.decision?.tag === 'lifeOrder') s = choose(s, (o) => o.uid === up);
  assert.equal(s.players[0].life[0].uid, up);
  assert.equal(s.players[0].life[0].faceUp, true);
});

test('Yamato (ST13-016) : obligatoire : la seule carte de Vie va sur le deck ; 0 Vie : rien', () => {
  const me = list(NEUTRAL_L, ['ST13-016'], F);
  let s = scene([me, OPP], (g) => { setHand(g, 0, ['ST13-016']); setDon(g, 0, 5); g.players[0].life.splice(1); });
  const only = s.players[0].life[0].uid;
  s = play(s, 'ST13-016');
  assert.equal(s.players[0].life.length, 0);
  assert.equal(s.players[0].deck[0].uid, only);
  s = scene([me, OPP], (g) => { setHand(g, 0, ['ST13-016']); setDon(g, 0, 5); g.players[0].life.splice(0); });
  s = play(s, 'ST13-016');
  assert.equal(s.players[0].life.length, 0);
  assert.ok(hasKeyword(s, 0, s.players[0].chars.find((c) => c.num === 'ST13-016')!, 'Rush'));
});

test('Ivankov (ST13-005) : 1 Vie dessus ou dessous à la Défausse : Personnage de coût 5 révélé, face cachée au-dessus ; proposé seulement avec une telle carte', () => {
  const me = list(NEUTRAL_L, ['ST13-005', SABO5, O_STUSSY], F);
  const at = (hand: string[]) => scene([me, OPP], (g) => { setHand(g, 0, ['ST13-005', ...hand]); setDon(g, 0, 3); });
  let s = play(at([SABO5]), 'ST13-005');
  const bottom = s.players[0].life.at(-1)!.uid;
  const life = s.players[0].life.length;
  s = yes(s);
  s = choose(s, 'bottom');
  assert.ok(s.players[0].trash.some((c) => c.uid === bottom));
  s = choose(s, (o) => o.num === SABO5);
  assert.equal(s.players[0].life.length, life);
  assert.equal(s.players[0].life[0].num, SABO5);
  assert.ok(!s.players[0].life[0].faceUp);
  assert.ok(knows(s, 1, s.players[0].life[0].uid), 'révélée aux deux joueurs');
  assert.equal(viewFor(s, 1).players[0].life[0].num, SABO5);
  // sans Personnage de coût 5 : pas de question
  s = play(at([O_STUSSY]), 'ST13-005');
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(s.players[0].life.length, life);
});

test('Dadan (ST13-006) : jusqu’à 1 de chaque nom de coût 2 de la main', () => {
  const me = list(NEUTRAL_L, ['ST13-006', 'ST13-007', 'ST13-010', 'ST13-014', SABO5], F);
  let s = scene([me, OPP], (g) => { setHand(g, 0, ['ST13-006', 'ST13-007', 'ST13-010', 'ST13-014', SABO5]); setDon(g, 0, 5); });
  s = play(s, 'ST13-006');
  assert.ok(!s.decision!.options.some((o) => o.num === SABO5), 'coût 5 refusé');
  s = choose(s, (o) => o.num === 'ST13-007');
  s = choose(s, (o) => o.num === 'ST13-010');
  s = choose(s, 'none');
  assert.deepEqual(s.players[0].chars.map((c) => c.num).sort(), ['ST13-006', 'ST13-007', 'ST13-010']);
  assert.ok(s.players[0].hand.some((c) => c.num === 'ST13-014'));
  assert.ok(s.players[0].hand.some((c) => c.num === SABO5));
});

for (const [num, name5, wrong] of [['ST13-007', SABO5, ACE5], ['ST13-010', ACE5, SABO5], ['ST13-014', LUFFY5, SABO5]] as const) {
  test(`Frère enfant (${num}) : révéler le dessus de la Vie ; le bon nom de coût 5 peut être joué, +2000 au Leader ; sinon la carte reste, connue`, () => {
    const me = list(NEUTRAL_L, [num, name5, wrong], F);
    const at = (top: string) => scene([me, OPP], (g) => {
      setChars(g, 0, [{ num }]);
      setLife(g, 0, [top, ...g.players[0].life.slice(1).map((c) => c.num)]);
      setDon(g, 0, 0);
    });
    const base = (s: GameState) => power(s, leaderUid(s, 0));
    let s = at(name5);
    const b = base(s);
    const life = s.players[0].life.length;
    s = act0(s, num);
    assert.ok(s.players[0].trash.some((c) => c.num === num), 'coût payé');
    assert.equal(s.decision?.tag, 'may');
    s = yes(s);
    assert.ok(s.players[0].chars.some((c) => c.num === name5));
    assert.equal(s.players[0].life.length, life - 1);
    // un [Jouée] du Personnage joué peut poser sa question : on le refuse
    while (s.decision?.tag === 'may' || s.decision?.tag === 'lifeOrder') s = act(s, s.decision.options.at(-1)!.id);
    assert.equal(base(s), b + 2000);
    assert.ok(s.mods.some((m) => m.uid === leaderUid(s, 0) && m.amount === 2000 && m.until === s.turn + 1));
    // refus : la carte reste, connue, pas de bonus
    s = choose(act0(at(name5), num), 'no');
    assert.equal(s.players[0].life.length, life);
    assert.equal(base(s), b);
    assert.ok(knows(s, 1, s.players[0].life[0].uid));
    // mauvais nom : rien, la carte reste, connue des deux joueurs
    s = act0(at(wrong), num);
    assert.equal(s.decision?.kind, 'main');
    assert.equal(s.players[0].life.length, life);
    assert.ok(!s.players[0].life[0].faceUp);
    assert.ok(knows(s, 1, s.players[0].life[0].uid));
    assert.ok(logHas(s, 'révèle'));
  });
}

test('Frère enfant : sans Vie, l’activation se paie, rien à révéler (n° 1000)', () => {
  const s = scene([list(NEUTRAL_L, ['ST13-007'], F), OPP], (g) => { setChars(g, 0, [{ num: 'ST13-007' }]); g.players[0].life = []; });
  assert.ok(hasOption(s, `act:${charUid(s, 0, 'ST13-007')}`));
});

test('Shanks (ST13-009) : retourner face cachée n’importe quelle carte face visible (Q&A) : si l’adversaire a 7 cartes ou plus, sa Vie −1', () => {
  const me = list(NEUTRAL_L, ['ST13-009'], F);
  const at = (oppHand: number, up: number[]) => scene([me, OPP], (g) => {
    setHand(g, 0, ['ST13-009']);
    setDon(g, 0, 7);
    const O = g.players[1];
    O.hand.push(...O.deck.splice(0, Math.max(0, oppHand - O.hand.length)));
    O.deck.push(...O.hand.splice(oppHand));
    faceUp(g, ...up);
  });
  let s = at(7, [2]);
  const oppLife = s.players[1].life.length;
  const oppTop = s.players[1].life[0].uid;
  const flipped = s.players[0].life[2].uid;
  s = play(s, 'ST13-009');
  s = yes(s);
  assert.equal(s.players[0].life.find((c) => c.uid === flipped)?.faceUp, false);
  assert.equal(s.players[1].life.length, oppLife - 1);
  assert.ok(s.players[1].trash.some((c) => c.uid === oppTop));
  // 6 cartes : pas proposé (n° 1000)
  s = play(at(6, [2]), 'ST13-009');
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(s.players[1].life.length, oppLife);
  // pas de carte face visible : pas proposé
  s = play(at(7, []), 'ST13-009');
  assert.notEqual(s.decision?.tag, 'may');
  // deux cartes face visible : le joueur choisit
  s = play(at(7, [0, 3]), 'ST13-009');
  s = yes(s);
  assert.equal(s.decision?.tag, 'lifeOrder');
});

test('Portgas D. Ace (ST13-011) : [Initiative] avec 2 Vies ou moins, gardée si la Vie remonte (Q&A) ; 3 Vies : non', () => {
  const me = list(NEUTRAL_L, ['ST13-011'], F);
  const at = (life: number) => scene([me, OPP], (g) => { setHand(g, 0, ['ST13-011']); setDon(g, 0, 5); g.players[0].life.splice(life); });
  let s = play(at(2), 'ST13-011');
  const f = () => s.players[0].chars.find((c) => c.num === 'ST13-011')!;
  assert.ok(hasKeyword(s, 0, f(), 'Rush'));
  s.players[0].life.push(s.players[0].deck.shift()!);
  assert.ok(hasKeyword(s, 0, f(), 'Rush'));
  s = play(at(3), 'ST13-011');
  assert.ok(!hasKeyword(s, 0, f(), 'Rush'));
});

test('Makino (ST13-012) : le coût paie et relit la Vie (chaque carte garde sa face : Q&A) ; proposé seulement s’il reste à relire (n° 1000)', () => {
  const me = list(NEUTRAL_L, ['ST13-012'], F);
  const at = (life: number) => scene([me, OPP], (g) => { setHand(g, 0, ['ST13-012']); setDon(g, 0, 1); g.players[0].life.splice(life); });
  let s = play(at(3), 'ST13-012');
  const hand = s.players[0].hand.length;
  s = yes(s);
  s = choose(s, 'top');
  assert.equal(s.players[0].hand.length, hand + 1);
  assert.equal(s.decision?.tag, 'lifeOrder');
  s = play(at(1), 'ST13-012');
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(s.players[0].life.length, 1);
});

test('Garp (ST13-013) et Le lien des trois frères (ST13-019) : l’un des trois noms de coût 5 ou moins, le reste dessous', () => {
  const me = list(NEUTRAL_L, ['ST13-013', 'ST13-019', SABO5, ACE5, 'ST13-007', O_STUSSY], F);
  for (const num of ['ST13-013', 'ST13-019']) {
    let s = scene([me, OPP], (g) => {
      setHand(g, 0, [num]);
      setDon(g, 0, 1);
      setDeckTop(g, 0, [SABO5, ACE5, O_STUSSY, 'ST13-007', O_CHOPPER]);
    });
    s = play(s, num);
    const offered = s.decision!.options.map((o) => o.num).filter(Boolean);
    assert.ok(offered.includes(SABO5) && offered.includes(ACE5) && offered.includes('ST13-007'), num);
    assert.ok(!offered.includes(O_STUSSY), num);
    s = choose(s, (o) => o.num === ACE5);
    assert.ok(s.players[0].hand.some((c) => c.num === ACE5));
  }
});

test('Flame Dragon King (ST13-017) : [Contre] +4000 pour le combat puis relecture de la Vie ; [Déclenchement] 1 Vie en main : 1 carte de la main dans la Vie', () => {
  const me = list(NEUTRAL_L, ['ST13-017', O_STUSSY], F);
  const at = () => scene([me, OPP], (g) => { setHand(g, 0, ['ST13-017']); setDon(g, 0, 2); }, 1);
  const { s: s1, gain } = counterGain(at(), 'ST13-017');
  assert.equal(gain, 4000);
  assert.equal(s1.decision?.tag, 'lifeOrder');
  let s = scene([me, OPP], (g) => {
    setLife(g, 0, ['ST13-017', ...g.players[0].life.slice(1).map((c) => c.num)]);
    setHand(g, 0, [O_STUSSY]);
    oppLeaderDon(g, 3);
  }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  s = choose(s, 'trigger');
  const life = s.players[0].life.length;
  s = yes(s);
  s = choose(s, 'top');
  s = choose(s, (o) => o.num === O_STUSSY);
  assert.equal(s.players[0].life[0].num, O_STUSSY);
  assert.equal(s.players[0].life.length, life);
});
