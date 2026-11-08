// Recettes de ST16 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST16` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST16: RecipeSet = {
  set: 'ST16',
  entries: {
    'ST16-001': { level: 'verified', recipe: { num: 'ST16-001', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'giveDon', n: 1, upTo: true, rested: true, target: { side: 'own', zone: 'field', leader: true, characters: true, count: 1, upTo: false, filter: {} } } }], cost: [{ kind: 'discard', n: 1, filter: { types: ['FILM'] } }] }], keywords: ['Blocker'] } },
    'ST16-003': { level: 'verified', recipe: { num: 'ST16-003', abilities: [{ timing: 'static', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, amount: 2000, until: 'permanent' }, cond: { kind: 'and', all: [{ kind: 'leaderType', types: ['FILM'] }, { kind: 'fieldCards', side: 'own', cmp: 'ge', n: 6, rested: true }] } }] }] } },
    'ST16-004': { level: 'verified', recipe: { num: 'ST16-004', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { rested: true }, characters: true } } }] }] } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
