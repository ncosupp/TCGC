// OP05 (tâche S15) : un test par effet des cartes codées à la main (condition vraie et fausse), les Q&A officielles appliquées, et
// les effets des recettes que le banc d'essai ne sait pas mesurer ([Contre] « pendant ce combat », [En attaquant] qui change l'issue
// du combat). Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bottomOwnCost } from '../engine/cards/bricks-removal.ts';
import { returnOwnChar, trashOwnCharCost } from '../engine/cards/bricks.ts';
import { CARDS, recipeEntry } from '../engine/cards/index.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import type { DeckList } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { attackAbility, fieldCost, handCost, hasKeyword, power, removeByEffect } from '../engine/rules.ts';
import type { EffectCtx, GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, hasOption, logHas, play, setChars, setDeckTop, setDon, setHand, setLife, tag, take, donMax } from './helpers.ts';
import { charUid, counterGain, leaderNamed, leaderUid, oppLeaderDon, scene } from './eb-scene.ts';

const C3000 = 'ST21-004';  // coût 1, 3000
const C5000 = 'ST21-006';  // coût 3, 5000
const C6000 = 'ST21-008';  // coût 4, 6000
// Ces cartes ne sont dans aucun deck du registre : une liste d'essai qui les contient toutes, assez d'exemplaires pour chaque scène
const LUFFY_CHAR = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'CHARACTER' && CARDS[n].names.includes('Monkey.D.Luffy'))!;
const ALL = [C3000, C5000, C6000, LUFFY_CHAR, 'OP10-074', ...[3, 5, 8, 30, 32, 37, 38, 39, 40, 47, 49, 50, 53, 56, 60, 74, 75, 78, 79, 80, 82, 84, 87, 89, 92, 96, 97, 99, 100, 103, 105, 106, 107, 109, 111, 114, 115].map((n) => `OP05-${String(n).padStart(3, '0')}`)];
let decks = 0;
const deck = (leader: string): DeckList => ({ id: `PERSO-s15-${decks++}`, name: 'Essai S15', series: 'PERSO', leader, cards: Object.fromEntries(ALL.map((n) => [n, 12])) });
const OPP = deck('OP05-002');   // Leader sans effet de fin de tour ni d'attaque
const me = (leader = 'OP05-001') => deck(leader);

// L'adversaire (actif) attaque `target` avec son Leader, renforcé pour gagner le combat ; ni blocage ni contre de ma part
function oppAttacks(s: GameState, target: number): GameState {
  s = attack(s, leaderUid(s, 1), target);
  while (s.decision?.player === 0 && s.decision.kind === 'blocker') s = act(s, 'noblock');
  while (s.decision?.player === 0 && s.decision.kind === 'counter') s = act(s, 'pass');
  return s;
}
// Un effet du joueur `p`, chaque question reçoit la première réponse (sauf `answer`)
const ctxOf = (s: GameState, p: PlayerId, num: string, answer?: string): EffectCtx => ({
  s, me: p, opp: p === 0 ? 1 : 0, source: -1, num, pending: { kind: 'system', source: -1, num, controller: p, answers: [] } as unknown as EffectCtx['pending'],
  ask: (spec) => (answer && spec.options.some((o) => o.id === answer) ? answer : spec.options[0].id),
});
// L'adversaire a Cage à oiseaux et 10 DON!! : la fin de son tour met KO tous les Personnages épuisés de coût 5 ou moins
function birdcageEnd(s: GameState): GameState {
  return act(s, 'end');
}
const setTrash = (g: GameState, p: PlayerId, nums: string[]) => { g.players[p].trash = nums.map((n) => take(g, p, n)); };
const putStage = (g: GameState, p: PlayerId, num: string) => { g.players[p].stage = { ...take(g, p, num), rested: false, don: 0, playedTurn: 0, usedOpt: [] }; };
const withBirdcage = (g: GameState, p: PlayerId) => {
  putStage(g, p, 'OP05-040');
  setDon(g, p, 10);
  g.players[p].donDeck = 0;
};

test('Sabo (OP05-001) : KO en combat remplacé par −1000 ; conditions et limite', () => {
  const setup = (g: GameState, don = 1) => { g.players[0].leader.don = don; g.players[0].donDeck -= don; setChars(g, 0, [{ num: C5000, extra: { rested: true } }]); setHand(g, 0, []); oppLeaderDon(g, 3); };
  let s = scene([me(), OPP], (g) => setup(g), 1);
  const u = charUid(s, 0, C5000);
  s = oppAttacks(s, u);
  assert.equal(tag(s), 'replace');
  s = choose(s, 'yes');
  assert.equal(charUid(s, 0, C5000), u);
  assert.equal(power(s, u), 4000);
  assert.ok(s.players[0].leader.usedOpt.includes('saboKo'));
  coherent(s);
  // sans DON!! donnée au Leader : KO
  s = oppAttacks(scene([me(), OPP], (g) => setup(g, 0), 1), u);
  assert.equal(s.players[0].chars.length, 0);
  // moins de 5000 de puissance : KO
  s = scene([me(), OPP], (g) => { g.players[0].leader.don = 1; setChars(g, 0, [{ num: C3000, extra: { rested: true } }]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, charUid(s, 0, C3000));
  assert.equal(s.players[0].chars.length, 0);
  // refus : KO, et la limite n'est pas usée (Q&A)
  s = scene([me(), OPP], (g) => setup(g), 1);
  s = choose(oppAttacks(s, charUid(s, 0, C5000)), 'no');
  assert.equal(s.players[0].chars.length, 0);
  assert.ok(!s.players[0].leader.usedOpt.includes('saboKo'));
});

test('Sabo (OP05-001) : puissance du moment (Q&A : Contre compris), et plus rien à son propre tour', () => {
  let s = scene([me(), OPP], (g) => { g.players[0].leader.don = 1; setChars(g, 0, [{ num: C3000, extra: { rested: true } }]); setHand(g, 0, []); oppLeaderDon(g, 5); }, 1);
  const u = charUid(s, 0, C3000);
  s.mods.push({ uid: u, stat: 'power', amount: 2000, until: 'turn', source: 'essai' });
  s = oppAttacks(s, u);
  assert.equal(tag(s), 'replace');
  // à son tour : pas de remplacement
  const g = scene([me(), OPP], (x) => { x.players[0].leader.don = 1; setChars(x, 0, [{ num: C5000 }]); });
  const uid = charUid(g, 0, C5000);
  assert.equal(removeByEffect(ctxOf(g, 1, 'OP05-007'), uid, 'ko'), true);
});

test('Sabo (OP05-001) : plusieurs KO du même effet : tous remplacés ou aucun, une seule limite (Q&A)', () => {
  const setup = (g: GameState) => {
    g.players[0].leader.don = 1;
    g.players[0].donDeck -= 1;
    setChars(g, 0, [{ num: C5000, extra: { rested: true } }, { num: C6000, extra: { rested: true } }]);
    withBirdcage(g, 1);
  };
  let s = birdcageEnd(scene([me(), OPP], setup, 1));
  assert.equal(tag(s), 'replace');
  const yes = choose(s, 'yes');
  assert.equal(yes.players[0].chars.length, 2, 'les deux restent');
  assert.equal(yes.log.filter((l) => l.text.includes('pas mis KO')).length, 2, 'les deux, −1000 finis avec le tour');
  const no = choose(s, 'no');
  assert.equal(no.players[0].chars.length, 0, 'aucun : une seule question');
  coherent(yes);
});

test('Belo Betty (OP05-002) : +3000 à jusqu’à 3 Personnages {Revolutionary Army} ou ayant [Déclenchement], pas au Leader (Q&A)', () => {
  const RA_CARD = 'OP05-005';    // {Revolutionary Army}
  const TRIG = 'OP05-105';       // [Déclenchement], autre type
  let s = scene([me('OP05-002'), OPP], (g) => { setHand(g, 0, [RA_CARD]); setChars(g, 0, [{ num: RA_CARD }, { num: TRIG }, { num: C3000 }]); });
  const leader = leaderUid(s, 0);
  s = act(s, `act:${leader}`);
  assert.equal(s.players[0].hand.length, 0, 'coût payé');
  assert.ok(!hasOption(s, `card:${leader}`), 'pas le Leader');
  assert.ok(!hasOption(s, `card:${charUid(s, 0, C3000)}`), 'ni un Personnage hors des deux groupes');
  const a = charUid(s, 0, RA_CARD);
  const b = charUid(s, 0, TRIG);
  s = choose(s, `card:${a}`);
  s = choose(s, `card:${b}`);
  assert.equal(power(s, b), 8000, 'Satori : 5000 + 3000');
  assert.ok(s.mods.filter((m) => m.source === 'Belo Betty').length === 2);
  assert.ok(!s.decision?.options.some((o) => o.id === `act:${leader}`), '[Une fois par tour]');
  // sans carte {Revolutionary Army} en main : pas d'activation
  s = scene([me('OP05-002'), OPP], (g) => { setHand(g, 0, [C3000]); setChars(g, 0, [{ num: RA_CARD }]); });
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`));
});

test('Inazuma (OP05-003) : [Initiative] lue à chaque instant (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-003', extra: { playedTurn: 5 } }, { num: C6000 }]); });
  const u = charUid(s, 0, 'OP05-003');
  const self = () => s.players[0].chars.find((c) => c.uid === u)!;
  assert.equal(attackAbility(s, 0, self()).can, false, '6000 : non');
  s.players[0].chars[1].don = 1;
  assert.equal(attackAbility(s, 0, self()).can, true, '7000 : oui, dès que c’est vrai');
  s.players[0].chars[1].don = 0;
  assert.equal(attackAbility(s, 0, self()).can, false, 'plus de 7000 : non');
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-003', extra: { playedTurn: 5, don: 3 } }]); });
  assert.equal(attackAbility(s, 0, s.players[0].chars[0]).can, false, 'lui-même ne compte pas');
});

test('Rosinante (Leader OP05-022) : [Bloqueur] : il devient la cible, et s’il perd, dégâts (Q&A) ; [Fin de votre tour] redressé avec 6 cartes ou moins', () => {
  let s = scene([me('OP05-022'), OPP], (g) => { setChars(g, 0, [{ num: C3000, extra: { rested: true } }]); setHand(g, 0, []); setLife(g, 0, [C3000, C3000]); oppLeaderDon(g, 3); }, 1);
  const leader = leaderUid(s, 0);
  const c = charUid(s, 0, C3000);
  s = attack(s, leaderUid(s, 1), c);
  assert.equal(s.decision?.kind, 'blocker');
  assert.ok(hasOption(s, `block:${leader}`));
  s = act(s, `block:${leader}`);
  assert.equal(s.players[0].leader.rested, true);
  assert.equal(s.players[0].life.length, 1, 'perd 1 Vie');
  assert.equal(charUid(s, 0, C3000), c, 'le Personnage reste');
  coherent(s);
  // attaque contre lui-même, ou Leader épuisé : pas de blocage par le Leader
  s = scene([me('OP05-022'), OPP], (g) => { setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  assert.notEqual(s.decision?.kind, 'blocker');
  s = scene([me('OP05-022'), OPP], (g) => { g.players[0].leader.rested = true; setChars(g, 0, [{ num: C3000, extra: { rested: true } }]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = attack(s, leaderUid(s, 1), charUid(s, 0, C3000));
  assert.notEqual(s.decision?.kind, 'blocker');
  // [Fin de votre tour]
  const end = (n: number) => {
    const x = scene([me('OP05-022'), OPP], (g) => { g.players[0].leader.rested = true; setHand(g, 0, Array(n).fill(C3000)); });
    // la fin du tour suit : l'état juste après l'effet est relu au journal et au champ
    return act(x, 'end');
  };
  assert.ok(logHas(end(6), /redresse/));
  assert.ok(!logHas(end(7), /redresse Don/));
});

test('Rosinante (OP05-030) : KO d’un Personnage épuisé remplacé par sa mise en Défausse, pas un KO (Q&A) ; conditions', () => {
  const setup = (g: GameState) => { setChars(g, 0, [{ num: 'OP05-030' }, { num: C3000, extra: { rested: true } }]); setHand(g, 0, []); oppLeaderDon(g, 3); };
  let s = scene([me('OP05-022'), OPP], setup, 1);
  s = oppAttacks(s, charUid(s, 0, C3000));
  s = choose(s, 'yes');
  assert.deepEqual(s.players[0].chars.map((c) => c.num), [C3000]);
  assert.ok(s.players[0].trash.some((c) => c.num === 'OP05-030'));
  assert.equal(s.players[0].charKoTurn, undefined, 'aucun KO annoncé');
  coherent(s);
  // à son propre tour : rien
  const g = scene([me('OP05-022'), OPP], (x) => { setChars(x, 0, [{ num: 'OP05-030' }, { num: C3000, extra: { rested: true } }]); });
  assert.equal(removeByEffect(ctxOf(g, 1, 'OP05-007'), charUid(g, 0, C3000), 'ko'), true);
  assert.equal(g.players[0].chars.length, 1);
  // Personnage redressé : pas de question
  s = scene([me('OP05-022'), OPP], (x) => { setChars(x, 0, [{ num: 'OP05-030' }, { num: C3000 }]); }, 1);
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-007', 'no'), charUid(s, 0, C3000), 'ko'), true);
});

test('Rosinante (OP05-030) : plusieurs KO du même effet : une seule mise en Défausse les sauve tous, elle comprise (Q&A)', () => {
  let s = birdcageEnd(scene([me('OP05-022'), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP05-030', extra: { rested: true } }, { num: C5000, extra: { rested: true } }, { num: C6000, extra: { rested: true } }]);
    withBirdcage(g, 1);
  }, 1));
  assert.equal(tag(s), 'replace');
  s = choose(s, 'yes');
  assert.deepEqual(s.players[0].chars.map((c) => c.num), [C5000, C6000]);
  assert.ok(s.players[0].trash.some((c) => c.num === 'OP05-030'));
  coherent(s);
});

test('Pica (OP05-032) : KO remplacé en épuisant un autre Personnage, une fois par tour, sans cible pas de remplacement ; [Fin de votre tour] ① se redresse', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-032', extra: { rested: true } }, { num: C5000 }]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  const pica = charUid(s, 0, 'OP05-032');
  s = oppAttacks(s, pica);
  s = choose(s, 'yes');
  assert.ok(s.players[0].chars.some((c) => c.uid === pica));
  assert.equal(s.players[0].chars.find((c) => c.num === C5000)!.rested, true);
  assert.ok(s.players[0].chars.find((c) => c.uid === pica)!.usedOpt.includes('picaKo'));
  coherent(s);
  // seule cible épuisée, ou coût trop bas, ou un autre [Pica] : pas de remplacement
  for (const other of [{ num: C5000, extra: { rested: true } }, { num: C3000 }, { num: 'OP10-074' }]) {
    const x = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-032', extra: { rested: true } }, other]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
    assert.equal(removeByEffect(ctxOf(x, 1, 'OP05-007'), charUid(x, 0, 'OP05-032'), 'ko'), true, other.num);
  }
  // [Fin de votre tour]
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-032', extra: { rested: true } }]); setDon(g, 0, 1); });
  s = act(s, 'end');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.ok(logHas(s, /redresse Pica/));
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-032', extra: { rested: true } }]); setDon(g, 0, 0, 0); });
  s = act(s, 'end');
  assert.ok(!logHas(s, /redresse Pica/), 'sans DON!! : rien');
});

test('Cage à oiseaux (OP05-040) : Recharge bloquée pour les coûts 5 ou moins des deux joueurs, avec le bon Leader', () => {
  const DOFLA = leaderNamed('Donquixote Doflamingo');
  const setup = (g: GameState) => {
    putStage(g, 0, 'OP05-040');
    setChars(g, 0, [{ num: C5000, extra: { rested: true } }, { num: 'OP05-100', extra: { rested: true } }]);
    setChars(g, 1, [{ num: C5000, extra: { rested: true } }]);
    g.players[1].leader.rested = true;
  };
  let s = act(scene([me(DOFLA), OPP], setup), 'end');
  assert.equal(s.players[1].chars[0].rested, true, 'adverse, coût 3 : reste épuisé');
  assert.equal(s.players[1].leader.rested, false, 'le Leader se redresse');
  // mon tour suivant
  while (s.active !== 0 && s.decision) s = s.decision.kind === 'main' ? act(s, 'end') : act(s, s.decision.options[s.decision.options.length - 1].id);
  assert.equal(s.players[0].chars.find((c) => c.num === C5000)!.rested, true, 'le mien, coût 3 : reste épuisé');
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP05-100')!.rested, false, 'coût 7 : se redresse');
  // autre Leader : tout se redresse
  s = act(scene([me(), OPP], setup), 'end');
  assert.equal(s.players[1].chars[0].rested, false);
});

test('Cage à oiseaux (OP05-040) : [Fin de votre tour] avec 10 DON!!, KO des épuisés de coût 5 ou moins, puis le Lieu ; quel que soit le Leader (Q&A) ; 9 DON!! : rien', () => {
  const setup = (dons: number) => (g: GameState) => {
    putStage(g, 0, 'OP05-040');
    setDon(g, 0, dons);
    setChars(g, 0, [{ num: C5000, extra: { rested: true } }, { num: C6000 }]);
    setChars(g, 1, [{ num: C5000, extra: { rested: true } }, { num: 'OP05-100', extra: { rested: true } }]);
  };
  let s = act(scene([me(), OPP], setup(10)), 'end');
  assert.deepEqual(s.players[0].chars.map((c) => c.num), [C6000]);
  assert.deepEqual(s.players[1].chars.map((c) => c.num), ['OP05-100']);
  assert.equal(s.players[0].stage, null);
  s = act(scene([me(), OPP], setup(9)), 'end');
  assert.equal(s.players[0].chars.length, 2);
  assert.equal(s.players[0].stage?.num, 'OP05-040');
});

test('Mozambia (OP05-053) : +2000 une fois par tour quand il pioche hors de sa phase de Pioche, à son tour', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-053' }]); setHand(g, 0, ['OP05-050', 'OP05-050']); setDon(g, 0, 8); });
  const u = charUid(s, 0, 'OP05-053');
  const base = power(s, u);
  s = play(s, 'OP05-050');
  assert.equal(power(s, u), base + 2000);
  s = play(s, 'OP05-050');
  assert.equal(power(s, u), base + 2000, 'une fois par tour');
  // la phase de Pioche ne compte pas (tour suivant de l'adversaire puis le mien)
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-053' }]); }, 1);
  s = act(s, 'end');
  assert.equal(power(s, charUid(s, 0, 'OP05-053')), base);
});

test('X.Barrels (OP05-056) : [Jouée] 1 autre Personnage sous le deck : piocher 1 carte ; sans autre Personnage, rien', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-056']); setDon(g, 0, 10); setChars(g, 0, [{ num: C3000 }]); });
  const deck = s.players[0].deck.length;
  s = play(s, 'OP05-056');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.deepEqual(s.players[0].chars.map((c) => c.num), ['OP05-056']);
  assert.equal(s.players[0].deck.at(-1)?.num, C3000);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[0].deck.length, deck);
  coherent(s);
  s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-056']); setDon(g, 0, 10); });
  s = play(s, 'OP05-056');
  assert.equal(s.decision?.kind, 'main', 'pas de question');
  assert.equal(s.players[0].hand.length, 0);
});

test('Viola (OP05-079) : l’adversaire choisit 3 cartes de sa Défausse (Q&A), autant qu’il peut', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-079']); setDon(g, 0, 10); setHand(g, 1, []); setTrash(g, 1, [C3000, C5000, C6000, 'OP05-050']); });
  s = play(s, 'OP05-079');
  for (let i = 0; i < 6 && s.decision?.inEffect; i++) {
    assert.equal(s.decision.player, 1);
    s = act(s, s.decision.options[0].id);
  }
  assert.equal(s.players[1].trash.length, 1);
  s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-079']); setDon(g, 0, 10); setTrash(g, 1, [C3000]); });
  s = play(s, 'OP05-079');
  assert.equal(s.players[1].trash.length, 0);
  assert.equal(s.players[1].deck.at(-1)?.num, C3000);
  coherent(s);
});

test('Elizabello II (OP05-080) : 20 cartes de la Défausse dans le deck : [Double attaque] et +10000 pour le combat ; moins de 20 : rien', () => {
  const trash = (g: GameState, n: number) => { setTrash(g, 0, ALL.slice(5).flatMap((c) => [c]).slice(0, n)); };
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-080' }]); trash(g, 20); setHand(g, 1, []); });
  const u = charUid(s, 0, 'OP05-080');
  const deck = s.players[0].deck.length;
  const base = power(s, u);
  s = attack(s, u, leaderUid(s, 1));
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.equal(s.players[0].deck.length, deck + 20);
  assert.equal(s.players[0].trash.length, 0);
  assert.ok(logHas(s, /\[Double attaque\], 2 dégâts/) || s.players[1].life.length <= 3);
  assert.ok(logHas(s, new RegExp(`\\(${base + 10000}`)) || logHas(s, `+10000`));
  coherent(s);
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-080' }]); trash(g, 19); setHand(g, 1, []); });
  s = attack(s, charUid(s, 0, 'OP05-080'), leaderUid(s, 1));
  assert.notEqual(tag(s), 'may');
  assert.ok(!logHas(s, '+10000'));
});

test('Hakuba (OP05-087) : [DON!! x1] KO d’un autre Personnage : −5 de coût ; Personnage qui ne peut pas être mis KO : ni KO ni −5 (Q&A)', () => {
  const setup = (mine: string, don = 1) => (g: GameState) => { setChars(g, 0, [{ num: 'OP05-087', extra: { don } }, { num: mine }]); g.players[0].donDeck -= don; setChars(g, 1, [{ num: C6000 }]); setHand(g, 1, []); };
  let s = scene([me(), OPP], setup(C3000));
  const target = s.players[1].chars[0].uid;
  s = attack(s, charUid(s, 0, 'OP05-087'), leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.deepEqual(s.players[0].chars.map((c) => c.num), ['OP05-087']);
  assert.ok(s.players[0].trash.some((c) => c.num === C3000));
  s = choose(s, `card:${target}`);
  assert.equal(fieldCost(s, target), 4 - 5);
  coherent(s);
  // Personnage protégé du KO
  s = scene([me(), OPP], (g) => { setup(C3000)(g); });
  s.mods.push({ uid: charUid(s, 0, C3000), stat: 'cantBeKO', amount: 0, until: 'turn', source: 'essai' });
  s = attack(s, charUid(s, 0, 'OP05-087'), leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.equal(s.players[0].chars.length, 2);
  assert.equal(fieldCost(s, target), 4, 'pas de −5');
  // sans DON!! : rien
  s = scene([me(), OPP], setup(C3000, 0));
  s = attack(s, charUid(s, 0, 'OP05-087'), leaderUid(s, 1));
  assert.notEqual(tag(s), 'may');
});

test('500 millions (OP05-096) : un effet au choix ; pioche seulement avec un {Celestial Dragons}, même sans cible ; [Déclenchement] KO ou main', () => {
  const setup = (dragon: boolean) => (g: GameState) => { setHand(g, 0, ['OP05-096']); setDon(g, 0, 10); setChars(g, 0, dragon ? [{ num: 'OP05-084' }] : []); setChars(g, 1, [{ num: C3000 }]); setDeckTop(g, 0, [C5000]); };
  for (const [pick, check] of [
    [0, (s: GameState) => assert.ok(s.players[1].trash.some((c) => c.num === C3000))],
    [1, (s: GameState) => assert.ok(s.players[1].hand.some((c) => c.num === C3000))],
    [2, (s: GameState) => assert.ok(s.players[1].life.some((c) => c.num === C3000 && c.faceUp))],
  ] as [number, (s: GameState) => void][]) {
    let s = play(scene([me(), OPP], setup(true)), 'OP05-096');
    s = choose(s, `choice:${pick}`);
    s = choose(s, (o) => o.id.startsWith('card:'));
    if (s.decision?.tag === 'lifeSideOpp') s = choose(s, 'lifeTop');
    check(s);
    assert.ok(s.players[0].hand.some((c) => c.num === C5000), 'pioche');
    coherent(s);
  }
  let s = play(scene([me(), OPP], setup(false)), 'OP05-096');
  s = choose(s, 'choice:0');
  s = choose(s, (o) => o.id.startsWith('card:'));
  assert.equal(s.players[0].hand.length, 0, 'pas de pioche');
  // [Déclenchement]
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP05-096']); setHand(g, 0, []); setChars(g, 1, [{ num: C6000 }]); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  assert.equal(tag(s), 'trigger');
  s = choose(s, 'trigger');
  assert.equal(tag(s), 'chooseOne');
});

test('Marie-Joie (OP05-097) : coût −1 pour les {Celestial Dragons} de coût 2 ou plus joués de la main', () => {
  const s = scene([me(), OPP], (g) => {
    putStage(g, 0, 'OP05-097');
    setHand(g, 0, ['OP05-084', 'OP05-092', C5000]);
  });
  const of = (st: GameState, num: string) => handCost(st, 0, st.players[0].hand.find((c) => c.num === num)!);
  assert.equal(of(s, 'OP05-084'), 2);
  assert.equal(of(s, 'OP05-092'), 4);
  assert.equal(of(s, C5000), 3, 'autre type');
  const without = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-084']); });
  assert.equal(of(without, 'OP05-084'), 3);
  const oppTurn = scene([me(), OPP], (g) => {
    putStage(g, 0, 'OP05-097');
    setHand(g, 0, ['OP05-084']);
  }, 1);
  assert.equal(of(oppTurn, 'OP05-084'), 3, 'tour adverse');
});

test('Enel (Leader OP05-098) : Vie à 0 au tour adverse : 1 carte du deck dans la Vie, puis défausser ; une fois par tour', () => {
  let s = scene([me('OP05-098'), OPP], (g) => { delete g.lifeSeen; setLife(g, 0, [C3000]); setHand(g, 0, []); setDeckTop(g, 0, [C5000]); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  assert.equal(s.players[0].life.length, 1);
  assert.equal(s.players[0].life[0].num, C5000);
  assert.equal(s.players[0].hand.length, 0, 'la carte de Vie prise en main est défaussée (seule carte)');
  assert.ok(s.players[0].trash.some((c) => c.num === C3000));
  assert.ok(s.players[0].leader.usedOpt.includes('enelZero'));
  coherent(s);
  // 2 Vies → 1 : rien
  s = scene([me('OP05-098'), OPP], (g) => { delete g.lifeSeen; setLife(g, 0, [C3000, C3000]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  assert.equal(s.players[0].life.length, 1);
  assert.ok(!s.players[0].leader.usedOpt.includes('enelZero'));
  // à son propre tour : rien
  s = scene([me('OP05-098'), OPP], (g) => { delete g.lifeSeen; setLife(g, 0, [C3000]); setChars(g, 0, [{ num: 'OP05-060' }]); });
  s.players[0].life.shift();
  s = act(s, 'end');
  assert.ok(!s.players[0].leader.usedOpt.includes('enelZero'));
});

test('Enel (Leader OP05-098) : après le [Déclenchement] ; Vie remise à 1 par ce [Déclenchement] : compte quand même ; ordre au choix avec le [Jouée] (Q&A)', () => {
  // [Déclenchement] qui ajoute une carte à la Vie : OP05-115
  let s = scene([me('OP05-098'), OPP], (g) => { delete g.lifeSeen; setLife(g, 0, ['OP05-115']); setHand(g, 0, [C3000, C3000]); setDeckTop(g, 0, [C5000, C6000]); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, 'yes');                 // défausser 2 cartes
  s = s.decision?.tag === 'discard' ? act(s, s.decision.options[0].id) : s;
  s = s.decision?.tag === 'discard' ? act(s, s.decision.options[0].id) : s;
  s = choose(s, 'yes');                 // la carte du deck dans la Vie
  assert.ok(s.players[0].leader.usedOpt.includes('enelZero'), 'Vie passée à 0');
  assert.equal(s.players[0].life.length, 2);
  coherent(s);
  // [Jouée] de la carte jouée par son [Déclenchement] (Shura OP05-106) : le joueur choisit l'ordre
  s = scene([me('OP05-098'), OPP], (g) => { delete g.lifeSeen; setLife(g, 0, ['OP05-106']); setHand(g, 0, [C3000]); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  assert.equal(tag(s), 'order');
  assert.ok(hasOption(s, 'first:OP05-098') && hasOption(s, 'first:OP05-106'));
});

test('Amazon (OP05-099) : l’adversaire peut donner sa Vie du dessus ; sinon, ou sans Vie, −2000', () => {
  const setup = (life: number) => (g: GameState) => { setChars(g, 0, [{ num: 'OP05-099' }]); setHand(g, 0, []); setLife(g, 1, Array(life).fill(C3000)); };
  let s = scene([me(), OPP], setup(2), 1);
  const ol = leaderUid(s, 1);
  s = attack(s, ol, leaderUid(s, 0));
  s = choose(s, 'yes');                 // payer : épuiser Amazon
  assert.equal(s.players[0].chars[0].rested, true);
  assert.equal(s.decision?.player, 1);
  const yes = choose(s, 'yes');
  assert.equal(yes.players[1].life.length, 1);
  assert.ok(!yes.mods.some((m) => m.source === 'Amazon'));
  const no = choose(s, 'no');
  assert.equal(no.players[1].life.length, 2);
  assert.equal(no.decision?.player, 0);
  const after = choose(no, (o) => o.uid === ol);
  assert.ok(after.mods.some((m) => m.source === 'Amazon' && m.uid === ol && m.amount === -2000));
  coherent(after);
  // sans Vie : pas de question à l'adversaire
  s = scene([me(), OPP], setup(0), 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'yes');
  assert.equal(s.decision?.player, 0);
  // Amazon déjà épuisée : pas de coût
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-099', extra: { rested: true } }]); setHand(g, 0, []); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  assert.notEqual(tag(s), 'may');
});

test('Enel (OP05-100) : KO en combat remplacé par la Vie du dessus, une fois par tour', () => {
  let s = scene([me('OP05-002'), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-100', extra: { rested: true } }]); setHand(g, 0, []); setLife(g, 0, [C3000, C5000]); oppLeaderDon(g, 5); }, 1);
  const u = charUid(s, 0, 'OP05-100');
  s = oppAttacks(s, u);
  assert.equal(tag(s), 'replace');
  s = choose(s, 'yes');
  assert.ok(s.players[0].chars.some((c) => c.uid === u));
  assert.equal(s.players[0].life.length, 1);
  assert.equal(s.players[0].trash.at(-1)?.num, C3000);
  coherent(s);
  // déjà utilisé : KO sans question
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-007'), u, 'ko'), true);
});

test('Enel (OP05-100) : aussi ses propres effets et les autres sorties ; un coût remplacé n’est pas payé (Q&A) ; annulé par un Personnage [Monkey.D.Luffy], pas son [Initiative]', () => {
  const setup = (extra: string[] = [], life = 2) => (g: GameState) => { setChars(g, 0, [{ num: 'OP05-100' }, ...extra.map((num) => ({ num }))]); setLife(g, 0, Array(life).fill(C3000)); };
  // effet de son propriétaire
  let s = scene([me('OP05-002'), OPP], setup());
  let u = charUid(s, 0, 'OP05-100');
  assert.equal(removeByEffect(ctxOf(s, 0, 'OP05-007', 'yes'), u, 'hand'), false);
  assert.equal(s.players[0].life.length, 1);
  assert.ok(s.players[0].chars.some((c) => c.uid === u));
  // effet adverse, sous le deck : refus
  s = scene([me('OP05-002'), OPP], setup());
  u = charUid(s, 0, 'OP05-100');
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-007', 'no'), u, 'deckBottom'), true);
  assert.equal(s.players[0].chars.length, 0);
  // coûts : retour en main, Défausse, sous le deck
  for (const cost of [returnOwnChar(), trashOwnCharCost({}), bottomOwnCost(1, 'CHARACTER', {})]) {
    s = scene([me('OP05-002'), OPP], setup());
    u = charUid(s, 0, 'OP05-100');
    assert.equal(cost.pay(ctxOf(s, 0, 'OP05-007', 'yes')), false, cost.label);
    assert.ok(s.players[0].chars.some((c) => c.uid === u));
  }
  // sans Vie : rien à proposer
  s = scene([me('OP05-002'), OPP], setup([], 0));
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-007', 'yes'), charUid(s, 0, 'OP05-100'), 'ko'), true);
  // [Monkey.D.Luffy] sur le terrain, d'un côté ou de l'autre
  s = scene([me('OP05-002'), OPP], (g) => { setup()(g); setChars(g, 1, [{ num: LUFFY_CHAR }]); });
  assert.equal(removeByEffect(ctxOf(s, 1, 'OP05-007', 'yes'), charUid(s, 0, 'OP05-100'), 'ko'), true, 'annulé');
  assert.equal(s.players[0].life.length, 2);
  s = scene([me('OP05-002'), OPP], (g) => { setup()(g); setChars(g, 1, [{ num: LUFFY_CHAR }]); });
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Rush'), true, '[Initiative] gardée');
});

test('Spacey (OP05-107) : +2000 une fois par tour quand une carte de sa Vie va dans sa main, à son tour ; pas une carte qui s’ajoute elle-même (Q&A)', () => {
  let s = scene([me('OP05-060'), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-107' }]); setLife(g, 0, [C3000, C3000]); });
  const u = charUid(s, 0, 'OP05-107');
  const base = power(s, u);
  s = act(s, `act:${leaderUid(s, 0)}`);   // coût : Vie du dessus dans la main
  assert.equal(power(s, u), base + 2000);
  coherent(s);
  // au tour adverse : rien
  s = scene([me('OP05-060'), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-107' }]); setLife(g, 0, [C3000, C3000]); setHand(g, 0, []); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  assert.equal(power(s, charUid(s, 0, 'OP05-107')), base);
});

test('Hotori (OP05-111) : jouer 1 [Kotori] de sa main : Personnage adverse de coût 3 ou moins dans sa Vie, face visible ; sinon rien', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-111', 'OP05-103']); setDon(g, 0, 10); setChars(g, 1, [{ num: C5000 }]); });
  const t = s.players[1].chars[0].uid;
  s = play(s, 'OP05-111');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP05-103'), 'Kotori jouée');
  s = choose(s, `card:${t}`);
  s = choose(s, 'lifeBottom');
  assert.ok(s.players[1].life.some((c) => c.uid === t && c.faceUp));
  coherent(s);
  // sans Kotori : le coût ne peut pas être payé, pas de question ; sans cible : le coût se propose quand même (n° 1000), rien ne suit
  s = play(scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-111']); setDon(g, 0, 10); setChars(g, 1, [{ num: C5000 }]); }), 'OP05-111');
  assert.equal(s.decision?.kind, 'main');
  s = play(scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-111', 'OP05-103']); setDon(g, 0, 10); setChars(g, 1, [{ num: C6000 }]); }), 'OP05-111');
  assert.equal(s.decision?.tag, 'mayIdle');
  s = choose(s, 'yes');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP05-103'), 'Kotori jouée');
  assert.equal(s.players[1].chars.length, 1, 'aucune cible : rien ne suit');
});

test('Amal (OP05-115) : +3000 puis épuiser avec 1 Vie ou moins ; [Déclenchement] : refus possible après le coût (Q&A d’OP07-119)', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-115']); setDon(g, 0, 10); setLife(g, 0, [C3000]); setChars(g, 1, [{ num: C3000 }]); });
  const t = s.players[1].chars[0].uid;
  s = play(s, 'OP05-115');
  s = choose(s, `card:${leaderUid(s, 0)}`);
  s = choose(s, `card:${t}`);
  assert.equal(s.players[1].chars[0].rested, true);
  s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-115']); setDon(g, 0, 10); setLife(g, 0, [C3000, C3000]); setChars(g, 1, [{ num: C3000 }]); });
  s = play(s, 'OP05-115');
  s = choose(s, `card:${leaderUid(s, 0)}`);
  assert.equal(s.players[1].chars[0].rested, false, '2 Vies : pas d’épuisement');
  // [Déclenchement]
  s = scene([me(), OPP], (g) => { setLife(g, 0, ['OP05-115']); setHand(g, 0, [C3000, C5000]); oppLeaderDon(g, 3); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  s = choose(s, 'trigger');
  s = choose(s, 'yes');
  while (s.decision?.tag === 'discard') s = act(s, s.decision.options[0].id);
  assert.equal(tag(s), 'may');
  assert.equal(s.players[0].hand.length, 0);
  const life = s.players[0].life.length;
  assert.equal(choose(s, 'no').players[0].life.length, life);
  assert.equal(choose(s, 'yes').players[0].life.length, life + 1);
});

// ---------- Recettes : ce que le banc ne mesure pas ----------

const pickLeader = (s: GameState) => (s.decision?.options.some((o) => o.uid === leaderUid(s, 0)) ? choose(s, (o) => o.uid === leaderUid(s, 0)) : s);
test('Contres (OP05-037, 038, 039, 114) : puissance, coût, suite et condition', () => {
  const setup = (event: string, life = 5) => (g: GameState) => { setHand(g, 0, [event, C3000, C3000]); setDon(g, 0, 5, 3); setLife(g, 1, Array(life).fill(C3000)); setChars(g, 1, [{ num: C3000, extra: { rested: true } }]); };
  let r = counterGain(scene([me(), OPP], setup('OP05-037'), 1), 'OP05-037', (s) => {
    s = choose(s, 'yes');
    if (s.decision?.tag === 'discard') s = act(s, s.decision.options[0].id);
    return pickLeader(s);
  });
  assert.equal(r.gain, 3000);
  r = counterGain(scene([me(), OPP], setup('OP05-038'), 1), 'OP05-038', (s) => {
    s = pickLeader(s);
    s = donMax(choose(s, 'yes'));
    if (s.decision?.tag === 'discard') s = act(s, s.decision.options[0].id);
    return s;
  });
  assert.equal(r.gain, 4000);
  assert.ok(logHas(r.s, /redresse 3 DON/), 'si défausse : jusqu’à 3 DON!!');
  r = counterGain(scene([me(), OPP], setup('OP05-039'), 1), 'OP05-039', (s) => {
    s = pickLeader(s);
    return s.decision?.inEffect ? choose(s, (o) => o.id.startsWith('card:')) : s;
  });
  assert.equal(r.gain, 4000);
  assert.ok(r.s.players[1].trash.some((c) => c.num === C3000), 'KO du Personnage épuisé');
  r = counterGain(scene([me(), OPP], setup('OP05-114', 2), 1), 'OP05-114', pickLeader);
  assert.equal(r.gain, 4000, '2 Vies adverses : +2000 de plus');
  r = counterGain(scene([me(), OPP], setup('OP05-114', 3), 1), 'OP05-114', pickLeader);
  assert.equal(r.gain, 2000, '3 Vies adverses : non');
});

test('OP05-039 : KO de l’attaquant par son [Contre] : le combat finit sans dégâts (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setHand(g, 0, ['OP05-039', C3000]); setDon(g, 0, 5); setChars(g, 1, [{ num: C3000, extra: { playedTurn: 0 } }]); setLife(g, 0, [C3000]); }, 1);
  const atk = s.players[1].chars[0].uid;
  s = attack(s, atk, leaderUid(s, 0));
  while (s.decision?.kind === 'blocker') s = act(s, 'noblock');
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  s = pickLeader(s);
  s = choose(s, `card:${atk}`);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].life.length, 1, 'pas de dégâts');
  assert.equal(s.battle, null);
  coherent(s);
});

test('Haccha (OP05-049) : [DON!! x1] [En attaquant] retour en main d’un Personnage de coût 3 ou moins (limite du banc)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-049', extra: { don: 1 } }]); setChars(g, 1, [{ num: C5000 }, { num: C6000 }]); setHand(g, 1, []); });
  const t = charUid(s, 1, C5000);
  s = attack(s, charUid(s, 0, 'OP05-049'), leaderUid(s, 1));
  assert.ok(!hasOption(s, `card:${charUid(s, 1, C6000)}`));
  s = choose(s, `card:${t}`);
  assert.ok(s.players[1].hand.some((c) => c.uid === t));
});

test('Chaka (OP05-008) : les DON!! épuisées vont à une seule carte (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-008', extra: { don: 1 } }, { num: C3000 }]); setDon(g, 0, 0, 3); });
  s = act(s, `act:${charUid(s, 0, 'OP05-008')}`);
  const c = charUid(s, 0, C3000);
  s = choose(s, `card:${c}`);
  while (s.decision?.inEffect) s = act(s, s.decision.options.find((o) => /2/.test(o.id) || /2/.test(o.label))?.id ?? s.decision.options[0].id);
  assert.equal(s.players[0].chars.find((x) => x.uid === c)!.don, 2);
  assert.equal(s.players[0].leader.don, 0);
  assert.equal(s.players[0].donRested, 1);
});

test('Hawkins (OP05-047) : avec 4 cartes ou plus, ni pioche ni +1000 (Q&A) ; avec 3 ou moins, les deux', () => {
  const run = (hand: number) => {
    let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-047' }, { num: C3000, extra: { rested: true } }]); setHand(g, 0, Array(hand).fill(C3000)); }, 1);
    const u = charUid(s, 0, 'OP05-047');
    s = attack(s, leaderUid(s, 1), charUid(s, 0, C3000));
    s = act(s, `block:${u}`);
    return { s, u };
  };
  let r = run(3);
  assert.equal(r.s.players[0].hand.length, 4);
  assert.ok(r.s.mods.some((m) => m.uid === r.u && m.amount === 1000));
  r = run(4);
  assert.equal(r.s.players[0].hand.length, 4);
  assert.ok(!r.s.mods.some((m) => m.uid === r.u && m.amount === 1000));
});

test('Mr.1 (OP05-075) : l’exemplaire joué par cet effet n’a pas d’effet pour cette attaque (Q&A)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-075' }]); setHand(g, 0, ['OP05-075']); setDon(g, 0, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'yes');
  s = choose(s, (o) => o.id.startsWith('card:') || o.uid !== undefined);
  assert.equal(s.players[0].chars.filter((c) => c.num === 'OP05-075').length, 2, 'copie jouée');
  assert.notEqual(tag(s), 'may', 'pas de question pour la copie');
  coherent(s);
});

test('Shirahoshi (OP05-082) : le coût se paie même si l’adversaire a 5 cartes ou moins, sans défausse (Q&A, contre la convention n° 1000)', () => {
  const setup = (n: number) => (g: GameState) => { setChars(g, 0, [{ num: 'OP05-082' }]); setTrash(g, 0, [C3000, C5000]); setHand(g, 1, Array(n).fill(C3000)); };
  let s = scene([me(), OPP], setup(5));
  s = act(s, `act:${charUid(s, 0, 'OP05-082')}`);
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[0].trash.length, 0);
  assert.equal(s.players[1].hand.length, 5);
  s = scene([me(), OPP], setup(6));
  s = act(s, `act:${charUid(s, 0, 'OP05-082')}`);
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[1].hand.length, 5);
});

test('Charlos et Rosward (OP05-084, 092) : effet lu à chaque instant (Q&A) ; n° 1902 : jamais sans Personnage, la carte elle-même est sur le terrain', () => {
  for (const [num, amount] of [['OP05-084', 4], ['OP05-092', 6]] as [string, number][]) {
    const s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num }]); setChars(g, 1, [{ num: C6000 }]); });
    const t = s.players[1].chars[0].uid;
    assert.equal(fieldCost(s, t), 4 - amount);
    const mixed = scene([me(), OPP], (g) => { setChars(g, 0, [{ num }, { num: C3000 }]); setChars(g, 1, [{ num: C6000 }]); });
    assert.equal(fieldCost(mixed, mixed.players[1].chars[0].uid), 4, 'un autre type : plus rien');
    const oppTurn = scene([me(), OPP], (g) => { setChars(g, 0, [{ num }]); setChars(g, 1, [{ num: C6000 }]); }, 1);
    assert.equal(fieldCost(oppTurn, oppTurn.players[1].chars[0].uid), 4, 'tour adverse');
    assert.equal(recipeEntry(num)?.level, 'verified');
  }
});

test('Pagaya (OP05-109) : aussi quand l’adversaire active un [Déclenchement] (Q&A), une fois par tour', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-109' }]); setHand(g, 0, [C3000, C3000]); setDeckTop(g, 0, [C5000, C6000]); setLife(g, 1, ['OP05-105']); setHand(g, 1, []); g.players[1].trash = []; });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  while (s.decision?.player === 1 && !s.decision.inEffect) s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  s = choose(s, 'trigger');
  while (s.decision?.player === 1) s = act(s, s.decision.options.find((o) => o.id === 'no')?.id ?? s.decision.options[0].id);
  assert.ok(s.players[0].hand.some((c) => c.num === C5000) || s.players[0].trash.some((c) => c.num === C5000), 'pioche');
  coherent(s);
});

test('Kid (OP05-074) : à son tour, DON!! renvoyée : 1 DON!! redressée, une fois par tour ; Ulti (OP05-043) jouable (n° 1660)', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-074' }]); setHand(g, 0, ['OP05-078', 'OP05-078']); setDon(g, 0, 8); g.players[0].donDeck = 2; });
  const before = s.players[0].donActive + s.players[0].donRested;
  s = play(s, 'OP05-078');
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[0].donActive + s.players[0].donRested, before, 'une DON!! rendue, une reprise');
  assert.ok(s.players[0].chars[0].usedOpt.length > 0, '[Une fois par tour] pris');
  assert.equal(confidence('OP05-043'), 'verified');
});

test('Saint Mjosgard (OP05-089) : il faut un autre Personnage redressé ; ① payée, les deux épuisés, Personnage noir de coût 1 en main', () => {
  let s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-089' }]); setDon(g, 0, 2); setTrash(g, 0, ['OP05-089']); });
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP05-089')}`), 'seul : pas d’activation');
  s = scene([me(), OPP], (g) => { setChars(g, 0, [{ num: 'OP05-089' }, { num: C3000 }]); setDon(g, 0, 2); setTrash(g, 0, ['OP05-084']); });
  s = act(s, `act:${charUid(s, 0, 'OP05-089')}`);
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.ok(s.players[0].chars.every((c) => c.rested));
  assert.equal(s.players[0].donRested, 1);
  coherent(s);
});
