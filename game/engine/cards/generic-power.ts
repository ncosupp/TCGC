// Puissance passive lue dans le texte, pour les cartes dont aucun effet n'est codé (parties croisées avec OPTCGSim :
// l'adversaire peut jouer n'importe quelle carte, et OPTCGSim applique « [DON!! x1] Ce Personnage gagne +1000 de
// puissance » ; sans cette lecture, joy-boy comptait 1000 de moins et décidait autrement du résultat d'une attaque).
// Seul le cas simple est lu : « [DON!! xN] [Votre tour] Ce Personnage/Leader gagne +X de puissance. » (sans
// condition ni « pour chaque »). Le reste reste de la responsabilité d'un vrai code de carte.
import type { CardBehavior, CardData } from '../types.ts';

const CLAUSE = /((?:\[(?:DON!! x\d+|Your Turn|Opponent's Turn)\]\s*)+)This (?:Character|Leader) gains \+(\d+) power\.(?!\s*\()/g;

export function genericSelfPower(d: Pick<CardData, 'effectEn'>): CardBehavior['selfPower'] | undefined {
  const clauses: { don: number; turn: 'you' | 'opp' | null; amount: number }[] = [];
  for (const m of (d.effectEn ?? '').matchAll(CLAUSE)) {
    const tags = m[1];
    const don = Number(/DON!! x(\d+)/.exec(tags)?.[1] ?? 0);
    const turn = tags.includes('[Your Turn]') ? 'you' : tags.includes("[Opponent's Turn]") ? 'opp' : null;
    clauses.push({ don, turn, amount: Number(m[2]) });
  }
  if (!clauses.length) return undefined;
  return (s, owner, card) => {
    let sum = 0;
    for (const c of clauses) {
      if (card.don < c.don) continue;
      if (c.turn === 'you' && s.active !== owner) continue;
      if (c.turn === 'opp' && s.active === owner) continue;
      sum += c.amount;
    }
    return sum;
  };
}
