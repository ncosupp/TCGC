// Recettes de ST05 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST05` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST05: RecipeSet = {
  set: 'ST05',
  entries: {
    'ST05-001': { level: 'verified', recipe: { num: 'ST05-001', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 'all', upTo: false, filter: { types: ['FILM'] }, characters: true }, amount: 2000, until: 'turn' } }], cost: [{ kind: 'donMinus', n: 3 }] }] } },
    'ST05-002': { level: 'verified', recipe: { num: 'ST05-002', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'rested' } }] }] } },
    'ST05-004': { level: 'verified', recipe: { num: 'ST05-004', abilities: [{ timing: 'onBlock', steps: [{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 5 }, characters: true } } }], cost: [{ kind: 'donMinus', n: 1 }] }], keywords: ['Blocker'] } },
    'ST05-005': { level: 'verified', recipe: { num: 'ST05-005', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'addDon', n: 2, upTo: false, state: 'rested' }, cond: { kind: 'donVsOpp', cmp: 'lt' } }], cost: [{ kind: 'restSelf' }, { kind: 'discard', n: 1, filter: { types: ['FILM'] } }] }] } },
    'ST05-006': { level: 'verified', recipe: { num: 'ST05-006', abilities: [{ timing: 'whenAttacking', steps: [{ action: { kind: 'draw', n: 2 } }], cost: [{ kind: 'donMinus', n: 2 }] }] } },
    'ST05-008': { level: 'verified', recipe: { num: 'ST05-008', abilities: [{ timing: 'static', steps: [{ action: { kind: 'cantBeKO', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, until: 'permanent', by: 'battle' }, cond: { kind: 'donField', side: 'own', cmp: 'ge', n: 8 } }] }] } },
    'ST05-011': { level: 'verified', recipe: { num: 'ST05-011', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 2, upTo: true, filter: { costMax: 6 }, characters: true } } }, { action: { kind: 'keyword', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, keyword: 'Double Attack', until: 'turn' }, link: 'then' }], cost: [{ kind: 'donMinus', n: 4 }] }] } },
    'ST05-014': { level: 'verified', recipe: { num: 'ST05-014', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'search', look: 5, take: 1, upTo: true, filter: { notName: 'Buena Festa', types: ['FILM'] }, dest: 'hand', rest: 'bottom' } }] }] } },
    'ST05-016': { level: 'verified', recipe: { num: 'ST05-016', abilities: [{ timing: 'main', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 5 }, characters: true } } }], cost: [{ kind: 'donMinus', n: 2 }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'active' } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
