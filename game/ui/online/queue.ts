// File « Trouver un adversaire » dans la page (étape J, fiche 02-game-design-en-ligne.md § 1). La recherche continue
// quand on quitte l'écran (partie contre l'IA en attendant, accueil) : ce module la garde pour tout le jeu, la relance
// tant qu'on attend (la salle de file vit 15 minutes), et note l'adversaire trouvé pour le bandeau (QueueBanner.tsx).
// Gardée aussi dans la session de l'onglet : un rechargement reprend la recherche.
import { useSyncExternalStore } from 'react';
import { sfx } from '../sound.ts';
import { enterQueue, fetchView, leaveQueue } from './api.ts';

export interface QueueState {
  deck: string;
  room: string | null;       // ma salle de file, tant que j'attends
  since: number;             // début de la recherche (ms)
  found: string | null;      // la partie trouvée (à rejoindre)
  error: string | null;
}

const KEY = 'tcgc.game.queue';
const POLL_MS = 3000;
const RENEW_MS = 10 * 60_000;

let state: QueueState | null = read();
let timer: ReturnType<typeof setInterval> | null = null;
let renewedAt = 0;
const listeners = new Set<() => void>();

function read(): QueueState | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as QueueState | null;
    return v && typeof v.deck === 'string' ? v : null;
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

// L'adversaire est arrivé : son, vibration, notification si l'onglet est caché (et permise)
function announce(id: string) {
  set(state && { ...state, room: null, found: id, error: null });
  stopTimer();
  sfx('alert');
  try { navigator.vibrate?.([120, 80, 120]); } catch { /* sans vibreur */ }
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Joy Boy : adversaire trouvé !', { body: 'Ta partie en ligne commence : reviens dans le jeu.', tag: 'joyboy-queue' });
    }
  } catch { /* notifications indisponibles */ }
}

async function poll() {
  const s = state;
  if (!s || s.found || !s.room) return;
  try {
    const v = await fetchView(s.room);
    if (state?.room !== s.room) return;
    if (v.status === 'playing') announce(s.room);
    else if (v.status !== 'waiting' || Date.now() - renewedAt > RENEW_MS) await join(s.deck);
  } catch (e) {
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
    set({ deck, room: null, since: state?.since ?? Date.now(), found: r.id, error: null });
    announce(r.id);
    return;
  }
  set({ deck, room: r.id, since: state?.since ?? Date.now(), found: null, error: null });
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
