// Enregistrement d'un deck sur « La table » : automatique, un instant après la dernière modification (comme l'ancien
// éditeur), pour ne jamais perdre une carte posée. Un deck neuf n'est enregistré qu'à sa première carte (pas de deck
// vide oublié). Ce qui reste à envoyer part tout de suite quand la page passe en arrière-plan ou que l'écran se ferme ;
// saveNow() l'envoie et attend la réponse (bouton Enregistrer, retour à Mes decks).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeckLooks } from '../../../../game/data/looks.ts';
import { saveMyDeck } from '../../../../game/ui/myDecks.ts';
import type { DeckKind } from '../../../../game/ui/builder/table.ts';

export interface Draft { id: string; name: string; leader: string; cards: Record<string, number>; looks?: DeckLooks }
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export function useAutosave(draft: Draft, kind: DeckKind, existing: boolean) {
  const [status, setStatusState] = useState<SaveStatus>(existing ? 'saved' : 'pending');
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef(status);
  const setStatus = (s: SaveStatus) => { statusRef.current = s; setStatusState(s); };
  const stored = useRef(existing);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<(() => void) | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  const send = useCallback((d: Draft): Promise<boolean> => {
    pending.current = null;
    setStatus('saving');
    const p = saveMyDeck({ ...d, name: d.name.trim(), ...(kind === 'aventure' ? { mode: 'aventure' as const } : {}) }).then(
      () => { stored.current = true; if (inflight.current === p) { setStatus('saved'); setError(null); } return true; },
      (e: Error) => { if (inflight.current === p) { setStatus('error'); setError(e.message); } return false; },
    );
    inflight.current = p;
    return p;
  }, [kind]);

  // le deck tel qu'ouvert : rien à enregistrer tant qu'il n'a pas changé (le double rendu de React en développement
  // rejoue l'effet)
  const opened = useRef(draft);
  useEffect(() => {
    clearTimeout(timer.current);
    pending.current = null;
    if (existing && draft === opened.current) return;
    if (!draft.name.trim()) { setStatus('error'); setError(null); return; }
    if (!stored.current && !Object.keys(draft.cards).length) { setStatus('pending'); return; }
    setStatus('pending');
    const run = () => { void send(draft); };
    pending.current = run;
    timer.current = setTimeout(run, 700);
    return () => clearTimeout(timer.current);
  }, [draft, send, existing]);

  // la page passe en arrière-plan, ou l'écran se ferme : ce qui attend part tout de suite
  useEffect(() => {
    const flush = () => { clearTimeout(timer.current); pending.current?.(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flush(); };
  }, []);

  // Envoie tout de suite ce qui attend (ou le deck entier : force) et dit si le deck est enregistré
  const saveNow = useCallback(async (force = false): Promise<boolean> => {
    clearTimeout(timer.current);
    const d = latest.current;
    if (!d.name.trim()) return false;
    if (force || pending.current) return send(d);
    if (inflight.current && statusRef.current === 'saving') return inflight.current;
    return statusRef.current !== 'error';
  }, [send]);

  // Il y a quelque chose à perdre : un deck neuf vide, jamais enregistré, n'a rien
  const atRisk = () => stored.current || Object.keys(latest.current.cards).length > 0;

  return { status, error, saveNow, atRisk, stored };
}
