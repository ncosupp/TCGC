// CARTES D'OP04 CODÉES À LA MAIN (étape C, tâche S16) : celles que le traducteur ne comprend pas (remplacements, effets différés, évènements
// « quand ... », coûts propres à la carte) ou dont la brique contredit les Q&A. Codées d'après leur texte officiel (VO ; la VF manque pour
// presque tout le set) et les Q&A officielles ; les choix d'interprétation sont dans game/docs/interpretations.md (section « OP04 (tâche
// S16) », 3500 à 3599). Aucun texte de carte ici. Le reste du set est en recettes (recipes/sets/op04.ts).
import {
  addDelayed, addMod, canBeRested, canPlayCharacters, chooseUpToN, def, emit, describe, fieldCost, findField, giveRestedDon, leaveReplaced, log, other, playableByEffect, playCharacter,
  power, removeByEffect, removeFromField, restByEffect, shuffleDeck,
} from '../rules.ts';
import type { CardBehavior, EffectCtx, FieldCard, GameState, PlayerId } from '../types.ts';
import {
  all, anyChar, bothCosts, bottomOfDeck, bounce, candidates, card, charsAtLeast, chooseOne, costMod, discard, discardCost, donMinus, drawCards, effect, ko, leaderType, lifeFromDeck, matches,
  mayPay, oppChar, oppLeaderOrChar, otherThanSelf, ownChar, playThis, powerMod, readySelf, rest, restDon, restSelf, searchTop, selfDon, seq, setActiveTargets, trashSelf, trashToBottomCost, trashTop, when,
  type CharSpec, type Condition, type Cost, type Effect,
} from './bricks.ts';
import { addDonUpTo } from './bricks-don.ts';
import { pick } from './bricks-choice.ts';
import { activeLeaderMinus, modTargets } from './bricks-power.ts';
import { playFromHandAtCost } from './bricks-play.ts';

const ALABASTA = 'Alabasta';
const DOFLAMINGO_CREW = 'Donquixote Pirates';
const DRESSROSA = 'Dressrosa';
const KAIDO_CREW = 'Animal Kingdom Pirates';
const BAROQUE = 'Baroque Works';
const ICE_ONI = 'Ice Oni';
const CORRIDA = 'Corrida Coliseum';

const hasName = (num: string, name: string) => def(num).names.includes(name);

// « épuisez votre Leader » (coût) : le Leader doit être redressé
const restOwnLeader: Cost = {
  label: 'épuiser ton Leader',
  can: (s, p) => !s.players[p].leader.rested && canBeRested(s, s.players[p].leader.uid),
  pay: (ctx) => restByEffect(ctx, ctx.s.players[ctx.me].leader.uid),
};

// « placez dans votre Défausse 1 de vos Personnages ... » autre que celui qui porte l'effet (« ce Personnage et 1 de vos Personnages »,
// « 1 Personnage autre que celui-ci ») : sans autre Personnage, le coût ne se propose pas (8-3-1-3) ; carte publique, sortie annoncée
const trashOtherChar = (spec: CharSpec): Cost => {
  const list = (s: GameState, p: PlayerId, self: number) => s.players[p].chars.filter((c) => c.uid !== self && matches(s, c, spec)).map((c) => c.uid);
  return {
    label: 'placer 1 autre de tes Personnages dans ta Défausse',
    can: (s, p, self) => list(s, p, self).length > 0,
    pay: (ctx) => {
      const options = list(ctx.s, ctx.me, ctx.source);
      if (!options.length) return false;
      const uid = Number(ctx.ask({
        prompt: 'Personnage à placer dans ta Défausse :',
        options: options.map((u) => ({ id: `card:${u}`, label: describe(ctx.s, u), uid: u })),
        tag: 'trashOwn',
      }).split(':')[1]);
      if (leaveReplaced(ctx, uid)) return false;
      const f = removeFromField(ctx.s, uid, 'trash');
      if (!f) return false;
      log(ctx.s, ctx.me, `place ${def(f.card.num).name} dans sa Défausse`);
      emit(ctx.s, { type: 'leave', player: ctx.me, uid, num: f.card.num, zone: 'character', by: ctx.me, cause: 'effect', sourceNum: ctx.num });
      return true;
    },
  };
};

// une DON!! redressée plus tard, en fin de tour : a lieu même si la carte a quitté le terrain (Q&A de Senor Pink, Machvise)
const readyDonAtEnd = (source: string): Effect => effect((ctx) => {
  addDelayed(ctx.s, { turn: ctx.s.turn, player: ctx.me, action: 'untapDon', amount: 1, source });
  log(ctx.s, ctx.me, `redressera 1 DON!! à la fin du tour (${source})`);
});

// « si votre Leader est redressé » (Happiness Punch)
const leaderActive: Condition = (s, p) => !s.players[p].leader.rested;

// Super canards : retour de ce Personnage en main en fin de tour ; oublié s'il quitte le terrain avant
const bounceSelfAtEnd = (source: string): Effect => effect((ctx) => {
  if (findField(ctx.s, ctx.source)) addDelayed(ctx.s, { turn: ctx.s.turn, player: ctx.me, action: 'handChar', amount: 0, uid: ctx.source, source });
});

// Karoo : jusqu'à 1 DON!! épuisée à chacun de ses Personnages {Alabasta}, tant qu'il en reste (Q&A : autant que de DON!! épuisées de sa zone de Coût,
// jamais une DON!! déjà donnée) ; le joueur choisit lesquels
const giveDonEachAlabasta: Effect = effect((ctx) => {
  const served: number[] = [];
  while (ctx.s.players[ctx.me].donRested > 0) {
    const left = ctx.s.players[ctx.me].chars.filter((c) => def(c.num).types.includes(ALABASTA) && !served.includes(c.uid));
    if (!left.length) return;
    const answer = ctx.ask({
      prompt: 'Karoo : Personnage {Royaume d’Alabasta} qui reçoit 1 DON!! épuisée :',
      options: [...left.map((c) => ({ id: `card:${c.uid}`, label: describe(ctx.s, c.uid), uid: c.uid })), { id: 'none', label: 'Aucun' }],
      tag: 'donTarget',
    });
    if (answer === 'none') return;
    const uid = Number(answer.split(':')[1]);
    served.push(uid);
    giveRestedDon(ctx.s, ctx.me, uid, 1);
  }
}, (s, p) => s.players[p].donRested > 0 && s.players[p].chars.some((c) => def(c.num).types.includes(ALABASTA)));

// Queen (Leader) : piocher ; avec un Personnage de coût 8 ou plus, on peut ajouter la carte du dessus du deck à la Vie à la place (Q&A : le refus laisse la pioche)
const QUEEN_TOTAL = 4;
const queenAttack: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const replace = P.deck.length > 0 && charsAtLeast(1, { costMin: 8 })(ctx.s, ctx.me, ctx.source) && ctx.ask({
    prompt: 'Queen : ajouter la carte du dessus de ton deck au-dessus de ta Vie au lieu de piocher 1 carte ?',
    options: [{ id: 'yes', label: 'Oui' }, { id: 'no', label: 'Non' }],
    tag: 'may',
  }) === 'yes';
  (replace ? lifeFromDeck() : drawCards(1)).run(ctx);
}, () => true);

// Plague Rounds : le coût place 1 Personnage de coût 4 ou moins, des deux camps (Q&A), au-dessous du deck de son propriétaire
const bottomCheapChar: Cost = {
  label: 'placer 1 Personnage de coût 4 ou moins au-dessous du deck de son propriétaire',
  can: (s) => s.players.some((P) => P.chars.some((c) => fieldCost(s, c.uid) <= 4)),
  pay: (ctx) => {
    const options = ctx.s.players.flatMap((P) => P.chars.filter((c) => fieldCost(ctx.s, c.uid) <= 4).map((c) => c.uid));
    if (!options.length) return false;
    const uid = Number(ctx.ask({
      prompt: 'Personnage de coût 4 ou moins à placer au-dessous du deck de son propriétaire :',
      options: options.map((u) => ({ id: `card:${u}`, label: describe(ctx.s, u), uid: u })),
      tag: 'oppRemove',
    }).split(':')[1]);
    return removeByEffect(ctx, uid, 'deckBottom');
  },
};
// Jouer 1 [Ice Oni] de sa Défausse : obligatoire (Q&A : le joueur ne peut pas refuser)
const playIceOni: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const i = P.trash.findIndex((c) => hasName(c.num, ICE_ONI) && playableByEffect(c.num) && canPlayCharacters(ctx.s, ctx.me, c.num));
  if (i < 0) return;
  const [played] = P.trash.splice(i, 1);
  playCharacter(ctx, ctx.me, played, { from: 'trash' });
}, (s, p) => s.players[p].trash.some((c) => hasName(c.num, ICE_ONI)));
const plagueRounds: Effect = mayPay(bothCosts(discardCost(1, { name: ICE_ONI }), bottomCheapChar), playIceOni, 'Plague Rounds');

// Orlumbus : 1 de ses Personnages {Dressrosa} mis KO, obligatoire ; un Personnage qui ne peut pas être mis KO se choisit aussi : il reste (Q&A)
const koOwnDressrosa: Effect = effect((ctx) => {
  const list = ctx.s.players[ctx.me].chars.filter((c) => def(c.num).types.includes(DRESSROSA)).map((c) => c.uid);
  const [uid] = pick(ctx, list, { n: 1, forced: true }, 'Orlumbus : ton Personnage {Dressrosa} à mettre KO :', 'trashOwn');
  if (uid !== undefined) removeByEffect(ctx, uid, 'ko');
});

// Crocodile (Leader) : l'ordre avec ses effets déjà en attente (le [Jouée] de la carte jouée par un [Déclenchement] « DON!! −N : jouez cette carte ») est au
// choix de son propriétaire (Q&A) : s'il choisit l'autre d'abord, l'ajout est remis après ceux-là
const crocodileLeader = (ctx: EffectCtx) => {
  const { s, pending } = ctx;
  const queued = s.pending.filter((x) => x !== pending && x.kind !== 'system' && x.controller === ctx.me);
  if (queued.length && !pending.data?.deferred) {
    const answer = ctx.ask({
      prompt: 'Plusieurs de tes effets se déclenchent : lequel résoudre d’abord ?',
      options: [{ id: `first:${ctx.num}`, label: def(ctx.num).name, num: ctx.num }, { id: `first:${queued[0].num}`, label: def(queued[0].num).name, num: queued[0].num }],
      tag: 'order',
    });
    if (answer !== `first:${ctx.num}`) {
      const { snapshot: _snapshot, ...copy } = pending;
      s.pending.splice(s.pending.indexOf(queued[queued.length - 1]) + 1, 0, { ...copy, answers: [], data: { ...pending.data, deferred: 1 } });
      return;
    }
  }
  addDonUpTo(1, 'active', 'Crocodile').run(ctx);
};

// Mr.2 : la puissance de base devient celle de l'attaquant, lue quand l'effet se résout
const copyAttackerPower: Effect = effect((ctx) => {
  const { s } = ctx;
  if (!s.battle || !findField(s, ctx.source) || !findField(s, s.battle.attacker)) return;
  const amount = power(s, s.battle.attacker);
  addMod(s, { uid: ctx.source, stat: 'basePower', amount, until: 'turn', source: 'Mr.2.Bon.Kurei' });
  log(s, ctx.me, `Mr.2.Bon.Kurei a une puissance de base de ${amount} pour le tour`);
});

// Luffy : se redresse ; il ne se redressera pas lors de sa prochaine phase de Recharge
const readyThenLock = (source: string): Effect => effect((ctx) => {
  if (!findField(ctx.s, ctx.source)) return;
  readySelf().run(ctx);
  addMod(ctx.s, { uid: ctx.source, stat: 'noRefresh', amount: 0, until: ctx.s.turn + (ctx.s.active === ctx.me ? 2 : 1), source });
  log(ctx.s, ctx.me, `${def(ctx.num).name} ne se redressera pas lors de sa prochaine phase de Recharge (${source})`);
});

// « Gum-Gum King Kong Gun » : +6000, puis [Double attaque] à la même carte avec 15 cartes dans la Défausse (l'Événement y est déjà : Q&A)
const KING_KONG = 'Gum-Gum King Kong Gun';
const kingKong: Effect = effect((ctx) => {
  const list = candidates(ctx.s, ctx.me, ownChar({ type: DRESSROSA }));
  for (const uid of chooseUpToN(ctx, list, 1, `${KING_KONG} : Personnage {Dressrosa} qui gagne +6000 de puissance :`, 'ownPower')) {
    addMod(ctx.s, { uid, stat: 'power', amount: 6000, until: 'turn', source: KING_KONG });
    log(ctx.s, ctx.me, `${def(findField(ctx.s, uid)!.card.num).name} gagne +6000 de puissance pour le tour (${KING_KONG})`);
    if (ctx.s.players[ctx.me].trash.length >= 15) {
      addMod(ctx.s, { uid, stat: 'keyword', keyword: 'Double Attack', amount: 0, until: 'turn', source: KING_KONG });
      log(ctx.s, ctx.me, `${def(findField(ctx.s, uid)!.card.num).name} gagne [Double attaque] pour le tour (${KING_KONG})`);
    }
  }
}, (s, p) => candidates(s, p, ownChar({ type: DRESSROSA })).length > 0);

// Trueno Bastardo : un seul KO ; la borne passe de 4 à 6 avec 15 cartes dans la Défausse, l'Événement compris (Q&A)
const truenoLimit = (s: GameState, p: PlayerId) => (s.players[p].trash.length >= 15 ? 6 : 4);
const truenoBastardo: Effect = effect(
  (ctx) => ko(oppChar({ costMax: truenoLimit(ctx.s, ctx.me) }), 'Trueno Bastardo').run(ctx),
  // lu avant que l'Événement aille dans la Défausse : une carte de plus
  (s, p) => s.players[other(p)].chars.some((c) => fieldCost(s, c.uid) <= (s.players[p].trash.length >= 14 ? 6 : 4)),
);

// Kyros : le KO remplacé par l'épuisement de son Leader ou de son Lieu [Corrida Coliseum]
const kyrosOptions = (s: GameState, p: PlayerId) => {
  const P = s.players[p];
  return [P.leader, ...(P.stage && hasName(P.stage.num, CORRIDA) ? [P.stage] : [])].filter((c) => !c.rested && canBeRested(s, c.uid));
};

export const OP04: Record<string, CardBehavior> = {
  // Karoo : [Activation : Principale] s'épuiser : voir plus haut
  'OP04-004': card({ activateMain: { label: 'Karoo : s’épuiser : jusqu’à 1 DON!! épuisée à chaque Personnage {Royaume d’Alabasta}', cost: restSelf(), effect: giveDonEachAlabasta } }),

  // Kung Fu Dugong : [Bloqueur] s'il y a une autre carte de ce nom (un Leader de ce nom compterait : n° 1992 ; il n'y en a aucun au catalogue)
  'OP04-005': {
    blocker: (s, p, self) => hasName(s.players[p].leader.num, 'Kung Fu Jugon') || s.players[p].chars.some((c) => c.uid !== self.uid && hasName(c.num, 'Kung Fu Jugon')),
  },

  // Super canards : [En attaquant] −5000 à son Leader redressé : retour en main à la fin du tour
  'OP04-009': card({ whenAttacking: mayPay(activeLeaderMinus(5000, 'Troupe Super Canard'), bounceSelfAtEnd('Troupe Super Canard'), 'Troupe Super Canard') }, { attackUseful: () => false }),

  // Happiness Punch : [Contre] −2000 ; puis, Leader redressé, −1000 à une carte, la même si on veut (Q&A)
  'OP04-017': card({
    onCounter: seq(
      powerMod(oppLeaderOrChar(), -2000, 'turn', 'Happiness Punch'),
      when(leaderActive, powerMod(oppLeaderOrChar(), -1000, 'turn', 'Happiness Punch')),
    ),
  }),

  // Senor Pink : [En attaquant] ① : avec un Leader {Donquixote Pirates} (la condition couvre le « Puis » : n° 1983), épuiser jusqu'à 1 Personnage adverse de
  // coût 4 ou moins, puis redresser jusqu'à 1 DON!! à la fin du tour (même si Senor Pink est parti : Q&A)
  'OP04-026': card({
    whenAttacking: mayPay(restDon(1), when(leaderType(DOFLAMINGO_CREW), seq(rest(oppChar({ costMax: 4 }), 'Senor Pink'), readyDonAtEnd('Senor Pink'))), 'Senor Pink'),
  }),

  // Machvise : [Jouée] avec un Leader {Donquixote Pirates}, épuiser jusqu'à 1 Personnage adverse de coût 5 ou moins, puis redresser jusqu'à 1 DON!! à la fin du
  // tour ; sans ce Leader, rien (Q&A) ; même si Machvise est parti (Q&A)
  'OP04-033': card({ onPlay: when(leaderType(DOFLAMINGO_CREW), seq(rest(oppChar({ costMax: 5 }), 'Machvise'), readyDonAtEnd('Machvise'))) }),

  // Queen (Leader) : [DON!! x1] [En attaquant] 4 cartes ou moins entre sa Vie et sa main : voir plus haut
  'OP04-040': card({
    whenAttacking: when(all(selfDon(1), (s, p) => s.players[p].life.length + s.players[p].hand.length <= QUEEN_TOTAL), queenAttack),
  }),

  // Ulti : [DON!! x1] [En attaquant] jusqu'à 1 Personnage de coût 2 ou moins, le sien compris, en main ou au-dessous du deck de son propriétaire, au choix du joueur de la carte (Q&A)
  'OP04-043': card({
    whenAttacking: when(selfDon(1), chooseOne('Ulti', [
      { label: 'Renvoyer dans la main 1 Personnage de coût 2 ou moins', effect: bounce(anyChar({ costMax: 2 }), 'Ulti') },
      { label: 'Placer au-dessous du deck 1 Personnage de coût 2 ou moins', effect: bottomOfDeck(anyChar({ costMax: 2 }), 'Ulti') },
    ])),
  }),

  // Queen : [Jouée] avec un Leader {Animal Kingdom Pirates}, 7 cartes regardées, jusqu'à 2 [Plague Rounds] ou [Ice Oni] au total, deux du même nom si on veut (Q&A)
  'OP04-046': card({
    onPlay: when(leaderType(KAIDO_CREW), searchTop(7, 2, { anyOf: [{ name: 'Plague Rounds' }, { name: ICE_ONI }] }, 'cartes [Plague Rounds] ou [Ice Oni]', 'bottom')),
  }),

  // Ice Oni : [Votre tour] à la fin d'un combat contre un Personnage adverse de coût 5 ou moins (lu à ce moment), ce Personnage au-dessous du deck de son propriétaire,
  // qu'Ice Oni ait perdu ou que la cible ait survécu ; mis KO dans le combat, il reste dans la Défausse (Q&A) ; si Ice Oni a quitté le terrain, l'effet ne s'active pas (8-1-3-1-3)
  'OP04-047': {
    when: [{
      on: 'battleEnd',
      if: (s, owner, self, e) => {
        if (s.active !== owner || e.uid !== self.uid || e.target === undefined) return false;
        const t = findField(s, e.target);
        return Boolean(t) && !t!.leader && !t!.stage && t!.player === other(owner) && fieldCost(s, e.target) <= 5;
      },
      run: (ctx, e) => { removeByEffect(ctx, e.target!, 'deckBottom'); },
    }],
  },

  // Sasaki : [Jouée] toute sa main dans son deck, mélange, puis pioche autant
  'OP04-048': card({
    onPlay: effect((ctx) => {
      const P = ctx.s.players[ctx.me];
      const n = P.hand.length;
      P.deck.push(...P.hand.splice(0));
      shuffleDeck(ctx.s, ctx.me);
      log(ctx.s, ctx.me, `remet ${n} carte${n > 1 ? 's' : ''} de sa main dans son deck et le mélange`);
      drawCards(n).run(ctx);
    }),
  }),

  // Plague Rounds : voir plus haut ; [Déclenchement] le même effet
  'OP04-055': card({ onMain: plagueRounds, onTrigger: plagueRounds }),

  // Crocodile (Leader) : [Tour adverse] [Une fois par tour] quand une DON!! de son terrain retourne au deck DON!! par un de ses effets, coûts compris (8-1-1), jusqu'à 1 DON!!
  // redressée. Pas quand l'effet est adverse
  'OP04-058': {
    when: [{
      on: 'donReturned',
      once: 'OP04-058:don',
      if: (s, owner, _self, e) => s.active !== owner && e.player === owner && (e.by === undefined || e.by === owner),
      run: crocodileLeader,
    }],
  },

  // Mr.2 : [Attaque adverse] DON!! −1 : voir plus haut ; [Déclenchement] DON!! −1 : jouer cette carte
  'OP04-069': card({
    onOpponentAttack: mayPay(donMinus(1), copyAttackerPower, 'Mr.2.Bon.Kurei'),
    onTrigger: mayPay(donMinus(1), playThis(), 'Mr.2.Bon.Kurei'),
  }),

  // Mr.13 et Miss Friday : [Activation : Principale] se placer dans la Défausse avec 1 autre de ses Personnages Baroque Works : jusqu'à 1 DON!! redressée ; [Déclenchement] jouer cette carte
  'OP04-073': card({
    activateMain: {
      label: 'Mr.13 et Miss Friday : 2 Personnages dans la Défausse : jusqu’à 1 DON!! redressée',
      cost: bothCosts(trashSelf(), trashOtherChar({ typeIncludes: BAROQUE })),
      effect: addDonUpTo(1, 'active', 'Mr.13 & Ms.Friday'),
    },
    onTrigger: playThis(),
  }),

  // Orlumbus : [Activation : Principale] [Une fois par tour] −4 de coût à un Personnage adverse, 2 cartes du deck à la Défausse, puis KO obligatoire (voir plus haut)
  'OP04-079': card({
    activateMain: {
      label: 'Orlumbus : −4 de coût, 2 cartes du deck dans la Défausse, puis KO de 1 de tes Personnages {Dressrosa}',
      once: true,
      // l'IA heuristique ne sait pas préparer le KO qui suit : elle n'y perdrait qu'un Personnage (le joueur, lui, peut toujours l'activer)
      effect: { ...seq(costMod(oppChar(), -4, 'turn', 'Orlumbus'), trashTop(2), koOwnDressrosa), useful: () => false },
    },
  }),

  // Cavendish : [DON!! x1] peut attaquer les Personnages redressés ; [En attaquant] épuiser son Leader : KO de jusqu'à 1 Personnage adverse de coût 1 ou moins, puis 2 cartes du deck à la Défausse
  'OP04-081': card({
    whenAttacking: mayPay(restOwnLeader, seq(ko(oppChar({ costMax: 1 }), 'Cavendish'), trashTop(2)), 'Cavendish'),
  }, {
    attackActive: (_s, _p, self) => self.don >= 1,
  }),

  // Kyros : voir plus haut (par koReplace : KO payé en coût compris, le coût n'est alors pas payé, Q&A d'Hakuba OP05-087) ; [Jouée] avec un Leader [Rebecca], KO de
  // jusqu'à 1 Personnage adverse de coût 1 ou moins, puis 1 carte du deck à la Défausse (la condition couvre le « Puis »)
  'OP04-082': card({
    onPlay: when((s, p) => hasName(s.players[p].leader.num, 'Rebecca'), seq(ko(oppChar({ costMax: 1 }), 'Kyros'), trashTop(1))),
  }, {
    koReplace: {
      label: 'Épuiser ton Leader ou [Corrida Coliseum]',
      condition: (s, p) => kyrosOptions(s, p).length > 0,
      apply: (s, p, _self, ctx) => {
        const options = kyrosOptions(s, p);
        const uid = options.length === 1 ? options[0].uid : Number(ctx.ask({
          player: p,
          prompt: 'Kyros : carte à épuiser à la place du KO :',
          options: options.map((c) => ({ id: `card:${c.uid}`, label: describe(s, c.uid), uid: c.uid })),
          tag: 'restCost',
        }).split(':')[1]);
        const f = findField(s, uid)!;
        f.card.rested = true;
        log(s, p, `épuise ${def(f.card.num).name} : Kyros n'est pas mis KO`);
        emit(s, { type: 'rest', player: p, uid, num: f.card.num, zone: f.leader ? 'leader' : 'stage', by: p, cause: 'effect', sourceNum: 'OP04-082' });
      },
    },
  }),

  // Sabo : [Bloqueur] ; [Jouée] ses Personnages présents (pas ceux joués ensuite : Q&A) ne peuvent pas être mis KO par un effet jusqu'au début de son prochain tour ; puis piocher 2 et défausser 2
  'OP04-083': card({
    onPlay: seq(
      modTargets(ownChar(), { stat: 'cantBeKO', scope: 'effect', amount: 0 }, 'oppNextEnd', 'Sabo', 'ne peut pas être mis KO par un effet', { all: true }),
      drawCards(2),
      discard(2),
    ),
  }),

  // Chinjao : [DON!! x1] quand il combat et met KO un Personnage adverse, piocher 2 et défausser 2
  'OP04-086': {
    when: [{
      on: 'ko',
      if: (s, owner, self, e) => e.player === other(owner) && e.cause === 'battle' && e.zone === 'character' && s.battle?.attacker === self.uid && self.don >= 1,
      run: (ctx) => seq(drawCards(2), discard(2)).run(ctx),
    }],
  },

  // Luffy : peut attaquer les Personnages redressés ; [Activation : Principale] [Une fois par tour] 7 cartes de sa Défausse au-dessous de son deck (révélées, puis dans l'ordre de son choix : Q&A) : voir plus haut
  'OP04-090': card({
    activateMain: {
      label: 'Monkey.D.Luffy : 7 cartes de ta Défausse au-dessous de ton deck : se redresser',
      once: true,
      cost: trashToBottomCost(7),
      effect: readyThenLock('Monkey.D.Luffy'),
    },
  }, {
    attackActive: () => true,
  }),

  // Gum-Gum King Kong Gun : voir plus haut ; [Déclenchement] piocher 3, défausser 2
  'OP04-093': card({ onMain: kingKong, onTrigger: seq(drawCards(3), discard(2)) }),

  // Trueno Bastardo : voir plus haut ; [Déclenchement] épuiser son Leader : KO de jusqu'à 1 Personnage adverse de coût 5 ou moins
  'OP04-094': card({
    onMain: truenoBastardo,
    onTrigger: mayPay(restOwnLeader, ko(oppChar({ costMax: 5 }), 'Trueno Bastardo'), 'Trueno Bastardo'),
  }),

  // Corrida Coliseum (Lieu) : avec un Leader {Dressrosa}, ses Personnages {Dressrosa} peuvent attaquer les Personnages le tour où ils sont joués
  'OP04-096': {
    keywordAura: (s, p, _src, target, k) => k === 'Rush: Character' && def(s.players[p].leader.num).types.includes(DRESSROSA)
      && s.players[p].chars.some((c) => c.uid === target.uid) && def(target.num).types.includes(DRESSROSA),
  },

  // Hera : [Activation : Principale] placer 1 autre de ses Personnages {Homies} dans la Défausse (un autre exemplaire aussi : Q&A) et s'épuiser : redresser jusqu'à 1 de ses
  // Personnages [Charlotte Linlin] ; [Déclenchement] jouer cette carte
  'OP04-111': card({
    activateMain: {
      label: 'Hera : 1 Personnage {Homies} dans la Défausse et s’épuiser : redresser [Charlotte Linlin]',
      cost: bothCosts(trashOtherChar({ type: 'Homies' }), restSelf()),
      effect: setActiveTargets(ownChar({ name: 'Charlotte Linlin' }), 'Hera'),
    },
    onTrigger: playThis(),
  }),

  // Nefertari Vivi : ses autres Personnages rouges de coût 3 ou plus ont [Initiative] ; le coût est lu au moment d'attaquer (Q&A)
  'OP04-118': {
    keywordAura: (s, p, source, target, k) => k === 'Rush' && target.uid !== source.uid && s.players[p].chars.some((c) => c.uid === target.uid)
      && def(target.num).colors.includes('Red') && fieldCost(s, target.uid) >= 3,
  },

  // Rosinante : [Tour adverse] épuisé, ses Personnages redressés de coût de base 5 ne peuvent pas être mis KO par un effet, même mis KO en même temps que lui (Q&A) ;
  // [Jouée] s'épuiser : jouer jusqu'à 1 Personnage vert de coût 5 de sa main
  'OP04-119': card({
    onPlay: mayPay(restSelf(), playFromHandAtCost({ color: 'Green', costMin: 5, costMax: 5 }, 'Don Quijote Rosinante'), 'Don Quijote Rosinante'),
  }, {
    koShield: (s, p, source: FieldCard, target, cause) => cause === 'effect' && s.active !== p && source.rested && !target.rested && target.uid !== source.uid && def(target.num).cost === 5
      && s.players[p].chars.some((c) => c.uid === target.uid),
    koShieldBatch: true,
  }),
};
