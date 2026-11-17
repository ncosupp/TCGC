// Une partie croisée : connexion, mise en place, boucle de jeu, fin.
// Squelette de la tâche O0 : compilable, rien d'implémenté. Tâche O3.1.

export interface CrossplaySession {
  readonly joinCode: string;
  close(): void;
}

export function startSession(_joinCode: string): Promise<CrossplaySession> {
  throw new Error('pas encore fait (O3.1)');
}
