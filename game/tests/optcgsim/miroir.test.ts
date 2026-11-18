// Miroir des zones OPTCGSim (tâche O1.2) : ordre exact des zones, variantes « Opponent », DON, bonus, combat, et rejeu
// des parties réelles (fixtures anonymisées du 17 nov. et extraits RZ1 de CombatLogs\AutoSaved).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cardData } from '../../engine/cards/index.ts';
import {
  applyAll, applyRpc, cardAt, counts, createMirror, knownRpcs, type Mirror, type MirrorCardX, type MirrorExternal, type MirrorOptions,
} from '../../online/optcgsim/mirror.ts';
import type { Rpc, Seat } from '../../online/optcgsim/types.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const outil = async (): Promise<any> => import(new URL('../../../scripts/optcgsim/rejouer-rz1.mjs', import.meta.url).href);
const rpc = (name: string, values: Record<string, unknown> = {}): Rpc => ({ name: `${name}ClientRpc`, object: 1, behaviour: 0, values });

/** Applique une suite [nom, valeurs, envoyeur] et rend l'état final et les mutations. */
function jouer(s: Mirror, coups: [string, Record<string, unknown>, Seat][], options: MirrorOptions = {}) {
  return applyAll(s, coups.map(([n, v, sender]) => ({ rpc: rpc(n, v), sender })), options);
}
const codes = (s: Mirror, seat: Seat, zone: keyof Mirror['players'][0]['zones']) => s.players[seat].zones[zone].map((c) => c.code);

/** Deux joueurs avec un deck connu : A01…A10 pour le siège 0, B01…B10 pour le siège 1 (A10 / B10 au-dessus). */
function table(): Mirror {
  let s = createMirror();
  for (const [seat, l] of [[0, 'A'], [1, 'B']] as const) {
    s = jouer(s, [['MakeEmptyDeckList', { iDeckSize: 10 }, seat], ['LoadLeader', { sCardID: `${l}-LEADER`, sPlayerName: `Joueur${l}` }, seat]]).state;
    for (let i = 0; i < 10; i++) s = applyRpc(s, rpc('LoadDeckCard', { sCardID: `${l}${String(i + 1).padStart(2, '0')}`, iIdx: i }), seat).state;
  }
  return jouer(s, [['ChooseTurnOrder', { iFirst: 1 }, 0]]).state;
}

test('table vide : un leader et 10 DON par joueur, comme le jeu avant la mise en place', () => {
  const s = createMirror();
  for (const seat of [0, 1] as const) {
    assert.deepEqual(counts(s, seat), { deck: 0, hand: 0, deploy: 0, life: 0, donDeck: 10, donCost: 0, trash: 0, stage: 0, leader: 1, attachedDon: 0 });
  }
  assert.equal(s.players[0].leader, s.players[0].zones.leader[0]);
});

test('mise en place : deck chargé par indice, leader, nom, premier joueur vu de celui qui reçoit', () => {
  const s = table();
  assert.equal(s.players[0].leader.code, 'A-LEADER');
  assert.equal(s.players[1].name, 'JoueurB');
  assert.equal(codes(s, 0, 'deck')[9], 'A10');
  assert.equal(s.first, 0, 'iFirst = 1 : l’envoyeur commence');
  assert.equal(jouer(table(), [['ChooseTurnOrder', { iFirst: 0 }, 0]]).state.first, 1);
  assert.equal(s.turn, 1);
});

test('pioche, main, terrain, défausse : dessus = fin de liste, arrivées en fin de liste', () => {
  const { state: s, externals } = jouer(table(), [
    ['DrawCard', { iCount: 3 }, 0], ['MoveHandCardToDeploy', { iIdx: 1, bRested: false }, 0],
    ['MoveHandCardToDiscard', { iCardIdx: 0 }, 0], ['DrawSpecificCard', { iCardIndex: 0 }, 0], ['MillCard', { iCount: 1 }, 0],
  ]);
  assert.deepEqual(codes(s, 0, 'hand'), ['A08', 'A01']);
  assert.deepEqual(codes(s, 0, 'deploy'), ['A09']);
  assert.deepEqual(codes(s, 0, 'trash'), ['A10', 'A07']);
  assert.deepEqual(codes(s, 0, 'deck'), ['A02', 'A03', 'A04', 'A05', 'A06']);
  assert.deepEqual(externals[0], { kind: 'move', player: 0, from: 'deck', index: 9, to: 'hand', at: 0 });
  assert.deepEqual(externals[3], { kind: 'move', player: 0, from: 'hand', index: 1, to: 'deploy', at: 0, rested: false });
  assert.deepEqual(codes(s, 1, 'hand'), [], 'l’autre joueur n’a pas bougé');
});

test('les variantes « Opponent » agissent sur les zones de l’autre joueur', () => {
  const { state: s } = jouer(table(), [
    ['DrawCardOpponent', { iCount: 2 }, 0], ['MoveOpponentHandCardToDiscard', { iCardIdx: 0 }, 0], ['DrawDonForOpponent', { iCount: 2 }, 0],
    ['TapOpponentDon', { iCount: 1 }, 0], ['PopulateOpponentLifeDeck', { iLifeCount: 2 }, 0],
  ]);
  assert.deepEqual(codes(s, 1, 'hand'), ['B09']);
  assert.deepEqual(codes(s, 1, 'trash'), ['B10']);
  assert.deepEqual(codes(s, 1, 'life'), ['B08', 'B07'], 'vie du dessus = dernière');
  assert.deepEqual(s.players[1].zones.donCost.map((d) => d.rested === true), [true, false]);
  assert.equal(counts(s, 0).hand, 0);
});

test('mélange : nouvelle[j] = ancienne[ordre[j]], rendu au moteur ; mulligan remet la main sur le deck', () => {
  const { state: s, externals } = jouer(table(), [
    ['DrawCard', { iCount: 2 }, 1], ['MoveHandToDeck', {}, 1], ['ShuffleDeck', { s_ShuffleString: '9-8-7-6-5-4-3-2-1-0' }, 1],
  ]);
  assert.deepEqual(codes(s, 1, 'deck'), ['B09', 'B10', 'B08', 'B07', 'B06', 'B05', 'B04', 'B03', 'B02', 'B01']);
  assert.deepEqual(externals.at(-1), { kind: 'shuffle', player: 1, order: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] });
  const faux = jouer(table(), [['ShuffleDeck', { s_ShuffleString: '0-0-1' }, 1]]).state;
  assert.equal(faux.errors.length, 1, 'mélange invalide noté, sans lever d’erreur');
});

test('DON : pioche active en fin, inclinées en tête, ordre d’inclinaison et de redressement du jeu', () => {
  let { state: s } = jouer(table(), [['DrawDon', { iCount: 3 }, 0], ['DrawRestedDon', { iCount: 1 }, 0]]);
  const etat = () => s.players[0].zones.donCost.map((d) => (d.rested ? 'I' : 'A') + (d.frozen ? 'g' : ''));
  assert.deepEqual(etat(), ['I', 'A', 'A', 'A']);
  s = jouer(s, [['TapDon', { iCount: 2 }, 0]]).state;
  assert.deepEqual(etat(), ['I', 'I', 'I', 'A'], 'TapDon prend les premières actives');
  s = jouer(s, [['FreezeSelfDonCard', { iCount: 1 }, 0], ['UntapDon', { iCount: 1 }, 0]]).state;
  assert.deepEqual(etat(), ['Ag', 'I', 'I', 'A'], 'UntapDon redresse d’abord une gelée (qui reste gelée), en partant de la fin');
  s = jouer(s, [['ReturnDon', { iDonIdx: 0 }, 0]]).state;
  assert.equal(counts(s, 0).donDeck, 7);
});

test('DON attachées : attacher, détacher, rendre, transférer ; rendues inclinées quand la carte quitte le terrain', () => {
  let { state: s, externals } = jouer(table(), [
    ['DrawDon', { iCount: 4 }, 0], ['DrawCard', { iCount: 1 }, 0], ['MoveHandCardToDeploy', { iIdx: 0, bRested: false }, 0],
    ['AttachDonToCard', { iCardIdx: -1, iDonIdx: 3 }, 0], ['AttachDonToCard', { iCardIdx: 0, iDonIdx: 0 }, 0],
    ['AttachDonToCard', { iCardIdx: 0, iDonIdx: 0 }, 0],
  ]);
  assert.equal(s.players[0].leader.attachedDon, 1);
  assert.equal(s.players[0].zones.deploy[0].attachedDon, 2);
  assert.deepEqual(externals.at(-1), { kind: 'attachDon', player: 0, target: 0, donIndex: 0, rested: false });
  s = jouer(s, [['TransferAttachedDon', { iCardIdx: -1, iSourceIdx: 0 }, 0], ['DetachDonFromCard', { iCardIdx: -1, iDonIdx: 1 }, 0]]).state;
  assert.equal(s.players[0].leader.attachedDon, 1);
  assert.equal(s.players[0].zones.donCost[0].rested, true, 'DON détachée : inclinée, en tête');
  s = jouer(s, [['ReturnDonFromCard', { iCardIdx: -1, iDonIdx: 0 }, 0], ['DiscardFromSelfDeploy', { iCardIndex: 0 }, 0]]).state;
  assert.equal(counts(s, 0).attachedDon, 0);
  assert.equal(counts(s, 0).donDeck, 7);
  assert.equal(counts(s, 0).donCost, 3);
  assert.equal(s.players[0].zones.donCost.filter((d) => d.rested).length, 2, 'la DON du Personnage mis en défausse revient inclinée');
});

test('fin de tour : DON rendues, redressement sauf gel, tour suivant pour l’autre joueur', () => {
  let s = jouer(table(), [
    ['DrawDon', { iCount: 2 }, 1], ['DrawCard', { iCount: 2 }, 1], ['MoveHandCardToDeploy', { iIdx: 0, bRested: false }, 1],
    ['MoveHandCardToDeploy', { iIdx: 0, bRested: true }, 1], ['AttachDonToCard', { iCardIdx: 0, iDonIdx: 0 }, 1],
    ['TapCard', { iCardIndex: 0 }, 1], ['FreezeCard', { iCardIndex: 1 }, 1], ['TapDon', { iCount: 1 }, 1],
  ]).state;
  s = jouer(s, [['EndTurn', {}, 1]]).state;
  assert.equal(s.turnPlayer, 0);
  const { state, externals }: { state: Mirror; externals: MirrorExternal[] } = jouer(s, [['EndTurn', {}, 0]]);
  assert.deepEqual(externals[0], { kind: 'turn', to: 1 });
  assert.equal(state.turnPlayer, 1);
  assert.equal(state.turn, 3);
  const deploy = state.players[1].zones.deploy;
  assert.equal(deploy[0].rested, undefined, 'redressé');
  assert.equal(deploy[0].attachedDon, undefined, 'DON rendue');
  assert.equal(deploy[1].rested, true, 'gelé : reste incliné une fois');
  assert.equal(deploy[1].frozen, undefined);
  assert.deepEqual(state.players[1].zones.donCost.map((d) => d.rested === true), [false, false]);
});

test('bonus : échéances du jeu, réémis au moteur tant qu’ils durent plus d’un tour', () => {
  let { state: s, externals } = jouer(table(), [
    ['DrawCard', { iCount: 1 }, 0], ['MoveHandCardToDeploy', { iIdx: 0, bRested: false }, 0],
    ['BuffCardPower', { iCardIndex: 0, iBuff: 1000 }, 0], ['BuffCardToStart', { iCardIndex: -1, iBuff: 2000 }, 0],
    ['ChangeOpponentCardCost', { iDeployIdx: -1, iChange: -1 }, 1], ['SetMyCardCost', { iDeployIdx: 0, iChange: 3 }, 0],
  ]);
  assert.deepEqual(externals.slice(-4), [
    { kind: 'power', player: 0, target: 0, delta: 1000, until: 'turn' },
    { kind: 'power', player: 0, target: -1, delta: 2000, until: 'turn' },
    { kind: 'cost', player: 0, target: -1, delta: -1, until: 'turn' },
    { kind: 'cost', player: 0, target: 0, delta: 3, until: 'turn' },
  ]);
  ({ state: s, externals } = jouer(s, [['EndTurn', {}, 0]]));
  assert.equal(s.players[0].zones.deploy[0].mods?.some((m) => m.kind === 'power'), false, 'bonus du tour échu');
  assert.deepEqual(externals.filter((e) => e.kind === 'power'), [{ kind: 'power', player: 0, target: -1, delta: 2000, until: 'turn' }],
    'le bonus « jusqu’au début de ton tour » est réémis pour le tour adverse');
  ({ state: s, externals } = jouer(s, [['EndTurn', {}, 1]]));
  assert.equal(s.players[0].leader.mods?.some((m) => m.kind === 'power'), false, 'échu au début du tour du propriétaire');
  assert.ok(externals.some((e) => e.kind === 'cost' && e.target === 0 && e.delta === 3), 'le coût fixé dure tant que la carte reste');
  s = jouer(s, [['ReturnCardToMyHand', { iDeployIdx: 0 }, 0]]).state;
  assert.equal(s.players[0].zones.hand.at(-1)?.mods, undefined, 'effets effacés en quittant le terrain');
});

const stats = (code: string) => ({
  'A-LEADER': { power: 5000 }, 'B-LEADER': { power: 5000 }, A07: { power: 6000, keywords: ['Double Attack'] }, B07: { power: 3000 }, B06: { power: 4000, keywords: ['Blocker'] },
} as Record<string, { power: number; keywords?: string[] }>)[code];

/** 3 vies chacun ; A (siège 0) a A06 (puissance inconnue) sur le terrain et A07 en main ; B a B07 (incliné) et B06. */
function combat(): Mirror {
  return jouer(table(), [
    ['PopulateLifeDeck', { iLifeCount: 3 }, 0], ['PopulateLifeDeck', { iLifeCount: 3 }, 1],
    ['DrawCard', { iCount: 2 }, 0], ['MoveHandCardToDeploy', { iIdx: 1, bRested: false }, 0],
    ['DrawCard', { iCount: 2 }, 1], ['MoveHandCardToDeploy', { iIdx: 0, bRested: true }, 1], ['MoveHandCardToDeploy', { iIdx: 0, bRested: false }, 1],
    ['DrawDon', { iCount: 2 }, 0],
  ]).state;
}

test('combat : attaque repoussée, vie perdue, Personnage mis KO, contre et bloqueur', () => {
  const s0 = combat();
  assert.deepEqual(codes(s0, 1, 'deploy'), ['B07', 'B06']);
  assert.deepEqual(codes(s0, 1, 'life'), ['B10', 'B09', 'B08']);
  assert.equal(cardAt(s0, 0, 'deploy', 0)?.code, 'A06');
  // Leader A (5000) contre leader B (5000) + 1000 de contre : repoussée.
  let r = jouer(s0, [['TapCard', { iCardIndex: -1 }, 0], ['SetupAttack', { iAttackerIdx: -1, iDefenderIdx: -1 }, 0], ['AddCounterAmount', { iCounter: 1000 }, 1], ['ResolveAttack', {}, 1]], { stats });
  assert.equal(counts(r.state, 1).life, 3);
  assert.equal(r.state.battle, undefined);
  assert.equal(r.state.actingPlayer, 0, 'la main revient à l’attaquant');
  // Avec une DON attachée : 6000 ≥ 5000, la vie du dessus va en main.
  r = jouer(s0, [['AttachDonToCard', { iCardIdx: -1, iDonIdx: 0 }, 0], ['SetupAttack', { iAttackerIdx: -1, iDefenderIdx: -1 }, 0], ['ResolveAttack', {}, 1]], { stats });
  assert.equal(counts(r.state, 1).life, 2);
  assert.deepEqual(codes(r.state, 1, 'hand'), ['B08']);
  assert.deepEqual(r.externals.at(-1), { kind: 'move', player: 1, from: 'life', index: 2, to: 'hand', at: 0 });
  // Bloqueur B06 : A06 sans puissance connue → combat non résolu, écart noté.
  r = jouer(s0, [['SetupAttack', { iAttackerIdx: 0, iDefenderIdx: -1 }, 0], ['SetBlocker', { iBlockerIdx: 1 }, 1], ['ResolveAttack', {}, 1]], { stats });
  assert.equal(r.state.players[1].zones.deploy[1].rested, true, 'le bloqueur s’incline');
  assert.match(r.state.errors.join(), /puissance inconnue/);
  // Calcul de puissance fourni (effets passifs compris) : il fait foi.
  r = jouer(s0, [['SetupAttack', { iAttackerIdx: 0, iDefenderIdx: 0 }, 0], ['ResolveAttack', {}, 1]], { stats, power: (_s, _seat, c) => (c.code === 'A06' ? 3000 : undefined) });
  assert.deepEqual(codes(r.state, 1, 'trash'), ['B07'], 'Personnage incliné mis KO');
  assert.deepEqual(codes(r.state, 1, 'deploy'), ['B06']);
});

test('combat : double attaque, bannissement, défaite sans vie', () => {
  let s = jouer(combat(), [['MoveHandCardToDeploy', { iIdx: 0, bRested: false }, 0]]).state;
  assert.equal(cardAt(s, 0, 'deploy', 1)?.code, 'A07');
  let r = jouer(s, [['SetupAttack', { iAttackerIdx: 1, iDefenderIdx: -1 }, 0], ['ResolveAttack', {}, 1]], { stats });
  assert.equal(counts(r.state, 1).life, 2, 'double attaque : une vie à la résolution');
  r = jouer(r.state, [['PlayerDrawLife', { iCount: 1 }, 1], ['MoveToSecondLifeTrigger', {}, 1]], { stats });
  assert.equal(counts(r.state, 1).life, 1, 'la seconde après le premier déclenchement (TriggerEnd_DoubleAttack)');
  assert.equal(counts(r.state, 1).hand, 2);
  s = jouer(s, [['GrantCardBanish', { iDeployIdx: 1, bBanish: true }, 0]]).state;
  r = jouer(s, [['SetupAttack', { iAttackerIdx: 1, iDefenderIdx: -1 }, 0], ['ResolveAttack', {}, 1]], { stats });
  assert.equal(counts(r.state, 1).trash, 2, 'bannissement : les vies vont en défausse');
  r = jouer(r.state, [['SetupAttack', { iAttackerIdx: 1, iDefenderIdx: -1 }, 0], ['ResolveAttack', {}, 1],
    ['SetupAttack', { iAttackerIdx: 1, iDefenderIdx: -1 }, 0], ['ResolveAttack', {}, 1]], { stats });
  assert.deepEqual(r.state.over, { loser: 1, reason: 'touché sans vie' });
});

test('RPC incohérente ou inconnue : notée, jamais levée ; l’état d’entrée n’est pas modifié', () => {
  const s = table();
  const r = jouer(s, [['MoveHandCardToDeploy', { iIdx: 4, bRested: false }, 0], ['RpcQuiNExistePas', {}, 0]]);
  assert.equal(r.state.errors.length, 1);
  assert.deepEqual(r.state.unhandled, { RpcQuiNExistePas: 1 });
  assert.deepEqual(r.externals, []);
  assert.equal(s.errors.length, 0);
  assert.equal(applyRpc(s, { ...rpc('DrawCard', { iCount: 1 }), name: 'DrawCardServerRpc' }, 0).state.players[0].zones.hand.length, 1, 'forme ServerRpc acceptée');
});

test('les 245 RPC client du jeu (1.45b) sont classées (table, état, combat, tour ou sans effet)', () => {
  const k = knownRpcs();
  assert.equal(Object.keys(k).length, 245);
  const catalogue = JSON.parse(fs.readFileSync(ici('../../online/optcgsim/catalog.json'), 'utf8')) as Record<string, { nom?: string }>;
  const clients = Object.values(catalogue).map((r) => r?.nom).filter((n): n is string => typeof n === 'string' && n.endsWith('ClientRpc'));
  // Le catalogue est rempli par la tâche O1.1 : dès qu'il est là, chacune de ses RPC client doit être connue du miroir.
  for (const n of clients) assert.ok(n.replace(/ClientRpc$/, '') in k, n);
});

// ---------------------------------------------------------------------------------------------------- parties réelles

interface FixtureRpc { name: string; object: number; values: Record<string, unknown> }
const lireRpcs = (j: string): FixtureRpc[] => JSON.parse(fs.readFileSync(ici(`./fixtures/miroir/rpc-2026-11-17-${j}.json`), 'utf8')).rpcs;
const catalogueStats = (code: string) => { const d = cardData()[code]; return d ? { power: d.power, keywords: d.keywords } : undefined; };
/** Sabo (OP13-004) : −1000 avec 4 vies ou plus (effet passif, calculé par le jeu de chaque côté). */
const puissanceSabo: MirrorOptions['power'] = (s, seat, c, attaque) => (c.code !== 'OP13-004' ? undefined
  : 5000 - (s.players[seat].zones.life.length >= 4 ? 1000 : 0) + (attaque ? 1000 * (c.attachedDon ?? 0) : 0));

function rejouerFixture(j: string): Mirror {
  let s = createMirror();
  for (const r of lireRpcs(j)) s = applyRpc(s, { ...r, behaviour: 0 }, r.object === 1 ? 0 : 1, { stats: catalogueStats, power: puissanceSabo }).state;
  return s;
}

test('fixtures du 17 nov. : toutes les RPC reçues sont connues et se rejouent sans écart', () => {
  for (const j of ['0841', '0859']) {
    const s = rejouerFixture(j);
    assert.deepEqual(s.errors, [], j);
    assert.deepEqual(s.unhandled, {}, j);
    assert.deepEqual(s.over, { loser: 0, reason: 'abandon' }, `${j} : l’hôte abandonne`);
  }
  const a = rejouerFixture('0841');
  assert.deepEqual(counts(a, 0), { deck: 31, hand: 5, deploy: 4, life: 5, donDeck: 5, donCost: 4, trash: 5, stage: 0, leader: 1, attachedDon: 1 });
  assert.deepEqual(codes(a, 0, 'deploy'), ['OP17-082', 'OP17-086', 'EB05-047', 'OP17-080'], 'Sanji, Nami, Ripley, Usopp (repris de la défausse)');
  assert.deepEqual(counts(a, 1), { deck: 38, hand: 7, deploy: 0, life: 5, donDeck: 6, donCost: 4, trash: 0, stage: 0, leader: 1, attachedDon: 0 });
  const b = rejouerFixture('0859');
  assert.equal(counts(b, 1).life, 4, '4000 contre 5000 repoussée, puis 9000 touche : une vie perdue');
  assert.equal(counts(b, 1).hand, 8);
});

test('fixtures et parties RZ1 du même match : même table à la fin, carte par carte', async () => {
  const { lireRz1, rejouer } = await outil();
  for (const j of ['0841', '0859']) {
    const evts = lireRz1(fs.readFileSync(ici(`./fixtures/miroir/partie-2026-11-17-${j}.rz1`), 'utf8'));
    const r = rejouer(evts);
    const viaRpc = rejouerFixture(j);
    for (const seat of [0, 1] as const) {
      const dernier = evts.filter((e: { type: string; joueur: number }) => e.type === 'chk' && e.joueur === seat + 1).at(-1);
      assert.deepEqual(counts(viaRpc, seat), dernier.compte, `${j}, joueur ${seat + 1} : comptes du dernier contrôle RZ1`);
      for (const zone of ['hand', 'deploy', 'trash', 'life', 'deck'] as const) {
        const connus = (s: Mirror) => s.players[seat].zones[zone].map((c: MirrorCardX) => c.code);
        const rz1 = connus(r.etat), rpcs = connus(viaRpc);
        // Le RZ1 ne nomme que les cartes qui ont bougé : on compare là où il les connaît.
        assert.deepEqual(rpcs.map((c, i) => (rz1[i] ? c : '')), rz1, `${j}, joueur ${seat + 1}, ${zone}`);
      }
    }
  }
});

test('extraits RZ1 anonymisés : chaque contrôle CHK retrouvé, chaque carte à sa place', async () => {
  const { lireRz1, rejouer } = await outil();
  const fichiers = fs.readdirSync(ici('./fixtures/miroir/')).filter((f) => f.endsWith('.rz1'));
  assert.equal(fichiers.length, 4);
  for (const f of fichiers) {
    const texte = fs.readFileSync(ici(`./fixtures/miroir/${f}`), 'utf8');
    assert.ok(!/#\d{3,}|​/.test(texte), `${f} : pas de pseudo`);
    const r = rejouer(lireRz1(texte));
    assert.ok(r.controles > 150, f);
    assert.deepEqual(r.ecarts, [], f);
    assert.deepEqual(r.identite.fausses, [], f);
    assert.deepEqual(r.erreursMiroir, [], f);
    assert.deepEqual(r.sansEquivalent, {}, f);
    assert.ok(r.identite.verifiees > 50, f);
  }
});

test('outil RZ1 : lecture, extrait anonymisé, traduction en RPC et rapport', async () => {
  const { lireRz1, extraitAnonyme, equivalent, rapport } = await outil();
  const brut = 'Ignoré\nRZ1|HDR|1.45a|2|RZ1\nRZ1|META|abc|0\nRZ1|PLY|1|Pseudo​#123|OP13-004\nRZ1|SEM|1|0|xx\nRZ1|5|1|OP13-004|0|49|1|0|0|1|0|0|0|7\nRZ1|CHK|5|1|49|1|0|0|10|0|0|0|1|0\n';
  const extrait = extraitAnonyme(brut);
  assert.equal(extrait, 'RZ1|HDR|1.45a|2|RZ1\nRZ1|PLY|1|Joueur1|OP13-004\nRZ1|5|1|OP13-004|0|49|1|0|0|1|0|0|0|7\nRZ1|CHK|5|1|49|1|0|0|10|0|0|0|1|0\n');
  const evts = lireRz1(extrait);
  assert.deepEqual(evts.map((e: { type: string }) => e.type), ['hdr', 'ply', 'move', 'chk']);
  assert.equal(evts[3].compte.deck, 49);
  const s = jouer(table(), [['DrawCard', { iCount: 1 }, 0]]).state;
  const eq = (oz: number, os: number, dz: number, ds: number) => equivalent({ oz, os, dz, ds, repos: false }, s, 0).rpcs.map((x: Rpc) => [x.name.replace('ClientRpc', ''), x.values]);
  assert.deepEqual(eq(0, 8, 1, 1), [['DrawCard', { iCount: 1 }]]);
  assert.deepEqual(eq(0, 2, 1, 1), [['DrawSpecificCard', { iCardIndex: 2 }]]);
  assert.deepEqual(eq(1, 0, 0, 9), [['MoveHandCardToDeckTop', { iCardIdx: 0 }]]);
  assert.deepEqual(eq(0, 8, 0, 0), [['ShuffleDeck', { s_ShuffleString: '8-0-1-2-3-4-5-6-7' }]]);
  assert.deepEqual(eq(9, 9901, 5, 0), [['DetachDonFromCard', { iCardIdx: -1, iDonIdx: 1 }]]);
  const lignes = rapport({ journaux: { DrawCard: 3, Inconnue: 1 }, parties: { TapDon: 2 } });
  assert.equal(lignes[0].nom, 'DrawCard');
  assert.equal(lignes.find((l: { nom: string }) => l.nom === 'Inconnue').etat, 'NON COUVERTE');
  assert.equal(lignes.find((l: { nom: string }) => l.nom === 'SetTimer').etat, 'sans effet sur la table');
});
