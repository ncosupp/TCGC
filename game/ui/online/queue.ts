// File « Trouver un adversaire » dans la page (étape J, fiche 02-game-design-en-ligne.md § 1). La recherche continue
// quand on quitte l'écran (partie contre l'IA en attendant, accueil) : ce module la garde pour tout le jeu, la relance
// tant qu'on attend (la salle de file vit 15 minutes), et note l'adversaire trouvé pour le bandeau (QueueBanner.tsx).
// Gardée aussi dans la session de l'onglet : un rechargement reprend la recherche.
//
// Repli sur OPTCGSim (étape O4) : au bout de quelques secondes sans joueur joy-boy, le serveur cherche une salle publique
// d'OPTCGSim et la rejoint pour le joueur. Le module interroge l'état de la recherche (GET /api/game/queue, toutes les
// 3 s) en disant si le joueur est là (écran de recherche ou bandeau visibles, onglet au premier plan) : le repli n'est
// tenté que s'il l'est. Tant que le serveur n'a pas cette route (404), l'ancien suivi de la salle de file est gardé.
import { useEffect, useSyncExternalStore } from 'react';
import { ApiError } from '../api.ts';
import { sfx } from '../sound.ts';
import { enterQueue, fetchView, leaveQueue, queueStatus, type QueueStatus } from './api.ts';

export type QueuePhase = NonNullable<QueueStatus['phase']>;
/** La partie trouvée : en ligne contre un joueur joy-boy (#play/partie/<id>) ou contre un joueur OPTCGSim (#play/optcgsim/<id>). */
export interface QueueFound { kind: 'online' | 'optcgsim'; id: string }

export interface QueueState {
  deck: string;
  room: string | null;       // ma salle de file, tant que j'attends
  since: number;             // début de la recherche (ms)
  found: QueueFound | null;  // la partie trouvée (à rejoindre)
  error: string | null;
  phase?: QueuePhase | null; // où en est la recherche (absent : serveur sans repli OPTCGSim)
  phaseSince?: number;       // début de cette phase (ms)
  delaiMs?: number;          // délai avant le repli OPTCGSim (0 : pas de repli)
}

const KEY = 'tcgc.game.queue';
const POLL_MS = 3000;
const RENEW_MS = 10 * 60_000;

let state: QueueState | null = read();
let timer: ReturnType<typeof setInterval> | null = null;
let renewedAt = 0;
/** Le serveur n'a pas encore GET /api/game/queue (tâche O4.3 pas déployée) : ancien suivi par la vue de la salle. */
let legacy = false;
const listeners = new Set<() => void>();

function read(): QueueState | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as (Omit<QueueState, 'found'> & { found: QueueFound | string | null }) | null;
    if (!v || typeof v.deck !== 'string') return null;
    // avant O4.4, `found` était l'id d'une partie en ligne
    return { ...v, found: typeof v.found === 'string' ? { kind: 'online', id: v.found } : v.found ?? null };
  } catch {
    return null;
  }
}

function set(next: QueueState | null) {
  state = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch { /* stockage indisponible : la recherche vaut pour cette page */ }
  for (const l of listeners) l();
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- présence du joueur (repli OPTCGSim seulement s'il est là)

let presence = 0;
/** Le joueur voit la recherche (écran ou bandeau) et l'onglet est au premier plan. */
export function isPresent(): boolean {
  try {
    return presence > 0 && document.visibilityState === 'visible';
  } catch {
    return presence > 0;
  }
}
/** Tant que `on`, ce composant montre la recherche au joueur (écran « Trouver un adversaire », bandeau). */
export function useQueuePresence(on: boolean) {
  useEffect(() => {
    if (!on) return;
    presence++;
    return () => { presence--; };
  }, [on]);
}

// L'adversaire est arrivé : son, vibration, notification si l'onglet est caché (et permise)
function announce(found: QueueFound) {
  set(state && { ...state, room: null, found, error: null });
  stopTimer();
  sfx('alert');
  try { navigator.vibrate?.([120, 80, 120]); } catch { /* sans vibreur */ }
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const body = found.kind === 'optcgsim' ? 'Ta partie contre un joueur OPTCGSim commence : reviens dans le jeu.' : 'Ta partie en ligne commence : reviens dans le jeu.';
      new Notification('Joy Boy : adversaire trouvé !', { body, tag: 'joyboy-queue' });
    }
  } catch { /* notifications indisponibles */ }
}

// Ancien suivi (serveur sans GET /api/game/queue) : la vue de ma salle de file
async function legacyPoll(s: QueueState) {
  const v = await fetchView(s.room!);
  if (state?.room !== s.room) return;
  if (v.status === 'playing') announce({ kind: 'online', id: s.room! });
  else if (v.status !== 'waiting' || Date.now() - renewedAt > RENEW_MS) await join(s.deck);
}

/** Réponse du serveur à l'interrogation de la file. */
async function apply(s: QueueState, q: QueueStatus) {
  if (state !== s) return; // arrêtée ou relancée entre-temps
  if (q.status === 'matched' && q.id) { announce({ kind: 'online', id: q.id }); return; }
  if (q.status === 'optcgsim' && q.id) { announce({ kind: 'optcgsim', id: q.id }); return; }
  if (q.status === 'none') {
    // la salle de file n'existe plus (fermée par le serveur) : on n'en rouvre pas une d'office
    stopTimer();
    set(null);
    return;
  }
  const phase = q.phase ?? 'joyboy';
  set({ ...s, room: q.id ?? s.room, error: null, phase, delaiMs: q.delaiMs, phaseSince: phase === s.phase ? s.phaseSince ?? Date.now() : Date.now() });
  // la salle de file vit 15 min : renouvelée (pas pendant un essai OPTCGSim, où elle est mise de côté)
  if (phase !== 'optcgsim-connexion' && Date.now() - renewedAt > RENEW_MS) await join(s.deck);
}

async function poll() {
  const s = state;
  if (!s || s.found || !s.room) return;
  try {
    if (legacy) { await legacyPoll(s); return; }
    await apply(s, await queueStatus(isPresent()));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && !legacy) {
      legacy = true;
      await poll();
      return;
    }
    if (state) set({ ...state, error: message(e) });
  }
}

function startTimer() {
  if (timer) return;
  timer = setInterval(() => void poll(), POLL_MS);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function join(deck: string) {
  const r = await enterQueue(deck);
  renewedAt = Date.now();
  if (r.status === 'matched') {
    set({ deck, room: null, since: state?.since ?? Date.now(), found: { kind: 'online', id: r.id }, error: null });
    announce({ kind: 'online', id: r.id });
    return;
  }
  const prev = state;
  set({ ...prev, deck, room: r.id, since: prev?.since ?? Date.now(), found: null, error: null });
  startTimer();
}

// Commencer à chercher avec ce deck (une erreur du serveur, deck refusé par exemple, est renvoyée)
export async function startQueue(deck: string) {
  set({ deck, room: null, since: Date.now(), found: null, error: null });
  try {
    await join(deck);
  } catch (e) {
    set(null);
    throw e;
  }
  // une notification quand l'onglet est caché : demandée une fois, au moment où l'on commence à chercher
  try {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  } catch { /* notifications indisponibles */ }
}

export async function stopQueue() {
  stopTimer();
  const had = state?.room;
  set(null);
  if (had) await leaveQueue().catch(() => undefined);
}

// La partie trouvée est ouverte (ou refusée) : la recherche est finie
export const clearFound = () => set(null);

// reprise après un rechargement
if (state && !state.found) startTimer();

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useQueue = () => useSyncExternalStore(subscribe, () => state);

// « 1 min 05 »
export function waited(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
}

/** Au-delà, faute de salle OPTCGSim, la recherche le dit (« pas de salle ouverte pour l'instant »). */
export const NO_ROOM_AFTER_MS = 8000;

/**
 * Où en est la recherche, en mots : `title` (l'étape), `countdown` (secondes restantes de la recherche joy-boy avant le
 * repli), `note` (« pas de salle pour l'instant »), `optcgsim` (le repli OPTCGSim est en marche sur ce serveur).
 */
export function queueStep(q: QueueState, now: number): { title: string; countdown: number | null; note: string | null; optcgsim: boolean } {
  const optcgsim = Boolean(q.delaiMs && q.delaiMs > 0) || q.phase === 'optcgsim-recherche' || q.phase === 'optcgsim-connexion';
  const step = (title: string, countdown: number | null = null, note: string | null = null) => ({ title, countdown, note, optcgsim });
  if (q.phase === 'optcgsim-connexion') return step('Salle OPTCGSim trouvée : connexion…');
  if (q.phase === 'optcgsim-recherche') {
    const long = now - (q.phaseSince ?? now) >= NO_ROOM_AFTER_MS;
    return step('Recherche d’une salle OPTCGSim…', null, long ? 'Pas de salle OPTCGSim ouverte pour l’instant : on continue à chercher' : null);
  }
  if (q.phase === 'joyboy' && optcgsim) {
    const left = Math.ceil((q.delaiMs! - (now - q.since)) / 1000);
    return step('Recherche d’un joueur joy-boy…', left > 0 ? left : null);
  }
  return step('Recherche d’un adversaire…');
}
