// CARTES D'OP01 CODÉES À LA MAIN (étape C, tâche S19) : celles que le traducteur ne comprend pas (évènements « quand ... »,
// cartes choisies dans la main adverse, protection en combat par attribut, « ne peut attaquer que ... ») ou dont la brique
// contredit les Q&A officielles (Holedem : « jusqu'à 1 » DON!!, on peut refuser). Codées d'après leur texte officiel (VO ; la VF
// manque pour presque tout le set) et les Q&A d'OP01 ; les choix d'interprétation sont dans game/docs/interpretations.md
// (section « OP01 (tâche S19) », 3800 à 3899). Aucun texte de carte ici. Le reste du set est en recettes (recipes/sets/op01.ts).
import {
  addDonFromDeck, addMod, canBeKO, canLeaveByEffect, canPlayCharacters, chooseUpTo1, def, describe, emit, findField, log, may, other, playableByEffect,
  playCharacter, removeByEffect, reveal, setActive, shuffleDeck, uniqueByNum,
} from '../rules.ts';
import { random } from '../rng.ts';
import type { CardBehavior, Color, EffectCtx, GameState, PlayerId } from '../types.ts';
import {
  candidates, card, defenderPower, donMinus, drawCards, effect, grant, ko, koImmuneInBattle, leaderType, lifeAtMost, mayPay, oppChar,
  ownChar, ownLeaderOrChar, powerMod, restDon, restSelf, selfDon, seq, when, type CharSpec, type Cost, type Effect,
} from './bricks.ts';
import { giveDonToSelf } from './bricks-don.ts';
import { replacersLast } from './bricks-removal.ts';
import { playFromHandAtCost } from './bricks-play.ts';

const COLORS: Color[] = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

// Trafalgar Law (Leader) : avec 5 Personnages, en renvoyer 1 dans la main (par un effet : un remplacement peut l'empêcher) ; puis,
// toujours sous la condition (4-10), jouer de la main un Personnage de coût 5 ou moins d'une autre couleur que celui renvoyé (le
// coût à payer, n° 1986). Aucun Personnage multicolore au catalogue : « d'une autre couleur » = aucune de ses couleurs (n° 3801)
const LAW = 'Trafalgar Law';
const lawSwap: Effect = effect((ctx) => {
  const list = ctx.s.players[ctx.me].chars.map((c) => c.uid);
  if (!list.length) return;
  const uid = Number(ctx.ask({
    prompt: `${LAW} : Personnage à renvoyer dans ta main :`,
    options: list.map((u) => ({ id: `card:${u}`, label: describe(ctx.s, u), uid: u })),
    tag: 'returnOwn',
  }).split(':')[1]);
  const colors = def(findField(ctx.s, uid)!.card.num).colors;
  if (!removeByEffect(ctx, uid, 'hand')) return;
  const others: CharSpec[] = COLORS.filter((c) => !colors.includes(c)).map((color) => ({ color }));
  playFromHandAtCost({ costMax: 5, anyOf: others }, LAW).run(ctx);
}, (s, p) => s.players[p].chars.length > 0);

// Monkey.D.Luffy (Leader) : jusqu'à 1 de ses Personnages {Supernovas} ou {Straw Hat Crew} de coût 5 ou moins redressé, puis +1000
// pour le tour (Q&A : il peut attaquer de nouveau)
const LUFFY = 'Monkey.D.Luffy';
const LUFFY_TARGET = ownChar({ costMax: 5, anyOf: [{ type: 'Supernovas' }, { type: 'Straw Hat Crew' }] });
const luffyReady: Effect = effect((ctx) => {
  const uid = chooseUpTo1(ctx, candidates(ctx.s, ctx.me, LUFFY_TARGET), `${LUFFY} : ${LUFFY_TARGET.label} à redresser (+1000 pour le tour) :`, 'ownGrant');
  if (uid === null) return;
  setActive(ctx.s, ctx.me, uid);
  addMod(ctx.s, { uid, stat: 'power', amount: 1000, until: 'turn', source: LUFFY });
  log(ctx.s, ctx.me, `${def(findField(ctx.s, uid)!.card.num).name} gagne +1000 de puissance pour le tour (${LUFFY})`);
}, (s, p) => candidates(s, p, LUFFY_TARGET).some((uid) => findField(s, uid)!.card.rested));

// Gordon : le coût glisse une carte de la main sous le deck (lui seul la connaît)
const handToBottomCost: Cost = {
  label: 'placer 1 carte de ta main au-dessous de ton deck',
  can: (s, p) => s.players[p].hand.length > 0,
  pay: (ctx) => {
    const P = ctx.s.players[ctx.me];
    if (!P.hand.length) return false;
    const answer = ctx.ask({
      prompt: 'Carte de ta main à placer au-dessous de ton deck :',
      options: P.hand.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid })),
      tag: 'discard',
    });
    const [c] = P.hand.splice(P.hand.findIndex((x) => x.uid === Number(answer.split(':')[1])), 1);
    P.deck.push(c);
    reveal(ctx.s, [c.uid], ctx.me);
    log(ctx.s, ctx.me, 'place 1 carte de sa main au-dessous de son deck');
    return true;
  },
};

// Kanjuro : [En cas de KO] l'adversaire choisit 1 carte de sa main, face cachée (Q&A) : au hasard, comme les autres cartes prises
// dans une main cachée (X-Drake OP17-075) ; elle va dans la Défausse
const KANJURO = 'Kanjuro';
const oppPicksFromMyHand: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  if (!P.hand.length) return;
  const [c] = P.hand.splice(Math.floor(random(ctx.s) * P.hand.length), 1);
  P.trash.push(c);
  P.discardedTurn = ctx.s.turn;
  log(ctx.s, ctx.me, `l'adversaire choisit ${def(c.num).name} dans sa main : dans la Défausse (${KANJURO})`);
  emit(ctx.s, { type: 'discard', player: ctx.me, count: 1, by: ctx.me, sourceNum: ctx.num });
}, (s, p) => s.players[p].hand.length > 0);

// « Choisissez N cartes de la main adverse ; votre adversaire les révèle » (Arlong, Bao Huang) : face cachée (Q&A), donc au hasard ;
// elles sont révélées au joueur (le propriétaire les connaît déjà)
function pickOppHand(ctx: EffectCtx, n: number, source: string) {
  const O = ctx.s.players[ctx.opp];
  const pool = [...O.hand];
  const chosen = [];
  for (let i = 0; i < n && pool.length; i++) chosen.push(...pool.splice(Math.floor(random(ctx.s) * pool.length), 1));
  if (!chosen.length) return chosen;
  reveal(ctx.s, chosen.map((c) => c.uid), ctx.me);
  log(ctx.s, ctx.opp, `révèle ${chosen.map((c) => def(c.num).name).join(', ')} de sa main (${source})`);
  return chosen;
}

// Arlong : une carte de la main adverse révélée ; un Événement : jusqu'à 1 carte du dessus de la Vie adverse (règle 3-10-2) au-dessous
// du deck de son propriétaire. Sans main adverse, rien (Q&A)
const ARLONG = 'Arlong';
const arlongPeek: Effect = effect((ctx) => {
  const [c] = pickOppHand(ctx, 1, ARLONG);
  const O = ctx.s.players[ctx.opp];
  if (!c || def(c.num).category !== 'EVENT' || !O.life.length) return;
  if (!may(ctx, `${ARLONG} : placer la carte du dessus de la Vie adverse au-dessous du deck adverse ?`)) return;
  const top = O.life.shift()!;
  O.deck.push({ uid: top.uid, num: top.num });
  log(ctx.s, ctx.opp, `la carte du dessus de sa Vie va au-dessous de son deck (${ARLONG}, ${O.life.length} Vie)`);
}, (s, p) => s.players[other(p)].hand.length > 0);

// Caesar Clown, Kurozumi Orochi : jusqu'à 1 carte d'un nom prise dans le deck (jouée, ou révélée et ajoutée à la main), puis le
// deck est toujours mélangé (« Then » sans condition ; comme Kouzuki Oden OP02-030)
const fromDeckByName = (name: string, play: boolean, source: string): Effect => effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const fits = (num: string) => def(num).names.includes(name) && (!play || (def(num).category === 'CHARACTER' && playableByEffect(num) && canPlayCharacters(ctx.s, ctx.me, num)));
  const options = uniqueByNum(P.deck.filter((c) => fits(c.num)));
  if (options.length && (!play || canPlayCharacters(ctx.s, ctx.me))) {
    const answer = ctx.ask({
      prompt: `${source} : ${play ? 'jouer' : 'ajouter à ta main'} jusqu’à 1 [${name}] de ton deck :`,
      options: [...options.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucune' }],
      tag: play ? 'playFree' : 'pick',
    });
    if (answer !== 'none') {
      const [chosen] = P.deck.splice(P.deck.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1);
      if (play) playCharacter(ctx, ctx.me, chosen);
      else {
        P.hand.push(chosen);
        reveal(ctx.s, [chosen.uid], ctx.opp);
        log(ctx.s, ctx.me, `révèle ${def(chosen.num).name} de son deck et l'ajoute à sa main (${source})`);
      }
    }
  }
  shuffleDeck(ctx.s, ctx.me);
  log(ctx.s, ctx.me, `mélange son deck (${source})`);
});

// Crocodile (Leader) : [DON!! x1] quand il active un Événement (pas un [Déclenchement] : Q&A), une fois l'Événement résolu (Q&A), il
// peut piocher 1 carte s'il a 4 cartes ou moins en main à ce moment (Q&A) et n'a pas encore pioché par cet effet ce tour-ci (la
// limite n'est prise que s'il pioche : Q&A)
const CROCO_DRAW = 'OP01-062:pioche';
const crocodileDraw = (ctx: EffectCtx) => {
  const f = findField(ctx.s, ctx.source);
  const P = ctx.s.players[ctx.me];
  if (!f || f.card.usedOpt.includes(CROCO_DRAW) || P.hand.length > 4 || !P.deck.length) return;
  if (!may(ctx, 'Crocodile : piocher 1 carte ?')) return;
  f.card.usedOpt.push(CROCO_DRAW);
  drawCards(1).run(ctx);
};

// Holedem : [En cas de KO] « jusqu'à 1 » DON!! : on peut refuser (Q&A ; les briques communes en ajoutent toujours le maximum, n° 3608)
const HOLEDEM = 'Holedem';
const holedemDon: Effect = effect((ctx) => {
  if (ctx.s.players[ctx.me].donDeck <= 0 || !may(ctx, `${HOLEDEM} : ajouter 1 DON!! épuisée de ton deck DON!! ?`)) return;
  addDonFromDeck(ctx.s, ctx.me, 1, false);
}, (s, p) => s.players[p].donDeck > 0);

// Des KO simultanés (Kaido OP01-094, King OP01-096) : les cibles sont choisies d'abord, puis mises KO dans un même effet (une décision
// de remplacement vaut pour toutes : Q&A de Sabo OP05-001, n° 3400). Une carte qui remplace le KO des autres (Rosinante OP05-030 :
// Q&A, Kaido la met KO avec 2 Personnages épuisés, sa mise en Défausse les sauve) passe en dernier, pour que son remplacement leur
// soit proposé avant son propre KO.
function koTogether(ctx: EffectCtx, uids: number[]) {
  for (const uid of replacersLast(ctx.s, uids)) if (findField(ctx.s, uid)) removeByEffect(ctx, uid, 'ko');
}
const koable = (s: GameState, p: PlayerId, uid: number) => canBeKO(s, uid, 'effect', p) && canLeaveByEffect(s, uid, p);

// Kaido : [Jouée] DON!! −6 : avec un Leader {Animal Kingdom Pirates}, tous les Personnages autres que lui (cette carte seulement : Q&A)
// mis KO ensemble ; sans ce Leader, le coût se paie et rien ne suit (Q&A)
const KAIDO = 'Kaido';
const kaidoKoAll: Effect = effect((ctx) => {
  koTogether(ctx, [ctx.opp, ctx.me].flatMap((p) => ctx.s.players[p].chars.filter((c) => c.uid !== ctx.source && koable(ctx.s, ctx.me, c.uid)).map((c) => c.uid)));
}, (s, p, self) => s.players.some((P) => P.chars.some((c) => c.uid !== self && koable(s, p, c.uid))));

// King : [Jouée] DON!! −2 : jusqu'à 1 Personnage adverse de coût 3 ou moins et jusqu'à 1 de coût 2 ou moins (un autre), mis KO ensemble
// (Q&A : activable avec une seule cible)
const KING = 'King';
const kingKo: Effect = effect((ctx) => {
  const list = (costMax: number, not: number[]) => candidates(ctx.s, ctx.me, oppChar({ costMax })).filter((u) => !not.includes(u) && koable(ctx.s, ctx.me, u));
  const a = chooseUpTo1(ctx, list(3, []), `${KING} : Personnage adverse de coût 3 ou moins à mettre KO :`, 'oppKo');
  const b = chooseUpTo1(ctx, list(2, a === null ? [] : [a]), `${KING} : Personnage adverse de coût 2 ou moins à mettre KO :`, 'oppKo');
  koTogether(ctx, [a, b].filter((u): u is number => u !== null));
}, (s, p) => candidates(s, p, oppChar({ costMax: 3 })).some((u) => koable(s, p, u)));

// Kurozumi Semimaru : « Personnages {Kurozumi Clan} autres que vos [Kurozumi Semimaru] » : codé pour les siens seulement (lecture 1 du
// doute n° 3804 : la carte reste non jouable jusqu'à la réponse)
const SEMIMARU = 'Kurozumi Semimaru';
const isChar = (s: GameState, p: PlayerId, uid: number) => s.players[p].chars.some((c) => c.uid === uid);

export const OP01: Record<string, CardBehavior> = {
  // Trafalgar Law (Leader) : [Activation : Principale] [Une fois par tour] ➁ : voir plus haut
  'OP01-002': card({
    activateMain: {
      label: `${LAW} : ➁ : avec 5 Personnages, en renvoyer 1 dans ta main puis jouer un Personnage d'une autre couleur`,
      once: true,
      cost: restDon(2),
      effect: when((s, p) => s.players[p].chars.length === 5, lawSwap),
    },
  }),

  // Monkey.D.Luffy (Leader) : [Activation : Principale] [Une fois par tour] ➃ : voir plus haut
  'OP01-003': card({
    activateMain: { label: `${LUFFY} : ➃ : redresser 1 Personnage {Supernovas} ou {Straw Hat Crew} de coût 5 ou moins (+1000)`, once: true, cost: restDon(4), effect: luffyReady },
  }),

  // Usopp : [DON!! x1] [Votre tour] [Une fois par tour] quand l'adversaire active un Événement (pas un [Déclenchement] : Q&A), une fois
  // l'Événement résolu (Q&A), piocher 1 carte, obligatoire (Q&A) ; rien s'il a quitté le terrain entre-temps (Q&A)
  'OP01-004': card({}, {
    when: [{
      on: 'event',
      once: 'OP01-004:usopp',
      if: (s, owner, self, e) => e.player === other(owner) && s.active === owner && self.don >= 1,
      run: (ctx) => { if (findField(ctx.s, ctx.source)) drawCards(1).run(ctx); },
    }],
  }),

  // Gordon : [Jouée] vous pouvez placer 1 carte de votre main au-dessous du deck : piocher 1 carte (sans autre carte en main, rien : Q&A)
  'OP01-011': card({ onPlay: mayPay(handToBottomCost, drawCards(1), 'Gordon') }),

  // Franky : [DON!! x1] peut aussi attaquer les Personnages adverses redressés (pas le tour où il est joué : Q&A) ; comme OP02-014
  'OP01-021': card({}, { attackActive: (_s, _p, self) => self.don >= 1 }),

  // Monkey D. Luffy : [DON!! x2] ne peut pas être mis KO en combat par un Personnage <Strike> (seulement l'issue du combat : Q&A ; un
  // Leader <Strike> n'est pas un Personnage) ; [Activation : Principale] [Une fois par tour] se donner jusqu'à 2 DON!! épuisées
  'OP01-024': card({
    activateMain: { label: 'Monkey D. Luffy : se donner jusqu’à 2 DON!! épuisées', once: true, effect: giveDonToSelf(2) },
  }, { cantBeKO: koImmuneInBattle({ attribute: 'Strike', characters: true }, selfDon(2)) }),

  // Radical Beam : [Contre] +2000 pour le combat à la carte attaquée (n° 20), puis, avec 2 Vies ou moins, encore +2000 à la même carte ;
  // [Déclenchement] jusqu'à 1 de ses Leader ou Personnages +1000 pour le tour
  'OP01-029': card({
    onCounter: seq(defenderPower(2000, 'Radical Beam'), when(lifeAtMost(2), defenderPower(2000, 'Radical Beam'))),
    onTrigger: powerMod(ownLeaderOrChar(), 1000, 'turn', 'Radical Beam'),
  }),

  // Kanjuro : [DON!! x1] [En attaquant] KO d'un Personnage adverse épuisé de coût 2 ou moins ; [En cas de KO] voir plus haut
  'OP01-038': card({ whenAttacking: when(selfDon(1), ko(oppChar({ costMax: 2, rested: true }), KANJURO)), onKO: oppPicksFromMyHand }),

  // Eustass "Captain" Kidd : [DON!! x1] [Tour adverse] épuisé, l'adversaire ne peut attaquer qu'un Personnage de ce nom (Q&A : avec
  // deux, l'un ou l'autre) ; [Activation : Principale] [Une fois par tour] s'épuiser : jouer de la main un Personnage de coût 3 ou
  // moins (activable sans carte à jouer : Q&A)
  'OP01-051': card({
    activateMain: { label: 'Eustass "Captain" Kidd : s’épuiser pour jouer un Personnage de coût 3 ou moins de ta main', once: true, cost: restSelf(), effect: playFromHandAtCost({ costMax: 3 }, 'Eustass "Captain" Kidd') },
  }, { taunt: (s, owner, self) => s.active !== owner && self.rested && self.don >= 1 }),

  // Crocodile (Leader) : voir plus haut ([DON!! x1] lu quand l'Événement est activé)
  'OP01-062': card({}, {
    when: [{ on: 'event', if: (_s, owner, self, e) => e.player === owner && self.don >= 1, run: crocodileDraw }],
  }),

  // Arlong : [DON!! x1] [Activation : Principale] s'épuiser : voir plus haut (pas une fois par tour)
  'OP01-063': card({
    activateMain: { label: `${ARLONG} : s’épuiser pour révéler 1 carte de la main adverse`, condition: selfDon(1), cost: restSelf(), effect: arlongPeek },
  }),

  // Crocodile : [Exil] (mot-clé) ; [DON!! x1] les Événements bleus de sa main coûtent 1 de moins (jamais moins de 0, même avec
  // plusieurs : Q&A ; le plancher de handCost)
  'OP01-067': card({}, {
    handCostAura: (_s, _p, src, num) => (src.don >= 1 && def(num).category === 'EVENT' && def(num).colors.includes('Blue') ? -1 : 0),
  }),

  // Caesar Clown : [En cas de KO] jusqu'à 1 [Smiley] joué de son deck, puis le deck est mélangé
  'OP01-069': card({ onKO: fromDeckByName('Smiley', true, 'Caesar Clown') }),

  // Pacifista : [Bloqueur] (mot-clé) ; autant d'exemplaires qu'on veut dans un deck (deckRules.ts lit le texte, comme OP08-072 ; pas
  // plus de 50 cartes : Q&A)
  'OP01-075': {},

  // Mr.3 (Galdino) : [Jouée] avec un Leader {Baroque Works}, jusqu'à 1 Personnage adverse de coût 4 ou moins ne peut pas attaquer
  // jusqu'à la fin du prochain tour adverse (jouée pendant le tour adverse : jusqu'à la fin de ce tour, Q&A)
  'OP01-085': card({
    onPlay: when(leaderType('Baroque Works'), grant(oppChar({ costMax: 4 }), { stat: 'cantAttack' }, 'oppNextEnd', 'Mr.3', 'ne peut pas attaquer')),
  }),

  // Kaido, King : voir plus haut
  'OP01-094': card({ onPlay: mayPay(donMinus(6), when(leaderType('Animal Kingdom Pirates'), kaidoKoAll), KAIDO) }),
  'OP01-096': card({ onPlay: mayPay(donMinus(2), kingKo, KING) }),

  // Kurozumi Orochi : [Jouée] jusqu'à 1 [Artificial Devil Fruit SMILE] révélée de son deck et ajoutée à sa main, puis le deck est mélangé
  'OP01-098': card({ onPlay: fromDeckByName('Artificial Devil Fruit SMILE', false, 'Kurozumi Orochi') }),

  // Kurozumi Semimaru : ses Personnages {Kurozumi Clan} autres que [Kurozumi Semimaru] ne peuvent pas être mis KO en combat (doute n° 3804)
  'OP01-099': card({}, {
    koShield: (s, owner, _src, target, cause) => cause === 'battle' && isChar(s, owner, target.uid)
      && def(target.num).types.includes('Kurozumi Clan') && !def(target.num).names.includes(SEMIMARU),
  }),

  // Bao Huang : [Jouée] 2 cartes de la main adverse choisies ensemble, face cachée, et révélées ensemble (Q&A)
  'OP01-105': card({ onPlay: effect((ctx) => { pickOppHand(ctx, 2, 'Bao Huang'); }, (s, p) => s.players[other(p)].hand.length > 0) }),

  // Holedem : voir plus haut
  'OP01-113': card({ onKO: holedemDon }),
};
