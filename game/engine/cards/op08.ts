// CARTES D'OP08 CODÉES À LA MAIN (étape C, tâche S11) : celles que le traducteur ne comprend pas ou que le format des
// recettes ne sait pas dire (DON!! données à chacun, coût « retourner 2 Vies », effet différé, jouer un Lieu, évènements
// « quand ... »). Codées d'après leur texte officiel VO et VF et les Q&A officielles, avec les briques existantes ; les
// choix d'interprétation sont dans game/docs/interpretations.md (section « OP08 et ST14 (tâche S11) », 3000 à 3099).
// Aucun texte de carte ici. Le reste du set est en recettes (recipes/sets/op08.ts).
import {
  addDelayed, addMod, bottomOrder, chooseUpTo1, def, describe, fieldCost, findField, giveRestedDon, hasType, log, other, playCharacter,
  playFromHandFree, restByEffect, reveal, uniqueByNum, untilOpponentsNextEnd,
} from '../rules.ts';
import type { Card, CardBehavior, EffectCtx, FieldCard, GameEvent, GameState, PlayerId } from '../types.ts';
import { pick } from './bricks-choice.ts';
import {
  addDon, candidates, card, defenderPower, discard, drawCards, effect, ko, leaderType, oppChar, oppHandToBottom, playFromTrash,
  rest, restCost, searchTop, seq, trashLifeCost, trashTop, when, withCost, type Cost, type Effect,
} from './bricks.ts';
import { isNamed } from './common.ts';

const UPPER_YARD = 'Upper Yard';
const SHANDIAN = 'Shandian Warrior';

// « Jouez jusqu'à 1 [Upper Yard] de votre main » : ce nom est celui d'un Lieu (playFromHand ne joue que des Personnages)
const playUpperYard = (source: string): Effect => effect((ctx) => {
  playFromHandFree(ctx, (c) => isNamed(c.num, UPPER_YARD), `${source} : jouer jusqu’à 1 [${UPPER_YARD}] de ta main :`);
}, (s, p) => s.players[p].hand.some((c) => isNamed(c.num, UPPER_YARD)));

// Tony-Tony Chopper (Leader) : jusqu'à 3 Personnages {Animal} ou {Drum Kingdom} reçoivent chacun 1 DON!! épuisée (sans
// assez de DON!! épuisées, on n'en choisit pas plus qu'il n'y en a)
const CHOPPER = 'Tony-Tony Chopper';
const chopperList = (s: GameState, p: PlayerId) => s.players[p].chars
  .filter((c) => hasType(c.num, 'Animal') || hasType(c.num, 'Drum Kingdom')).map((c) => c.uid);
const chopperDon: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const chosen = pick(ctx, chopperList(ctx.s, ctx.me), { n: Math.min(3, P.donRested) }, `${CHOPPER} : Personnage qui reçoit 1 DON!! épuisée`, 'donTarget');
  for (const uid of chosen) {
    if (giveRestedDon(ctx.s, ctx.me, uid, 1)) log(ctx.s, ctx.me, `donne 1 DON!! épuisée à ${describe(ctx.s, uid)} (${CHOPPER})`);
  }
}, (s, p) => s.players[p].donRested > 0 && chopperList(s, p).length > 0);

// Shakuyaku : « quand un Personnage quitte le terrain à cause de votre effet » : les retraits annoncés par le moteur (KO
// par effet et évènement 'leave', comme Moby Dick OP08-056), n° 3004
const shakuyakuIf = (s: GameState, owner: PlayerId, _self: FieldCard, e: GameEvent) => s.active === owner && e.by === owner
  && e.cause === 'effect' && e.zone === 'character';
const shakuyakuRun = (ctx: EffectCtx) => {
  if (ctx.s.players[ctx.opp].hand.length < 5) return;
  oppHandToBottom(1, 'Shakuyaku').run(ctx);
  const self = findField(ctx.s, ctx.source);
  if (self && !self.card.rested) restByEffect(ctx, ctx.source);
};

// Charlotte Pudding (Leader) : coût « retourner les 2 cartes du dessus de la Vie face visible » : il faut 2 cartes, toutes
// deux face cachée (Q&A)
const flipTwoLife: Cost = {
  label: 'retourner les 2 cartes du dessus de ta Vie face visible',
  can: (s, p) => s.players[p].life.length >= 2 && s.players[p].life.slice(0, 2).every((c) => !c.faceUp),
  pay: (ctx) => {
    const top = ctx.s.players[ctx.me].life.slice(0, 2);
    if (top.length < 2 || top.some((c) => c.faceUp)) return false;
    for (const c of top) c.faceUp = true;
    reveal(ctx.s, top.map((c) => c.uid), 'both');
    log(ctx.s, ctx.me, `retourne les 2 cartes du dessus de sa Vie face visible (${top.map((c) => def(c.num).name).join(', ')})`);
    return true;
  },
};

// « People's Dreams » : la carte du dessus du deck va dans la Défausse ; si son coût est de 6 ou plus, +5000 pour le combat
const DREAMS = 'People’s Dreams Don’t Ever End!!';
const dreamsCounter: Effect = effect((ctx) => {
  const top = ctx.s.players[ctx.me].deck[0];
  if (!top) return;
  trashTop(1).run(ctx);
  if ((def(top.num).cost ?? 0) >= 6) defenderPower(5000, DREAMS).run(ctx);
}, (s, p) => s.players[p].deck.length > 0);

// South Bird : « regardez 7 cartes du dessus et jouez jusqu'à 1 [Upper Yard] ; le reste au-dessous du deck »
const SOUTH_BIRD = 'South Bird';
const southBird: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const looked = P.deck.splice(0, 7);
  const options = uniqueByNum(looked.filter((c) => isNamed(c.num, UPPER_YARD)));
  let chosen: Card | null = null;
  if (options.length) {
    const answer = ctx.ask({
      prompt: `${SOUTH_BIRD} : tu regardes ${looked.map((c) => def(c.num).name).join(', ')}. Jouer jusqu’à 1 [${UPPER_YARD}] ?`,
      options: [...options.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucune' }],
      tag: 'playFree',
      cards: looked.map((c) => ({ uid: c.uid, num: c.num, owner: ctx.me })),
    });
    if (answer !== 'none') [chosen] = looked.splice(looked.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1);
  }
  const ordered = bottomOrder(ctx, looked);
  P.deck.push(...ordered);
  reveal(ctx.s, ordered.map((c) => c.uid), ctx.me);
  log(ctx.s, ctx.me, `regarde 7 cartes du dessus de son deck (${SOUTH_BIRD})`);
  if (chosen) playCharacter(ctx, ctx.me, chosen);
}, (s, p) => s.players[p].deck.length > 0);

// Silvers Rayleigh : « jusqu'à 2 Personnages adverses : −3000 à l'un, −2000 à l'autre » jusqu'à la fin du prochain tour
// adverse (chaque valeur à part : on peut n'en donner qu'une), puis KO d'un Personnage de 3000 de puissance ou moins, qui
// peut être un autre (Q&A)
const RAYLEIGH = 'Silvers Rayleigh';
const rayleighMinus: Effect = effect((ctx) => {
  const chosen: number[] = [];
  for (const amount of [3000, 2000]) {
    const list = candidates(ctx.s, ctx.me, oppChar(), undefined, ctx.source).filter((uid) => !chosen.includes(uid));
    const uid = chooseUpTo1(ctx, list, `${RAYLEIGH} : Personnage adverse qui reçoit −${amount} de puissance :`, 'oppPower');
    if (uid === null) continue;
    chosen.push(uid);
    addMod(ctx.s, { uid, stat: 'power', amount: -amount, until: untilOpponentsNextEnd(ctx.s, ctx.me), source: RAYLEIGH });
    log(ctx.s, ctx.me, `${describe(ctx.s, uid)} reçoit −${amount} de puissance jusqu'à la fin du prochain tour adverse (${RAYLEIGH})`);
  }
}, (s, p) => s.players[other(p)].chars.length > 0);

// « Aucun de vos Personnages ne peut être mis KO par des effets adverses jusqu'à la fin du prochain tour adverse » : ceux
// du terrain à la résolution, pas ceux joués ensuite (Q&A, n° 3002)
const COMRADE = 'We Would Never Sell a Comrade to an Enemy!!!';
const noKoByOpp: Effect = effect((ctx) => {
  for (const c of ctx.s.players[ctx.me].chars) {
    addMod(ctx.s, { uid: c.uid, stat: 'cantBeKO', scope: 'oppEffect', amount: 0, until: untilOpponentsNextEnd(ctx.s, ctx.me), source: COMRADE });
  }
  log(ctx.s, ctx.me, `ses Personnages ne peuvent pas être mis KO par des effets adverses jusqu'à la fin du prochain tour adverse (${COMRADE})`);
}, (s, p) => s.players[p].chars.length > 0);

const draw2Trash1 = seq(drawCards(2), discard(1));

export const OP08: Record<string, CardBehavior> = {
  // Tony-Tony Chopper (Leader) : [Activation : Principale] [Une fois par tour] 1 DON!! épuisée à chacun de jusqu'à 3
  // Personnages {Animal} ou {Drum Kingdom}
  'OP08-001': card({
    activateMain: { label: `${CHOPPER} : donner 1 DON!! épuisée à chacun de jusqu’à 3 Personnages {Animal} ou {Royaume de Drum}`, once: true, effect: chopperDon },
  }),

  // Chessmarimo : [Votre tour] +2000 avec au moins un [Kuromarimo] et un [Chess] dans sa Défausse (un autre Chessmarimo ne
  // compte pas, Q&A)
  'OP08-006': {
    selfPower: (s, p) => (s.active === p && ['Kuromarimo', 'Chess'].every((n) => s.players[p].trash.some((c) => isNamed(c.num, n))) ? 2000 : 0),
  },

  // Pekoms : s'il est redressé, ses Personnages {Minks} de coût 3 ou moins autres que [Pekoms] ne peuvent pas être mis KO
  // par des effets (ceux des deux camps)
  'OP08-029': {
    koShield: (s, p, src, target, cause) => cause === 'effect' && !src.rested && s.players[p].chars.some((c) => c.uid === target.uid)
      && hasType(target.num, 'Minks') && fieldCost(s, target.uid) <= 3 && !isNamed(target.num, 'Pekoms'),
  },

  // [Principale] épuiser 2 de ses Personnages : voir noKoByOpp ; [Déclenchement] épuiser un Personnage adverse de coût 3 ou moins
  'OP08-038': card({
    onMain: withCost(restCost(2, 'characters'), noKoByOpp, COMRADE),
    onTrigger: rest(oppChar({ costMax: 3 }), COMRADE),
  }),

  // Shakuyaku : [Votre tour] [Une fois par tour] quand un Personnage quitte le terrain à cause de votre effet : avec 5
  // cartes ou plus en main adverse, l'adversaire en place 1 au-dessous de son deck, puis elle s'épuise (n° 3004)
  'OP08-046': {
    when: [
      { on: 'ko', once: 'OP08-046:removed', if: shakuyakuIf, run: shakuyakuRun },
      { on: 'leave', once: 'OP08-046:removed', if: shakuyakuIf, run: shakuyakuRun },
    ],
  },

  // Charlotte Pudding (Leader) : [En attaquant] retourner 2 cartes de Vie du dessus face visible : 1 DON!! épuisée
  'OP08-058': card({ whenAttacking: withCost(flipTwoLife, addDon(1, 'rested'), 'Charlotte Pudding') }),

  // [Contre] voir dreamsCounter ; [Déclenchement] jouer un Personnage noir de coût 3 ou moins de sa Défausse
  'OP08-096': card({
    onCounter: dreamsCounter,
    onTrigger: playFromTrash({ color: 'Black', costMax: 3 }, DREAMS),
  }),

  // South Bird : [Jouée] voir southBird
  'OP08-100': card({ onPlay: southBird }),

  // Charlotte Angel : [Activation : Principale] [Une fois par tour] Vie du dessus dans la Défausse : avec un Leader {Big
  // Mom Pirates}, à la fin du tour, la carte du dessus du deck au-dessus de la Vie (même si Angel a quitté le terrain, n° 3006)
  'OP08-101': card({
    activateMain: {
      label: 'Charlotte Angel : Vie du dessus dans la Défausse ; à la fin du tour, 1 carte du deck dans la Vie',
      once: true,
      cost: trashLifeCost('top'),
      effect: effect((ctx) => {
        if (!leaderType('Big Mom Pirates')(ctx.s, ctx.me, ctx.source)) return;  // le coût se paie, rien ne suit (n° 1000)
        addDelayed(ctx.s, { turn: ctx.s.turn, player: ctx.me, action: 'lifeFromDeck', amount: 1, source: 'Charlotte Angel' });
        log(ctx.s, ctx.me, 'ajoutera la carte du dessus de son deck à sa Vie à la fin du tour (Charlotte Angel)');
      }),
    },
  }),

  // Jewelry Bonney : [DON!! x1] [Votre tour] [Une fois par tour] quand une carte quitte la Vie adverse (quelle qu'en soit
  // la cause, n° 3007) : piocher 2, défausser 1 ; [Déclenchement] piocher 2, défausser 1
  'OP08-105': card({ onTrigger: draw2Trash1 }, {
    when: [{
      on: 'lifeRemoved',
      once: 'OP08-105:life',
      if: (s, owner, self, e) => e.player === other(owner) && s.active === owner && self.don >= 1,
      run: (ctx) => { draw2Trash1.run(ctx); },
    }],
  }),

  // Wiper : [Jouée] 5 cartes du dessus : 1 [Upper Yard] en main, le reste au-dessous du deck, puis jouer jusqu'à 1 [Upper
  // Yard] de sa main
  'OP08-110': card({ onPlay: seq(searchTop(5, 1, { name: UPPER_YARD }, `un [${UPPER_YARD}]`), playUpperYard('Wiper')) }),

  // « The Earth Will Not Lose! » : [Contre] avec un Leader {Shandian Warrior}, +3000 pour le combat, puis jouer jusqu'à 1
  // [Upper Yard] de sa main ; sans ce Leader, rien, le « Puis » compris (n° 3001) ; [Déclenchement] piocher 2, défausser 1
  'OP08-115': card({
    onCounter: when(leaderType(SHANDIAN), seq(defenderPower(3000, 'The Earth Will Not Lose!'), playUpperYard('The Earth Will Not Lose!'))),
    onTrigger: draw2Trash1,
  }),

  // Silvers Rayleigh : [Jouée] voir rayleighMinus, puis KO d'un Personnage adverse de 3000 de puissance ou moins
  'OP08-118': card({ onPlay: seq(rayleighMinus, ko(oppChar({ powerMax: 3000 }), RAYLEIGH)) }),
};

// Morceaux de recettes codés à la main (aucun pour l'instant)
export const MANUAL_OP08 = {};
