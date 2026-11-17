// Mutations externes appliquées au moteur, sans contrôle des règles.
// Squelette de la tâche O0 : compilable, rien d'implémenté. Tâche O1.3.

import type { GameState } from '../../engine/types.ts';
import type { External } from './types.ts';

export function applyExternal(_state: GameState, _mutation: External): GameState {
  throw new Error('pas encore fait (O1.3)');
}
