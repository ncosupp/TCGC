// Recettes de ST06 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST06` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST06: RecipeSet = {
  set: 'ST06',
  entries: {
    'ST06-001': { level: 'verified', recipe: { num: 'ST06-001', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costEq: 0 }, characters: true } } }], cost: [{ kind: 'restDon', n: 3 }, { kind: 'discard', n: 1 }] }] } },
    'ST06-005': { level: 'verified', recipe: { num: 'ST06-005', abilities: [{ timing: 'whenAttacking', steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -4, until: 'turn' } }] }] } },
    'ST06-017': { level: 'verified', recipe: { num: 'ST06-017', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -1, until: 'turn' } }] }, { timing: 'activateMain', steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -1, until: 'turn' }, cond: { kind: 'leaderType', types: ['Navy'] } }], cost: [{ kind: 'restSelf' }] }] } },
    'ST06-015': { level: 'verified', note: "écrite à la main", recipe: { num: 'ST06-015', abilities: [{ timing: 'main', steps: [{ action: { kind: 'draw', n: 1 } }, { action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -2, until: 'turn' }, link: 'then' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'oppDiscard', n: 1 } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
