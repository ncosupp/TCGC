// Recettes de ST20 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST20` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST20: RecipeSet = {
  set: 'ST20',
  entries: {
    'ST20-001': { level: 'verified', recipe: { num: 'ST20-001', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'giveDon', n: 1, upTo: true, rested: true, target: { side: 'own', zone: 'field', leader: true, characters: true, count: 1, upTo: false, filter: {} } } }], cost: [{ kind: 'flipLife', faceUp: true }] }], keywords: ['Blocker'] } },
    'ST20-004': { level: 'verified', recipe: { num: 'ST20-004', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: { costMax: 3, types: ['Big Mom Pirates'] }, characters: true } } }], cost: [{ kind: 'lifeToHand', from: 'top' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 3 }, characters: true } } }] } } },
    'ST20-005': { level: 'verified', recipe: { num: 'ST20-005', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'oppChooseOne', options: [[{ action: { kind: 'oppDiscard', n: 2 } }], [{ action: { kind: 'trashLife', n: 1, side: 'opp', from: 'top' } }]] } }], cost: [{ kind: 'discard', n: 1 }] }] } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
