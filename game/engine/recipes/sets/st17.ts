// Recettes de ST17 (étape C) : la structure des effets, jamais leur texte (01-contrats.md § 15.8).
// Écrit par `npm run cards:new -- ST17` (niveau 'generated'), puis relu par la tâche « set » : une recette relue
// et prouvée passe 'verified' à la main ; une lecture douteuse passe 'doubt', avec sa question.
// cards:new ajoute les nouvelles entrées au-dessus du repère de fin et, avec --regenerer, ne remplace que les lignes
// 'generated' restées sur une ligne ; tout le reste (relectures, notes, mises en forme) est gardé tel quel.
import type { RecipeSet } from '../types.ts';

export const RECIPES_ST17: RecipeSet = {
  set: 'ST17',
  entries: {
    'ST17-001': { level: 'verified', recipe: { num: 'ST17-001', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'revealTop' } }, { cond: { kind: 'revealed', filter: { types: ['The Seven Warlords of the Sea'] } }, group: [{ action: { kind: 'draw', n: 2 } }, { action: { kind: 'handToBottom', n: 1, where: 'top' }, link: 'and' }] }] }] } },
    'ST17-002': { level: 'verified', recipe: { num: 'ST17-002', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'bounce', target: { side: 'any', zone: 'field', count: 1, upTo: true, filter: { costMax: 4 }, characters: true } }, cond: { kind: 'leaderType', types: ['The Seven Warlords of the Sea'] } }], cost: [{ kind: 'returnOwnChar', n: 1, filter: {} }] }] } },
    'ST17-003': { level: 'verified', recipe: { num: 'ST17-003', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'arrangeTop', look: 3, where: 'top' } }] }] } },
    'ST17-004': { level: 'doubt', doubt: { question: 'Les 3 cartes regardées vont-elles au-dessus ou au-dessous du deck chacune au choix, ou toutes ensemble du même côté ? (même question que le n° 1660)', readings: ['Chaque carte au choix : certaines au-dessus, les autres au-dessous (recette actuelle, n° 1660, comme la brique lookTopArrange des cartes déjà codées)', 'Toutes ensemble : les 3 au-dessus ou les 3 au-dessous, dans l\'ordre choisi (ce que suggère la VF)'] }, recipe: { num: 'ST17-004', abilities: [{ timing: 'onPlay', steps: [{ action: { kind: 'arrangeTop', look: 3, where: 'topOrBottom' } }, { action: { kind: 'giveDon', n: 1, upTo: true, rested: true, target: { side: 'own', zone: 'field', count: 1, upTo: false, filter: { types: ['The Seven Warlords of the Sea'] }, leader: true, characters: true } }, link: 'then' }] }], keywords: ['Blocker'] } },
    // cards:new : nouvelles entrées au-dessus de cette ligne
  },
};
