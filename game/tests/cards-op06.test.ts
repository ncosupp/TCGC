// OP06, ST12, ST11 (étape C, tâche S14) : un test par effet des cartes codées à la main (game/engine/cards/op06.ts), condition
// vraie et fausse, les réponses des Q&A officielles (lues, jamais recopiées) et les recettes que le banc d'essai ne sait pas
// mesurer ([Contre] « pendant ce combat », coût « épuisez ce Lieu », [En attaquant] qui change l'issue du combat, Leader
// {GERMA 66} qui pioche quand une DON!! est renvoyée). Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS, cardStatus } from '../engine/cards/index.ts';
import { DECKS } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { attackTargets, basePower, hasKeyword, isNegated, power, returnDon } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, play, setChars, setDeckTop, setDon, setHand, setLife, take } from './helpers.ts';
import { charUid, counterGain, leaderUid, list as baseList, oppLeaderDon, scene } from './eb-scene.ts';

const FILM_L = 'OP06-001';
const FISH_L = 'OP06-020';
const GERMA_L = 'OP06-042';
const THRILLER_L = 'OP06-080';
const EAST_BLUE_L = 'OP03-021';
const WEAK = 'ST12-009';       // Personnage coût 1, sans effet utile ici
const VANILLA2 = 'ST12-015';   // Personnage coût 2, 4000
const UPPER_YARD = 'OP05-117'; // Lieu coût 1
// Une liste d'essai : les cartes données et, dans tous les decks, les cartes neutres utilisées par les scènes (en nombre)
const list = (leader: string, nums: string[]) => {
  const d = baseList(leader, [...new Set([WEAK, VANILLA2, UPPER_YARD, 'OP06-004', 'OP06-010', 'OP06-012', 'OP06-089', ...nums])]);
  d.cards[WEAK] = 9;
  d.cards[VANILLA2] = 9;
  return d;
};
const OPP = list(DECKS['ST-36'].leader, []);

const mine = (s: GameState, num: string, p: PlayerId = 0) => s.players[p].chars.find((c) => c.num === num)!;
const isOption = (s: GameState, id: string) => Boolean(s.decision?.options.some((o) => o.id === id));
const pickCard = (s: GameState) => (s.decision?.options.some((o) => o.id.startsWith('card:')) ? choose(s, (o) => o.id.startsWith('card:')) : s);
// répond « oui » et prend la première carte proposée, jusqu'à la fin de l'effet
const resolve = (s: GameState) => {
  while (s.decision?.inEffect) {
    const d = s.decision;
    s = d.options.some((o) => o.id === 'yes') ? choose(s, 'yes') : d.options.some((o) => o.id.startsWith('card:')) ? choose(s, (o) => o.id.startsWith('card:')) : act(s, d.options[0].id);
  }
  return s;
};
const toTrash = (s: GameState, p: PlayerId, nums: string[]) => { s.players[p].trash.push(...nums.map((n) => take(s, p, n))); };
const stage = (s: GameState, p: PlayerId, num: string) => {
  const c = take(s, p, num);
  s.players[p].stage = { uid: c.uid, num: c.num, rested: false, don: 0, playedTurn: 0, usedOpt: [] };
};
// L'adversaire (joueur 1, actif) attaque mon Leader avec le sien
const oppAttacks = (s: GameState) => attack(s, leaderUid(s, 1), leaderUid(s, 0));

test('OP06 : cartes codées à la main jouables ; recettes relues vérifiées', () => {
  for (const n of ['OP06-042', 'OP06-030', 'OP06-006', 'OP06-009', 'OP06-012', 'OP06-014', 'OP06-015', 'OP06-026', 'OP06-047', 'OP06-048', 'OP06-061', 'OP06-062', 'OP06-072', 'OP06-074', 'OP06-086',
    'OP06-092', 'OP06-095', 'OP06-097', 'OP06-102', 'OP06-103', 'OP06-104', 'OP06-106', 'OP06-110', 'OP06-111', 'OP06-114', 'OP06-116', 'OP06-117']) assert.equal(cardStatus(n), 'coded', n);
  for (const n of ['ST12-013', 'ST12-014']) assert.equal(confidence(n), 'doubt', n);
  for (const n of ['OP06-021', 'OP06-028', 'OP06-060', 'OP06-079', 'OP06-098', 'OP06-115', 'ST12-001', 'ST12-011', 'ST12-017', 'ST11-001', 'ST11-004']) assert.equal(confidence(n), 'verified', n);
});

// ---------- Cartes à la main ----------

test('Saga (OP06-006) : +1000 jusqu’au prochain tour ; à la fin du tour, 1 Personnage {FILM} défaussé, même si Saga a quitté le terrain (Q&A)', () => {
  const deck = list(FILM_L, ['OP06-006', 'OP06-004', 'OP06-010']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-006', extra: { don: 1 } }, { num: 'OP06-004' }, { num: 'OP06-010' }]); });
  const saga = charUid(s, 0, 'OP06-006');
  s = attack(s, saga, leaderUid(s, 1));
  s = resolve(s);
  assert.equal(power(s, saga), 7000, '5000 + 1 DON!! + 1000');
  while (s.decision?.player === 1) s = act(s, s.decision.options.find((o) => o.id === 'noblock' || o.id === 'nocounter' || o.id === 'hand')?.id ?? s.decision.options[0].id);
  s = resolve(s);
  // Saga quitte le terrain avant la fin du tour : la question vient quand même
  s.players[0].chars = s.players[0].chars.filter((c) => c.uid !== saga);
  s = act(s, 'end');
  assert.equal(s.decision?.tag, 'trashOwn');
  assert.equal(s.decision?.options.length, 2);
  s = choose(s, `card:${charUid(s, 0, 'OP06-004')}`);
  assert.ok(s.players[0].trash.some((c) => c.num === 'OP06-004'));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP06-010'));
  // sans DON!! : rien
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-006' }, { num: 'OP06-004' }]); });
  const uid = charUid(s, 0, 'OP06-006');
  s = attack(s, uid, leaderUid(s, 1));
  assert.equal(power(s, uid), 5000);
  assert.equal(s.delayed.length, 0);
});

test('Shuraiya (OP06-009) : base = puissance du Leader adverse à l’activation (DON!! comprises) ; une seule fois par tour ; Q&A', () => {
  const deck = list(FILM_L, ['OP06-009']);
  // [En attaquant] : 5000 + 1 DON!! donnée = 6000 ; un gain ensuite du Leader adverse ne change rien
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-009', extra: { don: 1 } }]); });
  const uid = charUid(s, 0, 'OP06-009');
  s = attack(s, uid, leaderUid(s, 1));
  assert.equal(basePower(s, uid), 5000);
  assert.equal(power(s, uid), 6000);
  s.mods.push({ uid: leaderUid(s, 1), stat: 'power', amount: 1000, until: 'battle', source: 'essai' });
  assert.equal(basePower(s, uid), 5000);
  // [En bloquant] : le Leader adverse attaque avec 2 DON!! données (7000) : base 7000, et un [Contre] peut encore s'ajouter
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-009' }]); oppLeaderDon(g, 2); }, 1);
  const blocker = charUid(s, 0, 'OP06-009');
  s = oppAttacks(s);
  assert.equal(s.decision?.kind, 'blocker');
  s = act(s, `block:${blocker}`);
  assert.equal(basePower(s, blocker), 7000);
  assert.equal(power(s, blocker), 7000);
  assert.equal(s.decision?.kind, 'counter');
  // [Une fois par tour] : déjà utilisé ce tour-ci (même effet pour les deux moments)
  assert.ok(mine(s, 'OP06-009').usedOpt.includes('Shuraiya'));
  // une nouvelle activation remplace l'ancienne valeur, même plus basse
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-009' }]); });
  const u2 = charUid(s, 0, 'OP06-009');
  s.mods.push({ uid: u2, stat: 'basePower', amount: 9000, until: s.turn + 1, source: 'Shuraiya' });
  s = attack(s, u2, leaderUid(s, 1));
  assert.equal(basePower(s, u2), 5000);
});

test('Bear.King (OP06-012) : protégé en combat si l’adversaire a un Leader ou un Personnage de 6000 de base ou plus', () => {
  const deck = list(FILM_L, ['OP06-012']);
  const can = CARDS['OP06-012'].cantBeKO!;
  // Leader adverse à 5000, sans Personnage : pas protégé
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-012' }]); setChars(g, 1, []); });
  const self = mine(s, 'OP06-012');
  assert.equal(can(s, 0, self, 'battle', 1), false);
  // un Personnage adverse de 6000 de base : protégé en combat, pas contre un effet
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-012' }]); setChars(g, 1, [{ num: 'OP06-012' }]); });
  assert.equal(can(s, 0, mine(s, 'OP06-012'), 'battle', 1), true);
  assert.equal(can(s, 0, mine(s, 'OP06-012'), 'effect', 1), false);
  // le Leader adverse dont la base est fixée à 6000 compte aussi (la recette ne lisait que les Personnages)
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-012' }]); setChars(g, 1, []); });
  s.mods.push({ uid: leaderUid(s, 1), stat: 'basePower', amount: 6000, until: 'turn', source: 'essai' });
  assert.equal(can(s, 0, mine(s, 'OP06-012'), 'battle', 1), true);
  // 5000 + 1000 de bonus : la base reste 5000
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-012' }]); setChars(g, 1, []); oppLeaderDon(g, 1); }, 1);
  assert.equal(can(s, 0, mine(s, 'OP06-012'), 'battle', 1), false);
});

test('Ratchet (OP06-014) : défausse autant de {FILM} qu’on veut, +1000 par carte sur une seule carte (Q&A) ; rien sans défausse', () => {
  const deck = list(FILM_L, ['OP06-014', 'OP06-004']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-014' }, { num: WEAK }]); setHand(g, 0, ['OP06-004', 'OP06-004', WEAK]); }, 1);
  s = oppAttacks(s);
  s = choose(s, 'yes');
  s = choose(s, 'yes');
  assert.equal(s.players[0].hand.length, 1, 'la carte sans type {FILM} reste');
  assert.equal(s.decision?.tag, 'ownPower');
  s = choose(s, `card:${leaderUid(s, 0)}`);
  assert.equal(power(s, leaderUid(s, 0)), 7000);
  // refus
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-014' }]); setHand(g, 0, ['OP06-004']); }, 1);
  s = choose(oppAttacks(s), 'no');
  assert.equal(power(s, leaderUid(s, 0)), 5000);
  assert.equal(s.players[0].hand.length, 1);
});

test('Lily Carnation (OP06-015) : coût un Personnage de 6000 ou plus ; joue épuisé un {FILM} de 2000 à 5000 de la Défausse', () => {
  const deck = list(FILM_L, ['OP06-015', 'OP06-006', 'OP06-010', 'OP06-012']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-015' }, { num: 'OP06-012' }]); toTrash(g, 0, ['OP06-006', 'OP06-010']); });
  const lily = charUid(s, 0, 'OP06-015');
  assert.ok(isOption(s, `act:${lily}`));
  s = act(s, `act:${lily}`);
  assert.ok(s.decision?.options.every((o) => o.num !== 'OP06-010'), '7000 de puissance : pas proposé');
  s = resolve(s);
  assert.ok(s.players[0].trash.some((c) => c.num === 'OP06-012'), 'coût payé');
  assert.ok(mine(s, 'OP06-006').rested, 'joué épuisé');
  assert.ok(!isOption(s, `act:${lily}`), 'une fois par tour');
  // sans Personnage de 6000 : pas proposé
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-015' }, { num: WEAK }]); toTrash(g, 0, ['OP06-006']); });
  assert.ok(!isOption(s, `act:${charUid(s, 0, 'OP06-015')}`));
});

test('Koushirou (OP06-026) : redresse un <Tranche> de coût 4 ou moins ; plus aucune attaque de Leader ce tour-ci (Q&A), même sans cible', () => {
  const deck = list(FILM_L, ['OP06-026', 'OP06-004', 'OP06-010']);
  let s = scene([deck, OPP], (g) => {
    setHand(g, 0, ['OP06-026']); setDon(g, 0, 5);
    setChars(g, 0, [{ num: 'OP06-004', extra: { rested: true } }, { num: 'OP06-010' }]);
    setChars(g, 1, [{ num: WEAK, extra: { rested: true } }]);
  });
  s = resolve(play(s, 'OP06-026'));
  assert.equal(mine(s, 'OP06-004').rested, false);
  for (const c of [s.players[0].leader, mine(s, 'OP06-010'), mine(s, 'OP06-004')]) {
    const targets = attackTargets(s, 0, c);
    assert.ok(!targets.includes(leaderUid(s, 1)), 'pas de Leader');
    assert.ok(targets.includes(charUid(s, 1, WEAK)), 'Personnage épuisé attaquable');
  }
  // sans cible : la limite s'applique quand même
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-026']); setDon(g, 0, 5); });
  s = resolve(play(s, 'OP06-026'));
  assert.deepEqual(attackTargets(s, 0, s.players[0].leader), []);
});

test('Charlotte Pudding (OP06-047) : la main adverse retourne au deck mélangé, l’adversaire pioche 5', () => {
  const deck = list(FILM_L, ['OP06-047']);
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-047']); setDon(g, 0, 5); setHand(g, 1, [WEAK, WEAK]); });
  const total = s.players[1].deck.length + s.players[1].hand.length;
  s = resolve(play(s, 'OP06-047'));
  assert.equal(s.players[1].hand.length, 5);
  assert.equal(s.players[1].deck.length + s.players[1].hand.length, total);
  coherent(s);
});

test('Zeff (OP06-048) : à son tour, [Bloqueur] ou Événement adverse : 4 cartes du deck en Défausse ; pas au [Déclenchement] ; ordre d’après la Q&A de ST03-003', () => {
  const deck = list(EAST_BLUE_L, ['OP06-048']);
  const blockers = list(FILM_L, ['OP06-009', 'ST12-017']);
  // [Bloqueur] adverse
  let s = scene([deck, blockers], (g) => { setChars(g, 0, [{ num: 'OP06-048' }]); setChars(g, 1, [{ num: 'OP06-009' }]); });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  const trash0 = s.players[0].trash.length;
  s = act(s, `block:${charUid(s, 1, 'OP06-009')}`);
  assert.equal(s.decision?.tag, 'mayMill');
  s = choose(s, 'yes');
  assert.equal(s.players[0].trash.length, trash0 + 4);
  // Événement [Contre] adverse
  s = scene([deck, blockers], (g) => { setChars(g, 0, [{ num: 'OP06-048' }]); setChars(g, 1, []); setHand(g, 1, ['ST12-017']); setDon(g, 1, 2); });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  // d'abord l'effet de l'Événement, puis Zeff (Q&A de ST03-017 pour un effet du même genre)
  while (s.decision?.inEffect && s.decision.tag !== 'mayMill') s = act(s, s.decision.options[0].id);
  assert.equal(s.decision?.tag, 'mayMill');
  // autre Leader : rien
  s = scene([list(GERMA_L, ['OP06-048']), blockers], (g) => { setChars(g, 0, [{ num: 'OP06-048' }]); setChars(g, 1, [{ num: 'OP06-009' }]); });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = act(s, `block:${charUid(s, 1, 'OP06-009')}`);
  assert.notEqual(s.decision?.tag, 'mayMill');
  // ordre : le joueur actif d'abord (Q&A de ST03-003, pas encore jouable : même ordre avec le [En bloquant] de Shuraiya)
  s = scene([deck, blockers], (g) => { setChars(g, 0, [{ num: 'OP06-048' }]); setChars(g, 1, [{ num: 'OP06-009' }]); });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  const croc = charUid(s, 1, 'OP06-009');
  s = act(s, `block:${croc}`);
  assert.equal(s.decision?.tag, 'mayMill');
  assert.equal(basePower(s, croc), 4000, 'pas encore résolu');
  s = choose(s, 'no');
  assert.equal(basePower(s, croc), 5000, 'résolu ensuite');
  // au tour adverse : rien
  s = scene([deck, blockers], (g) => { setChars(g, 0, [{ num: 'OP06-048' }]); setHand(g, 1, []); }, 1);
  s = oppAttacks(s);
  assert.notEqual(s.decision?.tag, 'mayMill');
});

test('Vinsmoke Ichiji (OP06-061) : si pas plus de DON!! que l’adversaire : −2000 et [Initiative], qui restent (Q&A)', () => {
  const deck = list(GERMA_L, ['OP06-061']);
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-061']); setDon(g, 0, 7); setDon(g, 1, 7); setChars(g, 1, [{ num: WEAK }]); });
  s = resolve(play(s, 'OP06-061'));
  const ichiji = mine(s, 'OP06-061');
  assert.equal(power(s, charUid(s, 1, WEAK)), 1000);
  assert.ok(hasKeyword(s, 0, ichiji, 'Rush'));
  setDon(s, 0, 9);
  assert.ok(hasKeyword(s, 0, ichiji, 'Rush'), 'reste si le nombre de DON!! change');
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-061']); setDon(g, 0, 7); setDon(g, 1, 6); setChars(g, 1, [{ num: WEAK }]); });
  s = resolve(play(s, 'OP06-061'));
  assert.equal(power(s, charUid(s, 1, WEAK)), 3000);
  assert.ok(!hasKeyword(s, 0, mine(s, 'OP06-061'), 'Rush'));
});

test('Vinsmoke Judge (OP06-062) : DON!! −1 et 2 cartes défaussées : jusqu’à 4 {GERMA 66} de noms différents de 4000 ou moins ; [Activation] épuise 1 DON!!', () => {
  const deck = list(GERMA_L, ['OP06-062', 'OP06-064', 'OP06-066', 'OP06-068', 'OP06-060', 'OP06-065']);
  let s = scene([deck, OPP], (g) => {
    setHand(g, 0, ['OP06-062', WEAK, WEAK]); setDon(g, 0, 9); setDon(g, 1, 3);
    toTrash(g, 0, ['OP06-064', 'OP06-064', 'OP06-066', 'OP06-065']);
  });
  s = play(s, 'OP06-062');
  s = choose(s, 'yes');
  assert.ok(s.decision?.options.some((o) => o.num === 'OP06-064'));
  assert.ok(!s.decision?.options.some((o) => o.num === 'OP06-065'), '6000 de puissance');
  s = choose(s, (o) => o.num === 'OP06-064');
  assert.ok(!s.decision?.options.some((o) => o.num === 'OP06-064'), 'même nom : plus proposé');
  s = choose(s, (o) => o.num === 'OP06-066');
  // Niji et Yonji jouées : plus rien (l'autre Niji et celle de 6000 ont le même nom)
  s = resolve(s);
  assert.ok(mine(s, 'OP06-064') && mine(s, 'OP06-066'));
  assert.equal(s.players[0].chars.length, 3);
  // [Activation : Principale]
  const judge = charUid(s, 0, 'OP06-062');
  const donBefore = s.players[1].donActive;
  s = resolve(act(s, `act:${judge}`));
  assert.equal(s.players[1].donActive, donBefore - 1);
  assert.ok(!isOption(s, `act:${judge}`), 'une fois par tour');
  // sans carte possible : coût pas proposé
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-062', WEAK, WEAK]); setDon(g, 0, 8); });
  s = play(s, 'OP06-062');
  assert.ok(!s.decision?.inEffect, 'pas de question');
});

test('Cosette (OP06-072) : [Bloqueur] avec un Leader {GERMA 66} et au moins 2 DON!! de moins, lu au moment de l’attaque (Q&A)', () => {
  const deck = list(GERMA_L, ['OP06-072']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-072' }]); setDon(g, 0, 3); setDon(g, 1, 5); }, 1);
  assert.ok(hasKeyword(s, 0, mine(s, 'OP06-072'), 'Blocker'));
  setDon(s, 1, 4);
  assert.ok(!hasKeyword(s, 0, mine(s, 'OP06-072'), 'Blocker'));
  s = scene([list(FILM_L, ['OP06-072']), OPP], (g) => { setChars(g, 0, [{ num: 'OP06-072' }]); setDon(g, 0, 3); setDon(g, 1, 5); }, 1);
  assert.ok(!hasKeyword(s, 0, mine(s, 'OP06-072'), 'Blocker'));
});

test('Zephyr (OP06-074) : DON!! −1 : annule les effets ; KO si 5000 ou moins après annulation ; [En cas de KO] non activé, protection respectée (Q&A)', () => {
  const deck = list(FILM_L, ['OP06-074']);
  const start = (victim: string) => scene([deck, list(FILM_L, [victim])], (g) => {
    setHand(g, 0, ['OP06-074']); setDon(g, 0, 8); setChars(g, 1, [{ num: victim }]);
  });
  // 4000 : annulé et KO ; son [En cas de KO] n'est pas résolu
  let s = start('OP06-089');
  let victim = charUid(s, 1, 'OP06-089');
  const deckBefore = s.players[1].deck.length;
  s = choose(play(s, 'OP06-074'), 'yes');
  s = choose(s, `card:${victim}`);
  assert.ok(!s.players[1].chars.some((c) => c.uid === victim), 'KO');
  assert.equal(s.players[1].deck.length, deckBefore, 'pas d’effet [En cas de KO]');
  // 7000 : annulé seulement
  s = start('OP06-010');
  victim = charUid(s, 1, 'OP06-010');
  s = choose(choose(play(s, 'OP06-074'), 'yes'), `card:${victim}`);
  assert.ok(s.players[1].chars.some((c) => c.uid === victim));
  assert.ok(isNegated(s, victim));
  // 7000 baissés à 5000 par un effet (Q&A d'OP01-006) : KO
  s = start('OP06-010');
  victim = charUid(s, 1, 'OP06-010');
  s.mods.push({ uid: victim, stat: 'power', amount: -2000, until: 'turn', source: 'essai' });
  s = choose(choose(play(s, 'OP06-074'), 'yes'), `card:${victim}`);
  assert.ok(!s.players[1].chars.some((c) => c.uid === victim));
  // protégé contre le KO par effet (Q&A d'OP04-083) : reste
  s = start('OP06-089');
  victim = charUid(s, 1, 'OP06-089');
  s.mods.push({ uid: victim, stat: 'cantBeKO', scope: 'effect', amount: 0, until: 'turn', source: 'essai' });
  s = choose(choose(play(s, 'OP06-074'), 'yes'), `card:${victim}`);
  assert.ok(s.players[1].chars.some((c) => c.uid === victim));
});

test('Gecko Moria (OP06-086) : deux cartes, l’une redressée, l’autre épuisée ; une seule : redressée ; ordre au choix ; zone pleine (Q&A)', () => {
  const A = 'OP06-064';   // coût 3, sans [Jouée]
  const B = 'OP06-066';   // coût 2, sans [Jouée]
  const deck = list(THRILLER_L, ['OP06-086', A, B, 'OP06-089', 'OP06-091']);
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-086']); setDon(g, 0, 8); toTrash(g, 0, [A, B]); });
  s = play(s, 'OP06-086');
  s = choose(s, (o) => o.num === A);
  s = choose(s, (o) => o.num === B);
  s = choose(s, (o) => o.num === B);    // redressée
  assert.equal(mine(s, B).rested, false);
  assert.equal(mine(s, A).rested, true);
  // une seule carte : redressée (Q&A)
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-086']); setDon(g, 0, 8); toTrash(g, 0, [A]); });
  s = play(s, 'OP06-086');
  s = choose(s, (o) => o.num === A);
  assert.equal(mine(s, A).rested, false);
  // deux effets [Jouée] : le joueur choisit lequel se résout d'abord (Q&A)
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-086']); setDon(g, 0, 8); toTrash(g, 0, ['OP06-089', 'OP06-091']); });
  s = play(s, 'OP06-086');
  s = choose(s, (o) => o.num === 'OP06-089');
  s = choose(s, (o) => o.num === 'OP06-091');
  s = choose(s, (o) => o.num === 'OP06-089');
  assert.match(s.decision?.prompt ?? '', /premier/);
  s = choose(s, (o) => o.num === 'OP06-091');
  s = resolve(s);
  const firstEffect = s.log.findIndex((l) => l.text.includes('[Jouée] de') && l.text.includes(CARDS['OP06-091'].name));
  const secondEffect = s.log.findIndex((l) => l.text.includes('[Jouée] de') && l.text.includes(CARDS['OP06-089'].name));
  assert.ok(firstEffect >= 0 && firstEffect < secondEffect, 'dans l’ordre choisi');
  // zone pleine : le premier joué défaussé pour le second : son [Jouée] ne s'active pas (Q&A)
  s = scene([deck, OPP], (g) => {
    setHand(g, 0, ['OP06-086']); setDon(g, 0, 8); toTrash(g, 0, ['OP06-089', B]);
    setChars(g, 0, [{ num: WEAK }, { num: WEAK }, { num: WEAK }]);
  });
  const deck0 = s.players[0].deck.length;
  s = play(s, 'OP06-086');
  s = choose(s, (o) => o.num === 'OP06-089');
  s = choose(s, (o) => o.num === B);
  s = choose(s, (o) => o.num === 'OP06-089');   // redressée
  assert.equal(s.decision?.tag, 'fullZone');
  s = choose(s, `trash:${charUid(s, 0, 'OP06-089')}`);
  s = resolve(s);
  assert.ok(s.players[0].chars.some((c) => c.num === B));
  assert.ok(s.players[0].trash.some((c) => c.num === 'OP06-089'));
  assert.equal(s.players[0].deck.length, deck0, 'pas d’effet [Jouée]');
});

test('Brook (OP06-092) : placer dans la Défausse (pas un KO, Q&A) ou 3 cartes de la Défausse adverse sous son deck, toutes s’il en a moins (Q&A)', () => {
  const deck = list(THRILLER_L, ['OP06-092']);
  // choix 1 : le Personnage part sans KO : [En cas de KO] non résolu
  let s = scene([deck, list(FILM_L, ['OP06-089'])], (g) => { setHand(g, 0, ['OP06-092']); setDon(g, 0, 6); setChars(g, 1, [{ num: 'OP06-089' }]); toTrash(g, 1, [WEAK]); });
  const deck1 = s.players[1].deck.length;
  s = play(s, 'OP06-092');
  assert.equal(s.decision?.tag, 'chooseOne');
  s = choose(s, 'choice:0');
  s = resolve(s);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[1].deck.length, deck1);
  // choix 2 : l'adversaire choisit 3 cartes sur 4
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-092']); setDon(g, 0, 6); toTrash(g, 1, [WEAK, VANILLA2, 'OP06-004', 'OP06-010']); });
  const d = s.players[1].deck.length;
  s = play(s, 'OP06-092');
  assert.equal(s.decision?.player, 1);
  s = pickCard(s);
  assert.equal(s.decision?.player, 1, 'l’adversaire choisit');
  s = pickCard(pickCard(s));
  while (s.decision?.tag === 'bottomOrder') {
    assert.equal(s.decision.player, 1);
    s = act(s, 'keep');
  }
  assert.equal(s.players[1].trash.length, 1);
  assert.equal(s.players[1].deck.length, d + 3);
  // 2 cartes : toutes
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-092']); setDon(g, 0, 6); toTrash(g, 1, [WEAK, VANILLA2]); });
  s = resolve(play(s, 'OP06-092'));
  assert.equal(s.players[1].trash.length, 0);
});

test('Shadows Asgard (OP06-095) : +1000 au Leader, puis +1000 par Personnage {Thriller Bark} de coût 2 ou moins mis KO ; [Contre] ; [Déclenchement]', () => {
  const deck = list(THRILLER_L, ['OP06-095', 'OP14-082', 'OP06-087', 'OP06-083']);
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-095']); setDon(g, 0, 2); setChars(g, 0, [{ num: 'OP06-087' }, { num: 'OP14-082' }, { num: 'OP06-083' }]); });
  s = play(s, 'OP06-095');
  assert.ok(s.decision?.options.every((o) => o.num !== 'OP06-083' && o.uid !== charUid(s, 0, 'OP06-083')), 'coût 4 : pas proposé');
  s = choose(s, `card:${charUid(s, 0, 'OP06-087')}`);
  s = choose(s, `card:${charUid(s, 0, 'OP14-082')}`);
  s = resolve(s);
  assert.equal(power(s, leaderUid(s, 0)), 8000);
  // refus : seulement +1000
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-095']); setDon(g, 0, 2); setChars(g, 0, [{ num: 'OP06-087' }]); });
  s = play(s, 'OP06-095');
  s = choose(s, 'none');
  assert.equal(power(s, leaderUid(s, 0)), 6000);
  assert.equal(s.players[0].chars.length, 1);
  // [Contre] : +1000 pour le tour ; l'attaque de 5000 sur mon Leader de 5000 est parée (6000)
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-095']); setDon(g, 0, 2); }, 1);
  s = oppAttacks(s);
  while (s.decision?.kind === 'blocker') s = choose(s, 'noblock');
  s = act(s, s.decision!.options.find((o) => o.id.startsWith('cevent:'))!.id);
  assert.equal(power(s, leaderUid(s, 0)), 6000);
  assert.equal(CARDS['OP06-095'].counterPower!(s, 0, leaderUid(s, 0)), 1000);
  assert.equal(CARDS['OP06-095'].onTrigger !== undefined, true);
});

test('Negative Hollow (OP06-097) : 1 carte de la main adverse en Défausse', () => {
  const deck = list(THRILLER_L, ['OP06-097']);
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-097']); setDon(g, 0, 2); setHand(g, 1, [WEAK, VANILLA2]); });
  s = resolve(play(s, 'OP06-097'));
  assert.equal(s.players[1].hand.length, 1);
  assert.ok(s.players[1].trash.some((c) => c.num === WEAK || c.num === VANILLA2));
});

test('Kamakiri, Braham, Wiper (OP06-102, 111, 114) : le Lieu de coût 1 peut être celui de l’adversaire (Q&A)', () => {
  // Kamakiri : Lieu adverse seul : il part sous le deck adverse ; KO
  let s = scene([list(FILM_L, ['OP06-102']), OPP], (g) => { setChars(g, 0, [{ num: 'OP06-102' }]); setChars(g, 1, [{ num: WEAK }]); stage(g, 1, UPPER_YARD); });
  s = resolve(act(s, `act:${charUid(s, 0, 'OP06-102')}`));
  assert.equal(s.players[1].stage, null);
  assert.equal(s.players[1].deck.at(-1)?.num, UPPER_YARD);
  assert.equal(s.players[1].chars.length, 0);
  // sans Lieu : pas proposé ; Lieu de coût 2 ou plus non plus (coût 1 seulement) ; sans cible : pas proposé (n° 1000)
  s = scene([list(FILM_L, ['OP06-102']), OPP], (g) => { setChars(g, 0, [{ num: 'OP06-102' }]); setChars(g, 1, [{ num: WEAK }]); });
  assert.ok(!isOption(s, `act:${charUid(s, 0, 'OP06-102')}`));
  s = scene([list(FILM_L, ['OP06-102']), OPP], (g) => { setChars(g, 0, [{ num: 'OP06-102' }]); setChars(g, 1, []); stage(g, 1, UPPER_YARD); });
  assert.ok(!isOption(s, `act:${charUid(s, 0, 'OP06-102')}`));
  // Braham : les deux Lieux au choix
  s = scene([list(FILM_L, ['OP06-111']), OPP], (g) => { setChars(g, 0, [{ num: 'OP06-111' }]); setChars(g, 1, [{ num: WEAK }]); stage(g, 0, UPPER_YARD); stage(g, 1, UPPER_YARD); });
  s = act(s, `act:${charUid(s, 0, 'OP06-111')}`);
  assert.equal(s.decision?.options.length, 2);
  s = choose(s, `card:${s.players[0].stage!.uid}`);
  assert.equal(s.players[0].stage, null);
  assert.ok(s.players[1].stage);
  s = resolve(s);
  assert.ok(mine(s, WEAK, 1).rested);
  // Wiper : carte [Upper Yard] ou {Shandian Warrior} seulement
  s = scene([list(FILM_L, ['OP06-114', 'OP06-102']), OPP], (g) => {
    setHand(g, 0, ['OP06-114']); setDon(g, 0, 5); stage(g, 1, UPPER_YARD);
    setDeckTop(g, 0, [UPPER_YARD, WEAK, 'OP06-102', WEAK, WEAK]);
  });
  s = choose(play(s, 'OP06-114'), 'yes');
  const proposed = s.decision!.options.filter((o) => o.num).map((o) => o.num).sort();
  assert.deepEqual(proposed, ['OP05-117', 'OP06-102']);
  // sans Lieu : pas de question
  s = scene([list(FILM_L, ['OP06-114']), OPP], (g) => { setHand(g, 0, ['OP06-114']); setDon(g, 0, 5); });
  assert.ok(!play(s, 'OP06-114').decision?.inEffect);
});

test('Kawamatsu (OP06-103) : 2 cartes défaussées : 1 Personnage de 0 de puissance exactement (pas en dessous, Q&A) dans la Vie, face visible', () => {
  const deck = list(FILM_L, ['OP06-103', 'OP06-014']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-103' }, { num: 'OP06-014' }]); setHand(g, 0, [WEAK, WEAK]); });
  const zero = charUid(s, 0, 'OP06-014');
  s = attack(s, charUid(s, 0, 'OP06-103'), leaderUid(s, 1));
  s = choose(s, 'yes');
  s = choose(s, `card:${zero}`);
  s = choose(s, 'lifeTop');
  assert.equal(s.players[0].life[0].uid, zero);
  assert.equal(s.players[0].life[0].faceUp, true);
  // puissance négative : pas de question (l'effet ne peut pas servir, n° 1000)
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-103' }, { num: 'OP06-014' }]); setHand(g, 0, [WEAK, WEAK]); });
  s.mods.push({ uid: charUid(s, 0, 'OP06-014'), stat: 'power', amount: -1000, until: 'turn', source: 'essai' });
  s = attack(s, charUid(s, 0, 'OP06-103'), leaderUid(s, 1));
  assert.notEqual(s.decision?.tag?.startsWith('may'), true);
  assert.equal(s.players[0].hand.length, 2);
});

test('Kikunojo (OP06-104) : [En cas de KO] si l’adversaire a 3 Vies ou moins, peut refuser ; [Déclenchement] se joue', () => {
  const deck = list(FILM_L, ['OP06-104']);
  const can = (oppLife: number, answer: string) => {
    let s = scene([deck, list(GERMA_L, [])], (g) => {
      setChars(g, 0, [{ num: 'OP06-104', extra: { rested: true } }]); setChars(g, 1, []);
      setLife(g, 1, Array(oppLife).fill(WEAK)); setLife(g, 0, [WEAK]);
      oppLeaderDon(g, 2);
    }, 1);
    // mis KO par une attaque du Leader adverse (7000), Personnage épuisé
    s = attack(s, leaderUid(s, 1), charUid(s, 0, 'OP06-104'));
    while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.options.find((o) => o.id === 'noblock' || o.id === 'nocounter' || o.id === 'pass')?.id ?? s.decision.options.at(-1)!.id);
    if (s.decision?.tag?.startsWith('may')) s = choose(s, answer);
    return s;
  };
  assert.equal(can(3, 'yes').players[0].life.length, 2);
  assert.equal(can(3, 'no').players[0].life.length, 1);
  assert.equal(can(4, 'yes').players[0].life.length, 1, '4 Vies : rien');
});

test('Hiyori (OP06-106) : 1 Vie (dessus ou dessous) en main, jusqu’à 1 carte de la main au-dessus, face cachée (Q&A) ; Nami OP11-041 réagit même si c’est la même carte (Q&A)', () => {
  const deck = list('OP11-041', ['OP06-106']);
  const start = () => scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-106', VANILLA2]); setDon(g, 0, 2); setLife(g, 0, [WEAK, 'OP06-004']); delete g.lifeSeen; });
  // la même carte (dessus) remise : Nami pioche quand même
  let s = start();
  const top = s.players[0].life[0].uid;
  s = choose(play(s, 'OP06-106'), 'yes');
  s = choose(s, 'top');
  const inHandCount = s.players[0].hand.length;
  s = choose(s, `card:${top}`);
  assert.equal(s.players[0].life[0].uid, top);
  assert.ok(!s.players[0].life[0].faceUp);
  assert.equal(s.players[0].hand.length, inHandCount - 1 + 1, 'Nami a pioché');
  // une autre carte, dessous : Nami pioche aussi ; la carte posée n'est pas montrée à l'adversaire
  s = start();
  s = choose(play(s, 'OP06-106'), 'yes');
  s = choose(s, 'bottom');
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP06-004'));
  const handBefore = s.players[0].hand.length;
  s = choose(s, (o) => o.num === VANILLA2);
  assert.equal(s.players[0].life[0].num, VANILLA2);
  assert.equal(s.players[0].hand.length, handBefore, 'posée, puis Nami pioche');
  assert.ok(!(s.known ?? []).some((k) => k.uid === s.players[0].life[0].uid && k.to === 1), 'pas montrée');
  // refus de reposer : la carte reste en main
  s = start();
  s = choose(play(s, 'OP06-106'), 'yes');
  s = choose(s, 'top');
  s = choose(s, 'none');
  assert.equal(s.players[0].life.length, 1);
  // sans Vie : pas de question
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-106']); setDon(g, 0, 2); setLife(g, 0, []); });
  assert.ok(!play(s, 'OP06-106').decision?.inEffect);
});

test('Chavipère (OP06-110) : avec 2 DON!!, peut aussi attaquer les Personnages adverses redressés', () => {
  const deck = list(FILM_L, ['OP06-110']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-110', extra: { don: 2 } }]); setChars(g, 1, [{ num: WEAK }]); });
  assert.ok(attackTargets(s, 0, mine(s, 'OP06-110')).includes(charUid(s, 1, WEAK)));
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-110', extra: { don: 1 } }]); setChars(g, 1, [{ num: WEAK }]); });
  assert.ok(!attackTargets(s, 0, mine(s, 'OP06-110')).includes(charUid(s, 1, WEAK)));
});

test('Reject (OP06-116) : KO adverse ; ou, avec exactement 1 Vie adverse, 1 dégât puis 1 Vie en main (la condition couvre le « Puis », Q&A) ; Luffy ST13-003 (Q&A)', () => {
  const deck = list(FILM_L, ['OP06-116']);
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-116']); setDon(g, 0, 4); setChars(g, 1, [{ num: WEAK }]); setLife(g, 1, [VANILLA2]); setLife(g, 0, [WEAK, WEAK]); });
  s = play(s, 'OP06-116');
  assert.equal(s.decision?.tag, 'chooseOne');
  s = choose(s, 'choice:1');
  s = resolve(s);
  assert.equal(s.players[1].life.length, 0, '1 dégât');
  assert.ok(s.players[1].hand.some((c) => c.num === VANILLA2));
  assert.equal(s.players[0].life.length, 1, 'puis 1 Vie en main');
  // 2 Vies adverses : l'option ne ferait rien, pas proposée, pas de Vie prise (Q&A)
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-116']); setDon(g, 0, 4); setChars(g, 1, [{ num: WEAK }]); setLife(g, 1, [VANILLA2, VANILLA2]); setLife(g, 0, [WEAK, WEAK]); });
  s = resolve(play(s, 'OP06-116'));
  assert.equal(s.players[1].chars.length, 0, 'KO, seul choix utile');
  assert.equal(s.players[0].life.length, 2);
  // Leader qui place ses cartes de Vie face visible sous son deck (Luffy ST13-003, Q&A) : le dégât d'abord, puis sous le deck
  const L = deck.leader;
  const had = CARDS[L].faceUpLifeToDeck;
  CARDS[L].faceUpLifeToDeck = true;
  try {
    s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-116']); setDon(g, 0, 4); setLife(g, 1, [VANILLA2]); setLife(g, 0, [WEAK]); g.players[0].life[0].faceUp = true; });
    const handBefore = s.players[0].hand.length;
    s = resolve(play(s, 'OP06-116'));
    assert.equal(s.players[1].life.length, 0);
    assert.equal(s.players[0].life.length, 0);
    assert.equal(s.players[0].deck.at(-1)?.num, WEAK);
    assert.equal(s.players[0].hand.length, handBefore - 1, 'pas en main');
  } finally {
    if (had === undefined) delete CARDS[L].faceUpLifeToDeck;
    else CARDS[L].faceUpLifeToDeck = had;
  }
});

test('The Ark Maxim (OP06-117) : épuiser le Lieu et 1 carte [Enel] : KO de tous les Personnages adverses de coût 2 ou moins', () => {
  const ENEL_L = 'OP05-098';
  let s = scene([list(ENEL_L, ['OP06-117']), OPP], (g) => { stage(g, 0, 'OP06-117'); setChars(g, 1, [{ num: WEAK }, { num: VANILLA2 }, { num: 'OP06-010' }]); });
  const st = s.players[0].stage!.uid;
  assert.ok(isOption(s, `act:${st}`));
  s = resolve(act(s, `act:${st}`));
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(s.players[0].leader.rested, true, '[Enel] épuisé');
  assert.deepEqual(s.players[1].chars.map((c) => c.num), ['OP06-010']);
  // sans [Enel] : pas proposé
  s = scene([list(FILM_L, ['OP06-117']), OPP], (g) => { stage(g, 0, 'OP06-117'); setChars(g, 1, [{ num: WEAK }]); });
  assert.ok(!isOption(s, `act:${s.players[0].stage!.uid}`));
});

// ---------- Recettes que le banc ne mesure pas ----------

test('Perona (OP06-021) : au choix, épuiser un Personnage de coût 4 ou moins ou −1 au coût, une fois par tour', () => {
  const deck = list('OP06-021', [WEAK]);
  let s = scene([deck, OPP], (g) => { setChars(g, 1, [{ num: WEAK }, { num: 'OP06-010' }]); });
  const L = leaderUid(s, 0);
  s = act(s, `act:${L}`);
  assert.equal(s.decision?.tag, 'chooseOne');
  s = choose(s, 'choice:0');
  assert.ok(s.decision!.options.every((o) => o.uid !== charUid(s, 1, 'OP06-010')), 'coût 6 : pas proposé');
  s = choose(s, `card:${charUid(s, 1, WEAK)}`);
  assert.ok(mine(s, WEAK, 1).rested);
  assert.ok(!isOption(s, `act:${L}`), 'une fois par tour');
  s = scene([deck, OPP], (g) => { setChars(g, 1, [{ num: 'OP06-010' }]); });
  s = act(s, `act:${leaderUid(s, 0)}`);
  s = pickCard(s.decision?.tag === 'chooseOne' ? choose(s, 'choice:1') : s);
  assert.ok(s.mods.some((m) => m.uid === charUid(s, 1, 'OP06-010') && m.stat === 'cost' && m.amount === -1));
});

test('Zeo, Dosun, Ikaros (OP06-028, 030, 024) : la condition de Leader couvre le « Puis » : 1 Vie en main avec un Leader {New Fish-Man}, rien sinon, même sans cible (Q&A)', () => {
  const run = (leader: string, num: string, don: number) => {
    let s = scene([list(leader, [num]), OPP], (g) => { setChars(g, 0, [{ num, extra: { don } }]); setDon(g, 0, 0, 2); setLife(g, 0, [WEAK, WEAK]); setChars(g, 1, []); setLife(g, 1, [WEAK, WEAK]); });
    const uid = charUid(s, 0, num);
    s = attack(s, uid, leaderUid(s, 1));
    return { s: resolve(s), uid };
  };
  let r = run(FISH_L, 'OP06-028', 1);
  assert.equal(r.s.players[0].life.length, 1);
  assert.equal(r.s.players[0].donActive, 1, 'DON!! redressée');
  r = run(FILM_L, 'OP06-028', 1);
  assert.equal(r.s.players[0].life.length, 2);
  // Dosun : +2000 et protégé en combat jusqu'au début de son prochain tour (la durée vaut pour les deux, n° 3301)
  r = run(FISH_L, 'OP06-030', 0);
  assert.equal(r.s.players[0].life.length, 1);
  const prot = r.s.mods.find((m) => m.uid === r.uid && m.stat === 'cantBeKO');
  assert.equal(prot?.scope, 'battle');
  assert.equal(prot?.until, r.s.turn + 1);
  assert.ok(r.s.mods.some((m) => m.uid === r.uid && m.stat === 'power' && m.amount === 2000 && m.until === r.s.turn + 1));
  r = run(FILM_L, 'OP06-030', 0);
  assert.equal(r.s.players[0].life.length, 2);
  assert.ok(!r.s.mods.some((m) => m.uid === r.uid));
  // Ikaros [Jouée] sans carte à jouer : 1 Vie quand même (Q&A) ; autre Leader : rien
  let s = scene([list(FISH_L, ['OP06-024']), OPP], (g) => { setHand(g, 0, ['OP06-024']); setDon(g, 0, 5); setLife(g, 0, [WEAK, WEAK]); });
  s = resolve(play(s, 'OP06-024'));
  assert.equal(s.players[0].life.length, 1);
  s = scene([list(FILM_L, ['OP06-024']), OPP], (g) => { setHand(g, 0, ['OP06-024']); setDon(g, 0, 5); setLife(g, 0, [WEAK, WEAK]); });
  s = resolve(play(s, 'OP06-024'));
  assert.equal(s.players[0].life.length, 2);
});

test('Hody Jones (OP06-035) : jusqu’à 2 au total parmi Personnages et DON!! adverses ; 1 Vie en main même sans rien épuiser (Q&A)', () => {
  const deck = list(FISH_L, ['OP06-035']);
  let s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-035']); setDon(g, 0, 7); setDon(g, 1, 3); setChars(g, 1, [{ num: WEAK }]); setLife(g, 0, [WEAK, WEAK]); });
  s = resolve(play(s, 'OP06-035'));
  const rested = s.players[1].donRested + s.players[1].chars.filter((c) => c.rested).length;
  assert.equal(rested, 2);
  assert.equal(s.players[0].life.length, 1);
  s = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-035']); setDon(g, 0, 7); setDon(g, 1, 0); setChars(g, 1, []); setLife(g, 0, [WEAK, WEAK]); });
  s = resolve(play(s, 'OP06-035'));
  assert.equal(s.players[0].life.length, 1);
});

test('Reiju (OP06-042, Leader) et les Vinsmoke à DON!! −1 (OP06-060, 064, 066, 068) : joue la carte de son nom de la main ou de la Défausse ; le Leader pioche, une fois par tour ; Q&A', () => {
  for (const [num, target] of [['OP06-060', 'OP06-061'], ['OP06-064', 'OP06-065'], ['OP06-066', 'OP06-067'], ['OP06-068', 'OP06-069']]) {
    const deck = list(GERMA_L, [num, target]);
    let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num }]); setDon(g, 0, 3); toTrash(g, 0, [target]); setHand(g, 0, []); });
    const donBefore = s.players[0].donDeck;
    s = resolve(act(s, `act:${charUid(s, 0, num)}`));
    assert.ok(s.players[0].chars.some((c) => c.num === target), `${num} joue ${target}`);
    assert.ok(s.players[0].trash.some((c) => c.num === num), 'placé en Défausse');
    assert.equal(s.players[0].donDeck, donBefore + 1);
    assert.ok(s.players[0].hand.length >= 1, 'le Leader pioche');
    // autre Leader : le coût est payé, rien ne suit (le coût se paie à part : Q&A d'OP02-070)
    s = scene([list(FILM_L, [num, target]), OPP], (g) => { setChars(g, 0, [{ num }]); setDon(g, 0, 3); toTrash(g, 0, [target]); });
    s = resolve(act(s, `act:${charUid(s, 0, num)}`));
    assert.ok(!s.players[0].chars.some((c) => c.num === target), `${num} : autre Leader`);
  }
  // Q&A : la DON!! renvoyée par un effet adverse pendant son tour compte ; une fois par tour ; au tour adverse, non
  let s = scene([list(GERMA_L, [WEAK]), OPP], (g) => { setDon(g, 0, 3); setHand(g, 0, []); returnDon(g, 0, 1); returnDon(g, 0, 1); });
  assert.equal(s.players[0].hand.length, 1);
  s = scene([list(GERMA_L, [WEAK]), OPP], (g) => { setDon(g, 0, 3); setHand(g, 0, []); returnDon(g, 0, 1); }, 1);
  assert.equal(s.players[0].hand.length, 0);
  // Q&A : 5 cartes en main, OP06-068 joue OP06-069 de la Défausse : d'abord son [Jouée] (2 cartes), puis le Leader (8 cartes)
  const hand = Array(5).fill(WEAK);
  const deck = list(GERMA_L, ['OP06-068', 'OP06-069']);
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-068' }]); setDon(g, 0, 3); setDon(g, 1, 3); toTrash(g, 0, ['OP06-069']); setHand(g, 0, hand); });
  s = act(s, `act:${charUid(s, 0, 'OP06-068')}`);
  s = pickCard(s);
  assert.match(s.decision?.prompt ?? '', /Reiju/);
  s = choose(s, 'no');
  assert.equal(s.players[0].hand.length, 8);
  // l'autre ordre : le Leader d'abord (6 cartes), [Jouée] sans effet
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-068' }]); setDon(g, 0, 3); setDon(g, 1, 3); toTrash(g, 0, ['OP06-069']); setHand(g, 0, hand); });
  s = act(s, `act:${charUid(s, 0, 'OP06-068')}`);
  s = pickCard(s);
  s = choose(s, 'yes');
  assert.equal(s.players[0].hand.length, 6);
});

test('Royaume de Germa (OP06-079) et Thriller Bark (OP06-098) : coût « épuisez ce Lieu », effets', () => {
  let s = scene([list(GERMA_L, ['OP06-079', 'OP06-064']), OPP], (g) => { stage(g, 0, 'OP06-079'); setHand(g, 0, [WEAK]); setDeckTop(g, 0, ['OP06-064', WEAK, WEAK]); });
  const st = s.players[0].stage!.uid;
  s = act(s, `act:${st}`);
  s = resolve(s);
  assert.equal(s.players[0].stage!.rested, true);
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP06-064'));
  assert.ok(s.players[0].trash.some((c) => c.num === WEAK));
  // Thriller Bark : ① et Lieu épuisés : joue épuisé un {Thriller Bark} de coût 2 ou moins
  s = scene([list(THRILLER_L, ['OP06-098', 'OP06-087', 'OP06-083']), OPP], (g) => { stage(g, 0, 'OP06-098'); setDon(g, 0, 1); toTrash(g, 0, ['OP06-087', 'OP06-083']); });
  s = act(s, `act:${s.players[0].stage!.uid}`);
  s = resolve(s);
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(s.players[0].donRested, 1);
  assert.equal(mine(s, 'OP06-087').rested, true);
  s = scene([list(FILM_L, ['OP06-098', 'OP06-087']), OPP], (g) => { stage(g, 0, 'OP06-098'); setDon(g, 0, 1); toTrash(g, 0, ['OP06-087']); });
  s = resolve(act(s, `act:${s.players[0].stage!.uid}`));
  assert.ok(!s.players[0].chars.some((c) => c.num === 'OP06-087'), 'autre Leader : payé, rien ne suit');
});

test('Oars (OP06-083) : ne peut pas attaquer ; annuler son effet le permet, sans retirer ce que lui donnent d’autres cartes (Q&A)', () => {
  const deck = list(THRILLER_L, ['OP06-083', 'OP06-087']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-083' }, { num: 'OP06-087' }]); });
  const oars = charUid(s, 0, 'OP06-083');
  assert.deepEqual(attackTargets(s, 0, mine(s, 'OP06-083')), []);
  s.mods.push({ uid: oars, stat: 'keyword', keyword: 'Banish', amount: 0, until: 'turn', source: 'essai' });
  s = act(s, `act:${oars}`);
  s = choose(s, `card:${charUid(s, 0, 'OP06-087')}`);
  s = resolve(s);
  assert.ok(isNegated(s, oars));
  assert.ok(attackTargets(s, 0, mine(s, 'OP06-083')).includes(leaderUid(s, 1)));
  assert.ok(hasKeyword(s, 0, mine(s, 'OP06-083'), 'Banish'), 'mot-clé donné par une autre carte conservé');
});

test('Aisa (OP06-099) : regarde la carte du dessus d’une Vie, la replace au-dessus ou au-dessous', () => {
  let s = scene([list(FILM_L, ['OP06-099']), OPP], (g) => { setHand(g, 0, ['OP06-099']); setDon(g, 0, 1); setLife(g, 1, [WEAK, VANILLA2]); setLife(g, 0, [WEAK]); });
  s = play(s, 'OP06-099');
  assert.ok(s.decision?.inEffect);
  s = resolve(s);
  assert.equal(s.players[1].life.length + s.players[0].life.length, 3);
  coherent(s);
});

test('La carte en Vie de « C’est toi qui vas... » (OP06-115) : [Contre] coût 1 carte, +3000 ; [Déclenchement] à 0 Vie, facultatif, puis 1 carte défaussée (Q&A : main vide acceptée)', () => {
  const deck = list('OP05-098', ['OP06-115']);
  const s0 = scene([deck, OPP], (g) => { setHand(g, 0, ['OP06-115', WEAK]); setDon(g, 0, 1); oppLeaderDon(g, 2); }, 1);
  const { s, gain } = counterGain(s0, 'OP06-115', (t) => resolve(t));
  assert.equal(gain, 3000);
  assert.ok(s.players[0].trash.some((c) => c.num === WEAK));
  // [Déclenchement] : 1 Vie, l'adversaire attaque : elle tombe à 0 pendant le dégât ; on prend la carte ; la main vide, la carte ajoutée reste
  const run = (life: string[], hand: string[], addIt: boolean) => {
    let t = scene([deck, OPP], (g) => { setLife(g, 0, life); setHand(g, 0, hand); oppLeaderDon(g, 2); }, 1);
    t = oppAttacks(t);
    while (t.decision?.kind === 'blocker' || t.decision?.kind === 'counter') t = act(t, t.decision.options.find((o) => o.id === 'noblock' || o.id === 'nocounter' || o.id === 'pass')?.id ?? t.decision.options.at(-1)!.id);
    assert.equal(t.decision?.tag, 'trigger');
    t = choose(t, 'trigger');
    if (life.length === 1 && t.decision?.tag?.startsWith('may')) t = choose(t, addIt ? 'yes' : 'no');
    return resolve(t);
  };
  let t = run(['OP06-115'], [], true);
  assert.equal(t.players[0].life.length, 1, 'ajoutée, même main vide');
  t = run(['OP06-115'], [WEAK], false);
  assert.equal(t.players[0].life.length, 0, 'refus');
  assert.equal(t.players[0].hand.length, 0, 'défausse quand même (« Puis »)');
  t = run(['OP06-115', WEAK], [WEAK], true);
  assert.equal(t.players[0].life.length, 1, 'il reste une Vie : la condition est fausse');
  assert.equal(t.players[0].hand.length, 1, 'pas de défausse');
});

test('ST12-001 : un Personnage de 7000 de base avec 1 DON!! (8000) n’est pas proposé (Q&A) ; coût : renvoyer un Personnage de coût 2 ou plus', () => {
  const deck = list('ST12-001', ['OP06-010', VANILLA2]);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'OP06-010', extra: { don: 1, rested: true } }, { num: VANILLA2 }, { num: 'OP06-004', extra: { rested: true } }]); g.players[0].leader.don = 1; });
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = choose(s, 'yes');
  s = choose(s, `card:${charUid(s, 0, VANILLA2)}`);
  assert.ok(s.players[0].hand.some((c) => c.num === VANILLA2));
  assert.ok(s.decision!.options.every((o) => o.uid !== charUid(s, 0, 'OP06-010')), '8000 : pas proposé');
  s = choose(s, `card:${charUid(s, 0, 'OP06-004')}`);
  assert.equal(mine(s, 'OP06-004').rested, false);
});

test('Ivankov (ST12-010) : seule la carte révélée peut être jouée ; le reste au-dessus ou au-dessous (Q&A)', () => {
  let s = scene([list(FILM_L, ['ST12-010', VANILLA2]), OPP], (g) => { setHand(g, 0, ['ST12-010', VANILLA2]); setDon(g, 0, 3); setDeckTop(g, 0, [WEAK]); });
  s = play(s, 'ST12-010');
  // WEAK (coût 1) révélée : pas jouable ; la carte de coût 2 de la main n'est jamais proposée
  assert.ok(s.decision!.options.every((o) => o.num !== VANILLA2));
  s = resolve(s);
  assert.ok(s.players[0].hand.some((c) => c.num === VANILLA2));
  assert.ok(s.players[0].chars.every((c) => c.num !== VANILLA2));
  assert.ok([s.players[0].deck[0].num, s.players[0].deck.at(-1)!.num].includes(WEAK));
  // coût 2 révélée : jouée
  s = scene([list(FILM_L, ['ST12-010', VANILLA2]), OPP], (g) => { setHand(g, 0, ['ST12-010']); setDon(g, 0, 3); setDeckTop(g, 0, [VANILLA2]); });
  s = resolve(play(s, 'ST12-010'));
  assert.ok(s.players[0].chars.some((c) => c.num === VANILLA2));
});

test('Sanji (ST12-011) : avec 5 cartes ou moins, +2000 jusqu’au début de son prochain tour, reste si la main grandit ; cumul si attaque deux fois (Q&A)', () => {
  const deck = list(FILM_L, ['ST12-011']);
  let s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST12-011', extra: { don: 1 } }]); setHand(g, 0, Array(5).fill(WEAK)); setChars(g, 1, []); setLife(g, 1, [WEAK, WEAK]); });
  const uid = charUid(s, 0, 'ST12-011');
  const base = power(s, uid);
  s = attack(s, uid, leaderUid(s, 1));
  assert.equal(power(s, uid), base + 2000);
  s.players[0].hand.push(...setHand(s, 1, [WEAK]).splice(0));
  assert.equal(power(s, uid), base + 2000, 'reste');
  assert.ok(s.mods.some((m) => m.uid === uid && m.amount === 2000 && m.until === s.turn + 1));
  s = scene([deck, OPP], (g) => { setChars(g, 0, [{ num: 'ST12-011', extra: { don: 1 } }]); setHand(g, 0, Array(6).fill(WEAK)); });
  const u2 = charUid(s, 0, 'ST12-011');
  const b2 = power(s, u2);
  s = attack(s, u2, leaderUid(s, 1));
  assert.equal(power(s, u2), b2);
});

test('Parage Shoot (ST12-017) [Contre] : +2000 pour le combat, puis révèle ; joue un Personnage de coût 2', () => {
  const s0 = scene([list(FILM_L, ['ST12-017']), OPP], (g) => { setHand(g, 0, ['ST12-017']); setDon(g, 0, 1); setDeckTop(g, 0, [VANILLA2]); oppLeaderDon(g, 2); }, 1);
  const { s, gain } = counterGain(s0, 'ST12-017', (t) => resolve(pickCard(t)));
  assert.equal(gain, 2000);
  assert.ok(s.players[0].chars.some((c) => c.num === VANILLA2));
});

test('Uta (ST11-001) et Nouvelle ère (ST11-004) : Q&A : carte prise, rien d’autre ; DON!! redressée même sans carte prise', () => {
  let s = scene([list('ST11-001', ['OP06-004']), OPP], (g) => { g.players[0].leader.don = 1; setDeckTop(g, 0, ['OP06-004']); setHand(g, 0, []); setChars(g, 1, []); });
  const deckBefore = s.players[0].deck.length;
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  s = resolve(s);
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP06-004'));
  assert.equal(s.players[0].deck.length, deckBefore - 1);
  // Nouvelle ère : refuser la carte, la DON!! se redresse quand même
  s = scene([list('ST11-001', ['ST11-004']), OPP], (g) => { setHand(g, 0, ['ST11-004']); setDon(g, 0, 1, 1); setDeckTop(g, 0, ['OP06-004', WEAK, WEAK]); });
  s = play(s, 'ST11-004');
  while (s.decision?.inEffect) s = act(s, s.decision.options.find((o) => o.id === 'none' || o.id === 'keep')?.id ?? s.decision.options[0].id);
  assert.equal(s.players[0].donRested, 1, '1 payée épuisée, 1 redressée');
  assert.ok(!s.players[0].hand.some((c) => c.num === 'OP06-004'));
  // autre Leader : rien
  s = scene([list(FILM_L, ['ST11-004']), OPP], (g) => { setHand(g, 0, ['ST11-004']); setDon(g, 0, 1, 1); });
  const hand = s.players[0].hand.length;
  s = resolve(play(s, 'ST11-004'));
  assert.equal(s.players[0].hand.length, hand - 1);
});
