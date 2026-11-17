// Miroir des zones OPTCGSim : position dans une zone <-> uid du moteur joy-boy.
// Squelette de la tâche O0 : compilable, rien d'implémenté. Tâche O1.2.

import type { MirrorState, Rpc } from './types.ts';

export function createMirror(): MirrorState {
  throw new Error('pas encore fait (O1.2)');
}

/** Met le miroir à jour d'après une RPC reçue (ou émise). */
export function applyRpc(_mirror: MirrorState, _rpc: Rpc): MirrorState {
  throw new Error('pas encore fait (O1.2)');
}
