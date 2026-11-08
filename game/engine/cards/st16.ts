// CARTE DE ST16 CODÉE À LA MAIN (étape C, tâche S10) : valeur liée au nombre de cartes défaussées. Interprétations :
// game/docs/interpretations.md (2900 à 2999). Aucun texte de carte ici.
import { addMod, def, discardFromHand, findField, log } from '../rules.ts';
import type { Card, CardBehavior } from '../types.ts';
import { candidates, card, ownLeaderOrChar, type Effect } from './bricks.ts';

const isMusic = (c: Card) => def(c.num).types.includes('Music');

// Gordon : [Attaque adverse] défausser autant de cartes {Musique} qu'il veut (une question par carte), puis son Leader ou
// 1 de ses Personnages gagne +1000 pour le combat par carte défaussée
const gordon: Effect = {
  run: (ctx) => {
    const P = ctx.s.players[ctx.me];
    let n = 0;
    while (P.hand.some(isMusic)) {
      const answer = ctx.ask({
        prompt: `Gordon : défausser une carte {Musique} de ta main (+1000 pour le combat)${n ? ` (déjà ${n})` : ''} ?`,
        options: [{ id: 'yes', label: 'Oui' }, { id: 'no', label: 'Non' }],
        tag: 'may',
      });
      if (answer !== 'yes') break;
      if (!discardFromHand(ctx, ctx.me, 1, 'Gordon : carte {Musique} à défausser :', isMusic)) break;
      n++;
    }
    if (!n) return;
    const list = candidates(ctx.s, ctx.me, ownLeaderOrChar());
    const answer = ctx.ask({
      prompt: `Gordon : carte qui gagne +${1000 * n} de puissance pour le combat :`,
      options: list.map((uid) => ({ id: `card:${uid}`, label: def(findField(ctx.s, uid)!.card.num).name, uid })),
      tag: 'ownPower',
    });
    const uid = Number(answer.split(':')[1]);
    addMod(ctx.s, { uid, stat: 'power', amount: 1000 * n, until: 'battle', source: 'Gordon' });
    log(ctx.s, ctx.me, `${def(findField(ctx.s, uid)!.card.num).name} gagne +${1000 * n} de puissance pour le combat (Gordon)`);
  },
  useful: (s, p) => s.players[p].hand.some(isMusic),
};

export const ST16: Record<string, CardBehavior> = {
  'ST16-002': card({ onOpponentAttack: gordon }),
};
