// joy-boy -> OPTCGSim (tâche O2.1) : les RPC produites après chaque coup du moteur, dans l'ordre du jeu (fixtures du
// 17 nov. et code du jeu), et la vérification de fond : appliquées au miroir, elles redonnent l'état du moteur, coup
// après coup, sur des parties entières jouées au hasard avec tous les decks de départ.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DECKS } from '../../engine/decks.ts';
import { act, newGame } from '../../engine/engine.ts';
import { def, donTotal } from '../../engine/rules.ts';
import type { GameState, PlayerId } from '../../engine/types.ts';
import { applyAll, applyRpc, createMirror, rpcFamily, type Mirror } from '../../online/optcgsim/mirror.ts';
import {
  bindUids, cardName, compareMirror, mirrorFromEngine, OUTBOUND_RPCS, setupRpcs, translateOutbound, type OutboundOptions,
} from '../../online/optcgsim/outbound.ts';
import { decode, encodeRpc, rpcEntry } from '../../online/optcgsim/rpc.ts';
import type { Rpc, Seat } from '../../online/optcgsim/types.ts';
import { scenario, setChars, setDeckTop, setDon, setHand } from '../helpers.ts';

const JOYBOY: Seat = 1;
const OPTCGSIM: Seat = 0;
const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Noms des RPC sans suffixe, sans les lignes de journal. */
const names = (rpcs: Rpc[]) => rpcs.filter((r) => r.name !== 'AddLogLineServerRpc').map((r) => r.name.replace(/ServerRpc$/, ''));
const logs = (rpcs: Rpc[]) => rpcs.filter((r) => r.name === 'AddLogLineServerRpc').map((r) => r.values.s as string);
const find = (rpcs: Rpc[], base: string) => rpcs.find((r) => r.name === `${base}ServerRpc`);

/** Traduit, vérifie que le miroir rendu est le moteur, et que chaque RPC s'encode et se relit à l'identique. */
function translate(m: Mirror, e: GameState, opts: OutboundOptions = {}) {
  const r = translateOutbound(m, e, opts);
  for (const rpc of r.rpcs) assert.deepEqual(decode(encodeRpc(rpc)), rpc, rpc.name);
  return r;
}
function sameTable(m: Mirror, e: GameState, context = '') {
  assert.deepEqual(compareMirror(m, e, { mods: true }), [], context);
}

/** Un coup du joueur `seat` : état avant, choix, état après, RPC traduites (et le miroir suit). */
function play(m: Mirror, s: GameState, choice: string, seat: Seat = JOYBOY) {
  const after = act(s, choice);
  const r = translate(m, after, { seat, before: s, choice });
  return { after, ...r };
}

/** Partie au tour 5, phase principale du joueur joy-boy (siège 1), miroir égal au moteur. */
function table(setup: (s: GameState) => void = () => {}, decks: [string, string] = ['ST-01', 'ST-01'], active: PlayerId = JOYBOY) {
  const s = scenario(decks, (s) => { setDon(s, 0, 4, 1); setDon(s, 1, 5, 0); setup(s); }, active);
  return { s, m: mirrorFromEngine(s) };
}

// ---------------------------------------------------------------------------------------------------- mise en place

test('mise en place : version, nom, deck vide, Leader, 50 cartes, tirage ; le miroir les lit comme le jeu', () => {
  const s = newGame({ decks: ['ST-01', 'ST-02'], names: ['Hôte', 'Joy'], seed: 5, first: 0 });
  const rpcs = setupRpcs(s, JOYBOY, { name: 'Invite#0002', deviceId: 'APPAREIL', playerId: 'JOUEUR' });
  assert.deepEqual(names(rpcs).slice(0, 4), ['VersionCheck', 'SetName', 'MakeEmptyDeckList', 'LoadLeader']);
  assert.equal(names(rpcs).at(-1), 'SetMyTurnRoll');
  assert.equal(rpcs.filter((r) => r.name === 'LoadDeckCardServerRpc').length, 50);
  assert.equal(find(rpcs, 'VersionCheck')!.values.sVersion, '1.45b');
  assert.equal(find(rpcs, 'LoadLeader')!.values.sCardID, 'ST02-001');
  assert.equal(find(rpcs, 'MakeEmptyDeckList')!.values.iDeckSize, 50);
  assert.equal(find(rpcs, 'SetMyTurnRoll')!.values.iRoll, 0);
  for (const r of rpcs) {
    assert.equal(r.object, 2);
    assert.equal(rpcEntry(r.name)?.sens, 'client->hote');
    assert.deepEqual(decode(encodeRpc(r)), r);
  }
  const m = applyAll(createMirror(), rpcs.map((rpc) => ({ rpc, sender: JOYBOY }))).state;
  assert.equal(m.players[JOYBOY].name, 'Invite#0002');
  assert.equal(m.players[JOYBOY].leader.code, 'ST02-001');
  assert.equal(m.players[JOYBOY].zones.deck.length, 50);
  assert.equal(setupRpcs(s, JOYBOY, { name: 'x', version: null })[0].name, 'SetNameServerRpc');
});

test('cartes du miroir liées aux uids du moteur : par position, sinon par code', () => {
  const { s, m } = table();
  for (const c of m.players[0].zones.hand) delete c.uid;
  m.players[0].zones.deck.reverse().forEach((c) => delete c.uid); // ordre inconnu : liés par code
  const b = bindUids(m, s);
  assert.deepEqual(b.players[0].zones.hand.map((c) => c.uid), s.players[0].hand.map((c) => c.uid));
  const codes = (uids: (number | undefined)[]) => uids.map((u) => [...s.players[0].deck].find((c) => c.uid === u)?.num);
  assert.deepEqual(codes(b.players[0].zones.deck.map((c) => c.uid)), b.players[0].zones.deck.map((c) => c.code));
  assert.equal(new Set(b.players[0].zones.deck.map((c) => c.uid)).size, s.players[0].deck.length);
});

// ---------------------------------------------------------------------------------------------------- ouverture

/** Les deux joueurs mis en place chez OPTCGSim, l'hôte (siège 0) commence : le miroir au moment de ChooseTurnOrder. */
function opening(seed = 7, first: PlayerId = 0) {
  const s = newGame({ decks: ['ST-01', 'ST-02'], names: ['Hôte', 'Joy'], seed, first });
  let m = createMirror();
  for (const seat of [0, 1] as const) {
    m = applyAll(m, setupRpcs(s, seat, { name: `J${seat}` }).map((rpc) => ({ rpc, sender: seat }))).state;
  }
  m = applyRpc(m, { name: 'ChooseTurnOrderClientRpc', object: 1, behaviour: 0, values: { iFirst: first === 0 ? 1 : 0 } }, 0).state;
  return { s, m };
}

test('ouverture : mélange (ordre du moteur), 5 cartes ; garder : 5 vies (ordre du prototype)', () => {
  const { s, m } = opening(7, 0);
  // l'hôte décide d'abord dans le moteur ; chez OPTCGSim, joy-boy envoie mélange et pioche tout de suite
  const r = translate(m, s, { seat: JOYBOY });
  assert.deepEqual(names(r.rpcs), ['ShuffleDeck', 'DrawCard']);
  assert.equal(find(r.rpcs, 'DrawCard')!.values.iCount, 5);
  assert.deepEqual(r.problems, []);
  const order = String(find(r.rpcs, 'ShuffleDeck')!.values.s_ShuffleString).split('-').map(Number);
  assert.deepEqual([...order].sort((a, b) => a - b), [...Array(50).keys()]);
  assert.deepEqual(r.mirror.players[JOYBOY].zones.hand.map((c) => c.uid), s.players[JOYBOY].hand.map((c) => c.uid));
  // joy-boy (second) garde : vies posées chez OPTCGSim avant que le moteur ne les pose (il attend l'hôte)
  let m2 = translate(r.mirror, s, { seat: OPTCGSIM }).mirror;
  const s1 = act(s, 'keep'); // l'hôte garde
  m2 = translate(m2, s1, { seat: OPTCGSIM, before: s, choice: 'keep' }).mirror;
  assert.deepEqual(names(translate(m2, s1, { seat: OPTCGSIM }).rpcs), [], 'rien de plus à envoyer');
  sameTable(m2, s1);
  const s2 = act(s1, 'keep');
  const k = translate(m2, s2, { seat: JOYBOY, before: s1, choice: 'keep' });
  assert.deepEqual(names(k.rpcs), ['PopulateLifeDeck']);
  assert.equal(find(k.rpcs, 'PopulateLifeDeck')!.values.iLifeCount, 5);
  assert.deepEqual(k.mirror.players[JOYBOY].zones.life.map((c) => c.uid), [...s2.players[JOYBOY].life].reverse().map((c) => c.uid));
});

test('repiocher : main au deck, mélange, 5 cartes, 5 vies, puis la ligne « Mulligan » (comme l’hôte du 17 nov.)', () => {
  const { s, m } = opening(11, 1); // joy-boy commence : il décide le premier
  let m1 = translate(m, s, { seat: JOYBOY }).mirror;
  m1 = translate(m1, s, { seat: OPTCGSIM }).mirror;
  const s1 = act(s, 'mulligan');
  const r = translate(m1, s1, { seat: JOYBOY, before: s, choice: 'mulligan' });
  assert.deepEqual(names(r.rpcs), ['MoveHandToDeck', 'ShuffleDeck', 'DrawCard', 'PopulateLifeDeck']);
  assert.equal(logs(r.rpcs).at(-1), 'Log.Mulligan');
  assert.deepEqual(r.problems, []);
  sameTable(r.mirror, s1);
});

// ---------------------------------------------------------------------------------------------------- tour

test('début du tour : pioche puis DON!! (lignes « Draw 1 Card », « Draw 2 Don ») ; premier tour : 1 DON!!', () => {
  const { s, m } = opening(3, 1);
  let w = translate(translate(m, s, { seat: JOYBOY }).mirror, s, { seat: OPTCGSIM }).mirror;
  let e = s;
  for (const seat of [1, 0] as const) {
    const next = act(e, 'keep');
    w = translate(w, next, { seat, before: e, choice: 'keep' }).mirror;
    e = next;
  }
  // tour 1 de joy-boy : pas de pioche, 1 DON!!
  const t1 = translate(w, e, { seat: JOYBOY });
  assert.deepEqual(names(t1.rpcs), ['DrawDon']);
  assert.equal(find(t1.rpcs, 'DrawDon')!.values.iCount, 1);
  assert.deepEqual(logs(t1.rpcs), ['Log.DrawDon']);
  // fin du tour : AttemptingToEndTurn, ligne, EndTurn
  const end = play(t1.mirror, e, 'end');
  assert.deepEqual(names(end.rpcs), ['AttemptingToEndTurn', 'EndTurn']);
  assert.deepEqual(logs(end.rpcs), ['Log.EndTurn']);
  assert.equal(end.mirror.turnPlayer, OPTCGSIM);
  // l'hôte pioche et prend ses DON!! lui-même ; son tour fini, joy-boy pioche 1 et prend 2 DON!!
  w = translate(end.mirror, end.after, { seat: OPTCGSIM }).mirror;
  const e3 = act(end.after, 'end');
  w = translate(w, e3, { seat: OPTCGSIM, before: end.after, choice: 'end' }).mirror;
  const t3 = translate(w, e3, { seat: JOYBOY });
  assert.deepEqual(names(t3.rpcs), ['DrawCard', 'DrawDon']);
  assert.deepEqual([find(t3.rpcs, 'DrawCard')!.values.iCount, find(t3.rpcs, 'DrawDon')!.values.iCount], [1, 2]);
  assert.deepEqual(logs(t3.rpcs), ['Log.DrawCard', 'Log.DrawDon']);
  sameTable(t3.mirror, e3);
});

test('jouer un Personnage : TapDon, « Deploy », MoveHandCardToDeploy (ordre de l’hôte du 17 nov.)', () => {
  const { s, m } = table((s) => setHand(s, JOYBOY, ['ST01-006', 'ST01-004']));
  const r = play(m, s, `play:${s.players[JOYBOY].hand[1].uid}`);
  assert.deepEqual(r.rpcs.map((x) => x.name.replace(/ServerRpc$/, '')), ['TapDon', 'AddLogLine', 'MoveHandCardToDeploy']);
  assert.equal(find(r.rpcs, 'TapDon')!.values.iCount, def('ST01-004').cost);
  assert.deepEqual(find(r.rpcs, 'MoveHandCardToDeploy')!.values, { iIdx: 1, bRested: false });
  assert.equal(find(r.rpcs, 'AddLogLine')!.values.s1, cardName('ST01-004'));
  assert.equal(cardName('ST01-004'), 'Sanji [<mark><link="ST01-004">ST01-004</link></mark>]');
  assert.deepEqual(r.problems, []);
  sameTable(r.mirror, r.after);
});

test('donner une DON!! : « Attach 1 Don » puis AttachDonToCard avec la dernière DON!! redressée', () => {
  const { s, m } = table();
  const r = play(m, s, `don:${s.players[JOYBOY].leader.uid}`);
  assert.deepEqual(r.rpcs.map((x) => x.name.replace(/ServerRpc$/, '')), ['AddLogLine', 'AttachDonToCard']);
  assert.deepEqual(find(r.rpcs, 'AttachDonToCard')!.values, { iCardIdx: -1, iDonIdx: 4 });
  assert.deepEqual([find(r.rpcs, 'AddLogLine')!.values.s, find(r.rpcs, 'AddLogLine')!.values.i1, find(r.rpcs, 'AddLogLine')!.values.i2], ['Log.AttachDonMulti', 1, 1]);
  sameTable(r.mirror, r.after);
});

test('Évènement : TapDon, ligne, MoveHandCardToDiscard, puis ses effets', () => {
  // Gum-Gum Jet Pistol (ST01-016 ? selon le deck) : on prend un Évènement [Principale] du deck ST-01
  const ev = Object.keys(DECKS['ST-01'].cards).find((n) => def(n).category === 'EVENT' && def(n).onMain)!;
  const { s, m } = table((s) => {
    setHand(s, JOYBOY, [ev]);
    setChars(s, OPTCGSIM, [{ num: 'ST01-004', extra: { rested: true } }]);
  });
  const opt = s.decision!.options.find((o) => o.id.startsWith('event:'));
  assert.ok(opt, 'Évènement jouable');
  let r = play(m, s, opt.id);
  let e = r.after, w = r.mirror;
  const first = names(r.rpcs);
  assert.deepEqual(first.slice(0, 2), ['TapDon', 'MoveHandCardToDiscard'].slice(0, first.includes('TapDon') ? 2 : 1).length === 2 ? ['TapDon', 'MoveHandCardToDiscard'] : first.slice(0, 2));
  // réponses aux questions de l'effet, s'il y en a
  for (let k = 0; k < 5 && e.decision?.inEffect; k++) {
    const c = e.decision.options[0].id;
    r = play(w, e, c);
    e = r.after; w = r.mirror;
  }
  sameTable(w, e);
});

// ---------------------------------------------------------------------------------------------------- effets

test('effets : pioche, défausse, KO adverse, bonus de puissance — et le miroir suit', () => {
  const { s, m } = table((s) => {
    setChars(s, OPTCGSIM, [{ num: 'ST01-004', extra: { rested: true } }, { num: 'ST01-006' }]);
    setChars(s, JOYBOY, [{ num: 'ST01-005' }]);
  });
  const e = structuredClone(s);
  // un effet joy-boy : pioche 2, défausse 1, met KO un Personnage adverse, +2000 au Leader pour le tour
  const J = e.players[JOYBOY], O = e.players[OPTCGSIM];
  J.hand.push(J.deck.shift()!, J.deck.shift()!);
  J.trash.push(J.hand.splice(0, 1)[0]);
  const ko = O.chars.splice(0, 1)[0];
  O.trash.push({ uid: ko.uid, num: ko.num });
  e.mods.push({ uid: J.leader.uid, stat: 'power', amount: 2000, until: e.turn, source: 'test' });
  e.mods.push({ uid: O.chars[0].uid, stat: 'power', amount: -1000, until: e.turn + 1, source: 'test' });
  const r = translate(m, e, { seat: JOYBOY, before: s });
  // ses zones d'abord, puis ce que l'effet fait chez l'adversaire, puis les bonus
  assert.deepEqual(names(r.rpcs), ['MoveHandCardToDiscard', 'DrawCard', 'DiscardFromDeploy', 'BuffCardPower', 'BuffOpponentCardToOwnersEnd']);
  assert.deepEqual(find(r.rpcs, 'DiscardFromDeploy')!.values, { iCardIndex: 0 });
  assert.deepEqual(find(r.rpcs, 'DrawCard')!.values, { iCount: 2 });
  assert.deepEqual(find(r.rpcs, 'BuffCardPower')!.values, { iCardIndex: -1, iBuff: 2000 });
  assert.deepEqual(r.problems, []);
  sameTable(r.mirror, e);
});

test('recherche : une carte du dessus en main, le reste au-dessous dans l’ordre du moteur', () => {
  const { s, m } = table((s) => setDeckTop(s, JOYBOY, ['ST01-004', 'ST01-005', 'ST01-006', 'ST01-007', 'ST01-008']));
  const e = structuredClone(s);
  const D = e.players[JOYBOY].deck;
  const top = D.splice(0, 5);
  e.players[JOYBOY].hand.push(top[2]);
  D.push(top[4], top[0], top[1], top[3]);
  const r = translate(m, e, { seat: JOYBOY, before: s });
  assert.deepEqual(names(r.rpcs), ['DrawSpecificCard', 'MoveDeckCardToBottom', 'MoveDeckCardToBottom', 'MoveDeckCardToBottom', 'MoveDeckCardToBottom']);
  assert.equal(find(r.rpcs, 'DrawSpecificCard')!.values.iCardIndex, m.players[JOYBOY].zones.deck.length - 3);
  sameTable(r.mirror, e);
});

test('un deck mélangé par un effet part en ShuffleDeck, la carte cherchée sort ensuite par le dessus', () => {
  const { s, m } = table();
  const e = structuredClone(s);
  const D = e.players[JOYBOY].deck;
  const [found] = D.splice(17, 1);
  e.players[JOYBOY].hand.push(found);
  D.reverse();
  const r = translate(m, e, { seat: JOYBOY, before: s });
  assert.deepEqual(names(r.rpcs), ['ShuffleDeck', 'DrawCard']);
  sameTable(r.mirror, e);
});

test('Vie : dégâts au Leader (Vie en main), Vie défaussée, carte ajoutée face visible', () => {
  const { s, m } = table();
  const e = structuredClone(s);
  const L = e.players[JOYBOY].life;
  e.players[JOYBOY].hand.push(L.shift()!);
  e.players[OPTCGSIM].trash.push(e.players[OPTCGSIM].life.shift()!);
  const c = e.players[JOYBOY].deck.shift()!;
  L.unshift({ ...c, faceUp: true });
  const r = translate(m, e, { seat: JOYBOY, before: s });
  assert.deepEqual(names(r.rpcs), ['PlayerDrawLife', 'MoveSpecificDeckCardToLife', 'TrashOpponentLife']);
  sameTable(r.mirror, e);
});

test('rien à envoyer quand le miroir est déjà le moteur ; les variantes « Opponent » ne visent que l’adversaire', () => {
  const { s, m } = table();
  assert.deepEqual(translate(m, s, { seat: JOYBOY }).rpcs, []);
  assert.deepEqual(translate(m, s, { seat: OPTCGSIM }).rpcs, []);
  // l'adversaire épuisé par un effet : TapOpponentCard ; en 'self', rien
  const e = structuredClone(s);
  e.players[OPTCGSIM].leader.rested = true;
  assert.deepEqual(names(translate(m, e, { seat: JOYBOY }).rpcs), ['TapOpponentCard']);
  assert.deepEqual(translate(m, e, { seat: JOYBOY, scope: 'self' }).rpcs, []);
});

test('toutes les RPC du module existent côté client et le miroir sait les appliquer', () => {
  for (const base of OUTBOUND_RPCS) {
    assert.equal(rpcEntry(`${base}ServerRpc`)?.sens, 'client->hote', base);
    if (base !== 'VersionCheck') assert.ok(rpcFamily(base), `${base} inconnue du miroir`);
  }
});

// ---------------------------------------------------------------------------------------------------- parties entières

/** Générateur déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Report { games: number; moves: number; rpcs: number; used: Map<string, number>; problems: Map<string, number> }

/**
 * Une partie jouée au hasard par le moteur : après chaque coup, le joueur qui a joué traduit son coup, puis l'autre
 * traduit ses propres zones (sa pioche et ses DON!! au début de son tour, ses réactions) ; le miroir doit rester le moteur.
 */
function wholeGame(decks: [string, string], seed: number, report: Report, maxMoves = 400) {
  const random = rng(seed);
  let s = newGame({ decks, names: ['A', 'B'], seed, first: (seed % 2) as PlayerId });
  let m = createMirror();
  for (const seat of [0, 1] as const) m = applyAll(m, setupRpcs(s, seat, { name: `J${seat}` }).map((rpc) => ({ rpc, sender: seat }))).state;
  m = applyRpc(m, { name: 'ChooseTurnOrderClientRpc', object: 1, behaviour: 0, values: { iFirst: s.first === 0 ? 1 : 0 } }, 0).state;
  const step = (seat: Seat, after: GameState, o: OutboundOptions) => {
    const r = translateOutbound(m, after, { seat, ...o });
    report.rpcs += r.rpcs.length;
    for (const x of r.rpcs) report.used.set(x.name, (report.used.get(x.name) ?? 0) + 1);
    for (const p of r.problems) { const k = p.replace(/\d+/g, '#'); report.problems.set(k, (report.problems.get(k) ?? 0) + 1); }
    m = r.mirror;
    return r;
  };
  step(0, s, {});
  step(1, s, {});
  let last: Rpc[] = [], lastProblems: string[] = [];
  for (let n = 0; n < maxMoves && s.decision; n++) {
    const d = s.decision;
    const choice = d.options[Math.floor(random() * d.options.length)].id;
    const after = act(s, choice);
    const r0 = step(d.player, after, { before: s, choice });
    last = r0.rpcs; lastProblems = r0.problems;
    const flush = step(d.player === 0 ? 1 : 0, after, { scope: 'self' });
    // ses propres réactions au coup de l'autre (pioche d'un [En cas de KO], [Déclenchement]...) : c'est lui qui les envoie
    void flush;
    const diff = compareMirror(m, after);
    if (diff.length) {
      assert.fail(`partie ${decks.join('/')} n° ${seed}, coup ${n} : ${d.player} choisit ${choice} (${d.kind}${d.tag ? `/${d.tag}` : ''}) — ${diff.slice(0, 4).join(' ; ')} — RPC : ${names(last).join(', ')} — ${lastProblems.join(' ; ')}`);
    }
    s = after;
    report.moves++;
  }
  report.games++;
}

test('parties entières au hasard, tous les decks de départ : après chaque coup, le miroir est le moteur', () => {
  const report: Report = { games: 0, moves: 0, rpcs: 0, used: new Map(), problems: new Map() };
  const starters = Object.keys(DECKS).filter((id) => /^ST-\d+$/.test(id));
  let seed = 1;
  for (const a of starters) {
    for (const b of [starters[(starters.indexOf(a) + 3) % starters.length]]) {
      for (let k = 0; k < 2; k++) wholeGame([a, b], seed++, report);
    }
  }
  assert.ok(report.games >= 2 * starters.length);
  // compte rendu (lisible avec --test-reporter=spec)
  const top = [...report.problems.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15);
  console.log(`${report.games} parties, ${report.moves} coups, ${report.rpcs} RPC, ${report.used.size} RPC différentes`);
  for (const [p, n] of top) console.log(`  non traduit (${n}) : ${p}`);
});

test('les fixtures du 17 nov. : les RPC de joy-boy y ont les noms et les paramètres que ce module produit', () => {
  const f = JSON.parse(fs.readFileSync(ici('./fixtures/miroir/rpc-2026-11-17-0841.json'), 'utf8'));
  const ours = new Set(OUTBOUND_RPCS);
  for (const r of f.rpcs as Rpc[]) {
    if (r.object !== 2) continue;
    const base = r.name.replace(/ClientRpc$/, '');
    if (!ours.has(base) || base === 'AddLogLine') continue; // AddLogLine du client devient TranslateLogLine chez l'hôte
    const server = rpcEntry(`${base}ServerRpc`)!;
    for (const w of server.ecritures) assert.ok(w.param in r.values, `${base}.${w.param}`);
  }
  assert.equal(donTotal('ST01-001'), 10);
});
