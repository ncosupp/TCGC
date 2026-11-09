// Recettes de ST03 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST03` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST03: RecipeSet = {
  set: 'ST03',
  entries: {
    'ST03-001': { level: 'verified', recipe: { num: 'ST03-001', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'bounce', target: { side: 'any', zone: 'field', count: 1, upTo: true, filter: { costMax: 5 }, characters: true } } }], cost: [{ kind: 'donMinus', n: 4 }] }] } },
    'ST03-003': { level: 'verified', recipe: { num: 'ST03-003', abilities: [{ timing: 'onBlock', don: 1, steps: [{ action: { kind: 'bottom', target: { side: 'any', zone: 'field', count: 1, upTo: true, filter: { costMax: 2 }, characters: true } } }] }], keywords: ['Blocker'] } },
    'ST03-004': { level: 'verified', recipe: { num: 'ST03-004', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'trashToHand', count: 1, upTo: true, filter: { notName: 'Gecko Moria', costMax: 4, types: ['The Seven Warlords of the Sea', 'Thriller Bark Pirates'], typesMode: 'any', category: ['CHARACTER'] } } }] }] } },
    'ST03-005': { level: 'verified', recipe: { num: 'ST03-005', abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ action: { kind: 'draw', n: 2 } }, { action: { kind: 'discard', n: 2 }, link: 'and' }] }] } },
    'ST03-009': { level: 'verified', recipe: { num: 'ST03-009', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'bounce', target: { side: 'any', zone: 'field', count: 1, upTo: true, filter: { costMax: 7 }, characters: true } } }] }] } },
    'ST03-010': { level: 'verified', recipe: { num: 'ST03-010', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'arrangeTop', look: 3, where: 'topOrBottom' } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'playSelf' } }] } } },
    'ST03-014': { level: 'verified', recipe: { num: 'ST03-014', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'bounce', target: { side: 'any', zone: 'field', count: 1, upTo: true, filter: { costMax: 3 }, characters: true } } }] }] } },
    'ST03-015': { level: 'verified', recipe: { num: 'ST03-015', abilities: [{ timing: 'main', steps: [{ action: { kind: 'bounce', target: { side: 'any', zone: 'field', count: 1, upTo: true, filter: { costMax: 7 }, characters: true } } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'activate', which: 'main' } }] } } },
    'ST03-016': { level: 'verified', recipe: { num: 'ST03-016', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'bounce', target: { side: 'any', zone: 'field', count: 1, upTo: true, filter: { costMax: 3 }, characters: true } } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'activate', which: 'counter' } }] } } },
    'ST03-017': { level: 'verified', recipe: { num: 'ST03-017', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 4000, until: 'battle' } }, { action: { kind: 'draw', n: 1 }, cond: { kind: 'hand', side: 'own', cmp: 'le', n: 3 }, link: 'then' }] }] } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
