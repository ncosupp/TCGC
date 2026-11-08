// CARTE DE ST17 CODÉE À LA MAIN (étape C, tâche S10) : coût « placer 1 carte de sa main au-dessus de son deck », absent
// du format des recettes. Aucun texte de carte ici.
import type { CardBehavior } from '../types.ts';
import { card, giveDon, ownLeaderOrChar } from './bricks.ts';
import { handToDeck } from './bricks-cards.ts';

export const ST17: Record<string, CardBehavior> = {
  // Marshall D. Teach : [Une fois par tour] placer 1 carte de sa main au-dessus de son deck : donner jusqu'à 2 DON!!
  // épuisées à son Leader ou à 1 de ses Personnages
  'ST17-005': card({
    activateMain: {
      label: 'Marshall D. Teach : placer 1 carte de ta main au-dessus de ton deck et donner 2 DON!! épuisées',
      once: true,
      cost: {
        label: 'placer 1 carte de ta main au-dessus de ton deck',
        can: (s, p) => s.players[p].hand.length > 0,
        pay: (ctx) => { handToDeck(1, 'top', 'Marshall D. Teach').run(ctx); return true; },
      },
      effect: giveDon(ownLeaderOrChar(), 2, 'Marshall D. Teach'),
    },
  }),
};
