// joy-boy -> OPTCGSim : traduit les changements d'état du moteur en RPC.
// Squelette de la tâche O0 : compilable, rien d'implémenté. Tâche O2.1.

import type { MirrorState, Rpc } from './types.ts';

export function translateOutbound(_mirror: MirrorState): Rpc[] {
  throw new Error('pas encore fait (O2.1)');
}
