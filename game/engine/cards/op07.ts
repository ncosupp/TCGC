// CARTES D'OP07 CODÉES À LA MAIN (étape C, tâche S12) : celles que le traducteur ne comprend pas ou que le format des
// recettes ne sait pas dire (DON!! déjà données déplacées, remplacement, « si la carte choisie attaque », « 1 de chaque »,
// main révélée, « autant que vous voulez », jouer ou placer dans la Vie...). Codées d'après leur texte officiel VO et VF et
// les Q&A officielles, avec les briques existantes ; les choix d'interprétation sont dans game/docs/interpretations.md
// (section « OP07 (tâche S12) », 3100 à 3199). Aucun texte de carte ici. Le reste du set est en recettes (recipes/sets/op07.ts).
import {
  addMod, bottomOrder, canLeaveByEffect, canPlayCharacters, canPlayFromHand, chooseUpTo1, def, describe, donOnField, draw, findField, knownFirst, log, may, other,
  playableByEffect, playCharacter, removeByEffect, reveal, uniqueByNum,
} from '../rules.ts';
import type { Card, CardBehavior, EffectCtx, FieldCard, GameEvent, GameState, PlayerId } from '../types.ts';
import {
  candidates, card, cardMatches, charsAtLeast, donMinus, drawCards, effect, keepRested, leaderNamed, leaderType, lifeAtMost, lifeFromDeck, lifeToHandCost,
  onceWithCost, oppChar, oppDiscards, oppLeader, ownLeaderOrChar, powerMod, powerToZero, rest, restDon, searchTop, selfKeyword, selfPowerMod, seq, when, withCost,
  type Cost, type Effect,
  mayPay,
} from './bricks.ts';
import { addDonUpTo } from './bricks-don.ts';
import { mayLifeFromDeck } from './bricks-life.ts';
import { removeChars } from './bricks-removal.ts';
import { isNamed } from './common.ts';

const WARLORDS = 'The Seven Warlords of the Sea';
const FOXY = 'Foxy Pirates';
const EGGHEAD = 'Egghead';


// Le contexte d'un effet adverse, vu du propriétaire de la carte qui le remplace : ses questions vont à ce joueur
const ownerCtx = (ctx: EffectCtx, owner: PlayerId, self: FieldCard): EffectCtx => ({
  ...ctx, me: owner, opp: other(owner), source: self.uid, num: self.num, ask: (spec) => ctx.ask({ player: owner, ...spec }),
});

// Monkey D. Dragon (Leader) : jusqu'à 2 DON!! déjà données (à son Leader ou à d'autres Personnages) passent sur 1 seul de ses
// Personnages ; celles qu'il porte déjà ne comptent pas (Q&A, n° 3100)
const DRAGON = 'Monkey.D.Dragon';
const donors = (s: GameState, p: PlayerId, target: number) => [s.players[p].leader, ...s.players[p].chars].filter((c) => c.uid !== target && c.don > 0);
const dragonTargets = (s: GameState, p: PlayerId) => s.players[p].chars.filter((c) => donors(s, p, c.uid).length > 0).map((c) => c.uid);
const dragonDon: Effect = effect((ctx) => {
  const target = chooseUpTo1(ctx, dragonTargets(ctx.s, ctx.me), `${DRAGON} : Personnage qui reçoit jusqu’à 2 DON!! déjà données :`, 'donTarget');
  if (target === null) return;
  const to = findField(ctx.s, target)!.card;
  for (let i = 0; i < 2; i++) {
    const list = donors(ctx.s, ctx.me, target);
    if (!list.length) return;
    const answer = ctx.ask({
      prompt: `${DRAGON} : carte dont 1 DON!! passe sur ${describe(ctx.s, target)} (${i + 1}/2) :`,
      options: [...list.map((c) => ({ id: `card:${c.uid}`, label: `${describe(ctx.s, c.uid)} (${c.don} DON!!)`, uid: c.uid })), { id: 'none', label: 'Aucune' }],
      tag: 'donSource',
    });
    if (answer === 'none') return;
    const from = findField(ctx.s, Number(answer.split(':')[1]))!.card;
    from.don--;
    to.don++;
    log(ctx.s, ctx.me, `déplace 1 DON!! de ${describe(ctx.s, from.uid)} vers ${describe(ctx.s, target)} (${DRAGON})`);
  }
}, (s, p) => dragonTargets(s, p).length > 0);

// Boa Hancock (Leader) : « peut être activé » (n° 1980) : ni un refus, ni une main de plus de 5 cartes n'usent la limite (Q&A) ;
// les retraits comptés sont ceux que le moteur annonce, comme Shakuyaku OP08-046 (question ouverte n° 9, carte en doute)
const HANCOCK_KEY = 'OP07-038:removed';
const hancockIf = (s: GameState, owner: PlayerId, self: FieldCard, e: GameEvent) => s.active === owner && e.by === owner && e.cause === 'effect'
  && e.zone === 'character' && !self.usedOpt.includes(HANCOCK_KEY) && s.players[owner].hand.length <= 5;
const hancockRun = (ctx: EffectCtx) => {
  const self = findField(ctx.s, ctx.source);
  if (!self || self.card.usedOpt.includes(HANCOCK_KEY) || !may(ctx, 'Boa Hancock : piocher 1 carte ?')) return;
  self.card.usedOpt.push(HANCOCK_KEY);
  drawCards(1).run(ctx);
};

// « Si la carte choisie attaque ce tour-ci, l'adversaire ne peut pas activer [Bloqueur] » : modification posée pour le tour
// sur la carte choisie, lue à chacune de ses attaques
const PERFUME = 'Perfume Femur';
const perfumeTargets = ownLeaderOrChar({ type: WARLORDS });
const perfume: Effect = effect((ctx) => {
  const uid = chooseUpTo1(ctx, candidates(ctx.s, ctx.me, perfumeTargets, undefined, ctx.source), `${PERFUME} : carte qui gagne +2000 de puissance pour le tour :`, 'ownPower');
  if (uid === null) return;
  addMod(ctx.s, { uid, stat: 'power', amount: 2000, until: 'turn', source: PERFUME });
  addMod(ctx.s, { uid, stat: 'blockerBan', amount: 0, until: 'turn', source: PERFUME });
  log(ctx.s, ctx.me, `${describe(ctx.s, uid)} gagne +2000 de puissance pour le tour ; s'il attaque ce tour-ci, l'adversaire ne peut pas activer [Bloqueur] (${PERFUME})`);
}, (s, p, self) => candidates(s, p, perfumeTargets, undefined, self).length > 0);

// Morgans : l'adversaire défausse 1 carte et montre le reste de sa main, puis pioche 1 carte, qu'il ne montre pas (Q&A)
const morgans: Effect = seq(oppDiscards(1), effect((ctx) => {
  const hand = ctx.s.players[ctx.opp].hand;
  reveal(ctx.s, hand.map((c) => c.uid), ctx.me);
  log(ctx.s, ctx.opp, hand.length ? `révèle sa main : ${hand.map((c) => def(c.num).name).join(', ')} (Morgans)` : 'n’a plus de carte en main (Morgans)');
  draw(ctx.s, ctx.opp, 1);
  log(ctx.s, ctx.opp, 'pioche 1 carte (Morgans)');
}));

// Monkey D. Luffy : Personnages de coût 4 ou plus de sa Défausse, autant qu'il veut, au-dessous du deck dans l'ordre de son
// choix ; +1000 pour le tour par tranche de 3 cartes placées (5 cartes : +1000, Q&A)
const LUFFY = 'Monkey.D.Luffy';
const luffyFits = (num: string) => cardMatches(num, { category: 'CHARACTER', costMin: 4 });
const luffyBottom: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const chosen: Card[] = [];
  for (;;) {
    const left = uniqueByNum(P.trash.filter((c) => luffyFits(c.num) && !chosen.includes(c)));
    if (!left.length) break;
    const answer = ctx.ask({
      prompt: `${LUFFY} : carte de ta Défausse à placer au-dessous de ton deck (${chosen.length} choisie${chosen.length > 1 ? 's' : ''}, +1000 par tranche de 3) :`,
      options: [...left.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })), { id: 'none', label: 'Terminer' }],
      tag: 'trashToDeck',
    });
    if (answer === 'none') break;
    chosen.push(P.trash.find((c) => c.uid === Number(answer.split(':')[1]))!);
  }
  if (!chosen.length) return;
  P.trash = P.trash.filter((c) => !chosen.includes(c));
  const ordered = bottomOrder(ctx, chosen);
  P.deck.push(...ordered);
  reveal(ctx.s, ordered.map((c) => c.uid), 'both');
  log(ctx.s, ctx.me, `place ${ordered.map((c) => def(c.num).name).join(', ')} de sa Défausse au-dessous de son deck (${LUFFY})`);
  const bonus = 1000 * Math.floor(ordered.length / 3);
  if (bonus && findField(ctx.s, ctx.source)) selfPowerMod(bonus, 'turn', LUFFY).run(ctx);
}, (s, p) => s.players[p].trash.some((c) => luffyFits(c.num)));

// Végapunk (Leader) : une carte {Egghead} de coût 5 ou moins de sa main, jouée ou placée face visible au-dessus de sa Vie ; un
// Événement ne se joue pas ni ne s'active ainsi (Q&A) : il ne peut qu'aller dans la Vie (n° 3103)
const VEGAPUNK = 'Vegapunk';
const vegapunkFits = (num: string) => cardMatches(num, { type: EGGHEAD, costMax: 5 });
const vegapunkPlayable = (s: GameState, p: PlayerId, num: string) => def(num).category !== 'EVENT' && playableByEffect(num) && canPlayFromHand(s, p)
  && (def(num).category !== 'CHARACTER' || canPlayCharacters(s, p, num));
const vegapunk: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const options = uniqueByNum(knownFirst(ctx.s, ctx.me, P.hand.filter((c) => vegapunkFits(c.num))));
  if (!options.length) return;
  const answer = ctx.ask({
    prompt: `${VEGAPUNK} : carte {Egghead} de coût 5 ou moins de ta main :`,
    options: [...options.map((c) => ({ id: `card:${c.uid}`, label: `${def(c.num).name} (coût ${def(c.num).cost})`, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucune' }],
    tag: 'playFree',
  });
  if (answer === 'none') return;
  const uid = Number(answer.split(':')[1]);
  const num = P.hand.find((c) => c.uid === uid)!.num;
  const play = vegapunkPlayable(ctx.s, ctx.me, num) && ctx.ask({
    prompt: `${VEGAPUNK} : jouer ${def(num).name} ou le placer face visible au-dessus de ta Vie ?`,
    options: [{ id: 'play', label: 'Jouer' }, { id: 'life', label: 'Placer dans la Vie' }],
    tag: 'chooseOne',
  }) === 'play';
  const [c] = P.hand.splice(P.hand.findIndex((x) => x.uid === uid), 1);
  if (play) {
    playCharacter(ctx, ctx.me, c, { from: 'hand' });
    return;
  }
  P.life.unshift({ ...c, faceUp: true });
  reveal(ctx.s, [c.uid], 'both');
  log(ctx.s, ctx.me, `place ${def(c.num).name} face visible au-dessus de sa Vie (${VEGAPUNK})`);
}, (s, p) => s.players[p].hand.some((c) => vegapunkFits(c.num)));


// Lucy : [En attaquant] [Une fois par tour] 1 Vie (dessus ou dessous) en main : épuiser facultatif, puis Vie sous condition
const LUCY = 'Lucy';
const lucyEffect = seq(rest(oppChar({ costMax: 4 }), LUCY), when(lifeAtMost(1), mayLifeFromDeck(LUCY)));

// Pickles : effet permanent sous condition de DON!!, pour ses Personnages {Foxy Pirates} d'un autre nom que le sien
const moreDonForOpp = (s: GameState, p: PlayerId) => donOnField(s, p) <= donOnField(s, other(p));

export const OP07: Record<string, CardBehavior> = {
  // Monkey D. Dragon (Leader) : [Activation : Principale] [Une fois par tour] voir dragonDon
  'OP07-001': card({
    activateMain: { label: `${DRAGON} : déplacer jusqu’à 2 DON!! déjà données sur 1 de tes Personnages`, once: true, condition: (s, p) => dragonTargets(s, p).length > 0, effect: dragonDon },
  }),

  // Ain : [Jouée] la puissance de jusqu'à 1 Personnage adverse devient 0 pour le tour : baisse égale à sa puissance du moment
  // (ce qui s'ajoute ensuite compte, ce qui dure au-delà revient : Q&A)
  'OP07-002': card({ onPlay: powerToZero(oppChar(), 'turn', 'Ain') }),

  // Masked Deuce : [Jouée] avec un Leader [Portgas.D.Ace], 5 cartes du dessus : 1 [Portgas.D.Ace] ou 1 Événement rouge en main,
  // le reste au-dessous ; sans ce Leader, rien, le deck n'est pas regardé (n° 1983)
  'OP07-013': card({
    onPlay: when(leaderNamed('Portgas.D.Ace'), searchTop(5, 1, { anyOf: [{ name: 'Portgas.D.Ace' }, { categories: ['EVENT'], color: 'Red' }] }, 'un [Portgas.D.Ace] ou un Événement rouge')),
  }),

  // Boa Hancock (Leader) : [Votre tour] [Une fois par tour] quand un Personnage quitte le terrain par son effet : voir hancockRun
  'OP07-038': {
    when: [
      { on: 'ko', if: hancockIf, run: hancockRun },
      { on: 'leave', if: hancockIf, run: hancockRun },
    ],
  },

  // Gecko Moria : [Une fois par tour] avec un Leader {Sept grands corsaires}, s'il devait quitter le terrain à cause d'un effet
  // adverse, il peut placer à la place 1 de ses Personnages d'un autre nom au-dessous du deck de son propriétaire (Q&A : sans
  // autre Personnage, non)
  'OP07-042': {
    replaceRemoval: {
      oncePerTurn: true,
      onlyKo: false,
      label: () => 'Gecko Moria : placer un autre de tes Personnages au-dessous de ton deck pour qu’il reste sur le terrain',
      condition: (s, p, self, victim) => victim.uid === self.uid && leaderType(WARLORDS)(s, p, self.uid)
        && s.players[p].chars.some((c) => !isNamed(c.num, 'Gecko Moria') && canLeaveByEffect(s, c.uid, p)),
      apply: (s, p, self, _victim, ctx) => {
        const list = s.players[p].chars.filter((c) => !isNamed(c.num, 'Gecko Moria') && canLeaveByEffect(s, c.uid, p));
        const answer = ctx.ask({
          player: p,
          prompt: 'Gecko Moria : Personnage à placer au-dessous de ton deck à la place :',
          options: list.map((c) => ({ id: `card:${c.uid}`, label: describe(s, c.uid), uid: c.uid })),
          tag: 'replace',
        });
        removeByEffect(ownerCtx(ctx, p, self), Number(answer.split(':')[1]), 'deckBottom');
      },
    },
  },

  // Perfume Femur : [Principale] voir perfume ; [Déclenchement] piocher 1 carte
  'OP07-057': card({ onMain: perfume, onTrigger: drawCards(1) }),

  // Foxy (Leader) : [En attaquant] DON!! −3 : avec 3 Personnages {Foxy Pirates} ou plus, jusqu'à 1 Leader épuisé adverse et
  // jusqu'à 1 Personnage épuisé adverse ne seront pas redressés à la prochaine phase de Recharge adverse (l'un sans l'autre
  // possible : Q&A)
  'OP07-059': card({
    whenAttacking: mayPay(donMinus(3), when(charsAtLeast(3, { type: FOXY }), seq(keepRested(oppLeader(), 'Foxy', 1), keepRested(oppChar(), 'Foxy', 1))), 'Foxy'),
  }),

  // Itomimizu : [Activation : Principale] [Une fois par tour] avec un Leader {Foxy Pirates} et aucun autre [Itomimizu] : 1 DON!!
  // épuisée
  'OP07-060': card({
    activateMain: {
      label: 'Itomimizu : ajouter 1 DON!! épuisée',
      once: true,
      condition: (s, p, self) => leaderType(FOXY)(s, p, self) && !s.players[p].chars.some((c) => c.uid !== self && isNamed(c.num, 'Itomimizu')),
      effect: addDonUpTo(1, 'rested', 'Itomimizu'),
    },
  }),

  // Pickles : voir moreDonForOpp ; ne se protège pas lui-même, ni un autre [Pickles]
  'OP07-069': {
    koShield: (s, p, _src, target, cause, by) => cause === 'effect' && by !== p && moreDonForOpp(s, p) && s.players[p].chars.some((c) => c.uid === target.uid)
      && def(target.num).types.includes(FOXY) && !isNamed(target.num, 'Pickles'),
  },

  // Slow-Slow Beam : [Contre] DON!! −1 : −2000 pour le tour à jusqu'à 1 Leader adverse et à jusqu'à 1 Personnage adverse
  'OP07-075': card({
    onCounter: mayPay(donMinus(1), seq(powerMod(oppLeader(), -2000, 'turn', 'Slow-Slow Beam'), powerMod(oppChar(), -2000, 'turn', 'Slow-Slow Beam')), 'Slow-Slow Beam'),
  }),

  // Morgans : [Jouée] voir morgans
  'OP07-090': card({ onPlay: morgans }),

  // Monkey D. Luffy : [En attaquant] jusqu'à 1 Personnage adverse de coût 2 ou moins dans la Défausse (pas un KO), puis luffyBottom
  'OP07-091': card({ whenAttacking: seq(removeChars(oppChar({ costMax: 2 }), 'trash', LUFFY, { n: 1 }), luffyBottom) }),

  // Lucy : voir lucyEffect ; la Vie se lit après le coût ; le coût se propose dès qu'il est payable (n° 1000)
  'OP07-112': card({
    whenAttacking: effect((ctx) => {
      onceWithCost('OP07-112:attack', lifeToHandCost('both'), lucyEffect, LUCY).run(ctx);
    }, (s, p, self) => !findField(s, self)?.card.usedOpt.includes('OP07-112:attack') && s.players[p].life.length > 0
      && (s.players[p].life.length <= 2 || lucyEffect.useful(s, p, self))),
  }),

  // Portgas D. Ace : [Jouée] ajouter jusqu'à 1 carte à sa Vie, puis, avec 2 Vies ou moins, [Initiative] pour le tour (Q&A : la
  // carte n'est pas obligée d'être ajoutée, et [Initiative] se lit après)
  'OP07-119': card({ onPlay: seq(mayLifeFromDeck('Portgas.D.Ace'), when(lifeAtMost(2), selfKeyword('Rush', 'Portgas.D.Ace', 'turn'))) }),

  // Végapunk (Leader) : ne peut pas attaquer ; [Activation : Principale] [Une fois par tour] épuiser 1 DON!! : voir vegapunk
  'OP07-097': card({
    activateMain: { label: `${VEGAPUNK} : jouer 1 carte {Egghead} de ta main ou la placer face visible dans ta Vie`, once: true, cost: restDon(1), effect: vegapunk },
  }, { cantAttack: () => true }),
};

// Morceaux de recettes codés à la main (aucun pour l'instant)
export const MANUAL_OP07 = {};
