// Recettes de ST08 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST08` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST08: RecipeSet = {
  set: 'ST08',
  entries: {
    'ST08-001': { level: 'verified', recipe: { num: 'ST08-001', abilities: [{ timing: 'when', yourTurn: true, steps: [{ action: { kind: 'giveDon', n: 1, upTo: true, rested: true, target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, leader: true } } }], event: { on: 'koChar' } }] } },
    'ST08-004': { level: 'verified', recipe: { num: 'ST08-004', abilities: [{ timing: 'activateMain', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 2 }, characters: true } } }], cost: [{ kind: 'restSelf' }] }] } },
    'ST08-005': { level: 'verified', recipe: { num: 'ST08-005', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'any', zone: 'field', count: 'all', upTo: false, filter: { costMax: 1 }, characters: true } } }], cost: [{ kind: 'discard', n: 1 }] }] } },
    'ST08-006': { level: 'verified', recipe: { num: 'ST08-006', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -4, until: 'turn' } }] }], keywords: ['Blocker'] } },
    'ST08-008': { level: 'verified', recipe: { num: 'ST08-008', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -2, until: 'turn' } }] }] } },
    'ST08-009': { level: 'verified', recipe: { num: 'ST08-009', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'draw', n: 1 }, cond: { kind: 'chars', side: 'any', cmp: 'ge', n: 1, filter: { costEq: 0, category: ['CHARACTER'] } } }] }] } },
    'ST08-014': { level: 'verified', recipe: { num: 'ST08-014', abilities: [{ timing: 'main', steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -7, until: 'turn' } }], cost: [{ kind: 'lifeToHand', from: 'top' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'trashToHand', count: 1, upTo: true, filter: { costMax: 2, color: ['Black'], category: ['CHARACTER'] } } }] } } },
    'ST08-015': { level: 'verified', recipe: { num: 'ST08-015', abilities: [{ timing: 'main', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 2 }, characters: true } } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'draw', n: 1 } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
