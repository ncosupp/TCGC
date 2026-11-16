// Règles de « La table », l'éditeur de deck de la refonte du jeu (Refonte-UI-jeu, 01-maquettes-validees.md § 5),
// calculées sans navigateur ni serveur (game/tests/deck-table.test.ts) :
// - deux types de deck, un seul éditeur : libre (toutes les cartes que le jeu sait jouer) ou aventure (seulement les
//   cartes de la Cale, au plus min(4, exemplaires dans la Cale)) ;
// - Ranked : un deck est jouable en Ranked si chaque carte y figure en un nombre d'exemplaires ≤ à ceux de la Cale, et
//   s'il fait 50 cartes (un deck d'aventure l'est donc toujours une fois complet) ;
// - 8 piles par coût (0 à 7+), composition (catégories, contres), conseil de composition (seuils à valider par un
//   joueur compétitif).
import { CARDS, cardStatus, HIDDEN } from '../../engine/cards/index.ts';
import { anyNumber, DECK_SIZE, MAX_COPIES } from '../../engine/deckRules.ts';
import { def } from '../../engine/rules.ts';
import type { CardDef } from '../../engine/types.ts';

export type DeckKind = 'libre' | 'aventure';
export type Hold = Record<string, number>;

// Cartes que le jeu sait jouer (un deck ne peut contenir que celles-là)
export const playableNums = () => Object.keys(CARDS).filter((n) => n !== HIDDEN && cardStatus(n) !== 'todo');

// Carte permise avec ce Leader : toutes ses couleurs sur le Leader, et pas interdite par lui
export function fits(leader: string, num: string): boolean {
  const L = def(leader);
  const d = def(num);
  return d.category !== 'LEADER' && d.colors.length > 0 && d.colors.every((c) => L.colors.includes(c)) && !L.rules?.deckRestriction?.(d);
}

// Nom d'une copie : « (copie) » reste visible même quand le nom d'origine est long (40 caractères au plus)
export const copyName = (name: string) => `${name.slice(0, 32).trimEnd()} (copie)`;

export const deckTotal = (cards: Record<string, number>) => Object.values(cards).reduce((s, n) => s + n, 0);

// Exemplaires permis d'une carte : 4 (ou 50 pour « autant que tu veux »), et en aventure pas plus que la Cale n'en a
export function maxCopies(d: Pick<CardDef, 'number'> & Parameters<typeof anyNumber>[0], kind: DeckKind, hold: Hold | null): number {
  const base = anyNumber(d) ? DECK_SIZE : MAX_COPIES;
  return kind === 'aventure' ? Math.min(base, hold?.[d.number] ?? 0) : base;
}

// Peut-on poser un exemplaire de plus ? Sinon, pourquoi (le message est choisi par l'écran)
export type AddCheck = 'ok' | 'full' | 'max' | 'hold';
export function canAdd(cards: Record<string, number>, num: string, kind: DeckKind, hold: Hold | null): AddCheck {
  if (deckTotal(cards) >= DECK_SIZE) return 'full';
  const d = def(num);
  const have = cards[num] ?? 0;
  if (have < maxCopies(d, kind, hold)) return 'ok';
  return kind === 'aventure' && (hold?.[num] ?? 0) < (anyNumber(d) ? DECK_SIZE : MAX_COPIES) ? 'hold' : 'max';
}

// Pile d'une carte : son coût, de 0 à 7+ (un Événement sans coût va sur la pile 0)
export const pileOf = (cost: number | null | undefined) => Math.max(0, Math.min(7, cost ?? 0));
export const pileLabel = (k: number) => (k >= 7 ? '7+' : String(k));

// Réserve : les cartes proposées pour ce Leader (en aventure : seulement celles de la Cale), triées par coût puis nom
export function reservePool(leader: string, kind: DeckKind, hold: Hold | null, playable: string[] = playableNums()): string[] {
  return playable
    .filter((n) => fits(leader, n) && (kind === 'libre' || (hold?.[n] ?? 0) > 0))
    .sort((a, b) => (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0) || CARDS[a].name.localeCompare(CARDS[b].name) || a.localeCompare(b));
}

// Filtres de la réserve, qui se combinent : source (toutes ou la Cale), pile de coût, attribut (contre +1000, +2000,
// Événement), catégorie, nom (ou numéro), et « dans ma collection » (cartes réelles, deck libre)
export type Attr = 'c1' | 'c2' | 'e';
export interface ReserveFilter {
  source: 'all' | 'cale';
  cost: number | null;
  attr: Attr | null;
  category?: 'CHARACTER' | 'EVENT' | 'STAGE' | null;
  query?: string;
  owned?: Record<string, number> | null;   // collection réelle : seulement les cartes possédées
}

export function attrOf(num: string): Attr | null {
  const d = CARDS[num];
  if (d.category === 'EVENT') return 'e';
  return d.counter === 1000 ? 'c1' : d.counter === 2000 ? 'c2' : null;
}

export function filterReserve(pool: string[], f: ReserveFilter, hold: Hold | null): string[] {
  const text = (f.query ?? '').trim().toLowerCase();
  return pool.filter((n) => {
    const d = CARDS[n];
    if (f.source === 'cale' && !(hold?.[n])) return false;
    if (f.cost !== null && pileOf(d.cost) !== f.cost) return false;
    if (f.attr && attrOf(n) !== f.attr) return false;
    if (f.category && d.category !== f.category) return false;
    if (f.owned && !(f.owned[n] > 0)) return false;
    return !text || d.name.toLowerCase().includes(text) || d.names.some((x) => x.toLowerCase().includes(text)) || n.toLowerCase().includes(text);
  });
}

// Composition : courbe des coûts (8 piles), catégories, contres
export interface Composition {
  piles: number[];
  characters: number;
  events: number;
  stages: number;
  c1000: number;
  c2000: number;
  noCounter: number;   // Personnages sans contre
  total: number;
}

export function composition(cards: Record<string, number>): Composition {
  const c: Composition = { piles: [0, 0, 0, 0, 0, 0, 0, 0], characters: 0, events: 0, stages: 0, c1000: 0, c2000: 0, noCounter: 0, total: 0 };
  for (const [num, n] of Object.entries(cards)) {
    const d = CARDS[num];
    if (!d) continue;
    c.total += n;
    c.piles[pileOf(d.cost)] += n;
    if (d.category === 'EVENT') c.events += n;
    else if (d.category === 'STAGE') c.stages += n;
    else {
      c.characters += n;
      if (d.counter === 1000) c.c1000 += n;
      else if (d.counter === 2000) c.c2000 += n;
      else c.noCounter += n;
    }
  }
  return c;
}

// Conseil de composition (seuils de la maquette, à valider par un joueur compétitif)
export type Advice = { key: 'fewCounters'; n: number } | { key: 'heavy' } | { key: 'fewEarly' } | { key: 'balanced' };
export function advice(c: Composition): Advice {
  if (c.c2000 < 6 && c.total >= 20) return { key: 'fewCounters', n: c.c2000 };
  if (c.piles[5] + c.piles[6] + c.piles[7] > 10) return { key: 'heavy' };
  if (c.total >= 20 && c.piles[2] + c.piles[3] < 10) return { key: 'fewEarly' };
  return { key: 'balanced' };
}

// Exemplaires du deck qui ne sont pas dans la Cale (0 : chaque carte y est en assez d'exemplaires)
export function outOfHold(cards: Record<string, number>, hold: Hold | null): number {
  return Object.entries(cards).reduce((s, [num, n]) => s + Math.max(0, n - (hold?.[num] ?? 0)), 0);
}

// Jouable en Ranked : toutes ses cartes dans la Cale (Leader compris) et 50 cartes
export function rankedEligible(leader: string, cards: Record<string, number>, hold: Hold | null): boolean {
  return deckTotal(cards) === DECK_SIZE && outOfHold(cards, hold) === 0 && (hold?.[leader] ?? 0) > 0;
}

// Changer de Leader : les cartes d'une autre couleur (ou interdites par lui) quittent la table
export function keepForLeader(leader: string, cards: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(cards).filter(([n]) => fits(leader, n)));
}

// Leaders proposés : ceux que le jeu sait jouer ; en aventure, ceux de la Cale d'abord, les autres grisés après
export function leaderChoices(kind: DeckKind, hold: Hold | null, playable: string[] = playableNums()): { num: string; inHold: boolean }[] {
  return playable.filter((n) => CARDS[n].category === 'LEADER')
    .map((num) => ({ num, inHold: (hold?.[num] ?? 0) > 0 }))
    .sort((a, b) => (kind === 'aventure' ? Number(b.inHold) - Number(a.inHold) : 0)
      || CARDS[a.num].colors.join().localeCompare(CARDS[b.num].colors.join()) || CARDS[a.num].name.localeCompare(CARDS[b.num].name));
}
