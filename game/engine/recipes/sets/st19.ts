// Recettes de ST19 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST19` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST19: RecipeSet = {
  set: 'ST19',
  entries: {
    'ST19-001': { level: 'verified', recipe: { num: 'ST19-001', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'cantAttack', target: { side: 'opp', zone: 'field', count: 2, upTo: true, filter: { costMax: 4 }, characters: true }, until: 'oppNextEnd', what: 'any' } }], cost: [{ kind: 'discard', n: 1, filter: { types: ['Navy'], color: ['Black'] } }] }] } },
    'ST19-002': { level: 'verified', recipe: { num: 'ST19-002', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'draw', n: 3 }, cond: { kind: 'leaderType', types: ['Navy'] } }], cost: [{ kind: 'discard', n: 2, filter: { types: ['Navy'], color: ['Black'] } }] }] } },
    'ST19-003': { level: 'verified', recipe: { num: 'ST19-003', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -4, until: 'turn' }, cond: { kind: 'leaderIs', names: ['Smoker'] } }] }, { timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'trashChar', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costEq: 0 }, characters: true } }, cond: { kind: 'playedThisTurn' } }] }] } },
    'ST19-004': { level: 'verified', recipe: { num: 'ST19-004', abilities: [{ timing: 'static', don: 1, oppTurn: true, steps: [{ action: { kind: 'cost', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, amount: 4, until: 'permanent' } }] }, { timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'giveDon', n: 1, upTo: true, rested: true, target: { side: 'own', zone: 'field', leader: true, characters: true, count: 1, upTo: false, filter: {} } } }], cost: [{ kind: 'trashToBottom', n: 1 }] }] } },
    'ST19-005': { level: 'verified', recipe: { num: 'ST19-005', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'cost', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true }, amount: -1, until: 'turn' } }], cost: [{ kind: 'trashToBottom', n: 1 }] }], keywords: ['Blocker'] } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
