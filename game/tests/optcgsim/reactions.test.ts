// Tâche O5.4 (audit O5.0, § 3.5) : pièces des réactions sans partie complète (les parties sont dans attentes-hote.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardData } from '../../engine/cards/index.ts';
import { createMirror } from '../../online/optcgsim/mirror.ts';
import { forcedKindOf, OLD_ACTIONS, OLD_FORCED, oldActionCard, REMOVAL } from '../../online/optcgsim/reaction.ts';
import type { Rpc } from '../../online/optcgsim/types.ts';

test('R4 : genre « renvoyer des DON!! » lu dans le texte de Magellan OP02-085', () => {
  assert.deepEqual(forcedKindOf(cardData()['OP02-085']?.effectEn), { kind: 'don', count: 1 });
  assert.deepEqual(forcedKindOf('Your opponent returns 2 DON!! cards from their field to their DON!! deck.'), { kind: 'don', count: 2 });
});

test('R1/R2 : tous les retraits d’OPTCGSim (1–13) ont une arrivée dans le moteur', () => {
  for (let k = 1; k <= 13; k++) assert.ok(REMOVAL[k], `RemovalEffect ${k}`);
  assert.deepEqual(REMOVAL[4], { to: 'life', top: true });
  assert.deepEqual(REMOVAL[2], { to: 'rest' });
});

test('R7 : la carte d’une ancienne action est cherchée chez le joueur qui agit (ou chez l’autre pour …OppositeDeploy)', () => {
  const m = createMirror();
  m.players[0].zones.deploy = [{ iid: 901, code: 'OP01-001' }];
  m.players[1].zones.deploy = [{ iid: 902, code: 'ST01-002' }];
  m.players[1].zones.trash = [{ iid: 903, code: 'ST01-003' }];
  const rpc = (name: string): Rpc => ({ name: `${name}ClientRpc`, object: 1, behaviour: 0, values: { iCardIdx: 0, iActionIdx: 0 } });
  assert.equal(OLD_ACTIONS.size, 8);
  assert.equal(OLD_FORCED.size, 3);
  m.actingPlayer = 1;  // après le SwitchTurns de l'hôte : c'est à joy-boy
  assert.deepEqual(oldActionCard(m, rpc('TriggerOpponentActionFromDeploy')), { seat: 1, code: 'ST01-002' });
  assert.deepEqual(oldActionCard(m, rpc('TriggerOpponentActionFromTrash')), { seat: 1, code: 'ST01-003' });
  m.actingPlayer = 0;  // action imposée sans bascule : l'hôte agit encore
  assert.deepEqual(oldActionCard(m, rpc('ForceOpponentActionFromDeploy')), { seat: 0, code: 'OP01-001' });
  assert.deepEqual(oldActionCard(m, rpc('ForceOpponentActionFromOppositeDeploy')), { seat: 1, code: 'ST01-002' });
  assert.equal(oldActionCard(m, rpc('ForceOpponentActionFromTrash')), null);
});
