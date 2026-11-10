// Briques de la famille « DON!! » (étape C, tâche C2.4) : ce que les recettes demandent et que bricks.ts ne sait pas
// encore dire exactement. Les briques de bricks.ts restent celles qu'utilisent les cartes codées à la main (addDon,
// readyDon, giveDon, giveRestedDonToOwner, restDon, donMinus, giveActiveDon, restOppCards) ; celles-ci ajoutent :
// - renvoyer N DON!! de son terrain, ou faire renvoyer N DON!! à l'adversaire (« Your opponent returns ... ») ;
// - épuiser N de ses propres DON!! (effet, pas coût) ; épuiser jusqu'à N DON!! adverses (sans Personnage) ;
// - donner des DON!! épuisées à la carte elle-même (« Give this Character up to 2 rested DON!! cards ») ;
// - le coût « donner 1 DON!! épuisée adverse à 1 Personnage adverse » (OP15).
//
// Questions : mêmes étiquettes que les briques de bricks.ts (l'IA les connaît déjà).
import { addDonFromDeck, chooseUpTo1, def, donOnField, emit, fieldCards, findField, giveRestedDon, log, other, untapDon } from '../rules.ts';
import type { EffectCtx, GameState, PlayerId } from '../types.ts';
import { candidates, type Cost, type Effect, type Targets } from './bricks.ts';

// Renvoie au deck DON!! jusqu'à N DON!! du terrain de `p`, dans l'ordre du moteur pour DON!! −X (rules.ts, returnDon) :
// d'abord les épuisées, puis les redressées, puis celles données (interprétation 1741). `by` : joueur dont l'effet est
// la cause (l'évènement donReturned le dit, comme Amazon, fam-meta.ts).
function returnUpTo(s: GameState, p: PlayerId, n: number, by: PlayerId, sourceNum: string, source: string): number {
  const P = s.players[p];
  let left = Math.min(n, donOnField(s, p));
  const k = left;
  if (k <= 0) return 0;
  const take = (available: number) => {
    const x = Math.min(available, left);
    left -= x;
    return x;
  };
  P.donRested -= take(P.donRested);
  P.donActive -= take(P.donActive);
  for (const c of [...P.chars, P.leader]) c.don -= take(c.don);
  P.donDeck += k;
  log(s, p, `renvoie ${k} DON!! dans son deck DON!! (${source})`);
  emit(s, { type: 'donReturned', player: p, count: k, by, cause: 'effect', sourceNum });
  return k;
}

// « Return N DON!! cards from your field to your DON!! deck » (effet ; le coût DON!! −N est B.donMinus) : autant que
// possible s'il y en a moins (interprétation 1742)
export const returnOwnDon = (n: number, source: string): Effect => ({
  run: (ctx) => { returnUpTo(ctx.s, ctx.me, n, ctx.me, ctx.num, source); },
  useful: (s, p) => donOnField(s, p) >= n,
});

// L'adversaire renvoie N DON!! de son terrain à son deck DON!! : il choisit lesquelles, une à une, y compris
// celles données à son Leader ou à ses Personnages (Q&A d'OP02-085, OP02-089, OP02-090, OP02-091 ; n° 3700, 1993 : le n° 1741, un
// ordre fixe, ne vaut plus ici). Pour l'IA, la première réponse est celle qui lui coûte le moins : une DON!! épuisée ; pendant le tour
// de l'autre joueur, une DON!! donnée (elle ne donne de puissance que pendant son tour) avant une DON!! redressée.
export const returnOppDon = (n: number, source: string): Effect => ({
  run: (ctx) => {
    const O = ctx.s.players[ctx.opp];
    let k = 0;
    for (let i = 0; i < n && donOnField(ctx.s, ctx.opp) > 0; i++) {
      const given = fieldCards(ctx.s, ctx.opp).filter((c) => c.don > 0).map((c) => ({ id: `card:${c.uid}`, label: `1 DON!! donnée à ${def(c.num).name}`, uid: c.uid }));
      const rested = O.donRested > 0 ? [{ id: 'rested', label: '1 DON!! épuisée de ta zone de Coût' }] : [];
      const active = O.donActive > 0 ? [{ id: 'active', label: '1 DON!! redressée de ta zone de Coût' }] : [];
      const ownTurn = ctx.s.active === ctx.opp;
      const answer = ctx.ask({
        player: ctx.opp,
        prompt: `${source} : DON!! à renvoyer dans ton deck DON!!${n > 1 ? ` (${i + 1}/${n})` : ''} :`,
        options: ownTurn ? [...rested, ...active, ...given] : [...rested, ...given, ...active],
        tag: 'oppPayDon',
      });
      if (answer === 'rested') O.donRested--;
      else if (answer === 'active') O.donActive--;
      else findField(ctx.s, Number(answer.split(':')[1]))!.card.don--;
      O.donDeck++;
      k++;
    }
    if (!k) return;
    log(ctx.s, ctx.opp, `renvoie ${k} DON!! dans son deck DON!! (${source})`);
    emit(ctx.s, { type: 'donReturned', player: ctx.opp, count: k, by: ctx.me, cause: 'effect', sourceNum: ctx.num });
  },
  useful: (s, p) => donOnField(s, other(p)) > 0,
});

// « Rest N of your DON!! cards » (effet, souvent « you may ... If you do, ... ») : N DON!! redressées de la zone de Coût,
// autant que possible ; utile s'il y en a assez (une partie seulement ne « fait » pas l'effet demandé)
export const restOwnDon = (n: number, source: string): Effect => ({
  run: (ctx) => {
    const P = ctx.s.players[ctx.me];
    const k = Math.min(n, P.donActive);
    if (k <= 0) return;
    P.donActive -= k;
    P.donRested += k;
    log(ctx.s, ctx.me, `épuise ${k} DON!! (${source})`);
  },
  useful: (s, p) => s.players[p].donActive >= n,
});

// « Rest up to N of your opponent's DON!! cards » : une à une, comme B.restOppCards (même question, même étiquette),
// mais sans Personnage (restOppCards propose toujours les Personnages adverses)
export const restOppDon = (n: number, source: string): Effect => ({
  run: (ctx) => {
    const O = ctx.s.players[ctx.opp];
    for (let i = 0; i < n && O.donActive > 0; i++) {
      const answer = ctx.ask({
        prompt: `${source} : carte adverse à épuiser${n > 1 ? ` (${i + 1}/${n})` : ''} :`,
        options: [{ id: 'don', label: '1 DON!! redressée adverse' }, { id: 'none', label: 'Aucune' }],
        tag: 'oppRest',
      });
      if (answer !== 'don') return;
      O.donActive--;
      O.donRested++;
      log(ctx.s, ctx.me, `épuise 1 DON!! adverse (${source})`);
    }
  },
  useful: (s, p) => s.players[other(p)].donActive > 0,
});

// « Give this Character up to N rested DON!! cards » : la carte qui porte l'effet, sans choix de carte ; combien : au choix (n° 1994)
export const giveDonToSelf = (n: number): Effect => ({
  run: (ctx) => {
    const f = findField(ctx.s, ctx.source);
    if (!f || f.player !== ctx.me || f.stage) return;
    const k = askDonCount(ctx, Math.min(n, ctx.s.players[ctx.me].donRested), `${def(f.card.num).name} : combien de DON!! épuisées lui donner ?`);
    if (k) giveRestedDon(ctx.s, ctx.me, ctx.source, k);   // écrit le journal
  },
  useful: (s, p, self) => s.players[p].donRested > 0 && findField(s, self)?.player === p,
});

// Coût « give 1 of your opponent's rested DON!! cards to 1 of your opponent's Characters » (OP15) : une DON!! épuisée
// de la zone de Coût adverse passe sur une carte adverse choisie (t : cible adverse)
export const giveOppRestedDonCost = (t: Targets, n: number): Cost => ({
  label: `donner ${n} DON!! épuisée${n > 1 ? 's' : ''} adverse${n > 1 ? 's' : ''} (${t.label})`,
  can: (s, p, self) => s.players[other(p)].donRested >= n && candidates(s, p, t, undefined, self).length > 0,
  pay: (ctx) => {
    const O = ctx.s.players[ctx.opp];
    const list = candidates(ctx.s, ctx.me, t, undefined, ctx.source);
    if (O.donRested < n || !list.length) return false;
    const uid = list.length === 1 ? list[0] : ctx.ask({
      prompt: `Carte adverse qui reçoit ${n} DON!! épuisée${n > 1 ? 's' : ''} adverse${n > 1 ? 's' : ''} :`,
      options: list.map((u) => ({ id: `card:${u}`, label: def(findField(ctx.s, u)!.card.num).name, uid: u })),
      tag: 'oppDonTarget',
    }).split(':').map(Number)[1];
    const f = findField(ctx.s, uid);
    if (!f) return false;
    O.donRested -= n;
    f.card.don += n;
    log(ctx.s, ctx.me, `donne ${n} DON!! épuisée${n > 1 ? 's' : ''} adverse${n > 1 ? 's' : ''} à ${def(f.card.num).name}`);
    return true;
  },
});

// ---------- « Jusqu'à N » DON!! : le joueur choisit combien, 0 compris (règle 1-3-5-1 ; Q&A de ST01-007, ST02-015, ST02-016, OP01-113 ;
// n° 1994). Les briques addDon, readyDon, giveDon de bricks.ts donnent toujours le maximum : elles restent pour le code d'avant l'étape C
// (CF.2). Options du plus grand au plus petit, puis « Aucune » : l'IA heuristique prend la première, le maximum, comme avant.

export function askDonCount(ctx: EffectCtx, max: number, prompt: string): number {
  if (max <= 0) return 0;
  const answer = ctx.ask({
    prompt,
    options: [...Array.from({ length: max }, (_, i) => max - i).map((k) => ({ id: `n:${k}`, label: `${k} DON!!` })), { id: 'none', label: 'Aucune' }],
    tag: 'donUpTo',
  });
  return answer === 'none' ? 0 : Number(answer.split(':')[1]);
}

// « Ajoutez jusqu'à N cartes DON!! de votre deck DON!! et redressez-les / épuisez-les »
export const addDonUpTo = (n: number, state: 'active' | 'rested', source: string): Effect => ({
  run: (ctx) => {
    const k = askDonCount(ctx, Math.min(n, ctx.s.players[ctx.me].donDeck),
      `${source} : combien de DON!! ajouter de ton deck DON!! (${state === 'active' ? 'redressées' : 'épuisées'}) ?`);
    if (k) addDonFromDeck(ctx.s, ctx.me, k, state === 'active');
  },
  useful: (s, p) => s.players[p].donDeck > 0,
});

// « Redressez jusqu'à N de vos cartes DON!! » (rien à demander si un effet de Personnage ne peut plus en redresser ce tour-ci :
// untapDon l'écrit au journal, L'Oiseau EB04-016)
export const readyDonUpTo = (n: number, source: string): Effect => {
  const blocked = (s: GameState, p: PlayerId, num: string) => s.players[p].noCharDonReadyTurn === s.turn && def(num).category === 'CHARACTER';
  return {
    run: (ctx) => {
      if (blocked(ctx.s, ctx.me, ctx.num)) { untapDon(ctx.s, ctx.me, n, ctx.num); return; }
      const k = askDonCount(ctx, Math.min(n, ctx.s.players[ctx.me].donRested), `${source} : combien de DON!! redresser ?`);
      if (k) untapDon(ctx.s, ctx.me, k, ctx.num);
    },
    useful: (s, p, self) => s.players[p].donRested > 0 && !(findField(s, self) && blocked(s, p, findField(s, self)!.card.num)),
  };
};

// « Donnez jusqu'à N cartes DON!! épuisées à [cible] » : la carte (« Aucune » possible s'il y en a plusieurs), puis combien
export const giveDonUpTo = (t: Targets, n: number, source: string): Effect => ({
  run: (ctx) => {
    const max = Math.min(n, ctx.s.players[ctx.me].donRested);
    const list = candidates(ctx.s, ctx.me, t, undefined, ctx.source);
    if (max <= 0 || !list.length) return;
    const uid = list.length === 1 ? list[0] : chooseUpTo1(ctx, list, `${source} : carte qui reçoit jusqu'à ${max} DON!! épuisée${max > 1 ? 's' : ''} :`, 'donTarget');
    if (uid === null) return;
    // une seule carte possible : la question du nombre propose aussi « Aucune » ; sinon « Aucune » était déjà dans le choix de la carte
    const k = list.length === 1 || max > 1 ? askDonCount(ctx, max, `${source} : combien de DON!! épuisées donner à ${def(findField(ctx.s, uid)!.card.num).name} ?`) : 1;
    if (k) giveRestedDon(ctx.s, ctx.me, uid, k);
  },
  useful: (s, p, self) => s.players[p].donRested > 0 && candidates(s, p, t, undefined, self).length > 0,
});
