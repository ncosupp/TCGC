// Promos (tâche S20) : un test par effet des promos codées à la main (condition vraie et fausse), les Q&A officielles des promos
// appliquées, et les recettes que le banc d'essai ne sait pas mesurer ([En attaquant] qui change l'issue du combat,
// [Déclenchement] contre l'attaquant du banc). Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS, handCoded, recipeEntry } from '../engine/cards/index.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import type { DeckList } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { attackAbility, attackTargets, hasKeyword, power } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, hasOption, logHas, play, setChars, setDon, setHand, setLife, tag } from './helpers.ts';
import { charUid, leaderUid, list, oppLeaderDon, scene } from './eb-scene.ts';

const STRIKE = 'OP01-010';   // coût 1, 3000, <Frappe>
const C3 = 'ST21-006';       // coût 3, 5000, <Spécial>
const C4 = 'ST21-008';       // coût 4, 6000, <Sagesse>
const SPECIAL = 'EB03-030';  // coût 5, 6000, <Spécial>
const FILM_CHAR = 'OP02-028'; // coût 3, 5000, {FILM}
const NEPTUNIAN = 'OP13-010'; // coût 6, 8000, {Neptunian}
const FMI = 'OP15-030';      // coût 5, 6000, {Fish-Man Island}
const CROSS = 'OP09-055';    // coût 5, 7000, {Cross Guild}
const BLOCKER = 'OP02-012';  // coût 2, 3000, [Bloqueur]
const PROMOS = ['P-002', 'P-007', 'P-024', 'P-025', 'P-027', 'P-036', 'P-037', 'P-046', 'P-051', 'P-055', 'P-058', 'P-059', 'P-082', 'P-084', 'P-091',
  'P-097', 'P-100', 'P-113', 'P-152'];
const ALL = [STRIKE, C3, C4, SPECIAL, FILM_CHAR, 'OP02-033', NEPTUNIAN, FMI, CROSS, BLOCKER, ...PROMOS];
let decks = 0;
const deck = (leader: string): DeckList => ({ id: `PERSO-s20-${decks++}`, name: 'Essai S20', series: 'PERSO', leader, cards: Object.fromEntries(ALL.map((n) => [n, 8])) });
const PLAIN = 'OP05-002';    // Leader sans effet de combat ni de fin de tour
const UTA = 'ST11-001';
const BUGGY = 'OP09-042';    // [Buggy], {Cross Guild}
const BW = 'ST03-001';       // un type qui contient « Baroque Works »
const OPP = () => deck(PLAIN);
const me = (leader = PLAIN) => deck(leader);

// L'adversaire (actif) attaque `target` avec son Leader ; ni blocage ni contre de ma part
function oppAttacks(s: GameState, target: number): GameState {
  s = attack(s, leaderUid(s, 1), target);
  while (s.decision?.player === 0 && s.decision.kind === 'blocker') s = act(s, 'noblock');
  while (s.decision?.player === 0 && s.decision.kind === 'counter') s = act(s, 'pass');
  return s;
}
// Mon attaque : l'adversaire ne bloque pas et ne contre pas
function passDefense(s: GameState): GameState {
  while (s.decision?.player === 1 && s.decision.kind === 'blocker') s = act(s, 'noblock');
  while (s.decision?.player === 1 && s.decision.kind === 'counter') s = act(s, 'pass');
  return s;
}
const giveDon = (g: GameState, p: PlayerId, uid: number, k: number) => {
  const c = [g.players[p].leader, ...g.players[p].chars].find((x) => x.uid === uid)!;
  c.don += k;
  g.players[p].donDeck -= k;
};

test('promos : niveaux (toutes jouables) et promos déjà codées inchangées', () => {
  const nums = Object.keys(CARDS).filter((n) => n.startsWith('P-'));
  const notPlayable = nums.filter((n) => !['verified', 'coded', 'auto'].includes(confidence(n)));
  assert.deepEqual(notPlayable, []);
  assert.equal(recipeEntry('P-008')?.level, 'verified', 'P-008 : doute levé (n° 4101)');
  for (const n of PROMOS.filter((x) => !['P-037', 'P-113'].includes(x))) assert.ok(handCoded(n), `${n} codée à la main`);
  // codées avant l'étape C (decks préconstruits compris) : toujours à la main, aucune recette ne les remplace
  for (const n of ['P-042', 'P-044', 'P-054', 'P-069', 'P-071', 'P-074', 'P-077', 'P-085', 'P-088', 'P-090', 'P-099', 'P-101', 'P-102', 'P-103', 'P-104', 'P-105',
    'P-106', 'P-111', 'P-135', 'P-155']) {
    assert.ok(handCoded(n), n);
    assert.equal(recipeEntry(n), undefined, n);
  }
});

test('I Smell Adventure!!! (P-002) : sa main dans le deck, mélange, autant de cartes piochées ; main vide : rien (Q&A) ; [Déclenchement]', () => {
  let s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-002', C3, C4, STRIKE]); setDon(g, 0, 3); });
  const deck0 = s.players[0].deck.length;
  s = play(s, 'P-002');
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.players[0].deck.length, deck0);
  s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-002']); setDon(g, 0, 3); });
  s = play(s, 'P-002');
  assert.equal(s.players[0].hand.length, 0);
  assert.ok(CARDS['P-002'].onTrigger);
  coherent(s);
});

test('Luffy (P-007) et Smoker (P-025) : [DON!! x1] protégés en combat selon l’attribut de l’attaquant (Q&A de P-007)', () => {
  // P-007 : un Leader <Frappe> attaque : pas de KO avec 1 DON!!, KO sans DON!!
  const strikeLeader = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'LEADER' && CARDS[n].attributes.includes('Strike') && !CARDS[n].attributes.includes('Special'))!;
  for (const don of [1, 0]) {
    let s = scene([me(), deck(strikeLeader)], (g) => { setChars(g, 0, [{ num: 'P-007', extra: { rested: true } }]); if (don) giveDon(g, 0, g.players[0].chars[0].uid, 1); oppLeaderDon(g, 2); }, 1);
    const u = charUid(s, 0, 'P-007');
    s = oppAttacks(s, u);
    assert.equal(s.players[0].chars.some((c) => c.uid === u), don === 1, `P-007 avec ${don} DON!!`);
  }
  // P-025 : un Leader sans <Spécial> le met KO (« Characters » seulement), un Personnage <Frappe> non
  let s = scene([me(), deck(strikeLeader)], (g) => { setChars(g, 0, [{ num: 'P-025', extra: { rested: true } }]); giveDon(g, 0, g.players[0].chars[0].uid, 1); oppLeaderDon(g, 2); }, 1);
  let u = charUid(s, 0, 'P-025');
  s = oppAttacks(s, u);
  assert.ok(!s.players[0].chars.some((c) => c.uid === u), 'P-025 mis KO par un Leader');
  s = scene([me(), OPP()], (g) => {
    setChars(g, 0, [{ num: 'P-025', extra: { rested: true } }]);
    giveDon(g, 0, g.players[0].chars[0].uid, 1);
    setChars(g, 1, [{ num: NEPTUNIAN }, { num: SPECIAL }]);
  }, 1);
  u = charUid(s, 0, 'P-025');
  let a = attack(s, charUid(s, 1, NEPTUNIAN), u);
  while (a.decision?.player === 0) a = act(a, a.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.ok(a.players[0].chars.some((c) => c.uid === u), 'P-025 pas mis KO par un Personnage <Frappe> (8000)');
  // un Personnage <Spécial> plus fort le met KO
  s = scene([me(), OPP()], (g) => {
    setChars(g, 0, [{ num: 'P-025', extra: { rested: true } }]);
    giveDon(g, 0, g.players[0].chars[0].uid, 1);
    setChars(g, 1, [{ num: SPECIAL }]);
    giveDon(g, 1, g.players[1].chars[0].uid, 1);
  }, 1);
  u = charUid(s, 0, 'P-025');
  a = attack(s, charUid(s, 1, SPECIAL), u);
  while (a.decision?.player === 0) a = act(a, a.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.ok(!a.players[0].chars.some((c) => c.uid === u), 'P-025 mis KO par un Personnage <Spécial>');
});

test('King of the Pirates (P-024) : Leader +1000 par Personnage pour le tour ; sans Personnage, rien ; [Déclenchement] +1000', () => {
  let s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-024']); setDon(g, 0, 2); setChars(g, 0, [{ num: C3 }, { num: C4 }, { num: STRIKE }]); });
  const base = power(s, leaderUid(s, 0));
  s = play(s, 'P-024');
  assert.equal(power(s, leaderUid(s, 0)), base + 3000);
  s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-024']); setDon(g, 0, 2); setChars(g, 0, []); });
  const b2 = power(s, leaderUid(s, 0));
  s = play(s, 'P-024');
  assert.equal(power(s, leaderUid(s, 0)), b2);
  assert.ok(CARDS['P-024'].onTrigger);
});

test('General Franky (P-027) : [Tour adverse] ses Personnages de puissance imprimée 3000 ou moins +1000, deux exemplaires +2000 (Q&A)', () => {
  const setup = (g: GameState, copies: number) => setChars(g, 0, [...Array.from({ length: copies }, () => ({ num: 'P-027' })), { num: STRIKE }, { num: C3 }]);
  let s = scene([me(), OPP()], (g) => setup(g, 1), 1);
  assert.equal(power(s, charUid(s, 0, STRIKE)), 4000);
  assert.equal(power(s, charUid(s, 0, C3)), 5000, 'puissance imprimée 5000 : rien');
  assert.equal(power(s, leaderUid(s, 0)), 5000, 'le Leader : rien');
  s = scene([me(), OPP()], (g) => setup(g, 2), 1);
  assert.equal(power(s, charUid(s, 0, STRIKE)), 5000);
  s = scene([me(), OPP()], (g) => setup(g, 1), 0);
  assert.equal(power(s, charUid(s, 0, STRIKE)), 3000, 'son tour : rien');
});

test('Luffy (P-036) : coût Vie en main, lui et son Leader +1000 (les deux, Q&A) ; sans payer, rien', () => {
  let s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-036' }]); setLife(g, 0, [C3, C4]); });
  const u = charUid(s, 0, 'P-036');
  s = attack(s, u, leaderUid(s, 1));
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  if (tag(s) === 'lifeSide') s = choose(s, 'top');
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  assert.equal(power(s, u), 5000);
  assert.equal(power(s, leaderUid(s, 0)), 6000);
  assert.equal(s.players[0].life.length, 1);
  s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-036' }]); setLife(g, 0, [C3, C4]); });
  s = attack(s, charUid(s, 0, 'P-036'), leaderUid(s, 1));
  s = choose(s, 'no');
  assert.equal(power(s, charUid(s, 0, 'P-036')), 4000);
  assert.equal(s.players[0].life.length, 2);
});

test('Luffy (P-037, recette) : [En attaquant] +1000 avec 2 Personnages épuisés (lui compris), sinon rien', () => {
  const run = (others: number) => {
    let s = scene([me(), OPP()], (g) => setChars(g, 0, [{ num: 'P-037' }, ...Array.from({ length: others }, () => ({ num: C3, extra: { rested: true } }))]));
    const u = charUid(s, 0, 'P-037');
    s = attack(s, u, leaderUid(s, 1));
    return power(s, u);
  };
  assert.equal(run(1), 5000);
  assert.equal(run(0), 4000);
});

test('Yamato (P-046) : toute sa main au-dessous du deck, puis autant de cartes piochées ; refus : rien', () => {
  let s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-046', C3, C4]); setDon(g, 0, 2); });
  const hand = s.players[0].hand.filter((c) => c.num !== 'P-046').map((c) => c.uid);
  s = play(s, 'P-046');
  assert.equal(tag(s), 'may');
  s = choose(s, 'yes');
  while (tag(s) === 'bottomOrder') s = act(s, 'keep');
  assert.equal(s.players[0].hand.length, 2);
  assert.ok(hand.every((u) => s.players[0].deck.slice(-2).some((c) => c.uid === u)), 'au-dessous du deck');
  assert.ok(!s.players[0].hand.some((c) => hand.includes(c.uid)));
  s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-046', C3]); setDon(g, 0, 2); });
  const kept = s.players[0].hand.find((c) => c.num === C3)!.uid;
  s = play(s, 'P-046');
  s = choose(s, 'no');
  assert.deepEqual(s.players[0].hand.map((c) => c.uid), [kept]);
});

test('Shanks (P-051) : [En attaquant] N cartes défaussées : +1000 × N pour le combat ; 0 : rien', () => {
  let s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-051' }]); setHand(g, 0, [C3, C4, STRIKE]); });
  const u = charUid(s, 0, 'P-051');
  s = attack(s, u, leaderUid(s, 1));
  assert.equal(tag(s), 'mayCount');
  assert.ok(hasOption(s, 'n:3') && !hasOption(s, 'n:4'));
  s = choose(s, 'n:2');
  while (tag(s) === 'discard') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(power(s, u), 11000);
  s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-051' }]); setHand(g, 0, [C3]); });
  s = attack(s, charUid(s, 0, 'P-051'), leaderUid(s, 1));
  s = choose(s, 'n:0');
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(power(s, charUid(s, 0, 'P-051')), 9000);
});

test('Luffy (P-055) : coût 2 cartes : l’adversaire choisit lequel de ses Personnages va sous son deck (Q&A) ; sans Personnage, coût payable, rien', () => {
  let s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-055', C3, C4]); setDon(g, 0, 10); setChars(g, 1, [{ num: SPECIAL }, { num: STRIKE }]); });
  s = play(s, 'P-055');
  s = choose(s, 'yes');
  while (tag(s) === 'discard') s = act(s, s.decision!.options[0].id);
  assert.equal(s.decision?.player, 1, 'l’adversaire choisit');
  const pick = s.decision!.options.find((o) => o.uid === charUid(s, 1, STRIKE))!.id;
  s = act(s, pick);
  assert.deepEqual(s.players[1].chars.map((c) => c.num), [SPECIAL]);
  assert.equal(s.players[1].deck.at(-1)?.num, STRIKE);
  assert.equal(s.players[0].hand.length, 0);
  s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-055', C3, C4]); setDon(g, 0, 10); setChars(g, 1, []); });
  s = play(s, 'P-055');
  assert.equal(tag(s), 'mayIdle');
  s = choose(s, 'yes');
  while (tag(s) === 'discard') s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, 0);
});

test('Où souffle le vent (P-058) : Leader [Uta] : ses {FILM} redressés à la fin du tour, ceux épuisés ensuite compris (Q&A) ; autre Leader : rien ; [Déclenchement] aussitôt', () => {
  let s = scene([me(UTA), OPP()], (g) => { setHand(g, 0, ['P-058']); setDon(g, 0, 3); setChars(g, 0, [{ num: FILM_CHAR, extra: { rested: true } }, { num: 'OP02-033' }, { num: C3, extra: { rested: true } }]); });
  s = play(s, 'P-058');
  assert.ok(s.players[0].chars.find((c) => c.num === FILM_CHAR)!.rested, 'pas tout de suite');
  // un {FILM} épuisé après l'Événement (une attaque) est redressé aussi
  s = attack(s, charUid(s, 0, 'OP02-033'), leaderUid(s, 1));
  s = passDefense(s);
  while (s.decision?.player === 0 && s.decision.kind !== 'main') s = act(s, s.decision.options[0].id);
  s = act(s, 'end');
  while (s.decision && s.active === 0) s = act(s, s.decision.options[0].id);
  const mine = (n: string) => s.players[0].chars.find((c) => c.num === n);
  assert.equal(mine(FILM_CHAR)?.rested, false);
  assert.equal(mine('OP02-033')?.rested, false);
  assert.equal(mine(C3)?.rested, true, 'pas {FILM}');
  s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-058']); setDon(g, 0, 3); setChars(g, 0, [{ num: FILM_CHAR, extra: { rested: true } }]); });
  s = play(s, 'P-058');
  assert.equal(s.delayed.length, 0, 'autre Leader : rien');
  coherent(s);
});

test('Le monde continue (P-059) : Leader [Uta] : N Personnages renvoyés, +2000 × N pour le combat ; autre Leader : rien', () => {
  const setup = (g: GameState) => { setHand(g, 0, ['P-059']); setDon(g, 0, 3); setChars(g, 0, [{ num: C3 }, { num: C4 }]); oppLeaderDon(g, 3); };
  let s = scene([me(UTA), OPP()], setup, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker') s = act(s, 'noblock');
  const opt = s.decision!.options.find((o) => o.id.startsWith('cevent:'))!;
  s = act(s, opt.id);
  assert.equal(tag(s), 'mayCount');
  s = choose(s, 'n:2');
  s = act(s, s.decision!.options[0].id);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].chars.length, 0);
  assert.ok(logHas(s, 'gagne +4000 de puissance pour le combat'));
  assert.equal(CARDS['P-059'].counterUseful?.(s, 0, leaderUid(s, 0)), false);
  s = scene([me(), OPP()], setup, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker') s = act(s, 'noblock');
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  assert.notEqual(tag(s), 'mayCount');
  assert.equal(s.players[0].chars.length, 2);
});

test('Crocodile (P-082) : Leader {Cross Guild} ou « Baroque Works » : un Personnage adverse de 2000 ou moins sous le deck ; autre Leader : rien', () => {
  for (const [leader, done] of [[BUGGY, true], [BW, true], [PLAIN, false]] as const) {
    let s = scene([me(leader), OPP()], (g) => { setHand(g, 0, ['P-082']); setDon(g, 0, 10); setChars(g, 1, [{ num: BLOCKER, extra: { rested: true } }]); });
    const target = charUid(s, 1, BLOCKER);
    // 3000 de puissance imprimée, ramenée à 2000 pour le tour
    s.mods.push({ uid: target, stat: 'power', amount: -1000, until: 'turn', source: 'test' });
    s = play(s, 'P-082');
    if (done) s = choose(s, (o) => o.uid === target);
    assert.equal(s.players[1].chars.length, done ? 0 : 1, leader);
  }
});

test('Baggy (P-084) : ne peut pas attaquer ; Leader [Buggy] : aucun Personnage de coût 3 ou 4 (des deux joueurs) ne peut attaquer ; [Jouée] un {Cross Guild}', () => {
  let s = scene([me(BUGGY), OPP()], (g) => { setChars(g, 0, [{ num: 'P-084' }, { num: C3 }, { num: C4 }, { num: STRIKE }]); setChars(g, 1, [{ num: C3 }, { num: SPECIAL }]); });
  const can = (p: PlayerId, n: string) => attackAbility(s, p, s.players[p].chars.find((c) => c.num === n)!).can;
  assert.equal(can(0, 'P-084'), false);
  assert.equal(can(0, C3), false);
  assert.equal(can(0, C4), false);
  assert.equal(can(0, STRIKE), true);
  assert.equal(can(1, C3), false, 'adverse aussi');
  assert.equal(can(1, SPECIAL), true);
  assert.ok(attackTargets(s, 0, s.players[0].leader).length > 0, 'le Leader attaque');
  s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-084' }, { num: C3 }]); });
  assert.equal(attackAbility(s, 0, s.players[0].chars.find((c) => c.num === C3)!).can, true, 'autre Leader');
  s = scene([me(BUGGY), OPP()], (g) => { setHand(g, 0, ['P-084', CROSS]); setDon(g, 0, 10); });
  s = play(s, 'P-084');
  s = choose(s, (o) => o.num === CROSS || s.players[0].hand.some((c) => c.uid === o.uid && c.num === CROSS));
  assert.ok(s.players[0].chars.some((c) => c.num === CROSS));
});

test('Shirahoshi (P-091) : [Jouée] un {Neptunian} ou {Fish-Man Island} de coût 5 ou moins ; s’épuiser : un {Neptunian} joué ce tour peut attaquer les Personnages', () => {
  let s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-091', FMI, NEPTUNIAN]); setDon(g, 0, 10); setChars(g, 1, [{ num: C3, extra: { rested: true } }]); });
  s = play(s, 'P-091');
  assert.ok(!s.decision!.options.some((o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === NEPTUNIAN)), 'coût 6 : non');
  s = choose(s, (o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === FMI));
  assert.ok(s.players[0].chars.some((c) => c.num === FMI));
  s = play(s, NEPTUNIAN);
  const nep = charUid(s, 0, NEPTUNIAN);
  assert.equal(attackAbility(s, 0, s.players[0].chars.find((c) => c.uid === nep)!).can, false);
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('act:') && o.uid === charUid(s, 0, 'P-091'))!.id);
  if (s.decision?.tag === 'ownGrant') s = choose(s, (o) => o.uid === nep);
  const ab = attackAbility(s, 0, s.players[0].chars.find((c) => c.uid === nep)!);
  assert.deepEqual(ab, { can: true, charsOnly: true });
  assert.ok(s.players[0].chars.find((c) => c.num === 'P-091')!.rested);
});

test('Shanks (P-097) : [Jouée] l’adversaire ne peut pas activer [Bloqueur] pour le tour, même un Bloqueur joué ensuite ; le tour suivant, si', () => {
  let s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-097']); setDon(g, 0, 10); setChars(g, 1, [{ num: BLOCKER }]); });
  const b = charUid(s, 1, BLOCKER);
  assert.equal(hasKeyword(s, 1, s.players[1].chars[0], 'Blocker'), true);
  s = play(s, 'P-097');
  assert.equal(hasKeyword(s, 1, s.players[1].chars.find((c) => c.uid === b)!, 'Blocker'), false);
  s.turn++;
  assert.equal(hasKeyword(s, 1, s.players[1].chars.find((c) => c.uid === b)!, 'Blocker'), true);
});

test('Teach (P-100) : [En attaquant] effets du Leader et des Personnages adverses annulés pour le tour', () => {
  let s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-100' }]); setChars(g, 1, [{ num: BLOCKER }]); });
  s = attack(s, charUid(s, 0, 'P-100'), leaderUid(s, 1));
  assert.ok(s.mods.some((m) => m.uid === leaderUid(s, 1) && m.stat === 'negated'));
  assert.ok(s.mods.some((m) => m.uid === charUid(s, 1, BLOCKER) && m.stat === 'negated'));
  assert.equal(hasKeyword(s, 1, s.players[1].chars[0], 'Blocker'), false, 'son [Bloqueur] imprimé est annulé');
});

test('Bonney (P-113, recette) : [DON!! x2] [Tour adverse] [Bloqueur] et +2000 ; [Déclenchement] KO de coût 3 ou moins', () => {
  let s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-113' }]); giveDon(g, 0, g.players[0].chars[0].uid, 2); }, 1);
  const u = charUid(s, 0, 'P-113');
  const base = CARDS['P-113'].power!;
  assert.equal(power(s, u), base + 2000);
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Blocker'), true);
  s = scene([me(), OPP()], (g) => { setChars(g, 0, [{ num: 'P-113' }]); giveDon(g, 0, g.players[0].chars[0].uid, 1); }, 1);
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Blocker'), false, '1 DON!! : non');
  // [Déclenchement] : l'adversaire attaque mon Leader, la carte de Vie est P-113
  s = scene([me(), OPP()], (g) => { setLife(g, 0, ['P-113']); setChars(g, 1, [{ num: C3 }, { num: SPECIAL }]); oppLeaderDon(g, 2); }, 1);
  s = oppAttacks(s, leaderUid(s, 0));
  if (tag(s) === 'trigger') s = choose(s, 'trigger');
  s = choose(s, (o) => o.uid === charUid(s, 1, C3));
  assert.deepEqual(s.players[1].chars.map((c) => c.num), [SPECIAL]);
});

test('Nami (P-117, Leader) : deck {East Blue} seulement, victoire à deck vide, [DON!! x1] défausse du dessus après dégâts', () => {
  const r = CARDS['P-117'].rules!;
  assert.equal(r.deckOut, 'win');
  assert.equal(r.deckRestriction!(CARDS['EB02-029']), null);
  assert.notEqual(r.deckRestriction!(CARDS[C3]), null);
  assert.equal(CARDS['P-117'].when?.length, 1);
});

test('Newgate (P-152) : [Jouée] son Leader et ses Personnages +2000 pour le tour, puis KO de 3000 ou moins', () => {
  let s = scene([me(), OPP()], (g) => { setHand(g, 0, ['P-152']); setDon(g, 0, 10); setChars(g, 0, [{ num: C3 }]); setChars(g, 1, [{ num: STRIKE }, { num: C4 }]); });
  const lp = power(s, leaderUid(s, 0));
  s = play(s, 'P-152');
  s = choose(s, (o) => o.uid === charUid(s, 1, STRIKE));
  assert.equal(power(s, leaderUid(s, 0)), lp + 2000);
  assert.equal(power(s, charUid(s, 0, C3)), 7000);
  assert.equal(power(s, charUid(s, 0, 'P-152')), CARDS['P-152'].power! + 2000);
  assert.deepEqual(s.players[1].chars.map((c) => c.num), [C4]);
});


test('Yamato (P-008, n° 4101) : activation facultative ; activée, 1 Personnage adverse de coût 2 ou moins épuisé (imposé), sans cible le coût se paie', () => {
  const s0 = (oppChars: string[]) => scene([list(PLAIN, ['P-008', STRIKE, C3]), list(PLAIN, [STRIKE, C3])], (g) => {
    setChars(g, 0, [{ num: 'P-008' }]);
    setChars(g, 1, oppChars.map((num) => ({ num })));
  });
  // facultative : la partie continue sans l'activer (l'option existe, rien ne l'impose)
  let s = s0([STRIKE, C3]);
  const yamato = charUid(s, 0, 'P-008');
  assert.ok(hasOption(s, `act:${yamato}`));
  // activée : le Personnage de coût 1 est épuisé, pas de choix « aucun »
  s = choose(s, `act:${yamato}`);
  if (s.decision?.player === 0 && s.decision.tag !== undefined && s.decision.options.length > 1) assert.ok(!hasOption(s, 'none'), 'cible imposée');
  while (s.decision?.player === 0 && s.decision.options.some((o) => o.uid === charUid(s, 1, STRIKE))) s = choose(s, (o) => o.uid === charUid(s, 1, STRIKE));
  assert.ok(s.players[0].chars.find((c) => c.num === 'P-008')!.rested, 'Yamato épuisé (coût)');
  assert.ok(s.players[1].chars.find((c) => c.num === STRIKE)!.rested, 'le Personnage de coût 1 est épuisé');
  assert.ok(!s.players[1].chars.find((c) => c.num === C3)!.rested, 'coût 3 : pas visé');
  // sans cible : le coût se paie quand même (Q&A), rien d'autre
  s = s0([C3]);
  s = choose(s, `act:${charUid(s, 0, 'P-008')}`);
  assert.ok(s.players[0].chars.find((c) => c.num === 'P-008')!.rested);
  assert.ok(!s.players[1].chars.find((c) => c.num === C3)!.rested);
  coherent(s);
});
