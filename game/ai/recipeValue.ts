// Valeur d'un effet lue dans la recette de la carte (tâche CF.1) : l'IA simple sait jouer une carte de l'étape C sans aide
// écrite pour elle. La recette dit ce que fait l'effet (retirer, piocher, renforcer, protéger, accélérer les DON!!...) ;
// cette lecture l'estime dans la situation de la partie, en « cartes » (1 : à peu près une carte piochée), avec les
// mêmes repères que l'IA simple (valeur d'une carte du terrain : puissance, coût, [Bloqueur]).
//
// Ce n'est qu'une estimation : une cible qui n'existe pas vaut 0, une condition qu'on ne sait pas lire compte pour une
// chance sur deux, un morceau codé à la main (« manual ») vaut un peu. Elle ne sert qu'aux cartes SANS aide écrite :
// - une carte d'un des 23 decks d'avant l'étape 5 (préconstruits et East Blue) garde les décisions d'avant (`legacyCard`) :
//   l'IA simple sert de référence à l'IA entraînée, l'empreinte des parties ne doit pas bouger ;
// - une carte codée à la main n'a pas de recette : seules ses aides du moteur (useful, counterPower...) servent.
import { DECKS } from '../engine/decks.ts';
import { handCoded, recipeEntry } from '../engine/cards/index.ts';
import {
  attackAbility, def, donOnField, fieldCost, findField, hasBlocker, hasKeyword, other, power,
} from '../engine/rules.ts';
import type { FieldCard, GameState, PlayerId } from '../engine/types.ts';
import type { Ability, Action, Cond, CostPart, Filter, Recipe, Step, Target, Timing } from '../engine/recipes/types.ts';

// ---------- Cartes concernées ----------

// Les 23 decks du registre à la fin de l'étape C (tâche 5.1) : liste figée. Un deck ajouté ensuite au registre (decks
// ST de l'étape 5, adversaires d'Alabasta...) ne retire pas l'IA générique à ses cartes ; seules les cartes de ces 23
// decks gardent les décisions d'avant.
export const LEGACY_DECK_IDS: readonly string[] = [
  'ST-35', 'ST-31', 'ST-32', 'ST-33', 'ST-34', 'ST-36',
  'META-SABO-2026-10', 'META-MIHAWK-2026-10', 'META-ROBIN-2026-10', 'META-XEBEC-2026-10', 'META-ENEL-2026-10',
  'META-KAIDO-2026-10',
  'ST-21', 'ST-22', 'ST-30', 'ST-01',
  'AV-EB-MORGAN', 'AV-EB-BAGGY', 'AV-EB-KURO', 'AV-EB-KRIEG', 'AV-EB-ARLONG', 'AV-EB-BAGGY-ALVIDA', 'AV-EB-SMOKER',
];

let legacy: Set<string> | null = null;

// Carte d'un des 23 decks d'avant : ses décisions restent celles d'avant l'étape C (empreinte : 0 partie différente)
export function legacyCard(num: string): boolean {
  legacy ??= new Set(LEGACY_DECK_IDS.flatMap((id) => {
    const d = DECKS[id];
    if (!d) throw new Error(`Deck d'avant absent du registre : ${id}`);
    return [d.leader, ...Object.keys(d.cards)];
  }));
  return legacy.has(num);
}

// La recette qui fait jouer la carte (pas de code à la main, pas d'aide d'avant l'étape C) ; undefined sinon
export function recipeOf(num: string): Recipe | undefined {
  if (legacyCard(num) || handCoded(num)) return undefined;
  return recipeEntry(num)?.recipe;
}

// Carte sans aide écrite : les décisions génériques (et la valeur lue dans la recette, si elle en a une) s'appliquent
export const generic = (num: string | undefined | null): num is string => Boolean(num) && !legacyCard(num!);

export function abilitiesOf(num: string, timing: Timing): Ability[] {
  const r = recipeOf(num);
  if (!r) return [];
  return timing === 'trigger' ? (r.trigger ? [r.trigger] : r.abilities.filter((a) => a.timing === 'trigger')) : r.abilities.filter((a) => a.timing === timing);
}

// ---------- Repères ----------

// Valeur d'une carte du terrain (même formule que l'IA simple, heuristic.ts)
export function cardValue(s: GameState, uid: number): number {
  const f = findField(s, uid);
  if (!f) return 0;
  if (f.leader) return 20;
  return power(s, uid) / 1000 + Math.max(0, fieldCost(s, uid)) * 0.6 + (hasBlocker(s, f.player, f.card) ? 1.5 : 0);
}

// Valeur d'une carte hors du terrain (main, Défausse, deck) qu'un effet jouerait : son coût, sa puissance
const printedValue = (num: string) => (def(num).cost ?? 0) * 0.6 + (def(num).power ?? 0) / 1000;

const canAttackNow = (s: GameState, p: PlayerId, c: FieldCard) => s.active === p && attackAbility(s, p, c).can;

// Une carte du terrain correspond-elle au filtre ? (valeurs actuelles ; les cartes regardées hors du terrain : fitsCard)
export function fitsField(s: GameState, uid: number, f: Filter): boolean {
  const ff = findField(s, uid);
  if (!ff) return false;
  if (f.anyOf?.length) {
    const { anyOf, ...rest } = f;
    return fitsField(s, uid, rest) && anyOf.some((alt) => fitsField(s, uid, alt));
  }
  const d = def(ff.card.num);
  if (f.category && !f.category.includes(d.category)) return false;
  const cost = fieldCost(s, uid);
  const pw = power(s, uid);
  if (f.costMax !== undefined && cost > f.costMax) return false;
  if (f.costMin !== undefined && cost < f.costMin) return false;
  if (f.costEq !== undefined && cost !== f.costEq) return false;
  if (f.baseCostMax !== undefined && (d.cost ?? 0) > f.baseCostMax) return false;
  if (f.baseCostMin !== undefined && (d.cost ?? 0) < f.baseCostMin) return false;
  if (f.powerMax !== undefined && pw > f.powerMax) return false;
  if (f.powerMin !== undefined && pw < f.powerMin) return false;
  if (f.basePowerMax !== undefined && (d.power ?? 0) > f.basePowerMax) return false;
  if (f.basePowerMin !== undefined && (d.power ?? 0) < f.basePowerMin) return false;
  if (f.rested !== undefined && ff.card.rested !== f.rested) return false;
  if (f.donMin !== undefined && ff.card.don < f.donMin) return false;
  if (f.keyword !== undefined && !hasKeyword(s, ff.player, ff.card, f.keyword)) return false;
  if (f.noKeyword !== undefined && hasKeyword(s, ff.player, ff.card, f.noKeyword)) return false;
  return fitsCard(ff.card.num, { ...f, costMax: undefined, costMin: undefined, costEq: undefined, powerMax: undefined, powerMin: undefined, keyword: undefined, noKeyword: undefined });
}

// Même chose pour une carte hors du terrain (valeurs imprimées)
export function fitsCard(num: string, f: Filter): boolean {
  const d = def(num);
  if (f.anyOf?.length) {
    const { anyOf, ...rest } = f;
    return fitsCard(num, rest) && anyOf.some((alt) => fitsCard(num, alt));
  }
  if (f.category && !f.category.includes(d.category)) return false;
  const cost = d.cost ?? 0;
  const pw = d.power ?? 0;
  if ((f.costMax ?? f.baseCostMax) !== undefined && cost > Math.min(f.costMax ?? Infinity, f.baseCostMax ?? Infinity)) return false;
  if ((f.costMin ?? f.baseCostMin) !== undefined && cost < Math.max(f.costMin ?? -Infinity, f.baseCostMin ?? -Infinity)) return false;
  if (f.costEq !== undefined && cost !== f.costEq) return false;
  if ((f.powerMax ?? f.basePowerMax) !== undefined && pw > Math.min(f.powerMax ?? Infinity, f.basePowerMax ?? Infinity)) return false;
  if ((f.powerMin ?? f.basePowerMin) !== undefined && pw < Math.max(f.powerMin ?? -Infinity, f.basePowerMin ?? -Infinity)) return false;
  if (f.types?.length) {
    const has = (t: string) => d.types.includes(t);
    if (f.typesMode === 'all' ? !f.types.every(has) : !f.types.some(has)) return false;
  }
  if (f.typeIncludes !== undefined && !d.types.some((t) => t.includes(f.typeIncludes!))) return false;
  if (f.name?.length && !f.name.some((n) => d.names.includes(n))) return false;
  if (f.notName !== undefined && d.names.includes(f.notName)) return false;
  if (f.color?.length && !f.color.some((c) => d.colors.includes(c))) return false;
  if (f.attribute !== undefined && !d.attributes.includes(f.attribute)) return false;
  if (f.trigger !== undefined && Boolean(d.triggerEn) !== f.trigger) return false;
  if (f.keyword !== undefined && !d.keywords.includes(f.keyword)) return false;
  if (f.noKeyword !== undefined && d.keywords.includes(f.noKeyword)) return false;
  return true;
}

// Cartes du terrain visées (uid), de la plus précieuse à la moins précieuse
export function fieldTargets(s: GameState, p: PlayerId, t: Target, self: number): number[] {
  if (t.zone !== 'field' || t.that) return [];
  if (t.self) return findField(s, self) ? [self] : [];
  const sides: PlayerId[] = t.side === 'own' ? [p] : t.side === 'opp' ? [other(p)] : [p, other(p)];
  const uids: number[] = [];
  for (const q of sides) {
    const P = s.players[q];
    if (t.leader) uids.push(P.leader.uid);
    if (t.characters !== false) uids.push(...P.chars.map((c) => c.uid));
    if (t.stage && P.stage) uids.push(P.stage.uid);
  }
  return uids.filter((u) => !(t.otherThanSelf && u === self) && fitsField(s, u, t.filter)).sort((a, b) => cardValue(s, b) - cardValue(s, a));
}

const countOf = (t: Target, n: number) => (t.count === 'all' ? n : Math.min(t.count, n));
const sumTop = (s: GameState, uids: number[], k: number) => uids.slice(0, k).reduce((sum, u) => sum + Math.min(12, cardValue(s, u)), 0);

// ---------- Conditions ----------

const cmp = (v: number, c: 'le' | 'ge' | 'eq', n: number) => (c === 'le' ? v <= n : c === 'ge' ? v >= n : v === n);
const cmp2 = (a: number, c: 'lt' | 'le' | 'gt' | 'ge', b: number) => (c === 'lt' ? a < b : c === 'le' ? a <= b : c === 'gt' ? a > b : a >= b);

// Vraie (1), fausse (0) ou inconnue (0,5) dans la situation
export function condChance(s: GameState, p: PlayerId, c: Cond, self: number): number {
  const P = s.players[p];
  const O = s.players[other(p)];
  const side = (x: 'own' | 'opp') => (x === 'own' ? P : O);
  const L = def(P.leader.num);
  const b = (x: boolean) => (x ? 1 : 0);
  switch (c.kind) {
    case 'leaderIs': return b(c.names.some((n) => L.names.includes(n)));
    case 'leaderType': return b(c.mode === 'all' ? c.types.every((t) => L.types.includes(t)) : c.types.some((t) => L.types.includes(t)));
    case 'leaderTypeIncludes': return b(L.types.some((t) => t.includes(c.part)));
    case 'leaderColor': return b(c.multicolor ? L.colors.length > 1 : c.colors.some((x) => L.colors.includes(x)));
    case 'leaderAttribute': return b(L.attributes.includes(c.attribute));
    case 'life': return b(cmp(c.side === 'total' ? P.life.length + O.life.length : side(c.side).life.length, c.cmp, c.n));
    case 'lifeVsOpp': return b(cmp2(P.life.length, c.cmp, O.life.length));
    case 'hand': return b(cmp(side(c.side).hand.length, c.cmp, c.n));
    case 'donField': return b(cmp(donOnField(s, c.side === 'own' ? p : other(p)), c.cmp, c.n));
    case 'donVsOpp': return b(cmp2(donOnField(s, p), c.cmp, donOnField(s, other(p))));
    case 'trash': return c.filter ? 0.5 : b(cmp(P.trash.length, c.cmp, c.n));
    case 'deck': return b(cmp(P.deck.length, c.cmp, c.n));
    case 'chars': {
      const sides: PlayerId[] = c.side === 'own' ? [p] : c.side === 'opp' ? [other(p)] : [p, other(p)];
      const n = sides.reduce((sum: number, q) => sum + s.players[q].chars.filter((x) => fitsField(s, x.uid, c.filter)).length
        + (c.leaderToo && fitsField(s, s.players[q].leader.uid, c.filter) ? 1 : 0), 0);
      return b(cmp(n, c.cmp, c.n));
    }
    case 'turn': return b((s.active === p) === c.mine);
    case 'and': return c.all.reduce((x, y) => x * condChance(s, p, y, self), 1);
    case 'or': return Math.min(1, c.any.reduce((x, y) => Math.max(x, condChance(s, p, y, self)), 0));
    case 'not': return 1 - condChance(s, p, c.cond, self);
    case 'selfState': {
      const f = findField(s, self);
      if (!f) return 0.5;
      return b((c.rested === undefined || f.card.rested === c.rested) && (c.donMin === undefined || f.card.don >= c.donMin));
    }
    default: return 0.5;
  }
}

// ---------- Actions ----------

// Gain d'un bonus ou d'un malus pendant un combat : il en change l'issue (`flips`), ou il ne sert presque à rien (`already` :
// l'issue était déjà la bonne). En attaquant : abattre la cible (Personnage : sa valeur ; Leader : 1,5) ; en défendant :
// garder sa carte (Leader : 1,5, bien plus avec 1 Vie ou moins)
function battleSwing(s: GameState, p: PlayerId, target: number, flips: boolean, already: boolean): number {
  if (!flips) return already ? 0.1 : 0;
  const f = findField(s, target);
  if (!f) return 0;
  if (f.leader) return s.active === p ? 1.5 : s.players[p].life.length <= 1 ? 6 : 1.5;
  return Math.min(8, cardValue(s, target));
}

// Ce qu'une action sait de son effet : la carte qui le porte (uid sur le terrain, -1 hors du terrain), son numéro, son moment
export interface Ctx { self: number; num: string; timing: Timing }

// Chance qu'au moins une des `look` cartes du dessus convienne au filtre
function hitChance(deck: string[], f: Filter, look: number): number {
  if (!deck.length) return 0;
  if (!Object.keys(f).length) return 1;
  const q = deck.filter((n) => fitsCard(n, f)).length / deck.length;
  return 1 - (1 - q) ** look;
}

// Une DON!! de plus ce tour-ci : vaut moins tard dans la partie (10 DON!! au plus)
const donWorth = (s: GameState, p: PlayerId) => (donOnField(s, p) >= 9 ? 0.2 : 0.8);

// Valeur d'une action pour le joueur p (en cartes ; négative si elle lui coûte)
export function actionValue(s: GameState, p: PlayerId, a: Action, ctx: Ctx): number {
  const { self } = ctx;
  const P = s.players[p];
  const O = s.players[other(p)];
  const mine = s.active === p;
  // cible de l'action : valeurs des cartes visées, du côté adverse (gain) ou du sien (perte)
  const removal = (t: Target, factor: number) => {
    const uids = fieldTargets(s, p, t, self);
    const opp = uids.filter((u) => findField(s, u)?.player !== p && !findField(s, u)?.leader);
    if (t.side === 'own') {
      const own = uids.filter((u) => !findField(s, u)?.leader).reverse();
      return t.upTo ? 0 : -sumTop(s, own, countOf(t, own.length)) * factor;
    }
    return sumTop(s, opp, countOf(t, opp.length)) * factor;
  };
  switch (a.kind) {
    case 'ko': return removal(a.target, 1);
    case 'trashChar': return removal(a.target, 1);
    case 'bottom': return removal(a.target, 1.1);
    case 'bounce': return removal(a.target, 0.7);
    case 'toLife': return removal(a.target, 0.4);
    case 'oppChooses': {
      const list = O.chars.filter((c) => fitsField(s, c.uid, a.filter)).map((c) => cardValue(s, c.uid)).sort((x, y) => x - y);
      const k = Math.min(a.n, list.length);
      const f = a.action === 'rest' ? 0.3 : a.action === 'bounce' ? 0.7 : 1;
      return list.slice(0, k).reduce((x, y) => x + Math.min(12, y), 0) * f;
    }
    case 'rest': case 'negate': case 'cantRefresh': {
      const uids = fieldTargets(s, p, a.target, self).filter((u) => findField(s, u)?.player !== p);
      if (!uids.length) return a.target.side === 'own' ? -0.3 : 0;
      const best = uids.slice(0, countOf(a.target, uids.length));
      const f = a.kind === 'negate' ? 0.3 : a.kind === 'cantRefresh' ? 0.25 : 0.3;
      return best.reduce((sum, u) => {
        const ff = findField(s, u)!;
        return sum + Math.min(4, cardValue(s, u) * f) + (a.kind === 'rest' && !ff.card.rested && hasBlocker(s, ff.player, ff.card) ? 1 : 0);
      }, 0);
    }
    case 'setActive': {
      const uids = fieldTargets(s, p, a.target, self).filter((u) => findField(s, u)?.card.rested && findField(s, u)?.player === p);
      return uids.length ? Math.min(2, uids.length) * (mine ? 1 : 0.4) : 0;
    }
    case 'power': {
      const uids = fieldTargets(s, p, a.target, self);
      if (!uids.length) return 0;
      const n = countOf(a.target, uids.length);
      const k = Math.abs(a.amount) / 1000;
      const b = s.battle;
      if (a.amount > 0) {
        const own = uids.filter((u) => findField(s, u)?.player === p);
        if (!own.length) return -0.3;
        // pendant un combat : ce qui compte, c'est d'en changer l'issue
        if (b && own.includes(mine ? b.attacker : b.target)) {
          const atk = power(s, b.attacker);
          const dp = power(s, b.target);
          return mine ? battleSwing(s, p, b.target, atk < dp && atk + a.amount >= dp, atk >= dp)
            : battleSwing(s, p, b.target, atk >= dp && dp + a.amount > atk, atk < dp);
        }
        // hors combat : sert à ses attaques ce tour-ci (ou à se défendre s'il dure)
        const attackers = own.filter((u) => canAttackNow(s, p, findField(s, u)!.card)).length;
        const lasting = a.until === 'oppNextEnd' || a.until === 'nextTurn' || a.until === 'permanent';
        return Math.min(n, own.length) * k * (attackers ? 0.35 : 0) + (lasting ? 0.2 * k : 0);
      }
      const opp = uids.filter((u) => findField(s, u)?.player !== p);
      if (!opp.length) return 0;
      if (b && opp.includes(mine ? b.target : b.attacker)) {
        const atk = power(s, b.attacker);
        const dp = power(s, b.target);
        return mine ? battleSwing(s, p, b.target, atk < dp && atk >= dp - k * 1000, atk >= dp)
          : battleSwing(s, p, b.target, atk >= dp && atk - k * 1000 < dp, atk < dp);
      }
      return Math.min(n, opp.length) * k * 0.3;
    }
    case 'powerSet': return fieldTargets(s, p, a.target, self).length ? 0.5 : 0;
    case 'cost': return a.amount < 0 && fieldTargets(s, p, a.target, self).some((u) => findField(s, u)?.player !== p) ? 0.3 : 0;
    case 'keyword': {
      const uids = fieldTargets(s, p, a.target, self).filter((u) => findField(s, u)?.player === p);
      if (!uids.length) return 0;
      if (a.keyword === 'Rush' || a.keyword === 'Rush: Character') return mine && uids.some((u) => findField(s, u)!.card.playedTurn === s.turn) ? 1.2 : 0.1;
      if (a.keyword === 'Double Attack') return mine ? 1 : 0.2;
      if (a.keyword === 'Blocker') return 0.6;
      return 0.5;
    }
    case 'cantAttack': case 'cantBlock': return fieldTargets(s, p, a.target, self).some((u) => findField(s, u)?.player !== p) ? 0.5 : 0;
    case 'cantBeKO': case 'cantBeRested': case 'cantLeave': case 'attackActive':
      return fieldTargets(s, p, a.target, self).some((u) => findField(s, u)?.player === p) ? 0.5 : 0;
    case 'draw': return P.deck.length > a.n + 3 ? a.n : P.deck.length > a.n ? 0.2 * a.n : -5;
    case 'discard': return a.upTo ? 0 : -0.8 * Math.min(a.n, P.hand.length);
    case 'oppDiscard': return 0.9 * Math.min(a.n, O.hand.length);
    case 'trashTop': return a.side === 'own' ? (def(P.leader.num).rules?.deckOut === 'win' ? 0.2 * a.n : P.deck.length > 10 ? -0.05 * a.n : -0.5 * a.n) : 0.05 * a.n;
    case 'search': {
      // une carte d'un type ou d'un coût précis n'est pas toujours parmi celles regardées : chance d'en voir une, d'après ce
      // qui reste de son propre deck (le joueur connaît sa liste)
      const take = Math.min(a.take, a.look) * hitChance(P.deck.map((c) => c.num), a.filter, a.look);
      return a.dest === 'hand' ? 0.8 * take : a.dest === 'play' ? 1.5 * take : 1 * take;
    }
    case 'arrangeTop': return 0.2;
    case 'play': {
      const pool = a.from === 'hand' ? P.hand.map((c) => c.num) : a.from === 'trash' ? P.trash.map((c) => c.num)
        : a.from === 'handOrTrash' ? [...P.hand, ...P.trash].map((c) => c.num) : [];
      if (a.from === 'deck' || a.from === 'life') return 1.5;
      const fits = pool.filter((n) => def(n).category === 'CHARACTER' && fitsCard(n, a.filter));
      if (!fits.length || P.chars.length >= 5) return 0;
      const best = Math.max(...fits.map(printedValue));
      // de la main : la carte y était déjà, seul le coût payé est gagné
      return a.from === 'hand' ? 0.5 + best * 0.3 : best * 0.6;
    }
    case 'playSelf': return P.chars.length < 5 && def(ctx.num).category === 'CHARACTER' ? 1 + printedValue(ctx.num) * 0.4 : 0;
    case 'activate': return 0.5;
    case 'trashToHand': return P.trash.some((c) => fitsCard(c.num, a.filter)) ? 0.9 * a.count : 0;
    case 'trashToBottom': return 0;
    case 'addDon': return Math.min(a.n, P.donDeck) * donWorth(s, p) * (a.state === 'active' && mine ? 1 : 0.7);
    case 'readyDon': return Math.min(a.n, P.donRested) * (mine ? 0.7 : 0.2);
    case 'giveDon': return a.from === 'opp' ? 0 : (mine && fieldTargets(s, p, a.target, self).some((u) => canAttackNow(s, p, findField(s, u)!.card)) ? 0.35 : 0.1) * a.n;
    case 'returnDon': return a.side === 'own' ? -0.8 * Math.min(a.n, donOnField(s, p)) : 0.8 * Math.min(a.n, donOnField(s, other(p)));
    case 'restDon': return a.side === 'own' ? -0.3 * a.n : (mine ? 0.3 : 0.1) * Math.min(a.n, O.donActive);
    case 'lifeFromDeck': return 1.2 * a.n;
    case 'lifeToHand': return a.side === 'own' ? (P.life.length > 2 ? 0.3 : -0.8) * a.n : 0.4 * a.n;
    case 'trashLife': return a.side === 'own' ? (a.upTo ? 0 : -1.5 * Math.min(a.n, P.life.length)) : 1.5 * Math.min(a.n, O.life.length);
    case 'lookLife': case 'reorderLife': case 'revealTop': case 'revealedToBottom': return 0.1;
    case 'handToBottom': return -0.4 * Math.min(a.n, P.hand.length);
    case 'oppHandToBottom': return 0.8 * Math.min(a.n, O.hand.length);
    case 'handToLife': return P.hand.some((c) => fitsCard(c.num, a.filter)) ? 0.6 * a.n : 0;
    case 'noLifeToHand': return -0.2;
    case 'noCharsThisTurn': return mine ? -0.8 : 0;
    case 'trashSelfEnd': return -(findField(s, self) ? Math.min(6, cardValue(s, self)) : 2) * 0.6;
    case 'playRevealed': return 0.8;
    case 'oppChooseOne': return a.options.length ? Math.min(...a.options.map((o) => stepsValue(s, p, o, ctx))) : 0;
    case 'manual': return 0.5;
  }
}

// ---------- Étapes, coûts, capacités ----------

export function stepsValue(s: GameState, p: PlayerId, steps: Step[], ctx: Ctx): number {
  const { self } = ctx;
  let total = 0;
  for (const st of steps) {
    let v: number;
    if ('action' in st) v = actionValue(s, p, st.action, ctx);
    else if ('chooseOne' in st) v = Math.max(0, ...st.chooseOne.map((o) => stepsValue(s, p, o, ctx)));
    else if ('may' in st) v = Math.max(0, stepsValue(s, p, st.may, ctx));
    else v = stepsValue(s, p, st.group, ctx);
    if (st.cond) v *= st.cond.kind === 'revealed' ? 0.5 : condChance(s, p, st.cond, self);
    if (st.link === 'ifYouDo' || st.link === 'ifNotYouDo') v *= 0.7;
    total += v;
  }
  return total;
}

export function costValue(s: GameState, p: PlayerId, cost: CostPart[], self: number): number {
  const P = s.players[p];
  const f = findField(s, self);
  const ownChars = (filter: Filter) => P.chars.filter((c) => c.uid !== self && fitsField(s, c.uid, filter)).map((c) => cardValue(s, c.uid)).sort((a, b) => a - b);
  let v = 0;
  for (const c of cost) {
    switch (c.kind) {
      case 'donMinus': v -= 0.4 * c.n; break;
      case 'restDon': v -= (s.active === p ? 0.3 : 0.05) * c.n; break;
      case 'restSelf': v -= f && canAttackNow(s, p, f.card) ? 1.2 : 0.2; break;
      case 'trashSelf': case 'selfToBottom': v -= f ? Math.min(8, cardValue(s, self)) : 1; break;
      case 'bounceSelf': v -= 0.8; break;
      case 'discard': v -= 0.8 * c.n; break;
      case 'trashTop': v -= 0.05 * c.n; break;
      case 'lifeToHand': v -= 0.4; break;
      case 'trashLife': v -= 1.5; break;
      case 'trashOwnChar': case 'koOwnChar': case 'bottomOwn': {
        const list = ownChars(c.filter);
        v -= list.length >= c.n ? list.slice(0, c.n).reduce((x, y) => x + Math.min(8, y), 0) : 5;
        break;
      }
      case 'returnOwnChar': v -= 0.5 * c.n; break;
      case 'restOwn': v -= 0.4 * c.n; break;
      case 'leaderPowerMinus': v -= canAttackNow(s, p, P.leader) ? 0.4 * c.n / 1000 : 0; break;
      case 'manual': v -= 0.5; break;
      default: break;
    }
  }
  return v;
}

// Valeur d'une capacité de la recette maintenant (coût compris ; 0 si ses verrous la ferment)
export function abilityValue(s: GameState, p: PlayerId, num: string, ab: Ability, self: number): number {
  if (ab.yourTurn && s.active !== p) return 0;
  if (ab.oppTurn && s.active === p) return 0;
  const f = findField(s, self);
  if (ab.don && f && f.card.don < ab.don) return 0;
  const chance = ab.condition ? condChance(s, p, ab.condition, self) : 1;
  if (!chance) return 0;
  const gain = stepsValue(s, p, ab.steps, { self, num, timing: ab.timing });
  // un coût facultatif ne se paie que si l'effet vaut plus que lui
  const cost = ab.cost ? costValue(s, p, ab.cost, self) : 0;
  return chance * (ab.cost ? Math.max(0, gain + cost) : gain);
}

// Valeur des capacités d'un moment de la carte (null : pas de recette, ou pas de capacité à ce moment)
export function timingValue(s: GameState, p: PlayerId, num: string, timing: Timing, self = -1): number | null {
  const list = abilitiesOf(num, timing);
  if (!list.length) return null;
  return list.reduce((sum, ab) => sum + abilityValue(s, p, num, ab, self), 0);
}

// Bilan d'un moment dont le coût n'est pas facultatif (activer, c'est payer : [Activation : Principale]) : gain + coût,
// même si le gain ne le vaut pas (null : pas de recette)
export function netValue(s: GameState, p: PlayerId, num: string, timing: Timing, self = -1): number | null {
  const list = abilitiesOf(num, timing);
  if (!list.length) return null;
  return list.reduce((sum, ab) => {
    const gain = abilityValue(s, p, num, { ...ab, cost: undefined }, self);
    return sum + gain + (ab.cost ? costValue(s, p, ab.cost, self) : 0);
  }, 0);
}

// Le meilleur bilan d'un coût facultatif de la carte (« Vous pouvez [coût] : [effet] ») : gain moins coût, sur ses
// capacités à coût (null : pas de recette ou pas de coût facultatif)
export function bestCostedNet(s: GameState, p: PlayerId, num: string, self: number): number | null {
  const r = recipeOf(num);
  if (!r) return null;
  const list = [...r.abilities, ...(r.trigger ? [r.trigger] : [])].filter((a) => a.cost?.length && a.timing !== 'activateMain');
  if (!list.length) return null;
  return Math.max(...list.map((ab) => abilityValue(s, p, num, { ...ab, cost: undefined }, self) + costValue(s, p, ab.cost!, self)));
}

// Le coût d'une capacité (pour savoir si elle épuise la carte, la sacrifie...)
export function abilityCost(num: string, timing: Timing): CostPart[] {
  return abilitiesOf(num, timing).flatMap((a) => a.cost ?? []);
}

// Sortes d'actions d'un moment (pour choisir quand l'utiliser)
export function actionKinds(num: string, timing: Timing): Set<Action['kind']> {
  const kinds = new Set<Action['kind']>();
  const walk = (steps: Step[]) => {
    for (const st of steps) {
      if ('action' in st) kinds.add(st.action.kind);
      else if ('chooseOne' in st) st.chooseOne.forEach(walk);
      else if ('may' in st) walk(st.may);
      else walk(st.group);
    }
  };
  for (const ab of abilitiesOf(num, timing)) walk(ab.steps);
  return kinds;
}

// ---------- [Contre] ----------

// Puissance qu'un Événement [Contre] (recette) apporte au combat en cours pour défendre `target` : bonus à la carte
// attaquée, malus à l'attaquant ; un retrait de l'attaquant arrête l'attaque (10000, comme l'IA simple). null : pas de
// recette de [Contre].
export function counterGain(s: GameState, p: PlayerId, num: string, target: number): number | null {
  const list = abilitiesOf(num, 'counter');
  if (!list.length) return null;
  const b = s.battle;
  let total = 0;
  const visit = (steps: Step[], ab: Ability) => {
    for (const st of steps) {
      if (st.cond && st.cond.kind !== 'revealed' && condChance(s, p, st.cond, -1) < 1) continue;
      if ('action' in st) {
        const a = st.action;
        const hits = (t: Target, uid: number | undefined) => uid !== undefined && fieldTargets(s, p, t, -1).includes(uid);
        if (a.kind === 'power' && a.amount > 0 && hits(a.target, target)) total += a.amount;
        else if (a.kind === 'power' && a.amount < 0 && b && hits(a.target, b.attacker)) total += -a.amount;
        else if ((a.kind === 'ko' || a.kind === 'bounce' || a.kind === 'bottom' || a.kind === 'trashChar') && b && hits(a.target, b.attacker)) total += 10000;
      } else if ('chooseOne' in st) {
        const before = total;
        let best = 0;
        for (const o of st.chooseOne) { total = 0; visit(o, ab); best = Math.max(best, total); }
        total = before + best;
      } else if ('may' in st) visit(st.may, ab);
      else visit(st.group, ab);
    }
  };
  for (const ab of list) {
    if (ab.condition && condChance(s, p, ab.condition, -1) < 1) continue;
    visit(ab.steps, ab);
  }
  return total;
}

// ---------- Choix pendant un effet ----------

// Les « Choisissez un » de la recette (et les « votre adversaire choisit »), chacun avec ses options, dans l'ordre de la recette
export function chooseOneLists(num: string, opp = false): Step[][][] {
  const r = recipeOf(num);
  if (!r) return [];
  const lists: Step[][][] = [];
  const walk = (steps: Step[]) => {
    for (const st of steps) {
      if ('action' in st) { if (opp && st.action.kind === 'oppChooseOne') lists.push(st.action.options); }
      else if ('chooseOne' in st) { if (!opp) lists.push(st.chooseOne); st.chooseOne.forEach(walk); }
      else if ('may' in st) walk(st.may);
      else walk(st.group);
    }
  };
  for (const ab of [...r.abilities, ...(r.trigger ? [r.trigger] : [])]) walk(ab.steps);
  return lists;
}

// Valeur de chaque option d'un choix (`ids` : choice:i), pour le joueur p, ou null si la recette n'a pas de choix qui convienne
export function choiceValues(s: GameState, p: PlayerId, num: string, ids: string[], self: number, opp = false): Map<string, number> | null {
  const index = ids.map((id) => Number(id.split(':')[1]));
  if (index.some((i) => !Number.isInteger(i))) return null;
  const list = chooseOneLists(num, opp).find((l) => l.length > Math.max(...index));
  if (!list) return null;
  const owner = opp ? other(p) : p;
  return new Map(ids.map((id, k) => [id, stepsValue(s, owner, list[index[k]], { self, num, timing: 'main' })]));
}

// Gain d'un retrait « coût N ou moins » qu'une carte de la main (recette, payable maintenant) ferait après un malus de coût
// de −k sur un Personnage adverse (Orlumbus OP04-079 prépare ainsi un KO)
export function costDropGain(s: GameState, p: PlayerId, k: number, budget: number): number {
  const P = s.players[p];
  let best = 0;
  for (const c of P.hand) {
    const d = def(c.num);
    if ((d.cost ?? 0) > budget) continue;
    const timing: Timing | null = d.category === 'EVENT' ? 'main' : d.category === 'CHARACTER' ? 'onPlay' : null;
    if (!timing) continue;
    const walk = (steps: Step[]) => {
      for (const st of steps) {
        if ('action' in st) {
          const a = st.action;
          if ((a.kind === 'ko' || a.kind === 'bounce' || a.kind === 'bottom' || a.kind === 'trashChar') && a.target.side !== 'own' && a.target.filter.costMax !== undefined) {
            const m = a.target.filter.costMax;
            for (const o of s.players[other(p)].chars) {
              const cost = fieldCost(s, o.uid);
              if (cost > m && cost - k <= m && fitsField(s, o.uid, { ...a.target.filter, costMax: undefined })) best = Math.max(best, Math.min(12, cardValue(s, o.uid)));
            }
          }
        } else if ('chooseOne' in st) st.chooseOne.forEach(walk);
        else if ('may' in st) walk(st.may);
        else walk(st.group);
      }
    };
    for (const ab of abilitiesOf(c.num, timing)) walk(ab.steps);
  }
  return best;
}
