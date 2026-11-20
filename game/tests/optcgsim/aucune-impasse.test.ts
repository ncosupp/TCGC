// Tâche O5.5 (audit O5.0, § 5.3 et § 5.4) : test « aucune impasse ». Des parties au hasard (graines fixes : decks de
// joy-boy et de l'hôte, salle avec ou sans minuteur, préférences du joueur joy-boy, 1 à 3 attentes injectées de chaque
// type, M2, T3 et R9 compris depuis O5.6) contre le faux hôte fidèle, sur une horloge simulée. Assertions : les deux camps
// ne s'attendent jamais plus de 30 s simulées (le faux hôte relève alors une impasse), aucun désaccord sur qui agit, et
// la partie va à son terme. Les parties qui n'ont tenu que grâce au filet anti-impasse (déblocage ou conclusion) sont
// comptées à part et listées : elles signalent un traitement manquant ; depuis l'intégration O5-2, le sous-ensemble court
// n'en admet plus aucune (la version longue les liste sans échouer).
//
// Ici : 50 graines (sous-ensemble court). Version longue (500 graines, détail d'une graine) :
//   node --no-warnings --import ./game/data/load-local.ts scripts/optcgsim/aucune-impasse.mjs 500
//   node --no-warnings --import ./game/data/load-local.ts scripts/optcgsim/aucune-impasse.mjs --graine 20 --detail
//
// Plus le test de la remise de la main selon le contexte (tableau du § 3.5 de l'audit, une ligne par cas) sur
// handBackFor (reaction.ts) et combatHandBack (combat.ts). Le test de catalogue (§ 4.5, règle 1) est dans attente.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combatHandBack, type CombatState, type Snapshot } from '../../online/optcgsim/combat.ts';
import { handBackFor, type HandBackContext } from '../../online/optcgsim/reaction.ts';
import { decrire, echec, jouerGraines, parFilet, tirer, TYPES } from './aucune-impasse-parties.ts';

const BR = String.fromCharCode(10);

/**
 * Impasses trouvées par ce test (graine → ce qui manque, et la tâche qui doit le traiter). Retirées du sous-ensemble
 * court et rejouées une à une en `todo` ci-dessous : quand une tâche corrige le point, elle retire la graine d'ici.
 */
// Intégration O5-2 : les impasses trouvées par O5.5 sont corrigées (salle sans minuteur + CD2 bis : bascules
// d'iPlayerAction de SetupAttack sur une cible inconnue et de ResolveNoAttack dans mirror.ts, ResolveNoAttack dans le
// faux hôte ; R7 ForceOpponentActionFrom… : O5.4 ; graine 423 : fenêtre de défense du faux hôte fermée à tort par le
// SwitchTurns de son offre de [Déclenchement]). Ajouter ici une graine si la version longue en trouve une nouvelle.
const IMPASSES_CONNUES: Record<number, string> = {};

/** Graines du sous-ensemble court (50 parties). */
const COURTES = Array.from({ length: 50 }, (_, i) => i + 1);
const MS = 10; // une seconde simulée = 10 ms réelles : 30 s simulées = 300 ms, assez de marge sous la charge de `npm test`

test('aucune impasse : 50 parties au hasard contre le faux hôte fidèle, ni impasse ni désaccord (filet compté à part)', { timeout: 300_000 }, async (t) => {
  const graines = COURTES.filter((g) => !(g in IMPASSES_CONNUES));
  const res = await jouerGraines(graines, { msParSeconde: MS, parallele: 4 });
  const echecs = res.filter(echec), filet = res.filter(parFilet);
  t.diagnostic(`${res.length} parties : ${echecs.length} en échec, ${filet.length} sauvées par le filet (traitement manquant), ${res.length - echecs.length - filet.length} saines`);
  for (const x of filet) t.diagnostic(`filet : ${decrire(x)}`);
  assert.deepEqual(echecs.map(decrire), [], 'aucune partie où les deux camps s’attendent plus de 30 s simulées, aucun désaccord sur qui agit');
  // depuis l'intégration O5-2 (O5.4 fusionnée) : plus aucune partie du sous-ensemble court ne tient grâce au filet
  assert.deepEqual(filet.map(decrire), [], 'aucune partie sauvée par le filet (traitement manquant)');
  // chaque partie est allée à son terme : départ de l'hôte, fin de partie, annulation, ou arrêt sans perdant du filet
  for (const x of res) assert.ok(['left', 'game', 'cancel', 'desync'].includes(x.fin.kind), decrire(x));
  // chaque type d'attente a été tiré et joué au moins une fois par le faux hôte
  const tires = new Set(res.flatMap((x) => x.types));
  for (const ty of TYPES) assert.ok(tires.has(ty.nom), `type ${ty.nom} tiré dans le sous-ensemble`);
  const joues = res.flatMap((x) => x.jouees).join(' ');
  for (const id of ['CD1', 'CD2', 'R5', 'CA5', 'R4', 'CA4', 'R4c', 'R2', 'R6', 'R6h', 'R7', 'T5', 'T6', 'muet', 'T3', 'R9']) assert.match(joues, new RegExp(`(^| )${id}( |@|$)`), `attente ${id} jouée`);
  // M2 n'est pas une injection (option du faux hôte) : l'hôte a été libéré de l'égalité au tirage
  assert.ok(res.some((x) => x.liberees.includes('égalité au tirage (M2)')), 'égalité au tirage (M2) jouée et levée');
});

for (const [g, quoi] of Object.entries(IMPASSES_CONNUES)) {
  test(`impasse connue, graine ${g} (version longue : --graine ${g} --detail)`, { timeout: 60_000, todo: quoi }, async () => {
    const [x] = await jouerGraines([Number(g)], { msParSeconde: MS });
    assert.ok(!echec(x), `${decrire(x)}${BR}${x.texte}`);
  });
}

test('tirage : mêmes parties à chaque lancement ; M2, T3 et R9 tirés depuis O5.6', () => {
  const sans = ({ injections: _i, ...r }: ReturnType<typeof tirer>) => JSON.stringify(r);
  for (const g of [1, 7, 42]) assert.equal(sans(tirer(g)), sans(tirer(g)));
  const noms = TYPES.map((x) => x.nom);
  for (const n of ['M2', 'T3', 'R9']) assert.ok(noms.includes(n), `${n} dans le tirage`);
  // M2 : l'option « égalité » du faux hôte ; T3 : l'effet de l'hôte en fin de tour de joy-boy
  const tires = Array.from({ length: 200 }, (_, i) => tirer(i + 1));
  assert.ok(tires.some((t) => t.types.includes('M2') && t.optionsHote.egalite === true));
  assert.ok(tires.some((t) => t.injections.some((i) => i.quand === 'finTourJoyboy' && i.id === 'T3')));
  for (const t of tires) assert.equal(t.optionsHote.egalite === true, t.types.includes('M2'), `graine ${t.graine}`);
});

// ---------------------------------------------------------------------------------------------------- remise de la main

/** Tableau « Remise de la main selon le contexte » (§ 3.5 de l'audit) : ce que joy-boy envoie, une ligne par cas. */
const noms = (r: [string, Record<string, unknown>][] | undefined) => r?.map(([n]) => n);
const hb = (c: HandBackContext) => noms(handBackFor(c));
const cb = (c: CombatState) => noms(combatHandBack(c)?.rpcs);
const SNAP: Snapshot = { attacker: 6000, target: 5000, attackerUid: 1, targetUid: 2, attackerNum: 'X', defender: 0, leader: true, double: false, banish: false, outcome: 'hit', lifeUids: [3], asks: [true] };
const REPRISE = ['AllOnKOResolved', 'SwitchTurns', 'ResetActionPhase', 'NoMorePendingActions'];

test('remise de la main (§ 3.5) : tour de l’hôte, phase principale → ReturnToOpponentActionPhase', () => {
  assert.deepEqual(hb({ hostTurn: true, combat: 'none', forced: false }), REPRISE);
  assert.deepEqual(hb({ hostTurn: true, combat: 'none', forced: true }), ['AllOnKOResolved', 'SwitchTurns', 'TriggerOpponentMultiActions', 'ResetActionPhase', 'NoMorePendingActions']);
});

test('remise de la main (§ 3.5) : tour de l’hôte, il attaque, joy-boy au bloqueur ou aux contres → AllOnKOResolved, puis la suite du combat', () => {
  assert.deepEqual(hb({ hostTurn: true, combat: 'defense', forced: false }), ['AllOnKOResolved']);
  assert.deepEqual(cb({ phase: 'defense', step: 'block' }), ['AllOnKOResolved'], 'au bloqueur : le choix du bloqueur reprend');
  assert.deepEqual(cb({ phase: 'defense', step: 'block', blockSent: true }), ['AllOnKOResolved', 'NoBlocker'], 'aux contres');
});

test('remise de la main (§ 3.5) : tour de joy-boy, phase principale → AllOnKOResolved seul (jamais SwitchTurns ni ResetActionPhase)', () => {
  assert.deepEqual(hb({ hostTurn: false, combat: 'none', forced: false }), ['AllOnKOResolved']);
  assert.deepEqual(hb({ hostTurn: false, combat: 'none', forced: true }), ['AllOnKOResolved', 'TriggerOpponentMultiActions']);
});

test('remise de la main (§ 3.5) : tour de joy-boy, il attaque, l’hôte aux contres → AllOnKOResolved, SwitchTurns (+ NoBlocker s’il a déjà répondu au bloqueur)', () => {
  assert.deepEqual(hb({ hostTurn: false, combat: 'attack', forced: true }), ['AllOnKOResolved', 'SwitchTurns']);
  assert.deepEqual(cb({ phase: 'attack', step: 'block' }), ['AllOnKOResolved', 'SwitchTurns']);
  // combat.ts (O5.3) ajoute NoBlocker quand l'hôte a déjà répondu au bloqueur : sans lui, il n'a plus « résoudre l'attaque » (GLS:29786)
  assert.deepEqual(cb({ phase: 'attack', step: 'block', blockDone: true }), ['AllOnKOResolved', 'SwitchTurns', 'NoBlocker']);
});

test('remise de la main (§ 3.5) : [Déclenchement] de l’hôte en cours (joy-boy attaque, Leader touché) → SwitchTurns, DoNoTrigger', () => {
  assert.deepEqual(cb({ phase: 'attack', step: 'handBack', snap: SNAP }), ['SwitchTurns', 'DoNoTrigger']);
});

test('remise de la main (§ 3.5) : [Déclenchement] de joy-boy (il défend) → la main rendue, combat fini', () => {
  const r = combatHandBack({ phase: 'defense', step: 'trigger' })!;
  assert.deepEqual(noms(r.rpcs), REPRISE);
  assert.equal(r.combat.phase, 'idle');
  // l'hôte attaque déjà de nouveau (attaque retenue, CD2) : AllOnKOResolved seul, sans SwitchTurns
  assert.deepEqual(cb({ phase: 'defense', step: 'trigger', queued: { attacker: 1, target: 2, select: true } }), ['AllOnKOResolved']);
});

test('remise de la main (§ 3.5) : fin du tour de joy-boy (EndingTurn) → AllOnKOResolved seul', () => {
  // handBackFor ne distingue pas EndingTurn : c'est le cas « tour de joy-boy, hors combat », qui envoie la même chose
  assert.deepEqual(hb({ hostTurn: false, combat: 'none', forced: false }), ['AllOnKOResolved']);
});

test('remise de la main (§ 3.5) : Personnage mis KO en combat → AllOnKOResolved, SwitchTurns (joy-boy attaque) ; main rendue (il défend)', () => {
  assert.deepEqual(cb({ phase: 'attack', step: 'handBack', snap: { ...SNAP, leader: false, outcome: 'ko' } }), ['AllOnKOResolved', 'SwitchTurns']);
  assert.deepEqual(cb({ phase: 'defense', step: 'handBack' }), REPRISE);
  assert.equal(combatHandBack({ phase: 'idle', step: 'none' }), null, 'hors combat : handBackFor');
});

test('remise de la main (§ 3.5) : action imposée alors que l’hôte a encore des actions (bMorePending, anciennes actions) → AllOnKOResolved seul', () => {
  const c: HandBackContext = { hostTurn: true, combat: 'none', forced: true, morePending: true };
  assert.deepEqual(hb(c), ['AllOnKOResolved']);
});

