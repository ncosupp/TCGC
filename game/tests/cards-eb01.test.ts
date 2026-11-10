// EB01 (tâche S13) : un test par effet des cartes codées à la main (condition vraie et fausse), et les recettes que le banc
// d'essai ne sait pas mesurer ([Contre] « pendant ce combat », [Déclenchement], cible mise KO après une baisse de coût : § 15.4).
// Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import { act, advance } from '../engine/engine.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { counterValue, def, fieldCost, koCharacter, power } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { charUid, counterGain, leaderUid, list, oppLeaderDon, scene } from './eb-scene.ts';
import { attack, choose, coherent, hasOption, logHas, play, setChars, setDeckTop, setDon, setHand, setLife, takeField, donMax } from './helpers.ts';

const F = 'ST-21';       // deck d'appoint (Personnages presque tous sans effet)
const OPP = 'ST-21';
const NEUTRAL_L = 'ST21-001';
const O_BONNEY = 'ST21-004';   // coût 1, 3000
const O_STUSSY = 'ST21-006';   // coût 3, 5000
const O_CHOPPER = 'ST21-008';  // coût 4, 6000
const yes = (s: GameState) => choose(s, 'yes');
// Résout ce que koCharacter vient de mettre en attente
const resolve = (s: GameState) => { s.decision = null; return advance(s); };

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
function triggerFromLife(leader: string, top: string, extra: (g: GameState) => void = () => {}): GameState {
  let s = scene([list(leader, [top], F), OPP], (g) => {
    setLife(g, 0, [top, ...g.players[0].life.slice(1).map((c) => c.num)]);
    oppLeaderDon(g, 3);
    extra(g);
  }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.equal(s.decision?.tag, 'trigger', `[Déclenchement] attendu (${s.decision?.prompt})`);
  return choose(s, 'trigger');
}

test('EB01 : toutes les cartes jouables', () => {
  const nums = Object.keys(CARDS).filter((num) => num.startsWith('EB01-'));
  assert.equal(nums.length, 61);
  assert.deepEqual(nums.filter((num) => !['verified', 'coded', 'auto'].includes(confidence(num))), []);
});

test('Oden (Leader EB01-001) : Contre +1000 aux {Land of Wano} sans Contre seulement', () => {
  const s = scene([list('EB01-001', ['EB01-016'], F), OPP], () => {});
  assert.equal(counterValue(s, 0, 'EB01-018'), 1000, 'Contre imprimé gardé : EB01-018 a déjà 1000');
  const noCounter = Object.keys(CARDS).find((n) => CARDS[n].category === 'CHARACTER' && !CARDS[n].counter && CARDS[n].types.includes('Land of Wano'))!;
  assert.ok(noCounter);
  assert.equal(counterValue(s, 0, noCounter), 1000);
  const other = Object.keys(CARDS).find((n) => CARDS[n].category === 'CHARACTER' && !CARDS[n].counter && !CARDS[n].types.includes('Land of Wano'))!;
  assert.equal(counterValue(s, 0, other), 0);
  const two = Object.keys(CARDS).find((n) => CARDS[n].category === 'CHARACTER' && CARDS[n].counter === 2000 && CARDS[n].types.includes('Land of Wano'))!;
  assert.equal(counterValue(s, 0, two), 2000, 'pas d’ajout à un Contre existant');
});

test('Oden (Leader EB01-001) : [DON!! x1] [En attaquant] +1000 jusqu’au prochain tour avec {Land of Wano} de coût 5 ou plus, gardé ensuite (Q&A)', () => {
  const at = (don: number, wano: string) => scene([list('EB01-001', [wano], F), OPP], (g) => {
    setChars(g, 0, [{ num: wano }]);
    g.players[0].leader.don = don;
    setDon(g, 0, 0);
    setHand(g, 1, []);
  });
  let s = at(1, 'EB01-007');   // coût 5
  const base = power(s, leaderUid(s, 0));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.equal(power(s, leaderUid(s, 0)), base + 1000);
  // condition perdue : le bonus reste
  s.players[0].chars = [];
  assert.equal(power(s, leaderUid(s, 0)), base + 1000);
  assert.ok(s.mods.some((m) => m.uid === leaderUid(s, 0) && m.stat === 'power' && m.until === s.turn + 1), 'jusqu’à la fin du tour adverse');
  // coût 4 : rien
  s = at(1, 'EB01-013');
  const b2 = power(s, leaderUid(s, 0));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.equal(power(s, leaderUid(s, 0)), b2);
  // sans DON!! : rien
  s = at(0, 'EB01-007');
  const b3 = power(s, leaderUid(s, 0));
  s = attack(s, leaderUid(s, 0), leaderUid(s, 1));
  assert.equal(power(s, leaderUid(s, 0)), b3);
});

test('LittleOars Jr. (EB01-008) : un KO par un effet remplacé une fois par tour, jamais en combat, jamais sans Événement ou Lieu (Q&A)', () => {
  const me = list(NEUTRAL_L, ['EB01-008', 'EB01-009', 'EB01-051'], F);
  const opp = list(NEUTRAL_L, ['EB01-049'], F);
  const base = (hand: string[]) => scene([me, opp], (g) => {
    setChars(g, 0, [{ num: 'EB01-008', extra: { rested: true } }]);
    setHand(g, 0, hand);
    setHand(g, 1, ['EB01-049']);
    setDon(g, 1, 6);
  }, 1);
  // T-Bone a un coût max de 2 : on baisse le coût pour pouvoir le viser
  const lower = (g: GameState) => g.mods.push({ uid: charUid(g, 0, 'EB01-008'), stat: 'cost', amount: -5, until: g.turn, source: 'essai' });
  let s = base(['EB01-009', 'EB01-051']);
  lower(s);
  s = play(s, 'EB01-049', 1);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'EB01-008'));
  assert.equal(s.decision?.tag, 'replace');
  s = yes(s);
  s = choose(s, (o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === 'EB01-009'));
  assert.ok(charUid(s, 0, 'EB01-008'), 'reste sur le terrain');
  assert.ok(s.players[0].trash.some((c) => c.num === 'EB01-009'));
  // deuxième fois ce tour : plus de remplacement
  assert.equal(koCharacter(s, charUid(s, 0, 'EB01-008'), 'effect', 1), true);
  assert.ok(!s.players[0].chars.some((c) => c.num === 'EB01-008'));

  // sans Événement ni Lieu : pas de question (Q&A)
  s = base(['ST21-004']);
  lower(s);
  s = play(s, 'EB01-049', 1);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'EB01-008'));
  assert.notEqual(s.decision?.tag, 'replace');
  assert.ok(!s.players[0].chars.some((c) => c.num === 'EB01-008'));

  // en combat : pas de remplacement
  s = scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'EB01-008', extra: { rested: true } }]);
    setHand(g, 0, ['EB01-009']);
    oppLeaderDon(g, 5);
    setDon(g, 0, 0);
  }, 1);
  s = attack(s, leaderUid(s, 1), charUid(s, 0, 'EB01-008'));
  s = passAll(s, 0);
  assert.notEqual(s.decision?.tag, 'replace');
  assert.ok(!s.players[0].chars.some((c) => c.num === 'EB01-008'), 'KO en combat');
});

test('Hannyabal (Leader EB01-021) : [Fin de votre tour] renvoyer un {Impel Down} de coût 2 ou plus : 1 DON!! redressée ; proposé même sans deck DON!! (Q&A)', () => {
  const me = list('EB01-021', ['EB01-026', 'EB01-036'], F);
  const at = (donDeck: number, char: string) => scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: char }]);
    setDon(g, 0, 1);
    g.players[0].donDeck = donDeck;
    setHand(g, 0, []);
  });
  let s = at(3, 'EB01-026');
  s = act(s, 'end');
  assert.equal(s.decision?.tag, 'may');
  s = donMax(yes(s));
  assert.ok(!s.players[0].chars.some((c) => c.num === 'EB01-026'));
  assert.ok(s.players[0].hand.some((c) => c.num === 'EB01-026'));
  assert.ok(s.players[0].donDeck === 2);
  // deck DON!! vide : la question est quand même posée (Q&A)
  s = at(0, 'EB01-036');
  s = act(s, 'end');
  assert.equal(s.decision?.tag, 'may');
  s = yes(s);
  assert.ok(s.players[0].hand.some((c) => c.num === 'EB01-036'));
  // coût 1 : aucune question
  const cheap = 'OP16-023';   // {Impel Down}, coût 1, sans effet
  s = scene([list('EB01-021', [cheap], F), OPP], (g) => { setChars(g, 0, [{ num: cheap }]); setDon(g, 0, 1); setHand(g, 0, []); });
  s = act(s, 'end');
  assert.ok(!(s.decision?.tag === 'may' && s.decision.player === 0));
});

test('Gum-Gum Champion Rifle (EB01-028) : [Contre] la condition couvre le « Puis » ; l’adversaire choisit parmi ses redressés (Q&A)', () => {
  const opp = list(NEUTRAL_L, [O_BONNEY, O_STUSSY], F);
  const at = (leader: string) => scene([list(leader, ['EB01-028'], F), opp], (g) => {
    setHand(g, 0, ['EB01-028']);
    setDon(g, 0, 2);
    setChars(g, 1, [{ num: O_BONNEY }, { num: O_STUSSY }, { num: O_CHOPPER, extra: { rested: true } }]);
  }, 1);
  const r = counterGain(at('EB01-021'), 'EB01-028');
  let s = r.s;
  assert.equal(r.gain, 2000);
  assert.equal(s.decision?.player, 1, 'l’adversaire choisit');
  assert.ok(!hasOption(s, `card:${charUid(s, 1, O_CHOPPER)}`), 'pas un Personnage épuisé');
  s = choose(s, (o) => o.uid === charUid(s, 1, O_STUSSY));
  assert.ok(s.players[1].hand.some((c) => c.num === O_STUSSY));
  // autre Leader : ni bonus ni renvoi (Q&A)
  const r2 = counterGain(at(NEUTRAL_L), 'EB01-028');
  assert.equal(r2.gain, 0);
  assert.equal(r2.s.players[1].chars.length, 3);
});

test('Gum-Gum Champion Rifle (EB01-028) : [Déclenchement] sous le deck du propriétaire, coût 3 ou moins', () => {
  let s = triggerFromLife(NEUTRAL_L, 'EB01-028', (g) => setChars(g, 1, [{ num: O_STUSSY }, { num: O_CHOPPER }]));
  assert.ok(!hasOption(s, `card:${charUid(s, 1, O_CHOPPER)}`), 'coût 4 refusé');
  s = choose(s, (o) => o.uid === charUid(s, 1, O_STUSSY));
  assert.equal(s.players[1].deck.at(-1)?.num, O_STUSSY);
});

test('Sorry. I’m a Goner. (EB01-029) : condition vraie : renvoi puis carte dessous ; fausse : la carte reste dessus, cachée (Q&A, n° 1984)', () => {
  const me = list(NEUTRAL_L, ['EB01-029', 'EB01-007', 'EB01-016', O_BONNEY], F);
  const at = (top: string) => scene([me, OPP], (g) => {
    setHand(g, 0, ['EB01-029']);
    setDeckTop(g, 0, [top]);
    setDon(g, 0, 1);
    setChars(g, 0, [{ num: 'EB01-016' }]);
  }, 1);
  let r = counterGain(at('EB01-007'), 'EB01-029', (x) => x);
  let s = r.s;
  s = choose(s, (o) => o.uid === charUid(s, 0, 'EB01-016'));
  assert.ok(s.players[0].hand.some((c) => c.num === 'EB01-016'), 'renvoyé en main');
  assert.equal(s.players[0].deck.at(-1)?.num, 'EB01-007', 'révélée placée dessous');
  r = counterGain(at(O_BONNEY), 'EB01-029');
  s = r.s;
  assert.equal(s.players[0].deck[0].num, O_BONNEY, 'reste au-dessus');
  assert.ok(s.players[0].chars.some((c) => c.num === 'EB01-016'));
});

test('Sorry. I’m a Goner. (EB01-029) : [Déclenchement] renvoi en main, coût 8 ou moins', () => {
  let s = triggerFromLife(NEUTRAL_L, 'EB01-029', (g) => setChars(g, 1, [{ num: O_CHOPPER }]));
  s = choose(s, (o) => o.uid === charUid(s, 1, O_CHOPPER));
  assert.ok(s.players[1].hand.some((c) => c.num === O_CHOPPER));
});

test('Loguetown (EB01-030) : ce Lieu et 1 carte de la main sous le deck, dans l’ordre choisi : piocher 2 ; pas d’activation sans carte en main', () => {
  const me = list(NEUTRAL_L, ['EB01-030', O_BONNEY, O_STUSSY], F);
  const at = (hand: string[]) => scene([me, OPP], (g) => {
    g.players[0].stage = { ...takeField(g, 0, 'EB01-030'), uid: 9001 };
    setHand(g, 0, hand);
  });
  let s = at([]);
  assert.ok(!hasOption(s, 'act:9001'), 'main vide');
  s = at([O_BONNEY, O_STUSSY]);
  const size = s.players[0].deck.length;
  s = act(s, 'act:9001');
  s = choose(s, (o) => o.num === O_BONNEY);
  assert.equal(s.decision?.tag, 'bottomOrder');
  s = act(s, 'keep');
  assert.equal(s.players[0].stage, null);
  assert.equal(s.players[0].hand.filter((c) => c.num === O_BONNEY).length, 0);
  const bottom = s.players[0].deck.slice(-2).map((c) => c.num).sort();
  assert.deepEqual(bottom, [O_BONNEY, 'EB01-030'].sort());
  assert.equal(s.players[0].deck.length, size);
  assert.equal(s.players[0].hand.length, 3, '1 restante + 2 piochées');
  coherent(s);
});

test('Loguetown (EB01-030) : [Déclenchement] se joue', () => {
  const s = triggerFromLife(NEUTRAL_L, 'EB01-030');
  assert.equal(s.players[0].stage?.num, 'EB01-030');
});

test('La folle attitude (EB01-038) : [Contre] DON!! −1 : la cible change, même redressée, sans [Bloqueur] (Q&A) ; autre Leader : rien', () => {
  const BW_L = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'LEADER' && CARDS[n].types.some((t) => t.includes('Baroque Works')))!;
  const at = (leader: string, char: string) => scene([list(leader, ['EB01-038', char, 'EB01-016'], F), OPP], (g) => {
    setHand(g, 0, ['EB01-038', 'EB01-016']);   // un Contre reste : le combat attend
    setChars(g, 0, [{ num: char }, { num: 'EB01-016' }]);
    setDon(g, 0, 3);
    oppLeaderDon(g, 3);
  }, 1);
  let s = at(BW_L, 'EB01-054');   // [Bloqueur] redressé
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'noblock');
  const donBefore = s.players[0].donActive + s.players[0].donRested;
  s = choose(s, (o) => o.id.startsWith('cevent:'));
  s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'EB01-054'));
  assert.equal(s.players[0].donActive + s.players[0].donRested, donBefore - 1, 'DON!! −1 (le coût de l’Événement épuise, sans renvoyer)');
  assert.equal(s.battle?.target, charUid(s, 0, 'EB01-054'));
  assert.equal(s.decision?.kind === 'blocker', false, 'plus de [Bloqueur]');
  s = passAll(s, 0);
  assert.ok(!s.players[0].chars.some((c) => c.num === 'EB01-054'), 'mis KO par l’attaque');
  // autre Leader : la question DON!! −1 n'est pas proposée (n° 1000), la cible ne change pas
  s = at(NEUTRAL_L, 'EB01-054');
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  s = choose(s, 'noblock');
  s = choose(s, (o) => o.id.startsWith('cevent:'));
  assert.equal(s.battle?.target, leaderUid(s, 0));
});

test('La folle attitude (EB01-038) : [Déclenchement] DON!! −1 : piocher 2', () => {
  let s = triggerFromLife(NEUTRAL_L, 'EB01-038', (g) => setDon(g, 0, 2));
  const hand = s.players[0].hand.length;
  s = yes(s);
  assert.equal(s.players[0].hand.length, hand + 2);
  assert.equal(s.players[0].donActive + s.players[0].donRested, 1);
});

test('Laboon (EB01-047) : [Une fois par tour] tout Personnage mis KO, de l’un ou l’autre camp, lui compris (Q&A)', () => {
  const me = list(NEUTRAL_L, ['EB01-047', O_BONNEY], F);
  const opp = list(NEUTRAL_L, [O_STUSSY, O_CHOPPER], F);
  const at = (g: GameState) => { setChars(g, 0, [{ num: 'EB01-047' }, { num: O_BONNEY }]); setChars(g, 1, [{ num: O_STUSSY }, { num: O_CHOPPER }]); setHand(g, 0, ['ST21-010']); };
  const finish = (x: GameState) => { let s = x; while (s.decision?.player === 0 && s.decision.kind !== 'main') s = act(s, s.decision.options[0].id); return s; };
  let s = scene([me, opp], at);
  const hand = s.players[0].hand.length;
  const trash = s.players[0].trash.length;
  koCharacter(s, charUid(s, 1, O_STUSSY), 'effect', 0);
  s = finish(resolve(s));
  assert.equal(s.players[0].hand.length, hand, 'pioche 1, défausse 1');
  assert.equal(s.players[0].trash.length, trash + 1);
  // deuxième KO du tour : plus rien
  koCharacter(s, charUid(s, 1, O_CHOPPER), 'effect', 0);
  s = finish(resolve(s));
  assert.equal(s.players[0].trash.length, trash + 1);
  assert.equal(s.players[0].hand.length, hand);

  // son propre camp
  s = scene([me, opp], at);
  koCharacter(s, charUid(s, 0, O_BONNEY), 'battle', 1);
  s = finish(resolve(s));
  assert.equal(s.players[0].trash.length, trash + 2, 'Personnage mis KO et carte défaussée');

  // lui-même mis KO : se déclenche depuis la Défausse
  s = scene([me, opp], at);
  koCharacter(s, charUid(s, 0, 'EB01-047'), 'effect', 1);
  s = finish(resolve(s));
  assert.equal(s.players[0].hand.length, hand);
  assert.equal(s.players[0].trash.length, trash + 2, 'Laboon et carte défaussée');

  // déjà utilisé ce tour, puis lui-même mis KO : plus rien
  s = scene([me, opp], at);
  koCharacter(s, charUid(s, 1, O_STUSSY), 'effect', 0);
  s = finish(resolve(s));
  koCharacter(s, charUid(s, 0, 'EB01-047'), 'effect', 1);
  s = finish(resolve(s));
  assert.equal(s.players[0].trash.length, trash + 2, 'Laboon et 1 seule carte défaussée');
});

test('...I Want to Live!! (EB01-050) : [Contre] 30 cartes en Défausse : Vie facultative ; moins : rien', () => {
  const me = list(NEUTRAL_L, ['EB01-050'], F);
  const at = (trash: number) => scene([me, OPP], (g) => {
    setHand(g, 0, ['EB01-050']);
    setDon(g, 0, 3);
    const P = g.players[0];
    P.trash.push(...P.deck.splice(0, trash));
  }, 1);
  let r = counterGain(at(30), 'EB01-050');
  let s = r.s;
  const life = s.players[0].life.length;
  assert.equal(s.decision?.tag, 'may');
  // l'attaque touche ensuite le Leader : −1 Vie dans tous les cas
  s = yes(s);
  assert.equal(s.players[0].life.length, life);
  assert.ok(logHas(s, /ajoute la carte du dessus de son deck/));
  r = counterGain(at(30), 'EB01-050');
  s = choose(r.s, 'no');
  assert.equal(s.players[0].life.length, life - 1, 'on peut refuser');
  // la carte activée est déjà dans la Défausse : 29 cartes avant de la jouer suffisent (comme n° 3106 de S12) ; 28 non
  r = counterGain(at(29), 'EB01-050');
  assert.equal(r.s.decision?.tag, 'may');
  r = counterGain(at(28), 'EB01-050');
  assert.notEqual(r.s.decision?.tag, 'may');
  assert.equal(r.s.players[0].life.length, life - 1);
});

test('Finger Pistol (EB01-051) : 2 cartes du deck en coût, impossible avec 1 carte (Q&A) ; [Déclenchement] active l’effet [Principale]', () => {
  const me = list(NEUTRAL_L, ['EB01-051'], F);
  const opp = list(NEUTRAL_L, [O_CHOPPER], F);
  const at = (deck: number) => scene([me, opp], (g) => {
    setHand(g, 0, ['EB01-051']);
    setDon(g, 0, 4);
    setChars(g, 1, [{ num: O_CHOPPER }]);
    const P = g.players[0];
    if (P.deck.length > deck) P.trash.push(...P.deck.splice(0, P.deck.length - deck));
  });
  let s = at(10);
  s = play(s, 'EB01-051');
  s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 1, O_CHOPPER));
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].deck.length, 8);
  s = at(1);
  s = play(s, 'EB01-051');
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(s.players[1].chars.length, 1);
  s = triggerFromLife(NEUTRAL_L, 'EB01-051', (g) => setChars(g, 1, [{ num: O_STUSSY }]));
  s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 1, O_STUSSY));
  assert.ok(!s.players[1].chars.some((c) => c.num === O_STUSSY));
});

test('Viola (EB01-052) : relire la Vie adverse (chaque carte garde sa face : Q&A) ou retourner sa Vie sans changer l’ordre (Q&A)', () => {
  const me = list(NEUTRAL_L, ['EB01-052'], F);
  let s = scene([me, OPP], (g) => {
    setHand(g, 0, ['EB01-052']);
    setDon(g, 0, 2);
    g.players[1].life[1].faceUp = true;
    g.players[0].life[0].faceUp = true;
    g.players[0].life[1].faceUp = true;
  });
  const mine = s.players[0].life.map((c) => c.uid);
  let t = play(s, 'EB01-052');
  assert.equal(t.decision?.tag, 'chooseOne');
  t = choose(t, 'choice:1');
  assert.deepEqual(t.players[0].life.map((c) => c.uid), mine);
  assert.ok(t.players[0].life.every((c) => !c.faceUp));
  // l'autre choix : la carte face visible le reste à sa nouvelle place
  t = play(s, 'EB01-052');
  t = choose(t, 'choice:0');
  const up = s.players[1].life[1].uid;
  t = choose(t, (o) => o.uid === up);
  while (t.decision?.tag === 'lifeOrder') t = act(t, t.decision.options[0].id);
  assert.equal(t.players[1].life[0].uid, up);
  assert.equal(t.players[1].life[0].faceUp, true);
  assert.equal(t.players[1].life.filter((c) => c.faceUp).length, 1);
  // sans carte de Vie face visible, le seul choix qui reste est la Vie adverse
  s = scene([me, OPP], (g) => { setHand(g, 0, ['EB01-052']); setDon(g, 0, 2); });
  t = play(s, 'EB01-052');
  assert.notEqual(t.decision?.tag, 'chooseOne', 'un seul choix : pas de question');
  assert.equal(t.decision?.tag, 'lifeOrder');
});

test('Gastino (EB01-053) : [Jouée] Personnage adverse coût 3 ou moins dans sa Vie, face visible, dessus ou dessous ; [Déclenchement] jusqu’à 2 cibles −3000', () => {
  const opp = list(NEUTRAL_L, [O_STUSSY, O_CHOPPER], F);
  const at = () => scene([list(NEUTRAL_L, ['EB01-053'], F), opp], (g) => {
    setHand(g, 0, ['EB01-053']);
    setDon(g, 0, 3);
    setChars(g, 1, [{ num: O_STUSSY }, { num: O_CHOPPER }]);
  });
  let s = play(at(), 'EB01-053');
  assert.ok(!hasOption(s, `card:${charUid(s, 1, O_CHOPPER)}`));
  s = choose(s, (o) => o.uid === charUid(s, 1, O_STUSSY));
  s = choose(s, 'lifeBottom');
  assert.equal(s.players[1].life.at(-1)?.num, O_STUSSY);
  assert.equal(s.players[1].life.at(-1)?.faceUp, true);
  s = triggerFromLife(NEUTRAL_L, 'EB01-053', (g) => setChars(g, 1, [{ num: O_STUSSY }]));
  const stussy = charUid(s, 1, O_STUSSY);
  const leaderBase = CARDS[s.players[1].leader.num].power!;
  s = choose(s, (o) => o.uid === stussy);
  s = choose(s, (o) => o.uid === leaderUid(s, 1));
  assert.equal(power(s, stussy), CARDS[O_STUSSY].power! - 3000);
  assert.ok(s.mods.some((m) => m.uid === leaderUid(s, 1) && m.amount === -3000), JSON.stringify(s.mods) + leaderBase);
});

test('Shirahoshi (EB01-057) : KO par un effet adverse : Vie facultative ; KO en combat ou par son propre effet : rien', () => {
  const me = list(NEUTRAL_L, ['EB01-057'], F);
  const at = () => scene([me, OPP], (g) => { setChars(g, 0, [{ num: 'EB01-057' }]); setDon(g, 0, 0); });
  let s = at();
  const life = s.players[0].life.length;
  koCharacter(s, charUid(s, 0, 'EB01-057'), 'effect', 1);
  s = resolve(s);
  assert.equal(s.decision?.tag, 'may');
  s = yes(s);
  assert.equal(s.players[0].life.length, life + 1);
  // refus permis
  s = at();
  koCharacter(s, charUid(s, 0, 'EB01-057'), 'effect', 1);
  s = choose(resolve(s), 'no');
  assert.equal(s.players[0].life.length, life);
  // son propre effet : rien
  s = at();
  koCharacter(s, charUid(s, 0, 'EB01-057'), 'effect', 0);
  assert.notEqual(resolve(s).decision?.tag, 'may');
  // combat : rien
  s = at();
  koCharacter(s, charUid(s, 0, 'EB01-057'), 'battle', 1);
  assert.notEqual(resolve(s).decision?.tag, 'may');
  assert.equal(def('EB01-057').keywords.includes('Blocker'), true);
});

test('Kingdom Come (EB01-059) : [Principale] KO puis Vie à 1 ; avec 1 Vie ou moins, inchangée (Q&A)', () => {
  const me = list(NEUTRAL_L, ['EB01-059'], F);
  const at = (life: number) => scene([me, list(NEUTRAL_L, [O_CHOPPER], F)], (g) => {
    setHand(g, 0, ['EB01-059']);
    setDon(g, 0, 6);
    setChars(g, 1, [{ num: O_CHOPPER }]);
    g.players[0].life.splice(life);
  });
  let s = play(at(4), 'EB01-059');
  s = choose(s, (o) => o.uid === charUid(s, 1, O_CHOPPER));
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].life.length, 1);
  s = play(at(1), 'EB01-059');
  s = choose(s, 'none');
  assert.equal(s.players[1].chars.length, 1);
  assert.equal(s.players[0].life.length, 1);
  s = play(at(0), 'EB01-059');
  s = choose(s, 'none');
  assert.equal(s.players[0].life.length, 0);
});

test('Kingdom Come (EB01-059) : [Déclenchement] coût au plus la somme des Vies, la carte révélée n’y est plus (Q&A)', () => {
  const opp = (g: GameState) => {
    setChars(g, 1, [{ num: O_STUSSY }, { num: O_CHOPPER }]);
    g.players[0].life.splice(2);
    g.players[1].life.splice(2);
  };
  const s = triggerFromLife(NEUTRAL_L, 'EB01-059', opp);
  // 1 + 2 = 3 : coût 3 oui, coût 4 non
  assert.ok(hasOption(s, `card:${charUid(s, 1, O_STUSSY)}`));
  assert.ok(!hasOption(s, `card:${charUid(s, 1, O_CHOPPER)}`));
});

test('Me voilà, je suis... Dieu ! (EB01-060) : [Enel] de la main ou de la Défausse, puis Vie à 1 ; [Déclenchement] piocher 2, défausser 1', () => {
  const ENEL = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'CHARACTER' && CARDS[n].names.includes('Enel') && (CARDS[n].cost ?? 99) <= 7)!;
  const me = list(NEUTRAL_L, ['EB01-060', ENEL], F);
  const at = (setup: (g: GameState) => void) => scene([me, OPP], (g) => {
    setHand(g, 0, ['EB01-060']);
    setDon(g, 0, 4);
    setup(g);
  });
  let s = at((g) => {
    const P = g.players[0];
    const i = P.deck.findIndex((c) => c.num === ENEL);
    P.trash.push(...P.deck.splice(i, 1));
  });
  s = play(s, 'EB01-060');
  s = choose(s, (o) => o.num === ENEL);
  assert.ok(s.players[0].chars.some((c) => c.num === ENEL) || s.decision !== null);
  while (s.decision && s.decision.kind === 'effect' && s.decision.player === 0) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[0].life.length, 1);
  // aucun [Enel] : la Vie descend quand même (le « Puis » ne dépend de rien, n° 1983)
  s = at((g) => {
    const P = g.players[0];
    for (const z of [P.deck, P.hand, P.trash, P.life]) for (let i = z.length - 1; i >= 0; i--) if (z[i].num === ENEL) z.splice(i, 1);
  });
  s = play(s, 'EB01-060');
  assert.equal(s.players[0].life.length, 1);
  s = triggerFromLife(NEUTRAL_L, 'EB01-060', (g) => setHand(g, 0, []));
  assert.equal(s.decision?.player, 0, 'défausse');
  assert.equal(s.players[0].hand.length, 2);
  s = act(s, s.decision!.options[0].id);
  assert.equal(s.players[0].hand.length, 1);
});

test('Bon Clay (EB01-061) : [Jouée] 1 DON!! redressée ; [En attaquant] base = puissance actuelle du choisi, 5000 et 1 DON!! font 6000 (Q&A)', () => {
  const me = list(NEUTRAL_L, ['EB01-061'], F);
  let s = scene([me, OPP], (g) => { setHand(g, 0, ['EB01-061']); setDon(g, 0, 4); });
  const active = s.players[0].donActive;
  s = donMax(play(s, 'EB01-061'));
  assert.equal(s.players[0].donActive, active - 4 + 1);
  s = scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'EB01-061', extra: { don: 1, playedTurn: 0 } }]);
    setChars(g, 1, [{ num: O_STUSSY }]);
    setDon(g, 0, 0);
  });
  const atk = charUid(s, 0, 'EB01-061');
  s = attack(s, atk, leaderUid(s, 1));
  s = choose(s, (o) => o.uid === charUid(s, 1, O_STUSSY));
  assert.equal(power(s, atk), CARDS[O_STUSSY].power! + 1000);
  assert.equal(fieldCost(s, atk), CARDS['EB01-061'].cost);
  // sans choix : inchangé
  s = scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'EB01-061', extra: { playedTurn: 0 } }]);
    setChars(g, 1, [{ num: O_STUSSY }]);
    setDon(g, 0, 0);
  });
  s = attack(s, charUid(s, 0, 'EB01-061'), leaderUid(s, 1));
  s = choose(s, 'none');
  assert.equal(power(s, charUid(s, 0, 'EB01-061')), CARDS['EB01-061'].power);
});

test('Brook (EB01-046) : [Jouée] −1 de coût puis KO d’un Personnage devenu de coût 0 (limite du banc : la cible a disparu)', () => {
  const opp = list(NEUTRAL_L, [O_BONNEY], F);
  let s = scene([list(NEUTRAL_L, ['EB01-046'], F), opp], (g) => {
    setHand(g, 0, ['EB01-046']);
    setDon(g, 0, 3);
    setChars(g, 1, [{ num: O_BONNEY }]);
  });
  s = play(s, 'EB01-046');
  s = choose(s, (o) => o.uid === charUid(s, 1, O_BONNEY));
  s = choose(s, (o) => o.uid === charUid(s, 1, O_BONNEY));
  assert.equal(s.players[1].chars.length, 0);
  assert.ok(logHas(s, /KO/));
});

test('Kyros (Leader EB01-040) : le dessus de la Vie déjà face visible : pas d’activation (Q&A)', () => {
  const me = list('EB01-040', [O_BONNEY], F);
  const at = (up: boolean) => scene([me, OPP], (g) => {
    g.players[0].life[0].faceUp = up;
    setChars(g, 1, [{ num: O_BONNEY }]);
    g.mods.push({ uid: g.players[1].chars[0].uid, stat: 'cost', amount: -1, until: g.turn, source: 'essai' });
  });
  let s = at(false);
  const leader = leaderUid(s, 0);
  assert.ok(hasOption(s, `act:${leader}`));
  s = act(s, `act:${leader}`);
  s = choose(s, (o) => o.uid === s.players[1].chars[0]?.uid);
  assert.equal(s.players[1].chars.length, 0);
  assert.equal(s.players[0].life[0].faceUp, true);
  s = at(true);
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`));
});
