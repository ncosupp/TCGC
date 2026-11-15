// Graines du serveur dans les tests (server/game-seeds.js) : une partie contre l'IA ne rapporte que si elle a commencé
// avec une graine donnée par le serveur. Les tests jouent leurs parties avec leurs propres graines : `remember` note la
// graine d'une partie (par son état de départ), `withTicket` demande au serveur une graine identique pour ce compte,
// à l'heure de début de l'enregistrement, et la range dans sa configuration, comme le fait l'interface au lancement.
import type { GameRecord } from '../coach/archive.ts';
import type { GameState } from '../engine/types.ts';

const seeds = new WeakMap<GameState, number>();

export function remember<T extends { initial: GameState }>(game: T, seed: number): T {
  seeds.set(game.initial, seed);
  return game;
}

type Issue = (userId: number, game: { myDeck: string; aiDeck: string; level: number }, now: Date, seed: number) => { ticket: string };

// Sans graine connue (départ fabriqué par le test), niveau 4 ou graine déjà rangée : l'enregistrement tel quel
export function withTicket(issue: Issue, userId: number, rec: GameRecord): GameRecord {
  const seed = seeds.get(rec.initial);
  const config = rec.config as GameRecord['config'] & { seedTicket?: string };
  if (seed === undefined || config.seedTicket !== undefined || ![1, 2, 3].includes(config.level)) return rec;
  const { ticket } = issue(userId, { myDeck: config.myDeck, aiDeck: config.aiDeck, level: config.level }, new Date(rec.startedAt), seed);
  return { ...rec, config: { ...config, seedTicket: ticket } as GameRecord['config'] };
}
