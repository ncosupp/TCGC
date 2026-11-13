// Où se range la carte (set, page, pochette) et quelles chasses elle fait avancer
import { useEffect, useState } from 'react';
import { api, type Card, type Hunt } from '../../../api';

export interface Spot { setId: number; master: boolean; page: number; pocket: number; nextToNormal: boolean }

let setsCache: Promise<{ id: number; code: string | null }[]> | null = null;
const sets = () => (setsCache ??= api.sets().catch((e) => { setsCache = null; throw e; }));

// Genre de version d'une carte, comme server/versions.js (cardKind)
export function kindOf(variant: string | null): 'normal' | 'alt' | 'sp' | 'manga' | 'fullart' | 'foil' | 'other' {
  if (variant == null) return 'normal';
  const tokens = variant.split(' · ');
  if (tokens.every((t) => t === 'Reprint')) return 'normal';
  if (tokens.some((t) => /\bManga\b/.test(t))) return 'manga';
  if (tokens.includes('SP')) return 'sp';
  if (tokens.some((t) => /Alternate Art|^Parallel$/.test(t))) return 'alt';
  if (tokens.includes('Full Art')) return 'fullart';
  if (tokens.some((t) => /Foil|Textured/.test(t))) return 'foil';
  return 'other';
}

// Pochette = rang de la carte dans son set trié par numéro : parmi les cartes normales (Full set) ou, pour une
// version spéciale, parmi toutes les cartes (Master set, la version suit la normale)
async function findSpot(card: Card): Promise<Spot | null> {
  if (!card.setCode) return null;
  const set = (await sets()).find((s) => s.code === card.setCode);
  if (!set) return null;
  const master = kindOf(card.variant) !== 'normal';
  const { cards } = await api.cards({ set: String(set.id), sort: 'number', limit: 500, ...(master ? {} : { kind: 'normal' as const }) });
  const rank = cards.findIndex((c) => c.id === card.id);
  if (rank < 0) return null;
  const nextToNormal = master && cards.some((c) => c.number === card.number && kindOf(c.variant) === 'normal');
  return { setId: set.id, master, page: Math.floor(rank / 9) + 1, pocket: (rank % 9) + 1, nextToNormal };
}

export function matchesHunt(h: Hunt, card: Card) {
  const kind = kindOf(card.variant);
  return (h.rarity === '' || h.rarity === card.rarity)
    && (h.kind === '' || h.kind === kind || (h.kind === 'special' && kind !== 'normal'))
    && (h.color === '' || (card.color ?? '').toLowerCase().includes(h.color.toLowerCase()));
}

export function useSpot(card: Card | null, version: number) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const id = card?.id;
  useEffect(() => {
    if (!card) { setSpot(null); return; }
    let cancelled = false;
    findSpot(card).then((s) => { if (!cancelled) setSpot(s); }).catch(() => { if (!cancelled) setSpot(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!card) { setHunts([]); return; }
    let cancelled = false;
    api.hunts().then((h) => { if (!cancelled) setHunts(h.filter((x) => matchesHunt(x, card))); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);
  return { spot, hunts };
}
