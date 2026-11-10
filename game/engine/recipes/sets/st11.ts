// Recettes de ST11 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST11` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST11: RecipeSet = {
  set: 'ST11',
  entries: {
    'ST11-001': { level: 'verified', recipe: { num: 'ST11-001', abilities: [{ timing: 'whenAttacking', don: 1, oncePerTurn: true, steps: [{ action: { kind: 'search', look: 1, take: 1, upTo: true, filter: { types: ['FILM'] }, dest: 'hand', rest: 'bottom', shown: true } }] }] } },
    'ST11-002': { level: 'verified', recipe: { num: 'ST11-002', abilities: [{ timing: 'endOfTurn', steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: { types: ['FILM'] }, characters: true } } }], cost: [{ kind: 'discard', n: 1, filter: { category: ['EVENT'] } }] }], keywords: ['Blocker'] } },
    'ST11-003': { level: 'verified', recipe: { num: 'ST11-003', abilities: [{ timing: 'main', steps: [{ chooseOne: [[{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 5 }, characters: true } } }], [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 5, rested: true }, characters: true } } }]], cond: { kind: 'leaderIs', names: ['Uta'] } }] }] } },
    'ST11-004': { level: 'verified', recipe: { num: 'ST11-004', abilities: [{ timing: 'main', steps: [{ cond: { kind: 'leaderIs', names: ['Uta'] }, group: [{ action: { kind: 'search', look: 3, take: 1, upTo: true, filter: { notName: 'New Genesis', types: ['FILM'] }, dest: 'hand', rest: 'bottom' } }, { action: { kind: 'readyDon', n: 1, upTo: true }, link: 'and' }] }] }] } },
    'ST11-005': { level: 'verified', recipe: { num: 'ST11-005', abilities: [{ timing: 'main', steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: { name: ['Uta'] }, leader: true } } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 1000, until: 'turn' } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
