// Récompenses écrites de la même façon dans chaque arc de l'aventure (east-blue.ts, alabasta.ts)
import type { Reward } from './types.ts';

// Berry de la première victoire (barème de game/economy/config.ts)
export const berry = (amount: number): Reward => ({ kind: 'berry', amount });
// Un membre d'équipage qui rejoint Luffy : une carte rouge, jouable dans le deck de départ (ST-01, rouge)
export const recruit = (number: string): Reward => ({ kind: 'card', number, count: 1 });
