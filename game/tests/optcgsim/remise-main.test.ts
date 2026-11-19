// Tâche O5.0a (audit O5.0, § 3.5) : ce que joy-boy envoie pour rendre la main au joueur OPTCGSim après une réaction
// ou une action imposée, selon le contexte, comme le vrai client (GameplayLogicScript.ResolveAction, GLS:14375).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handBackFor, returnedAction } from '../../online/optcgsim/reaction.ts';

const noms = (r: [string, Record<string, unknown>][]) => r.map(([n]) => n);

test('remise de la main selon le contexte (un cas par ligne du tableau du § 3.5)', () => {
  // tour de l'hôte, phase principale : ReturnToOpponentActionPhase (GLS:29644), plus la liste vide si imposée
  assert.deepEqual(noms(handBackFor({ hostTurn: true, combat: 'none', forced: false })), ['AllOnKOResolved', 'SwitchTurns', 'ResetActionPhase', 'NoMorePendingActions']);
  assert.deepEqual(noms(handBackFor({ hostTurn: true, combat: 'none', forced: true })), ['AllOnKOResolved', 'SwitchTurns', 'TriggerOpponentMultiActions', 'ResetActionPhase', 'NoMorePendingActions']);
  // tour de l'hôte, il attaque : AllOnKOResolved seul, la suite du combat reprend
  assert.deepEqual(noms(handBackFor({ hostTurn: true, combat: 'defense', forced: false })), ['AllOnKOResolved']);
  // tour de joy-boy, il attaque et l'hôte est aux contres : AllOnKOResolved, SwitchTurns (GLS:14425-14443)
  assert.deepEqual(noms(handBackFor({ hostTurn: false, combat: 'attack', forced: true })), ['AllOnKOResolved', 'SwitchTurns']);
  // tour de joy-boy, phase principale : AllOnKOResolved seul (CA4, CA5), jamais SwitchTurns ni ResetActionPhase
  assert.deepEqual(noms(handBackFor({ hostTurn: false, combat: 'none', forced: false })), ['AllOnKOResolved']);
  assert.deepEqual(noms(handBackFor({ hostTurn: false, combat: 'none', forced: true })), ['AllOnKOResolved', 'TriggerOpponentMultiActions']);
});

test('actions de l’hôte reçues dans sa liste : renvoyées avec la main (TransferAllPendingActionsToOpponent), iOwner retourné', () => {
  const a = { iOwner: 1, iLocation: 2, iCard: 3, iAction: 0, iTarget: -1, iSaveTarget: -1, eRemoval: 0, iRemovalPlayer: -1, iStackIdx: 1, iStepIdx: 0, iPrevTarget: 0, bFree: false, bTriggerOffer: false };
  const r = handBackFor({ hostTurn: false, combat: 'none', forced: true, hostActions: [a] });
  assert.deepEqual(noms(r), ['AllOnKOResolved', 'SwitchTurns', 'TriggerOpponentMultiActions']);
  assert.deepEqual(r[2][1].aTransfer, [{ ...a, iOwner: 0 }]);
  assert.equal(returnedAction({ iOwner: 0 }).iOwner, 1);
});
