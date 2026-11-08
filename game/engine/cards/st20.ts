// CARTES DE ST20 CODÉES À LA MAIN (étape C, tâche S10) : remplacement du KO par un effet, et [Déclenchement] qui ajoute
// la carte à la main. Aucun texte de carte ici.
import { def, log, reveal } from '../rules.ts';
import type { CardBehavior } from '../types.ts';
import { card, discardCost, effect, lookLifeArrange, playThis, seq, withCost, type Effect } from './bricks.ts';
import { koByEffect } from './op09.ts';

const CRACKER_KEY = 'st20-002';

// « Ajoutez cette carte à votre main » ([Déclenchement]) : la carte était révélée, elle reste connue des deux joueurs
const triggerToHand: Effect = effect((ctx) => {
  if (!ctx.trigger) return;
  ctx.trigger.moved = true;
  ctx.s.players[ctx.me].hand.push(ctx.trigger.card);
  reveal(ctx.s, [ctx.trigger.card.uid], 'both');
  log(ctx.s, ctx.me, `ajoute ${def(ctx.trigger.card.num).name} à sa main`);
});

export const ST20: Record<string, CardBehavior> = {
  // Charlotte Cracker : [Une fois par tour] s'il devait être mis KO par un effet, placer dans la Défausse la carte du
  // dessus de sa Vie à la place ; [Déclenchement] défausser 1 carte : jouer cette carte
  'ST20-002': card({ onTrigger: withCost(discardCost(1), playThis(), 'Charlotte Cracker') }, {
    koReplace: {
      label: 'Charlotte Cracker : placer dans ta Défausse la carte du dessus de ta Vie',
      condition: (s, p, self) => koByEffect(s, self) && !self.usedOpt.includes(CRACKER_KEY) && s.players[p].life.length > 0,
      apply: (s, p, self) => {
        self.usedOpt.push(CRACKER_KEY);
        const P = s.players[p];
        const top = P.life.shift();
        if (!top) return;
        P.trash.push({ uid: top.uid, num: top.num });
        log(s, p, `place dans sa Défausse la carte du dessus de sa Vie : ${def(top.num).name} (${P.life.length} Vie) ; Charlotte Cracker n'est pas mis KO`);
      },
    },
  }),

  // Charlotte Brûlée : [Déclenchement] regarder jusqu'à 1 carte du dessus d'une Vie et la placer au-dessus ou au-dessous ;
  // puis ajouter cette carte à sa main
  'ST20-003': card({ onTrigger: seq(lookLifeArrange('Charlotte Brûlée'), triggerToHand) }),
};
