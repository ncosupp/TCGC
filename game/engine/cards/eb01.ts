// EB01 (étape C, tâche S13) : les cartes que le traducteur ne comprend pas, ou que sa brique ne rend pas exactement,
// codées à la main d'après le texte officiel (VO, et VF quand elle existe ; jamais recopié). Le reste du set est en
// recettes (recipes/sets/eb01.ts).
// Choix d'interprétation : game/docs/interpretations.md, section « EB01 et ST13 (tâche S13) ».
import {
  addMod, canLeaveByEffect, chooseUpTo1, def, describe, discardFromHand, findField, hasType, knownFirst, log, may, oppChars, other, power,
  removeByEffect, removeFromField, reveal, uniqueByNum,
} from '../rules.ts';
import type { Card, CardBehavior, GameState, PlayerId } from '../types.ts';
import { reorderLife } from './bricks-life.ts';
import { computedEffect, playFromHandOrTrash } from './bricks-play.ts';
import {
  addDon, all, anyChar, bottomOfDeck, card, charsAtLeast, chooseOne, defenderPower, discard, donMinus, drawCards, effect, ko, leaderPower, leaderType,
  leaderTypeIncludes, lifeFromDeck, oppChar, playThis, selfDon, seq, trashAtLeast, when, withCost, type Cost,
  type Effect,
} from './bricks.ts';
import { returnOwnChars } from './bricks-removal.ts';
import { placeRest } from './bricks-cards.ts';
import { koByEffect } from './op09.ts';

// « Vous pouvez [coût] : [effet] » proposé seulement si l'effet peut servir (convention n° 1000 des recettes)
const mayPay = (cost: Cost, then: Effect, source: string): Effect => when((s, p, self) => then.useful(s, p, self), withCost(cost, then, source));

// « Ajoutez jusqu'à 1 carte du dessus de votre deck au-dessus de votre Vie » : on peut refuser (Q&A d'OP07-119, n° 3201) ;
// la brique des recettes ajoute la carte sans le demander
const mayLifeFromDeck = (source: string): Effect => effect((ctx) => {
  if (!ctx.s.players[ctx.me].deck.length) return;
  if (may(ctx, `${source} : ajouter la carte du dessus de ton deck au-dessus de ta Vie ?`)) lifeFromDeck().run(ctx);
}, (s, p) => s.players[p].deck.length > 0);

// « Placez dans votre Défausse des cartes du dessus de votre Vie jusqu'à n'en avoir plus que 1 » : rien avec 1 Vie ou moins
// (Q&A) ; pas des dégâts, donc pas de [Déclenchement]. Jamais « utile » : c'est le prix de l'effet qui précède.
const trashLifeDownTo1 = (source: string): Effect => effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  while (P.life.length > 1) {
    const top = P.life.shift()!;
    P.trash.push({ uid: top.uid, num: top.num });
    log(ctx.s, ctx.me, `place dans sa Défausse ${def(top.num).name}, la carte du dessus de sa Vie (${P.life.length} Vie) (${source})`);
  }
}, () => false);

// Oden (Leader) : ses cartes Personnage {Land of Wano} sans Contre ont Contre +1000
const WANO = 'Land of Wano';

// LittleOars Jr. : la clé de son [Une fois par tour]
const OARS_KEY = 'replace';
const isEventOrStage = (c: Card) => ['EVENT', 'STAGE'].includes(def(c.num).category);

// Gum-Gum Champion Rifle : l'adversaire choisit lequel de ses Personnages redressés il renvoie en main (Q&A), sans « jusqu'à »
const oppReturnsActive = (source: string): Effect => {
  const list = (s: GameState, p: PlayerId) => s.players[other(p)].chars.filter((c) => !c.rested && canLeaveByEffect(s, c.uid, p)).map((c) => c.uid);
  return effect((ctx) => {
    const options = list(ctx.s, ctx.me);
    if (!options.length) return;
    const answer = ctx.ask({
      player: ctx.opp,
      prompt: `${source} : lequel de tes Personnages redressés renvoyer dans ta main ?`,
      options: options.map((uid) => ({ id: `card:${uid}`, label: describe(ctx.s, uid), uid })),
      tag: 'returnOwn',
    });
    removeByEffect(ctx, Number(answer.split(':')[1]), 'hand');
  }, (s, p) => list(s, p).length > 0);
};

// Loguetown : le coût « cette carte et 1 carte de votre main au-dessous de votre deck, dans l'ordre de votre choix »
const loguetownCost: Cost = {
  label: 'placer ce Lieu et 1 carte de ta main au-dessous de ton deck',
  can: (s, p, self) => s.players[p].hand.length > 0 && Boolean(findField(s, self)),
  pay: (ctx) => {
    const P = ctx.s.players[ctx.me];
    if (!P.hand.length) return false;
    const options = uniqueByNum(knownFirst(ctx.s, ctx.me, P.hand));
    const answer = ctx.ask({
      prompt: 'Loguetown : carte de ta main à placer au-dessous de ton deck :',
      options: options.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })),
      tag: 'discard',
    });
    const [picked] = P.hand.splice(P.hand.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1);
    const f = removeFromField(ctx.s, ctx.source, 'deckBottom');
    if (!f) { P.hand.push(picked); return false; }
    // le Lieu vient d'être placé tout au-dessous : les deux cartes repassent par le choix de l'ordre
    const stage = P.deck.pop()!;
    log(ctx.s, ctx.me, `place ${def(f.card.num).name} et 1 carte de sa main au-dessous de son deck`);
    placeRest(ctx, [stage, picked], 'bottom', 'Loguetown');
    reveal(ctx.s, [stage.uid], 'both');
    return true;
  },
};

// La folle attitude : le Personnage choisi devient la cible de l'attaque, redressé ou non (Q&A) ; c'est déjà l'étape du
// [Contre] : il ne peut plus activer [Bloqueur] (Q&A)
const ownOtherChars = (s: GameState, p: PlayerId) => s.players[p].chars.filter((c) => c.uid !== s.battle?.target).map((c) => c.uid);
const redirectToOwnChar = (source: string): Effect => effect((ctx) => {
  const battle = ctx.s.battle;
  const options = ownOtherChars(ctx.s, ctx.me);
  if (!battle || !options.length) return;
  const answer = ctx.ask({
    prompt: `${source} : Personnage qui devient la cible de l'attaque :`,
    options: options.map((uid) => ({ id: `card:${uid}`, label: describe(ctx.s, uid), uid })),
    tag: 'kiddTarget',
  });
  battle.target = Number(answer.split(':')[1]);
  log(ctx.s, ctx.me, `la cible de l'attaque devient ${describe(ctx.s, battle.target)} (${source})`);
}, (s, p) => Boolean(s.battle) && ownOtherChars(s, p).length > 0);

// Viola : « toutes vos cartes de Vie face cachée », sans changer leur ordre (Q&A)
const turnLifeDown = (source: string): Effect => effect((ctx) => {
  const life = ctx.s.players[ctx.me].life.filter((c) => c.faceUp);
  for (const c of life) {
    c.faceUp = false;
    reveal(ctx.s, [c.uid], 'both');   // elle était publique : les deux joueurs la connaissent encore
  }
  if (life.length) log(ctx.s, ctx.me, `retourne ses cartes de Vie face cachée (${source})`);
}, (s, p) => s.players[p].life.some((c) => c.faceUp));

// Laboon EB01-047 : [Une fois par tour] quand un Personnage est mis KO, piocher 1 puis défausser 1 ; lui-même compris (Q&A) :
// sa propre mise KO passe par [En cas de KO], le seul effet que le moteur résout une fois la carte dans la Défausse
const LABOON = 'laboonKo';
const laboonDraw: Effect = seq(drawCards(1), discard(1));

// Bon Clay : la puissance de base de ce Personnage devient la puissance actuelle du Personnage choisi (Q&A : 5000 choisis
// et 1 DON!! donnée font 6000)
const copyPower = (source: string): Effect => effect((ctx) => {
  const uid = chooseUpTo1(ctx, oppChars(ctx), `${source} : Personnage adverse dont copier la puissance :`, 'oppLock');
  if (uid === null || !findField(ctx.s, ctx.source)) return;
  const amount = power(ctx.s, uid);
  addMod(ctx.s, { uid: ctx.source, stat: 'basePower', amount, until: 'turn', source });
  log(ctx.s, ctx.me, `${def(ctx.num).name} a une puissance de base de ${amount} pour tout le tour (${source})`);
}, (s, p) => s.players[other(p)].chars.length > 0);

const KINGDOM = 'Kingdom Come';
const KAMI = 'Did Someone Say...Kami?';
const CHAMPION = 'Gum-Gum Champion Rifle';
const WAY = 'Oh Come My Way';

export const EB01: Record<string, CardBehavior> = {
  // Oden (Leader) : Contre +1000 aux cartes {Land of Wano} sans Contre ; [DON!! x1] [En attaquant] avec un Personnage {Land
  // of Wano} de coût 5 ou plus, +1000 jusqu'au début de son prochain tour (garde le bonus si la condition ne tient plus : Q&A)
  'EB01-001': card({
    whenAttacking: when(all(selfDon(1), charsAtLeast(1, { type: WANO, costMin: 5 })), leaderPower(1000, 'oppNextEnd', 'Oden')),
  }, {
    handCounterAura: (_s, _p, _source, num) => (hasType(num, WANO) ? 1000 : 0),
  }),

  // LittleOars Jr. : [Une fois par tour] s'il devait être mis KO par un effet (pas en combat), défausser 1 Événement ou Lieu à
  // la place ; sans une telle carte, rien (Q&A)
  'EB01-008': {
    koReplace: {
      label: 'Défausser 1 carte Événement ou Lieu de ta main',
      condition: (s, p, self) => !self.usedOpt.includes(OARS_KEY) && koByEffect(s, self) && s.players[p].hand.some(isEventOrStage),
      apply: (s, p, self, ctx) => {
        self.usedOpt.push(OARS_KEY);
        if (discardFromHand(ctx, p, 1, 'LittleOars Jr. : carte à défausser à la place', isEventOrStage) === 1) log(s, p, `${def(self.num).name} reste sur le terrain`);
      },
    },
  },

  // Hannyabal (Leader) : [Fin de votre tour] renvoyer en main 1 de ses Personnages {Impel Down} de coût 2 ou plus : 1 DON!!
  // redressée du deck DON!!. Proposé même si le deck DON!! est vide (Q&A, plus précise que la convention n° 1000)
  'EB01-021': card({
    endOfTurn: withCost(returnOwnChars(1, { type: 'Impel Down', costMin: 2 }), addDon(1, 'active'), 'Hannyabal'),
  }),

  // Gum-Gum Champion Rifle : [Contre] avec un Leader {Impel Down} : +2000 pour le combat, puis l'adversaire renvoie en main 1
  // de ses Personnages redressés (la condition couvre le « Puis » : n° 1983 et Q&A) ; [Déclenchement] sous le deck
  'EB01-028': card({
    onCounter: when(leaderType('Impel Down'), seq(
      defenderPower(2000, CHAMPION),
      oppReturnsActive(CHAMPION),
    )),
    onTrigger: bottomOfDeck(anyChar({ costMax: 3 }), CHAMPION),
  }),

  // Loguetown (Lieu) : [Activation : Principale] ce Lieu et 1 carte de la main sous le deck : piocher 2 ; [Déclenchement] se jouer
  'EB01-030': card({
    activateMain: { label: 'Loguetown : placer ce Lieu et 1 carte de ta main au-dessous de ton deck pour piocher 2 cartes', cost: loguetownCost, effect: drawCards(2) },
    onTrigger: playThis(),
  }),

  // Laboon : voir LABOON
  'EB01-047': card({ onKO: laboonDraw }, {
    onKOCondition: (_s, _p, self) => !self.usedOpt.includes(LABOON),
    when: [{
      on: 'ko',
      once: LABOON,
      if: (_s, _owner, _self, e) => e.zone === 'character',
      run: (ctx) => laboonDraw.run(ctx),
    }],
  }),

  // La folle attitude : [Contre] DON!! −1 : avec un Leader dont le type inclut « Baroque Works », changer la cible de l'attaque ;
  // [Déclenchement] DON!! −1 : piocher 2
  'EB01-038': card({
    onCounter: mayPay(donMinus(1), when(leaderTypeIncludes('Baroque Works'), redirectToOwnChar(WAY)), WAY),
    onTrigger: mayPay(donMinus(1), drawCards(2), WAY),
  }),

  // ...I Want to Live!! : [Contre] avec 30 cartes ou plus dans la Défausse, jusqu'à 1 carte du deck dans la Vie
  'EB01-050': card({ onCounter: when(trashAtLeast(30), mayLifeFromDeck('...I Want to Live!!')) }),

  // Viola : [Bloqueur] ; [Jouée] au choix : regarder et remettre en ordre la Vie adverse (chaque carte garde sa face : Q&A),
  // ou retourner toute sa Vie face cachée
  'EB01-052': card({
    onPlay: chooseOne('Viola', [
      { label: 'Regarder toute la Vie adverse et la remettre dans l\'ordre de ton choix', effect: effect((ctx) => reorderLife('opp', 'Viola').run(ctx), (s, p) => s.players[other(p)].life.length > 0) },
      { label: 'Retourner toutes tes cartes de Vie face cachée', effect: turnLifeDown('Viola') },
    ]),
  }),

  // Shirahoshi : [Bloqueur] ; quand elle est mise KO par un effet adverse, jusqu'à 1 carte du deck dans la Vie
  'EB01-057': card({ onKO: mayLifeFromDeck('Shirahoshi') }, {
    onKOCondition: (_s, owner, _self, cause, by) => cause === 'effect' && by === other(owner),
  }),

  // Kingdom Come : [Principale] KO d'un Personnage adverse, puis la Vie descend à 1 ; [Déclenchement] KO de coût au plus la
  // somme des deux Vies (la carte révélée n'en est déjà plus : Q&A)
  'EB01-059': card({
    onMain: seq(ko(oppChar(), KINGDOM), trashLifeDownTo1(KINGDOM)),
    onTrigger: computedEffect((s, p) => ko(oppChar({ costMax: s.players[p].life.length + s.players[other(p)].life.length }), KINGDOM)),
  }),

  // Me voilà, je suis... Dieu ! : [Principale] jouer [Enel] de coût 7 ou moins (main ou Défausse), puis la Vie descend à 1 ;
  // [Déclenchement] piocher 2, défausser 1
  'EB01-060': card({
    onMain: seq(playFromHandOrTrash({ name: 'Enel', costMax: 7 }, KAMI), trashLifeDownTo1(KAMI)),
    onTrigger: seq(drawCards(2), discard(1)),
  }),

  // Bon Clay : [Jouée] jusqu'à 1 DON!! redressée ; [En attaquant] copie de puissance
  'EB01-061': card({
    onPlay: addDon(1, 'active'),
    whenAttacking: copyPower('Mr.2.Bon.Kurei'),
  }),
};

// Morceaux de recettes codés à la main : aucun
export const MANUAL_EB01 = {};
