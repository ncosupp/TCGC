// CARTE DE PRB01 CODÉE À LA MAIN (étape C, tâche S10) : filtre « sans effet [Jouée] », lu sur le texte VO de la carte (un
// effet annulé reste écrit, comme noBaseEffect de bricks.ts). Aucun texte de carte ici.
import { addMod, chooseUpTo1, def, findField, log } from '../rules.ts';
import type { CardBehavior, FieldCard, GameState, PlayerId } from '../types.ts';
import { candidates, card, ownChar, type Effect } from './bricks.ts';

const list = (s: GameState, p: PlayerId, self?: number) =>
  candidates(s, p, ownChar({ costMax: 8 }), (c: FieldCard) => !def(c.num).effectEn.includes('[On Play]'), self);

const sanjiRush: Effect = {
  run: (ctx) => {
    const uid = chooseUpTo1(ctx, list(ctx.s, ctx.me, ctx.source), 'Sanji : Personnage de coût 8 ou moins sans effet [Jouée] qui gagne [Initiative] :', 'ownGrant');
    if (uid === null) return;
    addMod(ctx.s, { uid, stat: 'keyword', keyword: 'Rush', amount: 0, until: 'turn', source: 'Sanji' });
    log(ctx.s, ctx.me, `${def(findField(ctx.s, uid)!.card.num).name} gagne [Initiative] pour le tour (Sanji)`);
  },
  useful: (s, p, self) => list(s, p, self).length > 0,
};

export const PRB01: Record<string, CardBehavior> = {
  // Sanji (Leader) : [Une fois par tour] jusqu'à 1 de ses Personnages de coût 8 ou moins sans effet [Jouée] gagne [Initiative]
  'PRB01-001': card({ activateMain: { label: 'Sanji : donner [Initiative] à un Personnage sans effet [Jouée]', once: true, effect: sanjiRush } }),
};
