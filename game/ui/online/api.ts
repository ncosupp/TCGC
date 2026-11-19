// Parties en ligne, côté navigateur : appels au serveur et flux temps réel (EventSource) de la vue du joueur.
// Le navigateur ne reçoit que sa vue de la partie (le serveur garde l'état complet) et n'envoie que ses choix.
import { useEffect, useState } from 'react';
import type { MatchView, OpenRoom, Reaction } from '../../online/match.ts';
import { ApiError, apiUrl, call as api } from '../api.ts';

// reaction : la dernière réaction de la partie (n augmente à chaque nouvelle)
export type LiveView = MatchView & { opponentOnline: boolean; reaction?: { seat: 0 | 1; reaction: Reaction; n: number } };

export interface CurrentMatch {
  id: string;
  status: 'waiting' | 'playing';
  code: string | null;
  opponent: string | null;
  deck: string;
  deckName?: string | null;
  hold?: boolean;    // deck d'aventure
  queue?: boolean;   // salle de la file « Trouver un adversaire »
}

// Ancien nom de l'erreur des appels (avant le client unique game/ui/api.ts) : toute ApiError en est une
export class OnlineError extends ApiError {
  constructor(code: string, message: string, status: number) {
    super({ status, code, message });
  }

  static [Symbol.hasInstance](e: unknown) {
    return e instanceof ApiError;
  }
}

// Routes /api/game/matches... : GET sans corps, POST avec
const call = <T>(path: string, body?: unknown) => api<T>(body === undefined ? 'GET' : 'POST', `matches${path}`, body);

export const createRoom = (deck: string, isPublic = false) => call<MatchView>('', { deck, ...(isPublic ? { public: true } : {}) });
export const openRooms = () => call<OpenRoom[]>('/open');
export const joinRoom = (code: string, deck: string) => call<MatchView>('/join', { code, deck });
export const currentMatches = () => call<CurrentMatch[]>('/current');
export const fetchView = (id: string) => call<LiveView>(`/${encodeURIComponent(id)}`);
export const sendChoice = (id: string, seq: number, choice: string) => call<{ ok: true; seq: number }>(`/${encodeURIComponent(id)}/act`, { seq, choice });
export const resignMatch = (id: string) => call<{ ok: true }>(`/${encodeURIComponent(id)}/resign`, {});
export const askRematch = (id: string) => call<{ ok: true; next: string | null }>(`/${encodeURIComponent(id)}/rematch`, {});
export const sendReaction = (id: string, reaction: Reaction) => call<{ ok: true }>(`/${encodeURIComponent(id)}/react`, { reaction });

// File « Trouver un adversaire » (étape J)
export type QueueEntry = { status: 'matched'; id: string } | { status: 'waiting'; id: string; since: string };
export const enterQueue = (deck: string) => api<QueueEntry>('POST', 'queue', { deck });
export const leaveQueue = () => api<{ ok: true }>('DELETE', 'queue');
// État de ma recherche (tâche O4.3, repli sur les salles publiques d'OPTCGSim), interrogé toutes les 3 s ; `present` : le
// joueur voit l'écran de recherche ou le bandeau, onglet au premier plan (le repli OPTCGSim n'est tenté que s'il est là).
// `matched` : id = partie joy-boy ; `optcgsim` : id = partie croisée ; `none` : pas en file. `delaiMs` : délai avant le
// repli (décompte de la recherche joy-boy).
export interface QueueStatus {
  status: 'waiting' | 'matched' | 'optcgsim' | 'none';
  id: string | null;
  since: string | null;
  phase: 'joyboy' | 'optcgsim-recherche' | 'optcgsim-connexion' | null;
  delaiMs: number;
}
export const queueStatus = (present: boolean) => api<QueueStatus>('GET', `queue?present=${present ? 1 : 0}`);
export const queueStats = () => api<{ today: number; waiting: number }>('GET', 'queue/stats');

export const cancelRoom = (id: string) => call<{ ok: true }>(`/${encodeURIComponent(id)}/cancel`, {});

// Vue de la partie, mise à jour en temps réel. Le navigateur se reconnecte tout seul après une coupure (réseau, mise en
// veille du téléphone, redémarrage du serveur) ; connected dit si le flux est ouvert.
export function useMatch(id: string): { view: LiveView | null; connected: boolean; error: string | null; refresh: () => void } {
  const [view, setView] = useState<LiveView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let closed = false;
    const source = new EventSource(apiUrl(`matches/${encodeURIComponent(id)}/events`));
    source.onopen = () => setConnected(true);
    source.onmessage = (e) => {
      if (closed) return;
      setError(null);
      setView(JSON.parse(e.data as string) as LiveView);
    };
    source.onerror = () => {
      setConnected(false);
      // partie introuvable ou session perdue : le flux ne se reconnectera pas, on interroge le serveur pour savoir pourquoi
      if (source.readyState === EventSource.CLOSED) {
        fetchView(id).then((v) => { if (!closed) setView(v); }).catch((e: Error) => { if (!closed) setError(e.message); });
      }
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [id, tick]);
  return { view, connected, error, refresh: () => setTick((t) => t + 1) };
}
