// Échanges › Doubles (maquettes Doubles-style, Doubles-EN-style) : exemplaires au-delà de ceux qu'on garde,
// triés sur la valeur totale des doubles. Le nombre gardé se change dans les réglages (lien « Changer »).
import { useEffect, useMemo, useState } from 'react';
import { api, formatEur, type Doubles as DoublesData } from '../../api';
import { readPref, writePref } from '../../prefs';
import { useApp } from '../../store';
import { td } from '../i18n/doubles';
import { Slot } from '../kit';
import { TradesHeader } from './trades/TradesHeader';
import './doubles.css';

type Entry = DoublesData['cards'][number];
const extraValue = (c: Entry) => c.extra * (c.price.eur ?? 0);
const byNumber = (a: Entry, b: Entry) => a.number.localeCompare(b.number, 'en', { numeric: true }) || a.id - b.id;

const SORTS = {
  value: { label: 'sort.value', compare: (a: Entry, b: Entry) => extraValue(b) - extraValue(a) || byNumber(a, b) },
  extra: { label: 'sort.extra', compare: (a: Entry, b: Entry) => b.extra - a.extra || extraValue(b) - extraValue(a) },
  set: { label: 'sort.set', compare: (a: Entry, b: Entry) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || byNumber(a, b) },
} as const;
type Sort = keyof typeof SORTS;

export function Doubles() {
  const { version, openCard } = useApp();
  const [data, setData] = useState<DoublesData | null>(null);
  const [members, setMembers] = useState(0);
  const [sort, setSort] = useState<Sort>(() => readPref('tcgc.doublesSort', Object.keys(SORTS) as Sort[], 'value'));

  useEffect(() => {
    let cancelled = false;
    api.doubles().then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    api.trades().then((r) => { if (!cancelled) setMembers(r.settings.enabled ? r.matches.length : 0); }).catch(() => {});
    return () => { cancelled = true; };
  }, [version]);

  const cards = useMemo(() => (data ? [...data.cards].sort(SORTS[sort].compare) : []), [data, sort]);
  if (!data) return <><TradesHeader active="doubles" /><div className="cale-spinner" role="progressbar" aria-busy="true" /></>;

  return (
    <div className="du">
      <TradesHeader active="doubles" />
      <section className="du-head">
        {data.copies > 0 ? (
          <div className="du-big">
            <p className="display">{data.copies}</p>
            <p className="dim du-sum">{td('count.cards', { n: data.distinct })}<br />≈ <span className="du-val">{formatEur(data.valueEur)}</span></p>
          </div>
        ) : (
          <div>
            <h2 className="h">{td('empty.title')}</h2>
            <p className="dim du-empty">{td(data.keep === 1 ? 'empty.text' : 'empty.text.many', { n: data.keep })}</p>
          </div>
        )}
        <p className="dim du-keep">{td(data.keep === 1 ? 'keep' : 'keep.many', { n: data.keep })} <a href="#settings">{td('change')}</a></p>
        <div className="du-actions">
          <a className="btn line" href="#trades/share">{td('share')}</a>
          <a className="btn line" href="#trades/share">{td('members')}{members > 0 && <span className="du-gold"> · {members}</span>}</a>
        </div>
      </section>

      {cards.length > 0 && (
        <>
          <div className="filters du-filters" role="radiogroup" aria-label={td('sort.label')}>
            {Object.entries(SORTS).map(([value, { label }]) => (
              <button key={value} type="button" role="radio" aria-checked={sort === value} className={sort === value ? 'f on' : 'f'}
                onClick={() => { setSort(value as Sort); writePref('tcgc.doublesSort', value); }}>{td(label)}</button>
            ))}
          </div>
          <div className="du-list">
            {cards.map((c) => {
              const lang = c.entry?.lang ?? 'fr';
              return (
                <button key={`${c.id}-${lang}`} type="button" className="row" onClick={() => openCard(c.id, lang)}>
                  <Slot card={c} lang={lang} style={{ width: 36, flex: 'none' }} />
                  <span className="row-main">
                    <span className="row-t">{lang === 'fr' ? c.nameFr ?? c.name : c.name}</span>
                    <span className="row-m"><span className="num">{c.number}</span> · {td(lang === 'fr' ? 'lang.fr' : 'lang.en')}</span>
                  </span>
                  <span className="du-end">
                    <span>{formatEur(extraValue(c))}</span>
                    <small>+{c.extra} · {formatEur(c.price.eur)}{c.extra > 1 && ` ${td('each')}`}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
