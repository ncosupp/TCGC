// Combat des parties croisées (tâche O2.3) : chaque échange (attaque d'OPTCGSim, défense de joy-boy, attaque de joy-boy,
// défense d'OPTCGSim) joué sur une table complète : moteur, miroir des zones, combat, et l'écho de l'hôte (chaque
// ServerRpc de joy-boy revient en ClientRpc et s'applique une fois au miroir). Les lots envoyés sont comparés à ceux du
// vrai jeu (fixture anonymisée du 17 nov.) et le miroir doit finir comme le moteur.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { advanceShared } from '../../engine/engine.ts';
import { invariantErrors } from '../../engine/invariants.ts';
import { power } from '../../engine/rules.ts';
import type { Card, FieldCard, GameState, PlayerId } from '../../engine/types.ts';
import {
  combatAnswer, createCombat, handleCombatRpc, mirrorOptions, routesTo, waiting, type CombatResult, type CombatState,
} from '../../online/optcgsim/combat.ts';
import { answerExternal, applyExternal, externalIndexOf } from '../../online/optcgsim/external.ts';
import { applyRpc, baseName, createMirror, type Mirror, type MirrorCardX } from '../../online/optcgsim/mirror.ts';
import type { External, Rpc, Seat, Zone } from '../../online/optcgsim/types.ts';
import { scenario } from '../helpers.ts';

const OPTCGSIM = 0;
const JOYBOY = 1;
const OBJET: Record<Seat, number> = { 0: 1, 1: 2 };  // objets réseau des fixtures : 1 = hôte, 2 = joy-boy
const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// ---------------------------------------------------------------------------------------------------- table

/** Cartes du deck renommées (la composition notée dans la partie suit : invariants). */
function prendre(s: GameState, p: PlayerId, nums: string[]): Card[] {
  return nums.map((num) => {
    const c = s.players[p].deck.pop()!;
    c.num = num;
    return c;
  });
}
const champ = (c: Card, extra: Partial<FieldCard> = {}): FieldCard => ({ uid: c.uid, num: c.num, rested: false, don: 0, playedTurn: 1, usedOpt: [], ...extra });

function recomposer(s: GameState) {
  for (const P of s.players) {
    const cards: Record<string, number> = {};
    for (const c of [...P.deck, ...P.hand, ...P.trash, ...P.life, ...P.chars, ...(P.stage ? [P.stage] : [])]) cards[c.num] = (cards[c.num] ?? 0) + 1;
    P.list = { leader: P.leader.num, cards };
  }
}

interface Mise {
  leaders?: [string, string];
  hand?: [string[], string[]];
  life?: [string[], string[]];  // dessus d'abord
  chars?: [{ num: string; rested?: boolean; don?: number }[], { num: string; rested?: boolean; don?: number }[]];
  leaderDon?: [number, number];
  active?: PlayerId;
}

/** Partie au tour 5, phase principale de `active` (OPTCGSim par défaut), décrite carte par carte. */
function partie(m: Mise = {}): GameState {
  return scenario(['ST-01', 'ST-01'], (s) => {
    for (const p of [0, 1] as PlayerId[]) {
      const P = s.players[p];
      P.deck.push(...P.hand, ...P.life, ...P.chars);
      P.hand = []; P.life = []; P.chars = [];
      if (m.leaders) P.leader.num = m.leaders[p];
      P.hand = prendre(s, p, m.hand?.[p] ?? []);
      P.life = prendre(s, p, m.life?.[p] ?? ['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077']);
      P.chars = (m.chars?.[p] ?? []).map((x) => champ(prendre(s, p, [x.num])[0], { rested: x.rested ?? false, don: x.don ?? 0 }));
      P.leader.don = m.leaderDon?.[p] ?? 0;
      P.leader.rested = false;
      const attached = P.leader.don + P.chars.reduce((t, c) => t + c.don, 0);
      P.donRested = 2; P.donActive = Math.min(4, 8 - attached); P.donDeck = 10 - P.donRested - P.donActive - attached;
    }
    recomposer(s);
  }, m.active ?? OPTCGSIM);
}

/** Miroir de la même table, chaque carte avec son uid (ordre d'OPTCGSim : dessus d'une pile = dernier élément). */
function miroirDe(s: GameState): Mirror {
  const m = createMirror();
  let iid = 1000;
  const carte = (c: Card, extra: Partial<MirrorCardX> = {}): MirrorCardX => ({ code: c.num, uid: c.uid, iid: iid++, ...extra });
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p], M = m.players[p];
    M.name = P.name;
    M.leader = carte(P.leader, { faceUp: true, ...(P.leader.don ? { attachedDon: P.leader.don } : {}), ...(P.leader.rested ? { rested: true } : {}) });
    M.zones.leader = [M.leader];
    M.zones.deck = [...P.deck].reverse().map((c) => carte(c));
    M.zones.life = [...P.life].reverse().map((c) => carte(c));
    M.zones.hand = P.hand.map((c) => carte(c));
    M.zones.trash = P.trash.map((c) => carte(c));
    M.zones.deploy = P.chars.map((c) => carte(c, { ...(c.rested ? { rested: true } : {}), ...(c.don ? { attachedDon: c.don } : {}) }));
    M.zones.donCost = [
      ...Array.from({ length: P.donRested }, () => ({ code: 'DON', iid: iid++, rested: true })),
      ...Array.from({ length: P.donActive }, () => ({ code: 'DON', iid: iid++ })),
    ];
    M.zones.donDeck = Array.from({ length: P.donDeck }, () => ({ code: 'DON', iid: iid++ }));
  }
  m.turnPlayer = s.active as Seat;
  m.actingPlayer = s.active as Seat;
  m.turn = s.turn;
  m.nextIid = iid;
  return m;
}

interface Table { game: GameState; mirror: Mirror; combat: CombatState; lots: string[][]; envoyes: Rpc[][]; notes: string[] }

function table(m: Mise = {}): Table {
  const game = partie(m);
  return { game, mirror: miroirDe(game), combat: createCombat(), lots: [], envoyes: [], notes: [] };
}

/** Mutation du miroir (positions OPTCGSim) traduite pour le moteur (rôle de inbound, tâche O2.2), d'après les uid. */
function versMoteur(e: External, avant: Mirror, s: GameState): External {
  const pos = (player: Seat, zone: Zone, index: number) => {
    if (zone === 'leader' || index === -1) return -1;
    if (zone === 'donCost' || zone === 'donDeck') return index;
    const uid = avant.players[player].zones[zone][index]?.uid;
    // sans uid : même ordre que le moteur, sauf les piles (deck, Vie) dont le dessus est en fin de liste
    if (uid === undefined) return zone === 'deck' || zone === 'life' ? avant.players[player].zones[zone].length - 1 - index : index;
    const i = externalIndexOf(s, player, zone, uid);
    assert.ok(i !== null, `carte ${index} de ${zone} introuvable dans le moteur`);
    return i;
  };
  switch (e.kind) {
    case 'move': {
      const top = e.at !== undefined && e.at === avant.players[e.player].zones[e.to].length - (e.from === e.to ? 1 : 0);
      const at = e.to === 'deck' || e.to === 'life' ? (top ? 0 : undefined) : undefined;
      const { at: _ignore, ...rest } = e;
      return { ...rest, index: pos(e.player, e.from, e.index), ...(at !== undefined ? { at } : {}) };
    }
    case 'rest': case 'activate':
      if (e.zone === 'donCost') return { ...e, index: e.kind === 'rest' ? 0 : s.players[e.player].donActive };
      return { ...e, index: e.zone === 'leader' ? 0 : pos(e.player, e.zone, e.index) };
    case 'attachDon': case 'detachDon': case 'power': case 'cost':
      return { ...e, target: pos(e.player, 'deploy', e.target) };
    default:
      return e;
  }
}

function absorber(t: Table, r: CombatResult, avant: Mirror) {
  t.combat = r.combat;
  t.game = r.game;
  t.notes.push(...r.notes);
  for (const e of r.externals) t.game = applyExternal(t.game, versMoteur(e, avant, t.game), { joyboy: JOYBOY });
  for (const l of r.send) {
    t.lots.push(l.map((x) => baseName(x.name)));
    t.envoyes.push(l);
    for (const x of l) echo(t, x);
  }
}

/** L'hôte renvoie l'action de joy-boy à tous : la ClientRpc s'applique au miroir, jamais au moteur. */
function echo(t: Table, x: Rpc) {
  assert.match(x.name, /ServerRpc$/);
  assert.equal(x.object, OBJET[JOYBOY]);
  const c: Rpc = { ...x, name: `${baseName(x.name)}ClientRpc` };
  const r = applyRpc(t.mirror, c, JOYBOY, mirrorOptions(t.combat, t.game));
  t.mirror = r.state;
  const res = handleCombatRpc(t.combat, t.game, c, JOYBOY, r.externals, { mirror: t.mirror, object: OBJET[JOYBOY] });
  assert.deepEqual(res.send, [], 'un écho ne fait rien envoyer');
  t.combat = res.combat;
  t.notes.push(...res.notes);
}

/** Une RPC du joueur OPTCGSim : miroir, combat, puis mutations restantes au moteur. */
function recu(t: Table, name: string, values: Record<string, unknown> = {}) {
  const c: Rpc = { name: `${name}ClientRpc`, object: OBJET[OPTCGSIM], behaviour: 0, values };
  const avant = t.mirror;
  const r = applyRpc(t.mirror, c, OPTCGSIM, mirrorOptions(t.combat, t.game));
  t.mirror = r.state;
  absorber(t, handleCombatRpc(t.combat, t.game, c, OPTCGSIM, r.externals, { mirror: t.mirror, object: OBJET[JOYBOY] }), avant);
}

function repond(t: Table, choix: string | RegExp) {
  const d = t.game.decision;
  assert.ok(d, 'aucune décision');
  const id = typeof choix === 'string' ? choix : d.options.find((o) => choix.test(o.id) || choix.test(o.label))?.id;
  assert.ok(id && d.options.some((o) => o.id === id), `choix ${String(choix)} absent : ${d.options.map((o) => o.id).join(', ')}`);
  assert.ok(routesTo(t.combat, id));
  absorber(t, combatAnswer(t.combat, t.game, id, { mirror: t.mirror, object: OBJET[JOYBOY] }), t.mirror);
}

/** L'attaque d'OPTCGSim, comme dans les fixtures : TapCard, SetupAttack, SelectBlocker. */
function attaqueOptcgsim(t: Table, attaquant: number, cible: number) {
  recu(t, 'TapCard', { iCardIndex: attaquant, clientId: 0 });
  recu(t, 'SetupAttack', { iAttackerIdx: attaquant, iDefenderIdx: cible, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1, clientId: 0 });
  assert.equal(waiting(t.combat, t.game), true, 'joy-boy attend la fin des effets [En attaquant]');
  recu(t, 'SelectBlocker', { bDontQueue: false });
}

const RENDRE = ['AllOnKOResolved', 'SwitchTurns', 'ResetActionPhase', 'NoMorePendingActions'];
const RESOUDRE = ['AllOnKOResolved', 'ResolveAttack'];

/** Le miroir et le moteur voient la même table (nombre de cartes par zone, codes du terrain et de la Défausse). */
function memeTable(t: Table) {
  assert.deepEqual(t.notes, [], 'aucun écart noté');
  assert.deepEqual(t.mirror.errors, [], 'miroir sans écart');
  if (!t.game.decision?.inEffect) assert.deepEqual(invariantErrors(t.game), []);
  for (const p of [0, 1] as Seat[]) {
    const P = t.game.players[p], M = t.mirror.players[p].zones;
    assert.equal(M.life.length, P.life.length, `vies du joueur ${p}`);
    assert.equal(M.hand.length, P.hand.length, `main du joueur ${p}`);
    assert.deepEqual(M.deploy.map((c) => c.code), P.chars.map((c) => c.num), `terrain du joueur ${p}`);
    assert.deepEqual(M.deploy.map((c) => c.rested === true), P.chars.map((c) => c.rested), `Personnages épuisés du joueur ${p}`);
    assert.deepEqual([...M.trash.map((c) => c.code)].sort(), [...P.trash.map((c) => c.num)].sort(), `Défausse du joueur ${p}`);
  }
}

// ---------------------------------------------------------------------------------------------------- arrêt du moteur

test('moteur : en partie croisée, le combat s’arrête avant les dégâts tant que le combat ne l’a pas libéré', () => {
  const t = table({ active: JOYBOY });
  const leader = t.game.players[JOYBOY].leader.uid;
  let s = answerExternal(t.game, `attack:${leader}:${t.game.players[OPTCGSIM].leader.uid}`);
  assert.equal(s.flow.stage, 'battle');
  assert.equal(s.battle?.step, 'damage');
  assert.equal(s.decision, null, 'rien à décider : on attend OPTCGSim');
  assert.equal(s.players[OPTCGSIM].life.length, 5);
  s = structuredClone(s);
  s.battle!.release = true;
  s = advanceShared(s, JOYBOY);
  assert.equal(s.battle, null);
  assert.equal(s.players[OPTCGSIM].life.length, 4, '5000 contre 5000 : touché');
});

// ---------------------------------------------------------------------------------------------------- fixtures

interface FixtureRpc { t: number; name: string; object: number; values: Record<string, unknown> }
const fixture = (j: string): FixtureRpc[] => JSON.parse(fs.readFileSync(ici(`./fixtures/miroir/rpc-2026-11-17-${j}.json`), 'utf8')).rpcs;

/** Lots envoyés par joy-boy (objet 2) après chaque SelectBlocker de l'hôte, jusqu'à la prochaine action de l'hôte. */
function reponsesDeLaFixture(rpcs: FixtureRpc[]): string[][][] {
  const out: string[][][] = [];
  for (let i = 0; i < rpcs.length; i++) {
    if (rpcs[i].name !== 'SelectBlockerClientRpc') continue;
    const lots = new Map<number, string[]>();
    for (let k = i + 1; k < rpcs.length && rpcs[k].object === 2; k++) {
      if (!lots.has(rpcs[k].t)) lots.set(rpcs[k].t, []);
      lots.get(rpcs[k].t)!.push(baseName(rpcs[k].name));
    }
    out.push([...lots.values()]);
  }
  return out;
}

test('fixture du 17 nov. (0859) : défense sans bloqueur, attaque repoussée puis Leader touché, mêmes lots que le jeu', () => {
  const rpcs = fixture('0859');
  const attendus = reponsesDeLaFixture(rpcs);
  assert.deepEqual(attendus, [
    [['NoBlocker'], RESOUDRE],
    [['NoBlocker'], RESOUDRE, RENDRE],
  ], 'ce que le prototype a envoyé (et que le jeu a accepté)');
  const setups = rpcs.filter((r) => r.name === 'SetupAttackClientRpc');
  // 1re attaque : Sabo (OP13-004, −1000 avec 4 Vies ou plus) 4000 contre Luffy 5000 ; 2e : 5 DON!! attachées, 9000
  for (const [n, don] of [[0, 0], [1, 5]] as const) {
    const t = table({ leaders: ['OP13-004', 'ST01-001'], leaderDon: [don, 0] });
    assert.equal(power(t.game, t.game.players[OPTCGSIM].leader.uid), 4000 + 1000 * don);
    const v = setups[n].values;
    recu(t, 'TapCard', { iCardIndex: -1, clientId: 0 });
    recu(t, 'SetupAttack', v);
    recu(t, 'SelectBlocker', { bDontQueue: false });
    assert.deepEqual(t.lots, attendus[n], `attaque ${n + 1}`);
    assert.equal(t.combat.phase, 'idle');
    assert.equal(t.game.players[JOYBOY].life.length, n === 0 ? 5 : 4);
    assert.equal(t.game.flow.stage, 'main');
    assert.equal(t.game.decision?.player, OPTCGSIM, 'la main revient au joueur OPTCGSim');
    memeTable(t);
  }
});

test('options du miroir : puissance, mots-clés et DON!! du catalogue ; pas de puissance du moteur hors combat', () => {
  const o = mirrorOptions(createCombat(), partie());
  assert.equal(o.stats?.('OP13-004')?.power, 5000);
  assert.equal(o.stats?.('OP13-004')?.maxDon, 10);
  assert.deepEqual(o.stats?.('EB04-023')?.keywords, ['Double Attack']);
  assert.equal(o.power?.(createMirror(), 0, { code: 'OP13-004', iid: 1 }, true), undefined, 'hors combat : pas de puissance du moteur');
});

// ---------------------------------------------------------------------------------------------------- joy-boy défend

test('défense : bloqueur et contre de joy-boy, le bloqueur est mis KO, la main est rendue', () => {
  const t = table({
    hand: [[], ['OP07-107', 'OP04-077']],
    chars: [[{ num: 'EB04-023' }], [{ num: 'OP04-077' }]],  // Chaka et Pell 9000 [Double attaque] ; Ideo 2000 [Bloqueur]
  });
  attaqueOptcgsim(t, 0, -1);
  assert.equal(t.game.decision?.kind, 'blocker');
  assert.equal(t.game.decision?.player, JOYBOY);
  assert.equal(waiting(t.combat, t.game), false);
  repond(t, /^block:/);
  assert.deepEqual(t.lots, [['SetBlocker']]);
  assert.equal(t.envoyes[0][0].values.iBlockerIdx, 0);
  assert.equal(t.game.decision?.kind, 'counter');
  repond(t, (() => { const u = t.game.players[JOYBOY].hand.find((c) => c.num === 'OP07-107')!.uid; return `counter:${u}`; })());
  assert.deepEqual(t.lots.at(-1), ['MoveHandCardToDiscard', 'AddCounterAmount']);
  assert.equal(t.envoyes.at(-1)![0].values.iCardIdx, 0, 'Franky, 1re carte de la main OPTCGSim');
  assert.equal(t.envoyes.at(-1)![1].values.iCounter, 2000);
  assert.equal(t.mirror.battle?.counter, 2000);
  repond(t, 'pass');
  // 9000 contre 2000 + 2000 : le bloqueur est mis KO ; le défenseur rend la main
  assert.deepEqual(t.lots.slice(2), [RESOUDRE, RENDRE]);
  assert.equal(t.game.players[JOYBOY].chars.length, 0);
  assert.equal(t.game.players[JOYBOY].life.length, 5, 'le bloqueur a pris le coup');
  assert.equal(t.combat.phase, 'idle');
  memeTable(t);
});

test('défense : contre suffisant, attaque repoussée, rien de plus à envoyer', () => {
  const t = table({ hand: [[], ['OP07-107', 'OP07-107']] });  // leader OPTCGSim 5000 contre 5000 + 4000
  attaqueOptcgsim(t, -1, -1);
  assert.deepEqual(t.lots, [['NoBlocker']], 'pas de bloqueur : NoBlocker envoyé d’office');
  // plus de contre en main après le second : le moteur passe aux dégâts, le combat résout aussitôt
  for (let i = 0; i < 2; i++) repond(t, /^counter:/);
  assert.deepEqual(t.lots, [['NoBlocker'], ['MoveHandCardToDiscard', 'AddCounterAmount'], ['MoveHandCardToDiscard', 'AddCounterAmount'], RESOUDRE]);
  assert.equal(t.game.players[JOYBOY].life.length, 5);
  assert.equal(t.combat.phase, 'idle');
  memeTable(t);
});

test('défense : [Déclenchement] activé (pioche), la carte part en Défausse, puis la main est rendue', () => {
  const t = table({ life: [['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'], ['OP06-078', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077']] });
  attaqueOptcgsim(t, -1, -1);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE]);
  assert.equal(t.game.decision?.tag, 'trigger', 'GERMA 66 : [Déclenchement] proposé');
  assert.equal(t.combat.step, 'trigger');
  repond(t, 'trigger');
  // le moteur pioche (outbound enverra DrawCard) ; le combat envoie la carte en Défausse puis rend la main
  assert.deepEqual(t.lots.slice(2), [['MoveHandCardToDiscard'], RENDRE]);
  const P = t.game.players[JOYBOY];
  assert.equal(P.life.length, 4);
  assert.equal(P.trash.at(-1)?.num, 'OP06-078');
  assert.equal(t.mirror.players[JOYBOY].zones.trash.at(-1)?.code, 'OP06-078');
  // la pioche du [Déclenchement] vient d'outbound : ici, seul ce qui reste à traduire diffère (1 carte en main)
  assert.equal(P.hand.length, t.mirror.players[JOYBOY].zones.hand.length + 1);
});

test('défense : [Déclenchement] refusé, la carte reste en main, la main est rendue', () => {
  const t = table({ life: [['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'], ['OP06-078', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077']] });
  attaqueOptcgsim(t, -1, -1);
  repond(t, 'hand');
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, RENDRE]);
  assert.equal(t.game.players[JOYBOY].hand.at(-1)?.num, 'OP06-078');
  memeTable(t);
});

test('défense : double attaque, la seconde vie est prise après le premier déclenchement (TriggerEnd_DoubleAttack)', () => {
  // sans [Déclenchement] : tout part d'un coup
  let t = table({ chars: [[{ num: 'EB04-023' }], []] });
  attaqueOptcgsim(t, 0, -1);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, ['PlayerDrawLife', 'MoveToSecondLifeTrigger'], RENDRE]);
  assert.equal(t.game.players[JOYBOY].life.length, 3);
  memeTable(t);
  // [Déclenchement] sur la seconde vie : elle est prise avant que la question soit posée
  t = table({ chars: [[{ num: 'EB04-023' }], []], life: [['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'], ['OP04-077', 'OP06-078', 'OP04-077', 'OP04-077', 'OP04-077']] });
  attaqueOptcgsim(t, 0, -1);
  assert.equal(t.game.decision?.tag, 'trigger');
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, ['PlayerDrawLife', 'MoveToSecondLifeTrigger']]);
  repond(t, 'hand');
  assert.deepEqual(t.lots.at(-1), RENDRE);
  memeTable(t);
  // [Déclenchement] sur les deux vies : la seconde vie part entre les deux questions
  t = table({ chars: [[{ num: 'EB04-023' }], []], life: [['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'], ['OP06-078', 'OP06-078', 'OP04-077', 'OP04-077', 'OP04-077']] });
  attaqueOptcgsim(t, 0, -1);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE]);
  repond(t, 'hand');
  assert.deepEqual(t.lots.at(-1), ['PlayerDrawLife', 'MoveToSecondLifeTrigger']);
  assert.equal(t.game.decision?.tag, 'trigger');
  repond(t, 'hand');
  assert.deepEqual(t.lots.at(-1), RENDRE);
  memeTable(t);
});

test('défense : [Exil], les vies vont en Défausse, pas de phase de déclenchement', () => {
  const t = table({ chars: [[{ num: 'OP10-030' }], []], life: [['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'], ['OP06-078', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077']] });
  attaqueOptcgsim(t, 0, -1);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, RENDRE]);
  assert.equal(t.game.players[JOYBOY].trash.at(-1)?.num, 'OP06-078');
  memeTable(t);
});

test('défense : Personnage attaqué et mis KO, la main est rendue ; attaque annulée par OPTCGSim', () => {
  let t = table({ chars: [[{ num: 'EB04-023' }], [{ num: 'OP04-077', rested: true }]] });
  attaqueOptcgsim(t, 0, 0);
  assert.deepEqual(t.lots, [['NoBlocker'], RESOUDRE, RENDRE]);
  assert.equal(t.game.players[JOYBOY].trash.at(-1)?.num, 'OP04-077');
  memeTable(t);
  t = table({ chars: [[{ num: 'EB04-023' }], []] });
  recu(t, 'TapCard', { iCardIndex: 0 });
  recu(t, 'SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1 });
  recu(t, 'AllOnKOResolved');
  recu(t, 'ResolveNoAttackFromAttackerSide');
  assert.equal(t.combat.phase, 'idle');
  assert.equal(t.game.battle, null);
  assert.equal(t.game.decision?.kind, 'main');
  assert.deepEqual(t.lots, []);
});

// ---------------------------------------------------------------------------------------------------- joy-boy attaque

const attaqueJoyboy = (t: Table, attaquant: number, cible: number) => repond(t, `attack:${attaquant}:${cible}`);

test('attaque : TapCard, SetupAttack, SelectBlocker ; contre d’OPTCGSim, ResolveAttack : repoussée, la main revient', () => {
  const t = table({ active: JOYBOY, hand: [['OP07-107', 'OP04-077'], []] });
  const P = t.game.players;
  attaqueJoyboy(t, P[JOYBOY].leader.uid, P[OPTCGSIM].leader.uid);
  assert.deepEqual(t.lots, [['TapCard'], ['SetupAttack'], ['SelectBlocker']]);
  assert.deepEqual(t.envoyes[1][0].values, { iAttackerIdx: -1, iDefenderIdx: -1, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1 });
  assert.equal(waiting(t.combat, t.game), true, 'joy-boy attend la défense d’OPTCGSim');
  recu(t, 'NoBlocker');
  recu(t, 'MoveHandCardToDiscard', { iCardIdx: 0, clientId: 0 });
  recu(t, 'AddCounterAmount', { iCounter: 2000 });
  assert.equal(power(t.game, t.game.players[OPTCGSIM].leader.uid), 7000);
  recu(t, 'AllOnKOResolved');
  recu(t, 'ResolveAttack');
  assert.equal(t.combat.phase, 'idle');
  assert.equal(t.game.players[OPTCGSIM].life.length, 5);
  assert.equal(t.game.decision?.kind, 'main');
  assert.equal(t.game.decision?.player, JOYBOY);
  assert.equal(waiting(t.combat, t.game), false);
  memeTable(t);
});

test('attaque : Leader OPTCGSim touché ; son [Déclenchement] est son affaire ; la main revient après NoMorePendingActions', () => {
  const t = table({ active: JOYBOY, leaderDon: [0, 1], life: [['OP06-078', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077'], ['OP04-077', 'OP04-077', 'OP04-077', 'OP04-077', 'OP04-077']] });
  const P = t.game.players;
  attaqueJoyboy(t, P[JOYBOY].leader.uid, P[OPTCGSIM].leader.uid);
  recu(t, 'NoBlocker');
  recu(t, 'AllOnKOResolved');
  recu(t, 'ResolveAttack');
  assert.equal(t.game.players[OPTCGSIM].life.length, 4);
  assert.equal(t.game.players[OPTCGSIM].hand.at(-1)?.num, 'OP06-078', 'la carte de Vie en main : le moteur ne résout pas le [Déclenchement] adverse');
  assert.equal(t.combat.step, 'handBack');
  assert.equal(waiting(t.combat, t.game), true);
  for (const n of RENDRE) recu(t, n);
  assert.equal(t.combat.phase, 'idle');
  assert.equal(waiting(t.combat, t.game), false);
  memeTable(t);
});

test('attaque : double attaque sur le Leader OPTCGSim, sa seconde vie (PlayerDrawLife) n’est pas comptée deux fois', () => {
  const t = table({ active: JOYBOY, chars: [[], [{ num: 'EB04-023' }]] });
  const P = t.game.players;
  attaqueJoyboy(t, P[JOYBOY].chars[0].uid, P[OPTCGSIM].leader.uid);
  assert.equal(t.envoyes[0][0].values.iCardIndex, 0);
  recu(t, 'NoBlocker');
  recu(t, 'AllOnKOResolved');
  recu(t, 'ResolveAttack');
  assert.equal(t.game.players[OPTCGSIM].life.length, 3, 'le moteur prend les deux vies');
  assert.equal(t.mirror.players[OPTCGSIM].zones.life.length, 4, 'OPTCGSim la seconde plus tard');
  assert.deepEqual(t.notes, []);
  recu(t, 'AllOnKOResolved'); recu(t, 'SwitchTurns');
  recu(t, 'PlayerDrawLife', { iCount: 1, clientId: 0 });
  recu(t, 'MoveToSecondLifeTrigger');
  for (const n of RENDRE) recu(t, n);
  assert.equal(t.combat.phase, 'idle');
  memeTable(t);
});

test('attaque : OPTCGSim bloque (SetBlocker), le bloqueur est mis KO des deux côtés', () => {
  const t = table({ active: JOYBOY, chars: [[{ num: 'OP04-077' }], [{ num: 'EB04-023' }]] });
  const P = t.game.players;
  attaqueJoyboy(t, P[JOYBOY].chars[0].uid, P[OPTCGSIM].leader.uid);
  assert.equal(t.game.decision?.kind, 'blocker', 'le moteur propose le bloqueur au joueur OPTCGSim');
  assert.equal(t.game.decision?.player, OPTCGSIM);
  recu(t, 'SetBlocker', { iBlockerIdx: 0, clientId: 0 });
  assert.equal(t.game.battle?.target, t.game.players[OPTCGSIM].chars[0].uid);
  assert.equal(t.game.players[OPTCGSIM].chars[0].rested, true);
  recu(t, 'AllOnKOResolved');
  recu(t, 'ResolveAttack');
  assert.equal(t.game.players[OPTCGSIM].chars.length, 0);
  assert.equal(t.game.players[OPTCGSIM].life.length, 5);
  for (const n of RENDRE) recu(t, n);
  memeTable(t);
});

test('attaque : effet [En attaquant] avec question, SelectBlocker seulement après la réponse ; [Imblocable]', () => {
  // OP16-104 Catarina Devon : [En attaquant] choisissez jusqu'à 1 Personnage adverse…
  let t = table({ active: JOYBOY, chars: [[{ num: 'OP04-077' }], [{ num: 'OP16-104' }]] });
  let P = t.game.players;
  attaqueJoyboy(t, P[JOYBOY].chars[0].uid, P[OPTCGSIM].leader.uid);
  assert.equal(t.game.decision?.inEffect && t.game.decision.player, JOYBOY, 'question de l’effet [En attaquant]');
  assert.deepEqual(t.lots, [['TapCard'], ['SetupAttack', 'MoveToBlocker']]);
  assert.equal(waiting(t.combat, t.game), false, 'une question de joy-boy : elle lui est présentée');
  repond(t, t.game.decision!.options[0].id);
  assert.deepEqual(t.lots.at(-1), ['SelectBlocker']);
  assert.equal(t.combat.step, 'block');
  assert.equal(waiting(t.combat, t.game), true);
  // OP16-032 Boa Hancock [Imblocable] : les bornes de SetupAttack interdisent tout bloqueur, le moteur n'en propose pas
  t = table({ active: JOYBOY, chars: [[{ num: 'OP04-077' }], [{ num: 'OP16-032' }]] });
  P = t.game.players;
  attaqueJoyboy(t, P[JOYBOY].chars[0].uid, P[OPTCGSIM].leader.uid);
  assert.deepEqual(t.envoyes[1][0].values, { iAttackerIdx: 0, iDefenderIdx: -1, iBlockerMustBeSmaller: -2000000, iBlockerMustBeLarger: 2000000, iBlockerMustCostMore: -1000000 });
  assert.notEqual(t.game.decision?.kind, 'blocker');
});

test('sans uid dans le miroir : positions retrouvées par le code des cartes (bloqueur, contre)', () => {
  const t = table({ hand: [[], ['OP04-077', 'OP07-107']], chars: [[{ num: 'EB04-023' }], [{ num: 'OP04-077' }]] });
  for (const p of t.mirror.players) for (const z of Object.values(p.zones)) for (const c of z) delete c.uid;
  attaqueOptcgsim(t, 0, -1);
  repond(t, /^block:/);
  assert.equal(t.envoyes[0][0].values.iBlockerIdx, 0);
  repond(t, `counter:${t.game.players[JOYBOY].hand.find((c) => c.num === 'OP07-107')!.uid}`);
  assert.equal(t.envoyes.at(-1)![0].values.iCardIdx, 1, 'Franky est la 2e carte de la main OPTCGSim');
  assert.equal(t.mirror.players[JOYBOY].zones.trash.at(0)?.code, 'OP07-107');
});

test('les écarts entre le moteur et OPTCGSim sont notés, jamais levés', () => {
  // le miroir croit le Personnage OPTCGSim immunisé au combat : il le garde, le moteur le met KO
  const t = table({ active: JOYBOY, chars: [[{ num: 'OP04-077', rested: true }], [{ num: 'EB04-023' }]] });
  t.mirror.players[OPTCGSIM].zones.deploy[0].flags = { GrantCardCombatImmune: true };
  const P = t.game.players;
  attaqueJoyboy(t, P[JOYBOY].chars[0].uid, P[OPTCGSIM].chars[0].uid);
  recu(t, 'NoBlocker');
  recu(t, 'ResolveAttack');
  assert.ok(t.notes.some((n) => /écart au combat/.test(n)), t.notes.join(' | '));
  assert.equal(t.game.players[OPTCGSIM].chars.length, 0);
});
