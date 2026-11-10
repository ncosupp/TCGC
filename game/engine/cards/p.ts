// PROMOS (préfixe P, étape C, tâche S20) : les promos que le traducteur ne comprend pas, ou que le compilateur refuse,
// codées à la main d'après leur texte officiel (VO, et VF quand le catalogue en a une : jamais recopié) et les Q&A
// officielles des promos. Les promos déjà codées avant l'étape C restent dans leur fichier (fam-*, st3*) ; le reste est en
// recettes (recipes/sets/p.ts). Choix d'interprétation : game/docs/interpretations.md, section « Promos (tâche S20) »,
// 3900 à 3999. Aucun texte de carte ici.
import {
  addDelayed, addMod, bottomOrder, canLeaveByEffect, def, describe, discardFromHand, fieldCost, findField, hasBlocker, log, may, other,
  removeByEffect, setActive, shuffleDeck,
} from '../rules.ts';
import type { CardBehavior, EffectCtx, GameState, PlayerId } from '../types.ts';
import {
  afterDamage, all, any, bottomOfDeck, card, discardCost, drawCards, effect, grant, ko, koImmuneInBattle, leaderNamed, leaderPower, leaderType,
  leaderTypeIncludes, lifeToHandCost, mayPay, mayTrashTop, myTurn, oppChar, ownChar, ownLeader, ownLeaderOrChar, powerMod, restSelf, selfDon,
  selfPowerMod, seq, when, type Effect,
} from './bricks.ts';
import { playFromHandAtCost } from './bricks-play.ts';

const FILM = 'FILM';
const NEPTUNIAN = 'Neptunian';

// « Combien ? » de 0 à max, 0 en premier : l'IA garde la première réponse (elle ne défausse ni ne renvoie rien pour ces deux
// cartes, faute de savoir quand cela vaut la peine)
function askCount(ctx: EffectCtx, max: number, prompt: string, unit: string): number {
  if (max <= 0) return 0;
  const answer = ctx.ask({
    prompt,
    options: Array.from({ length: max + 1 }, (_, i) => ({ id: `n:${i}`, label: i ? `${i} ${unit}${i > 1 ? 's' : ''}` : 'Aucun' })),
    tag: 'mayCount',
  });
  return Number(answer.split(':')[1]);
}

// I Smell Adventure!!! (P-002) : [Principale] et [Déclenchement] toute sa main dans son deck, mélange, puis pioche autant de
// cartes (aucune si la main était vide : Q&A)
const SMELL = 'I Smell Adventure!!!';
const handToDeckDraw: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const n = P.hand.length;
  P.deck.push(...P.hand.splice(0));
  shuffleDeck(ctx.s, ctx.me);
  log(ctx.s, ctx.me, `remet ${n} carte${n > 1 ? 's' : ''} de sa main dans son deck et le mélange (${SMELL})`);
  if (n) drawCards(n).run(ctx);
}, (s, p) => s.players[p].hand.length > 0);

// I'm Gonna Be King of the Pirates!! (P-024) : [Principale] son Leader +1000 pour le tour par Personnage de son terrain (comptés
// à la résolution)
const KING = "I'm Gonna Be King of the Pirates!!";
const leaderPerChar: Effect = effect((ctx) => {
  const n = ctx.s.players[ctx.me].chars.length;
  if (n) leaderPower(1000 * n, 'turn', KING).run(ctx);
}, (s, p) => s.players[p].chars.length > 0);

// Yamato (P-046) : [Jouée] il peut placer toute sa main au-dessous de son deck (dans l'ordre de son choix), et s'il le fait,
// piocher autant de cartes ; main vide : rien à placer, rien à piocher
const YAMATO = 'Yamato';
const handToBottomDraw: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const n = P.hand.length;
  if (!n || !may(ctx, `${YAMATO} : placer les ${n} carte${n > 1 ? 's' : ''} de ta main au-dessous de ton deck, puis piocher autant de cartes ?`, 'may')) return;
  P.deck.push(...bottomOrder(ctx, P.hand.splice(0)));
  log(ctx.s, ctx.me, `place ${n} carte${n > 1 ? 's' : ''} de sa main au-dessous de son deck (${YAMATO})`);
  drawCards(n).run(ctx);
}, (s, p) => s.players[p].hand.length > 0);

// Shanks (P-051) : [En attaquant] défausser autant de cartes de sa main qu'il le veut : +1000 pour le combat par carte défaussée
const SHANKS_051 = 'Shanks';
const trashForPower: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const n = askCount(ctx, P.hand.length, `${SHANKS_051} : combien de cartes de ta main défausser (+1000 de puissance pour le combat chacune) ?`, 'carte');
  if (!n) return;
  const k = discardFromHand(ctx, ctx.me, n, `${SHANKS_051} : carte à défausser`);
  if (k) selfPowerMod(1000 * k, 'battle', SHANKS_051).run(ctx);
}, (s, p) => s.players[p].hand.length > 0);

// Monkey D. Luffy (P-055) : [Jouée] coût « défausser 2 cartes » : l'adversaire choisit 1 de ses Personnages et le place
// au-dessous du deck de son propriétaire (Q&A : il choisit ; sans Personnage adverse, le coût peut être payé, rien ne suit)
const LUFFY_055 = 'Monkey D. Luffy';
const oppBottomsOwnChar: Effect = (() => {
  const list = (s: GameState, p: PlayerId) => s.players[other(p)].chars.filter((c) => canLeaveByEffect(s, c.uid, p)).map((c) => c.uid);
  return effect((ctx) => {
    const options = list(ctx.s, ctx.me);
    if (!options.length) return;
    const uid = options.length === 1 ? options[0] : Number(ctx.ask({
      player: ctx.opp,
      prompt: `${LUFFY_055} : lequel de tes Personnages placer au-dessous de ton deck ?`,
      options: options.map((u) => ({ id: `card:${u}`, label: describe(ctx.s, u), uid: u })),
      tag: 'trashOwn',
    }).split(':')[1]);
    removeByEffect(ctx, uid, 'deckBottom');
  }, (s, p) => list(s, p).length > 0);
})();

// Où souffle le vent (P-058) : [Principale] avec un Leader [Uta], ses Personnages {FILM} sont redressés à la fin du tour, ceux
// joués et épuisés pendant le tour compris (Q&A) ; [Déclenchement] ses Personnages {FILM} redressés aussitôt
const WIND = 'Où souffle le vent';
const readyFilmAtEnd: Effect = effect((ctx) => {
  addDelayed(ctx.s, { turn: ctx.s.turn, player: ctx.me, action: 'readyTypeChars', amount: 0, type: FILM, source: WIND });
  log(ctx.s, ctx.me, `ses Personnages {${FILM}} seront redressés à la fin du tour (${WIND})`);
});
const readyFilmNow: Effect = effect((ctx) => {
  for (const c of ctx.s.players[ctx.me].chars) if (c.rested && def(c.num).types.includes(FILM)) setActive(ctx.s, ctx.me, c.uid);
}, (s, p) => s.players[p].chars.some((c) => c.rested && def(c.num).types.includes(FILM)));

// Le monde continue (P-059) : [Contre] avec un Leader [Uta], renvoyer en main autant de ses Personnages qu'il le veut, puis
// jusqu'à 1 de ses Leader ou Personnages +2000 pour le combat par Personnage renvoyé
const WORLD = 'Le monde continue';
const returnForPower: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const n = askCount(ctx, P.chars.length, `${WORLD} : combien de tes Personnages renvoyer dans ta main (+2000 de puissance pour le combat chacun) ?`, 'Personnage');
  let k = 0;
  for (let i = 0; i < n; i++) {
    const left = P.chars.filter((c) => canLeaveByEffect(ctx.s, c.uid, ctx.me)).map((c) => c.uid);
    if (!left.length) break;
    const uid = Number(ctx.ask({
      prompt: `${WORLD} : Personnage à renvoyer dans ta main (${i + 1}/${n}) :`,
      options: left.map((u) => ({ id: `card:${u}`, label: describe(ctx.s, u), uid: u })),
      tag: 'returnOwn',
    }).split(':')[1]);
    if (removeByEffect(ctx, uid, 'hand')) k++;
  }
  if (k) powerMod(ownLeaderOrChar(), 2000 * k, 'battle', WORLD).run(ctx);
}, (s, p) => s.players[p].chars.length > 0);

// Shanks (P-097) : [Jouée] / [En attaquant] l'adversaire ne peut pas activer [Bloqueur] pour le tour, cartes jouées ensuite
// comprises (PlayerState.noBlockerTurn)
const SHANKS_097 = 'Shanks';
const noBlockerThisTurn: Effect = effect((ctx) => {
  ctx.s.players[ctx.opp].noBlockerTurn = ctx.s.turn;
  log(ctx.s, ctx.me, `l'adversaire ne peut pas activer [Bloqueur] pour le tour (${SHANKS_097})`);
});

// Marshall.D.Teach (P-100) : [En attaquant] le Leader adverse et tous ses Personnages (ceux du moment) ont leurs effets annulés
// pour le tour
const TEACH = 'Marshall.D.Teach';
const negateOppField: Effect = effect((ctx) => {
  const O = ctx.s.players[ctx.opp];
  for (const c of [O.leader, ...O.chars]) addMod(ctx.s, { uid: c.uid, stat: 'negated', amount: 0, until: 'turn', source: TEACH });
  log(ctx.s, ctx.me, `le Leader adverse et ses Personnages ont leurs effets annulés pour le tour (${TEACH})`);
});

// Edward.Newgate (P-152) : [Jouée] son Leader et tous ses Personnages (ceux du moment) +2000 pour le tour, puis KO de 3000 de
// puissance ou moins
const NEWGATE = 'Edward.Newgate';
const allPlus2000: Effect = effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  for (const c of [P.leader, ...P.chars]) addMod(ctx.s, { uid: c.uid, stat: 'power', amount: 2000, until: 'turn', source: NEWGATE });
  log(ctx.s, ctx.me, `son Leader et ses Personnages gagnent +2000 de puissance pour le tour (${NEWGATE})`);
});

// Shirahoshi (P-091) : un {Neptunian} joué ce tour-ci, redressé, qui ne peut pas encore attaquer de Personnage
const SHIRAHOSHI = 'Shirahoshi';
const freshNeptunian = (s: GameState, p: PlayerId) => s.players[p].chars.some((c) => c.playedTurn === s.turn && !c.rested && def(c.num).types.includes(NEPTUNIAN));

export const PROMOS: Record<string, CardBehavior> = {
  'P-002': card({ onMain: handToDeckDraw, onTrigger: handToDeckDraw }),

  // Monkey.D.Luffy (P-007) : [DON!! x1] pas mis KO en combat par un Leader ou un Personnage <Frappe> (Q&A : les autres attributs
  // le peuvent)
  'P-007': { cantBeKO: koImmuneInBattle({ attribute: 'Strike' }, selfDon(1)) },

  // [Déclenchement] jusqu'à 1 de ses Leader ou Personnages +1000 pour le tour
  'P-024': card({ onMain: leaderPerChar, onTrigger: powerMod(ownLeaderOrChar(), 1000, 'turn', KING) }),

  // Smoker (P-025) : [DON!! x1] pas mis KO en combat par un Personnage sans l'attribut <Spécial> (un Leader le peut)
  'P-025': { cantBeKO: koImmuneInBattle({ without: 'Special', characters: true }, selfDon(1)) },

  // General Franky (P-027) : [Tour adverse] ses Personnages de 3000 de puissance de base ou moins +1000 (puissance imprimée, Q&A ;
  // deux exemplaires : +2000, Q&A). Le nom [Franky] vient du catalogue
  'P-027': {
    aura: (s, owner, _src, target) => (s.active !== owner && target.uid !== s.players[owner].leader.uid && (def(target.num).power ?? 0) <= 3000 ? 1000 : 0),
  },

  // Monkey.D.Luffy (P-036) : [En attaquant] coût « 1 carte du dessus ou du dessous de sa Vie en main » : lui +1000 pour le tour
  // (obligatoire une fois le coût payé, Q&A) et jusqu'à 1 de son Leader +1000 (les deux à la fois, Q&A)
  'P-036': card({
    whenAttacking: mayPay(lifeToHandCost('both'), seq(selfPowerMod(1000, 'turn', 'Monkey.D.Luffy'), powerMod(ownLeader(), 1000, 'turn', 'Monkey.D.Luffy')), 'Monkey.D.Luffy'),
  }),

  'P-046': card({ onPlay: handToBottomDraw }),

  'P-051': card({ whenAttacking: trashForPower }),

  'P-055': card({ onPlay: mayPay(discardCost(2), oppBottomsOwnChar, LUFFY_055) }),

  'P-058': card({ onMain: when(leaderNamed('Uta'), readyFilmAtEnd), onTrigger: readyFilmNow }),

  // l'IA ne le joue pas (elle répondrait « Aucun »)
  'P-059': card({ onCounter: when(leaderNamed('Uta'), returnForPower) }, { counterUseful: () => false }),

  // Crocodile (P-082) : [Votre tour] [Jouée] avec un Leader {Cross Guild} ou dont un type contient « Baroque Works », jusqu'à 1
  // Personnage adverse de 2000 de puissance ou moins au-dessous du deck de son propriétaire
  'P-082': card({
    onPlay: when(all(myTurn, any(leaderType('Cross Guild'), leaderTypeIncludes('Baroque Works'))), bottomOfDeck(oppChar({ powerMax: 2000 }), 'Crocodile')),
  }),

  // Baggy (P-084) : ne peut pas attaquer ; avec un Leader [Buggy], aucun Personnage de coût 3 ou 4 (coût actuel, des deux joueurs,
  // le texte ne dit pas « adverse ») ne peut attaquer ; [Jouée] jouer de sa main un {Cross Guild} de coût 6 ou moins
  'P-084': card({ onPlay: playFromHandAtCost({ type: 'Cross Guild', costMax: 6 }, 'Baggy') }, {
    cantAttack: () => true,
    cantAttackAura: (s, owner, src, target) => leaderNamed('Buggy')(s, owner, src.uid) && [3, 4].includes(fieldCost(s, target.uid)),
  }),

  // Shirahoshi (P-091) : [Jouée] jouer de sa main un {Neptunian} ou {Fish-Man Island} de coût 5 ou moins ; [Activation : Principale]
  // s'épuiser : jusqu'à 1 de ses {Neptunian} peut attaquer les Personnages le tour où il est joué (pour le tour)
  'P-091': card({
    onPlay: playFromHandAtCost({ anyOf: [{ type: NEPTUNIAN }, { type: 'Fish-Man Island' }], costMax: 5 }, SHIRAHOSHI),
    activateMain: {
      label: `${SHIRAHOSHI} : t'épuiser pour qu'un de tes Personnages {${NEPTUNIAN}} puisse attaquer les Personnages le tour où il est joué`,
      cost: restSelf(),
      effect: {
        ...grant(ownChar({ type: NEPTUNIAN }), { stat: 'keyword', keyword: 'Rush: Character' }, 'turn', SHIRAHOSHI, 'peut attaquer les Personnages le tour où il est joué'),
        useful: (s, p) => freshNeptunian(s, p),
      },
    },
  }),

  'P-097': card({ onPlay: noBlockerThisTurn, whenAttacking: noBlockerThisTurn }, {
    attackUseful: (s, p) => s.players[other(p)].chars.some((c) => !c.rested && hasBlocker(s, other(p), c)),
  }),

  'P-100': card({ whenAttacking: negateOppField }),

  // Nami (P-117, Leader) : deck de cartes {East Blue} seulement ; deck vide : victoire au lieu de la défaite ; [DON!! x1] quand
  // l'attaque de ce Leader inflige des dégâts à la Vie adverse, il peut placer la carte du dessus de son deck dans sa Défausse
  // (comme Nami OP03-040)
  'P-117': {
    rules: { deckOut: 'win', deckRestriction: (d) => (d.types.includes('East Blue') ? null : 'Nami : seulement des cartes {East Blue}') },
    when: [afterDamage('self', mayTrashTop(1, 'Nami'), selfDon(1))],
  },

  'P-152': card({ onPlay: seq(allPlus2000, ko(oppChar({ powerMax: 3000 }), NEWGATE)) }),
};
