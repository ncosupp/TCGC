// Progression du joueur dans la page (étape J) : prime, exploits et missions lus sur le serveur
// (server/game-progress.js), partagés entre l'accueil, le profil et l'écran de fin. Le serveur calcule tout ; la page
// ne fait que lire et demander la récupération d'une récompense.
import { useEffect, useSyncExternalStore } from 'react';
import type { ClaimResult, ExploitState, Progress } from '../../progress/catalog.ts';
import { call } from '../api.ts';
import { refreshWallet } from '../economy/Wallet.tsx';

let current: Progress | null = null;
let failure: string | null = null;
let pending: Promise<Progress | null> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

function show(p: Progress) {
  current = p;
  failure = null;
  notify();
  return p;
}

// Relit la progression (après une partie, l'ouverture d'un booster...) ; une seule lecture à la fois
export function refreshProgress(): Promise<Progress | null> {
  pending ??= call<Progress>('GET', 'progress').then(show, (e: unknown) => {
    failure = e instanceof Error ? e.message : String(e);
    notify();
    return null;
  }).finally(() => { pending = null; });
  return pending;
}

export const currentProgress = () => current;

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// La progression à afficher ; lue sur le serveur au premier affichage (puis à chaque refresh)
export function useProgress(): { progress: Progress | null; error: string | null } {
  const progress = useSyncExternalStore(subscribe, () => current);
  const error = useSyncExternalStore(subscribe, () => failure);
  useEffect(() => { void refreshProgress(); }, []);
  return { progress, error };
}

async function claim(path: string): Promise<ClaimResult> {
  const result = await call<ClaimResult>('POST', path);
  show(result.progress);
  if (result.berry) void refreshWallet();
  return result;
}

export const claimExploit = (id: string) => claim(`exploits/${encodeURIComponent(id)}/claim`);
export const claimMission = (id: string) => claim(`missions/${encodeURIComponent(id)}/claim`);

export async function saveProfile(change: { title?: string | null; leader?: string | null }): Promise<Progress> {
  return show(await call<Progress>('PUT', 'profile', change));
}

// Exploits obtenus entre deux lectures (toasts de fin de partie) : ceux qui sont faits maintenant et ne l'étaient pas
export function newlyDone(before: Progress | null, after: Progress | null): ExploitState[] {
  if (!before || !after) return [];
  const was = new Set(before.exploits.filter((e) => e.done).map((e) => e.id));
  return after.exploits.filter((e) => e.done && !was.has(e.id));
}
