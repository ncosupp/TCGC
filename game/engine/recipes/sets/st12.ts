// Recettes de ST12 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST12` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST12: RecipeSet = {
  set: 'ST12',
  entries: {
    'ST12-001': { level: 'verified', recipe: { num: 'ST12-001', abilities: [{ timing: 'whenAttacking', don: 1, oncePerTurn: true, steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: { powerMax: 7000 }, characters: true } } }], cost: [{ kind: 'returnOwnChar', n: 1, filter: { costMin: 2 } }] }] } },
    'ST12-002': { level: 'verified', recipe: { num: 'ST12-002', abilities: [{ timing: 'activateMain', steps: [{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 4 }, characters: true } } }], cost: [{ kind: 'restSelf' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'playSelf' } }] } } },
    'ST12-006': { level: 'verified', recipe: { num: 'ST12-006', abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ chooseOne: [[{ action: { kind: 'rest', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 2 }, characters: true } } }], [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 2, rested: true }, characters: true } } }]] }] }] } },
    'ST12-007': { level: 'verified', recipe: { num: 'ST12-007', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'setActive', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: { costMax: 4, attribute: 'Slash' }, characters: true } }, cond: { kind: 'life', side: 'opp', cmp: 'ge', n: 3 } }], cost: [{ kind: 'restDon', n: 2 }] }] } },
    'ST12-010': { level: 'verified', recipe: { num: 'ST12-010', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'search', look: 1, take: 1, upTo: true, filter: { costEq: 2, category: ['CHARACTER'] }, dest: 'play', rest: 'topOrBottom', shown: true } }] }, { timing: 'whenAttacking', oncePerTurn: true, steps: [{ action: { kind: 'draw', n: 1 }, cond: { kind: 'hand', side: 'own', cmp: 'le', n: 6 } }] }] } },
    'ST12-011': { level: 'verified', recipe: { num: 'ST12-011', abilities: [{ timing: 'whenAttacking', don: 1, steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, amount: 2000, until: 'oppNextEnd' }, cond: { kind: 'hand', side: 'own', cmp: 'le', n: 5 } }] }] } },
    'ST12-012': { level: 'verified', recipe: { num: 'ST12-012', abilities: [{ timing: 'activateMain', steps: [{ action: { kind: 'bounce', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true } } }] }] } },
    'ST12-013': { level: 'verified', note: 'Q&A d’OP01-073, OP01-077, OP01-088 : toutes ensemble du même côté (n° 1660)', recipe: { num: 'ST12-013', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'arrangeTop', look: 3, where: 'topOrBottom' } }] }, { timing: 'whenAttacking', steps: [{ action: { kind: 'search', look: 1, take: 1, upTo: true, filter: { costEq: 2, category: ['CHARACTER'] }, dest: 'play', rest: 'topOrBottom', rested: true, shown: true } }] }] } },
    'ST12-014': { level: 'verified', note: 'Q&A d’OP01-073, OP01-077, OP01-088 : toutes ensemble du même côté (n° 1660)', recipe: { num: 'ST12-014', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'arrangeTop', look: 3, where: 'topOrBottom' } }] }], keywords: ['Blocker'] } },
    'ST12-017': { level: 'verified', recipe: { num: 'ST12-017', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 2000, until: 'battle' } }, { action: { kind: 'search', look: 1, take: 1, upTo: true, filter: { costEq: 2, category: ['CHARACTER'] }, dest: 'play', rest: 'topOrBottom', shown: true, joined: true }, link: 'then' }] }] } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
