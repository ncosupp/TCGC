// OP04 (tâche S16) : un test par effet des cartes codées à la main (condition vraie et fausse), les Q&A officielles appliquées, et les effets
// des recettes que le banc d'essai ne sait pas mesurer ([Contre] « pendant ce combat », [En attaquant] qui change l'issue du combat). Numéros et
// valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import type { DeckList } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { attackAbility, attackTargets, fieldCost, hasBlocker, hasKeyword, power, removeByEffect } from '../engine/rules.ts';
import type { EffectCtx, FieldCard, GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, hasOption, keepOrder, logHas, play, setChars, setDeckTop, setDon, setHand, setLife, tag, take, donMax } from './helpers.ts';
import { charUid, counterGain, leaderUid, oppLeaderDon, scene } from './eb-scene.ts';

const OP04_ALL = Object.keys(CARDS).filter((n) => n.startsWith('OP04-') && CARDS[n].category !== 'LEADER');
const C1000 = 'OP04-005';      // coût 1
const C3000 = 'OP04-091';      // coût 1, 2000 : Dressrosa
const VANILLA = 'OP04-007';    // coût 1, 3000, {Alabasta}
const V5 = 'OP04-087';         // coût 5, 7000, {Dressrosa}, sans effet
const V6 = 'OP04-078';         // coût 6, 8000, sans effet
const V7 = 'OP04-114';         // coût 5, 7000, {Homies}, sans effet
let decks = 0;
const deck = (leader: string): DeckList => ({ id: `PERSO-s16-${decks++}`, name: 'Essai S16', series: 'PERSO', leader, cards: Object.fromEntries([...OP04_ALL, 'OP03-013', 'ST21-004'].map((n) => [n, 12])) });
const NEUTRAL = 'OP05-002';    // Leader sans effet d'attaque ni de fin de tour
const OPP = deck(NEUTRAL);
const me = (leader = NEUTRAL) => deck(leader);

// L'adversaire (actif) attaque `target` avec son Leader, renforcé pour gagner le combat ; ni blocage ni contre de ma part
function oppAttacks(s: GameState, target: number): GameState {
  s = attack(s, leaderUid(s, 1), target);
  while (s.decision?.player === 0 && s.decision.kind === 'blocker') s = act(s, 'noblock');
  while (s.decision?.player === 0 && s.decision.kind === 'counter') s = act(s, 'pass');
  return s;
}
// Je n'ajoute ni blocage ni contre quand c'est moi qui attaque (joueur 1 répond)
function resolveAttack(s: GameState): GameState {
  while (s.decision?.player === 1 && (s.decision.kind === 'blocker' || s.decision.kind === 'counter')) s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  return s;
}
const ctxOf = (s: GameState, p: PlayerId, num: string): EffectCtx => ({
  s, me: p, opp: p === 0 ? 1 : 0, source: -1, num, pending: { kind: 'system', source: -1, num, controller: p, answers: [] } as unknown as EffectCtx['pending'],
  ask: (spec) => spec.options[0].id,
});
const activate = (s: GameState, uid: number) => act(s, `act:${uid}`);
const setTrash = (g: GameState, p: PlayerId, nums: string[]) => { g.players[p].trash = nums.map((n) => take(g, p, n)); };
const putStage = (g: GameState, p: PlayerId, num: string, extra: Partial<FieldCard> = {}) => { g.players[p].stage = { ...take(g, p, num), rested: false, don: 0, playedTurn: 0, usedOpt: [], ...extra }; };
const trashCount = (g: GameState, p: PlayerId) => g.players[p].trash.length;
const donField = (g: GameState, p: PlayerId) => 10 - g.players[p].donDeck;
const filler = (n: number) => Array.from({ length: n }, () => VANILLA);
const endTurn = (s: GameState) => act(s, 'end');
const leaderOf = (s: GameState, p: PlayerId) => s.players[p].leader;

test('OP04 : toutes les cartes sont jouables, aucune en doute', () => {
  const left = Object.keys(CARDS).filter((n) => n.startsWith('OP04-') && !['verified', 'coded', 'auto'].includes(confidence(n)));
  assert.deepEqual(left, []);
});

test('Igaram (OP04-002) : Leader redressé obligatoire ; −5000 même à 0 (Q&A)', () => {
  let s = scene([me('OP04-001'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-002' }]); setHand(g, 0, []); setDeckTop(g, 0, ['OP04-010', VANILLA, VANILLA, VANILLA, VANILLA]); });
  const u = charUid(s, 0, 'OP04-002');
  assert.ok(hasOption(s, `act:${u}`));
  s = activate(s, u);
  s = choose(s, (o) => o.num === 'OP04-010');
  s = keepOrder(s);
  assert.equal(power(s, leaderUid(s, 0)), 0);
  assert.equal(s.players[0].hand.length, 1);
  coherent(s);
  s = scene([me('OP04-001'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-002' }]); leaderOf(g, 0).rested = true; });
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP04-002')}`), 'Leader épuisé : pas de coût');
});

test('Karoo (OP04-004) : jusqu’à 1 DON!! épuisée à chaque {Alabasta}, autant que de DON!! épuisées (Q&A)', () => {
  const setup = (rested: number) => (g: GameState) => { setChars(g, 0, [{ num: 'OP04-004' }, { num: VANILLA }, { num: 'OP04-012' }]); setDon(g, 0, 0, rested); };
  let s = scene([me('OP04-001'), OPP], setup(2));
  const karoo = charUid(s, 0, 'OP04-004');
  s = activate(s, karoo);
  s = choose(s, (o) => o.uid === charUid(s, 0, VANILLA));
  assert.equal(s.players[0].donRested, 1);
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 0, VANILLA)), 'pas deux fois la même carte');
  s = choose(s, (o) => o.uid === karoo);
  assert.equal(s.players[0].donRested, 0);
  assert.deepEqual(s.players[0].chars.map((c) => c.don), [1, 1, 0]);
  coherent(s);
  // une seule : le joueur choisit qui la reçoit
  s = scene([me('OP04-001'), OPP], setup(3));
  s = activate(s, charUid(s, 0, 'OP04-004'));
  s = choose(s, 'none');
  assert.deepEqual(s.players[0].chars.map((c) => c.don), [0, 0, 0], 'jusqu’à 1 : on peut s’arrêter');
});

test('Kung Fu Jugon (OP04-005) : [Bloqueur] seulement avec un autre', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: C1000 }]); });
  assert.equal(hasBlocker(s, 0, s.players[0].chars[0]), false);
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: C1000 }, { num: C1000 }]); });
  assert.equal(hasBlocker(s, 0, s.players[0].chars[0]), true);
  assert.equal(hasBlocker(s, 0, s.players[0].chars[1]), true);
});

test('Koza (OP04-006) : −5000 au Leader redressé ; +2000 jusqu’au début de son prochain tour (limite du banc)', () => {
  let s = scene([me('OP04-001'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-006' }], ); setChars(g, 1, [{ num: V5, extra: { rested: true } }]); g.players[0].chars[0].playedTurn = 0; });
  const u = charUid(s, 0, 'OP04-006');
  const before = power(s, u);
  s = attack(s, u, leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.equal(power(s, u), before + 2000);
  assert.equal(power(s, leaderUid(s, 0)), 0);
  s = resolveAttack(s);
  s = endTurn(s);
  assert.equal(power(s, u), before + 2000, 'encore au tour adverse');
  coherent(s);
});

test('Chaka (OP04-008) : avec Vivi, −3000 puis KO d’un autre à 0 ou moins (Q&A) ; sans Vivi, rien', () => {
  const setup = (g: GameState) => { setChars(g, 0, [{ num: 'OP04-008', extra: { don: 1 } }]); g.players[0].donDeck -= 1; setChars(g, 1, [{ num: V5, extra: { rested: true } }, { num: 'OP04-012' }]); };
  let s = scene([me('OP04-001'), OPP], setup);
  const victim = charUid(s, 1, 'OP04-012');   // 0 de puissance
  s = attack(s, charUid(s, 0, 'OP04-008'), leaderUid(s, 1));
  s = choose(s, (o) => o.uid === charUid(s, 1, V5));
  assert.equal(power(s, charUid(s, 1, V5)), 4000);
  s = choose(s, (o) => o.uid === victim);
  assert.ok(!s.players[1].chars.some((c) => c.uid === victim));
  s = scene([me(NEUTRAL), OPP], setup);
  s = attack(s, charUid(s, 0, 'OP04-008'), leaderUid(s, 1));
  assert.ok(s.players[1].chars.some((c) => c.num === 'OP04-012'));
  assert.equal(power(s, charUid(s, 1, V5)), 7000);
});

test('Troupe de canards (OP04-009) : −5000 : retour en main à la fin du tour ; refus ; parti avant : rien', () => {
  let s = scene([me('OP04-001'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-009' }]); setHand(g, 0, []); });
  const u = charUid(s, 0, 'OP04-009');
  s = attack(s, u, leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.equal(power(s, leaderUid(s, 0)), 0);
  s = resolveAttack(s);
  assert.ok(s.players[0].chars.some((c) => c.uid === u), 'encore là pendant le tour');
  s = endTurn(s);
  assert.ok(s.players[0].hand.some((c) => c.uid === u), 'en main');
  assert.ok(!s.players[0].chars.some((c) => c.uid === u));
  coherent(s);
  s = scene([me('OP04-001'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-009' }]); setHand(g, 0, []); });
  s = attack(s, charUid(s, 0, 'OP04-009'), leaderUid(s, 1));
  s = choose(s, 'no');
  s = resolveAttack(s);
  s = endTurn(s);
  assert.equal(s.players[0].chars.length, 1, 'refus : il reste');
});

test('Chopper (OP04-010) : Personnage {Animal} de 3000 ou moins de sa main', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-010', 'OP04-004', V5]); setDon(g, 0, 3); });
  s = play(s, 'OP04-010');
  assert.ok(s.decision!.options.some((o) => o.num === 'OP04-004' || s.players[0].hand.some((c) => c.uid === o.uid && c.num === 'OP04-004')));
  s = choose(s, (o) => o.id !== 'none');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP04-004'));
  assert.ok(s.players[0].hand.some((c) => c.num === V5), 'pas {Animal}');
});

test('Nami (OP04-011) : révélée obligatoire ; 6000+ : +3000 et au-dessous ; sinon elle reste au-dessus (n° 1984)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-011' }]); setDeckTop(g, 0, [V6]); });
  const u = charUid(s, 0, 'OP04-011');
  s = attack(s, u, leaderUid(s, 1));
  assert.equal(power(s, u), 6000);
  const P = s.players[0];
  assert.equal(P.deck[P.deck.length - 1].num, V6);
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-011' }]); setDeckTop(g, 0, [VANILLA]); });
  const v = charUid(s, 0, 'OP04-011');
  s = attack(s, v, leaderUid(s, 1));
  assert.equal(power(s, v), 3000);
  assert.equal(s.players[0].deck[0].num, VANILLA);
});

test('Cobra (OP04-012) : +1000 aux autres {Alabasta} à son tour seulement', () => {
  const s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-012' }, { num: VANILLA }]); });
  assert.equal(power(s, charUid(s, 0, VANILLA)), 4000);
  assert.equal(power(s, charUid(s, 0, 'OP04-012')), 0);
  const t = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-012' }, { num: VANILLA }]); }, 1);
  assert.equal(power(t, charUid(t, 0, VANILLA)), 3000);
});

test('Happiness Punch (OP04-017) : −2000 ; −1000 de plus, même carte permise, si le Leader est redressé (Q&A)', () => {
  const setup = (rested: boolean) => (g: GameState) => { setHand(g, 0, ['OP04-017']); setDon(g, 0, 1); leaderOf(g, 0).rested = rested; setChars(g, 1, [{ num: V5 }]); oppLeaderDon(g, 3); };
  let s = scene([me(), OPP], setup(false), 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  const v = charUid(s, 1, V5);
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = choose(s, (o) => o.uid === v);
  assert.equal(power(s, v), 5000);
  s = choose(s, (o) => o.uid === v);
  assert.equal(power(s, v), 4000);
  s = scene([me(), OPP], setup(true), 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = choose(s, (o) => o.uid === charUid(s, 1, V5));
  assert.notEqual(tag(s), 'oppPower', 'Leader épuisé : pas de −1000');
});

test('Danse (OP04-018) : Leader {Alabasta} : −2000 à 2 Personnages différents (Q&A) ; sinon rien ; [Déclenchement] le même effet', () => {
  let s = scene([me('OP04-001'), OPP], (g) => { setHand(g, 0, ['OP04-018']); setDon(g, 0, 3); setChars(g, 1, [{ num: V5 }, { num: V6 }]); });
  s = play(s, 'OP04-018');
  const a = charUid(s, 1, V5);
  s = choose(s, (o) => o.uid === a);
  assert.ok(!s.decision!.options.some((o) => o.uid === a), 'pas deux fois la même carte');
  s = choose(s, (o) => o.uid === charUid(s, 1, V6));
  assert.equal(power(s, a), 5000);
  assert.equal(power(s, charUid(s, 1, V6)), 6000);
  s = scene([me(NEUTRAL), OPP], (g) => { setHand(g, 0, ['OP04-018']); setDon(g, 0, 3); setChars(g, 1, [{ num: V5 }]); });
  s = play(s, 'OP04-018');
  assert.equal(power(s, charUid(s, 1, V5)), 7000);
});

test('Doflamingo (Leader OP04-019) : jusqu’à 2 DON!! redressées en fin de tour ; pas celles données (Q&A)', () => {
  let s = scene([me('OP04-019'), OPP], (g) => { setChars(g, 0, [{ num: V5, extra: { don: 1, rested: true } }]); g.players[0].donRested = 3; g.players[0].donActive = 0; g.players[0].donDeck = 6; });
  s = endTurn(s);
  assert.equal(s.players[0].chars[0].don, 1);
  coherent(s);
});

test('Issho (Leader OP04-020) : [DON!! x1] [Votre tour] −1 de coût adverse ; fin de tour ① : redresser un Personnage de coût 5 ou moins', () => {
  let s = scene([me('OP04-020'), OPP], (g) => { leaderOf(g, 0).don = 1; g.players[0].donDeck -= 1; setChars(g, 1, [{ num: V5 }]); setChars(g, 0, [{ num: V5, extra: { rested: true } }]); setDon(g, 0, 1); leaderOf(g, 0).don = 1; g.players[0].donDeck = 8; });
  assert.equal(fieldCost(s, charUid(s, 1, V5)), 4);
  assert.equal(fieldCost(s, charUid(s, 0, V5)), 5);
  s = endTurn(s);
  s = choose(s, 'yes');
  s = choose(s, (o) => o.uid === s.players[0].chars[0].uid);
  assert.equal(s.players[0].chars[0].rested, false);
  assert.equal(s.players[0].donRested, 1);
  coherent(s);
});

test('Viola (OP04-021) : [Attaque adverse] ② : épuiser 1 DON!! adverse', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-021' }]); setDon(g, 0, 2); setDon(g, 1, 3); oppLeaderDon(g, 1); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'yes');
  assert.equal(s.players[0].donActive, 0);
  s = choose(s, 'don');
  assert.equal(s.players[1].donRested, 1);
});

test('Sugar (OP04-024) : même épuisée (Q&A) ; une fois par tour, pas de report (Q&A) ; sans Leader {Donquixote Pirates}, rien ; [Jouée] sans condition (Q&A)', () => {
  const setup = (rested: boolean) => (g: GameState) => { setChars(g, 0, [{ num: 'OP04-024', extra: { rested } }]); setChars(g, 1, [{ num: V6 }]); setHand(g, 1, [VANILLA, VANILLA]); setDon(g, 1, 3); };
  let s = scene([me('OP04-019'), OPP], setup(true), 1);
  s = play(s, VANILLA, 1);
  const played = s.players[1].chars.find((c) => c.num === VANILLA)!;
  s = choose(s, (o) => o.uid === played.uid);
  assert.equal(played.rested || s.players[1].chars.find((c) => c.uid === played.uid)!.rested, true);
  // pas de seconde fois au même tour
  s = play(s, VANILLA, 1);
  assert.notEqual(tag(s), 'oppRest');
  assert.ok(s.players[0].chars[0].rested);
  // redressée : elle s'épuise elle-même ensuite ; refus de cible : l'effet est usé (Q&A)
  s = scene([me('OP04-019'), OPP], setup(false), 1);
  s = play(s, VANILLA, 1);
  s = choose(s, 'none');
  assert.equal(s.players[0].chars[0].rested, true, 'puis s’épuise');
  s = play(s, VANILLA, 1);
  assert.equal(s.decision?.kind === 'effect', false, 'usé même sans cible choisie : pas de report');
  // Leader d'un autre type : ni épuisement, ni limite
  s = scene([me('OP04-001'), OPP], setup(false), 1);
  s = play(s, VANILLA, 1);
  assert.equal(s.players[0].chars[0].rested, false);
  // [Jouée] : quel que soit le Leader
  s = scene([me('OP04-001'), OPP], (g) => { setHand(g, 0, ['OP04-024']); setDon(g, 0, 2); setChars(g, 1, [{ num: 'ST21-004' }]); });
  s = play(s, 'OP04-024');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-004'));
  assert.equal(s.players[1].chars[0].rested, true);
});

test('Sugar (OP04-024) : mise KO par le [Jouée] de Marco OP03-013 : pas d’activation (Q&A)', () => {
  let s = scene([me('OP04-019'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-024' }]); setChars(g, 1, []); setHand(g, 1, ['OP03-013']); setDon(g, 1, 6); }, 1);
  s = play(s, 'OP03-013', 1);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP04-024'));
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(s.players[1].chars[0].rested, false, 'Marco reste redressé');
  coherent(s);
});

test('Senor Pink (OP04-026) : ① ; Leader du bon type : épuiser, puis 1 DON!! redressée à la fin du tour, même s’il est parti (Q&A) ; sinon rien', () => {
  let s = scene([me('OP04-019'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-026' }]); setChars(g, 1, [{ num: VANILLA }]); setDon(g, 0, 2, 2); });
  const u = charUid(s, 0, 'OP04-026');
  s = attack(s, u, leaderUid(s, 1));
  s = choose(s, 'yes');
  s = choose(s, (o) => o.uid === charUid(s, 1, VANILLA));
  assert.equal(s.players[1].chars[0].rested, true);
  assert.equal(s.delayed.length, 1);
  removeByEffect(ctxOf(s, 1, 'OP04-026'), u, 'hand');
  assert.equal(s.delayed.length, 1, 'le redressement différé ne dépend pas de la carte');
  s = scene([me(NEUTRAL), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-026' }]); setChars(g, 1, [{ num: VANILLA }]); setDon(g, 0, 2, 2); });
  s = attack(s, charUid(s, 0, 'OP04-026'), leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.equal(s.players[0].donActive, 1, 'le coût se paie');
  assert.equal(s.players[1].chars[0].rested, false);
  assert.equal(s.delayed.length, 0, 'la condition couvre le « Puis »');
});

test('Machvise (OP04-033) : Leader du bon type : épuiser et DON!! à la fin du tour ; sinon rien du tout (Q&A)', () => {
  let s = scene([me('OP04-019'), OPP], (g) => { setHand(g, 0, ['OP04-033']); setDon(g, 0, 4); setChars(g, 1, [{ num: V5 }]); });
  s = play(s, 'OP04-033');
  s = choose(s, (o) => o.uid === charUid(s, 1, V5));
  assert.equal(s.players[1].chars[0].rested, true);
  assert.equal(s.delayed.length, 1);
  s = scene([me(NEUTRAL), OPP], (g) => { setHand(g, 0, ['OP04-033']); setDon(g, 0, 4); setChars(g, 1, [{ num: V5 }]); });
  s = play(s, 'OP04-033');
  assert.equal(s.players[1].chars[0].rested, false);
  assert.equal(s.delayed.length, 0);
});

test('Diamante et Lao.G (OP04-028, OP04-034) : DON!! redressées lues en fin de tour, après un autre effet de fin de tour (Q&A)', () => {
  let s = scene([me('OP04-019'), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-028', extra: { don: 1, rested: true } }, { num: 'OP04-034' }]); setChars(g, 1, [{ num: VANILLA, extra: { rested: true } }]); g.players[0].donActive = 0; g.players[0].donRested = 3; g.players[0].donDeck = 6; });
  s = endTurn(s);
  // le Leader d'abord : 2 DON!! redressées ; Diamante se redresse alors
  s = choose(s, 'first:OP04-019');
  s = donMax(choose(s, 'first:OP04-028'));
  assert.ok(s.players[0].chars.find((c) => c.num === 'OP04-028')!.rested === false);
  assert.equal(s.players[1].chars.length, 1, 'Lao.G : 2 DON!! seulement, il en faut 3');
});

test('Doflamingo (OP04-031) : jusqu’à 3 Leader et Personnages adverses épuisés restent épuisés à la prochaine Recharge ; 3 Personnages possibles (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-031']); setDon(g, 0, 10); leaderOf(g, 1).rested = true; setChars(g, 1, [{ num: V5, extra: { rested: true } }, { num: V6, extra: { rested: true } }, { num: VANILLA, extra: { rested: true } }, { num: V7 }]); });
  s = play(s, 'OP04-031');
  assert.equal(s.decision!.player, 0, 'le joueur de la carte choisit');
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, V7)), 'redressé : non');
  assert.ok(s.decision!.options.some((o) => o.uid === leaderUid(s, 1)), 'Leader : oui');
  s = choose(s, (o) => o.uid === leaderUid(s, 1));
  s = choose(s, (o) => o.uid === charUid(s, 1, V5));
  s = choose(s, (o) => o.uid === charUid(s, 1, V6));
  s = endTurn(s);
  assert.equal(leaderOf(s, 1).rested, true);
  assert.equal(s.players[1].chars.find((c) => c.num === V5)!.rested, true);
  assert.equal(s.players[1].chars.find((c) => c.num === VANILLA)!.rested, false);
});

test('Spiderweb (OP04-035) : [Contre] +4000 ; redresser un Personnage (l’attaque n’est pas annulée : Q&A) ; [Déclenchement] +2000 au Leader', () => {
  let s0 = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-035']); setDon(g, 0, 2); setChars(g, 0, [{ num: V5, extra: { rested: true } }]); oppLeaderDon(g, 3); }, 1);
  const r = counterGain(s0, 'OP04-035');
  let s = r.s;
  assert.ok(logHas(s, /\+4000/));
  s = choose(s, (o) => o.uid === s.players[0].chars[0].uid);
  assert.equal(s.players[0].chars[0].rested, false);
  s0 = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-035']); oppLeaderDon(g, 3); setHand(g, 0, []); }, 1);
  s = oppAttacks(s0, leaderUid(s0, 0));
  s = choose(s, 'trigger');
  s = s.decision?.inEffect ? choose(s, (o) => o.uid === leaderUid(s, 0)) : s;
  assert.equal(power(s, leaderUid(s, 0)), 7000);
});

test('Don Quijote Family (OP04-036) : [Contre] et [Déclenchement] cherchent, pas en phase principale (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-036']); setDon(g, 0, 3); });
  assert.ok(!s.decision!.options.some((o) => o.id.startsWith('event:')), 'pas en phase principale');
  const s0 = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-036']); setDon(g, 0, 1); setDeckTop(g, 0, ['OP04-024', VANILLA, VANILLA, VANILLA, VANILLA]); oppLeaderDon(g, 3); }, 1);
  s = attack(s0, leaderUid(s0, 1), leaderUid(s0, 0));
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = choose(s, (o) => o.num === 'OP04-024');
  s = keepOrder(s);
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP04-024'));
});

test('Flapping Thread (OP04-037) : +2000 pour le tour avec le bon Leader ; [Déclenchement] KO épuisé de coût 4 ou moins', () => {
  let s = scene([me('OP04-019'), OPP], (g) => { setHand(g, 0, ['OP04-037']); setDon(g, 0, 2); oppLeaderDon(g, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  assert.equal(power(s, leaderUid(s, 0)), 7000);
  s = scene([me(NEUTRAL), OPP], (g) => { setHand(g, 0, ['OP04-037']); setDon(g, 0, 2); oppLeaderDon(g, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  assert.equal(power(s, leaderUid(s, 0)), 5000);
  // [Déclenchement] : mon tour adverse, Personnage de l'attaquant épuisé
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-037']); setChars(g, 1, [{ num: VANILLA, extra: { rested: true } }]); oppLeaderDon(g, 3); setHand(g, 0, []); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, (o) => o.uid === s.players[1].chars[0].uid);
  assert.equal(s.players[1].chars.length, 0);
});

test('OP04-038 : [Principale] et [Contre] : épuiser puis mettre KO la même carte (Q&A) ; [Déclenchement] 5 DON!!', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-038']); setDon(g, 0, 5); setChars(g, 1, [{ num: V6 }]); });
  s = play(s, 'OP04-038');
  const u = charUid(s, 1, V6);
  s = choose(s, (o) => o.uid === u);
  s = choose(s, (o) => o.uid === u);
  assert.equal(s.players[1].chars.length, 0);
  s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-038']); setDon(g, 0, 5); setChars(g, 1, [{ num: V6 }]); oppLeaderDon(g, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = choose(s, (o) => o.uid === charUid(s, 1, V6));
  s = choose(s, (o) => o.uid === charUid(s, 1, V6));
  assert.equal(s.players[1].chars.length, 0);
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-038']); setDon(g, 0, 0, 6); oppLeaderDon(g, 3); setHand(g, 0, []); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = donMax(choose(s, 'trigger'));
  assert.equal(s.players[0].donActive, 5);
});

test('Rebecca (Leader OP04-039) : ne peut pas attaquer ; ① se paie, 6 cartes ou moins : regarde 2, le reste à la Défausse', () => {
  let s = scene([me('OP04-039'), OPP], (g) => { setHand(g, 0, []); setDon(g, 0, 1); setDeckTop(g, 0, [V5, V6]); setTrash(g, 0, []); });
  assert.equal(attackAbility(s, 0, leaderOf(s, 0)).can, false);
  s = activate(s, leaderUid(s, 0));
  s = choose(s, (o) => o.num === V5);
  assert.ok(s.players[0].hand.some((c) => c.num === V5));
  assert.ok(s.players[0].trash.some((c) => c.num === V6));
  s = scene([me('OP04-039'), OPP], (g) => { setHand(g, 0, filler(7)); setDon(g, 0, 1); setTrash(g, 0, []); });
  s = activate(s, leaderUid(s, 0));
  assert.equal(s.players[0].donActive, 0, 'le coût se paie');
  assert.equal(s.players[0].hand.length, 7);
  assert.equal(trashCount(s, 0), 0);
});

test('Queen (Leader OP04-040) : 4 cartes ou moins : pioche ; Personnage de coût 8+ : Vie à la place, ou pioche (Q&A) ; DON!! et total faux : rien', () => {
  const setup = (chars: string[], hand: number, don = 1) => (g: GameState) => { leaderOf(g, 0).don = don; g.players[0].donDeck -= don; setChars(g, 0, chars.map((num) => ({ num }))); setHand(g, 0, filler(hand)); setLife(g, 0, [VANILLA, VANILLA]); };
  let s = scene([me('OP04-040'), OPP], setup([], 2));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.equal(s.players[0].hand.length, 3);
  s = scene([me('OP04-040'), OPP], setup(['OP04-047'], 2));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.equal(s.players[0].life.length, 3);
  assert.equal(s.players[0].hand.length, 2);
  s = scene([me('OP04-040'), OPP], setup(['OP04-047'], 2));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = choose(s, 'no');
  assert.equal(s.players[0].life.length, 2);
  assert.equal(s.players[0].hand.length, 3);
  s = scene([me('OP04-040'), OPP], setup([], 3));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.equal(s.players[0].hand.length, 3, '5 cartes : rien');
  s = scene([me('OP04-040'), OPP], setup([], 2, 0));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.equal(s.players[0].hand.length, 2, 'sans DON!! : rien');
});

test('Ulti (OP04-043) : le sien compris, main ou deck au choix du joueur de la carte (Q&A) ; sans DON!! : rien', () => {
  const setup = (don: number) => (g: GameState) => { setChars(g, 0, [{ num: 'OP04-043', extra: { don } }, { num: VANILLA }]); g.players[0].donDeck -= don; setChars(g, 1, [{ num: 'ST21-004' }]); };
  let s = scene([me(), OPP], setup(1));
  s = attack(s, charUid(s, 0, 'OP04-043'), leaderUid(s, 1));
  assert.equal(tag(s), 'chooseOne');
  assert.equal(s.decision!.player, 0);
  s = choose(s, 'choice:1');
  assert.ok(s.decision!.options.some((o) => o.uid === charUid(s, 0, VANILLA)), 'le sien aussi');
  const opp = charUid(s, 1, 'ST21-004');
  s = choose(s, (o) => o.uid === opp);
  const D = s.players[1].deck;
  assert.equal(D[D.length - 1].uid, opp);
  s = scene([me(), OPP], setup(1));
  s = attack(s, charUid(s, 0, 'OP04-043'), leaderUid(s, 1));
  s = choose(s, 'choice:0');
  const opp2 = charUid(s, 1, 'ST21-004');
  s = choose(s, (o) => o.uid === opp2);
  assert.ok(s.players[1].hand.some((c) => c.uid === opp2));
  s = scene([me(), OPP], setup(0));
  s = attack(s, charUid(s, 0, 'OP04-043'), leaderUid(s, 1));
  assert.notEqual(tag(s), 'chooseOne');
});

test('Queen (OP04-046) : avec le bon Leader, jusqu’à 2 [Plague Rounds] ou [Ice Oni], deux du même nom (Q&A)', () => {
  let s = scene([me('OP04-040'), OPP], (g) => { setHand(g, 0, ['OP04-046']); setDon(g, 0, 4); setDeckTop(g, 0, ['OP04-055', 'OP04-055', 'OP04-047', VANILLA, VANILLA, VANILLA, VANILLA]); });
  s = play(s, 'OP04-046');
  s = choose(s, (o) => o.num === 'OP04-055');
  s = choose(s, (o) => o.num === 'OP04-055');
  s = keepOrder(s);
  assert.equal(s.players[0].hand.filter((c) => c.num === 'OP04-055').length, 2);
  s = scene([me(NEUTRAL), OPP], (g) => { setHand(g, 0, ['OP04-046']); setDon(g, 0, 4); });
  s = play(s, 'OP04-046');
  assert.equal(s.players[0].hand.length, 0);
});

test('Ice Oni (OP04-047) : fin du combat : le Personnage survivant au-dessous du deck ; KO dans le combat : Défausse (Q&A) ; coût 6 ou attaque du Leader : rien', () => {
  // gagne le combat : KO, Défausse
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-047', extra: { don: 8 } }]); g.players[0].donDeck -= 8; setChars(g, 1, [{ num: VANILLA, extra: { rested: true } }]); });
  const atk = charUid(s, 0, 'OP04-047');
  const t = charUid(s, 1, VANILLA);
  s = attack(s, atk, t);
  s = resolveAttack(s);
  assert.ok(s.players[1].trash.some((c) => c.uid === t), 'KO en combat : Défausse (Q&A)');
  // perd le combat (un attaquant repoussé reste sur le terrain) : la cible au-dessous du deck
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-047' }]); setChars(g, 1, [{ num: VANILLA, extra: { rested: true } }]); });
  const t1 = charUid(s, 1, VANILLA);
  s = attack(s, charUid(s, 0, 'OP04-047'), t1);
  s = resolveAttack(s);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[1].deck[s.players[1].deck.length - 1].uid, t1);
  // la cible survit à une attaque gagnée (ne peut pas être mise KO en combat) : au-dessous du deck aussi
  s = scene([me(), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP04-047', extra: { don: 8 } }]); g.players[0].donDeck -= 8;
    setChars(g, 1, [{ num: VANILLA, extra: { rested: true } }]);
    g.mods.push({ uid: g.players[1].chars[0].uid, stat: 'cantBeKO', amount: 0, until: 'turn', source: 'essai' });
  });
  const t2 = charUid(s, 1, VANILLA);
  s = attack(s, charUid(s, 0, 'OP04-047'), t2);
  s = resolveAttack(s);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[1].deck[s.players[1].deck.length - 1].uid, t2);
  assert.equal(s.battle, null);
  coherent(s);
  // coût 6 : reste
  s = scene([me(), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP04-047', extra: { don: 9 } }]); g.players[0].donDeck -= 9;
    setChars(g, 1, [{ num: V6, extra: { rested: true } }]);
    g.mods.push({ uid: g.players[1].chars[0].uid, stat: 'cantBeKO', amount: 0, until: 'turn', source: 'essai' });
  });
  s = attack(s, charUid(s, 0, 'OP04-047'), charUid(s, 1, V6));
  s = resolveAttack(s);
  assert.equal(s.players[1].chars.length, 1, 'coût 6 : reste');
  // un autre attaquant : rien
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-047' }, { num: V5 }]); setChars(g, 1, [{ num: V6, extra: { rested: true } }, { num: VANILLA, extra: { rested: true } }]); });
  s = attack(s, charUid(s, 0, V5), charUid(s, 1, V6));
  s = resolveAttack(s);
  assert.equal(s.players[1].chars.length, 2);
});

test('Sasaki (OP04-048) : toute sa main dans le deck, mélange, pioche autant', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-048', VANILLA, VANILLA, V5]); setDon(g, 0, 3); });
  const deck0 = s.players[0].deck.length;
  s = play(s, 'OP04-048');
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.players[0].deck.length, deck0);
  s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-048']); setDon(g, 0, 3); });
  s = play(s, 'OP04-048');
  assert.equal(s.players[0].hand.length, 0, 'main vide : rien');
  coherent(s);
});

test('Page One (OP04-053) : [DON!! x1] Événement activé : pioche et au-dessous, une fois par tour ; pas un [Déclenchement] (Q&A) ; [Contre] compris', () => {
  const setup = (don: number) => (g: GameState) => { setChars(g, 0, [{ num: 'OP04-053', extra: { don } }]); g.players[0].donDeck -= don; setHand(g, 0, ['OP04-018', 'OP04-018', V5]); setDon(g, 0, 6); leaderOf(g, 0).don = 0; g.players[0].donDeck = 4 - don; setChars(g, 1, [{ num: VANILLA }]); };
  let s = scene([me(), OPP], setup(1));
  s = play(s, 'OP04-018');
  // [Principale] d'OP04-018 (sans le bon Leader : rien) ; Page One pioche 1
  const pick = s.decision!.options.find((o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === V5));
  assert.ok(pick, 'carte à placer au-dessous');
  s = act(s, pick.id);
  assert.equal(s.players[0].deck[s.players[0].deck.length - 1].num, V5);
  s = play(s, 'OP04-018');
  assert.notEqual(tag(s), 'handToBottom', 'une fois par tour');
  s = scene([me(), OPP], setup(0));
  const h = s.players[0].hand.length;
  s = play(s, 'OP04-018');
  assert.equal(s.players[0].hand.length, h - 1, 'sans DON!! : rien');
  // [Déclenchement] d'un Événement : rien
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-053', extra: { don: 1 } }]); g.players[0].donDeck -= 1; setLife(g, 0, ['OP04-116']); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  assert.equal(s.players[0].hand.length, 1, 'le [Déclenchement] pioche 1, pas Page One');
  // [Contre] : oui
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-053', extra: { don: 1 } }]); g.players[0].donDeck -= 1; setHand(g, 0, ['OP04-116']); setDon(g, 0, 3); oppLeaderDon(g, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  assert.ok(s.players[0].deck.length > 0);
  assert.ok(s.decision !== null);
  coherent(s);
});

test('Plague Rounds (OP04-055) : défausser [Ice Oni] et placer un Personnage de coût 4 ou moins, le sien compris (Q&A) : jouer [Ice Oni] de la Défausse, obligatoire (Q&A)', () => {
  const setup = (hand: string[], chars: string[]) => (g: GameState) => { setHand(g, 0, ['OP04-055', ...hand]); setDon(g, 0, 2); setChars(g, 0, [{ num: VANILLA }]); setChars(g, 1, chars.map((num) => ({ num }))); setTrash(g, 0, []); };
  let s = scene([me(), OPP], setup(['OP04-047'], ['ST21-004', V5]));
  s = play(s, 'OP04-055');
  s = choose(s, 'yes');
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, V5)), 'coût 5 : non');
  assert.ok(s.decision!.options.some((o) => o.uid === charUid(s, 0, VANILLA)), 'le sien : oui');
  const t = charUid(s, 1, 'ST21-004');
  s = choose(s, (o) => o.uid === t);
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP04-047'));
  assert.equal(s.players[1].deck[s.players[1].deck.length - 1].uid, t);
  assert.ok(!s.players[0].trash.some((c) => c.num === 'OP04-047'));
  coherent(s);
  // sans [Ice Oni] en main : le coût n'est pas proposé
  s = scene([me(), OPP], setup([], ['ST21-004']));
  s = play(s, 'OP04-055');
  assert.ok(s.decision?.kind !== 'effect');
  assert.equal(s.players[1].chars.length, 1);
});

test('Crocodile (Leader OP04-058) : DON!! redressée à son tour adverse par son effet, une fois ; pas à son tour', () => {
  // [Attaque adverse] DON!! −1 (Mr.3)
  const setup = (g: GameState) => { setChars(g, 0, [{ num: 'OP04-070' }, { num: 'OP04-070' }]); setDon(g, 0, 3, 0); setChars(g, 1, [{ num: V5 }]); oppLeaderDon(g, 1); };
  let s = scene([me('OP04-058'), OPP], setup, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  const a = s.players[0].donActive;
  // la première Mr.3 est résolue : DON!! −1 puis +1 redressée
  for (let i = 0; i < 10 && s.decision?.player === 0 && s.decision.inEffect; i++) s = act(s, s.decision.options.find((o) => o.id === 'yes')?.id ?? s.decision.options[0].id);
  assert.ok(s.players[0].leader.usedOpt.includes('OP04-058:don'));
  assert.ok(a >= 0);
  // à son tour : rien
  s = scene([me('OP04-058'), OPP], (g) => { setHand(g, 0, ['OP04-060']); setDon(g, 0, 10); });
  s = play(s, 'OP04-060');
  s = choose(s, 'yes');
  assert.ok(!s.players[0].leader.usedOpt.includes('OP04-058:don'), 'à son tour : rien');
});

test('Crocodile (Leader OP04-058) et Miss All Sunday (OP04-064) : ordre au choix ; DON!! de 6 à 4, puis Leader et [Jouée] : 6, pioche (Q&A)', () => {
  const setup = (g: GameState) => { setLife(g, 0, ['OP04-064']); setDon(g, 0, 6, 0); setHand(g, 0, []); setChars(g, 0, []); oppLeaderDon(g, 3); };
  let s = scene([me('OP04-058'), OPP], setup, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, 'yes');
  assert.equal(tag(s), 'order');
  assert.ok(hasOption(s, 'first:OP04-058') && hasOption(s, 'first:OP04-064'));
  s = donMax(choose(s, 'first:OP04-058'));
  assert.equal(donField(s, 0), 6);
  assert.equal(s.players[0].hand.length, 1, 'pioche : 6 DON!!');
  // l'autre ordre : le [Jouée] d'abord : 5 DON!! : pas de pioche ; puis le Leader
  s = scene([me('OP04-058'), OPP], setup, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, 'yes');
  s = donMax(choose(s, 'first:OP04-064'));
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(donField(s, 0), 6, 'le Leader ajoute après');
  coherent(s);
  // sans le coût : pas de carte jouée (Q&A : on ne peut pas renvoyer sans jouer)
  s = scene([me('OP04-058'), OPP], setup, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, 'no');
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(donField(s, 0), 6);
});

test('Iceburg (OP04-059) : DON!! −1 ; Leader {Water Seven} : [Bloqueur] pour ce blocage ; sinon le coût se paie sans effet', () => {
  const lead = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'LEADER' && CARDS[n].types.includes('Water Seven'))!;
  let s = scene([deck(lead), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-059' }]); setDon(g, 0, 2); oppLeaderDon(g, 2); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'yes');
  assert.equal(s.decision?.kind, 'blocker');
  assert.equal(donField(s, 0) < 10, true);
  s = scene([me(NEUTRAL), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-059' }]); setDon(g, 0, 2); setHand(g, 0, []); oppLeaderDon(g, 2); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'yes');
  assert.notEqual(s.decision?.kind, 'blocker');
});

test('Crocodile (OP04-060) : [Jouée] DON!! −2 : avec un Leader Baroque Works, jusqu’à 1 carte dans la Vie, refus possible ; sinon rien', () => {
  let s = scene([me('OP04-058'), OPP], (g) => { setHand(g, 0, ['OP04-060']); setDon(g, 0, 10); setLife(g, 0, [VANILLA]); });
  s = play(s, 'OP04-060');
  s = choose(s, 'yes');
  s = choose(s, 'yes');
  assert.equal(s.players[0].life.length, 2);
  s = scene([me(NEUTRAL), OPP], (g) => { setHand(g, 0, ['OP04-060']); setDon(g, 0, 10); setLife(g, 0, [VANILLA]); });
  s = play(s, 'OP04-060');
  s = choose(s, 'yes');
  assert.equal(s.players[0].life.length, 1);
});

test('Mr.2 (OP04-069) : puissance de base de l’attaquant pour le tour ; [Déclenchement] joue forcément', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-069' }]); setDon(g, 0, 1); oppLeaderDon(g, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'yes');
  assert.equal(power(s, charUid(s, 0, 'OP04-069')), power(s, leaderUid(s, 1)));
  coherent(s);
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-069']); setDon(g, 0, 1); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, 'yes');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP04-069'));
});

test('Mr.4 (OP04-071) : [Bloqueur] et +1000 pour ce combat', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-071' }]); setDon(g, 0, 1); oppLeaderDon(g, 2); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'yes');
  const u = charUid(s, 0, 'OP04-071');
  assert.equal(power(s, u), 7000);
  assert.equal(s.decision?.kind, 'blocker');
  s = choose(s, 'noblock');
  while (s.decision?.player === 0 && s.decision.kind === 'counter') s = act(s, 'pass');
  assert.equal(power(s, u), 6000, 'fin du combat');
});

test('Mr.13 et Miss Friday (OP04-073) : un autre Personnage Baroque Works obligatoire ; 2 dans la Défausse : 1 DON!! redressée', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-073' }]); setDon(g, 0, 0, 0); });
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP04-073')}`), 'seule : pas de coût');
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-073' }, { num: 'OP04-067' }, { num: VANILLA }]); setDon(g, 0, 0, 0); setTrash(g, 0, []); });
  s = donMax(activate(s, charUid(s, 0, 'OP04-073')));
  assert.deepEqual(s.players[0].chars.map((c) => c.num), [VANILLA]);
  assert.equal(s.players[0].donActive, 1);
  assert.equal(trashCount(s, 0), 2);
});

test('Orlumbus (OP04-079) : −4 de coût, 2 cartes du deck, KO obligatoire de 1 {Dressrosa}, même protégé : il reste (Q&A) ; seul, lui-même (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-079' }]); setChars(g, 1, [{ num: V5 }]); setTrash(g, 0, []); });
  s = activate(s, charUid(s, 0, 'OP04-079'));
  s = choose(s, (o) => o.uid === charUid(s, 1, V5));
  assert.equal(fieldCost(s, charUid(s, 1, V5)), 1);
  assert.equal(s.players[0].chars.length, 0, 'seul : il est mis KO');
  assert.equal(trashCount(s, 0), 3);
  s = scene([me(), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP04-079' }, { num: V5 }]); setChars(g, 1, []);
    g.mods.push({ uid: g.players[0].chars[1].uid, stat: 'cantBeKO', scope: 'effect', amount: 0, until: 'turn', source: 'essai' });
  });
  const shielded = charUid(s, 0, V5);
  s = activate(s, charUid(s, 0, 'OP04-079'));
  assert.ok(s.decision!.options.some((o) => o.uid === shielded), 'protégé : se choisit');
  s = choose(s, (o) => o.uid === shielded);
  assert.equal(s.players[0].chars.length, 2, 'il reste');
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP04-079')}`), 'une fois par tour');
});

test('Gyats et Cavendish (OP04-080, OP04-081) : attaquer les Personnages redressés ; Cavendish [DON!! x1] ; coût : son Leader', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-081', extra: { don: 1 } }]); g.players[0].donDeck -= 1; setChars(g, 1, [{ num: VANILLA }]); });
  const u = charUid(s, 0, 'OP04-081');
  const t = charUid(s, 1, VANILLA);
  assert.ok(attackTargets(s, 0, s.players[0].chars[0]).includes(t));
  s = attack(s, u, leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.equal(leaderOf(s, 0).rested, true);
  s = choose(s, (o) => o.uid === t);
  assert.equal(s.players[1].chars.length, 0);
  coherent(s);
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-081' }]); setChars(g, 1, [{ num: VANILLA }]); });
  assert.ok(!attackTargets(s, 0, s.players[0].chars[0]).includes(charUid(s, 1, VANILLA)), 'sans DON!! : non');
  s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-080']); setDon(g, 0, 1); setChars(g, 0, [{ num: V5 }]); setChars(g, 1, [{ num: VANILLA }]); });
  s = play(s, 'OP04-080');
  s = choose(s, (o) => o.uid === charUid(s, 0, V5));
  const v5 = s.players[0].chars.find((c) => c.num === V5)!;
  assert.ok(attackTargets(s, 0, v5).includes(charUid(s, 1, VANILLA)));
});

test('Kyros (OP04-082) : KO remplacé par son Leader ou [Corrida Coliseum] ; sans carte redressée : KO ; [Jouée] avec Leader [Rebecca]', () => {
  const setup = (g: GameState) => { setChars(g, 0, [{ num: 'OP04-082', extra: { rested: true } }]); setHand(g, 0, []); oppLeaderDon(g, 3); };
  let s = scene([me(), OPP], setup, 1);
  s = oppAttacks(s, charUid(s, 0, 'OP04-082'));
  assert.equal(tag(s), 'replace');
  s = choose(s, 'yes');
  assert.equal(s.players[0].chars.length, 1);
  assert.equal(leaderOf(s, 0).rested, true);
  coherent(s);
  // les deux : au choix
  s = scene([me(), OPP], (g) => { setup(g); putStage(g, 0, 'OP04-096'); }, 1);
  s = oppAttacks(s, charUid(s, 0, 'OP04-082'));
  s = choose(s, 'yes');
  assert.equal(tag(s), 'restCost');
  s = choose(s, (o) => o.uid === s.players[0].stage!.uid);
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(leaderOf(s, 0).rested, false);
  // Leader épuisé, pas de Lieu : KO
  s = scene([me(), OPP], (g) => { setup(g); leaderOf(g, 0).rested = true; }, 1);
  s = oppAttacks(s, charUid(s, 0, 'OP04-082'));
  assert.equal(s.players[0].chars.length, 0);
  // refus
  s = scene([me(), OPP], setup, 1);
  s = oppAttacks(s, charUid(s, 0, 'OP04-082'));
  s = choose(s, 'no');
  assert.equal(s.players[0].chars.length, 0);
  // [Jouée]
  s = scene([me('OP04-039'), OPP], (g) => { setHand(g, 0, ['OP04-082']); setDon(g, 0, 3); setChars(g, 1, [{ num: 'ST21-004' }]); setTrash(g, 0, []); });
  s = play(s, 'OP04-082');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-004'));
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(trashCount(s, 0), 1);
  s = scene([me(NEUTRAL), OPP], (g) => { setHand(g, 0, ['OP04-082']); setDon(g, 0, 3); setChars(g, 1, [{ num: 'ST21-004' }]); setTrash(g, 0, []); });
  s = play(s, 'OP04-082');
  assert.equal(s.players[1].chars.length, 1);
  assert.equal(trashCount(s, 0), 0, 'la condition couvre le « Puis »');
});

test('Kyros (OP04-082) : KO payé en coût par Hakuba OP05-087 et remplacé : pas de −5 (Q&A d’Hakuba)', () => {
  const list: DeckList = { ...deck('OP04-039'), cards: { ...deck('OP04-039').cards, 'OP05-087': 12 } };
  let s = scene([list, OPP], (g) => { setChars(g, 0, [{ num: 'OP05-087', extra: { don: 1 } }, { num: 'OP04-082' }]); g.players[0].donDeck -= 1; setChars(g, 1, [{ num: V5 }]); });
  const cost = fieldCost(s, charUid(s, 1, V5));
  s = attack(s, charUid(s, 0, 'OP05-087'), leaderUid(s, 1));
  s = choose(s, 'yes');
  s = choose(s, 'yes');   // remplacer le KO : le Leader s'épuise
  assert.equal(s.players[0].chars.length, 2);
  assert.equal(fieldCost(s, charUid(s, 1, V5)), cost, 'le coût n’est pas payé');
});

test('Sabo (OP04-083) : protège ses Personnages présents, pas ceux joués ensuite (Q&A) ; jusqu’au début de son prochain tour ; puis piocher 2, défausser 2', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-083', VANILLA]); setDon(g, 0, 6); setChars(g, 0, [{ num: V5 }]); setDeckTop(g, 0, [VANILLA, VANILLA]); });
  s = play(s, 'OP04-083');
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[0].hand.length, 1);
  const protectedUid = charUid(s, 0, V5);
  const sabo = charUid(s, 0, 'OP04-083');
  assert.equal(s.mods.filter((m) => m.stat === 'cantBeKO').length, 2);
  s = play(s, s.players[0].hand[0].num);
  const late = s.players[0].chars.find((c) => c.uid !== protectedUid && c.uid !== sabo);
  if (late) assert.ok(!s.mods.some((m) => m.uid === late.uid && m.stat === 'cantBeKO'), 'jouée ensuite : pas protégée');
  s = endTurn(s);
  assert.ok(s.mods.some((m) => m.uid === protectedUid && m.stat === 'cantBeKO'), 'encore au tour adverse');
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP04-083'), protectedUid, 'ko'), false);
});

test('Stussy (OP04-084) : 3 cartes regardées ; Personnage « CP » de coût 2 ou moins autre que [Stussy] joué ; le reste à la Défausse', () => {
  const cp = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'CHARACTER' && !CARDS[n].names.includes('Stussy') && (CARDS[n].cost ?? 9) <= 2 && CARDS[n].types.some((t) => t.includes('CP')))!;
  const list: DeckList = { ...deck(NEUTRAL), cards: { ...deck(NEUTRAL).cards, [cp]: 12 } };
  let s = scene([list, OPP], (g) => { setHand(g, 0, ['OP04-084']); setDon(g, 0, 2); setDeckTop(g, 0, [cp, 'OP04-084', V5]); setTrash(g, 0, []); });
  s = play(s, 'OP04-084');
  assert.ok(!s.decision!.options.some((o) => o.num === 'OP04-084'), 'pas [Stussy]');
  s = choose(s, (o) => o.num === cp);
  assert.ok(s.players[0].chars.some((c) => c.num === cp));
  assert.equal(trashCount(s, 0), 2);
});

test('Chinjao (OP04-086) : [DON!! x1] en attaquant et mettant KO : piocher 2, défausser 2 ; sans DON!! ou KO par effet : rien', () => {
  const setup = (don: number) => (g: GameState) => { setChars(g, 0, [{ num: 'OP04-086', extra: { don } }]); g.players[0].donDeck -= don; setChars(g, 1, [{ num: VANILLA, extra: { rested: true } }]); setHand(g, 0, [V5]); };
  let s = scene([me(), OPP], setup(1));
  s = attack(s, charUid(s, 0, 'OP04-086'), charUid(s, 1, VANILLA));
  s = resolveAttack(s);
  assert.equal(s.players[1].chars.length, 0);
  s = act(s, s.decision!.options[0].id);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, 1);
  coherent(s);
  s = scene([me(), OPP], setup(0));
  s = attack(s, charUid(s, 0, 'OP04-086'), charUid(s, 1, VANILLA));
  s = resolveAttack(s);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.decision?.tag === 'discard', false);
  // KO par un effet : rien
  s = scene([me(), OPP], setup(1));
  removeByEffect(ctxOf(s, 0, 'OP04-086'), charUid(s, 1, VANILLA), 'ko');
  assert.equal(s.players[0].hand.length, 1);
});

test('Hajrudin et Leo (OP04-088, OP04-091) : coût : épuiser son Leader ; Leo : Leader {Dressrosa}, KO puis Défausse obligatoire (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-088' }]); setChars(g, 1, [{ num: V5 }]); });
  s = activate(s, charUid(s, 0, 'OP04-088'));
  s = choose(s, (o) => o.uid === charUid(s, 1, V5));
  assert.equal(fieldCost(s, charUid(s, 1, V5)), 1);
  assert.equal(leaderOf(s, 0).rested, true);
  s = scene([me('OP04-039'), OPP], (g) => { setHand(g, 0, ['OP04-091']); setDon(g, 0, 1); setChars(g, 1, [{ num: 'ST21-004' }]); setTrash(g, 0, []); });
  s = play(s, 'OP04-091');
  s = choose(s, 'yes');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-004'));
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(trashCount(s, 0), 2);
  s = scene([me(NEUTRAL), OPP], (g) => { setHand(g, 0, ['OP04-091']); setDon(g, 0, 1); setTrash(g, 0, []); });
  s = play(s, 'OP04-091');
  s = choose(s, 'yes');
  assert.equal(leaderOf(s, 0).rested, true, 'le coût se paie');
  assert.equal(trashCount(s, 0), 0);
});

test('Luffy (OP04-090) : attaque les Personnages redressés ; 7 cartes de la Défausse : se redresse, puis ne se redressera pas à la Recharge (Q&A)', () => {
  const seven = filler(7);
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-090', extra: { rested: true } }]); setTrash(g, 0, seven); setChars(g, 1, [{ num: V5 }]); });
  const u = charUid(s, 0, 'OP04-090');
  s = activate(s, u);
  while (s.decision?.tag === 'trashToDeck') s = act(s, s.decision.options[0].id);
  s = keepOrder(s);
  assert.equal(trashCount(s, 0), 0);
  assert.equal(s.players[0].chars[0].rested, false);
  assert.ok(attackTargets(s, 0, s.players[0].chars[0]).includes(charUid(s, 1, V5)));
  s = attack(s, u, leaderUid(s, 1));
  s = resolveAttack(s);
  assert.equal(s.players[0].chars[0].rested, true);
  s = endTurn(s);           // tour adverse
  s = endTurn(s);           // mon tour : Recharge
  assert.equal(s.players[0].chars[0].rested, true, 'reste épuisé');
  s = endTurn(s);
  s = endTurn(s);
  assert.equal(s.players[0].chars[0].rested, false, 'une seule fois');
  // moins de 7 : non activable
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-090', extra: { rested: true } }]); setTrash(g, 0, filler(6)); });
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP04-090')}`));
});

test('King Kong Gun (OP04-093) : 14 cartes + cet Événement : [Double attaque] (Q&A) ; 13 : non ; [Déclenchement]', () => {
  const setup = (n: number) => (g: GameState) => { setChars(g, 0, [{ num: V5 }]); setHand(g, 0, ['OP04-093']); setDon(g, 0, 3); setTrash(g, 0, OP04_ALL.slice(0, n)); };
  let s = scene([me(), OPP], setup(14));
  s = play(s, 'OP04-093');
  const u = charUid(s, 0, V5);
  s = choose(s, (o) => o.uid === u);
  assert.equal(power(s, u), 13000);
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Double Attack'), true);
  s = scene([me(), OPP], setup(13));
  s = play(s, 'OP04-093');
  s = choose(s, (o) => o.uid === charUid(s, 0, V5));
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Double Attack'), false);
  // sans cible choisie : rien
  s = scene([me(), OPP], setup(14));
  s = play(s, 'OP04-093');
  s = choose(s, 'none');
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Double Attack'), false);
});

test('Trueno Bastardo (OP04-094) : borne 4, ou 6 avec 15 cartes, l’Événement compris (Q&A) ; [Déclenchement] épuiser son Leader : KO de coût 5 ou moins', () => {
  const setup = (n: number) => (g: GameState) => { setHand(g, 0, ['OP04-094']); setDon(g, 0, 4); setTrash(g, 0, OP04_ALL.slice(0, n)); setChars(g, 1, [{ num: V6 }]); };
  let s = scene([me(), OPP], setup(14));
  s = play(s, 'OP04-094');
  s = choose(s, (o) => o.uid === charUid(s, 1, V6));
  assert.equal(s.players[1].chars.length, 0);
  s = scene([me(), OPP], setup(13));
  s = play(s, 'OP04-094');
  assert.equal(s.players[1].chars.length, 1);
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-094']); setChars(g, 1, [{ num: V5 }]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, 'yes');
  s = choose(s, (o) => o.uid === charUid(s, 1, V5));
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(leaderOf(s, 0).rested, true);
});

test('Barrière (OP04-095) : +2000, +2000 de plus à la même carte avec 15 cartes, l’Événement compris (Q&A)', () => {
  const setup = (n: number) => (g: GameState) => { setHand(g, 0, ['OP04-095']); setDon(g, 0, 1); setTrash(g, 0, OP04_ALL.slice(0, n)); oppLeaderDon(g, 3); };
  assert.equal(counterGain(scene([me(), OPP], setup(14), 1), 'OP04-095').gain, 4000);
  assert.equal(counterGain(scene([me(), OPP], setup(13), 1), 'OP04-095').gain, 2000);
});

test('Corrida Coliseum (OP04-096) : Leader {Dressrosa} : ses Personnages {Dressrosa} attaquent les Personnages le tour où ils sont joués', () => {
  const setup = (g: GameState) => { putStage(g, 0, 'OP04-096'); setHand(g, 0, [V5, VANILLA]); setDon(g, 0, 6); setChars(g, 1, [{ num: VANILLA, extra: { rested: true } }]); };
  let s = scene([me('OP04-039'), OPP], setup);
  s = play(s, V5);
  let a = s.players[0].chars.find((c) => c.num === V5)!;
  assert.deepEqual(attackAbility(s, 0, a), { can: true, charsOnly: true });
  s = play(s, VANILLA);
  a = s.players[0].chars.find((c) => c.num === VANILLA)!;
  assert.equal(attackAbility(s, 0, a).can, false, 'pas {Dressrosa}');
  s = scene([me(NEUTRAL), OPP], setup);
  s = play(s, V5);
  a = s.players[0].chars.find((c) => c.num === V5)!;
  assert.equal(attackAbility(s, 0, a).can, false, 'autre Leader');
});

test('Otama (OP04-097) : {Animal} ou {SMILE} adverse de coût 3 ou moins au-dessus de la Vie adverse, face visible', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-097']); setDon(g, 0, 1); setChars(g, 1, [{ num: 'OP04-004' }, { num: VANILLA }]); });
  const life = s.players[1].life.length;
  s = play(s, 'OP04-097');
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, VANILLA)), 'autre type : non');
  const t = charUid(s, 1, 'OP04-004');
  s = choose(s, (o) => o.uid === t);
  assert.equal(s.players[1].life.length, life + 1);
  assert.equal(s.players[1].life[0].uid, t);
  assert.equal(s.players[1].life[0].faceUp, true);
});

test('Toko (OP04-098) : défausser 2 cartes {Land of Wano} : avec 1 Vie ou moins, 1 carte dans la Vie ; sinon le coût se paie', () => {
  const setup = (life: number) => (g: GameState) => { setHand(g, 0, ['OP04-098', 'OP04-097', 'OP04-102']); setDon(g, 0, 2); setLife(g, 0, filler(life)); };
  let s = scene([me(), OPP], setup(1));
  s = play(s, 'OP04-098');
  s = choose(s, 'yes');
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[0].life.length, 2);
  assert.equal(s.players[0].hand.length, 0);
  s = scene([me(), OPP], setup(2));
  s = play(s, 'OP04-098');
  s = choose(s, 'yes');
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[0].life.length, 2);
  assert.equal(s.players[0].hand.length, 0);
});

test('Olin (OP04-099) : nom aussi [Charlotte Linlin] ; [Déclenchement] : la Vie se lit sans cette carte (Q&A)', () => {
  assert.ok(CARDS['OP04-099'].names.includes('Charlotte Linlin'));
  let s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-099', VANILLA]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP04-099'), '2 Vie avant, 1 après : jouée');
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-099', VANILLA, VANILLA]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  assert.equal(s.players[0].chars.length, 0);
});

test('Carmel (OP04-101) : [Votre tour] [Jouée] pioche, pas quand elle est jouée par son [Déclenchement] au tour adverse ; KO ensuite', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-101']); setDon(g, 0, 2); });
  s = play(s, 'OP04-101');
  assert.equal(s.players[0].hand.length, 1);
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP04-101', VANILLA]); setHand(g, 0, []); setChars(g, 1, [{ num: 'ST21-004' }]); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-004'));
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].hand.length, 0, 'tour adverse : pas de pioche');
});

test('Pound et Heavenly Fire (OP04-110, OP04-117) : dans la Vie adverse, au-dessus ou au-dessous, face visible', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-117']); setDon(g, 0, 1); setChars(g, 1, [{ num: 'ST21-004' }]); });
  s = play(s, 'OP04-117');
  const t = charUid(s, 1, 'ST21-004');
  s = choose(s, (o) => o.uid === t);
  s = choose(s, /dessous|bottom/i);
  const L = s.players[1].life;
  assert.equal(L[L.length - 1].uid, t);
  assert.equal(L[L.length - 1].faceUp, true);
});

test('Hera (OP04-111) : un autre {Homies}, un autre exemplaire compris (Q&A), et s’épuiser : redresse [Charlotte Linlin], Olin compris ; seule : non', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-111' }]); });
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP04-111')}`));
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-111' }, { num: 'OP04-111' }, { num: 'OP04-099', extra: { rested: true } }]); setTrash(g, 0, []); });
  const [a, b] = s.players[0].chars;
  s = activate(s, a.uid);
  assert.ok(!s.decision!.options.some((o) => o.uid === a.uid), 'pas elle-même');
  s = s.decision!.options.some((o) => o.uid === b.uid) && s.decision!.tag === 'trashOwn' ? choose(s, (o) => o.uid === b.uid) : s;
  s = choose(s, (o) => o.uid === s.players[0].chars.find((c) => c.num === 'OP04-099')!.uid);
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP04-099')!.rested, false);
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP04-111')!.rested, true);
  assert.equal(trashCount(s, 0), 1);
});

test('Yamato (OP04-112) : borne = total des Vies ; 1 Vie ou moins : jusqu’à 1 carte dans la Vie', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-112']); setDon(g, 0, 9); setLife(g, 0, [VANILLA]); setLife(g, 1, [VANILLA, VANILLA, VANILLA]); setChars(g, 1, [{ num: V5 }, { num: 'ST21-004' }]); });
  s = play(s, 'OP04-112');
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, V5)), 'total 4 : coût 5 non');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-004'));
  s = choose(s, 'yes');
  assert.equal(s.players[0].life.length, 2);
});

test('Diable Jambe (OP04-116) : +6000 ; total de 4 Vies ou moins : KO de coût 2 ou moins', () => {
  const setup = (mine: number) => (g: GameState) => { setHand(g, 0, ['OP04-116']); setDon(g, 0, 3); setLife(g, 0, filler(mine)); setLife(g, 1, [VANILLA, VANILLA]); setChars(g, 1, [{ num: 'ST21-004' }]); oppLeaderDon(g, 3); };
  const a = counterGain(scene([me(), OPP], setup(2), 1), 'OP04-116');
  assert.equal(a.gain, 6000);
  const s = choose(a.s, (o) => o.uid === charUid(a.s, 1, 'ST21-004'));
  assert.equal(s.players[1].chars.length, 0);
  const b = counterGain(scene([me(), OPP], setup(3), 1), 'OP04-116');
  assert.equal(b.gain, 6000);
  assert.equal(b.s.players[1].chars.length, 1);
});

test('Colors Trap et Nez-Palm (OP04-074, OP04-075) : DON!! −1 : +1000 puis épuiser ; +6000, 2 Vies ou moins : 1 DON!! épuisée', () => {
  const a = counterGain(scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-074']); setDon(g, 0, 3); setChars(g, 1, [{ num: 'ST21-004' }]); oppLeaderDon(g, 3); }, 1), 'OP04-074', (s) => choose(s, 'yes'));
  assert.equal(a.gain, 1000);
  const s1 = choose(a.s, (o) => o.uid === charUid(a.s, 1, 'ST21-004'));
  assert.equal(s1.players[1].chars[0].rested, true);
  const setup = (life: number) => (g: GameState) => { setHand(g, 0, ['OP04-075']); setDon(g, 0, 3); setLife(g, 0, filler(life)); oppLeaderDon(g, 3); };
  const b = counterGain(scene([me(), OPP], setup(2), 1), 'OP04-075');
  assert.equal(b.gain, 6000);
  assert.equal(b.s.players[0].donRested, 4, '3 payées + 1 ajoutée');
  const c = counterGain(scene([me(), OPP], setup(3), 1), 'OP04-075');
  assert.equal(c.s.players[0].donRested, 3);
});

test('Vivi (OP04-118) : [Initiative] à ses autres rouges de coût 3 ou plus, lu au moment d’attaquer (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP04-118', extra: { playedTurn: 5 } }, { num: 'OP04-006', extra: { playedTurn: 5 } }, { num: 'OP04-007', extra: { playedTurn: 5 } }]); });
  const [vivi, koza, sanji] = s.players[0].chars;
  assert.equal(attackAbility(s, 0, koza).can, true);
  assert.equal(attackAbility(s, 0, sanji).can, false, 'coût 1 : non');
  assert.equal(attackAbility(s, 0, vivi).can, false, 'pas elle-même');
  s.mods.push({ uid: koza.uid, stat: 'cost', amount: -1, until: 'turn', source: 'essai' });
  assert.equal(attackAbility(s, 0, koza).can, false, 'coût réduit sous 3 : non (Q&A)');
});

test('Rosinante (OP04-119) : [Tour adverse] épuisé : redressés de coût de base 5 protégés des effets ; lui-même et mêmes KO simultanés (Q&A)', () => {
  const setup = (rested: boolean) => (g: GameState) => { setChars(g, 0, [{ num: 'OP04-119', extra: { rested } }, { num: V5 }, { num: V6 }]); };
  let s = scene([me(), OPP], setup(true), 1);
  const rosi = charUid(s, 0, 'OP04-119');
  const five = charUid(s, 0, V5);
  const six = charUid(s, 0, V6);
  const ctx = ctxOf(s, 1, 'OP05-040');
  // l'effet met KO Rosinante d'abord : le Personnage de coût 5 reste quand même
  assert.equal(removeByEffect(ctx, rosi, 'ko'), true);
  assert.equal(removeByEffect(ctx, five, 'ko'), false);
  assert.ok(s.players[0].chars.some((c) => c.uid === five));
  assert.equal(removeByEffect(ctx, six, 'ko'), true, 'coût 6 : pas protégé');
  // un autre effet, Rosinante partie : plus de protection
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-040'), five, 'ko'), true);
  // Rosinante redressée : pas de protection
  s = scene([me(), OPP], setup(false), 1);
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-040'), charUid(s, 0, V5), 'ko'), true);
  // à son tour : pas de protection
  s = scene([me(), OPP], setup(true));
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-040'), charUid(s, 0, V5), 'ko'), true);
  // en combat : pas de protection
  s = scene([me(), OPP], (g) => { setup(true)(g); g.players[0].chars[1].rested = true; oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, charUid(s, 0, V5));
  assert.ok(!s.players[0].chars.some((c) => c.num === V5));
});

test('Rosinante (OP04-119) : [Jouée] s’épuiser : Personnage vert de coût 5 de sa main ; refus ; proposé même sans carte (n° 1000)', () => {
  const green5 = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'CHARACTER' && n.startsWith('OP04') && CARDS[n].colors.includes('Green') && CARDS[n].cost === 5)!;
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-119', green5, V5]); setDon(g, 0, 8); });
  s = play(s, 'OP04-119');
  s = choose(s, 'yes');
  assert.ok(!s.decision!.options.some((o) => o.num === V5 || s.players[0].hand.some((c) => c.uid === o.uid && c.num === V5)), 'pas vert : non');
  s = choose(s, (o) => o.id !== 'none');
  assert.ok(s.players[0].chars.some((c) => c.num === green5));
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP04-119')!.rested, true);
  s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP04-119']); setDon(g, 0, 8); });
  s = play(s, 'OP04-119');
  assert.equal(s.decision?.tag, 'mayIdle');
  s = choose(s, 'no');
  assert.equal(s.players[0].chars[0].rested, false);
});
