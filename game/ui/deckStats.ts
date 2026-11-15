// Statistiques par deck (étape J, fiche 02-game-design-en-ligne.md § 5) : victoires et défaites de chacun de mes
// decks, en ligne et contre l'IA, et le détail par Leader adverse. Calculées dans la page à partir de « Mes parties »
// (parties finies, hors entraînement depuis un moment revu) ; rien de nouveau sur le serveur.
import { useEffect, useState } from 'react';
import { playMode, type GameSummary } from '../coach/archive.ts';
import { loadSummaries } from './archiveClient.ts';
import { deckInfo } from './myDecks.ts';

export interface Record2 { wins: number; losses: number }
export interface DeckStats { online: Record2; ai: Record2; vs: Record<string, Record2> }

type Summary = Pick<GameSummary, 'status' | 'config' | 'practice' | 'mode'>;

export function deckStats(games: Summary[], leaderOf: (deck: string) => string | undefined = (d) => deckInfo(d)?.leader): Map<string, DeckStats> {
  const out = new Map<string, DeckStats>();
  for (const g of games) {
    if (g.practice || (g.status !== 'won' && g.status !== 'lost')) continue;
    const mine = g.config.myDeck;
    const s = out.get(mine) ?? { online: { wins: 0, losses: 0 }, ai: { wins: 0, losses: 0 }, vs: {} };
    const line = playMode(g) === 'online' ? s.online : s.ai;
    const won = g.status === 'won';
    if (won) line.wins++;
    else line.losses++;
    const leader = leaderOf(g.config.aiDeck) ?? '?';
    const vs = s.vs[leader] ?? { wins: 0, losses: 0 };
    if (won) vs.wins++;
    else vs.losses++;
    s.vs[leader] = vs;
    out.set(mine, s);
  }
  return out;
}

// « 7 V · 3 D en ligne · 12 V · 5 D contre l'IA »
export function statsText(s: DeckStats | undefined): string {
  if (!s) return 'Pas encore joué';
  const part = (r: Record2, where: string) => (r.wins + r.losses ? `${r.wins} V · ${r.losses} D ${where}` : '');
  return [part(s.online, 'en ligne'), part(s.ai, 'contre l’IA')].filter(Boolean).join(' · ') || 'Pas encore joué';
}

export function useDeckStats(): Map<string, DeckStats> | null {
  const [stats, setStats] = useState<Map<string, DeckStats> | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSummaries().then((list) => { if (!cancelled) setStats(deckStats(list)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return stats;
}
