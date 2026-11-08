// Recettes de ST13 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST13` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST13: RecipeSet = {
  set: 'ST13',
  entries: {
    'ST13-008': { level: 'verified', recipe: { num: 'ST13-008', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 5 }, characters: true } } }], cost: [{ kind: 'trashLife', from: 'topOrBottom' }] }] } },
    'ST13-012': { level: 'verified', recipe: { num: 'ST13-012', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'reorderLife', side: 'own' } }], cost: [{ kind: 'lifeToHand', from: 'topOrBottom' }] }] } },
    'ST13-013': { level: 'verified', recipe: { num: 'ST13-013', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'search', look: 5, take: 1, upTo: true, filter: { costMax: 5, name: ['Sabo', 'Portgas.D.Ace', 'Monkey.D.Luffy'] }, dest: 'hand', rest: 'bottom' } }] }] } },
    'ST13-017': { level: 'verified', recipe: { num: 'ST13-017', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 4000, until: 'battle' } }, { action: { kind: 'reorderLife', side: 'own' }, link: 'then' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'handToLife', n: 1, upTo: true, filter: {} } }], cost: [{ kind: 'lifeToHand', from: 'topOrBottom' }] } } },
    'ST13-019': { level: 'verified', recipe: { num: 'ST13-019', abilities: [{ timing: 'main', steps: [{ action: { kind: 'search', look: 5, take: 1, upTo: true, filter: { costMax: 5, name: ['Sabo', 'Portgas.D.Ace', 'Monkey.D.Luffy'] }, dest: 'hand', rest: 'bottom' } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'activate', which: 'main' } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
