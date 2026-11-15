// Registre des cartes : CARDS, rempli par loadCardData (cards/index.ts), et la carte cachée des parties en ligne.
// Module feuille (il n'importe que des types) : le moteur (rules.ts), les briques et le compilateur des recettes le
// lisent sans passer par cards/index.ts, qui importe tous les fichiers de cartes. Avant l'audit du 14 novembre 2026,
// rules.ts importait CARDS de cards/index.ts : rules.ts, les 60 fichiers de cartes, les briques et le compilateur des
// recettes formaient un seul cycle d'imports de 78 fichiers, et l'ordre des imports au démarrage comptait (un plantage
// du serveur, voir server/game-verify.js).
import type { CardDef } from '../types.ts';

// Carte cachée, telle qu'un joueur la voit dans une partie en ligne (main adverse, decks, Vies face cachée : voir
// view.ts). L'interface peut la lire sans erreur ; elle l'affiche de dos.
export const HIDDEN = '?';
const HIDDEN_CARD: CardDef = {
  number: HIDDEN, imageId: '', lang: 'fr', rarity: '', category: 'CHARACTER', name: 'Carte cachée', names: [], cost: null,
  life: null, power: null, counter: null, colors: [], types: [], typeLabels: [], attributes: [], effect: '', trigger: null,
  effectEn: '', triggerEn: null, keywords: [], blocks: [],
};

// Rempli par loadCardData (toujours le même objet : les modules qui l'importent voient les cartes chargées)
export const CARDS: Record<string, CardDef> = { [HIDDEN]: HIDDEN_CARD };
