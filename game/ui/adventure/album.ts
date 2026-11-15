// Album des extensions du jeu (étape J, lot 2) : pour chaque extension dont on simule les boosters (OP03, OP04...), ce
// que la Cale en contient par rapport au total : cartes de base trouvées / total, par rareté, et versions spéciales
// (parallèles, SP, manga). Sert à la Cale (onglet Album), à la boutique (« il te manque N cartes ») et à l'ouverture des
// boosters (« OP03 : 23 → 31 / 154 »). Fonctions pures, testées par game/tests/album.test.ts.
import { BOOSTER_SETS } from '../../boosters/sets/index.ts';

export const ALBUM_RARITIES = ['L', 'C', 'UC', 'R', 'SR', 'SEC'] as const;
export type AlbumRarity = typeof ALBUM_RARITIES[number];

export interface AlbumSlot { number: string; rarity: AlbumRarity; owned: number }
export interface AlbumSpecial { number: string; variant: string; rarity: string; owned: boolean }

export interface AlbumSet {
  set: string;
  base: { have: number; total: number };
  byRarity: Record<AlbumRarity, { have: number; total: number }>;
  specials: { have: number; total: number };
  slots: AlbumSlot[];          // cartes de base dans l'ordre des numéros
  versions: AlbumSpecial[];    // versions spéciales
  missing: { total: number; sr: number; sec: number; r: number };
}

// owned : exemplaires par impression (« OP03-001 » pour la version de base, « OP03-001|parallele » pour une autre),
// comme ownedCounts de BoosterOpening
export function albumOf(set: string, owned: Record<string, number>): AlbumSet | null {
  const s = BOOSTER_SETS[set];
  if (!s) return null;
  // une carte « trouvée » : n'importe quelle version (une parallèle compte pour la carte)
  const anyVersion = new Map<string, number>();
  for (const [key, n] of Object.entries(owned)) {
    const number = key.split('|')[0];
    anyVersion.set(number, (anyVersion.get(number) ?? 0) + n);
  }
  const slots: AlbumSlot[] = [];
  const byRarity = Object.fromEntries(ALBUM_RARITIES.map((r) => [r, { have: 0, total: 0 }])) as AlbumSet['byRarity'];
  for (const rarity of ALBUM_RARITIES) {
    for (const number of s.cards[rarity] ?? []) {
      const n = anyVersion.get(number) ?? 0;
      slots.push({ number, rarity, owned: n });
      byRarity[rarity].total++;
      if (n > 0) byRarity[rarity].have++;
    }
  }
  slots.sort((a, b) => a.number.localeCompare(b.number));
  const seen = new Set<string>();
  const versions: AlbumSpecial[] = [];
  for (const v of s.hits.flatMap((h) => h.versions)) {
    const key = `${v.number}|${v.variant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    versions.push({ number: v.number, variant: v.variant, rarity: v.rarity, owned: (owned[key] ?? 0) > 0 });
  }
  const have = slots.filter((x) => x.owned > 0).length;
  const miss = (r: AlbumRarity) => byRarity[r].total - byRarity[r].have;
  return {
    set, base: { have, total: slots.length }, byRarity,
    specials: { have: versions.filter((v) => v.owned).length, total: versions.length },
    slots, versions,
    missing: { total: slots.length - have, sr: miss('SR'), sec: miss('SEC'), r: miss('R') },
  };
}

export const ALBUM_SETS = () => Object.keys(BOOSTER_SETS);

// « il te manque 131 cartes, dont 8 SR et 2 SEC »
export function missingText(a: AlbumSet): string {
  if (!a.missing.total) return 'Base complète !';
  const rare = [a.missing.sr && `${a.missing.sr} SR`, a.missing.sec && `${a.missing.sec} SEC`].filter(Boolean);
  return `Il te manque ${a.missing.total} carte${a.missing.total > 1 ? 's' : ''}${rare.length ? `, dont ${rare.join(' et ')}` : ''}`;
}

// L'extension où un booster a le plus de chances d'apporter une nouvelle carte : celle où il manque la plus grande part
// de la base (à égalité, la première)
export function bestToComplete(albums: AlbumSet[]): string | null {
  const open = albums.filter((a) => a.missing.total > 0);
  if (!open.length) return null;
  return open.reduce((best, a) => (a.missing.total / a.base.total > best.missing.total / best.base.total ? a : best)).set;
}
