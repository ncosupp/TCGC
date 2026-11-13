// Collection › Cartes : toutes tes cartes rangées comme dans un classeur (pages de 9 pochettes), avec recherche dans
// la collection et tri (prix, numéro, set, couleur...). Non dessiné : composé avec les briques du classeur d'un set.
import { useState } from 'react';
import { cardName, formatEur, type Card } from '../../api';
import { readPref, writePref } from '../../prefs';
import { useApp } from '../../store';
import { useCards } from '../../useCards';
import { tcards } from '../i18n/cards';
import { Binder, Icon, Pocket, Row, Rows, Sheet, Spinner, versionLabel } from '../kit';
import { CollectionHeader } from './hunts/shared';
import './cards.css';

const SORTS = ['price', 'price-asc', 'number', 'set', 'color', 'rarity', 'name', 'added'] as const;
type Sort = (typeof SORTS)[number];
const PER_PAGE = 9;
const LOAD = PER_PAGE * 7;

export function Cards() {
  const { openCard } = useApp();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>(() => readPref('tcgc.collectionSort', SORTS, 'price'));
  const [picking, setPicking] = useState(false);
  const { cards, total, loading, hasMore, loadMore } = useCards({ owned: true, q, sort }, { debounce: 250, pageSize: LOAD });

  const changeSort = (next: Sort) => { setSort(next); writePref('tcgc.collectionSort', next); setPicking(false); };

  const pages: Card[][] = [];
  for (let i = 0; i < cards.length; i += PER_PAGE) pages.push(cards.slice(i, i + PER_PAGE));

  return (
    <div className="ca">
      <CollectionHeader active="cards" />
      <section className="ca-tools">
        <label className="field ca-field">
          <Icon name="search" small />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tcards('search')}
            aria-label={tcards('search')} autoComplete="off" enterKeyHint="search" />
          {q && <button type="button" className="ca-clear" aria-label={tcards('clear')} onClick={() => setQ('')}><Icon name="close" small /></button>}
        </label>
        <div className="ca-bar">
          <span className="dim">{tcards('count', { n: total })}</span>
          <button type="button" className="link" aria-label={tcards('sort.aria', { sort: tcards(`sort.${sort}`) })} onClick={() => setPicking(true)}>
            {tcards(`sort.${sort}`)} <Icon name="down" small />
          </button>
        </div>
      </section>

      {loading && cards.length === 0 ? <Spinner /> : cards.length === 0 ? (
        <p className="dim ca-empty">{q.trim() ? tcards('none', { q: q.trim() }) : tcards('empty')}</p>
      ) : (
        <div className="ca-pages">
          {pages.map((page, i) => (
            <section key={i} className="ca-page" aria-label={tcards('page', { n: i + 1 })}>
              <p className="dim ca-pageno">{tcards('page', { n: i + 1 })}</p>
              <Binder>
                {page.map((c) => {
                  const lang = c.entry?.lang ?? 'en';
                  const qty = c.entry?.quantity ?? c.owned;
                  const tags = [c.variant ? versionLabel(c) : null, lang === 'en' ? tcards('vo') : null].filter(Boolean).join(' ');
                  return (
                    <Pocket key={`${c.id}-${lang}`} card={c} lang={lang} number={c.number} version={tags || undefined}
                      qty={qty} price={c.price.eur} onClick={() => openCard(c.id, lang)}
                      label={tcards('pocket', { name: cardName(c, lang), no: c.number, n: qty, price: formatEur(c.price.eur) })} />
                  );
                })}
              </Binder>
            </section>
          ))}
          {hasMore && (
            <button type="button" className="btn line ca-more" disabled={loading} onClick={loadMore}>
              {loading ? '…' : tcards('more', { n: total - cards.length })}
            </button>
          )}
        </div>
      )}

      <Sheet open={picking} onClose={() => setPicking(false)} label={tcards('sort')}>
        <h2 className="ca-sheet-t">{tcards('sort')}</h2>
        <Rows>
          {SORTS.map((s) => (
            <Row key={s} title={tcards(`sort.${s}`)} chevron={false} label={tcards(`sort.${s}`)}
              trail={s === sort ? <Icon name="check" small /> : undefined} onClick={() => changeSort(s)} />
          ))}
        </Rows>
      </Sheet>
    </div>
  );
}
