// Recettes de ST04 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST04` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST04: RecipeSet = {
  set: 'ST04',
  entries: {
    'ST04-002': { level: 'verified', recipe: { num: 'ST04-002', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'play', from: 'hand', count: 1, upTo: true, filter: { costMax: 4, name: ['Page One'] } } }], cost: [{ kind: 'donMinus', n: 1 }] }] } },
    'ST04-003': { level: 'verified', recipe: { num: 'ST04-003', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 6 }, characters: true } } }, { action: { kind: 'keyword', target: { side: 'own', zone: 'field', self: true, count: 1, upTo: false, filter: {}, characters: true }, keyword: 'Rush', until: 'turn' } }], cost: [{ kind: 'donMinus', n: 5 }] }] } },
    'ST04-004': { level: 'verified', recipe: { num: 'ST04-004', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 4 }, characters: true } } }], cost: [{ kind: 'donMinus', n: 1 }] }] } },
    'ST04-005': { level: 'verified', recipe: { num: 'ST04-005', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'draw', n: 2 } }, { action: { kind: 'discard', n: 1 }, link: 'and' }], cost: [{ kind: 'donMinus', n: 1 }] }], keywords: ['Blocker'] } },
    'ST04-006': { level: 'verified', recipe: { num: 'ST04-006', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'draw', n: 1 } }], cost: [{ kind: 'donMinus', n: 1 }] }] } },
    'ST04-008': { level: 'verified', recipe: { num: 'ST04-008', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'active' } }], cost: [{ kind: 'discard', n: 1 }] }] } },
    'ST04-010': { level: 'verified', recipe: { num: 'ST04-010', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 3 }, characters: true } } }], cost: [{ kind: 'donMinus', n: 1 }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'playSelf' } }] } } },
    'ST04-014': { level: 'verified', recipe: { num: 'ST04-014', abilities: [{ timing: 'main', steps: [{ action: { kind: 'draw', n: 1 } }, { action: { kind: 'addDon', n: 1, upTo: true, state: 'active' }, link: 'then' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'activate', which: 'main' } }] } } },
    'ST04-015': { level: 'verified', recipe: { num: 'ST04-015', abilities: [{ timing: 'main', steps: [{ action: { kind: 'ko', target: { side: 'opp', zone: 'field', count: 1, upTo: true, filter: { costMax: 6 }, characters: true } } }, { action: { kind: 'addDon', n: 1, upTo: true, state: 'active' }, link: 'then' }] }], trigger: { timing: 'trigger', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'active' } }] } } },
    'ST04-016': { level: 'verified', recipe: { num: 'ST04-016', abilities: [{ timing: 'counter', steps: [{ action: { kind: 'power', target: { side: 'own', zone: 'field', count: 1, upTo: true, filter: {}, leader: true, characters: true }, amount: 4000, until: 'battle' } }], cost: [{ kind: 'donMinus', n: 1 }] }] } },
    'ST04-017': { level: 'verified', recipe: { num: 'ST04-017', abilities: [{ timing: 'activateMain', steps: [{ action: { kind: 'addDon', n: 1, upTo: true, state: 'rested' }, cond: { kind: 'leaderType', types: ['Animal Kingdom Pirates'] } }], cost: [{ kind: 'restSelf' }] }] } },
    'ST04-001': { level: 'verified', note: "écrite à la main : la carte du dessus (règle 3-10-2)", recipe: { num: 'ST04-001', abilities: [{ timing: 'activateMain', oncePerTurn: true, steps: [{ action: { kind: 'trashLife', n: 1, side: 'opp', from: 'top', upTo: true } }], cost: [{ kind: 'donMinus', n: 7 }] }] } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
