// Transport : Relay Unity, SimpleConnection, canal fiable, flux de messages.
// Squelette de la tâche O0 : compilable, rien d'implémenté. Tâche O1.1.

export interface Transport {
  send(data: Uint8Array): void;
  onData(handler: (data: Uint8Array) => void): void;
  close(): void;
}

/** Ouvre le transport vers la salle OPTCGSim identifiée par son code (jamais appelé par les tests : faux transport). */
export function connect(_joinCode: string): Promise<Transport> {
  throw new Error('pas encore fait (O1.1)');
}
