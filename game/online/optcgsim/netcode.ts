// Netcode for GameObjects : lots, messages, synchronisation de scène, synchro terminée.
// Squelette de la tâche O0 : compilable, rien d'implémenté. Tâche O1.1.

/** Construit un lot NGO (en-tête, empreinte XXH64) à partir de messages déjà encodés. */
export function buildBatch(_messages: { type: number; payload: Uint8Array }[]): Uint8Array {
  throw new Error('pas encore fait (O1.1)');
}

/** Décode un lot NGO reçu. */
export function parseBatch(_batch: Uint8Array): { type: number; payload: Uint8Array }[] {
  throw new Error('pas encore fait (O1.1)');
}
