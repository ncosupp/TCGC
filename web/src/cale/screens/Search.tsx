// Recherche globale, sous la loupe (maquette Recherche-style) : cartes, chasses et sets d'une seule saisie
import { useEffect, useMemo, useState } from 'react';
import { api, formatEur, type Card, type Hunt, type SetSummary } from '../../api';
import { useApp } from '../../store';
import { useCards } from '../../useCards';
import { tg } from '../i18n/search';
import { Cover, Icon, Row, Rows, SetCover, Slot, Switch, cardName, cx } from '../kit';
import './search.css';

type Tab = 'all' | 'cards' | 'hunts' | 'sets';
const TABS: Tab[] = ['all', 'cards', 'hunts', 'sets'];

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// « Chasse Leader alt. » : nom d'une chasse d'après ses critères (elle n'en a pas d'autre)
function huntName(h: Hunt) {
  const what = [
    h.rarity === 'L' ? tg('rarity.L') : h.rarity,
    h.kind ? tg(`kind.${h.kind}` as 'kind.alt') : '',
    h.color,
  ].filter(Boolean).join(' ') || tg('hunt.any');
  return tg('hunt.name', { what });
}

// Retour = page précédente, ou l'accueil s'il n'y en a pas
function back() {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = 'home';
}

function cardStatus(c: Card) {
  if (c.owned > 0) {
    const lang = c.ownedByLang.fr > 0 ? 'fr' : 'en';
    return { cls: 'sig deal', text: tg('status.owned', { n: c.ownedByLang[lang], lang: lang === 'fr' ? 'VF' : 'VO' }) };
  }
  if (c.wish) return { cls: 'sig target', text: tg('status.wish') };
  return { cls: 'row-m', text: tg('status.none') };
}

export function Search() {
  const { openCard, version, lang: cardLang } = useApp();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [missing, setMissing] = useState(false);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const { cards, total, loading, hasMore, loadMore } = useCards(
    { q: q.trim(), status: missing ? 'missing' : undefined, sort: 'number' }, { debounce: 300 });

  useEffect(() => {
    api.hunts().then(setHunts).catch(() => {});
    api.collectionSets(true).then(setSets).catch(() => {});
  }, [version]);

  const needle = norm(q.trim());
  const foundHunts = useMemo(() => (needle ? hunts.filter((h) => norm(huntName(h)).includes(needle)) : []), [hunts, needle]);
  const foundSets = useMemo(() => (needle ? sets.filter((s) => norm(`${s.code ?? ''} ${s.name}`).includes(needle)) : []), [sets, needle]);

  const counts: Record<Tab, number> = {
    all: total + foundHunts.length + foundSets.length, cards: total, hunts: foundHunts.length, sets: foundSets.length,
  };
  const showCards = tab === 'all' || tab === 'cards';
  const showHunts = (tab === 'all' || tab === 'hunts') && foundHunts.length > 0;
  const showSets = (tab === 'all' || tab === 'sets') && foundSets.length > 0;

  return (
    <div className="gs">
      <div className="topbar gs-bar">
        <label className="field focus gs-field">
          <Icon name="search" small />
          <input className="gs-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tg('placeholder')}
            aria-label={tg('field.label')} autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
        </label>
        <button type="button" className="link gs-cancel" onClick={back}>{tg('cancel')}</button>
      </div>
      <nav className="filters gs-filters" aria-label={tg('tabs.label')}>
        {TABS.map((id) => (
          <button key={id} type="button" className={tab === id ? 'f on' : 'f'} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {tg(`tab.${id}` as 'tab.all')} {counts[id]}
          </button>
        ))}
      </nav>
      <Rows className="gs-switch">
        <Row title={tg('missing')} trail={<Switch on={missing} onChange={setMissing} label={tg('missing')} />} />
      </Rows>

      {(showHunts || showSets) && (
        <section className="sec gs-sec">
          <p className="over">{tg('sec.huntsSets')}</p>
          <Rows>
            {showHunts && foundHunts.map((h) => (
              <Row key={`h${h.id}`} href={`#collection/hunt/${h.id}`}
                lead={<Cover cover={h.cover} lang={cardLang} className={cx('gs-mini', h.total > 0 && h.owned >= h.total && 'done')} />}
                title={huntName(h)} meta={tg('hunt.meta', { owned: h.owned, total: h.total })} />
            ))}
            {showSets && foundSets.map((s) => (
              <Row key={`s${s.id}`} href={`#collection/set/${s.id}`}
                lead={<SetCover set={s} lang={cardLang} className={cx('gs-mini', s.total > 0 && s.owned >= s.total && 'done')} />}
                title={s.code ? `${s.code} · ${s.name}` : s.name} meta={tg('set.meta', { owned: s.owned, total: s.total })} />
            ))}
          </Rows>
        </section>
      )}

      {showCards && (
        <section className="sec gs-sec">
          <p className="over">{tg('sec.cards', { n: total })}</p>
          <div>
            {cards.map((c) => {
              const st = cardStatus(c);
              const lang = c.ownedByLang.fr > 0 || c.ownedByLang.en === 0 ? 'fr' : 'en';
              return (
                <button key={c.id} type="button" className="row" onClick={() => openCard(c.id, lang)} aria-label={`${cardName(c, lang)} ${c.number}`}>
                  <Slot card={c} lang={lang} style={{ width: 36, flex: 'none' }} />
                  <span className="row-main">
                    <span className="row-t">{cardName(c, lang)}</span>
                    <span className="row-m"><span className="num">{c.number}</span> · {c.variant ?? c.rarity}</span>
                    <span className={st.cls}>{st.text}</span>
                  </span>
                  <span className="gs-price">{formatEur(c.price.eur)}</span>
                </button>
              );
            })}
          </div>
          {!cards.length && <p className="gs-note">{loading ? tg('searching') : tg('empty')}</p>}
          {hasMore && <button type="button" className="btn line gs-more" onClick={loadMore} disabled={loading}>{tg('more')}</button>}
        </section>
      )}
    </div>
  );
}
