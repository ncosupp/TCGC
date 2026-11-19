// Chrono d'OPTCGSim dans le plateau croisé (tâche O4.4) : dans une salle publique à minuteur, chaque joueur a 17 min 30
// pour toute la partie (pendule d'échecs tenue par l'hôte OPTCGSim) ; à 0, il perd. Le serveur n'envoie le chrono que
// quand celui qui tourne change (et au plus toutes les 10 s) : la page décompte elle-même depuis la réception.
import { useEffect, useMemo, useState } from 'react';
import type { CrossClock as Clock } from './crossplay.ts';

/** Sous 2 minutes, le chrono passe en alerte (comme dans OPTCGSim). */
export const CLOCK_LOW_S = 120;

/** « 17:30 », « 01:05 », « 00:00 » (secondes entamées comptées, comme une pendule). */
export function formatClock(seconds: number): string {
  const t = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Les deux temps à l'instant `now`, le chrono ayant été reçu à `receivedAt` (ms, horloge de la page). */
export function clockNow(c: Clock, receivedAt: number, now: number): { me: number; opponent: number } {
  const spent = c.running === null ? 0 : Math.max(0, (now - receivedAt) / 1000);
  return { me: Math.max(0, c.me - (c.running === 1 ? spent : 0)), opponent: Math.max(0, c.opponent - (c.running === 0 ? spent : 0)) };
}

export function CrossClocks({ clock, opponent }: { clock: Clock; opponent: string }) {
  // l'heure de réception : chaque vue reçue apporte un nouvel objet chrono
  const receivedAt = useMemo(() => Date.now(), [clock]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (clock.running === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [clock]);
  const t = clockNow(clock, receivedAt, Math.max(now, receivedAt));
  const one = (who: 'me' | 'opponent', label: string, title: string) => {
    const s = t[who];
    const running = clock.running === (who === 'me' ? 1 : 0);
    return (
      <span className={`op-cross-clock${running ? ' is-running' : ''}${s < CLOCK_LOW_S ? ' is-low' : ''}`} title={title} data-ui={`cross.clock-${who === 'me' ? 'me' : 'opp'}`}>
        <span className="op-cross-clock-who">{label}</span>
        <span className="op-cross-clock-time">{formatClock(s)}</span>
      </span>
    );
  };
  return (
    <span className="op-cross-clocks" role="group" aria-label="Chronos d’OPTCGSim : à 0, le joueur perd la partie">
      {one('me', 'Toi', 'Ton temps pour toute la partie (chrono d’OPTCGSim) : à 0, tu perds')}
      {one('opponent', opponent, `Temps de ${opponent} pour toute la partie : à 0, il perd`)}
    </span>
  );
}
