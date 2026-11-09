// OP06 (étape C, tâche S14) : les cartes que le traducteur ne comprend pas, ou que sa recette lirait mal d'après une Q&A
// officielle, codées à la main d'après le texte officiel (VO et VF, jamais recopié). Le reste du set est en recettes
// (recipes/sets/op06.ts). Choix d'interprétation : game/docs/interpretations.md, section « OP06, ST12 et ST11 (tâche S14) ».
import {
  addDelayed, addMod, basePower, bottomOrder, canBeKO, canPlayCharacters, canTakeLife, chooseUpTo1, def, describe, discardFromHand, donOnField,
  draw, emit, findField, knownFirst, lifeToHand, log, may, other, playCharacter, power, pruneKnown, removeByEffect, removeFromField, reveal, shuffleDeck,
  uniqueByNum, untilOpponentsNextEnd,
} from '../rules.ts';
import type { Card, CardBehavior, EffectCtx, FieldCard, GameEvent, GameState, PlayerId } from '../types.ts';
import {
  bothCosts, card, chooseOne, discardCost, donMinus, drawCards, effect, ko, leaderPower, leaderType, lifeAtMost, lifeFromDeck, lifeIntoHand, matches, oppChar, oppLifeAtMost, ownChar, playFromTrash,
  playThis, powerMod, rest, restCost, restSelf, searchTop, selfDon, selfKeyword, selfPowerMod, seq, setActiveTargets, toOwnersLife, trashFromOppHand, trashOwnCharCost, mayTrashTop,
  when, withCost, type Cost, type Effect,
  mayPay,
} from './bricks.ts';
import { mayLifeFromDeck } from './bricks-life.ts';
import { restOppDon } from './bricks-don.ts';
import { oncePerTurn } from './bricks-power.ts';
import { removeChars } from './bricks-removal.ts';

const FILM = 'FILM';
const GERMA = 'GERMA 66';
const THRILLER = 'Thriller Bark Pirates';

// Condition : pas plus de DON!! sur le terrain que l'adversaire
const noMoreDonThanOpp = (s: GameState, p: PlayerId) => donOnField(s, p) <= donOnField(s, other(p));
const name = (num: string) => def(num).name;


// « Vous pouvez placer 1 Lieu de coût 1 au-dessous du deck de son propriétaire » : le sien ou celui de l'adversaire (Q&A
// d'OP06-102, OP06-111, OP06-114 ; la recette ne lirait que le sien)
const stagesOfCost1 = (s: GameState, p: PlayerId) => [s.players[p].stage, s.players[other(p)].stage].filter((c): c is FieldCard => Boolean(c && def(c.num).cost === 1));
const anyStageToBottom: Cost = {
  label: 'placer 1 Lieu de coût 1 (le tien ou celui de ton adversaire) au-dessous du deck de son propriétaire',
  can: (s, p) => stagesOfCost1(s, p).length > 0,
  pay: (ctx) => {
    const options = stagesOfCost1(ctx.s, ctx.me);
    if (!options.length) return false;
    const uid = options.length === 1 ? options[0].uid : Number(ctx.ask({
      prompt: 'Lieu de coût 1 à placer au-dessous du deck de son propriétaire :',
      options: options.map((c) => ({ id: `card:${c.uid}`, label: `${describe(ctx.s, c.uid)}${ctx.s.players[ctx.me].stage?.uid === c.uid ? '' : ' adverse'}`, uid: c.uid })),
      tag: 'trashOwn',
    }).split(':')[1]);
    const f = removeFromField(ctx.s, uid, 'deckBottom');
    if (!f) return false;
    log(ctx.s, f.player, `${name(f.card.num)} est placé au-dessous du deck de son propriétaire`);
    return true;
  },
};

// [Déclenchement] : se joue si la Vie adverse est à 3 cartes ou moins, ou (autre carte) si la sienne est à 2 ou moins
const playIfOppLife = when(oppLifeAtMost(3), playThis());
const playIfLife = when(lifeAtMost(2), playThis());

// ---------- Saga (OP06-006) ----------

// +1000 jusqu'au début de son prochain tour. Puis, à la fin du tour, 1 de ses Personnages {FILM} va dans la Défausse, même
// si Saga a quitté le terrain (Q&A) : le choix se fait à ce moment-là (effet différé 'trashTypeChar')
const sagaEffect = seq(selfPowerMod(1000, 'oppNextEnd', 'Saga'), effect((ctx) => {
  addDelayed(ctx.s, { turn: ctx.s.turn, player: ctx.me, action: 'trashTypeChar', amount: 1, type: FILM, source: 'Saga' });
}, () => false));

// ---------- Shuraiya (OP06-009) ----------

// Sa puissance de base devient la puissance du moment du Leader adverse (DON!! comprises), relevée à l'activation : ce qui
// change ensuite ne compte pas (Q&A). Une nouvelle activation remplace l'ancienne valeur (basePower prend le maximum).
const SHURAIYA = 'Shuraiya';
const shuraiyaBase = (ctx: EffectCtx) => {
  const amount = power(ctx.s, ctx.s.players[ctx.opp].leader.uid);
  ctx.s.mods = ctx.s.mods.filter((m) => !(m.uid === ctx.source && m.stat === 'basePower' && m.source === SHURAIYA));
  addMod(ctx.s, { uid: ctx.source, stat: 'basePower', amount, until: untilOpponentsNextEnd(ctx.s, ctx.me), source: SHURAIYA });
  log(ctx.s, ctx.me, `la puissance de base de Shuraiya devient ${amount} jusqu'au début de son prochain tour`);
};

// ---------- Ratchet (OP06-014) ----------

// Défausser autant de cartes {FILM} qu'il veut (une question par carte), puis son Leader ou 1 Personnage (un seul : Q&A)
// gagne +1000 pour le combat par carte défaussée
const ratchetBattle: Effect = {
  run: (ctx) => {
    const P = ctx.s.players[ctx.me];
    const isFilm = (c: Card) => def(c.num).types.includes(FILM);
    let n = 0;
    while (P.hand.some(isFilm)) {
      if (!may(ctx, `Ratchet : défausser une carte {FILM} de ta main (+1000 pour le combat)${n ? ` (déjà ${n})` : ''} ?`)) break;
      if (!discardFromHand(ctx, ctx.me, 1, 'Ratchet : carte {FILM} à défausser :', isFilm)) break;
      n++;
    }
    if (!n) return;
    const options = [P.leader, ...P.chars];
    const uid = options.length === 1 ? P.leader.uid : Number(ctx.ask({
      prompt: `Ratchet : carte qui gagne +${1000 * n} de puissance pour le combat :`,
      options: options.map((c) => ({ id: `card:${c.uid}`, label: describe(ctx.s, c.uid), uid: c.uid })),
      tag: 'ownPower',
    }).split(':')[1]);
    addMod(ctx.s, { uid, stat: 'power', amount: 1000 * n, until: 'battle', source: 'Ratchet' });
    log(ctx.s, ctx.me, `${name(findField(ctx.s, uid)!.card.num)} gagne +${1000 * n} de puissance pour le combat (Ratchet)`);
  },
  useful: (s, p) => s.players[p].hand.some((c) => def(c.num).types.includes(FILM)),
};

// ---------- Lily Carnation (OP06-015) ----------

const lilyTarget = { type: FILM, powerMin: 2000, powerMax: 5000 };
const lilyPlay = playFromTrash(lilyTarget, 'Lily Carnation', { rested: true });

// ---------- Dosun (OP06-030) ----------

// Protection contre le KO en combat et +2000 : la seule durée écrite (jusqu'au début de son prochain tour) vaut pour les deux
// (sans elle, la protection n'aurait pas de fin : n° 3301). Puis 1 Vie en main, sous la même condition (n° 1983).
const dosunEffect: Effect = when(leaderType('New Fish-Man Pirates'), seq(effect((ctx) => {
  addMod(ctx.s, { uid: ctx.source, stat: 'cantBeKO', scope: 'battle', amount: 0, until: untilOpponentsNextEnd(ctx.s, ctx.me), source: 'Dosun' });
  log(ctx.s, ctx.me, 'Dosun ne peut pas être mis KO en combat jusqu’au début de son prochain tour');
}), selfPowerMod(2000, 'oppNextEnd', 'Dosun'), lifeIntoHand('top')));

// ---------- Koushirou (OP06-026) ----------

// « Puis, vous ne pouvez pas attaquer de Leader pour tout le tour » : toutes ses cartes (Q&A), que la première partie ait
// servi ou non
const noLeaderAttack = (source: string): Effect => effect((ctx) => {
  ctx.s.players[ctx.me].noLeaderAttackTurn = ctx.s.turn;
  log(ctx.s, ctx.me, `ne peut plus attaquer de Leader ce tour-ci (${source})`);
}, () => false);

// ---------- Charlotte Pudding (OP06-047) ----------

const puddingEffect: Effect = effect((ctx) => {
  const { s } = ctx;
  const O = s.players[ctx.opp];
  const k = O.hand.length;
  O.deck.push(...O.hand.splice(0));
  shuffleDeck(s, ctx.opp);
  pruneKnown(s);
  log(s, ctx.opp, `renvoie les ${k} cartes de sa main dans son deck et le mélange (Charlotte Pudding)`);
  const before = O.hand.length;
  draw(s, ctx.opp, 5);
  log(s, ctx.opp, `pioche ${O.hand.length - before} carte(s) (Charlotte Pudding)`);
});

// ---------- Zeff (OP06-048) ----------

// [Votre tour] quand l'adversaire active [Bloqueur] ou un Événement (pas son [Déclenchement] : Q&A), Leader {East Blue}
const zeffIf = (s: GameState, owner: PlayerId, _self: FieldCard, e: GameEvent) => s.active === owner && e.player === other(owner) && leaderType('East Blue')(s, owner, -1);
const zeffRun = (ctx: EffectCtx) => mayTrashTop(4, 'Zeff').run(ctx);

// ---------- Vinsmoke Judge (OP06-062) ----------

const judgeFits = (num: string) => def(num).category === 'CHARACTER' && def(num).types.includes(GERMA) && (def(num).power ?? 0) <= 4000;
// Jusqu'à 4 cartes de noms différents, prises parmi celles de la Défausse au moment de l'effet (un Personnage défaussé parce
// que la zone est pleine n'en fait pas partie)
const judgePlay: Effect = {
  run: (ctx) => {
    const P = ctx.s.players[ctx.me];
    const pool = new Set(P.trash.map((c) => c.uid));
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      const options = uniqueByNum(P.trash.filter((c) => pool.has(c.uid) && judgeFits(c.num) && !def(c.num).names.some((n) => names.includes(n)) && canPlayCharacters(ctx.s, ctx.me, c.num)));
      if (!options.length) return;
      const answer = ctx.ask({
        prompt: `Vinsmoke Judge : Personnage {GERMA 66} de ta Défausse à jouer (${i + 1}/4) :`,
        options: [...options.map((c) => ({ id: `card:${c.uid}`, label: `${name(c.num)} (coût ${def(c.num).cost})`, uid: c.uid, num: c.num })), { id: 'none', label: i ? 'Aucun autre' : 'Aucun' }],
        tag: 'playFree',
      });
      if (answer === 'none') return;
      const [c] = P.trash.splice(P.trash.findIndex((x) => x.uid === Number(answer.split(':')[1])), 1);
      names.push(...def(c.num).names);
      playCharacter(ctx, ctx.me, c, { from: 'trash' });
    }
  },
  useful: (s, p) => canPlayCharacters(s, p) && s.players[p].trash.some((c) => judgeFits(c.num)),
};
// le coût peut lui-même mettre une carte qui convient dans la Défausse
const judgeOnPlay: Effect = when(
  (s, p, self) => judgePlay.useful(s, p, self) || (canPlayCharacters(s, p) && s.players[p].hand.some((c) => judgeFits(c.num))),
  withCost(bothCosts(donMinus(1), discardCost(2)), judgePlay, 'Vinsmoke Judge'),
);

// ---------- Zephyr (OP06-074) ----------

// Annuler les effets de jusqu'à 1 Personnage adverse pour le tour ; puis, s'il a 5000 de puissance ou moins, KO. Puissance lue
// après l'annulation ; une protection contre le KO reste valable ; son [En cas de KO] ne s'active pas, puisqu'il est annulé (Q&A)
const zephyrEffect: Effect = effect((ctx) => {
  const list = ctx.s.players[ctx.opp].chars.map((c) => c.uid);
  const uid = chooseUpTo1(ctx, list, 'Zephyr : Personnage adverse dont annuler les effets :', 'oppKo');
  if (uid === null) return;
  addMod(ctx.s, { uid, stat: 'negated', amount: 0, until: 'turn', source: 'Zephyr' });
  log(ctx.s, ctx.me, `annule les effets de ${name(findField(ctx.s, uid)!.card.num)} pour le tour (Zephyr)`);
  if (power(ctx.s, uid) <= 5000) removeByEffect(ctx, uid, 'ko');
}, (s, p) => s.players[other(p)].chars.length > 0);

// ---------- Gecko Moria (OP06-086) ----------

// Choisir dans la Défausse jusqu'à 1 Personnage de coût 4 ou moins et jusqu'à 1 de coût 2 ou moins ; l'un est joué redressé,
// l'autre épuisé (un seul : redressé, Q&A). Si les deux ont un effet [Jouée], le joueur choisit l'ordre (Q&A) : leur effet
// se résout dans l'ordre où ils sont joués. Zone pleine : le premier joué peut être défaussé pour le second, et son [Jouée]
// ne s'active pas (Q&A, et engine.ts : un effet dont la carte a quitté le terrain ne se résout pas).
const moriaFits = (num: string, costMax: number) => def(num).category === 'CHARACTER' && (def(num).cost ?? 0) <= costMax;
const moriaEffect: Effect = {
  run: (ctx) => {
    const { s } = ctx;
    const P = s.players[ctx.me];
    if (!canPlayCharacters(s, ctx.me)) return;
    const choose = (costMax: number, without?: number): Card | null => {
      const options = uniqueByNum(P.trash.filter((c) => c.uid !== without && moriaFits(c.num, costMax) && canPlayCharacters(s, ctx.me, c.num)));
      if (!options.length) return null;
      const answer = ctx.ask({
        prompt: `Gecko Moria : Personnage de coût ${costMax} ou moins de ta Défausse à choisir :`,
        options: [...options.map((c) => ({ id: `card:${c.uid}`, label: `${name(c.num)} (coût ${def(c.num).cost})`, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucun' }],
        tag: 'playFree',
      });
      return answer === 'none' ? null : options.find((c) => c.uid === Number(answer.split(':')[1]))!;
    };
    const first = choose(4);
    const second = choose(2, first?.uid);
    const cards = [first, second].filter((c): c is Card => Boolean(c));
    if (!cards.length) return;
    const option = (c: Card) => ({ id: `card:${c.uid}`, label: name(c.num), uid: c.uid, num: c.num });
    const take = (c: Card) => P.trash.splice(P.trash.findIndex((x) => x.uid === c.uid), 1)[0];
    if (cards.length === 1) {
      playCharacter(ctx, ctx.me, take(cards[0]), { from: 'trash' });
      return;
    }
    const activeUid = Number(ctx.ask({ prompt: 'Gecko Moria : carte à jouer redressée (l’autre sera épuisée) :', options: cards.map(option), tag: 'pick' }).split(':')[1]);
    let order = cards;
    if (def(cards[0].num).onPlay && def(cards[1].num).onPlay && cards[0].num !== cards[1].num) {
      const firstUid = Number(ctx.ask({ prompt: 'Gecko Moria : carte à jouer en premier (son effet [Jouée] se résoudra d’abord) :', options: cards.map(option), tag: 'pick' }).split(':')[1]);
      order = cards[0].uid === firstUid ? cards : [cards[1], cards[0]];
    }
    for (const c of order) playCharacter(ctx, ctx.me, take(c), { from: 'trash', rested: c.uid !== activeUid });
  },
  useful: (s, p) => canPlayCharacters(s, p) && s.players[p].trash.some((c) => moriaFits(c.num, 4)),
};

// ---------- Brook (OP06-092) ----------

// L'adversaire glisse 3 cartes de sa Défausse sous son deck, ordre à son choix : toutes s'il en a
// moins (Q&A) ; c'est lui qui choisit
const brookOppTrash: Effect = effect((ctx) => {
  const O = ctx.s.players[ctx.opp];
  const asOpp: EffectCtx = { ...ctx, me: ctx.opp, opp: ctx.me, ask: (spec) => ctx.ask({ player: ctx.opp, ...spec }) };
  const placed: Card[] = [];
  for (let i = 0; i < 3 && O.trash.length; i++) {
    const options = uniqueByNum(O.trash);
    const answer = O.trash.length <= 3 - i ? `card:${O.trash[0].uid}` : ctx.ask({
      player: ctx.opp,
      prompt: `Brook : carte de ta Défausse à placer au-dessous de ton deck (${i + 1}/3) :`,
      options: options.map((c) => ({ id: `card:${c.uid}`, label: name(c.num), uid: c.uid, num: c.num })),
      tag: 'trashToDeck',
    });
    placed.push(...O.trash.splice(O.trash.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1));
  }
  const ordered = bottomOrder(asOpp, placed);
  O.deck.push(...ordered);
  reveal(ctx.s, ordered.map((c) => c.uid), 'both');
  log(ctx.s, ctx.opp, `place ${ordered.length} carte(s) de sa Défausse au-dessous de son deck (Brook)`);
}, (s, p) => s.players[other(p)].trash.length > 0);

// ---------- Shadows Asgard (OP06-095) ----------

// Après +1000, mettre KO autant de ses Personnages {Thriller Bark Pirates} de coût 2 ou moins qu'il veut : +1000 de plus
// pour chaque Personnage réellement mis KO. Une question par carte.
const asgardChars = (s: GameState, p: PlayerId) => s.players[p].chars
  .filter((c) => matches(s, c, { type: THRILLER, costMax: 2 }) && canBeKO(s, c.uid, 'effect', p)).map((c) => c.uid);
const asgardEffect: Effect = seq(leaderPower(1000, 'turn', 'Shadows Asgard'), effect((ctx) => {
  let n = 0;
  for (;;) {
    const uid = chooseUpTo1(ctx, asgardChars(ctx.s, ctx.me), `Shadows Asgard : Personnage à mettre KO (+1000 à ton Leader)${n ? ` (déjà ${n})` : ''} :`, 'trashOwn');
    if (uid === null) break;
    if (removeByEffect(ctx, uid, 'ko')) n++;
  }
  if (!n) return;
  leaderPower(1000 * n, 'turn', 'Shadows Asgard').run(ctx);
}, () => false));

// ---------- Reiju Vinsmoke (OP06-042, Leader) ----------

// [Votre tour] [Une fois par tour] quand une DON!! de son terrain retourne au deck DON!! (par un effet adverse aussi : Q&A) : 1 carte.
// Q&A : renvoyée en coût d'OP06-068, qui joue OP06-069 : le joueur peut résoudre le [Jouée] d'abord (2 cartes, 5 en main au
// plus) et piocher ensuite. Les deux ne viennent pas du même événement (pas d'étape « ordre » d'emit) : la question est posée ici.
const reijuDraw = (ctx: EffectCtx) => {
  const { s, pending: p } = ctx;
  const others = s.pending.some((x) => x !== p && x.controller === ctx.me && x.kind === 'onPlay');
  if (others && !p.data?.deferred && !may(ctx, 'Reiju : piocher maintenant, avant l’effet [Jouée] en attente ?')) {
    s.pending.push({ ...p, answers: [], snapshot: undefined, data: { ...p.data, deferred: 1 } });
    return;
  }
  drawCards(1).run(ctx);
};

// ---------- Hiyori (OP06-106) ----------

// Coût : 1 carte du dessus ou du dessous de sa Vie en main. Effet : jusqu'à 1 carte de sa main au-dessus de sa Vie, face
// cachée, sans la montrer (Q&A). Remettre la carte qu'on vient de prendre compte quand même comme une carte retirée de la
// Vie (Q&A d'OP11-041) ; lifeWatch ne compare que les identifiants, l'évènement est donc annoncé ici.
const hiyoriEffect: Effect = {
  run: (ctx) => {
    const P = ctx.s.players[ctx.me];
    if (!P.life.length || !canTakeLife(ctx.s, ctx.me)) return;
    if (!may(ctx, 'Hiyori : ajouter à ta main la carte du dessus ou du dessous de ta Vie ?')) return;
    const from = ctx.ask({
      prompt: 'Carte de ta Vie à ajouter à ta main :',
      options: [{ id: 'top', label: 'La carte du dessus' }, { id: 'bottom', label: 'La carte du dessous' }],
      tag: 'lifeSide',
    }) as 'top' | 'bottom';
    const taken = lifeToHand(ctx.s, ctx.me, from);
    if (!taken) return;
    const options = uniqueByNum(knownFirst(ctx.s, ctx.me, P.hand));
    const answer = ctx.ask({
      prompt: 'Hiyori : carte de ta main à placer au-dessus de ta Vie :',
      options: [...options.map((c) => ({ id: `card:${c.uid}`, label: name(c.num), uid: c.uid, num: c.num })), { id: 'none', label: 'Aucune' }],
      tag: 'toLife',
    });
    if (answer === 'none') return;
    const [c] = P.hand.splice(P.hand.findIndex((x) => x.uid === Number(answer.split(':')[1])), 1);
    P.life.unshift(c);
    reveal(ctx.s, [c.uid], ctx.me);
    log(ctx.s, ctx.me, 'place 1 carte de sa main au-dessus de sa Vie (Hiyori)');
    if (c.uid === taken.uid) emit(ctx.s, { type: 'lifeRemoved', player: ctx.me, count: 1 });
  },
  useful: (s, p) => s.players[p].life.length > 0 && canTakeLife(s, p),
};

// ---------- Reject (OP06-116) ----------

// « Si votre adversaire a 1 carte de Vie, infligez-lui 1 dégât. Puis, ajoutez à votre main la carte du dessus de votre Vie » :
// la condition couvre le « Puis » (Q&A, n° 1983). Le dégât se traite d'abord, [Déclenchement] compris, puis la carte de Vie
// (action 'lifeTopToHand' ; lifeToHand tient compte du Leader Luffy ST13-003 : Q&A)
const rejectDamage: Effect = effect((ctx) => {
  const O = ctx.s.players[ctx.opp];
  if (O.life.length !== 1) return;
  log(ctx.s, ctx.me, 'inflige 1 dégât à son adversaire (Reject)');
  ctx.s.pending.unshift(
    { kind: 'system', action: 'leaderDamage', source: O.leader.uid, num: O.leader.num, controller: ctx.opp, answers: [], data: { amount: 1, sourceNum: ctx.num } },
    { kind: 'system', action: 'lifeTopToHand', source: ctx.source, num: ctx.num, controller: ctx.me, answers: [] },
  );
}, (s, p) => s.players[other(p)].life.length === 1);

export const OP06: Record<string, CardBehavior> = {
  // Reiju Vinsmoke (Leader) : voir reijuDraw
  'OP06-042': card({}, { when: [{ on: 'donReturned', once: 'OP06-042:don', if: (s, owner, _self, e) => s.active === owner && e.player === owner, run: reijuDraw }] }),

  // Saga : [DON!! x1] [En attaquant] voir sagaEffect
  'OP06-006': card({ whenAttacking: when(selfDon(1), sagaEffect) }),

  // Shuraiya : [Bloqueur] ; [En attaquant]/[En bloquant] [Une fois par tour] (le même effet, une seule fois) : voir shuraiyaBase
  'OP06-009': card({ whenAttacking: oncePerTurn(SHURAIYA, effect(shuraiyaBase)) }, {
    when: [{ on: 'block', once: SHURAIYA, if: (_s, _o, self, e) => e.uid === self.uid, run: shuraiyaBase }],
  }),

  // Bear.King : ne peut pas être mis KO en combat si l'adversaire a un Leader ou un Personnage de 6000 de puissance de base
  // ou plus (la condition de la recette ne regarde que les Personnages)
  'OP06-012': card({}, {
    cantBeKO: (s, owner, _self, cause) => cause === 'battle' && [s.players[other(owner)].leader, ...s.players[other(owner)].chars].some((c) => basePower(s, c.uid) >= 6000),
  }),

  // Ratchet : [Attaque adverse] voir ratchetBattle
  'OP06-014': card({ onOpponentAttack: ratchetBattle }),

  // Lily Carnation : [Activation : Principale] [Une fois par tour] placer 1 de ses Personnages de 6000 de puissance ou plus dans
  // la Défausse : jouer épuisé 1 Personnage {FILM} de 2000 à 5000 de puissance (proposé dès que le coût est payable : n° 1000)
  'OP06-015': card({
    activateMain: {
      label: 'Lily Carnation : placer 1 de tes Personnages de 6000 de puissance ou plus dans ta Défausse, puis jouer épuisé 1 Personnage {FILM} de 2000 à 5000 de puissance',
      once: true,
      cost: trashOwnCharCost({ powerMin: 6000 }),
      effect: lilyPlay,
    },
  }),

  // Dosun : [En attaquant] voir dosunEffect
  'OP06-030': card({ whenAttacking: dosunEffect }),

  // Koushirou : [Jouée] redresser jusqu'à 1 Personnage <Tranche> de coût 4 ou moins. Puis, plus d'attaque de Leader ce tour-ci
  'OP06-026': card({ onPlay: seq(setActiveTargets(ownChar({ attribute: 'Slash', costMax: 4 }), 'Koushirou'), noLeaderAttack('Koushirou')) }),

  // Charlotte Pudding : [Jouée] voir puddingEffect
  'OP06-047': card({ onPlay: puddingEffect }),

  // Zeff : voir zeffIf
  'OP06-048': card({}, { when: [{ on: 'block', if: zeffIf, run: zeffRun }, { on: 'event', if: zeffIf, run: zeffRun }] }),

  // Vinsmoke Ichiji : [Jouée] sous condition de DON!!, −2000 à jusqu'à 1 Personnage adverse pour le tour et [Initiative] ; ce qui
  // est donné reste si le nombre de DON!! change ensuite (Q&A)
  'OP06-061': card({ onPlay: when(noMoreDonThanOpp, seq(powerMod(oppChar(), -2000, 'turn', 'Vinsmoke Ichiji'), selfKeyword('Rush', 'Vinsmoke Ichiji', 'turn'))) }),

  // Vinsmoke Judge : [Jouée] voir judgeOnPlay ; [Activation : Principale] [Une fois par tour] DON!! −1 : épuiser jusqu'à 1 DON!! adverse
  'OP06-062': card({
    onPlay: judgeOnPlay,
    activateMain: {
      label: 'Vinsmoke Judge : DON!! −1 : épuiser 1 DON!! adverse',
      once: true,
      cost: donMinus(1),
      effect: restOppDon(1, 'Vinsmoke Judge'),
    },
  }),

  // Cosette : [Bloqueur] si son Leader est {GERMA 66} et qu'il a au moins 2 DON!! de moins que l'adversaire sur le terrain (lu au
  // moment du blocage : Q&A)
  'OP06-072': card({}, { blocker: (s, p) => leaderType(GERMA)(s, p, -1) && donOnField(s, p) <= donOnField(s, other(p)) - 2 }),

  // Zephyr : [Jouée] DON!! −1 : voir zephyrEffect
  'OP06-074': card({ onPlay: mayPay(donMinus(1), zephyrEffect, 'Zephyr') }),

  // Gecko Moria : [Jouée] voir moriaEffect
  'OP06-086': card({ onPlay: moriaEffect }),

  // Brook : [Jouée] au choix : placer dans sa Défausse jusqu'à 1 Personnage adverse de coût 4 ou moins (pas un KO : Q&A), ou voir brookOppTrash
  'OP06-092': card({
    onPlay: chooseOne('Brook', [
      { label: '1. Placer dans sa Défausse jusqu’à 1 Personnage adverse de coût 4 ou moins', effect: removeChars(oppChar({ costMax: 4 }), 'trash', 'Brook', { n: 1 }) },
      { label: '2. Ton adversaire place 3 cartes de sa Défausse au-dessous de son deck', effect: brookOppTrash },
    ]),
  }),

  // Shadows Asgard : [Principale]/[Contre] voir asgardEffect ; [Déclenchement] piocher 2, défausser 1
  'OP06-095': card({
    onMain: asgardEffect,
    onCounter: asgardEffect,
    onTrigger: effect((ctx) => { drawCards(2).run(ctx); discardFromHand(ctx, ctx.me, 1, 'Carte à défausser de ta main :'); }),
  }, { counterPower: (s, p, target) => (target === s.players[p].leader.uid ? 1000 : 0) }),

  // Negative Hollow : [Principale] et [Déclenchement] : 1 carte de la main adverse (au hasard : la main est cachée, comme X-Drake OP17-075)
  'OP06-097': card({ onMain: trashFromOppHand(1, 'Negative Hollow'), onTrigger: trashFromOppHand(1, 'Negative Hollow') }),

  // Kamakiri : voir anyStageToBottom
  'OP06-102': card({
    activateMain: {
      label: 'Kamakiri : placer 1 Lieu de coût 1 au-dessous du deck de son propriétaire, puis mettre KO 1 Personnage adverse de coût 2 ou moins',
      once: true,
      cost: anyStageToBottom,
      effect: ko(oppChar({ costMax: 2 }), 'Kamakiri'),
    },
    onTrigger: playIfLife,
  }),

  // Kawamatsu : [En attaquant] défausser 2 cartes : jusqu'à 1 de ses Personnages de 0 de puissance (exactement : pas en dessous,
  // Q&A) au-dessus ou au-dessous de la Vie de son propriétaire, face visible
  'OP06-103': card({
    whenAttacking: mayPay(discardCost(2), toOwnersLife(ownChar({ powerMin: 0, powerMax: 0 }), 'Kawamatsu'), 'Kawamatsu'),
    onTrigger: playIfOppLife,
  }),

  // Kikunojo : [En cas de KO] si l'adversaire a 3 Vies ou moins, jusqu'à 1 carte du deck au-dessus de sa Vie (on peut refuser)
  'OP06-104': card({ onKO: when(oppLifeAtMost(3), mayLifeFromDeck('Kikunojo')), onTrigger: playIfOppLife }),

  // Hiyori : [Jouée] voir hiyoriEffect
  'OP06-106': card({ onPlay: hiyoriEffect }),

  // Chavipère : [DON!! x2] peut aussi attaquer les Personnages adverses redressés
  'OP06-110': card({ onTrigger: playIfOppLife }, { attackActive: (_s, _p, self) => self.don >= 2 }),

  // Braham : voir anyStageToBottom
  'OP06-111': card({
    activateMain: {
      label: 'Braham : placer 1 Lieu de coût 1 au-dessous du deck de son propriétaire, puis épuiser 1 Personnage adverse de coût 4 ou moins',
      once: true,
      cost: anyStageToBottom,
      effect: rest(oppChar({ costMax: 4 }), 'Braham'),
    },
    onTrigger: playIfLife,
  }),

  // Wiper : [Jouée] voir anyStageToBottom : regarder 5 cartes, jusqu'à 1 [Upper Yard] ou carte {Shandian Warrior}
  'OP06-114': card({
    onPlay: withCost(anyStageToBottom, searchTop(5, 1, { anyOf: [{ name: 'Upper Yard' }, { type: 'Shandian Warrior' }] }, 'jusqu’à 1 [Upper Yard] ou carte {Shandian Warrior}'), 'Wiper'),
  }),

  // Reject : [Principale] au choix : KO adverse de coût 5 ou moins, ou voir rejectDamage ; [Déclenchement] piocher 1
  'OP06-116': card({
    onMain: chooseOne('Reject', [
      { label: '1. Mettre KO jusqu’à 1 Personnage adverse de coût 5 ou moins', effect: ko(oppChar({ costMax: 5 }), 'Reject') },
      { label: '2. Infliger 1 dégât à ton adversaire (s’il a 1 Vie), puis prendre en main la carte du dessus de ta Vie', effect: rejectDamage },
    ]),
    onTrigger: drawCards(1),
  }),

  // The Ark Maxim (Lieu) : [Activation : Principale] [Une fois par tour] épuiser ce Lieu et 1 de ses cartes [Enel] : KO de tous les
  // Personnages adverses de coût 2 ou moins
  'OP06-117': card({
    activateMain: {
      label: 'The Ark Maxim : épuiser ce Lieu et 1 de tes cartes [Enel], puis mettre KO tous les Personnages adverses de coût 2 ou moins',
      once: true,
      cost: bothCosts(restSelf(), restCost(1, 'cards', { name: 'Enel' })),
      effect: removeChars(oppChar({ costMax: 2 }), 'ko', 'The Ark Maxim', { all: true }),
    },
  }),
};

// Morceaux de recettes codés à la main (aucun)
export const MANUAL_OP06 = {};
