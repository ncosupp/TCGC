// ST-02 à ST-09 (étape C, tâche S17) : un test par effet des cartes codées à la main (game/engine/cards/st02-st09.ts), condition
// vraie et fausse, les réponses des Q&A officielles (lues, jamais recopiées) et les recettes que le banc d'essai ne sait pas
// mesurer ([Contre] « pendant ce combat », coût « épuisez ce Lieu », [En attaquant] qui change l'issue du combat).
// Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardStatus, CARDS } from '../engine/cards/index.ts';
import { DECKS } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { canBeKO, fieldCost, hasKeyword, power } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, logHas, play, setChars, setDeckTop, setDon, setHand, setLife, tag, take } from './helpers.ts';
import { charUid, leaderUid, list as baseList, oppLeaderDon, scene } from './eb-scene.ts';

const WEAK = 'ST12-009';       // Personnage coût 1, 3000, sans effet utile ici
const VANILLA2 = 'ST12-015';   // Personnage coût 2, 4000, <Slash>
const STRIKE = 'ST02-003';     // Personnage coût 2, 3000, <Strike>
const FILM_L = 'ST05-001';
const NAVY_L = 'ST06-001';
const KID_L = 'ST02-001';
const KAIDO_L = 'ST04-001';
const LINLIN_L = 'ST07-001';
const LUFFY_L = 'ST08-001';
const YAMATO_L = 'ST09-001';
const CROCO_L = 'ST03-001';

// Une liste d'essai : les cartes données et, dans tous les decks, les cartes neutres utilisées par les scènes
const list = (leader: string, nums: string[]) => {
  const d = baseList(leader, [...new Set([WEAK, VANILLA2, STRIKE, ...nums])]);
  d.cards[WEAK] = 9;
  d.cards[VANILLA2] = 9;
  return d;
};
const OPP = list(DECKS['ST-36'].leader, []);

const mine = (s: GameState, num: string, p: PlayerId = 0) => s.players[p].chars.find((c) => c.num === num)!;
const noBlock = (s: GameState) => (s.decision?.kind === 'blocker' ? choose(s, 'noblock') : s);
// Fin de combat : ni blocage ni [Contre] de part et d'autre
const finish = (s: GameState) => {
  while (s.decision && (s.decision.kind === 'blocker' || s.decision.kind === 'counter')) s = s.decision.kind === 'blocker' ? choose(s, 'noblock') : act(s, s.decision.options.find((o) => !o.id.startsWith('counter:') && !o.id.startsWith('cevent:'))!.id);
  return s;
};
const stage = (s: GameState, p: PlayerId, num: string) => {
  const c = take(s, p, num);
  s.players[p].stage = { uid: c.uid, num: c.num, rested: false, don: 0, playedTurn: 0, usedOpt: [] };
};
// répond « oui » et prend la première carte proposée, jusqu'à la fin de l'effet
const resolve = (s: GameState) => {
  while (s.decision?.inEffect) {
    const d = s.decision;
    s = d.options.some((o) => o.id === 'yes') ? choose(s, 'yes') : d.options.some((o) => o.id.startsWith('card:')) ? choose(s, (o) => o.id.startsWith('card:')) : act(s, d.options[0].id);
  }
  return s;
};
const isOption = (s: GameState, id: string) => Boolean(s.decision?.options.some((o) => o.id === id));
const cevent = (s: GameState, num: string, p: PlayerId) => s.decision!.options.find((o) => o.id.startsWith('cevent:') && s.players[p].hand.some((c) => c.uid === o.uid && c.num === num))?.id;
const toTrigger = (s0: GameState, attacker: number, target: number) => {
  let s = attack(s0, attacker, target);
  s = finish(s);
  assert.equal(tag(s), 'trigger');
  return s;
};

test('ST02 à ST09 : cartes codées à la main et recettes relues', () => {
  for (const n of ['ST02-010', 'ST03-007', 'ST05-010', 'ST05-017', 'ST08-002', 'ST08-013', 'ST09-002', 'ST09-009', 'ST09-010']) assert.equal(cardStatus(n), 'coded', n);
  for (const n of ['ST02-001', 'ST02-014', 'ST03-010', 'ST04-001', 'ST05-001', 'ST06-015', 'ST07-010', 'ST07-015', 'ST07-016', 'ST08-001', 'ST09-015']) assert.equal(confidence(n), 'verified', n);
  // aucun numéro de ST02 à ST09 n'attend encore
  for (const n of Object.keys(CARDS).filter((k) => /^ST0[2-9]-/.test(k))) assert.ok(['coded', 'auto', 'verified'].includes(confidence(n)), `${n} : ${confidence(n)}`);
});

// ---------- Cartes à la main ----------

test('Basil Hawkins (ST02-010) : redressé après un combat contre un Personnage, même bloqué ; pas sans DON!!, ni deux fois, ni contre un Leader (Q&A)', () => {
  const deck = list(KID_L, ['ST02-010']);
  // contre un Personnage, qui est mis KO : redressé
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-010', extra: { don: 1 } }]); setChars(g, 1, [{ num: WEAK, extra: { rested: true } }]); setHand(g, 1, []); setDon(g, 0, 0); });
  let u = charUid(s, 0, 'ST02-010');
  s = finish(attack(s, u, charUid(s, 1, WEAK)));
  assert.equal(mine(s, 'ST02-010').rested, false);
  assert.equal(s.players[1].chars.length, 0);
  coherent(s);
  // une fois par tour : un deuxième combat ne le redresse pas
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-010', extra: { don: 1 } }]); setChars(g, 1, [{ num: WEAK, extra: { rested: true } }, { num: VANILLA2, extra: { rested: true } }]); setHand(g, 1, []); });
  u = charUid(s, 0, 'ST02-010');
  s = finish(attack(s, u, charUid(s, 1, WEAK)));
  s = finish(attack(s, u, charUid(s, 1, VANILLA2)));
  assert.equal(mine(s, 'ST02-010').rested, true);
  // contre le Leader, sans blocage : non
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-010', extra: { don: 1 } }]); setChars(g, 1, []); setHand(g, 1, []); });
  s = finish(attack(s, charUid(s, 0, 'ST02-010'), leaderUid(s, 1)));
  while (tag(s) === 'trigger') s = choose(s, (o) => o.id !== 'trigger');
  assert.equal(mine(s, 'ST02-010').rested, true);
  // sans DON!! : non
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-010' }]); setChars(g, 1, [{ num: WEAK, extra: { rested: true } }]); setHand(g, 1, []); });
  s = finish(attack(s, charUid(s, 0, 'ST02-010'), charUid(s, 1, WEAK)));
  assert.equal(mine(s, 'ST02-010').rested, true);
  // la cible remplace son KO en se plaçant dans la Défausse (Q&A d'OP05-030) : oui
  s = scene([deck, list('OP05-001', ['OP05-030'])], (g) => { setChars(g, 0, [{ num: 'ST02-010', extra: { don: 3 } }]); setChars(g, 1, [{ num: 'OP05-030', extra: { rested: true } }]); setHand(g, 1, []); });
  s = finish(attack(s, charUid(s, 0, 'ST02-010'), charUid(s, 1, 'OP05-030')));
  if (isOption(s, 'yes')) s = choose(s, 'yes');
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(mine(s, 'ST02-010').rested, false);
  // il attaque le Leader, un [Bloqueur] s'interpose : oui (Q&A)
  const blockers = list(CROCO_L, ['ST03-003']);
  s = scene([deck, blockers], (g) => { setChars(g, 0, [{ num: 'ST02-010', extra: { don: 2 } }]); setChars(g, 1, [{ num: 'ST03-003' }]); setHand(g, 1, []); });
  s = attack(s, charUid(s, 0, 'ST02-010'), leaderUid(s, 1));
  s = finish(act(s, `block:${charUid(s, 1, 'ST03-003')}`));
  assert.equal(mine(s, 'ST02-010').rested, false);
});

test('Basil Hawkins (ST02-010) : combat coupé (la cible quitte le terrain avant les dégâts) : pas redressé (Q&A)', () => {
  const deck = list(KID_L, ['ST02-010']);
  const opp = list(CROCO_L, ['ST03-016']);
  let s = scene([deck, opp], (g) => { setChars(g, 0, [{ num: 'ST02-010', extra: { don: 1 } }]); setChars(g, 1, [{ num: WEAK, extra: { rested: true } }]); setHand(g, 1, ['ST03-016']); setDon(g, 1, 2); setDon(g, 0, 0); });
  s = attack(s, charUid(s, 0, 'ST02-010'), charUid(s, 1, WEAK));
  // [Contre] de ST03-016 : la cible retourne dans la main de l'adversaire
  s = act(s, cevent(s, 'ST03-016', 1)!);
  while (s.decision?.inEffect) s = choose(s, (o) => o.uid !== undefined && s.players[1].chars.some((c) => c.uid === o.uid));
  s = finish(s);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(mine(s, 'ST02-010').rested, true);
  coherent(s);
});

test('Sentomaru (ST03-007) : [DON!! x1] 2 DON!! épuisées : [Pacifista] du deck, puis mélange ; sans [Pacifista], le deck est quand même mélangé (Q&A) ; une fois par tour', () => {
  const deck = list(CROCO_L, ['ST03-007', 'ST03-012']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST03-007', extra: { don: 1 } }]); setDon(g, 0, 2); });
  const u = charUid(s, 0, 'ST03-007');
  s = act(s, `act:${u}`);
  assert.equal(s.players[0].donRested, 2);
  assert.equal(tag(s), 'playFree');
  s = choose(s, (o) => o.num === 'ST03-012');
  assert.ok(mine(s, 'ST03-012'));
  assert.ok(logHas(s, 'mélange son deck'));
  assert.ok(!s.decision?.options.some((o) => o.id === `act:${u}`), 'une fois par tour');
  coherent(s);
  // pas de DON!! donnée : pas d'activation
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST03-007' }]); setDon(g, 0, 2); });
  assert.ok(!isOption(s, `act:${charUid(s, 0, 'ST03-007')}`));
  // 1 seule DON!! : pas d'activation
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST03-007', extra: { don: 1 } }]); setDon(g, 0, 1); });
  assert.ok(!isOption(s, `act:${charUid(s, 0, 'ST03-007')}`));
  // aucun [Pacifista] au deck : activation permise, mélange
  s = scene([list(CROCO_L, ['ST03-007']), OPP], (g) => { setChars(g, 0, [{ num: 'ST03-007', extra: { don: 1 } }]); setDon(g, 0, 2); });
  s = act(s, `act:${charUid(s, 0, 'ST03-007')}`);
  assert.notEqual(tag(s), 'playFree');
  assert.ok(logHas(s, 'mélange son deck'));
});

test('Zephyr (ST05-010) : +3000 par combat contre un Personnage <Strike>, cumulés (Q&A) ; pas contre un Leader, ni si un autre bloque ; DON!! −1 : +2000', () => {
  const deck = list(FILM_L, ['ST05-010', 'ST03-003']);
  const strikers = list(LUFFY_L, [STRIKE]);   // Leader <Strike> : ne compte pas
  // attaqué deux fois par un Personnage <Strike> : +6000 (Q&A)
  let s = scene([deck, strikers], (g) => {
    setChars(g, 0, [{ num: 'ST05-010', extra: { rested: true } }]);
    setChars(g, 1, [{ num: STRIKE }, { num: STRIKE }]);
    setHand(g, 0, []);
    setHand(g, 1, []);
  }, 1);
  const z = charUid(s, 0, 'ST05-010');
  const base = power(s, z);
  const [a, b] = s.players[1].chars.map((c) => c.uid);
  s = attack(s, a, z);
  assert.equal(power(s, z), base + 3000);
  s = finish(s);
  s = finish(attack(s, b, z));
  assert.equal(power(s, z), base + 6000);
  coherent(s);
  // attaqué par le Leader <Strike> : rien
  s = scene([deck, strikers], (g) => { setChars(g, 0, [{ num: 'ST05-010', extra: { rested: true } }]); setChars(g, 1, []); setHand(g, 0, []); setHand(g, 1, []); }, 1);
  s = attack(s, leaderUid(s, 1), charUid(s, 0, 'ST05-010'));
  assert.equal(power(s, charUid(s, 0, 'ST05-010')), base);
  // l'attaque d'un <Strike> est prise par un [Bloqueur] : Zephyr ne combat pas
  s = scene([deck, strikers], (g) => { setChars(g, 0, [{ num: 'ST05-010', extra: { rested: true } }, { num: 'ST03-003' }]); setChars(g, 1, [{ num: STRIKE }]); setHand(g, 0, []); setHand(g, 1, []); }, 1);
  s = attack(s, charUid(s, 1, STRIKE), charUid(s, 0, 'ST05-010'));
  s = act(s, `block:${charUid(s, 0, 'ST03-003')}`);
  s = finish(s);
  assert.equal(power(s, charUid(s, 0, 'ST05-010')), base);
  // c'est lui qui attaque un Personnage <Strike> : +3000
  s = scene([deck, strikers], (g) => { setChars(g, 0, [{ num: 'ST05-010' }]); setChars(g, 1, [{ num: STRIKE, extra: { rested: true } }]); setHand(g, 1, []); });
  s = attack(s, charUid(s, 0, 'ST05-010'), charUid(s, 1, STRIKE));
  assert.equal(power(s, charUid(s, 0, 'ST05-010')), base + 3000);
  // Personnage sans <Strike> : rien
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST05-010' }]); setChars(g, 1, [{ num: VANILLA2, extra: { rested: true } }]); setHand(g, 1, []); });
  s = attack(s, charUid(s, 0, 'ST05-010'), charUid(s, 1, VANILLA2));
  assert.equal(power(s, charUid(s, 0, 'ST05-010')), base);
  // activation
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST05-010' }]); setDon(g, 0, 2); });
  const u = charUid(s, 0, 'ST05-010');
  s = act(s, `act:${u}`);
  assert.equal(power(s, u), base + 2000);
  assert.equal(s.players[0].donActive + s.players[0].donRested, 1);
  assert.ok(!isOption(s, `act:${u}`), 'une fois par tour');
});

test('Union Armada (ST05-017) : +4000 pour le combat ; un Personnage {FILM} ne peut pas être mis KO du tour (Q&A) ; [Déclenchement] 1 DON!! redressée', () => {
  const deck = list(FILM_L, ['ST05-017', 'ST05-008']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST05-008', extra: { rested: true } }]); setChars(g, 1, []); setHand(g, 0, ['ST05-017']); setDon(g, 0, 2); oppLeaderDon(g, 8); }, 1);
  const shiki = charUid(s, 0, 'ST05-008');
  s = attack(s, leaderUid(s, 1), shiki);
  s = noBlock(s);
  s = act(s, cevent(s, 'ST05-017', 0)!);
  assert.ok(s.decision?.options.some((o) => o.uid === leaderUid(s, 0)), 'le Leader {FILM} est proposé');
  s = choose(s, (o) => o.uid === shiki);
  assert.ok(logHas(s, 'ne peut pas être mis KO'));
  assert.equal(canBeKO(s, shiki, 'battle', 1), false);
  assert.equal(canBeKO(s, shiki, 'effect', 1), false);
  // sur le Leader : la puissance seulement
  s = scene([deck, OPP], (g) => { setChars(g, 0, []); setChars(g, 1, []); setHand(g, 0, ['ST05-017']); setDon(g, 0, 2); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = noBlock(s);
  s = act(s, cevent(s, 'ST05-017', 0)!);
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  assert.ok(logHas(s, 'gagne +4000'));
  assert.ok(!logHas(s, 'ne peut pas être mis KO'));
  // un Personnage sans {FILM} n'est pas proposé
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: WEAK }]); setChars(g, 1, []); setHand(g, 0, ['ST05-017']); setDon(g, 0, 2); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = noBlock(s);
  s = act(s, cevent(s, 'ST05-017', 0)!);
  assert.ok(!s.decision?.options.some((o) => o.uid === charUid(s, 0, WEAK)));
  // [Déclenchement]
  s = scene([OPP, deck], (g) => { setChars(g, 1, []); setHand(g, 1, []); setLife(g, 1, ['ST05-017']); setDon(g, 1, 1, 0); });
  const don = s.players[1].donActive;
  s = toTrigger(s, leaderUid(s, 0), leaderUid(s, 1));
  s = choose(s, 'trigger');
  assert.equal(s.players[1].donActive, don + 1);
});

test('Uta (ST08-002) : pas de KO en combat par un Leader ; par un Personnage ou un effet, si ; s’épuiser : −2 de coût', () => {
  const deck = list(LUFFY_L, ['ST08-002']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST08-002', extra: { rested: true } }]); setChars(g, 1, [{ num: STRIKE }]); setHand(g, 0, []); setHand(g, 1, []); oppLeaderDon(g, 3); }, 1);
  const uta = charUid(s, 0, 'ST08-002');
  s = finish(attack(s, leaderUid(s, 1), uta));
  assert.ok(mine(s, 'ST08-002'), 'le Leader ne la met pas KO');
  assert.equal(canBeKO(s, uta, 'effect', 1), true);
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST08-002', extra: { rested: true } }]); setChars(g, 1, [{ num: STRIKE, extra: { don: 2 } }]); setHand(g, 0, []); setHand(g, 1, []); }, 1);
  s = finish(attack(s, charUid(s, 1, STRIKE), charUid(s, 0, 'ST08-002')));
  assert.ok(!mine(s, 'ST08-002'), 'un Personnage la met KO');
  // activation
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST08-002' }]); setChars(g, 1, [{ num: VANILLA2 }]); });
  s = act(s, `act:${charUid(s, 0, 'ST08-002')}`);
  s = choose(s, (o) => o.uid === charUid(s, 1, VANILLA2));
  assert.equal(fieldCost(s, charUid(s, 1, VANILLA2)), 0);
  assert.equal(mine(s, 'ST08-002').rested, true);
});

test('Mr.2 (ST08-013) : [DON!! x1] à la fin d’un combat contre un Personnage : KO de ce Personnage, puis de lui-même ; refus ; sans DON!! ; contre un Leader ; mis KO : rien (Q&A)', () => {
  const deck = list(LUFFY_L, ['ST08-013']);
  const big = 'ST05-010';   // 8000 : gagne contre Mr.2
  const opp = list(FILM_L, [big]);
  // il attaque, la cible survit (8000 contre 6000 + DON!!) : question, KO des deux
  let s = scene([deck, opp], (g) => { setChars(g, 0, [{ num: 'ST08-013', extra: { don: 1 } }]); setChars(g, 1, [{ num: big, extra: { rested: true } }]); setHand(g, 1, []); setDon(g, 0, 0); });
  s = finish(attack(s, charUid(s, 0, 'ST08-013'), charUid(s, 1, big)));
  assert.equal(s.decision?.options.some((o) => o.id === 'yes'), true);
  s = choose(s, 'yes');
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].chars.length, 0);
  coherent(s);
  // refus : les deux restent
  s = scene([deck, opp], (g) => { setChars(g, 0, [{ num: 'ST08-013', extra: { don: 1 } }]); setChars(g, 1, [{ num: big, extra: { rested: true } }]); setHand(g, 1, []); });
  s = choose(finish(attack(s, charUid(s, 0, 'ST08-013'), charUid(s, 1, big))), 'no');
  assert.equal(s.players[1].chars.length, 1);
  assert.equal(s.players[0].chars.length, 1);
  // sans DON!! : pas de question
  s = scene([deck, opp], (g) => { setChars(g, 0, [{ num: 'ST08-013' }]); setChars(g, 1, [{ num: big, extra: { rested: true } }]); setHand(g, 1, []); });
  s = finish(attack(s, charUid(s, 0, 'ST08-013'), charUid(s, 1, big)));
  assert.ok(!isOption(s, 'yes'));
  // la cible est mise KO dans le combat : plus rien à mettre KO, il reste
  s = scene([deck, opp], (g) => { setChars(g, 0, [{ num: 'ST08-013', extra: { don: 1 } }]); setChars(g, 1, [{ num: WEAK, extra: { rested: true } }]); setHand(g, 1, []); });
  s = finish(attack(s, charUid(s, 0, 'ST08-013'), charUid(s, 1, WEAK)));
  assert.ok(!isOption(s, 'yes'));
  assert.equal(s.players[0].chars.length, 1);
  // contre le Leader : rien
  s = scene([deck, opp], (g) => { setChars(g, 0, [{ num: 'ST08-013', extra: { don: 1 } }]); setChars(g, 1, []); setHand(g, 1, []); });
  s = finish(attack(s, charUid(s, 0, 'ST08-013'), leaderUid(s, 1)));
  assert.ok(!isOption(s, 'yes'));
  // au tour adverse : attaqué, il survit (repousse l'attaque) : question aussi
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST08-013', extra: { don: 1, rested: true } }]); setChars(g, 1, [{ num: WEAK }]); setHand(g, 0, []); setHand(g, 1, []); }, 1);
  s = finish(attack(s, charUid(s, 1, WEAK), charUid(s, 0, 'ST08-013')));
  assert.equal(s.decision?.player, 0);
  s = choose(s, 'yes');
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].chars.length, 0);
  // attaqué et mis KO dans le combat : plus sur le terrain à la fin du combat, rien (Q&A)
  s = scene([deck, opp], (g) => { setChars(g, 0, [{ num: 'ST08-013', extra: { don: 1, rested: true } }]); setChars(g, 1, [{ num: big, extra: { don: 1 } }]); setHand(g, 0, []); setHand(g, 1, []); }, 1);
  s = finish(attack(s, charUid(s, 1, big), charUid(s, 0, 'ST08-013')));
  assert.ok(!isOption(s, 'yes'));
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(s.players[1].chars.length, 1);
});

test('Uzuki Tempura (ST09-002) et Fugetsu Omusubi (ST09-009) : [Déclenchement] puis cette carte dans la main, sans choix (Q&A)', () => {
  for (const [num, costly] of [['ST09-002', WEAK], ['ST09-009', WEAK]] as const) {
    const deck = list(YAMATO_L, [num]);
    let s = scene([OPP, deck], (g) => { setChars(g, 0, [{ num: costly }]); setChars(g, 1, []); setHand(g, 1, []); setLife(g, 1, [num]); });
    const trash = s.players[1].trash.length;
    s = toTrigger(s, leaderUid(s, 0), leaderUid(s, 1));
    s = choose(s, 'trigger');
    s = choose(s, (o) => o.uid === charUid(s, 0, costly));
    assert.ok(s.players[1].hand.some((c) => c.num === num), `${num} dans la main`);
    assert.equal(s.players[1].trash.length, trash);
    if (num === 'ST09-009') assert.equal(s.players[0].chars.length, 0);
    else assert.equal(mine(s, costly).rested, true);
    coherent(s);
  }
});

test('Portgas.D.Ace (ST09-010) : au lieu d’un KO, dessus ou dessous de sa Vie en Défausse ; une fois par tour ; sans Vie, pas de remplacement (Q&A)', () => {
  const deck = list(YAMATO_L, ['ST09-010', 'ST08-015']);
  const ko = list(LUFFY_L, ['ST08-015']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST09-010', extra: { rested: true } }]); setChars(g, 1, [{ num: VANILLA2, extra: { don: 4 } }]); setLife(g, 0, [WEAK, VANILLA2]); setHand(g, 0, []); setHand(g, 1, []); oppLeaderDon(g, 2); setDon(g, 1, 0); }, 1);
  const ace = charUid(s, 0, 'ST09-010');
  s = finish(attack(s, leaderUid(s, 1), ace));
  assert.equal(s.decision?.player, 0);
  s = choose(s, 'yes');
  s = choose(s, 'bottom');
  assert.ok(mine(s, 'ST09-010'), 'il reste sur le terrain');
  assert.equal(s.players[0].life.length, 1);
  assert.equal(s.players[0].life[0].num, WEAK);
  assert.ok(s.players[0].trash.some((c) => c.num === VANILLA2));
  coherent(s);
  // une deuxième fois dans le tour : KO
  s = finish(attack(s, charUid(s, 1, VANILLA2), ace));
  assert.ok(!mine(s, 'ST09-010'), 'deuxième KO du tour');
  // sans Vie : pas de question
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST09-010', extra: { rested: true } }]); setLife(g, 0, []); setHand(g, 0, []); setHand(g, 1, []); oppLeaderDon(g, 8); setChars(g, 1, []); }, 1);
  s = finish(attack(s, leaderUid(s, 1), charUid(s, 0, 'ST09-010')));
  assert.ok(!mine(s, 'ST09-010'));
  // par un effet adverse aussi ; un refus laisse l'effet disponible, et le KO a lieu
  s = scene([deck, ko], (g) => { setChars(g, 0, [{ num: 'ST09-010' }]); setLife(g, 0, [WEAK]); setHand(g, 0, []); setHand(g, 1, ['ST08-015']); setChars(g, 1, []); setDon(g, 1, 3); g.mods.push({ uid: g.players[0].chars[0].uid, stat: 'cost', amount: -4, until: g.turn, source: 'essai' }); }, 1);
  s = play(s, 'ST08-015', 1);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'ST09-010'));
  assert.equal(s.decision?.player, 0);
  s = choose(s, 'no');
  assert.ok(!mine(s, 'ST09-010'));
  assert.equal(s.players[0].life.length, 1);
});

// ---------- Recettes : Q&A et limites du banc ----------

test('Crocodile (ST03-003) : [DON!! x1] [En bloquant] ; Zeff d’abord, puis le [En bloquant] (Q&A) ; l’attaquant au-dessous du deck : fin du combat ; ses propres Personnages aussi', () => {
  const deck = list('OP03-021', ['OP06-048', VANILLA2]);
  const blockers = list(CROCO_L, ['ST03-003']);
  // ordre de la Q&A avec Zeff : à l'activation de [Bloqueur], Zeff (coût 2 ou moins n'est pas regardé) passe avant, puis Crocodile le place sous le deck
  let s = scene([deck, blockers], (g) => { setChars(g, 0, [{ num: 'OP06-048' }]); setChars(g, 1, [{ num: 'ST03-003', extra: { don: 1 } }]); setHand(g, 1, []); g.mods.push({ uid: g.players[0].chars[0].uid, stat: 'cost', amount: -1, until: g.turn, source: 'essai' }); });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = act(s, `block:${charUid(s, 1, 'ST03-003')}`);
  assert.equal(tag(s), 'mayMill', 'Zeff d’abord');
  s = choose(s, 'yes');
  assert.ok(s.decision?.inEffect, 'puis Crocodile');
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP06-048'));
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(s.players[0].deck.at(-1)?.num, 'OP06-048');
  assert.equal(s.players[0].trash.length >= 4, true, 'les 4 cartes de Zeff ont bien été défaussées avant');
  // l'attaquant au-dessous du deck de son propriétaire : le combat finit sans rien (Q&A)
  const atk = list(LUFFY_L, []);
  s = scene([atk, blockers], (g) => { setChars(g, 0, [{ num: WEAK }]); setChars(g, 1, [{ num: 'ST03-003', extra: { don: 1 } }]); setHand(g, 1, []); });
  const life = s.players[1].life.length;
  s = attack(s, charUid(s, 0, WEAK), leaderUid(s, 1));
  s = act(s, `block:${charUid(s, 1, 'ST03-003')}`);
  assert.ok(s.decision!.options.some((o) => o.uid === charUid(s, 1, 'ST03-003') || o.uid === charUid(s, 0, WEAK)));
  s = choose(s, (o) => o.uid === s.players[0].chars[0].uid);
  s = finish(s);
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(s.battle, null);
  assert.equal(s.players[1].life.length, life);
  // sans DON!! : rien
  s = scene([atk, blockers], (g) => { setChars(g, 0, [{ num: WEAK }]); setChars(g, 1, [{ num: 'ST03-003' }, { num: WEAK }]); setHand(g, 1, []); });
  s = attack(s, charUid(s, 0, WEAK), leaderUid(s, 1));
  s = act(s, `block:${charUid(s, 1, 'ST03-003')}`);
  assert.ok(!s.decision?.inEffect);
});

test('Love-Love Mellow (ST03-017) : la carte activée ne compte pas dans la main (Q&A) ; condition fausse : pas de pioche', () => {
  const deck = list(CROCO_L, ['ST03-017']);
  const run = (hand: string[]) => {
    let s = scene([deck, OPP], (g) => { setChars(g, 0, []); setHand(g, 0, ['ST03-017', ...hand]); setDon(g, 0, 2); }, 1);
    s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
    s = noBlock(s);
    const before = s.players[0].hand.length;
    s = act(s, cevent(s, 'ST03-017', 0)!);
    assert.ok(logHas(s, 'gagne +4000'));
    return s.players[0].hand.length - before;
  };
  assert.equal(run([WEAK, WEAK, WEAK]), 0);    // 3 cartes après l'activation : -1 (l'Événement) + 1 pioche
  assert.equal(run([WEAK, WEAK, WEAK, WEAK]), -1);  // 4 cartes : pas de pioche
});

test('ST02 : Urouge compte lui-même, aux deux tours (Q&A) ; X.Drake : +1000 une seule fois à chaque {Supernovas} ou {Navy}, Leader compris, s’il est épuisé (Q&A) ; Apoo : DON!! redressées de la zone de coût seulement', () => {
  const deck = list(KID_L, ['ST02-003', 'ST02-014', 'ST02-008', 'ST02-005']);
  // Urouge : 3 Personnages, lui compris
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-003', extra: { don: 1 } }, { num: WEAK }, { num: WEAK }]); });
  let u = charUid(s, 0, 'ST02-003');
  assert.equal(power(s, u), 3000 + 1000 + 2000);
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-003', extra: { don: 1 } }, { num: WEAK }]); });
  assert.equal(power(s, charUid(s, 0, 'ST02-003')), 3000 + 1000);
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-003', extra: { don: 1 } }, { num: WEAK }, { num: WEAK }]); }, 1);
  assert.equal(power(s, charUid(s, 0, 'ST02-003')), 3000 + 2000, 'au tour adverse, la DON!! ne donne plus +1000');
  // X.Drake épuisé à son tour : lui, le Leader {Supernovas} et Urouge ; pas les autres ; une seule fois
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-014', extra: { don: 1, rested: true } }, { num: 'ST02-003' }, { num: WEAK }]); });
  u = charUid(s, 0, 'ST02-014');
  const leader = power(s, leaderUid(s, 0));
  assert.equal(leader, 6000);
  assert.equal(power(s, u), 5000 + 1000 + 1000);
  assert.equal(power(s, charUid(s, 0, 'ST02-003')), 3000 + 1000);
  assert.equal(power(s, charUid(s, 0, WEAK)), CARDS[WEAK].power);
  // redressé, ou au tour adverse : rien
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-014', extra: { don: 1 } }]); });
  assert.equal(power(s, leaderUid(s, 0)), 5000);
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-014', extra: { don: 1, rested: true } }]); }, 1);
  assert.equal(power(s, leaderUid(s, 0)), 5000);
  // Apoo : DON!! redressées adverses ; aucune : rien
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST02-008', extra: { don: 1 } }]); setChars(g, 1, []); setHand(g, 1, []); setDon(g, 1, 3, 1); });
  s = attack(s, charUid(s, 0, 'ST02-008'), leaderUid(s, 1));
  s = resolve(s);
  assert.equal(s.players[1].donActive, 2);
  assert.equal(s.players[1].donRested, 2);
});

test('[Contre] des ST : gain lu au combat ; Scalpel et Repel : DON!! au choix (Q&A)', () => {
  const deck = list(KID_L, ['ST02-015', 'ST02-016']);
  for (const [num, gain] of [['ST02-015', 2000], ['ST02-016', 4000]] as const) {
    let s = scene([deck, OPP], (g) => { setChars(g, 0, []); setHand(g, 0, [num]); setDon(g, 0, 2, 3); }, 1);
    s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
    s = noBlock(s);
    const before = power(s, leaderUid(s, 0));
    const donBefore = s.players[0].donRested;
    const cost = CARDS[num].cost ?? 0;
    const from = s.log.length;
    s = act(s, cevent(s, num, 0)!);
    assert.ok(s.log.slice(from).some((l) => l.text.includes(`gagne +${gain} de puissance`)), num);
    assert.equal(s.players[0].donRested, donBefore + cost - 1, 'puis 1 DON!! redressée');
    assert.ok(before > 0);
  }
});

test('Souffle ardent (ST04-016) : sans pouvoir payer DON!! −1, l’Événement s’active et ne fait rien (Q&A) ; payé : +4000', () => {
  const deck = list(KAIDO_L, ['ST04-016']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, []); setHand(g, 0, ['ST04-016']); setDon(g, 0, 1); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = noBlock(s);
  s = act(s, cevent(s, 'ST04-016', 0)!);
  // l'Événement est activé, DON!! −1 refusé : rien ne se passe
  assert.equal(tag(s), 'may');
  const before0 = s.log.length;
  s = choose(s, 'no');
  assert.ok(!s.log.slice(before0).some((l) => l.text.includes('+4000')));
  assert.ok(s.players[0].trash.some((c) => c.num === 'ST04-016'));
  s = scene([deck, OPP], (g) => { setChars(g, 0, []); setHand(g, 0, ['ST04-016']); setDon(g, 0, 3); }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = noBlock(s);
  s = act(s, cevent(s, 'ST04-016', 0)!);
  s = choose(s, 'yes');
  assert.ok(logHas(s, 'gagne +4000'));
  assert.equal(s.players[0].donDeck, 8);
});

test('Lieux : Onigashima (ST04-017) et Navy HQ (ST06-017) : s’épuiser, condition de Leader vraie et fausse (Q&A : le coût est payé, rien ne suit)', () => {
  let s = scene([list(KAIDO_L, ['ST04-017']), OPP], (g) => { stage(g, 0, 'ST04-017'); setDon(g, 0, 2); });
  const don = s.players[0].donRested;
  s = resolve(act(s, `act:${s.players[0].stage!.uid}`));
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(s.players[0].donRested, don + 1);
  s = scene([list(NAVY_L, ['ST04-017']), OPP], (g) => { stage(g, 0, 'ST04-017'); setDon(g, 0, 2); });
  const don2 = s.players[0].donRested;
  s = resolve(act(s, `act:${s.players[0].stage!.uid}`));
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(s.players[0].donRested, don2);
  // Navy HQ
  s = scene([list(NAVY_L, ['ST06-017']), OPP], (g) => { stage(g, 0, 'ST06-017'); setChars(g, 1, [{ num: VANILLA2 }]); });
  s = resolve(act(s, `act:${s.players[0].stage!.uid}`));
  assert.equal(fieldCost(s, charUid(s, 1, VANILLA2)), 1);
  s = scene([list(KAIDO_L, ['ST06-017']), OPP], (g) => { stage(g, 0, 'ST06-017'); setChars(g, 1, [{ num: VANILLA2 }]); });
  s = resolve(act(s, `act:${s.players[0].stage!.uid}`));
  assert.equal(fieldCost(s, charUid(s, 1, VANILLA2)), 2);
  assert.equal(s.players[0].stage!.rested, true);
  // Queen Mama Chanter (ST07-017) : coût exactement 3, sur le terrain ; refus permis (Q&A)
  s = scene([list(LINLIN_L, ['ST07-017', 'ST09-012', VANILLA2]), OPP], (g) => { stage(g, 0, 'ST07-017'); setChars(g, 0, [{ num: 'ST09-012' }, { num: VANILLA2 }]); setLife(g, 0, [WEAK, WEAK]); });
  const u = charUid(s, 0, 'ST09-012');
  const v = charUid(s, 0, VANILLA2);
  const life = s.players[0].life.length;
  s = act(s, `act:${s.players[0].stage!.uid}`);
  while (s.decision?.tag === 'lifeSide') s = choose(s, 'top');
  assert.ok(s.decision!.options.some((o) => o.uid === u));
  assert.ok(!s.decision!.options.some((o) => o.uid === v), 'coût 2 : non');
  assert.ok(s.decision!.options.some((o) => o.id === 'none'), 'refus permis');
  s = choose(s, (o) => o.uid === u);
  assert.equal(s.players[0].life.length, life);
  assert.equal(s.players[0].life[0].num, 'ST09-012');
  assert.equal(s.players[0].life[0].faceUp, true);
});

test('ST07 : Linlin (Leader) : 0 Vie : pas d’activation ; 4 Vie : payée, rien ne suit ; 3 Vie : la carte de la main va dans la Vie (Q&A)', () => {
  const deck = list(LINLIN_L, []);
  const run = (life: number) => scene([deck, OPP], (g) => { g.players[0].leader.don = 2; setChars(g, 1, []); setHand(g, 1, []); setHand(g, 0, [WEAK]); setLife(g, 0, Array.from({ length: life }, () => VANILLA2)); });
  let s = attack(run(0), 0 + leaderUidOf(run(0)), leaderUid(run(0), 1));
  assert.ok(!isOption(s, 'yes'), '0 Vie : rien à payer');
  s = attack(run(3), leaderUidOf(run(3)), leaderUid(run(3), 1));
  s = choose(s, 'yes');
  s = choose(s, 'top');
  assert.equal(s.players[0].life.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].life.length, 3, 'une carte de la main remonte');
  s = attack(run(4), leaderUidOf(run(4)), leaderUid(run(4), 1));
  s = choose(s, 'yes');
  s = choose(s, 'top');
  assert.equal(s.players[0].life.length, 3, 'rien ne suit');
});
const leaderUidOf = (s: GameState) => leaderUid(s, 0);

test('Charlotte Linlin (ST07-010) et Soul Pocus (ST07-015) : l’adversaire choisit ; il peut choisir sa Vie vide : rien (Q&A)', () => {
  const deck = list(LINLIN_L, ['ST07-010', 'ST07-015']);
  // [Jouée] : l'adversaire (joueur 1) choisit
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['ST07-010']); setDon(g, 0, 10); setLife(g, 1, [WEAK, WEAK]); setChars(g, 0, []); });
  s = play(s, 'ST07-010');
  assert.equal(tag(s), 'oppChooseOne');
  assert.equal(s.decision?.player, 1);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[1].life.length, 1);
  assert.ok(s.players[1].trash.some((c) => c.num === WEAK));
  // la deuxième : le joueur de la carte prend la carte du dessus de son deck dans sa Vie
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['ST07-010']); setDon(g, 0, 10); setChars(g, 0, []); setDeckTop(g, 0, [VANILLA2]); });
  const life = s.players[0].life.length;
  s = play(s, 'ST07-010');
  s = act(s, s.decision!.options[1].id);
  assert.equal(s.players[0].life.length, life + 1);
  assert.equal(s.players[0].life[0].num, VANILLA2);
  // Vie adverse vide : le premier choix reste permis et ne fait rien
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['ST07-010']); setDon(g, 0, 10); setLife(g, 1, []); setChars(g, 0, []); });
  s = play(s, 'ST07-010');
  assert.equal(s.decision!.options.length, 2);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[1].life.length, 0);
  assert.equal(s.winner ?? null, null);
  // [Principale] de Soul Pocus
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['ST07-015']); setDon(g, 0, 10); setChars(g, 0, []); });
  const id = s.decision!.options.find((o) => o.id.startsWith('event:') && o.num === 'ST07-015')?.id ?? `event:${s.players[0].hand[0].uid}`;
  s = act(s, id);
  assert.equal(tag(s), 'oppChooseOne');
});

test('ST09 : Yamato Leader +1000 au tour adverse avec 2 Vie ou moins (Q&A) ; Yamato Personnage : +2000 jusqu’au début de son prochain tour ; Thunder Bagua : condition vraie et fausse', () => {
  let s = scene([list(YAMATO_L, []), OPP], (g) => { g.players[0].leader.don = 1; setLife(g, 0, [WEAK, WEAK]); }, 1);
  assert.equal(power(s, leaderUid(s, 0)), 5000 + 1000);
  s = scene([list(YAMATO_L, []), OPP], (g) => { g.players[0].leader.don = 1; setLife(g, 0, [WEAK, WEAK, WEAK]); }, 1);
  assert.equal(power(s, leaderUid(s, 0)), 5000);
  // Yamato ST09-012 : payé : +2000 pendant le tour adverse
  const deck = list(YAMATO_L, ['ST09-012', 'ST09-015']);
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST09-012' }]); setChars(g, 1, []); setHand(g, 1, []); setLife(g, 0, [WEAK, WEAK, WEAK]); setHand(g, 0, []); });
  const u = charUid(s, 0, 'ST09-012');
  s = attack(s, u, leaderUid(s, 1));
  s = choose(s, 'yes');
  s = choose(s, 'top');
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(power(s, u), 3000 + 2000);
  // Thunder Bagua : avec 2 Vie : le Personnage de coût 3 ou moins part dans la Vie de son propriétaire, face visible
  s = scene([deck, OPP], (g) => { setChars(g, 0, []); setChars(g, 1, [{ num: VANILLA2 }]); setHand(g, 0, ['ST09-015']); setHand(g, 1, []); setLife(g, 0, [WEAK, WEAK]); setDon(g, 0, 5); }, 1);
  const life1 = s.players[1].life.length;
  s = attack(s, charUid(s, 1, VANILLA2), leaderUid(s, 0));
  s = noBlock(s);
  s = act(s, cevent(s, 'ST09-015', 0)!);
  assert.ok(logHas(s, 'gagne +4000'));
  s = choose(s, (o) => o.uid !== undefined);
  s = choose(s, 'lifeTop');
  assert.equal(s.players[1].life.length, life1 + 1);
  assert.equal(s.players[1].life[0].faceUp, true);
  // avec 3 Vie : pas de question
  s = scene([deck, OPP], (g) => { setChars(g, 0, []); setChars(g, 1, [{ num: VANILLA2 }]); setHand(g, 0, ['ST09-015']); setHand(g, 1, []); setLife(g, 0, [WEAK, WEAK, WEAK]); setDon(g, 0, 5); }, 1);
  s = attack(s, charUid(s, 1, VANILLA2), leaderUid(s, 0));
  s = noBlock(s);
  s = act(s, cevent(s, 'ST09-015', 0)!);
  assert.ok(!s.decision?.inEffect);
});

test('ST07-004 : payé : [Exil] et +1000 ; ST05-001 : Personnages {FILM} seulement (Q&A) ; ST05-008 : les DON!! données comptent (Q&A) ; ST08-001 : une DON!! par Personnage mis KO, ST08-005 les met tous (Q&A) ; ST04-001 : Vie adverse vide, pas de victoire (Q&A)', () => {
  // Charlotte Snack
  let s = scene([list(LINLIN_L, ['ST07-004']), OPP], (g) => { setChars(g, 0, [{ num: 'ST07-004', extra: { don: 1 } }]); setChars(g, 1, []); setHand(g, 1, [WEAK]); setLife(g, 0, [WEAK]); });
  const snack = charUid(s, 0, 'ST07-004');
  s = attack(s, snack, leaderUid(s, 1));
  s = choose(s, 'yes');
  while (s.decision?.tag === 'lifeSide') s = choose(s, 'top');
  assert.equal(hasKeyword(s, 0, mine(s, 'ST07-004'), 'Banish'), true);
  assert.equal(power(s, snack), 6000 + 1000 + 1000);
  // Shanks : le Leader ne gagne rien
  s = scene([list(FILM_L, ['ST05-008']), OPP], (g) => { setChars(g, 0, [{ num: 'ST05-008' }, { num: WEAK }]); setDon(g, 0, 3); });
  const leaderBase = power(s, leaderUid(s, 0));
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.equal(power(s, leaderUid(s, 0)), leaderBase);
  assert.equal(power(s, charUid(s, 0, 'ST05-008')), 7000 + 2000);
  assert.equal(power(s, charUid(s, 0, WEAK)), CARDS[WEAK].power);
  // Shiki : 8 DON!! dont des DON!! données
  s = scene([list(FILM_L, ['ST05-008']), OPP], (g) => { setChars(g, 0, [{ num: 'ST05-008', extra: { don: 4 } }]); setDon(g, 0, 4); });
  assert.equal(canBeKO(s, charUid(s, 0, 'ST05-008'), 'battle', 1), false);
  assert.equal(canBeKO(s, charUid(s, 0, 'ST05-008'), 'effect', 1), true);
  s = scene([list(FILM_L, ['ST05-008']), OPP], (g) => { setChars(g, 0, [{ num: 'ST05-008', extra: { don: 3 } }]); setDon(g, 0, 4); });
  assert.equal(canBeKO(s, charUid(s, 0, 'ST05-008'), 'battle', 1), true);
  // Luffy Leader et Shanks ST08-005 : tous les Personnages de coût 1 ou moins, des deux joueurs, sans choix (Q&A) ; 2 KO : 2 DON!!
  s = scene([list(LUFFY_L, ['ST08-005', VANILLA2]), OPP], (g) => { setHand(g, 0, ['ST08-005', VANILLA2]); setChars(g, 0, [{ num: WEAK }]); setChars(g, 1, [{ num: WEAK }, { num: VANILLA2 }]); setDon(g, 0, 10); g.players[0].donRested = 0; });
  s = play(s, 'ST08-005');
  s = choose(s, 'yes');
  assert.equal(s.players[0].chars.filter((c) => c.num === WEAK).length, 0);
  assert.equal(s.players[1].chars.map((c) => c.num).join(), VANILLA2);
  while (s.decision?.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[0].leader.don, 2);
  coherent(s);
  // Luffy Leader : au tour adverse, rien
  s = scene([OPP, list(LUFFY_L, ['ST08-015'])], (g) => { setChars(g, 0, [{ num: WEAK }]); setHand(g, 1, ['ST08-015']); setDon(g, 1, 3, 2); }, 1);
  s = resolve(play(s, 'ST08-015', 1));
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(s.players[1].leader.don, 1, 'à son tour : oui');
  s = scene([list(YAMATO_L, ['ST08-015']), list(LUFFY_L, [])], (g) => { setChars(g, 1, [{ num: WEAK }]); setHand(g, 0, ['ST08-015']); setDon(g, 0, 3); setDon(g, 1, 0, 2); });
  s = resolve(play(s, 'ST08-015'));
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[1].leader.don, 0, 'au tour adverse : non');
  // Kaido : DON!! −7 : carte du dessus de la Vie adverse ; Vie vide : rien, pas de victoire
  s = scene([list(KAIDO_L, []), OPP], (g) => { setDon(g, 0, 7); setLife(g, 1, [WEAK, VANILLA2]); });
  s = resolve(act(s, `act:${leaderUid(s, 0)}`));
  assert.equal(s.players[1].life.length, 1);
  assert.equal(s.players[1].life[0].num, VANILLA2);
  assert.equal(s.players[0].donActive, 0);
  s = scene([list(KAIDO_L, []), OPP], (g) => { setDon(g, 0, 7); setLife(g, 1, []); });
  s = resolve(act(s, `act:${leaderUid(s, 0)}`));
  assert.equal(s.winner ?? null, null);
  // Great Eruption : [Déclenchement] : l'adversaire choisit et défausse ; main vide : rien
  s = scene([list(NAVY_L, []), list(NAVY_L, ['ST06-015'])], (g) => { setChars(g, 1, []); setHand(g, 1, []); setLife(g, 1, ['ST06-015']); setHand(g, 0, [WEAK]); });
  s = toTrigger(s, leaderUid(s, 0), leaderUid(s, 1));
  s = choose(s, 'trigger');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 0);
});
