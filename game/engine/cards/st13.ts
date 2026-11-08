// ST13 (étape C, tâche S13) : le deck dont la Vie se manipule de façon particulière (face visible, cartes retirées ou
// remises), codé à la main d'après le texte officiel (VO et VF, jamais recopié). Les cartes que le traducteur comprend sont
// en recettes (recipes/sets/st13.ts). Choix d'interprétation : game/docs/interpretations.md, section « EB01 et ST13 (tâche S13) ».
import {
  canPlayCharacters, carryKnown, def, describe, knownFirst, knows, log, may, playCharacter, privateLog, removeFromField, reveal, uniqueByNum,
} from '../rules.ts';
import type { Card, CardBehavior, EffectCtx, GameState, PlayerId } from '../types.ts';
import { placeRest } from './bricks-cards.ts';
import { reorderLife } from './bricks-life.ts';
import {
  card, cardMatches, discardCost, effect, leaderPower, lifeAtMost, lifeFromDeck, matches, oppHandAtLeast, ownChar, playFromHand, powerMod, selfDon,
  selfKeyword, seq, trashLifeCost, trashOppLife, trashSelf, when, withCost, type CharSpec, type Cost, type Effect,
} from './bricks.ts';

// « Vous pouvez [coût] : [effet] » proposé seulement si l'effet peut servir (convention n° 1000 des recettes)
const mayPay = (cost: Cost, then: Effect, source: string): Effect => when((s, p, self) => then.useful(s, p, self), withCost(cost, then, source));

const SABO = 'Sabo';
const ACE = 'Portgas.D.Ace';
const LUFFY = 'Monkey.D.Luffy';
const COST_5 = { category: 'CHARACTER' as const, costMin: 5, costMax: 5 };

// Une carte du terrain ou de la main placée au-dessus de la Vie, face visible : les deux joueurs la voient
function onLifeFaceUp(ctx: EffectCtx, c: Card, source: string) {
  ctx.s.players[ctx.me].life.unshift({ uid: c.uid, num: c.num, faceUp: true });
  reveal(ctx.s, [c.uid], 'both');
  log(ctx.s, ctx.me, `place ${def(c.num).name} face visible au-dessus de sa Vie (${source})`);
}

// Sabo (Leader) : coût « 1 de vos Personnages de coût 3 ou plus et de 7000 de puissance ou plus (puissance actuelle : Q&A) au-dessus
// de votre Vie, face visible »
const SABO_COST: CharSpec = { costMin: 3, powerMin: 7000 };
const saboList = (s: GameState, p: PlayerId) => s.players[p].chars.filter((c) => matches(s, c, SABO_COST)).map((c) => c.uid);
const saboCost: Cost = {
  label: 'placer 1 de tes Personnages de coût 3 ou plus et de 7000 de puissance ou plus face visible au-dessus de ta Vie',
  can: (s, p) => saboList(s, p).length > 0,
  pay: (ctx) => {
    const options = saboList(ctx.s, ctx.me);
    if (!options.length) return false;
    const answer = ctx.ask({
      prompt: 'Sabo : Personnage à placer face visible au-dessus de ta Vie :',
      options: options.map((uid) => ({ id: `card:${uid}`, label: describe(ctx.s, uid), uid })),
      tag: 'toLife',
    });
    const f = removeFromField(ctx.s, Number(answer.split(':')[1]), 'lifeTop');
    if (!f) return false;
    log(ctx.s, ctx.me, `place ${def(f.card.num).name} face visible au-dessus de sa Vie (Sabo)`);
    return true;
  },
};

// Portgas D. Ace (Leader) : regarder 5 cartes, jusqu'à 1 Personnage de coût 5 au-dessus de la Vie face visible, le reste dessous
const lookToLifeFaceUp = (look: number, source: string): Effect => effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const looked = P.deck.splice(0, look);
  log(ctx.s, ctx.me, `regarde ${looked.length} cartes du dessus de son deck (${source})`);
  const answer = ctx.ask({
    prompt: `${source} : tu regardes ${looked.map((c) => def(c.num).name).join(', ')}. Personnage de coût 5 à placer face visible au-dessus de ta Vie :`,
    options: [
      ...uniqueByNum(looked.filter((c) => cardMatches(c.num, COST_5))).map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })),
      { id: 'none', label: 'Aucune' },
    ],
    tag: 'lookToLife',
    cards: looked.map((c) => ({ uid: c.uid, num: c.num, owner: ctx.me })),
  });
  if (answer !== 'none') {
    const [picked] = looked.splice(looked.findIndex((c) => c.uid === Number(answer.split(':')[1])), 1);
    onLifeFaceUp(ctx, picked, source);
  }
  placeRest(ctx, looked, 'bottom', source);
}, (s, p) => s.players[p].deck.length > 0);

// Portgas D. Ace (Leader) : [Fin de votre tour] toutes ses cartes de Vie face visible, d'où qu'elles viennent (Q&A), vont dans la Défausse
const trashFaceUpLife = (source: string): Effect => effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  for (const c of P.life.filter((x) => x.faceUp)) {
    P.life.splice(P.life.indexOf(c), 1);
    P.trash.push({ uid: c.uid, num: c.num });
    log(ctx.s, ctx.me, `place dans sa Défausse ${def(c.num).name}, carte de Vie face visible (${P.life.length} Vie) (${source})`);
  }
}, (s, p) => s.players[p].life.some((c) => c.faceUp));

// Luffy (Leader) : avec 0 Vie, jusqu'à 2 Personnages de coût 5 de sa main et/ou de sa Défausse (Q&A : 1 de chaque est permis) au-dessus
// de sa Vie, face visible
const faceUpFromHandOrTrash = (n: number, source: string): Effect => effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  for (let i = 0; i < n; i++) {
    const hand = uniqueByNum(knownFirst(ctx.s, ctx.me, P.hand.filter((c) => cardMatches(c.num, COST_5))));
    const trash = uniqueByNum(P.trash.filter((c) => cardMatches(c.num, COST_5)));
    if (!hand.length && !trash.length) return;
    const answer = ctx.ask({
      prompt: `${source} : Personnage de coût 5 à placer face visible au-dessus de ta Vie (${i + 1}/${n}) :`,
      options: [
        ...hand.map((c) => ({ id: `card:${c.uid}`, label: `${def(c.num).name} (main)`, uid: c.uid, num: c.num })),
        ...trash.map((c) => ({ id: `card:${c.uid}`, label: `${def(c.num).name} (Défausse)`, uid: c.uid, num: c.num })),
        { id: 'none', label: 'Aucune' },
      ],
      tag: 'toLife',
    });
    if (answer === 'none') return;
    const uid = Number(answer.split(':')[1]);
    const zone = P.hand.some((c) => c.uid === uid) ? P.hand : P.trash;
    const [c] = zone.splice(zone.findIndex((x) => x.uid === uid), 1);
    onLifeFaceUp(ctx, c, source);
  }
}, (s, p) => [...s.players[p].hand, ...s.players[p].trash].some((c) => cardMatches(c.num, COST_5)));

// « Regardez toutes vos cartes de Vie ; placez-en 1 au-dessus de votre deck et replacez les autres dans l'ordre de votre choix » :
// obligatoire (la seule carte de Vie y passe) ; la carte passe face cachée sur le deck et les autres gardent leur face (Q&A)
const lifeOneToDeckTop = (source: string): Effect => effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  if (!P.life.length) return;
  privateLog(ctx.s, ctx.me, `cartes regardées (ta Vie) : ${P.life.map((c) => def(c.num).name).join(', ')}`);
  reveal(ctx.s, P.life.map((c) => c.uid), ctx.me);
  const answer = P.life.length === 1 ? `card:${P.life[0].uid}` : ctx.ask({
    prompt: `${source} : carte de ta Vie à placer au-dessus de ton deck :`,
    options: P.life.map((c) => ({ id: `card:${c.uid}`, label: `${def(c.num).name}${c.faceUp ? ' (face visible)' : ''}`, uid: c.uid, num: c.num })),
    tag: 'lifeOrder',
    cards: P.life.map((c) => ({ uid: c.uid, num: c.num, owner: ctx.me })),
  });
  const [c] = P.life.splice(P.life.findIndex((x) => x.uid === Number(answer.split(':')[1])), 1);
  P.deck.unshift({ uid: c.uid, num: c.num });
  carryKnown(ctx.s, c.uid, 'deck');
  reveal(ctx.s, [c.uid], c.faceUp ? 'both' : ctx.me);   // une carte face visible était publique
  log(ctx.s, ctx.me, `place 1 carte de sa Vie au-dessus de son deck (${P.life.length} Vie) (${source})`);
  reorderLife('own', source).run(ctx);
}, (s, p) => s.players[p].life.length > 0);

// Ivankov : révéler jusqu'à 1 Personnage de coût 5 de sa main et le placer au-dessus de sa Vie, face cachée (connu des deux joueurs)
const revealToLifeHidden = (source: string): Effect => effect((ctx) => {
  const P = ctx.s.players[ctx.me];
  const options = uniqueByNum(knownFirst(ctx.s, ctx.me, P.hand.filter((c) => cardMatches(c.num, COST_5))));
  if (!options.length) return;
  const answer = ctx.ask({
    prompt: `${source} : Personnage de coût 5 de ta main à révéler et à placer face cachée au-dessus de ta Vie :`,
    options: [...options.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucune' }],
    tag: 'toLife',
  });
  if (answer === 'none') return;
  const [c] = P.hand.splice(P.hand.findIndex((x) => x.uid === Number(answer.split(':')[1])), 1);
  P.life.unshift(c);
  reveal(ctx.s, [c.uid], 'both');
  log(ctx.s, ctx.me, `révèle ${def(c.num).name} et le place face cachée au-dessus de sa Vie (${source})`);
}, (s, p) => s.players[p].hand.some((c) => cardMatches(c.num, COST_5)));

// Dadan : jusqu'à 1 de chaque nom, de coût 2, de sa main
const cost2 = (name: string) => ({ name, costMin: 2, costMax: 2 });

// Les trois frères enfants : se placer dans la Défausse : révéler le dessus de sa Vie ; si c'est [nom] de coût 5, il peut le jouer ;
// s'il le fait, +2000 à son Leader jusqu'à la fin du prochain tour adverse. Sinon la carte reste à sa place, connue des deux joueurs.
const brotherSpec = (name: string) => ({ ...COST_5, name });
const brother = (name: string): CardBehavior => card({
  activateMain: {
    label: `${name} : te placer dans ta Défausse pour révéler la carte du dessus de ta Vie`,
    condition: (s, p) => s.players[p].life.length > 0,
    cost: trashSelf(),
    effect: {
      run: (ctx) => {
        const P = ctx.s.players[ctx.me];
        const top = P.life[0];
        if (!top) return;
        reveal(ctx.s, [top.uid], 'both');
        log(ctx.s, ctx.me, `révèle ${def(top.num).name}, la carte du dessus de sa Vie (${name})`);
        if (!cardMatches(top.num, brotherSpec(name)) || !canPlayCharacters(ctx.s, ctx.me, top.num)) return;
        if (!may(ctx, `${name} : jouer ${def(top.num).name}, la carte révélée ?`)) return;
        P.life.shift();
        log(ctx.s, ctx.me, `joue ${def(top.num).name}, la carte révélée (${name})`);
        playCharacter(ctx, ctx.me, { uid: top.uid, num: top.num });
        leaderPower(2000, 'oppNextEnd', name).run(ctx);
      },
      // aide à l'IA : elle ne sacrifie pas ce Personnage à l'aveugle, seulement quand elle connaît la carte
      useful: (s, p) => {
        const top = s.players[p].life[0];
        return Boolean(top) && (Boolean(top.faceUp) || knows(s, p, top.uid)) && cardMatches(top.num, brotherSpec(name));
      },
    },
  },
});

// Shanks : coût « retourner face cachée 1 de vos cartes de Vie face visible », où qu'elle soit dans la Vie (Q&A)
const flipAnyDown: Cost = {
  label: 'retourner face cachée 1 de tes cartes de Vie face visible',
  can: (s, p) => s.players[p].life.some((c) => c.faceUp),
  pay: (ctx) => {
    const list = ctx.s.players[ctx.me].life.filter((c) => c.faceUp);
    if (!list.length) return false;
    const answer = list.length === 1 ? `card:${list[0].uid}` : ctx.ask({
      prompt: 'Shanks : carte de Vie à retourner face cachée :',
      options: list.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num })),
      tag: 'lifeOrder',
    });
    const c = list.find((x) => x.uid === Number(answer.split(':')[1]))!;
    c.faceUp = false;
    reveal(ctx.s, [c.uid], 'both');   // elle était publique
    log(ctx.s, ctx.me, `retourne ${def(c.num).name} face cachée dans sa Vie`);
    return true;
  },
};

export const ST13: Record<string, CardBehavior> = {
  // Sabo (Leader) : [DON!! x1] [Activation : Principale] [Une fois par tour] voir saboCost : +2000 à 1 de ses Personnages jusqu'au
  // début de son prochain tour
  'ST13-001': card({
    activateMain: {
      label: 'Sabo : placer un Personnage face visible au-dessus de ta Vie pour donner +2000 à un Personnage',
      once: true,
      condition: selfDon(1),
      cost: saboCost,
      effect: powerMod(ownChar(), 2000, 'oppNextEnd', SABO),
    },
  }),

  // Portgas D. Ace (Leader) : [DON!! x2] [Activation : Principale] [Une fois par tour] voir lookToLifeFaceUp ; [Fin de votre tour] voir
  // trashFaceUpLife
  'ST13-002': card({
    activateMain: {
      label: 'Portgas D. Ace : regarder 5 cartes et placer un Personnage de coût 5 face visible au-dessus de ta Vie',
      once: true,
      condition: selfDon(2),
      effect: lookToLifeFaceUp(5, ACE),
    },
    endOfTurn: trashFaceUpLife(ACE),
  }),

  // Luffy (Leader) : ses cartes de Vie face visible vont au-dessous du deck au lieu d'aller en main, par les règles ou par un effet
  // (Q&A ; rules.ts, faceUpLifeToDeck) ; [DON!! x2] [Activation : Principale] [Une fois par tour] défausser 1 carte : avec 0 Vie, voir
  // faceUpFromHandOrTrash
  'ST13-003': card({
    activateMain: {
      label: 'Luffy : défausser 1 carte pour placer jusqu’à 2 Personnages de coût 5 face visible dans ta Vie vide',
      once: true,
      condition: selfDon(2),
      cost: discardCost(1),
      effect: when(lifeAtMost(0), faceUpFromHandOrTrash(2, LUFFY)),
    },
  }, { faceUpLifeToDeck: true }),

  // Barbe Blanche : [Jouée] 1 carte du deck au-dessus de la Vie, puis voir lifeOneToDeckTop
  'ST13-004': card({ onPlay: seq(lifeFromDeck(), lifeOneToDeckTop('Edward.Newgate')) }),

  // Ivankov : [Bloqueur] ; [Jouée] 1 carte du dessus ou du dessous de sa Vie dans la Défausse : voir revealToLifeHidden
  'ST13-005': card({ onPlay: mayPay(trashLifeCost('both'), revealToLifeHidden('Emporio.Ivankov'), 'Emporio.Ivankov') }),

  // Dadan : [Bloqueur] ; [Jouée] jusqu'à 1 [Sabo], 1 [Ace] et 1 [Luffy] de coût 2 de sa main
  'ST13-006': card({
    onPlay: seq(
      playFromHand(cost2(SABO), 'Curly.Dadan'),
      playFromHand(cost2(ACE), 'Curly.Dadan'),
      playFromHand(cost2(LUFFY), 'Curly.Dadan'),
    ),
  }),

  'ST13-007': brother(SABO),

  // Shanks : [Jouée] voir flipAnyDown : si l'adversaire a 7 cartes ou plus en main, jusqu'à 1 carte du dessus de sa Vie dans sa Défausse
  'ST13-009': card({ onPlay: mayPay(flipAnyDown, when(oppHandAtLeast(7), trashOppLife(1)), 'Shanks') }),

  'ST13-010': brother(ACE),

  // Portgas D. Ace : [Jouée] avec 2 Vies ou moins, gagne [Initiative] (il la garde si sa Vie remonte à 3 : Q&A)
  'ST13-011': card({ onPlay: when(lifeAtMost(2), selfKeyword('Rush', ACE, 'turn')) }),

  'ST13-014': brother(LUFFY),

  // Yamato : [Initiative] ; [Jouée] voir lifeOneToDeckTop
  'ST13-016': card({ onPlay: lifeOneToDeckTop('Yamato') }),
};
