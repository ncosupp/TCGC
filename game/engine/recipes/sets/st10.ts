// Recettes de ST10 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST10` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST10: RecipeSet = {
  set: 'ST10',
  entries: {
    'ST10-002': { level: 'verified', note: 'écrite à la main : le traducteur ne lit pas ce OU sur deux seuils', recipe: { num: 'ST10-002', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'active' }, cond: { kind: 'or', any: [{ kind: 'donField', side: 'own', cmp: 'eq', n: 0 }, { kind: 'donField', side: 'own', cmp: 'ge', n: 8 }] } }] }] } },
    'ST10-003': { level: 'verified', note: 'limite du banc ([En attaquant] qui change l’issue du combat) : test écrit (cards-st10.test.ts)', recipe: { num: 'ST10-003', abilities: [{ timing: 'static', yourTurn: true, steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, leader: true }, amount: -1000, until: 'permanent' }, cond: { kind: 'life', side: 'own', cmp: 'ge', n: 4 } }] }, { timing: 'whenAttacking', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, leader: true }, amount: 2000, until: 'turn' } }], cost: [{ kind: 'donMinus', n: 1 }] }] } },
    'ST10-007': { level: 'verified', recipe: { num: 'ST10-007', abilities: [{ timing: 'when', yourTurn: true, oncePerTurn: true, steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 3, rested: true }, characters: true } } }], event: { on: 'donReturned' } }] } },
    'ST10-008': { level: 'verified', recipe: { num: 'ST10-008', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'addDon', n: 2, upTo: true, state: 'rested' }, cond: { kind: 'donField', side: 'own', cmp: 'le', n: 3 } }] }] } },
    'ST10-009': { level: 'verified', recipe: { num: 'ST10-009', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'active' } }], cost: [{ kind: 'restDon', n: 1 }] }] } },
    'ST10-011': { level: 'verified', recipe: { num: 'ST10-011', abilities: [{ timing: 'when', yourTurn: true, oncePerTurn: true, steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, amount: 2000, until: 'oppNextEnd' } }], event: { on: 'donReturned' } }] } },
    'ST10-012': { level: 'verified', recipe: { num: 'ST10-012', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'rested' }, cond: { kind: 'donVsOpp', cmp: 'lt' } }] }, { timing: 'whenAttacking', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'rested' }, cond: { kind: 'donVsOpp', cmp: 'lt' } }] }] } },
    'ST10-013': { level: 'verified', recipe: { num: 'ST10-013', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true }, amount: 1000, until: 'oppNextEnd' } }], cost: [{ kind: 'donMinus', n: 1 }] }, { timing: 'whenAttacking', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true }, amount: 1000, until: 'oppNextEnd' } }], cost: [{ kind: 'donMinus', n: 1 }] }] } },
    'ST10-014': { level: 'verified', recipe: { num: 'ST10-014', abilities: [{ timing: 'when', oncePerTurn: true, steps: [{ action: { kind: 'draw', n: 1 } }, { action: { kind: 'discard', n: 1 }, link: 'and' }], event: { on: 'donReturned' } }], keywords: ['Blocker'] } },
    'ST10-017': { level: 'verified', recipe: { num: 'ST10-017', abilities: [{ timing: 'main', steps: [{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 2 }, characters: true } } }, { action: { kind: 'addDon', n: 1, upTo: true, state: 'rested' }, link: 'and' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'active' } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
