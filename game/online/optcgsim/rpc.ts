// Encodage et décodage des RPC d'après le catalogue (catalog.json).
// Squelette de la tâche O0 : compilable, rien d'implémenté. Tâche O1.1.

import type { Rpc } from './types.ts';

export function encode(_name: string, _values: Record<string, unknown>): Uint8Array {
  throw new Error('pas encore fait (O1.1)');
}

export function decode(_bytes: Uint8Array): Rpc {
  throw new Error('pas encore fait (O1.1)');
}
