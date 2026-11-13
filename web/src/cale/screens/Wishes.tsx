// Échanges › Recherches (maquette Recherches-style) : ma liste d'abord, puis « Pour finir tes classeurs »
// (petits prix par budget, bonnes affaires). Le budget et l'onglet sont des états locaux à la page.
import { useEffect, useMemo, useState } from 'react';
import { api, formatEur, formatPct, type Card, type Lang } from '../../api';
import { wishGap } from '../../components/WishBox';
import { readPref, writePref } from '../../prefs';
import { useApp } from '../../store';
import { tw } from '../i18n/wishes';
import { Icon, Slot } from '../kit';
import { TradesHeader } from './trades/TradesHeader';
import './wishes.css';

const byPrice = (a: Card, b: Card) => (a.price.eur ?? Infinity) - (b.price.eur ?? Infinity);
const gapOf = (card: Card) => wishGap(card)?.gap ?? Infinity;

const SORTS = {
  gap: { label: 'sort.gap', compare: (a: Card, b: Card) => gapOf(a) - gapOf(b) || byPrice(a, b) },
  'price-asc': { label: 'sort.priceAsc', compare: byPrice },
  price: { label: 'sort.price', compare: (a: Card, b: Card) => (b.price.eur ?? -1) - (a.price.eur ?? -1) },
  number: { label: 'sort.number', compare: (a: Card, b: Card) => a.number.localeCompare(b.number, 'en', { numeric: true }) || a.id - b.id },
  added: { label: 'sort.added', compare: (a: Card, b: Card) => (b.wish?.addedAt ?? '').localeCompare(a.wish?.addedAt ?? '') },
} as const;
type Sort = keyof typeof SORTS;
type Filter = 'all' | 'target' | 'fall';
type Finish = 'cheap' | 'deals';

const BUDGETS = [1, 5, 20] as const;
const WISH_PAGE = 6;
const FINISH_PAGE = 4;
const isFalling = (c: Card) => c.insight?.kind === 'falling' || c.insight?.kind === 'new-falling';
const cardLabel = (c: Card, lang: Lang) => (lang === 'fr' ? c.nameFr ?? c.name : c.name);

export function Wishes() {
  const { version, lang, openCard, toast, wishChanged } = useApp();
  const [data, setData] = useState<{ cards: Card[]; deals: Card[] } | null>(null);
  const [cheap, setCheap] = useState<Card[] | null>(null);
  const [sort, setSort] = useState<Sort>(() => readPref('tcgc.wishSort', Object.keys(SORTS) as Sort[], 'gap'));
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const [finish, setFinish] = useState<Finish>('cheap');
  const [budget, setBudget] = useState<(typeof BUDGETS)[number]>(1);
  const [showAllFinish, setShowAllFinish] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.wishlist().then((d) => { if (!cancelled) setData(d); }).catch(() => { if (!cancelled) setData({ cards: [], deals: [] }); });
    // Cartes manquantes les moins chères des sets commencés (le serveur n'a pas de liste toute prête)
    (async () => {
      try {
        const sets = (await api.collectionSets(false)).filter((s) => s.owned > 0).slice(0, 40);
        const pages = await Promise.all(sets.map((s) => api.cards({ set: String(s.id), status: 'missing', sort: 'price-asc', limit: 40 })
          .then((r) => r.cards).catch(() => [] as Card[])));
        const seen = new Set<number>();
        const all = pages.flat().filter((c) => c.price.eur != null && c.price.eur < BUDGETS[BUDGETS.length - 1] && !c.wish && !seen.has(c.id) && seen.add(c.id));
        if (!cancelled) setCheap(all.sort(byPrice));
      } catch { if (!cancelled) setCheap([]); }
    })();
    return () => { cancelled = true; };
  }, [version]);

  const wishes = useMemo(() => (data ? [...data.cards].sort(SORTS[sort].compare) : []), [data, sort]);
  const reached = wishes.filter((c) => wishGap(c)?.reached);
  const falling = wishes.filter(isFalling);
  const shown = filter === 'target' ? reached : filter === 'fall' ? falling : wishes;
  const total = wishes.reduce((sum, c) => sum + (c.price.eur ?? 0), 0);

  const inBudget = useMemo(() => (cheap ?? []).filter((c) => (c.price.eur ?? Infinity) < budget), [cheap, budget]);
  const finishList = finish === 'cheap' ? inBudget : data?.deals ?? [];
  const finishValue = finishList.reduce((sum, c) => sum + (c.price.eur ?? 0), 0);

  const follow = async (cards: Card[], message: string) => {
    setBusy(true);
    try {
      await Promise.all(cards.map((c) => api.wish(c.id, { lang })));
      wishChanged();
      toast(message);
    } catch (err) {
      toast((err as Error).message || tw('error'));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <><TradesHeader active="wishes" /><div className="cale-spinner" role="progressbar" aria-busy="true" /></>;

  const visible = showAll ? shown : shown.slice(0, WISH_PAGE);
  const finishVisible = showAllFinish ? finishList : finishList.slice(0, FINISH_PAGE);

  return (
    <div className="wi">
      <TradesHeader active="wishes" />

      {data.cards.length === 0 ? (
        <section className="wi-empty">
          <h2 className="h">{tw('empty.title')}</h2>
          <p className="dim">{tw('empty.text')}</p>
        </section>
      ) : (
        <>
          <section className="wi-summary">
            <p className="dim">{tw('summary', { n: data.cards.length, value: formatEur(total) })}</p>
          </section>
          <div className="filters wi-filters">
            <button type="button" className={filter === 'all' ? 'f on' : 'f'} onClick={() => setFilter('all')}>{tw('filter.all')}</button>
            <button type="button" className={filter === 'target' ? 'f on' : 'f'} onClick={() => setFilter('target')}>
              {tw('filter.target')}{reached.length > 0 && <> <span className="wi-n">{reached.length}</span></>}
            </button>
            <button type="button" className={filter === 'fall' ? 'f on' : 'f'} onClick={() => setFilter('fall')}>
              {tw('filter.fall')}{falling.length > 0 && <> <span className="wi-n">{falling.length}</span></>}
            </button>
            <span className="sp" />
            <label className="f wi-sort">
              {tw(SORTS[sort].label)} <Icon name="down" small />
              <select value={sort} aria-label={tw('sort.label')}
                onChange={(e) => { setSort(e.target.value as Sort); writePref('tcgc.wishSort', e.target.value); }}>
                {Object.entries(SORTS).map(([value, { label }]) => <option key={value} value={value}>{tw(label)}</option>)}
              </select>
            </label>
          </div>
          <div className="wi-list">
            {visible.map((c) => <WishRow key={c.id} card={c} onOpen={() => openCard(c.id, c.wish?.lang ?? lang)} />)}
            {shown.length > WISH_PAGE && !showAll && (
              <button type="button" className="link wi-more" onClick={() => setShowAll(true)}>{tw('more', { n: shown.length })}</button>
            )}
          </div>
        </>
      )}

      <section className="sec wi-finish">
        <div className="sec-h"><h2 className="h">{tw('finish.title')}</h2></div>
        <div className="wi-finish-tabs">
          <div className="caps" role="tablist" aria-label={tw('finish.tabs')}>
            {(['cheap', 'deals'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={finish === id} className={finish === id ? 'on' : undefined}
                onClick={() => { setFinish(id); setShowAllFinish(false); }}>{tw(id === 'cheap' ? 'finish.cheap' : 'finish.deals')}</button>
            ))}
          </div>
        </div>
        {finish === 'cheap' && (
          <div className="chips wi-budgets" role="group" aria-label={tw('budget.label')}>
            {BUDGETS.map((b) => {
              const n = (cheap ?? []).filter((c) => (c.price.eur ?? Infinity) < b).length;
              return (
                <button key={b} type="button" className={budget === b ? 'chip on' : 'chip'} aria-pressed={budget === b}
                  onClick={() => { setBudget(b); setShowAllFinish(false); }}>{tw(`budget.${b}`)}{cheap && n > 0 ? ` · ${n}` : ''}</button>
              );
            })}
          </div>
        )}
        <div className="wi-finish-list">
          {finishVisible.map((c) => (
            <div key={c.id} className="row">
              <button type="button" className="wi-open" onClick={() => openCard(c.id, lang)}>
                <Slot style={{ width: 36, flex: 'none' }}><span className="empty wi-no">{c.number.slice(-3)}</span></Slot>
                <span className="row-main">
                  <span className="row-t">{cardLabel(c, lang)}</span>
                  <span className="row-m"><span className="num">{c.number}</span> · {finish === 'deals' && c.insight?.change != null ? tw('row.vsAvg', { pct: formatPct(c.insight.change) }) : tw('row.empty')}</span>
                </span>
                <span className="wi-price">{formatEur(c.price.eur)}</span>
              </button>
              <button type="button" className="hit wi-star" disabled={busy} aria-label={tw('follow', { name: cardLabel(c, lang) })}
                onClick={() => follow([c], tw('followed'))}><Icon name="star" small /></button>
            </div>
          ))}
          {finishList.length === 0 && (finish === 'deals' || cheap) && <p className="dim wi-none">{tw(finish === 'cheap' ? 'cheap.empty' : 'deals.empty')}</p>}
          {finishList.length > FINISH_PAGE && !showAllFinish && (
            <button type="button" className="link wi-more" onClick={() => setShowAllFinish(true)}>{tw('more', { n: finishList.length })}</button>
          )}
        </div>
        {finishList.length > 0 && (
          <button type="button" className="btn line wi-all" disabled={busy}
            onClick={() => follow(finishList, tw('followedAll', { n: finishList.length }))}>
            {tw('followAll', { n: finishList.length, value: formatEur(finishValue) })}
          </button>
        )}
        <p className="dim wi-note">{tw(finish === 'cheap' ? 'cheap.note' : 'deals.note')}</p>
      </section>
    </div>
  );
}

function WishRow({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const shownLang = card.wish?.lang ?? 'fr';
  const sig = wishGap(card)?.reached ? 'target' : isFalling(card) ? 'fall' : null;
  return (
    <button type="button" className="row" onClick={onOpen}>
      <Slot card={card} lang={shownLang} style={{ width: 36, flex: 'none' }} />
      <span className="row-main">
        <span className="row-t">{cardLabel(card, shownLang)}</span>
        <span className="row-m"><span className="num">{card.number}</span> · {tw(shownLang === 'fr' ? 'lang.fr' : 'lang.en')}</span>
        {sig && <span className={`sig ${sig}`}>{tw(sig === 'target' ? 'sig.target' : 'sig.fall')}</span>}
      </span>
      <span className="wi-end">
        <span>{formatEur(card.price.eur)}</span>
        <small>{card.wish?.targetEur != null ? tw('row.target', { price: formatEur(card.wish.targetEur) }) : tw('row.noTarget')}</small>
      </span>
    </button>
  );
}
