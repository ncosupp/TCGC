// OP18 (tâche « nouveau set », étape C) : cartes que le traducteur ne comprend pas, codées à la main d'après le texte
// officiel (VO et VF), et morceaux « code à la main » des recettes de recipes/sets/op18.ts (MANUAL_OP18). Aucun texte de
// carte ici : seulement ce que fait l'effet. Choix d'interprétation : voir les commentaires de chaque carte.
import {
  addMod, allField, canBeRested, canLeaveByEffect, canPlayCharacters, chooseUpTo1, def, discardFromHand, donOnField, emit, fieldCost,
  findField, giveRestedDon, handCost, knownFirst, leaveReplaced, log, may, other, playCharacter, playFromHandFree, power,
  removeByEffect, removeFromField, returnDon, reveal, setActive, shuffleDeck, triggerEffect, uniqueByNum, canTakeLife, lifeToHand,
  basePower, untilOpponentsNextEnd,
} from '../rules.ts';
import type { Card, CardBehavior, EffectCtx, GameState, Keyword, PlayerId } from '../types.ts';
import type { ManualRegistry } from '../recipes/types.ts';
import {
  anyChar, candidates, card, cardMatches, charsAtLeast, chooseOne, discardCost, donMinus, drawCards, effect, grant, keywordWhile, ko, leaderKeyword,
  leaderNamed, leaderType, leaderTypeIncludes, mayPay, myTurn, not, oppChar, oppDiscards, oppLeaderOrChar, ownChar, ownLeader,
  ownLeaderOrChar, powerMod, readySelf, rest, restDon, restOppCards, restSelf, selfKeyword, seq, trashTop, when, all,
  bottomOfDeck, playSelfFromTrash, type Condition, type Cost, type Effect,
} from './bricks.ts';
import { addDonUpTo, askDonCount, giveDonUpTo, readyDonUpTo } from './bricks-don.ts';
import { oncePerTurn } from './bricks-power.ts';
import { bounceSelfCost, removeChars } from './bricks-removal.ts';

// ---------- Briques propres au set ----------

const ownerCtx = (ctx: EffectCtx, owner: PlayerId): EffectCtx => ({
  ...ctx, me: owner, opp: other(owner), ask: (q) => ctx.ask({ ...q, player: q.player ?? owner }),
});

const nameOf = (s: GameState, uid: number) => def(findField(s, uid)!.card.num).name;

// « Si vous avez un Lieu ayant un coût de N ou plus » (son propre Lieu ; coût imprimé)
const stageCostAtLeast = (n: number): Condition => (s, p) => {
  const stage = s.players[p].stage;
  return Boolean(stage && (def(stage.num).cost ?? 0) >= n);
};

// « Votre Leader est redressé »
const leaderActive: Condition = (s, p) => !s.players[p].leader.rested;

// Coût « mettre KO 1 de vos Lieux ayant un coût de N ou moins » : le Lieu va dans la Défausse
const koOwnStage = (max: number): Cost => ({
  label: `mettre KO ton Lieu de coût ${max} ou moins`,
  can: (s, p) => {
    const stage = s.players[p].stage;
    return Boolean(stage && (def(stage.num).cost ?? 0) <= max);
  },
  pay: (ctx) => {
    const stage = ctx.s.players[ctx.me].stage;
    if (!stage || (def(stage.num).cost ?? 0) > max) return false;
    const f = removeFromField(ctx.s, stage.uid, 'trash');
    if (!f) return false;
    log(ctx.s, ctx.me, `met KO son Lieu ${def(f.card.num).name}`);
    return true;
  },
});

// « Jouez jusqu'à 1 carte [de ce type / Lieu] de votre main ayant un coût de N ou moins » : un Personnage ou un Lieu (le coût
// lu est celui à payer, réductions comprises : Q&A d'OP07-064)
const playFromHandCard = (fits: (num: string) => boolean, max: number, source: string, what: string): Effect => {
  const eligible = (s: GameState, p: PlayerId, c: Card) => {
    const d = def(c.num);
    return (d.category === 'CHARACTER' || d.category === 'STAGE') && fits(c.num) && handCost(s, p, c, true) <= max;
  };
  return effect((ctx) => {
    playFromHandFree(ctx, (c) => eligible(ctx.s, ctx.me, c), `${source} : jouer jusqu’à 1 ${what} de coût ${max} ou moins de ta main :`);
  }, (s, p) => s.players[p].hand.some((c) => eligible(s, p, c)));
};

// « Redressez jusqu'à 1 de vos cartes de type {Water Seven} » : Leader, Personnage ou Lieu
const readyWaterSeven = (source: string): Effect => {
  const list = (s: GameState, p: PlayerId) => allField(s, p).filter((c) => c.rested && def(c.num).types.includes('Water Seven')).map((c) => c.uid);
  return effect((ctx) => {
    const uid = chooseUpTo1(ctx, list(ctx.s, ctx.me), `${source} : carte {Water Seven} à redresser :`, 'ownReady');
    if (uid !== null) setActive(ctx.s, ctx.me, uid);
  }, (s, p) => list(s, p).length > 0);
};

// « Cette carte ne pourra pas être redressée lors de votre prochaine phase de Recharge » (pendant votre tour : celle du tour +2)
const noRefreshNextTurn = (source: string): Effect => effect((ctx) => {
  const f = findField(ctx.s, ctx.source);
  if (!f) return;
  addMod(ctx.s, { uid: ctx.source, stat: 'noRefresh', amount: 0, until: ctx.s.turn + 2, source });
  log(ctx.s, ctx.me, `${def(f.card.num).name} ne se redressera pas lors de sa prochaine phase de Recharge (${source})`);
}, () => false);

// « Donnez à un total de jusqu'à N de vos Leader ou Personnages 1 DON!! épuisée chacun » (une carte reçoit au plus 1 DON!!)
const giveDonSpread = (total: number, source: string): Effect => effect((ctx) => {
  const given: number[] = [];
  for (let i = 0; i < total && ctx.s.players[ctx.me].donRested > 0; i++) {
    const options = [ctx.s.players[ctx.me].leader, ...ctx.s.players[ctx.me].chars].filter((c) => !given.includes(c.uid)).map((c) => c.uid);
    const uid = chooseUpTo1(ctx, options, `${source} : carte qui reçoit 1 DON!! épuisée (${i + 1}/${total}) :`, 'donTarget');
    if (uid === null) return;
    given.push(uid);
    giveRestedDon(ctx.s, ctx.me, uid, 1);
  }
}, (s, p) => s.players[p].donRested > 0);

// « Donnez à votre Leader et à tous vos Personnages jusqu'à N DON!! épuisées chacun » : le joueur répartit ses DON!!
// épuisées, carte par carte (le Leader d'abord)
const giveDonEach = (n: number, source: string): Effect => effect((ctx) => {
  for (const c of [ctx.s.players[ctx.me].leader, ...ctx.s.players[ctx.me].chars]) {
    const rested = ctx.s.players[ctx.me].donRested;
    if (rested <= 0) return;
    const k = askDonCount(ctx, Math.min(n, rested), `${source} : combien de DON!! épuisées donner à ${nameOf(ctx.s, c.uid)} ?`);
    if (k) giveRestedDon(ctx.s, ctx.me, c.uid, k);
  }
}, (s, p) => s.players[p].donRested > 0);

// « Ajoutez jusqu'à 1 carte [CP] de votre main au-dessus ou au-dessous de votre Vie, face visible »
const cpToLife = (source: string): Effect => {
  const fits = (num: string) => cardMatches(num, { typeIncludes: 'CP' });
  return effect((ctx) => {
    const P = ctx.s.players[ctx.me];
    const options = uniqueByNum(knownFirst(ctx.s, ctx.me, P.hand.filter((c) => fits(c.num))));
    if (!options.length) return;
    const answer = ctx.ask({
      prompt: `${source} : carte {CP} de ta main à placer face visible dans ta Vie :`,
      options: [...options.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucune' }],
      tag: 'toLife',
    });
    if (answer === 'none') return;
    const where = ctx.ask({
      prompt: `${source} : au-dessus ou au-dessous de ta Vie ?`,
      options: [{ id: 'top', label: 'Au-dessus' }, { id: 'bottom', label: 'Au-dessous' }],
      tag: 'lifeSide',
    });
    const [c] = P.hand.splice(P.hand.findIndex((x) => x.uid === Number(answer.split(':')[1])), 1);
    const faceUp = { ...c, faceUp: true };
    if (where === 'top') P.life.unshift(faceUp);
    else P.life.push(faceUp);
    reveal(ctx.s, [c.uid], 'both');
    log(ctx.s, ctx.me, `place ${def(c.num).name} face visible ${where === 'top' ? 'au-dessus' : 'au-dessous'} de sa Vie (${source})`);
  }, (s, p) => s.players[p].hand.some((c) => fits(c.num)));
};

// [Déclenchement] des cartes {CP} jaunes : « si le type de votre Leader inclut CP, ... »
const ifCp = (then: Effect): Effect => when(leaderTypeIncludes('CP'), then);

// « Mettez KO ou épuisez jusqu'à 1 Personnage adverse ayant un coût de 6 ou moins » : un seul des deux
const koOrRest6 = (source: string): Effect => chooseOne(source, [
  { label: 'Mettre KO un Personnage adverse de coût 6 ou moins', effect: ko(oppChar({ costMax: 6 }), source) },
  { label: 'Épuiser un Personnage adverse de coût 6 ou moins', effect: rest(oppChar({ costMax: 6 }), source) },
]);

// ---------- Les cartes ----------

const BW = 'Baroque Works';
const isBW = (num: string) => def(num).types.some((t) => t.includes(BW));

export const OP18: Record<string, CardBehavior> = {
  // Kung-fu Dugong : [Votre tour] +1000 pour chacun de vos [Kung Fu Jugon] sur le terrain (lui compris)
  'OP18-005': {
    selfPower: (s, p) => (s.active === p ? 1000 * s.players[p].chars.filter((c) => def(c.num).names.includes('Kung Fu Jugon')).length : 0),
  },

  // Roronoa Zoro : [Une fois par tour] si un de ses Personnages {Alabasta} devait quitter le terrain à cause d'un effet adverse,
  // son Leader reçoit −2000 pour le tour à la place ; [En attaquant] jusqu'à 1 Personnage {Alabasta} gagne [Initiative]
  'OP18-017': card({
    whenAttacking: grant(ownChar({ type: 'Alabasta' }), { stat: 'keyword', keyword: 'Rush' }, 'turn', 'Roronoa Zoro', 'gagne [Initiative]'),
  }, {
    replaceRemoval: {
      oncePerTurn: true,
      onlyKo: false,
      label: (_s, _self, victim) => `Roronoa Zoro : donner −2000 à ton Leader pour que ${def(victim.num).name} reste sur le terrain`,
      condition: (s, owner, _self, victim) => def(victim.num).types.includes('Alabasta') && s.players[owner].chars.some((c) => c.uid === victim.uid),
      apply: (s, owner, _self, victim) => {
        addMod(s, { uid: s.players[owner].leader.uid, stat: 'power', amount: -2000, until: 'turn', source: 'Roronoa Zoro' });
        log(s, owner, `${def(victim.num).name} reste sur le terrain, son Leader reçoit −2000 de puissance (Roronoa Zoro)`);
      },
    },
  }),

  // Franky (Leader) : ses cartes Lieu en main ont Contre +3000 ; [Activation : Principale] [Une fois par tour] DON!! −1 : jouer
  // jusqu'à 1 Lieu de coût 5 ou moins de sa main (le moteur propose les Lieux au Contre : engine.ts, counterDecision)
  'OP18-021': card({
    activateMain: {
      label: 'Franky : DON!! −1, jouer un Lieu de coût 5 ou moins de ta main',
      once: true,
      cost: donMinus(1),
      effect: playFromHandCard((num) => def(num).category === 'STAGE', 5, 'Franky', 'Lieu'),
    },
  }, {
    handCounterOverride: (_s, _owner, _source, num) => (def(num).category === 'STAGE' ? 3000 : null),
  }),

  // Monkey D. Luffy (Leader) : [DON!! x3] [En attaquant] [Une fois par tour] il peut se redresser ; s'il le fait, il ne se
  // redressera pas lors de la prochaine phase de Recharge (la clé du « une fois par tour » est prise quand le joueur accepte)
  'OP18-022': card({
    whenAttacking: {
      run: (ctx) => {
        const f = findField(ctx.s, ctx.source);
        if (!f || f.card.don < 3 || f.card.usedOpt.includes('OP18-022') || !f.card.rested) return;
        if (!may(ctx, 'Monkey D. Luffy : redresser ton Leader ? (il ne se redressera pas à ta prochaine phase de Recharge)')) return;
        f.card.usedOpt.push('OP18-022');
        if (setActive(ctx.s, ctx.me, ctx.source)) noRefreshNextTurn('Monkey D. Luffy').run(ctx);
      },
      useful: (s, _p, self) => {
        const f = findField(s, self);
        return Boolean(f && f.card.don >= 3 && f.card.rested && !f.card.usedOpt.includes('OP18-022'));
      },
    },
  }),

  // Sanji : si un de ses Personnages {Straw Hat Crew} devait quitter le terrain à cause d'un effet adverse, il peut placer ce
  // Personnage dans sa Défausse à la place (pas pour lui-même : rien à gagner à se défausser à sa propre place)
  'OP18-026': {
    replaceRemoval: {
      oncePerTurn: false,
      onlyKo: false,
      label: (_s, _self, victim) => `Sanji : se placer dans ta Défausse pour que ${def(victim.num).name} reste sur le terrain`,
      condition: (s, owner, self, victim) => victim.uid !== self.uid && def(victim.num).types.includes('Straw Hat Crew')
        && s.players[owner].chars.some((c) => c.uid === victim.uid),
      apply: (s, owner, self, victim) => {
        const f = removeFromField(s, self.uid, 'trash');
        if (f) log(s, owner, `Sanji est placé dans la Défausse à la place de ${def(victim.num).name}`);
      },
    },
  },

  // Zoro et Sniperking : [Tour adverse] la puissance de base de son Leader [Monkey.D.Luffy] redressé ayant 3 DON!! ou plus
  // devient 7000 ; [Jouée] redresser jusqu'à 2 DON!!, puis jusqu'à 1 Personnage adverse de coût 6 ou moins ne peut pas être épuisé
  'OP18-027': card({
    onPlay: seq(
      readyDonUpTo(2, 'Zoro et Sniperking'),
      grant(oppChar({ costMax: 6 }), { stat: 'cantRest' }, 'oppNextEnd', 'Zoro et Sniperking', 'ne peut pas être épuisé'),
    ),
  }, {
    basePowerAura: (s, owner, _source, target) => (s.active !== owner && target.uid === s.players[owner].leader.uid
      && def(target.num).names.includes('Monkey.D.Luffy') && !target.rested && target.don >= 3 ? 7000 : null),
  }),

  // Tony-Tony Chopper (coût 9) : [Initiative] ; [En attaquant] [Une fois par tour] donner jusqu'à 3 DON!! épuisées à son Leader et
  // se redresser ; puis il ne se redressera pas lors de la prochaine phase de Recharge
  'OP18-029': card({
    whenAttacking: oncePerTurn('OP18-029', seq(giveDonUpTo(ownLeader(), 3, 'Tony-Tony Chopper'), readySelf(), noRefreshNextTurn('Tony-Tony Chopper'))),
  }),

  // Nico Robin : [Tour adverse] si un de ses Personnages devait quitter le terrain à cause d'un effet adverse, il peut épuiser
  // ce Personnage à la place ; [Fin de votre tour] redresser jusqu'à 1 carte {Water Seven} et jusqu'à 1 DON!!
  'OP18-031': card({
    endOfTurn: seq(readyWaterSeven('Nico Robin'), readyDonUpTo(1, 'Nico Robin')),
  }, {
    replaceRemoval: {
      oncePerTurn: false,
      onlyKo: false,
      label: (_s, _self, victim) => `Nico Robin : s’épuiser pour que ${def(victim.num).name} reste sur le terrain`,
      condition: (s, owner, self, victim) => s.active !== owner && !self.rested && canBeRested(s, self.uid) && s.players[owner].chars.some((c) => c.uid === victim.uid),
      apply: (s, owner, self, victim) => {
        self.rested = true;
        log(s, owner, `Nico Robin s'épuise, ${def(victim.num).name} reste sur le terrain`);
      },
    },
  }),

  // Franky (coût 6) : [Jouée] jouer jusqu'à 1 carte {La Franky Family} ou {Équipage de Chapeau de paille} de coût 5 ou moins de sa
  // main (un Personnage ou un Lieu) ; puis, avec un Lieu de coût 5 ou plus, épuiser jusqu'à 1 Personnage adverse de coût 6 ou moins
  'OP18-034': card({
    onPlay: seq(
      playFromHandCard((num) => def(num).types.some((t) => t === 'The Franky Family' || t === 'Straw Hat Crew'), 5, 'Franky', 'Personnage ou Lieu {La Franky Family} ou {Équipage de Chapeau de paille}'),
      when(stageCostAtLeast(5), rest(oppChar({ costMax: 6 }), 'Franky')),
    ),
  }),

  // Yokozuna : [Bloqueur] ; [En cas de KO] épuiser jusqu'à 1 carte adverse (Leader, Personnage, Lieu ou DON!!, comme les autres cartes
  // codées avec « carte adverse »)
  'OP18-037': card({ onKO: restOppCards(1, 'Yokozuna', { leader: true, stage: true, don: true }) }),

  // Gum-Gum Giant Axe : [Contre] jusqu'à 1 de vos [Monkey.D.Luffy] (Leader ou Personnage) +2000 pour le combat ; puis, avec un
  // Leader redressé, piocher 1 carte
  'OP18-039': card({
    onCounter: seq(
      powerMod(ownLeaderOrChar({ name: 'Monkey.D.Luffy' }), 2000, 'battle', 'Gum-Gum Giant Axe'),
      when(leaderActive, drawCards(1)),
    ),
  }),

  // Mr.0 et Ms. All Sunday : [Jouée] piocher 2 cartes et donner à son Leader et à tous ses Personnages jusqu'à 2 DON!! épuisées
  // chacun ; [Attaque adverse] défausser 1 carte : la puissance de base de son Leader incluant « Baroque Works » devient 7000
  'OP18-046': card({
    onPlay: seq(drawCards(2), giveDonEach(2, 'Mr.0 et Ms. All Sunday')),
    onOpponentAttack: mayPay(discardCost(1), when(leaderTypeIncludes(BW), effect((ctx) => {
      addMod(ctx.s, { uid: ctx.s.players[ctx.me].leader.uid, stat: 'basePower', amount: 7000, until: 'turn', source: 'Mr.0 et Ms. All Sunday' });
      log(ctx.s, ctx.me, 'la puissance de base de son Leader devient 7000 pour le tour (Mr.0 et Ms. All Sunday)');
    })), 'Mr.0 et Ms. All Sunday'),
  }),

  // Mr.1 (Daz Bonez) : [Jouée] son Leader de type {Cross Guild} ou incluant « Baroque Works » gagne [Imblocable] pour le tour
  'OP18-047': card({
    onPlay: when((s, p, self) => leaderType('Cross Guild')(s, p, self) || leaderTypeIncludes(BW)(s, p, self), leaderKeyword('Unblockable', 'turn', 'Mr.1 (Daz Bonez)')),
  }),

  // Mr.4 et Miss Merrychristmas : [DON!! x1] +1000 ; [Jouée] épuiser 5 DON!! : placer au-dessous du deck de son propriétaire jusqu'à
  // 1 Personnage de coût 6 ou moins et jusqu'à 1 Personnage (un autre) de coût 5 ou moins, dans l'ordre choisi par le propriétaire
  'OP18-051': card({
    onPlay: mayPay(restDon(5), effect((ctx) => {
      const src = 'Mr.4 et Miss Merrychristmas';
      const list = (max: number, not: number[]) => [...ctx.s.players[0].chars, ...ctx.s.players[1].chars]
        .filter((c) => !not.includes(c.uid) && fieldCost(ctx.s, c.uid) <= max && canLeaveByEffect(ctx.s, c.uid, ctx.me)).map((c) => c.uid);
      const a = chooseUpTo1(ctx, list(6, []), `${src} : Personnage de coût 6 ou moins à placer au-dessous du deck de son propriétaire :`, 'oppRemove');
      const b = chooseUpTo1(ctx, list(5, a === null ? [] : [a]), `${src} : Personnage de coût 5 ou moins à placer au-dessous du deck de son propriétaire :`, 'oppRemove');
      const chosen = [a, b].filter((x): x is number => x !== null);
      if (chosen.length === 2 && findField(ctx.s, chosen[0])!.player === findField(ctx.s, chosen[1])!.player) {
        // même propriétaire : il choisit l'ordre (la première carte placée est au-dessus de la seconde)
        const owner = findField(ctx.s, chosen[0])!.player;
        const first = ctx.ask({
          player: owner,
          prompt: `${src} : Personnage à placer en premier au-dessous de ton deck (l’autre sera au-dessous) :`,
          options: chosen.map((uid) => ({ id: `card:${uid}`, label: nameOf(ctx.s, uid), uid })),
          tag: 'bottomOrder',
        });
        if (Number(first.split(':')[1]) !== chosen[0]) chosen.reverse();
      }
      for (const uid of chosen) removeByEffect(ctx, uid, 'deckBottom');
    }, (s) => [...s.players[0].chars, ...s.players[1].chars].some((c) => fieldCost(s, c.uid) <= 6)), 'Mr.4 et Miss Merrychristmas'),
  }, {
    selfPower: (_s, _p, self) => (self.don >= 1 ? 1000 : 0),
  }),

  // Mr.8 et Ms. Monday : [DON!! x1] +1000 ; [Tour adverse] [Une fois par tour] si un de ses Personnages incluant « Baroque Works »
  // devait quitter le terrain à cause d'un effet adverse, il peut défausser 1 carte de sa main à la place
  'OP18-054': {
    selfPower: (_s, _p, self) => (self.don >= 1 ? 1000 : 0),
    replaceRemoval: {
      oncePerTurn: true,
      onlyKo: false,
      label: (_s, _self, victim) => `Mr.8 et Ms. Monday : défausser 1 carte de ta main pour que ${def(victim.num).name} reste sur le terrain`,
      condition: (s, owner, _self, victim) => s.active !== owner && isBW(victim.num) && s.players[owner].hand.length > 0
        && s.players[owner].chars.some((c) => c.uid === victim.uid),
      apply: (s, owner, _self, victim, ctx) => {
        if (discardFromHand(ownerCtx(ctx, owner), owner, 1, 'Mr.8 et Ms. Monday : carte à défausser à la place') === 1) {
          log(s, owner, `${def(victim.num).name} reste sur le terrain (Mr.8 et Ms. Monday)`);
        }
      },
    },
  },

  // Mr.13 et Ms. Friday : [DON!! x1] +1000 ; [Jouée] placer 1 de ses autres Personnages incluant « Baroque Works » au-dessous de son
  // deck : l'adversaire défausse 1 carte de sa main
  'OP18-056': card({
    onPlay: mayPay({
      label: 'placer un de tes autres Personnages « Baroque Works » au-dessous de ton deck',
      can: (s, p, self) => s.players[p].chars.some((c) => c.uid !== self && isBW(c.num)),
      pay: (ctx) => {
        const list = ctx.s.players[ctx.me].chars.filter((c) => c.uid !== ctx.source && isBW(c.num)).map((c) => c.uid);
        if (!list.length) return false;
        const answer = ctx.ask({
          prompt: 'Personnage à placer au-dessous de ton deck :',
          options: list.map((uid) => ({ id: `card:${uid}`, label: nameOf(ctx.s, uid), uid })),
          tag: 'trashOwn',
        });
        const uid = Number(answer.split(':')[1]);
        if (leaveReplaced(ctx, uid)) return false;
        const f = removeFromField(ctx.s, uid, 'deckBottom');
        if (!f) return false;
        reveal(ctx.s, [f.card.uid], 'both');
        log(ctx.s, ctx.me, `place ${def(f.card.num).name} au-dessous de son deck`);
        emit(ctx.s, { type: 'leave', player: ctx.me, uid, num: f.card.num, zone: 'character', by: ctx.me, cause: 'effect', sourceNum: ctx.num });
        return true;
      },
    }, oppDiscards(1), 'Mr.13 et Ms. Friday'),
  }, {
    selfPower: (_s, _p, self) => (self.don >= 1 ? 1000 : 0),
  }),

  // Saint Gunko (Leader) : [Une fois par tour] quand un Personnage est joué de sa Défausse, piocher 2 cartes et défausser 1 carte ;
  // [Activation : Principale] [Une fois par tour] défausser 1 carte : avec un Personnage de 8000 de puissance de base ou plus,
  // ajouter jusqu'à 1 DON!! redressée
  'OP18-060': card({
    activateMain: {
      label: 'Saint Gunko : défausser 1 carte, puis ajouter 1 DON!! redressée',
      once: true,
      cost: discardCost(1),
      effect: when(charsAtLeast(1, { basePowerMin: 8000 }), addDonUpTo(1, 'active', 'Saint Gunko')),
    },
  }, {
    when: [{
      on: 'play',
      once: 'OP18-060',
      if: (_s, p, _self, e) => e.player === p && e.from === 'trash' && e.zone === 'character',
      run: (ctx) => { seq(drawCards(2), effect((c) => { discardFromHand(c, c.me, 1, 'Saint Gunko : carte à défausser :'); })).run(ctx); },
    }],
  }),

  // Kiwi et Mozu : [Jouée] mettre KO 1 de ses Lieux de coût 5 ou moins : ajouter jusqu'à 1 DON!! épuisée
  'OP18-063': card({ onPlay: mayPay(koOwnStage(5), addDonUpTo(1, 'rested', 'Kiwi et Mozu'), 'Kiwi et Mozu') }),

  // Saint Killingham (coût 5) : [Votre tour] [Jouée] DON!! −1 : jusqu'à 1 Personnage adverse de 7000 de puissance de base ou moins et
  // jusqu'à 1 (un autre) de 5000 ou moins ne peuvent pas attaquer jusqu'à la fin du prochain tour adverse ; [En cas de KO] DON!! −1 :
  // jouer cette carte depuis la Défausse
  'OP18-064': card({
    onPlay: when(myTurn, mayPay(donMinus(1), effect((ctx) => {
      const src = 'Saint Killingham';
      const list = (max: number, not: number[]) => candidates(ctx.s, ctx.me, oppChar({ basePowerMax: max }), (c) => !not.includes(c.uid), ctx.source);
      const small = chooseUpTo1(ctx, list(5000, []), `${src} : Personnage adverse de 5000 de puissance de base ou moins qui ne peut pas attaquer :`, 'oppLock');
      const big = chooseUpTo1(ctx, list(7000, small === null ? [] : [small]), `${src} : Personnage adverse de 7000 de puissance de base ou moins qui ne peut pas attaquer :`, 'oppLock');
      for (const uid of [small, big]) {
        if (uid === null) continue;
        addMod(ctx.s, { uid, stat: 'cantAttack', amount: 0, until: untilOpponentsNextEnd(ctx.s, ctx.me), source: src });
        log(ctx.s, ctx.me, `${nameOf(ctx.s, uid)} ne peut pas attaquer jusqu’à la fin du prochain tour adverse (${src})`);
      }
    }, (s, p) => s.players[other(p)].chars.some((c) => basePower(s, c.uid) <= 7000)), 'Saint Killingham')),
    onKO: mayPay(donMinus(1), playSelfFromTrash('Saint Killingham'), 'Saint Killingham'),
  }),

  // Zanbai : [Activation : Principale] mettre KO 1 de ses Lieux de coût 5 ou moins : ce Personnage gagne [Initiative] pour le tour
  'OP18-066': card({
    activateMain: { label: 'Zanbai : mettre KO ton Lieu pour gagner [Initiative]', cost: koOwnStage(5), effect: selfKeyword('Rush', 'Zanbai') },
  }),

  // Señor Pink : [Une fois par tour] s'il devait être mis KO, DON!! −1 à la place ; [Jouée] DON!! −1 : jusqu'à 1 Personnage adverse de
  // coût 7 ou moins ne peut pas être épuisé jusqu'à la fin du prochain tour adverse
  'OP18-068': card({
    onPlay: mayPay(donMinus(1), grant(oppChar({ costMax: 7 }), { stat: 'cantRest' }, 'oppNextEnd', 'Señor Pink', 'ne peut pas être épuisé'), 'Señor Pink'),
  }, {
    koReplace: {
      label: 'Señor Pink : DON!! −1 (renvoyer 1 DON!! dans ton deck DON!!)',
      condition: (s, owner, self) => !self.usedOpt.includes('replace') && donOnField(s, owner) >= 1,
      apply: (s, owner, self) => {
        self.usedOpt.push('replace');
        returnDon(s, owner, 1);
        log(s, owner, 'Señor Pink reste sur le terrain (DON!! −1 à la place du KO)');
      },
    },
  }),

  // Sodom et Gomorrhe : si un de ses Personnages {La Franky Family} devait être mis KO, DON!! −1 et épuiser ce Personnage à la place
  'OP18-069': {
    koReplaceAlly: {
      label: (_s, _self, victim) => `Sodom et Gomorrhe : DON!! −1 et s’épuiser pour que ${def(victim.num).name} ne soit pas mis KO`,
      condition: (s, owner, self, victim) => def(victim.num).types.includes('The Franky Family') && !self.rested && canBeRested(s, self.uid)
        && donOnField(s, owner) >= 1 && s.players[owner].chars.some((c) => c.uid === victim.uid),
      apply: (s, owner, self, victim) => {
        returnDon(s, owner, 1);
        self.rested = true;
        log(s, owner, `${def(victim.num).name} reste sur le terrain (Sodom et Gomorrhe)`);
      },
    },
  },

  // Trébol : [Une fois par tour] si un de ses Personnages {Équipage de Don Quijote} devait quitter le terrain à cause d'un effet
  // adverse, DON!! −1 à la place ; [Tour adverse] avec un Leader [Sugar], [Bloqueur] et +2000
  'OP18-071': {
    keywordAura: keywordWhile('Blocker', all(not(myTurn), leaderNamed('Sugar'))),
    selfPower: (s, p, self) => (!myTurn(s, p, self.uid) && leaderNamed('Sugar')(s, p, self.uid) ? 2000 : 0),
    replaceRemoval: {
      oncePerTurn: true,
      onlyKo: false,
      label: (_s, _self, victim) => `Trébol : DON!! −1 pour que ${def(victim.num).name} reste sur le terrain`,
      condition: (s, owner, _self, victim) => def(victim.num).types.includes('Donquixote Pirates') && donOnField(s, owner) >= 1
        && s.players[owner].chars.some((c) => c.uid === victim.uid),
      apply: (s, owner, _self, victim) => {
        returnDon(s, owner, 1);
        log(s, owner, `${def(victim.num).name} reste sur le terrain (Trébol)`);
      },
    },
  },

  // La Franky Family : [Bloqueur] ; [Activation : Principale] [Une fois par tour] mettre KO 1 de ses Lieux de coût 5 ou moins : si ce
  // Personnage a été joué ce tour, jusqu'à 1 Personnage adverse reçoit −3000 pour le tour
  'OP18-072': card({
    activateMain: {
      label: 'La Franky Family : mettre KO ton Lieu pour donner −3000 à un Personnage adverse',
      once: true,
      cost: koOwnStage(5),
      effect: when((s, _p, self) => findField(s, self)?.card.playedTurn === s.turn, powerMod(oppChar(), -3000, 'turn', 'La Franky Family')),
    },
  }),

  // Shark Submerge n° 3 (Lieu) : [Jouée] piocher 1 carte, puis ajouter jusqu'à 1 DON!! épuisée ; [Attaque adverse] épuiser ce Lieu :
  // son Leader de 5000 de puissance ou moins et jusqu'à 2 de ses Personnages gagnent +1000 pour le tour
  'OP18-076': card({
    onPlay: seq(drawCards(1), addDonUpTo(1, 'rested', 'Shark Submerge n° 3')),
    onOpponentAttack: mayPay(restSelf(), seq(
      effect((ctx) => {
        const leader = ctx.s.players[ctx.me].leader;
        if (power(ctx.s, leader.uid) > 5000) return;
        addMod(ctx.s, { uid: leader.uid, stat: 'power', amount: 1000, until: 'turn', source: 'Shark Submerge n° 3' });
        log(ctx.s, ctx.me, 'son Leader gagne +1000 de puissance pour le tour (Shark Submerge n° 3)');
      }),
      powerMod(ownChar(), 1000, 'turn', 'Shark Submerge n° 3', 2),
    ), 'Shark Submerge n° 3'),
  }),

  // Mini-Merry (Lieu) : [Jouée] piocher 1 carte, puis ajouter jusqu'à 1 DON!! épuisée ; [Activation : Principale] épuiser ce Lieu :
  // donner 1 DON!! épuisée chacun à un total de jusqu'à 4 de ses Leader ou Personnages
  'OP18-078': card({
    onPlay: seq(drawCards(1), addDonUpTo(1, 'rested', 'Mini-Merry')),
    activateMain: { label: 'Mini-Merry : donner 1 DON!! épuisée à jusqu’à 4 de tes cartes', cost: restSelf(), effect: giveDonSpread(4, 'Mini-Merry') },
  }),

  // Van Augur : [Votre tour] [Une fois par tour] quand une carte de sa main est défaussée par l'effet de son Leader [Marshall.D.Teach],
  // s'il n'a pas d'autre [Van Augur], piocher 1 carte ; [En cas de KO] piocher 1 carte
  'OP18-080': card({ onKO: drawCards(1) }, {
    when: [{
      on: 'discard',
      once: 'OP18-080',
      if: (s, p, self, e) => s.active === p && e.player === p && e.by === p && e.sourceNum === s.players[p].leader.num
        && def(e.sourceNum).names.includes('Marshall.D.Teach')
        && !s.players[p].chars.some((c) => c.uid !== self.uid && def(c.num).names.includes('Van Augur')),
      run: (ctx) => { drawCards(1).run(ctx); },
    }],
  }),

  // Catarina Devon : [En attaquant] sa puissance de base devient celle du Leader adverse (au moment de l'effet) pour le tour ;
  // [En cas de KO] défausser 1 carte : avec un Leader {Équipage de Barbe Noire}, la jouer épuisée depuis la Défausse
  'OP18-082': card({
    whenAttacking: effect((ctx) => {
      const self = findField(ctx.s, ctx.source);
      if (!self) return;
      const value = power(ctx.s, ctx.s.players[ctx.opp].leader.uid);
      addMod(ctx.s, { uid: ctx.source, stat: 'basePower', amount: value, until: 'turn', source: 'Catarina Devon' });
      log(ctx.s, ctx.me, `${def(self.card.num).name} a une puissance de base de ${value} pour le tour (Catarina Devon)`);
    }),
    onKO: mayPay(discardCost(1), when(leaderType('Blackbeard Pirates'), playSelfFromTrash('Catarina Devon', { rested: true })), 'Catarina Devon'),
  }),

  // Cerbère : [Activation : Principale] le renvoyer dans sa main : jusqu'à 1 de ses [Saint Shamrock] gagne [Initiative], [Exil] ou
  // [Imblocable] (au choix) pour le tour
  'OP18-085': card({
    activateMain: {
      label: 'Cerbère : retourner en main pour donner un mot-clé à un [Saint Shamrock]',
      cost: bounceSelfCost(),
      effect: effect((ctx) => {
        const uid = chooseUpTo1(ctx, candidates(ctx.s, ctx.me, ownChar({ name: 'Saint Shamrock' }), undefined, ctx.source),
          'Cerbère : [Saint Shamrock] qui gagne un mot-clé :', 'ownGrant');
        if (uid === null) return;
        const answer = ctx.ask({
          prompt: 'Cerbère : quel mot-clé donner ?',
          options: [
            { id: 'choice:Rush', label: '[Initiative]' }, { id: 'choice:Banish', label: '[Exil]' }, { id: 'choice:Unblockable', label: '[Imblocable]' },
          ],
          tag: 'chooseOne',
        });
        const keyword = answer.split(':')[1] as Keyword;
        addMod(ctx.s, { uid, stat: 'keyword', keyword, amount: 0, until: 'turn', source: 'Cerbère' });
        log(ctx.s, ctx.me, `${nameOf(ctx.s, uid)} gagne [${keyword === 'Rush' ? 'Initiative' : keyword === 'Banish' ? 'Exil' : 'Imblocable'}] pour le tour (Cerbère)`);
      }, (s, p) => s.players[p].chars.some((c) => def(c.num).names.includes('Saint Shamrock'))),
    },
  }),

  // MMA : autant d'exemplaires qu'on veut dans un deck (deckRules.ts lit le texte, comme OP01-075 et OP08-072 ; pas plus de
  // 50 cartes) ; [Bloqueur] est un mot-clé lu en tête du texte
  'OP18-093': {},

  // Abysse (Lieu) : avec un Leader {Dragon céleste}, les Personnages {Ordre des chevaliers divins} ou {Cinq Doyens} de coût 2 ou plus
  // jouées depuis la main coûtent 1 de moins ; [Jouée] piocher 1 carte et placer 2 cartes du dessus de son deck dans sa Défausse
  'OP18-097': card({ onPlay: seq(drawCards(1), trashTop(2)) }, {
    handCostAura: (s, owner, source, num) => {
      const d = def(num);
      return d.category === 'CHARACTER' && (d.cost ?? 0) >= 2 && (d.types.includes('Holy Knights of God') || d.types.includes('Five Elders'))
        && leaderType('Celestial Dragons')(s, owner, source.uid) ? -1 : 0;
    },
  }),

  // Kaku : [Jouée] ajouter jusqu'à 1 carte {CP} de sa main au-dessus ou au-dessous de sa Vie, face visible ; [Déclenchement] avec un
  // Leader {CP}, piocher 1 carte et placer jusqu'à 1 Personnage de coût 8 ou moins au-dessous du deck de son propriétaire
  'OP18-099': card({
    onPlay: cpToLife('Kaku'),
    onTrigger: ifCp(seq(drawCards(1), bottomOfDeck(anyChar({ costMax: 8 }), 'Kaku'))),
  }),

  // Kalifa : [Jouée] piocher 1 carte, puis la même chose avec une carte {CP} ; [Déclenchement] avec un Leader {CP}, piocher 1 carte et
  // épuiser jusqu'à 1 Leader ou Personnage adverse
  'OP18-100': card({
    onPlay: seq(drawCards(1), cpToLife('Kalifa')),
    onTrigger: ifCp(seq(drawCards(1), rest(oppLeaderOrChar(), 'Kalifa'))),
  }),

  // Kumadori : [En cas de KO] ajouter jusqu'à 1 carte {CP} de sa main au-dessus ou au-dessous de sa Vie, face visible ;
  // [Déclenchement] avec un Leader {CP}, mettre KO ou épuiser jusqu'à 1 Personnage adverse de coût 6 ou moins
  'OP18-101': card({
    onKO: cpToLife('Kumadori'),
    onTrigger: ifCp(koOrRest6('Kumadori')),
  }),

  // Spandam (coût 1) : [Déclenchement] avec un Leader {CP}, révéler jusqu'à 1 carte {CP} autre que [Spandam] de sa main et activer
  // son [Déclenchement] (la carte reste en main, sauf si cet effet la joue)
  'OP18-105': card({
    onTrigger: ifCp(effect((ctx) => {
      const P = ctx.s.players[ctx.me];
      const fits = (c: Card) => cardMatches(c.num, { typeIncludes: 'CP', notName: 'Spandam' }) && Boolean(triggerEffect(c.num));
      const options = uniqueByNum(knownFirst(ctx.s, ctx.me, P.hand.filter(fits)));
      if (!options.length) return;
      const answer = ctx.ask({
        prompt: 'Spandam : carte {CP} de ta main à révéler pour activer son [Déclenchement] :',
        options: [...options.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucune' }],
        tag: 'pick',
      });
      if (answer === 'none') return;
      const [card] = P.hand.splice(P.hand.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1);
      const run = triggerEffect(card.num)!;
      log(ctx.s, ctx.me, `révèle ${def(card.num).name} et active son [Déclenchement] (Spandam)`);
      emit(ctx.s, { type: 'trigger', player: ctx.me, uid: card.uid, num: card.num });
      // comme une carte de Vie révélée : dans aucune zone pendant son effet, puis de retour en main si l'effet ne l'a pas déplacée
      const trigger = { card, moved: false };
      const shown = { uid: card.uid, num: card.num, owner: ctx.me };
      run({ ...ctx, num: card.num, trigger, ask: (q) => ctx.ask({ ...q, cards: [...(q.cards ?? []), shown] }) });
      if (!trigger.moved) P.hand.push(card);
    }, (s, p) => s.players[p].hand.some((c) => cardMatches(c.num, { typeIncludes: 'CP', notName: 'Spandam' }) && Boolean(triggerEffect(c.num))))),
  }),

  // Fukurou : [Bloqueur] ; [Déclenchement] avec un Leader {CP}, mettre KO ou épuiser jusqu'à 1 Personnage adverse de coût 6 ou moins
  'OP18-109': card({ onTrigger: ifCp(koOrRest6('Fukurou')) }),

  // Buster Call : [Principale] placer toute sa Vie dans sa Défausse : avec un Leader [Spandam], placer tous les Personnages dans la
  // Défausse de leur propriétaire, jouer un total de jusqu'à 5 Personnages {Vice-amiral} de noms différents de son deck ou de sa
  // Défausse ; puis mélanger son deck (la condition couvre le « Puis », n° 1983)
  'OP18-117': card({
    onMain: mayPay({
      label: 'placer toute ta Vie dans ta Défausse',
      can: (s, p) => s.players[p].life.length > 0,
      pay: (ctx) => {
        const P = ctx.s.players[ctx.me];
        if (!P.life.length) return false;
        const n = P.life.length;
        for (const c of P.life.splice(0)) P.trash.push({ uid: c.uid, num: c.num });
        log(ctx.s, ctx.me, `place ses ${n} cartes de Vie dans sa Défausse`);
        return true;
      },
    }, when(leaderNamed('Spandam'), seq(
      removeChars(anyChar(), 'trash', 'Buster Call', { all: true }),
      effect((ctx) => {
        const P = ctx.s.players[ctx.me];
        const played: string[] = [];
        for (let i = 0; i < 5; i++) {
          const fits = (c: Card) => def(c.num).category === 'CHARACTER' && def(c.num).types.includes('Vice Admiral') && !played.includes(def(c.num).name)
            && canPlayCharacters(ctx.s, ctx.me, c.num);
          const options = uniqueByNum([...P.trash.filter(fits), ...P.deck.filter(fits)]);
          if (!options.length) break;
          const answer = ctx.ask({
            prompt: `Buster Call : jouer un Personnage {Vice-amiral} de ton deck ou de ta Défausse (${i + 1}/5) :`,
            options: [...options.map((c) => ({ id: `card:${c.uid}`, label: `${def(c.num).name} (${P.trash.some((x) => x.uid === c.uid) ? 'Défausse' : 'deck'})`, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucun' }],
            tag: 'playFree',
          });
          if (answer === 'none') break;
          const uid = Number(answer.split(':')[1]);
          const zone = P.trash.some((c) => c.uid === uid) ? P.trash : P.deck;
          const [c] = zone.splice(zone.findIndex((x) => x.uid === uid), 1);
          played.push(def(c.num).name);
          playCharacter(ctx, ctx.me, c, zone === P.trash ? { from: 'trash' } : {});
        }
        shuffleDeck(ctx.s, ctx.me);
        log(ctx.s, ctx.me, 'mélange son deck (Buster Call)');
      }),
    )), 'Buster Call'),
  }),

  // Monkey D. Luffy (coût 9) : [Jouée] redresser jusqu'à 3 DON!!, puis jusqu'à 1 Personnage adverse ne peut pas être épuisé jusqu'à la
  // fin du prochain tour adverse ; [Fin de votre tour] redresser jusqu'à 1 carte {Water Seven}
  'OP18-118': card({
    onPlay: seq(
      readyDonUpTo(3, 'Monkey D. Luffy'),
      grant(oppChar(), { stat: 'cantRest' }, 'oppNextEnd', 'Monkey D. Luffy', 'ne peut pas être épuisé'),
    ),
    endOfTurn: readyWaterSeven('Monkey D. Luffy'),
  }),
};

// ---------- Morceaux « code à la main » des recettes (recipes/sets/op18.ts) ----------

export const MANUAL_OP18: ManualRegistry = {
  // Arrêtez de vous battre !! : coût « ajouter toute sa Vie à sa main » (au moins 1 carte de Vie ; pas si les cartes de Vie ne
  // peuvent plus aller en main par ses effets)
  'OP18-020': {
    costs: {
      allLifeToHand: {
        canPay: (ctx: EffectCtx) => ctx.s.players[ctx.me].life.length > 0 && canTakeLife(ctx.s, ctx.me),
        pay: (ctx: EffectCtx) => {
          const P = ctx.s.players[ctx.me];
          if (!P.life.length || !canTakeLife(ctx.s, ctx.me)) return false;
          while (P.life.length) if (!lifeToHand(ctx.s, ctx.me, 'top')) break;
          return true;
        },
      },
    },
  },
  // Est-ce que vous accepterez de repartir avec ?! : « si vous avez un Lieu de coût 5 ou plus » (un Lieu, pas un Personnage)
  'OP18-074': {
    conds: { stage5: (ctx: EffectCtx) => stageCostAtLeast(5)(ctx.s, ctx.me, ctx.source) },
  },
};
