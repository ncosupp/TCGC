// CARTES D'OP05 CODÉES À LA MAIN (étape C, tâche S15) : celles que le traducteur ne comprend pas (remplacements, évènements
// « quand ... », coûts propres à la carte) ou dont la brique contredit les Q&A. Codées d'après leur texte officiel VO et VF et
// les Q&A officielles ; les choix d'interprétation sont dans game/docs/interpretations.md (section « OP05 et ST10 (tâche S15) »,
// 3400 à 3499). Aucun texte de carte ici. Le reste du set est en recettes (recipes/sets/op05.ts).
import {
  addMod, addTopDeckToLife, canBeRested, canPlayCharacters, canPlayFromHand, def, describe, discardFromHand, emit, fieldCost, findField, leaveReplaced, log, may, other,
  handCost, playableByEffect, playCharacter, playFromHandFree, power, removeByEffect, removeFromField, shuffleDeck, uniqueByNum,
} from '../rules.ts';
import type { CardBehavior, EffectCtx, FieldCard, GameState, PlayerId } from '../types.ts';
import {
  bothCosts, bottomOfDeck, bounce, card, charsAtLeast, chooseOne, costMod, discard, discardCost, donMinus, donOnFieldAtLeast, drawCards, effect, ko, leaderNamed, lifeAtMost, lifeFromDeck,
  onceWithCost, oppChar, oppLeaderOrChar, ownChar, ownLeaderOrChar, powerMod, readySelf, rest, restCost, restDon, restSelf,
  selfDon, selfKeyword, selfPowerMod, seq, toOwnersLife, trashThis, trashToBottomCost, trashToHand, when, withCost, type Cost, type Effect,
} from './bricks.ts';

const RA = 'Revolutionary Army';
const CELESTIAL = 'Celestial Dragons';

// « Vous pouvez [coût] : [effet] » proposé seulement si l'effet peut servir (convention n° 1000 des recettes)
const mayPay = (cost: Cost, then: Effect, source: string): Effect => when((s, p, self) => then.useful(s, p, self), withCost(cost, then, source));

// Le contexte d'un effet adverse, vu du propriétaire de la carte qui le remplace : ses questions vont à ce joueur
const ownerCtx = (ctx: EffectCtx, owner: PlayerId): EffectCtx => ({
  ...ctx, me: owner, opp: other(owner), ask: (spec) => ctx.ask({ player: owner, ...spec }),
});

// « Ajoutez jusqu'à 1 carte du dessus de votre deck au-dessus de votre Vie » : on peut refuser (Q&A d'OP07-119, n° 3201) ; la
// brique des recettes ajoute la carte sans le demander
const mayLifeFromDeck = (source: string): Effect => effect((ctx) => {
  if (!ctx.s.players[ctx.me].deck.length) return;
  if (may(ctx, `${source} : ajouter la carte du dessus de ton deck au-dessus de ta Vie ?`)) lifeFromDeck().run(ctx);
}, (s, p) => s.players[p].deck.length > 0);

// « 1 de vos Personnages autre que celui-ci » choisi pour payer un coût
const otherChars = (s: GameState, p: PlayerId, self: number) => s.players[p].chars.filter((c) => c.uid !== self).map((c) => c.uid);
const chooseOtherChar = (ctx: EffectCtx, prompt: string) => Number(ctx.ask({
  prompt,
  options: otherChars(ctx.s, ctx.me, ctx.source).map((uid) => ({ id: `card:${uid}`, label: describe(ctx.s, uid), uid })),
  tag: 'trashOwn',
}).split(':')[1]);

// Hakuba : ce coût passe par removeByEffect : un Personnage qui ne peut pas être mis KO, ou dont le KO est remplacé, reste sur le
// terrain, et le coût n'est pas payé (Q&A de Fukurou OP03-088 et Kyros OP04-082, n° 3410)
const koOtherChar: Cost = {
  label: 'mettre KO 1 de tes autres Personnages',
  can: (s, p, self) => otherChars(s, p, self).length > 0,
  pay: (ctx) => removeByEffect(ctx, chooseOtherChar(ctx, 'Personnage à mettre KO :'), 'ko'),
};

// X.Barrels : 1 de ses autres Personnages au-dessous de son deck (carte publique, sortie annoncée)
const bottomOtherChar: Cost = {
  label: 'placer 1 de tes autres Personnages au-dessous de ton deck',
  can: (s, p, self) => otherChars(s, p, self).length > 0,
  pay: (ctx) => {
    const uid = chooseOtherChar(ctx, 'Personnage à placer au-dessous de ton deck :');
    if (leaveReplaced(ctx, uid)) return false;
    const f = removeFromField(ctx.s, uid, 'deckBottom');
    if (!f) return false;
    log(ctx.s, ctx.me, `place ${def(f.card.num).name} au-dessous de son deck`);
    emit(ctx.s, { type: 'leave', player: ctx.me, uid, num: f.card.num, zone: 'character', by: ctx.me, cause: 'effect', sourceNum: ctx.num });
    return true;
  },
};

// Elizabello II : 20 cartes de sa Défausse dans son deck, qui est mélangé (au choix, sans question s'il n'y en a que 20)
const TRASH_TO_DECK = 20;
const trashToDeck20: Cost = {
  label: `remettre ${TRASH_TO_DECK} cartes de ta Défausse dans ton deck et le mélanger`,
  can: (s, p) => s.players[p].trash.length >= TRASH_TO_DECK,
  pay: (ctx) => {
    const P = ctx.s.players[ctx.me];
    if (P.trash.length === TRASH_TO_DECK) P.deck.push(...P.trash.splice(0));
    else {
      for (let i = 0; i < TRASH_TO_DECK; i++) {
        const answer = ctx.ask({
          prompt: `Carte de ta Défausse à remettre dans ton deck (${i + 1}/${TRASH_TO_DECK}) :`,
          options: uniqueByNum(P.trash).map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })),
          tag: 'trashToDeck',
        });
        P.deck.push(...P.trash.splice(P.trash.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1));
      }
    }
    shuffleDeck(ctx.s, ctx.me);
    log(ctx.s, ctx.me, `remet ${TRASH_TO_DECK} cartes de sa Défausse dans son deck et le mélange`);
    return true;
  },
};

// Hotori : jouer 1 [Kotori] de sa main (sans payer son coût)
const KOTORI = 'Kotori';
const kotoriInHand = (s: GameState, p: PlayerId) => s.players[p].hand.filter((c) => def(c.num).names.includes(KOTORI) && playableByEffect(c.num));
const playKotori: Cost = {
  label: `jouer 1 [${KOTORI}] de ta main`,
  can: (s, p) => canPlayFromHand(s, p) && kotoriInHand(s, p).some((c) => canPlayCharacters(s, p, c.num)),
  pay: (ctx) => {
    const P = ctx.s.players[ctx.me];
    const chosen = kotoriInHand(ctx.s, ctx.me).find((c) => canPlayCharacters(ctx.s, ctx.me, c.num));
    if (!chosen) return false;
    const [played] = P.hand.splice(P.hand.findIndex((c) => c.uid === chosen.uid), 1);
    playCharacter(ctx, ctx.me, played, { from: 'hand' });
    return true;
  },
};

// Enel (Personnage) : [Une fois par tour] remplacement de toute sortie du terrain ; annulé tant qu'il y a un Personnage
// [Monkey.D.Luffy], d'un côté ou de l'autre ([Initiative], lui, n'est pas annulée : Q&A)
const ENEL_KEY = 'enelLeave';
const LUFFY = 'Monkey.D.Luffy';
const enelCan = (s: GameState, p: PlayerId, self: FieldCard) => !self.usedOpt.includes(ENEL_KEY) && s.players[p].life.length > 0
  && !s.players.some((P) => P.chars.some((c) => def(c.num).names.includes(LUFFY)));
const enelApply = (s: GameState, p: PlayerId, self: FieldCard) => {
  self.usedOpt.push(ENEL_KEY);
  const P = s.players[p];
  const top = P.life.shift()!;
  P.trash.push({ uid: top.uid, num: top.num });
  log(s, p, `place dans sa Défausse ${def(top.num).name}, la carte du dessus de sa Vie (${P.life.length} Vie) : ${def(self.num).name} reste sur le terrain`);
};
const ENEL_LABEL = 'Placer la carte du dessus de ta Vie dans ta Défausse';

export const OP05: Record<string, CardBehavior> = {
  // Sabo (Leader) : [DON!! x1] [Tour adverse] [Une fois par tour] si un de ses Personnages de 5000 de puissance ou plus (puissance du
  // moment, Contres compris : Q&A) devait être mis KO, −1000 pour le tour à la place. Un refus n'use pas la limite ; plusieurs KO
  // du même effet : tous remplacés, ou aucun (Q&A)
  'OP05-001': {
    koReplaceAlly: {
      batch: true,
      label: (_s, _self, victim) => `Lui donner −1000 de puissance pour le tour (${def(victim.num).name})`,
      condition: (s, p, self, victim) => s.active !== p && self.don >= 1 && power(s, victim.uid) >= 5000
        && (!self.usedOpt.includes('saboKo') || s.pending[0]?.koBatch?.[String(self.uid)] === 'yes'),
      apply: (s, p, self, victim) => {
        if (!self.usedOpt.includes('saboKo')) self.usedOpt.push('saboKo');
        addMod(s, { uid: victim.uid, stat: 'power', amount: -1000, until: 'turn', source: def(self.num).name });
        log(s, p, `${def(victim.num).name} n'est pas mis KO et reçoit −1000 de puissance pour le tour (${def(self.num).name})`);
      },
    },
  },

  // Belo Betty (Leader) : [Activation : Principale] [Une fois par tour] défausser 1 carte {Revolutionary Army} : jusqu'à 3 de ses
  // Personnages {Revolutionary Army} ou ayant [Déclenchement] gagnent +3000 (pas le Leader : Q&A)
  'OP05-002': card({
    activateMain: {
      label: 'Belo Betty : défausser 1 carte {Armée révolutionnaire} : +3000 à jusqu’à 3 Personnages',
      once: true,
      cost: discardCost(1, { type: RA }),
      effect: powerMod(ownChar({ anyOf: [{ type: RA }, { trigger: true }] }), 3000, 'turn', 'Belo Betty', 3),
    },
  }),

  // Inazuma : [Initiative] tant qu'il a un autre Personnage de 7000 de puissance ou plus (lu à chaque instant : Q&A)
  'OP05-003': {
    rush: (s, p, self) => s.players[p].chars.some((c) => c.uid !== self.uid && power(s, c.uid) >= 7000),
  },

  // Rosinante : [Bloqueur] ; [Tour adverse] si un de ses Personnages épuisés (lui compris) devait être mis KO, se placer dans la
  // Défausse à la place (pas un KO : Q&A). Plusieurs KO du même effet : tous ses Personnages épuisés sont sauvés (Q&A)
  'OP05-030': {
    koReplaceAlly: {
      batch: true,
      label: (_s, self) => `Placer ${def(self.num).name} dans ta Défausse`,
      condition: (s, p, _self, victim) => s.active !== p && victim.rested,
      apply: (s, p, self, _victim, ctx) => {
        ctx.pending.koSpared = [...(ctx.pending.koSpared ?? []), ...s.players[p].chars.filter((c) => c.rested && c.uid !== self.uid).map((c) => c.uid)];
        removeFromField(s, self.uid, 'trash');
        log(s, p, `place ${def(self.num).name} dans sa Défausse à la place du KO`);
        emit(s, { type: 'leave', player: p, uid: self.uid, num: self.num, zone: 'character', by: p, cause: 'effect', sourceNum: self.num });
      },
    },
  },

  // Pica : [Fin de votre tour] ① : se redresser ; [Une fois par tour] s'il devait être mis KO, épuiser 1 de ses Personnages de coût 3
  // ou plus autre que [Pica] à la place (sans cible, pas de remplacement : règle 8-1-3-4-5 ; la cible peut être mise KO en même temps : Q&A)
  'OP05-032': card({
    endOfTurn: mayPay(restDon(1), readySelf(), 'Pica'),
  }, {
    koReplace: {
      label: 'Épuiser 1 de tes Personnages de coût 3 ou plus autre que [Pica]',
      condition: (s, p, self) => !self.usedOpt.includes('picaKo') && restCost(1, 'characters', { costMin: 3, notName: 'Pica' }).can(s, p, self.uid),
      apply: (_s, p, self, ctx) => {
        self.usedOpt.push('picaKo');
        restCost(1, 'characters', { costMin: 3, notName: 'Pica' }).pay(ownerCtx(ctx, p));
      },
    },
  }),

  // Cage à oiseaux (Lieu) : avec un Leader [Donquixote Doflamingo], les Personnages de coût 5 ou moins des deux joueurs ne se
  // redressent pas en phase de Recharge ; [Fin de votre tour] avec 10 DON!! (quel que soit le Leader : Q&A, effet obligatoire), KO de
  // tous les Personnages épuisés de coût 5 ou moins ; puis ce Lieu dans la Défausse (la condition couvre le « Puis » : n° 1983)
  'OP05-040': card({
    endOfTurn: when(donOnFieldAtLeast(10), seq(effect((ctx) => {
      const list = [...ctx.s.players[ctx.me].chars, ...ctx.s.players[ctx.opp].chars].filter((c) => c.rested && fieldCost(ctx.s, c.uid) <= 5).map((c) => c.uid);
      for (const uid of list) removeByEffect(ctx, uid, 'ko');
    }), trashThis())),
  }, {
    noRefreshAura: (s, owner, _source, target) => leaderNamed('Donquixote Doflamingo')(s, owner, -1)
      && s.players.some((P) => P.chars.some((c) => c.uid === target.uid)) && fieldCost(s, target.uid) <= 5,
  }),

  // Mozambia : [Votre tour] [Une fois par tour] quand il pioche hors de sa phase de Pioche, +2000 pour le tour
  'OP05-053': {
    when: [{
      on: 'draw',
      once: 'mozambia',
      if: (s, owner, _self, e) => e.player === owner && s.active === owner,
      run: (ctx) => selfPowerMod(2000, 'turn', 'Mozambia').run(ctx),
    }],
  },

  // X.Barrels : [Jouée] placer 1 de ses autres Personnages au-dessous de son deck : piocher 1 carte
  'OP05-056': card({ onPlay: withCost(bottomOtherChar, drawCards(1), 'X.Barrels') }),

  // Viola : [Jouée] l'adversaire place 3 cartes de sa Défausse (autant qu'il peut) au-dessous de son deck, choisies par lui (Q&A)
  'OP05-079': card({
    onPlay: effect((ctx) => {
      const n = Math.min(3, ctx.s.players[ctx.opp].trash.length);
      if (n) trashToBottomCost(n).pay(ownerCtx(ctx, ctx.opp));
    }),
  }),

  // Elizabello II : [En attaquant] [Une fois par tour] remettre 20 cartes de sa Défausse dans son deck : [Double attaque] et +10000 pour le combat
  'OP05-080': card({
    whenAttacking: onceWithCost('elizabello', trashToDeck20, seq(selfKeyword('Double Attack', 'Elizabello II', 'battle'), selfPowerMod(10000, 'battle', 'Elizabello II')), 'Elizabello II'),
  }),

  // Hakuba : [DON!! x1] [En attaquant] mettre KO 1 de ses autres Personnages : −5 de coût à un Personnage adverse pour le tour
  'OP05-087': card({
    whenAttacking: when(selfDon(1), mayPay(koOtherChar, costMod(oppChar(), -5, 'turn', 'Hakuba'), 'Hakuba')),
  }),

  // Saint Mjosgard : [Activation : Principale] ① et épuiser ce Personnage et 1 autre de ses Personnages : jusqu'à 1 Personnage noir de
  // coût 1 de sa Défausse dans sa main. À la main : la recette proposait l'activation sans autre Personnage, et le coût échouait à moitié payé
  'OP05-089': card({
    activateMain: {
      label: 'Saint Mjosgard : ① et épuiser 2 Personnages : Personnage noir de coût 1 de la Défausse en main',
      condition: (s, p, self) => s.players[p].chars.some((c) => c.uid !== self && !c.rested && canBeRested(s, c.uid)),
      cost: bothCosts(restDon(1), restSelf(), restCost(1, 'characters')),
      effect: trashToHand({ category: 'CHARACTER', color: 'Black', costMin: 1, costMax: 1 }, 'Saint Mjosgard'),
    },
  }),

  // 500 millions !! : [Principale] au choix : KO, retour en main ou Vie (face visible) d'un Personnage adverse de coût 1 ou moins ;
  // puis, avec un Personnage {Celestial Dragons}, piocher 1 carte ; [Déclenchement] KO ou retour en main d'un Personnage adverse de coût 6 ou moins
  'OP05-096': card({
    onMain: seq(
      chooseOne('500 millions', [
        { label: 'Mettre KO 1 Personnage adverse de coût 1 ou moins', effect: ko(oppChar({ costMax: 1 }), '500 millions') },
        { label: 'Renvoyer dans la main 1 Personnage adverse de coût 1 ou moins', effect: bounce(oppChar({ costMax: 1 }), '500 millions') },
        { label: 'Placer dans sa Vie, face visible, 1 Personnage adverse de coût 1 ou moins', effect: toOwnersLife(oppChar({ costMax: 1 }), '500 millions', true) },
      ]),
      when(charsAtLeast(1, { type: CELESTIAL }), drawCards(1)),
    ),
    onTrigger: chooseOne('500 millions', [
      { label: 'Mettre KO 1 Personnage adverse de coût 6 ou moins', effect: ko(oppChar({ costMax: 6 }), '500 millions') },
      { label: 'Renvoyer dans la main 1 Personnage adverse de coût 6 ou moins', effect: bounce(oppChar({ costMax: 6 }), '500 millions') },
    ]),
  }),

  // Marie-Joie (Lieu) : [Votre tour] le coût des Personnages {Celestial Dragons} de coût 2 ou plus joués de sa main baisse de 1
  'OP05-097': {
    handCostAura: (s, owner, _source, num) => {
      const d = def(num);
      return s.active === owner && d.category === 'CHARACTER' && d.types.includes(CELESTIAL) && (d.cost ?? 0) >= 2 ? -1 : 0;
    },
  },

  // Enel (Leader) : [Tour adverse] [Une fois par tour] quand sa Vie passe à 0 (même si un [Déclenchement] en a remis une : Q&A), la
  // carte du dessus de son deck au-dessus de sa Vie ; puis défausser 1 carte. Après le traitement des dégâts, [Déclenchement]
  // compris ; ordre au choix avec un [Jouée] de la carte jouée par ce [Déclenchement] (Q&A)
  'OP05-098': {
    when: [{
      on: 'lifeRemoved',
      once: 'enelZero',
      orderWithQueued: true,
      if: (s, owner, _self, e) => s.active !== owner && e.player === owner && Boolean(e.emptied),
      run: (ctx) => {
        addTopDeckToLife(ctx.s, ctx.me);
        discardFromHand(ctx, ctx.me, 1, 'Enel : carte à défausser');
      },
    }],
  },

  // Amazon : [Attaque adverse] s'épuiser : l'adversaire peut placer la carte du dessus de sa Vie dans sa Défausse ; sinon (ou sans
  // Vie), −2000 à 1 de ses Leader ou Personnages pour le tour
  'OP05-099': card({
    onOpponentAttack: withCost(restSelf(), effect((ctx) => {
      const O = ctx.s.players[ctx.opp];
      if (O.life.length && ctx.ask({
        player: ctx.opp,
        prompt: 'Amazon : placer la carte du dessus de ta Vie dans ta Défausse ? Sinon, −2000 à 1 de tes cartes pour le tour.',
        options: [{ id: 'yes', label: 'Oui' }, { id: 'no', label: 'Non' }],
        tag: 'may',
      }) === 'yes') {
        const top = O.life.shift()!;
        O.trash.push({ uid: top.uid, num: top.num });
        log(ctx.s, ctx.opp, `place dans sa Défausse ${def(top.num).name}, la carte du dessus de sa Vie (${O.life.length} Vie) (Amazon)`);
        return;
      }
      powerMod(oppLeaderOrChar(), -2000, 'turn', 'Amazon').run(ctx);
    }), 'Amazon'),
  }),

  // Enel (Personnage) : voir plus haut ; KO en combat ou par un effet (koReplace), autres sorties par un effet ou payées en coût,
  // ses propres effets compris (leaveReplace ; Q&A). Le coût remplacé n'est pas payé : ce qu'il paie n'a pas lieu (Q&A)
  'OP05-100': {
    koReplace: { label: ENEL_LABEL, condition: enelCan, apply: enelApply },
    leaveReplace: { label: ENEL_LABEL, condition: enelCan, apply: enelApply },
  },

  // Spacey : [Votre tour] [Une fois par tour] quand une carte de sa Vie va dans sa main, +2000 pour le tour (pas une carte qui s'ajoute
  // elle-même à la main par son [Déclenchement] : Q&A)
  'OP05-107': {
    when: [{
      on: 'lifeToHand',
      once: 'spacey',
      if: (s, owner, _self, e) => e.player === owner && s.active === owner,
      run: (ctx) => selfPowerMod(2000, 'turn', 'Lieutenant Spacey').run(ctx),
    }],
  },

  // Pagaya : [Une fois par tour] quand un [Déclenchement] est activé, le sien ou celui de l'adversaire (Q&A : à la main, l'évènement
  // des recettes ne lit qu'un seul camp), piocher 2 cartes et en défausser 2
  'OP05-109': {
    when: [{
      on: 'trigger',
      once: 'pagaya',
      if: () => true,
      run: (ctx) => seq(drawCards(2), discard(2)).run(ctx),
    }],
  },

  // Hotori : [Jouée] jouer 1 [Kotori] de sa main : jusqu'à 1 Personnage adverse de coût 3 ou moins dans la Vie adverse, face visible
  'OP05-111': card({
    onPlay: mayPay(playKotori, toOwnersLife(oppChar({ costMax: 3 }), 'Hotori', true), 'Hotori'),
  }),

  // 200 millions de volts Amal : [Principale] +3000 pour le tour ; puis, avec 1 Vie ou moins, épuiser 1 Personnage adverse de coût 4
  // ou moins ; [Déclenchement] défausser 2 cartes : jusqu'à 1 carte du deck dans la Vie (refus possible, voir mayLifeFromDeck)
  'OP05-115': card({
    onMain: seq(
      powerMod(ownLeaderOrChar(), 3000, 'turn', 'Amal'),
      when(lifeAtMost(1), rest(oppChar({ costMax: 4 }), 'Amal')),
    ),
    onTrigger: mayPay(discardCost(2), mayLifeFromDeck('Amal'), 'Amal'),
  }),
};

export const ST10: Record<string, CardBehavior> = {
  // Trafalgar Law (Leader) : [Activation : Principale] [Une fois par tour] DON!! −3 : jusqu'à 1 Personnage adverse de 3000 de puissance ou
  // moins sous le deck, et jusqu'à 1 Personnage de coût 4 ou moins joué de sa main ; ce coût est celui à payer pour la jouer, réductions
  // comprises (Q&A d'OP07 sur Sanji OP07-064), pas le coût imprimé : d'où le code à la main
  'ST10-001': card({
    activateMain: {
      label: 'Trafalgar Law : DON!! −3 : sous le deck, puis jouer un Personnage de coût 4 ou moins',
      once: true,
      cost: donMinus(3),
      effect: seq(
        bottomOfDeck(oppChar({ powerMax: 3000 }), 'Trafalgar Law'),
        effect((ctx) => {
          playFromHandFree(ctx, (c) => def(c.num).category === 'CHARACTER' && handCost(ctx.s, ctx.me, c) <= 4, 'Trafalgar Law : Personnage de coût 4 ou moins à jouer de ta main :');
        }, (s, p) => s.players[p].hand.some((c) => def(c.num).category === 'CHARACTER' && handCost(s, p, c) <= 4)),
      ),
    },
  }),
};
