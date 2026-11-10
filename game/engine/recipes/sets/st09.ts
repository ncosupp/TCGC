// Recettes de ST09 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST09` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST09: RecipeSet = {
  set: 'ST09',
  entries: {
    'ST09-001': { level: 'verified', recipe: { num: 'ST09-001', abilities: [{ timing: 'static', don: 1, oppTurn: true, steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, leader: true }, amount: 1000, until: 'permanent' }, cond: { kind: 'life', side: 'own', cmp: 'le', n: 2 } }] }] } },
    'ST09-004': { level: 'verified', recipe: { num: 'ST09-004', abilities: [{ timing: 'static', don: 1, steps: [{ action: { kind: 'cantBeKO', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, until: 'permanent', by: 'battle' }, cond: { kind: 'life', side: 'own', cmp: 'le', n: 2 } }] }] } },
    'ST09-005': { level: 'verified', recipe: { num: 'ST09-005', abilities: [{ timing: 'static', don: 1, steps: [{ action: { kind: 'keyword', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, keyword: 'Double Attack', until: 'permanent' } }] }, { timing: 'onKO', steps: [{ action: { kind: 'lifeFromDeck', n: 1, upTo: true } }], cost: [{ kind: 'discard', n: 2 }] }] } },
    'ST09-007': { level: 'verified', recipe: { num: 'ST09-007', abilities: [{ timing: 'onBlock', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, amount: 4000, until: 'battle' } }], cost: [{ kind: 'lifeToHand', from: 'topOrBottom' }] }], keywords: ['Blocker'] } },
    'ST09-008': { level: 'verified', recipe: { num: 'ST09-008', abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ action: { kind: 'play', from: 'hand', count: 1, upTo: true, filter: { costMax: 4, types: ['Land of Wano'], color: ['Yellow'], category: ['CHARACTER'] } } }], cost: [{ kind: 'lifeToHand', from: 'topOrBottom' }] }] } },
    'ST09-012': { level: 'verified', recipe: { num: 'ST09-012', abilities: [{ timing: 'whenAttacking', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, amount: 2000, until: 'oppNextEnd' } }], cost: [{ kind: 'lifeToHand', from: 'topOrBottom' }] }] } },
    'ST09-014': { level: 'verified', recipe: { num: 'ST09-014', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: -3000, until: 'turn' }, cond: { kind: 'life', side: 'own', cmp: 'le', n: 2 } }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'lifeFromDeck', n: 1, upTo: true } }], cost: [{ kind: 'discard', n: 2 }] } } },
    'ST09-015': { level: 'verified', recipe: { num: 'ST09-015', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 4000, until: 'battle' } }, { action: { kind: 'toLife', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 3 }, characters: true }, faceUp: true, where: 'topOrBottom' }, cond: { kind: 'life', side: 'own', cmp: 'le', n: 2 }, link: 'then' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'draw', n: 1 } }] } } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
