// Logique du scanner qui ne dépend pas de l'affichage : session, version la plus probable, emplacement d'une carte
import { api, type Card, type Lang, type ScanResult } from '../../../api';

export type Candidate = ScanResult['candidates'][number];

// Un rangement de la session. at, fresh et nth manquent pour les entrées gardées par l'ancienne interface.
export interface SessionEntry {
  card: Card;
  quantity: number;
  lang: Lang;
  at?: number;
  // La carte n'était possédée dans aucune langue avant ce rangement : une nouvelle pochette
  fresh?: boolean;
  // Nombre d'exemplaires possédés après ce rangement
  nth?: number;
}

export const MAX_QTY = 99;
export const CARD_RATIO = 63 / 88; // largeur / hauteur d'une carte
// Si le meilleur résultat devance à peine une carte au visuel différent, la reconnaissance est incertaine
export const LOW_MARGIN = 0.015;

// Même clé que l'ancienne interface : la session survit à un changement d'onglet pendant une ouverture de boosters
const SESSION_KEY = 'tcgc.scanSession';
const AUTO_KEY = 'tcgc.scanAuto';

export function readSession(): { added: SessionEntry[]; paid: number | null } {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    if (stored && Array.isArray(stored.added)) return { added: stored.added, paid: typeof stored.paid === 'number' ? stored.paid : null };
  } catch { /* stockage indisponible ou illisible */ }
  return { added: [], paid: null };
}

export function writeSession(added: SessionEntry[], paid: number | null) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ added, paid })); } catch { /* stockage indisponible */ }
}

export function readAuto(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; }
}

export function writeAuto(on: boolean) {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
}

export const cameraSupported = () => Boolean(navigator.mediaDevices?.getUserMedia);

// Parmi plusieurs versions possibles, la plus probable est la plus courante : version standard, puis la moins chère
function mostCommon(entries: { c: Candidate; i: number }[]) {
  const sorted = [...entries].sort((a, b) =>
    Number(a.c.card.variant !== null) - Number(b.c.card.variant !== null)
    || (a.c.card.price.eur ?? Infinity) - (b.c.card.price.eur ?? Infinity));
  return sorted[0]?.i ?? 0;
}

// Après un scan : on ne départage que les versions au visuel identique au meilleur résultat
export function defaultChoice(result: ScanResult) {
  const twins = result.candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.sameArt);
  return twins.length < 2 ? 0 : mostCommon(twins);
}

// Après un code tapé : parmi les versions du premier code trouvé
export function defaultManualChoice(candidates: Candidate[]) {
  const number = candidates[0]?.card.number;
  return mostCommon(candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.card.number === number));
}

// Versions entre lesquelles l'utilisateur doit trancher après un scan : celles au même visuel que le meilleur résultat
export const scanVersions = (candidates: Candidate[]) => candidates.filter((c) => c.sameArt);

/* ---------- Où est rangée une carte ---------- */

export interface Location { setCode: string; page: number | null }

let setsCache: Promise<{ id: number; code: string | null; name: string }[]> | null = null;
const normalCache = new Map<number, Promise<Card[]>>();

const findSet = async (card: Card) => {
  setsCache ??= api.sets().catch((e) => { setsCache = null; throw e; });
  const sets = await setsCache;
  return sets.find((s) => s.code != null && s.code === card.setCode) ?? sets.find((s) => s.name === card.setName);
};

// Cartes normales d'un set dans l'ordre des numéros : c'est l'ordre des pochettes du classeur (Full set)
export function normalCards(setId: number, fresh = false) {
  if (fresh || !normalCache.has(setId)) {
    normalCache.set(setId, api.cards({ set: String(setId), kind: 'normal', sort: 'number', limit: 500 }).then((r) => r.cards));
  }
  return normalCache.get(setId)!;
}

// Page d'une carte normale : son rang dans le set trié par numéro, neuf pochettes par page. Une version spéciale
// (Master set) se range juste après sa carte normale : sa page n'est pas calculée ici (page: null).
export async function locate(card: Card): Promise<Location> {
  const setCode = card.setCode ?? card.setName;
  if (card.variant) return { setCode, page: null };
  try {
    const set = await findSet(card);
    if (!set) return { setCode, page: null };
    const rank = (await normalCards(set.id)).findIndex((c) => c.id === card.id);
    return { setCode, page: rank < 0 ? null : Math.floor(rank / 9) + 1 };
  } catch {
    return { setCode, page: null };
  }
}

export async function setIdOf(card: Card) {
  return (await findSet(card).catch(() => undefined))?.id;
}

// Nom d'une langue de carte : VF / VO dans l'interface française
export function langLabel(lang: Lang, ui: 'fr' | 'en') {
  return ui === 'fr' ? (lang === 'fr' ? 'VF' : 'VO') : lang.toUpperCase();
}
