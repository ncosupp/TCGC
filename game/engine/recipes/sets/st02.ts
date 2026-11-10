// Recettes de ST02 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST02` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST02: RecipeSet = {
  set: 'ST02',
  entries: {
    'ST02-001': { level: 'verified', recipe: { num: 'ST02-001', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, leader: true } } }], cost: [{ kind: 'restDon', n: 3 }, { kind: 'discard', n: 1 }] }] } },
    'ST02-003': { level: 'verified', recipe: { num: 'ST02-003', abilities: [{ timing: 'static', don: 1, steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {} }, amount: 2000, until: 'permanent' }, cond: { kind: 'chars', side: 'own', cmp: 'ge', n: 3, filter: { category: ['CHARACTER'] } } }] }] } },
    'ST02-005': { level: 'verified', recipe: { num: 'ST02-005', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 3, rested: true }, characters: true } } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'playSelf' } }] } } },
    'ST02-007': { level: 'verified', recipe: { num: 'ST02-007', abilities: [{ timing: 'activateMain', steps: [{ action: { kind: 'search', look: 5, take: 1, upTo: true, filter: { types: ['Supernovas'] }, dest: 'hand', rest: 'bottom' } }], cost: [{ kind: 'restDon', n: 1 }, { kind: 'restSelf' }] }] } },
    'ST02-008': { level: 'verified', recipe: { num: 'ST02-008', abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ action: { kind: 'restDon', n: 1, side: 'opp' } }] }] } },
    'ST02-009': { level: 'verified', recipe: { num: 'ST02-009', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: { costMax: 5, types: ['Supernovas', 'Heart Pirates'], typesMode: 'any', rested: true }, characters: true } } }] }] } },
    'ST02-013': { level: 'verified', recipe: { num: 'ST02-013', abilities: [{ timing: 'endOfTurn', don: 1, steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true } } }] }], keywords: ['Blocker'] } },
    'ST02-014': { level: 'verified', recipe: { num: 'ST02-014', abilities: [{ timing: 'static', don: 1, yourTurn: true, steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 'all', upTo: false, filter: { types: ['Supernovas', 'Navy'], typesMode: 'any' }, leader: true, characters: true }, amount: 1000, until: 'permanent' }, cond: { kind: 'selfState', rested: true } }] }] } },
    'ST02-015': { level: 'verified', recipe: { num: 'ST02-015', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 2000, until: 'battle' } }, { action: { kind: 'readyDon', n: 1, upTo: true }, link: 'then' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'readyDon', n: 2, upTo: true } }] } } },
    'ST02-016': { level: 'verified', recipe: { num: 'ST02-016', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 4000, until: 'battle' } }, { action: { kind: 'readyDon', n: 1, upTo: true }, link: 'then' }] }] } },
    'ST02-017': { level: 'verified', recipe: { num: 'ST02-017', abilities: [{ timing: 'main', steps: [{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, characters: true } } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'play', from: 'hand', count: 1, upTo: true, filter: { costMax: 2, types: ['Supernovas'] } } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
