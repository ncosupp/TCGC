// CARTES D'OP02 CODÉES À LA MAIN (étape C, tâche S18) : celles que le traducteur ne comprend pas (évènements « quand ... », effets
// « à la fin du combat », « piochez jusqu'à avoir N cartes », réduction du prochain Personnage joué, choix laissé à l'adversaire) ou
// dont la brique contredit les Q&A officielles. Codées d'après leur texte officiel (VO : la VF manque pour presque tout le set) et les
// Q&A d'OP02 ; les choix d'interprétation sont dans game/docs/interpretations.md (section « OP02 (tâche S18) », 3700 à 3799). Aucun
// texte de carte ici. Le reste du set est en recettes (recipes/sets/op02.ts).
import {
  addMod, canPlayCharacters, def, donOnField, emit, fieldCards, findField, log, other, playableByEffect, playCharacter, removeByEffect,
  setActive, shuffleDeck, uniqueByNum, untilOpponentsNextEnd,
} from '../rules.ts';
import type { CardBehavior, FieldCard, GameState, PlayerId } from '../types.ts';
import {
  anyChar, bottomOfDeck, bounce, card, cardMatches, costMod, defenderPower, discardCost, donMinus, drawCards, effect, grant,
  koOppStage, leaderPower, leaderType, mayPay, noBaseEffect, oppChar, oppLeaderOrChar, ownChar, playThis, powerMod, readySelf,
  restDon, searchTop, selfDon, seq, when, type Condition, type Effect,
} from './bricks.ts';
import { addDonUpTo, readyDonUpTo, returnOppDon } from './bricks-don.ts';
import { playFromHandAtCost } from './bricks-play.ts';

const WB = 'Whitebeard Pirates';
const WANO = 'Land of Wano';
const IMPEL = 'Impel Down';

// « Piochez jusqu'à avoir N cartes en main » : rien à piocher s'il en a déjà N ou plus, aucune à défausser (Q&A d'OP02-051, OP02-069)
const drawUpTo = (n: number): Effect => effect((ctx) => {
  const k = n - ctx.s.players[ctx.me].hand.length;
  if (k > 0) drawCards(k).run(ctx);
}, (s, p) => s.players[p].hand.length < n && s.players[p].deck.length > 0);

// « Piochez jusqu'à N cartes » : le joueur choisit combien (0 à N)
const drawChosen = (n: number, source: string): Effect => effect((ctx) => {
  const max = Math.min(n, ctx.s.players[ctx.me].deck.length);
  if (max <= 0) return;
  const answer = ctx.ask({
    prompt: `${source} : combien de cartes piocher ?`,
    options: [...Array.from({ length: max }, (_, i) => max - i).map((k) => ({ id: `n:${k}`, label: `${k} carte${k > 1 ? 's' : ''}` })), { id: 'none', label: 'Aucune' }],
    tag: 'donCount',
  });
  if (answer !== 'none') drawCards(Number(answer.split(':')[1])).run(ctx);
}, (s, p) => s.players[p].deck.length > 0);

// « Votre adversaire renvoie N DON!! » : il choisit lesquelles (Q&A d'OP02-085, OP02-089, OP02-090, OP02-091) : brique commune
// `returnOppDon` (bricks-don.ts, n° 3700, 1993)
const oppReturnsDon = returnOppDon;
const oppHasSixDon: Condition = (s, p) => donOnField(s, other(p)) >= 6;
const impelTrigger = (source: string) => when(oppHasSixDon, oppReturnsDon(1, source));

// Curly Dadan : « regardez jusqu'à 5 cartes » : le joueur choisit combien (1 à 5) ; jusqu'à 1 Personnage rouge de coût 1 en main, le
// reste au-dessous du deck dans l'ordre de son choix
const DADAN = 'Curly Dadan';
const dadanLook: Effect = effect((ctx) => {
  const max = Math.min(5, ctx.s.players[ctx.me].deck.length);
  if (max <= 0) return;
  const n = max === 1 ? 1 : Number(ctx.ask({
    prompt: `${DADAN} : combien de cartes du dessus de ton deck regarder ?`,
    options: Array.from({ length: max }, (_, i) => max - i).map((k) => ({ id: `n:${k}`, label: `${k} carte${k > 1 ? 's' : ''}` })),
    tag: 'donCount',
  }).split(':')[1]);
  searchTop(n, 1, { category: 'CHARACTER', color: 'Red', costMin: 1, costMax: 1 }, 'un Personnage rouge de coût 1').run(ctx);
}, (s, p) => s.players[p].deck.length > 0);

// Moby Dick : [Votre tour] avec 1 carte de Vie ou moins, ses [Edward.Newgate] (Leader et Personnages) et ses Personnages dont un type
// inclut « Whitebeard Pirates » gagnent +2000, une seule fois chacun (Q&A : le Personnage [Edward.Newgate] gagne +2000, pas +4000)
const NEWGATE = 'Edward.Newgate';
const mobyDickAura = (s: GameState, p: PlayerId, _src: FieldCard, tg: FieldCard) => {
  if (s.active !== p || s.players[p].life.length > 1) return 0;
  const d = def(tg.num);
  const isChar = s.players[p].chars.some((c) => c.uid === tg.uid);
  return d.names.includes(NEWGATE) || (isChar && d.types.some((t) => t.includes(WB))) ? 2000 : 0;
};

// Kin'emon (Leader) : avec 1 Personnage ou moins (lu à l'activation), le prochain Personnage {Land of Wano} de coût 3 ou plus joué de
// la main ce tour-ci en payant son coût coûte 1 de moins. Q&A : la condition n'est lue qu'à l'activation ; une carte jouée par un effet
// ne profite pas de la réduction et ne l'use pas (paidOnly) ; un autre Personnage joué avant ne l'use pas non plus
const KINEMON = "Kin'emon";
const kinemonDiscount: Effect = effect((ctx) => {
  ctx.s.players[ctx.me].nextPlayDiscount = { turn: ctx.s.turn, name: '', type: WANO, costMin: 3, amount: 1, paidOnly: true };
  log(ctx.s, ctx.me, `le prochain Personnage {${WANO}} de coût 3 ou plus joué de sa main ce tour-ci coûtera 1 de moins (${KINEMON})`);
}, (s, p) => s.players[p].hand.some((c) => def(c.num).category === 'CHARACTER' && def(c.num).types.includes(WANO) && (def(c.num).cost ?? 0) >= 3));

// Inuarashi : « toutes vos DON!! sont épuisées » : aucune DON!! redressée, aucune DON!! donnée (Q&A), et au moins une DON!! (sans DON!!,
// faux, comme « les seuls Personnages ... » sans Personnage, n° 1902)
const allDonRested = (s: GameState, p: PlayerId) => {
  const P = s.players[p];
  return P.donActive === 0 && P.donRested > 0 && fieldCards(s, p).every((c) => c.don === 0);
};

// Kouzuki Oden : [En cas de KO] jusqu'à 1 Personnage {Land of Wano} vert de coût 3 exactement (Q&A) joué de son deck, puis le deck est
// toujours mélangé (Q&A : même sans carte jouée)
const ODEN = 'Kouzuki Oden';
const odenKO: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const spec = { category: 'CHARACTER' as const, color: 'Green' as const, type: WANO, costMin: 3, costMax: 3 };
  const options = uniqueByNum(P.deck.filter((c) => cardMatches(c.num, spec) && playableByEffect(c.num) && canPlayCharacters(ctx.s, ctx.me, c.num)));
  if (options.length) {
    const answer = ctx.ask({
      prompt: `${ODEN} : jouer jusqu’à 1 Personnage {${WANO}} vert de coût 3 de ton deck :`,
      options: [...options.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucun' }],
      tag: 'playFree',
    });
    if (answer !== 'none') {
      const [chosen] = P.deck.splice(P.deck.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1);
      playCharacter(ctx, ctx.me, chosen);
    }
  }
  shuffleDeck(ctx.s, ctx.me);
  log(ctx.s, ctx.me, `mélange son deck (${ODEN})`);
});

// Mr.2 Bon Kurei : ce Personnage part sous le deck de son propriétaire une fois le combat fini : marqué sur la carte ; une
// carte qui a quitté le terrain pendant le combat est une autre carte (Q&A : rien), même si la cible a déjà été placée sous le deck (Q&A)
const MR2 = 'Mr.2 Bon Kurei';
const MR2_END = 'OP02-064:finDuCombat';
const mr2Attack: Effect = when(selfDon(1), mayPay(discardCost(1), seq(
  bottomOfDeck(anyChar({ costMax: 2 }), MR2),
  effect((ctx) => {
    const f = findField(ctx.s, ctx.source);
    if (f && ctx.s.battle?.attacker === ctx.source && !f.card.usedOpt.includes(MR2_END)) f.card.usedOpt.push(MR2_END);
  }, () => false),
), MR2));

// Uta : son Leader et tous ses Personnages du moment gagnent +1000 jusqu'au début de son prochain tour (Q&A : pas ceux joués ensuite)
const UTA = 'Uta';
const utaAll: Effect = effect((ctx) => {
  const until = untilOpponentsNextEnd(ctx.s, ctx.me);
  for (const c of fieldCards(ctx.s, ctx.me)) addMod(ctx.s, { uid: c.uid, stat: 'power', amount: 1000, until, source: UTA });
  log(ctx.s, ctx.me, `son Leader et tous ses Personnages gagnent +1000 de puissance jusqu’au début de son prochain tour (${UTA})`);
});

const isChar = (s: GameState, p: PlayerId, uid: number) => s.players[p].chars.some((c) => c.uid === uid);

export const OP02: Record<string, CardBehavior> = {
  // Monkey.D.Garp (Leader) : [Votre tour] chaque DON!! donnée à son Leader ou à un de ses Personnages (action ou effet, une annonce par
  // DON!! : Q&A, 2 DON!! données d'un coup = 2 fois) : jusqu'à 1 Personnage adverse de coût 7 ou moins (coût du moment : Q&A) −1 de coût
  'OP02-002': card({}, {
    when: [{
      on: 'donGiven',
      if: (s, owner, _self, e) => s.active === owner && e.player === owner,
      run: (ctx) => costMod(oppChar({ costMax: 7 }), -1, 'turn', 'Monkey.D.Garp').run(ctx),
    }],
  }),

  'OP02-005': card({ onPlay: dadanLook }),

  // Whitey Bay : [DON!! x1] peut aussi attaquer les Personnages adverses redressés
  'OP02-014': card({}, { attackActive: (_s, _p, self) => self.don >= 1 }),

  // Moby Dick (Lieu) : voir plus haut ; [Déclenchement] jouer cette carte
  'OP02-024': card({ onTrigger: playThis() }, { aura: mobyDickAura }),

  // Kin'emon (Leader) : [Activation : Principale] [Une fois par tour] ; activable sans la condition (rien ne se passe)
  'OP02-025': card({
    activateMain: {
      label: `${KINEMON} : le prochain Personnage {${WANO}} de coût 3 ou plus coûtera 1 de moins`,
      once: true,
      effect: when((s, p) => s.players[p].chars.length <= 1, kinemonDiscount),
    },
  }),

  // Sanji (Leader) : [Une fois par tour] quand il joue de sa main (en payant ou par un effet, pendant n'importe quel tour : Q&A) un
  // Personnage sans effet de base, s'il a 3 Personnages ou moins (celui-ci compris : Q&A), jusqu'à 2 DON!! redressées ; obligatoire (Q&A).
  // La limite n'est prise que si la condition est vraie (n° 1980)
  'OP02-026': card({}, {
    when: [{
      on: 'play',
      once: 'OP02-026:sanji',
      if: (s, owner, _self, e) => e.player === owner && e.zone === 'character' && e.from === 'hand' && e.num !== undefined && noBaseEffect(def(e.num))
        && s.players[owner].chars.length <= 3,
      run: (ctx) => readyDonUpTo(2, 'Sanji').run(ctx),
    }],
  }),

  // Inuarashi : ne peut pas quitter le terrain par un effet adverse (KO compris : Q&A) tant que toutes ses DON!! sont épuisées
  'OP02-027': card({}, { cantLeave: (s, p) => allDonRested(s, p) }),

  // Kouzuki Oden : [Activation : Principale] [Une fois par tour] ➂ : se redresse ; [En cas de KO] voir plus haut
  'OP02-030': card({
    activateMain: { label: `${ODEN} : ➂ : se redresser`, once: true, cost: restDon(3), effect: readySelf() },
    onKO: odenKO,
  }),

  // Emporio.Ivankov : [Jouée] piocher jusqu'à avoir 3 cartes, puis jusqu'à 1 Personnage {Impel Down} bleu de coût 6 ou moins joué de sa
  // main (même sans avoir pioché : Q&A)
  'OP02-051': card({ onPlay: seq(drawUpTo(3), playFromHandAtCost({ color: 'Blue', type: IMPEL, costMax: 6 }, 'Emporio.Ivankov')) }),

  // Mr.2 Bon Kurei : [DON!! x1] [En attaquant] voir plus haut
  'OP02-064': card({ whenAttacking: mr2Attack }, {
    when: [{
      on: 'battleEnd',
      if: (_s, _owner, self, e) => e.uid === self.uid && self.usedOpt.includes(MR2_END),
      run: (ctx) => {
        const f = findField(ctx.s, ctx.source);
        if (!f) return;
        f.card.usedOpt = f.card.usedOpt.filter((k) => k !== MR2_END);
        removeByEffect(ctx, ctx.source, 'deckBottom');
      },
    }],
  }),

  // Impel Down All Stars : [Principale] vous pouvez défausser 2 cartes : avec un Leader {Impel Down}, piocher jusqu'à 2 cartes (coût payable
  // sans ce Leader, rien ensuite : Q&A) ; [Déclenchement] piocher 2 cartes
  'OP02-066': card({ onMain: mayPay(discardCost(2), when(leaderType(IMPEL), drawChosen(2, 'Impel Down All Stars')), 'Impel Down All Stars'), onTrigger: drawCards(2) }),

  // DEATH WINK : [Contre] +6000 à la carte attaquée, puis piocher jusqu'à avoir 2 cartes (cette carte n'est plus en main : Q&A) ;
  // [Déclenchement] jusqu'à 1 Personnage de coût 7 ou moins, des deux camps (Q&A), renvoyé en main
  'OP02-069': card({ onCounter: seq(defenderPower(6000, 'DEATH WINK'), drawUpTo(2)), onTrigger: bounce(anyChar({ costMax: 7 }), 'DEATH WINK') }),

  // Magellan (Leader) : [Votre tour] [Une fois par tour] quand une DON!! du terrain, la sienne ou une adverse (Q&A), retourne au deck DON!!
  // de son propriétaire, ce Leader +1000 pour le tour (une seule fois même pour 2 DON!! d'un coup : Q&A)
  'OP02-071': card({}, {
    when: [{
      on: 'donReturned',
      once: 'OP02-071:magellan',
      if: (s, owner) => s.active === owner,
      run: (ctx) => leaderPower(1000, 'turn', 'Magellan').run(ctx),
    }],
  }),

  // Magellan : [Jouée] DON!! −1 : l'adversaire renvoie 1 DON!! (il choisit : Q&A) ; [Tour adverse] quand ce Personnage est mis KO,
  // l'adversaire en renvoie 2
  'OP02-085': card({ onPlay: mayPay(donMinus(1), oppReturnsDon(1, 'Magellan'), 'Magellan'), onKO: oppReturnsDon(2, 'Magellan') }, {
    onKOCondition: (s, owner) => s.active !== owner,
  }),

  // Juge des Enfers : [Contre] DON!! −1 : jusqu'à un total de 2 Leader ou Personnages adverses, différents (Q&A), −3000 pour le tour ;
  // [Déclenchement] voir plus haut
  'OP02-089': card({
    onCounter: mayPay(donMinus(1), powerMod(oppLeaderOrChar(), -3000, 'turn', 'Juge des Enfers', 2), 'Juge des Enfers'),
    onTrigger: impelTrigger('Juge des Enfers'),
  }),
  // Hydra : [Principale] DON!! −1 : jusqu'à 1 Personnage adverse −3000 pour le tour ; [Déclenchement] voir plus haut
  'OP02-090': card({ onMain: mayPay(donMinus(1), powerMod(oppChar(), -3000, 'turn', 'Hydra'), 'Hydra'), onTrigger: impelTrigger('Hydra') }),
  // Venom Road : [Principale] jusqu'à 1 DON!! redressée du deck DON!! ; [Déclenchement] voir plus haut
  'OP02-091': card({ onMain: addDonUpTo(1, 'active', 'Venom Road'), onTrigger: impelTrigger('Venom Road') }),

  // Isuka : [DON!! x1] [Une fois par tour] quand elle met KO en combat un Personnage adverse (elle attaque), elle se redresse
  'OP02-094': card({}, {
    when: [{
      on: 'ko',
      once: 'OP02-094:isuka',
      if: (s, owner, self, e) => e.cause === 'battle' && e.zone === 'character' && e.player === other(owner) && s.battle?.attacker === self.uid && self.don >= 1,
      run: (ctx) => { setActive(ctx.s, ctx.me, ctx.source); },
    }],
  }),

  // Saldeath : tous ses Personnages [Blugori] gagnent [Bloqueur] (règle 2-1-2 : le nom entre crochets désigne les cartes de ce nom ; Q&A
  // de Moby Dick OP02-024 : « votre [Edward.Newgate] » vaut pour le Leader et le Personnage de ce nom ensemble)
  'OP02-074': card({}, {
    keywordAura: (s, p, _src, tg, k) => k === 'Blocker' && isChar(s, p, tg.uid) && def(tg.num).names.includes('Blugori'),
  }),

  // Hina : [Bloqueur] (imprimé) ; [En bloquant] jusqu'à 1 Personnage adverse de coût 6 ou moins ne peut pas attaquer ce tour-ci (même
  // avec [Initiative] ou redressé ensuite ; l'attaque en cours continue : Q&A)
  'OP02-110': card({}, {
    when: [{
      on: 'block',
      if: (_s, _owner, self, e) => e.uid === self.uid,
      run: (ctx) => grant(oppChar({ costMax: 6 }), { stat: 'cantAttack' }, 'turn', 'Hina', 'ne peut pas attaquer').run(ctx),
    }],
  }),

  // Joyau sacré de Yasakani : [Contre] vous pouvez défausser 1 carte : jusqu'à 1 de ses Personnages ne peut pas être mis KO pendant ce
  // combat ; [Déclenchement] jusqu'à 1 Lieu adverse de coût 3 ou moins mis KO
  'OP02-118': card({
    onCounter: mayPay(discardCost(1), grant(ownChar(), { stat: 'cantBeKO' }, 'battle', 'Joyau sacré de Yasakani', 'ne peut pas être mis KO pendant ce combat'), 'Joyau sacré de Yasakani'),
    onTrigger: koOppStage(3, 'Joyau sacré de Yasakani'),
  }),

  // Uta : [Jouée] DON!! −2 : voir plus haut
  'OP02-120': card({ onPlay: mayPay(donMinus(2), utaAll, UTA) }),
};
