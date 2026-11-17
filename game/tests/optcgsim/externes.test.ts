// Mutations externes (tâche O1.3) : chaque forme d'External change le moteur sans contrôle des règles, les invariants
// tiennent, les cartes du joueur joy-boy (siège 1) réagissent et celles du joueur OPTCGSim (siège 0) jamais, les
// décisions forcées se posent et se répondent, et des suites de mutations au hasard gardent une partie cohérente.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from '../../engine/engine.ts';
import { invariantErrors } from '../../engine/invariants.ts';
import { def, donTotal, fieldCost, power } from '../../engine/rules.ts';
import type { GameState, PlayerId } from '../../engine/types.ts';
import {
  answerExternal, applyExternal, ExternalError, externalIndexOf, forceDecision, isForced,
} from '../../online/optcgsim/external.ts';
import type { External, Seat, Zone } from '../../online/optcgsim/types.ts';
import { scenario, setChars, setHand } from '../helpers.ts';

const OPTCGSIM = 0;
const JOYBOY = 1;

const sain = (s: GameState) => {
  if (!s.decision?.inEffect) assert.deepEqual(invariantErrors(s), []);
};
const ext = (s: GameState, m: External, opts = {}) => {
  const next = applyExternal(s, m, opts);
  sain(next);
  return next;
};
// Partie au tour 5, phase principale du joueur `active` ; siège 0 : ST-08 (Leader Luffy noir : « pendant votre tour, quand un
// Personnage est mis KO, donnez 1 DON!! épuisée à ce Leader ») ; siège 1 : ST-21 (Zoro ST21-015, [En cas de KO])
const partie = (setup: (s: GameState) => void = () => {}, active: PlayerId = OPTCGSIM, decks: [string, string] = ['ST-08', 'ST-21']) =>
  scenario(decks, (s) => {
    for (const p of [0, 1] as PlayerId[]) {
      const P = s.players[p];
      const total = donTotal(P.leader.num);
      P.donActive = Math.min(4, total);
      P.donRested = Math.min(2, total - P.donActive);
      P.donDeck = total - P.donActive - P.donRested;
    }
    setup(s);
  }, active);

test('move : un Personnage joué par OPTCGSim arrive sur le terrain sans résoudre son [Jouée]', () => {
  let s = partie((s) => setHand(s, OPTCGSIM, ['ST08-008', 'ST08-003']));
  const hand = s.players[OPTCGSIM].hand.length;
  const higuma = s.players[OPTCGSIM].hand.findIndex((c) => c.num === 'ST08-008');  // Higuma : [Jouée]
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'hand', index: higuma, to: 'deploy', rested: true });
  const P = s.players[OPTCGSIM];
  assert.equal(P.hand.length, hand - 1);
  assert.equal(P.chars.at(-1)?.num, 'ST08-008');
  assert.equal(P.chars.at(-1)?.rested, true);
  assert.equal(P.chars.at(-1)?.playedTurn, s.turn);
  assert.equal(s.pending.length, 0);
  assert.equal(s.decision?.kind, 'main');  // décision de la phase principale recalculée
  assert.ok(s.log.at(-1)!.text.includes(def('ST08-008').name));
  // `at` : position d'arrivée ; deck → main (pioche) : le nom reste secret dans le journal
  const top = s.players[OPTCGSIM].deck[0];
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'deck', index: 0, to: 'hand', at: 0 });
  assert.equal(s.players[OPTCGSIM].hand[0].uid, top.uid);
  assert.equal(s.log.at(-1)!.text, 'une carte : deck → main');
  // Défausse → dessus du deck, puis le Personnage vers la Défausse (sans cause : il quitte le terrain sans KO)
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'deploy', index: s.players[OPTCGSIM].chars.length - 1, to: 'trash' });
  assert.equal(s.players[OPTCGSIM].trash.at(-1)?.num, 'ST08-008');
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'trash', index: s.players[OPTCGSIM].trash.length - 1, to: 'deck', at: 0 });
  assert.equal(s.players[OPTCGSIM].deck[0].num, 'ST08-008');
  assert.ok(s.known?.some((k) => k.uid === s.players[OPTCGSIM].deck[0].uid && k.to === JOYBOY), 'carte vue de tous, connue dans le deck');
});

test('move : Lieu, Vie et réordonner la zone de Personnage', () => {
  let s = partie(undefined, OPTCGSIM, ['ST-32', 'ST-21']);
  // Vie → main : la carte n'est plus face visible
  s.players[JOYBOY].life[0].faceUp = true;
  const life = s.players[JOYBOY].life.length;
  s = ext(s, { kind: 'move', player: JOYBOY, from: 'life', index: 0, to: 'hand' });
  assert.equal(s.players[JOYBOY].life.length, life - 1);
  assert.equal(s.players[JOYBOY].hand.at(-1)?.faceUp, undefined);
  // deck → dessous de la Vie
  s = ext(s, { kind: 'move', player: JOYBOY, from: 'deck', index: 0, to: 'life' });
  assert.equal(s.players[JOYBOY].life.length, life);
  // deux Personnages, puis le second passe devant
  s = partie((s) => {
    setChars(s, OPTCGSIM, [{ num: 'ST08-003' }, { num: 'ST08-011', extra: { don: 1 } }]);
    s.players[OPTCGSIM].donActive -= 1;
  });
  const [a, b] = s.players[OPTCGSIM].chars;
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'deploy', index: 1, to: 'deploy', at: 0 });
  assert.deepEqual(s.players[OPTCGSIM].chars.map((c) => c.uid), [b.uid, a.uid]);
  assert.equal(s.players[OPTCGSIM].chars[0].don, 1, 'la carte garde ses DON!!');
  // un Personnage qui quitte le terrain rend ses DON!! épuisées et perd ses modifications
  s = ext(s, { kind: 'power', player: OPTCGSIM, target: 0, delta: 2000, until: 'turn' });
  const rested = s.players[OPTCGSIM].donRested;
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'deploy', index: 0, to: 'hand' });
  assert.equal(s.players[OPTCGSIM].donRested, rested + 1);
  assert.equal(s.mods.length, 0);
});

test('move ko : le [En cas de KO] du Personnage joy-boy se résout, la réaction du Leader OPTCGSim est écartée', () => {
  const red = (n: string) => def(n).category === 'CHARACTER' && def(n).colors.includes('Red') && (def(n).power ?? 0) <= 6000 && !def(n).names.includes('Roronoa Zoro');
  let s = partie((s) => {
    setChars(s, JOYBOY, [{ num: 'ST21-015' }]);
    setHand(s, JOYBOY, ['ST21-005', 'ST21-002']);
  });
  assert.ok(s.players[JOYBOY].hand.every((c) => red(c.num)));
  const leaderDon = s.players[OPTCGSIM].leader.don;
  const zoro = s.players[JOYBOY].chars[0];
  s = ext(s, { kind: 'move', player: JOYBOY, from: 'deploy', index: 0, to: 'trash' }, { cause: 'ko', sourceNum: 'ST08-015' });
  assert.equal(s.players[JOYBOY].trash.at(-1)?.uid, zoro.uid);
  assert.equal(s.players[JOYBOY].charKoTurn, s.turn);
  // Zoro : « jouez jusqu'à 1 Personnage rouge de 6000 ou moins de votre main » : la question va au joueur joy-boy
  assert.equal(s.decision?.player, JOYBOY);
  assert.equal(s.decision?.inEffect, true);
  assert.ok(s.pending.every((p) => p.controller === JOYBOY), 'aucun effet du joueur OPTCGSim en attente');
  assert.equal(s.players[OPTCGSIM].leader.don, leaderDon, 'le Leader Luffy OPTCGSim ne reçoit rien du moteur');
  // pendant la question, les mutations sont refusées
  assert.throws(() => applyExternal(s, { kind: 'turn', to: JOYBOY }), ExternalError);
  const pick = s.decision!.options.find((o) => o.uid !== undefined)!;
  s = answerExternal(s, pick.id);
  sain(s);
  assert.ok(s.players[JOYBOY].chars.some((c) => c.uid === pick.uid), 'le Personnage choisi est joué');
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.decision?.player, OPTCGSIM);
  // le même départ sans cause : pas de KO, pas d'[En cas de KO]
  let t = partie((s) => {
    setChars(s, JOYBOY, [{ num: 'ST21-015' }]);
    setHand(s, JOYBOY, ['ST21-005']);
  });
  t = ext(t, { kind: 'move', player: JOYBOY, from: 'deploy', index: 0, to: 'trash' });
  assert.equal(t.decision?.inEffect, undefined);
  assert.equal(t.players[JOYBOY].charKoTurn, undefined);
});

test('move ko : le Personnage OPTCGSim mis KO ne résout pas son [En cas de KO] dans le moteur', () => {
  let s = partie((s) => {
    setChars(s, OPTCGSIM, [{ num: 'ST21-015' }]);
    setHand(s, OPTCGSIM, ['ST21-005']);
  }, JOYBOY, ['ST-21', 'ST-08']);
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'deploy', index: 0, to: 'trash' }, { cause: 'battleKo', by: JOYBOY });
  assert.equal(s.decision?.player, JOYBOY);
  assert.equal(s.players[OPTCGSIM].chars.length, 0);
  assert.ok(s.pending.every((p) => p.controller === JOYBOY), 'aucun effet du joueur OPTCGSim en attente');
  // Leader Luffy du joueur joy-boy (son tour) : « quand un Personnage est mis KO, donnez 1 DON!! épuisée à ce Leader »
  // (« jusqu'à 1 » : la question lui est posée, ou la DON!! est donnée)
  const L = s.players[JOYBOY].leader;
  assert.ok(L.don === 1 || s.decision?.inEffect, 'le Leader joy-boy réagit au KO');
});

test('rest / activate : cartes du terrain et DON!! de la zone de Coût ; la réaction joy-boy se déclenche', () => {
  let s = partie((s) => setChars(s, JOYBOY, [{ num: 'ST32-003' }]), JOYBOY, ['ST-08', 'ST-32']);
  const hand = s.players[JOYBOY].hand.length;
  // Mihawk ST32-003 : « pendant votre tour, quand ce Personnage est épuisé, piochez 1 carte puis défaussez 1 carte »
  s = ext(s, { kind: 'rest', player: JOYBOY, zone: 'deploy', index: 0 }, { sourceNum: 'ST08-015' });
  assert.equal(s.players[JOYBOY].chars[0].rested, true);
  assert.equal(s.decision?.inEffect, true, 'défausse demandée au joueur joy-boy');
  assert.equal(s.players[JOYBOY].hand.length, hand + 1);
  s = answerExternal(s, s.decision!.options[0].id);
  sain(s);
  assert.equal(s.players[JOYBOY].hand.length, hand);
  // épuiser une carte déjà épuisée ne fait rien ; redresser
  const before = s.log.length;
  s = ext(s, { kind: 'rest', player: JOYBOY, zone: 'deploy', index: 0 });
  assert.equal(s.log.length, before);
  s = ext(s, { kind: 'activate', player: JOYBOY, zone: 'deploy', index: 0 });
  assert.equal(s.players[JOYBOY].chars[0].rested, false);
  // Leader (-1) et DON!! : index < donActive = redressée
  s = ext(s, { kind: 'rest', player: OPTCGSIM, zone: 'leader', index: -1 });
  assert.equal(s.players[OPTCGSIM].leader.rested, true);
  const P = () => s.players[OPTCGSIM];
  const [a, r] = [P().donActive, P().donRested];
  s = ext(s, { kind: 'rest', player: OPTCGSIM, zone: 'donCost', index: 0 });
  assert.deepEqual([P().donActive, P().donRested], [a - 1, r + 1]);
  s = ext(s, { kind: 'activate', player: OPTCGSIM, zone: 'donCost', index: P().donActive });
  assert.deepEqual([P().donActive, P().donRested], [a, r]);
  assert.throws(() => applyExternal(s, { kind: 'rest', player: OPTCGSIM, zone: 'hand', index: 0 }), ExternalError);
});

test('attachDon et DON!! du deck DON!! : le total de DON!! ne change pas', () => {
  let s = partie((s) => setChars(s, OPTCGSIM, [{ num: 'ST08-003' }]));
  const P = () => s.players[OPTCGSIM];
  const p0 = power(s, P().chars[0].uid);
  s = ext(s, { kind: 'attachDon', player: OPTCGSIM, target: 0, donIndex: 0 });
  assert.equal(P().chars[0].don, 1);
  assert.equal(power(s, P().chars[0].uid), p0 + 1000, 'tour du joueur OPTCGSim : +1000');
  s = ext(s, { kind: 'attachDon', player: OPTCGSIM, target: -1, donIndex: 0, rested: true });
  assert.equal(P().leader.don, 1);
  assert.equal(P().donRested, 1);
  // deck DON!! → zone de Coût (épuisée), puis retour au deck DON!!
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'donDeck', index: 0, to: 'donCost', rested: true });
  assert.deepEqual([P().donDeck, P().donRested], [3, 2]);
  s = ext(s, { kind: 'move', player: OPTCGSIM, from: 'donCost', index: P().donActive, to: 'donDeck' });
  assert.deepEqual([P().donDeck, P().donRested], [4, 1]);
  // plus aucune DON!! dans la zone de Coût : erreur
  const empty = partie((s) => {
    s.players[OPTCGSIM].donDeck += s.players[OPTCGSIM].donActive + s.players[OPTCGSIM].donRested;
    s.players[OPTCGSIM].donActive = 0;
    s.players[OPTCGSIM].donRested = 0;
  });
  assert.throws(() => applyExternal(empty, { kind: 'attachDon', player: OPTCGSIM, target: -1, donIndex: 0 }), ExternalError);
  assert.throws(() => applyExternal(empty, { kind: 'attachDon', player: OPTCGSIM, target: 3, donIndex: 0 }), ExternalError);
});

test('power / cost : échéances du tour, du combat et du prochain tour adverse', () => {
  let s = partie((s) => {
    setChars(s, OPTCGSIM, [{ num: 'ST08-003' }]);
    setChars(s, JOYBOY, [{ num: 'ST21-005' }]);
  });
  const mine = s.players[OPTCGSIM].chars[0].uid;
  const theirs = s.players[JOYBOY].chars[0].uid;
  const base = power(s, mine);
  s = ext(s, { kind: 'power', player: OPTCGSIM, target: 0, delta: 1000, until: 'turn' });
  s = ext(s, { kind: 'power', player: OPTCGSIM, target: 0, delta: 2000, until: 'battle' });  // sans combat : pour le tour
  s = ext(s, { kind: 'power', player: OPTCGSIM, target: -1, delta: 3000, until: 'ownersEnd' });
  s = ext(s, { kind: 'cost', player: JOYBOY, target: 0, delta: -2, until: 'ownersEnd' });
  assert.equal(power(s, mine), base + 3000);
  assert.equal(fieldCost(s, theirs), (def('ST21-005').cost ?? 0) - 2);
  const leader = s.players[OPTCGSIM].leader.uid;
  const leaderBase = (def(s.players[OPTCGSIM].leader.num).power ?? 0);
  assert.equal(power(s, leader), leaderBase + 3000);
  // fin du tour OPTCGSim : le bonus du tour disparaît, ceux « jusqu'à la fin du prochain tour adverse » restent
  s = ext(s, { kind: 'turn', to: JOYBOY });
  assert.equal(power(s, mine), base);
  assert.equal(power(s, leader), leaderBase + 3000);
  assert.equal(fieldCost(s, theirs), (def('ST21-005').cost ?? 0) - 2);
  // fin du tour joy-boy : tout est fini
  s = ext(s, { kind: 'turn', to: OPTCGSIM });
  assert.equal(power(s, leader), leaderBase);
  assert.equal(s.mods.length, 0);
  assert.throws(() => applyExternal(s, { kind: 'power', player: OPTCGSIM, target: 4, delta: 1000, until: 'turn' }), ExternalError);
});

test('shuffle : l’ordre imposé est appliqué, un ordre invalide est refusé sans toucher à l’état', () => {
  let s = partie();
  const deck = s.players[OPTCGSIM].deck.map((c) => c.uid);
  const order = deck.map((_, i) => deck.length - 1 - i);
  s = ext(s, { kind: 'shuffle', player: OPTCGSIM, order });
  assert.deepEqual(s.players[OPTCGSIM].deck.map((c) => c.uid), [...deck].reverse());
  const copy = JSON.stringify(s);
  assert.throws(() => applyExternal(s, { kind: 'shuffle', player: OPTCGSIM, order: order.slice(1) }), ExternalError);
  assert.throws(() => applyExternal(s, { kind: 'shuffle', player: OPTCGSIM, order: order.map(() => 0) }), ExternalError);
  assert.equal(JSON.stringify(s), copy);
});

test('turn : le tour passe au joueur joy-boy (pioche et DON!! du moteur), puis à OPTCGSim (ni pioche ni DON!!)', () => {
  let s = partie((s) => {
    setChars(s, OPTCGSIM, [{ num: 'ST08-003', extra: { rested: true, don: 1 } }]);
    s.players[OPTCGSIM].donActive -= 1;
  });
  const turn = s.turn;
  const J = () => s.players[JOYBOY];
  const O = () => s.players[OPTCGSIM];
  const [jHand, jDonDeck] = [J().hand.length, J().donDeck];
  s = ext(s, { kind: 'turn', to: JOYBOY });
  assert.equal(s.turn, turn + 1);
  assert.equal(s.active, JOYBOY);
  assert.equal(J().hand.length, jHand + 1, 'pioche du joueur joy-boy');
  assert.equal(J().donDeck, jDonDeck - 2, '2 DON!!');
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.decision?.player, JOYBOY);
  const [oHand, oDonDeck] = [O().hand.length, O().donDeck];
  s = ext(s, { kind: 'turn', to: OPTCGSIM });
  assert.equal(s.turn, turn + 2);
  assert.equal(s.active, OPTCGSIM);
  assert.equal(O().hand.length, oHand, 'la pioche OPTCGSim arrivera en mutation');
  assert.equal(O().donDeck, oDonDeck, 'les DON!! OPTCGSim arriveront en mutations');
  assert.equal(O().chars[0].rested, false, 'phase de Recharge : redressé');
  assert.equal(O().chars[0].don, 0, 'DON!! données renvoyées');
  assert.equal(s.flow.stage, 'main');
  assert.equal(s.decision?.player, OPTCGSIM);
  // vers le même joueur : tour supplémentaire
  s = ext(s, { kind: 'turn', to: OPTCGSIM });
  assert.equal(s.active, OPTCGSIM);
  assert.equal(s.turn, turn + 3);
});

test('forceDecision : posée hors des règles, refusée par act(), répondue par answerExternal', () => {
  let s = partie();
  const forced = forceDecision(s, {
    player: JOYBOY,
    prompt: 'Effet adverse : choisis un de tes Personnages à placer dans ta Défausse',
    options: [{ id: 'card:1', label: 'A' }, { id: 'card:2', label: 'B' }],
    tag: 'trashOwn',
  });
  assert.equal(s.decision?.kind, 'main', 'l’état reçu ne change pas');
  assert.ok(isForced(forced.decision));
  assert.equal(forced.decision?.player, JOYBOY);
  sain(forced);
  assert.throws(() => act(forced, 'card:1'));
  // une mutation pendant la décision forcée la laisse en place
  const moved = applyExternal(forced, { kind: 'move', player: OPTCGSIM, from: 'deck', index: 0, to: 'hand' });
  assert.ok(isForced(moved.decision));
  assert.throws(() => answerExternal(moved, 'card:9'), ExternalError);
  s = answerExternal(moved, 'card:2');
  assert.equal(s.history.at(-1)?.choice, 'card:2');
  assert.equal(s.history.at(-1)?.player, JOYBOY);
  assert.equal(s.decision?.kind, 'main', 'la décision ordinaire revient');
  assert.equal(s.decision?.player, OPTCGSIM);
  assert.throws(() => forceDecision(s, { player: JOYBOY, prompt: '?', options: [] }), ExternalError);
  assert.throws(() => forceDecision(s, { player: JOYBOY, prompt: '?', options: [{ id: 'a', label: 'a' }, { id: 'a', label: 'b' }] }), ExternalError);
});

test('mutations impossibles : refusées, état intact', () => {
  const s = partie((s) => {
    setChars(s, OPTCGSIM, ['ST08-002', 'ST08-003', 'ST08-004', 'ST08-007', 'ST08-011'].map((num) => ({ num })));
    setHand(s, OPTCGSIM, ['ST08-012', 'ST08-014']);
  });
  const copy = JSON.stringify(s);
  const bad: External[] = [
    { kind: 'move', player: OPTCGSIM, from: 'hand', index: 0, to: 'deploy' },  // 6e Personnage
    { kind: 'move', player: OPTCGSIM, from: 'hand', index: 1, to: 'stage' },   // Évènement dans la zone de Lieu
    { kind: 'move', player: OPTCGSIM, from: 'hand', index: 9, to: 'trash' },   // hors de la main
    { kind: 'move', player: OPTCGSIM, from: 'leader', index: -1, to: 'trash' },
    { kind: 'move', player: OPTCGSIM, from: 'hand', index: 0, to: 'donCost' },
    { kind: 'move', player: OPTCGSIM, from: 'trash', index: 0, to: 'hand', at: 99 },
  ];
  for (const m of bad) assert.throws(() => applyExternal(s, m), ExternalError, JSON.stringify(m));
  assert.equal(JSON.stringify(s), copy);
  assert.throws(() => applyExternal(s, { kind: 'move', player: OPTCGSIM, from: 'deploy', index: 0, to: 'deploy', at: 7 }), ExternalError);
  assert.equal(externalIndexOf(s, OPTCGSIM, 'deploy', s.players[OPTCGSIM].chars[2].uid), 2);
  assert.equal(externalIndexOf(s, OPTCGSIM, 'leader', s.players[OPTCGSIM].leader.uid), -1);
  assert.equal(externalIndexOf(s, OPTCGSIM, 'hand', -5), null);
});

// ---------- Suites de mutations au hasard ----------

function lcg(seed: number) {
  let x = seed >>> 0;
  return (n: number) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x % n;
  };
}

const ZONES: Zone[] = ['deck', 'hand', 'life', 'deploy', 'stage', 'trash', 'donDeck', 'donCost'];

function randomMutation(s: GameState, r: (n: number) => number): External {
  const player = r(2) as Seat;
  const P = s.players[player];
  const size = (z: Zone) => (z === 'deploy' ? P.chars.length : z === 'stage' ? (P.stage ? 1 : 0) : z === 'donCost' ? P.donActive + P.donRested
    : z === 'donDeck' ? P.donDeck : z === 'leader' ? 1 : (P[z as 'deck'] as unknown[]).length);
  const index = (z: Zone) => (size(z) ? r(size(z)) : 0);
  const target = () => (P.chars.length && r(3) ? r(P.chars.length) : -1);
  switch (r(9)) {
    case 0: case 1: case 2: {
      const from = ZONES[r(ZONES.length)];
      const to = ZONES[r(ZONES.length)];
      return { kind: 'move', player, from, index: index(from), to, ...(r(2) ? { at: r(size(to) + 1) } : {}), rested: r(2) === 0 };
    }
    case 3: return { kind: r(2) ? 'rest' : 'activate', player, zone: (['deploy', 'leader', 'donCost', 'stage'] as Zone[])[r(4)], index: r(2) };
    case 4: return { kind: 'attachDon', player, target: target(), donIndex: index('donCost'), ...(r(2) ? { rested: r(2) === 0 } : {}) };
    case 5: return { kind: r(2) ? 'power' : 'cost', player, target: target(), delta: (r(5) - 2) * 1000 / (r(2) ? 1 : 1000), until: (['turn', 'battle', 'ownersEnd'] as const)[r(3)] };
    case 6: {
      const order = P.deck.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = r(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      return { kind: 'shuffle', player, order };
    }
    case 7: return { kind: 'turn', to: r(4) ? other(s.active) : s.active };
    default: return { kind: 'move', player, from: 'hand', index: index('hand'), to: r(2) ? 'deploy' : 'trash' };
  }
}
const other = (p: PlayerId): Seat => (p === 0 ? 1 : 0);
const CAUSES = [undefined, 'ko', 'battleKo', 'discard', 'attack', 'effect'] as const;

test('suites de mutations au hasard : les invariants tiennent, aucun effet OPTCGSim n’est résolu', () => {
  const decks: [string, string][] = [['ST-08', 'ST-21'], ['ST-21', 'ST-32'], ['ST-32', 'ST-08'], ['META-ENEL-2026-10', 'META-KAIDO-2026-10']];
  let applied = 0;
  let refused = 0;
  let joyboyQuestions = 0;
  for (let game = 0; game < 24; game++) {
    const r = lcg(1000 + game);
    let s = partie(undefined, (game % 2) as PlayerId, decks[game % decks.length]);
    for (let step = 0; step < 120 && s.winner === null; step++) {
      // question en attente : un joueur répond au hasard (le joueur OPTCGSim aussi : questions des effets joy-boy)
      if (s.decision && (s.decision.inEffect || isForced(s.decision) || s.decision.player === JOYBOY) && r(3)) {
        if (s.decision.player === JOYBOY && s.decision.inEffect) joyboyQuestions++;
        s = answerExternal(s, s.decision.options[r(s.decision.options.length)].id);
        sain(s);
        continue;
      }
      if (s.decision?.inEffect) continue;
      const m = randomMutation(s, r);
      const opts = { cause: CAUSES[r(CAUSES.length)] };
      const before = JSON.stringify(s);
      try {
        s = applyExternal(s, m, opts);
        applied++;
      } catch (err) {
        assert.ok(err instanceof ExternalError, `${JSON.stringify(m)} : ${(err as Error).stack}`);
        assert.equal(JSON.stringify(s), before, 'une mutation refusée ne change rien');
        refused++;
        continue;
      }
      sain(s);
      assert.ok(s.pending.every((p) => p.controller === JOYBOY || (p.kind === 'system' && p.action !== 'order')), `effet OPTCGSim en attente après ${JSON.stringify(m)}`);
    }
  }
  assert.ok(applied > 1500, `mutations appliquées : ${applied}`);
  assert.ok(refused > 100, `mutations refusées : ${refused}`);
  assert.ok(joyboyQuestions > 0, 'des cartes joy-boy ont réagi par une question');
});

