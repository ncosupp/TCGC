// Parties croisées avec un joueur OPTCGSim (tâche O3.1), côté navigateur : appels au serveur (server/game-crossplay.js)
// et flux temps réel de la vue du joueur. Comme une partie en ligne : le navigateur ne reçoit que sa vue et n'envoie que
// ses choix ; c'est le serveur qui parle au jeu OPTCGSim.
import { useEffect, useState } from 'react';
import type { GameState } from '../../engine/types.ts';
import { apiUrl, call } from '../api.ts';

// Vue envoyée par le serveur (SessionSnapshot de game/online/optcgsim/session.ts, recopiée ici : ce module-là tire le
// réseau de Node, qui n'a pas sa place dans la page)
export type CrossStatus = 'connecting' | 'setup' | 'playing' | 'over' | 'stopped';
export interface CrossEnd { kind: string; winner: 0 | 1 | null; resigned: 0 | 1 | null; reason: string; at: string }
export interface SessionSnapshot {
  status: CrossStatus;
  seq: number;
  state: GameState | null;
  opponent: { name: string; leader: string | null } | null;
  message: string | null;
  unknown: { seat: 0 | 1; code: string; count: number }[];
  end: CrossEnd | null;
}

export type CrossView = SessionSnapshot & {
  id: string;
  you: { name: string; deck: string; deckName: string };
  /** la partie rangée dans « Mes parties » (fin de partie), pour son gain */
  recordId: string | null;
};
export interface CurrentCross { id: string; status: CrossStatus; deck: string; deckName: string }

const enc = encodeURIComponent;
export const joinCross = (code: string, deck: string) => call<CrossView>('POST', 'crossplay', { code, deck });
export const currentCross = () => call<CurrentCross | null>('GET', 'crossplay/current');
export const fetchCross = (id: string) => call<CrossView>('GET', `crossplay/${enc(id)}`);
export const sendCrossChoice = (id: string, seq: number, choice: string) => call<{ ok: true; seq: number }>('POST', `crossplay/${enc(id)}/act`, { seq, choice });
export const resignCross = (id: string) => call<{ ok: true }>('POST', `crossplay/${enc(id)}/resign`, {});

// Préfixes des styles de salle d'OPTCGSim (game/online/optcgsim/handshake.json : P privée, W Western, E Eastern…)
export const ROOM_PREFIXES = 'PWEUXKAB';
export const CROSS_CODE_MAX = 12;

/** Code de salle OPTCGSim tel qu'on le tape ou qu'on le colle (« p 1a2-b3c » → « P1A2B3C ») : lettres et chiffres. */
export function cleanCrossCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CROSS_CODE_MAX);
}
/** Le code a la forme d'un code OPTCGSim : un préfixe connu et au moins 5 caractères. */
export const crossCodeOk = (code: string): boolean => code.length >= 5 && ROOM_PREFIXES.includes(code[0]);

/** Vue de la partie croisée, mise à jour en temps réel ; le navigateur se reconnecte tout seul après une coupure. */
export function useCross(id: string): { view: CrossView | null; connected: boolean; error: string | null; refresh: () => void } {
  const [view, setView] = useState<CrossView | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let closed = false;
    const source = new EventSource(apiUrl(`crossplay/${enc(id)}/events`));
    source.onopen = () => setConnected(true);
    source.onmessage = (e) => {
      if (closed) return;
      setError(null);
      setView(JSON.parse(e.data as string) as CrossView);
    };
    source.onerror = () => {
      setConnected(false);
      if (source.readyState === EventSource.CLOSED) {
        fetchCross(id).then((v) => { if (!closed) setView(v); }).catch((e: Error) => { if (!closed) setError(e.message); });
      }
    };
    return () => { closed = true; source.close(); };
  }, [id, tick]);
  return { view, connected, error, refresh: () => setTick((t) => t + 1) };
}
