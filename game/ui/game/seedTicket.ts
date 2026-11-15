// Graine d'une partie contre l'IA, demandée au serveur au lancement (server/game-seeds.js, audit du 14 nov. 2026) :
// une partie ne rapporte (Berry, récompenses d'un chapitre) que si elle a commencé avec une graine du serveur. Sans
// réponse rapide (hors ligne, serveur lent), la partie commence quand même avec une graine locale : elle se joue et
// s'enregistre normalement, mais ne rapporte rien. Le niveau 4 (IA entraînée) ne rapporte rien : pas de demande.
import type { Level } from '../../ai/search.ts';
import { call } from '../api.ts';

export interface SeedTicket { ticket: string; seed: number; issuedAt: string }

const WAIT_MS = 4000;

export async function requestSeed(game: { myDeck: string; aiDeck: string; level: Level }): Promise<SeedTicket | null> {
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS));
  const asked = call<SeedTicket>('POST', 'seed', { myDeck: game.myDeck, aiDeck: game.aiDeck, level: game.level })
    .then((t) => (typeof t?.ticket === 'string' && Number.isInteger(t.seed) ? t : null), () => null);
  return Promise.race([asked, late]);
}
