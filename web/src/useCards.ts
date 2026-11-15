import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Card, type CardQuery } from './api';
import { useApp } from './store';

const PAGE = 60;

type Fetch = (query: CardQuery) => Promise<{ total: number; cards: Card[] }>;

// Liste paginée de cartes, rechargée quand les filtres ou la collection changent ; fetch : autre source que la
// recherche de cartes (cartes d'une chasse...), avec la même pagination.
// - « Afficher plus » ne demande que la page suivante (offset) et l'ajoute à la liste ;
// - une mise à jour de la collection (version) recharge les cartes déjà affichées, sans revenir à la première page ;
// - error : le dernier chargement a échoué (réseau coupé...) ; retry le relance.
export function useCards(query: CardQuery, { debounce = 0, pageSize = PAGE, fetch = api.cards as Fetch } = {}) {
  const { version } = useApp();
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reload, setReload] = useState(0);
  const key = JSON.stringify(query);
  const lastKey = useRef(key);
  // nombre de cartes affichées, et numéro du dernier chargement complet (une page suivante arrivée après un
  // rechargement est ignorée)
  const shown = useRef(0);
  const generation = useRef(0);
  // ce qui a échoué en dernier : tout le chargement, ou la page suivante
  const failed = useRef<'all' | 'more'>('all');
  const latest = useRef({ query, fetch, pageSize });
  latest.current = { query, fetch, pageSize };

  useEffect(() => {
    // Nouveaux filtres : on repart de la première page ; simple mise à jour de la collection : on garde ce qui est affiché
    const filtersChanged = lastKey.current !== key;
    lastKey.current = key;
    const count = filtersChanged ? pageSize : Math.max(pageSize, shown.current);
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      fetch({ ...query, limit: count, offset: 0 })
        .then((res) => {
          if (gen !== generation.current) return;
          shown.current = res.cards.length;
          setCards(res.cards);
          setTotal(res.total);
        })
        .catch((e: unknown) => {
          if (gen !== generation.current) return;
          failed.current = 'all';
          setError(e instanceof Error ? e : new Error(String(e)));
        })
        .finally(() => { if (gen === generation.current) setLoading(false); });
    }, filtersChanged ? debounce : 0);
    return () => { window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, reload]);

  // Page suivante : seulement les cartes d'après celles affichées
  const busy = useRef(false);
  const loadMore = useCallback(() => {
    if (busy.current) return;
    const { query: q, fetch: f, pageSize: size } = latest.current;
    const gen = generation.current;
    busy.current = true;
    setLoading(true);
    setError(null);
    f({ ...q, limit: size, offset: shown.current })
      .then((res) => {
        if (gen !== generation.current) return;
        setCards((old) => {
          const seen = new Set(old.map((c) => `${c.id}-${c.entry?.lang ?? ''}`));
          const next = [...old, ...res.cards.filter((c) => !seen.has(`${c.id}-${c.entry?.lang ?? ''}`))];
          shown.current = next.length;
          return next;
        });
        setTotal(res.total);
      })
      .catch((e: unknown) => {
        if (gen !== generation.current) return;
        failed.current = 'more';
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        busy.current = false;
        if (gen === generation.current) setLoading(false);
      });
  }, []);

  // Réessayer ce qui a échoué
  const retry = useCallback(() => {
    if (failed.current === 'more') loadMore();
    else setReload((n) => n + 1);
  }, [loadMore]);

  return {
    cards,
    total,
    loading,
    error,
    hasMore: cards.length < total,
    loadMore,
    retry,
  };
}
