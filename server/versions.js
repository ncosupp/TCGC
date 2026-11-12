// Versions des cartes. Le champ variant vient du nom TCGplayer, entre parenthèses ("Roronoa Zoro (001) (Parallel)",
// "Mr.3 (Galdino)", "Nami (Judge Pack Vol. 3)") : une vraie version (Alternate Art, SP, Manga...), un produit (promos,
// decks...) ou simplement une partie du nom (noms de code Baroque Works...). cardKind() le ramène à quelques genres,
// disponibles en SQL sous le nom card_kind(c.variant).
import { db } from './db.js';

// Parties du nom que TCGplayer écrit entre parenthèses comme une version : la carte reste une carte normale
const NAME_TOKENS = new Set([
  'Babe', 'Bentham', 'Brownbeard', 'Daz.Bonez', 'Drophy', 'Galdino', 'Gem', 'Grandma Nyon', 'Marianne', 'Mikita',
  'Navy', 'Zala',
]);

// normal : carte normale (ou réimpression à l'identique) ; alt : illustration alternative (Alternate Art, Parallel) ;
// sp, manga, fullart, foil ; other : tout le reste (promos d'événements, Box Topper, Dash Pack, Wanted Poster...)
export const CARD_KINDS = ['normal', 'alt', 'sp', 'manga', 'fullart', 'foil', 'other'];

export function cardKind(variant) {
  if (variant == null) return 'normal';
  const tokens = String(variant).split(' · ').filter((t) => !NAME_TOKENS.has(t));
  if (tokens.every((t) => t === 'Reprint')) return 'normal';
  if (tokens.some((t) => /\bManga\b/.test(t))) return 'manga';
  if (tokens.includes('SP')) return 'sp';
  if (tokens.some((t) => /Alternate Art|^Parallel$/.test(t))) return 'alt';
  if (tokens.includes('Full Art')) return 'fullart';
  if (tokens.some((t) => /Foil|Textured/.test(t))) return 'foil';
  return 'other';
}

db.function('card_kind', { deterministic: true }, cardKind);

// Filtre de version pour les recherches de cartes : un genre de CARD_KINDS, ou 'special' = toute version qui n'est
// pas normale ; toute autre valeur : pas de filtre. Le genre est vérifié avant d'entrer dans le SQL.
export function kindSql(kind) {
  if (kind === 'special') return `card_kind(c.variant) <> 'normal'`;
  if (CARD_KINDS.includes(kind)) return `card_kind(c.variant) = '${kind}'`;
  return null;
}

// Une même carte à compter une seule fois : les impressions normales d'un numéro (OP01-001 dans OP01, réimprimée
// dans un deck ou un PRB) sont une seule carte ; chaque version spéciale, et chaque DON!!, est une carte à part
export const ITEM_KEY_SQL = `CASE WHEN card_kind(c.variant) = 'normal' AND c.number GLOB '*-[0-9][0-9][0-9]'
  THEN 'n:' || c.number ELSE 'p:' || c.product_id END`;
