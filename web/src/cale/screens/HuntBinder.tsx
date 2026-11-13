// Page d'une chasse (maquette Chasse-style) : un classeur multi-sets, paliers 10 / 25 / 50 %, cartes « à venir »
import { useEffect, useState } from 'react';
import { api, cardName, type Card, type Hunt } from '../../api';
import { t } from '../../i18n';
import { useApp } from '../../store';
import { th } from '../i18n/hunts';
import { Binder, Icon, Meter, Sheet, Slot, Spinner } from '../kit';
import { eur0, HUNT_PAGE_SIZE, huntKicker, huntTitle, MILESTONES, pagesOf, useNextMilestone } from './hunts/shared';
import { formatEur } from '../../api';
import './hunts.css';

type Filter = 'all' | 'owned' | 'missing';
const FILTERS: Filter[] = ['all', 'owned', 'missing'];

export function HuntBinder({ huntId }: { huntId: number }) {
  const { version, lang, toast, wishChanged, openCard } = useApp();
  const [hunt, setHunt] = useState<Hunt | null>(null);
  const [gone, setGone] = useState(false);
  const [filter, setFilter] = useState<Filter>('missing');
  const [cheap, setCheap] = useState(true);
  const [page, setPage] = useState(1);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [total, setTotal] = useState(0);
  const [menu, setMenu] = useState(false);
  const [wishing, setWishing] = useState(false);
  const next = useNextMilestone(hunt);

  useEffect(() => {
    let cancelled = false;
    api.hunt(huntId).then((h) => { if (!cancelled) setHunt(h); }).catch(() => { if (!cancelled) setGone(true); });
    return () => { cancelled = true; };
  }, [huntId, version]);

  useEffect(() => {
    let cancelled = false;
    api.huntCards(huntId, {
      status: filter === 'all' ? undefined : filter, sort: cheap ? 'price-asc' : 'set', limit: HUNT_PAGE_SIZE, offset: (page - 1) * HUNT_PAGE_SIZE,
    }).then((r) => { if (!cancelled) { setCards(r.cards); setTotal(r.total); } }).catch(() => {});
    return () => { cancelled = true; };
  }, [huntId, filter, cheap, page, version]);

  const pages = pagesOf(total);
  const goPage = (n: number) => { setPage(n); };

  const follow = async () => {
    setWishing(true);
    try {
      const { added } = await api.wishHunt(huntId, lang);
      wishChanged();
      toast(t('set.wishedMissing', { n: added }));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setWishing(false);
    }
  };

  const remove = async () => {
    if (!hunt || !window.confirm(t('hunts.deleteConfirm', { name: huntTitle(hunt) }))) return;
    try {
      await api.deleteHunt(huntId);
      toast(t('hunts.deleted'));
      window.location.hash = 'collection/hunts';
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const back = (
    <a className="hit" href="#collection/hunts" aria-label={th('bind.back')}><Icon name="back" /></a>
  );

  if (gone) {
    return <div className="hu">
      <div className="topbar">{back}</div>
      <p className="dim hu-pad">{th('bind.missing')}</p>
    </div>;
  }

  const ratio = hunt ? hunt.owned / Math.max(1, hunt.total) : 0;
  const done = !!hunt && hunt.total > 0 && hunt.owned >= hunt.total;

  return (
    <div className="hu">
      <div className="topbar">
        {back}
        <span className="sp" />
        <button type="button" className="hit" aria-label={th('bind.more')} onClick={() => setMenu(true)}><Icon name="more" /></button>
      </div>

      {!hunt ? <Spinner /> : (
        <section className="hu-head">
          <p className="over">{th('bind.kicker', { kicker: huntKicker(hunt) })}</p>
          <h1 className="title hu-title">{huntTitle(hunt)}</h1>
          <div className="hu-big">
            <p className="display">{hunt.owned}</p>
            <p className="dim hu-big-s"><b>{th('bind.of', { total: hunt.total })}</b><br />{th('bind.cards', { pages: pagesOf(hunt.total) })}</p>
          </div>
          <div className="hu-ticks hu-ticks-big">
            <Meter ratio={ratio} />
            {MILESTONES.map((p) => <b key={p} style={{ left: `${p}%` }} />)}
          </div>
          <div className="hu-ms" aria-hidden="true">
            <span style={{ left: 0 }}>0</span>
            {MILESTONES.map((p) => <span key={p} style={{ left: `${p}%` }}>{p} %</span>)}
            <span style={{ left: '100%' }}>100 %</span>
          </div>
          {done ? (
            <div className="row hu-next-row"><span className="row-main"><span className="row-t">{th('bind.done')}</span></span></div>
          ) : next && (
            <button type="button" className="row hu-next-row" onClick={follow} disabled={wishing}>
              <span className="row-main">
                <span className="row-t">{next.pct === MILESTONES[0] ? th('bind.first', { n: th('palier.cards', { n: next.n }) }) : th('bind.next', { pct: next.pct, n: th('palier.cards', { n: next.n }) })}</span>
                <span className="row-m">
                  {next.eur != null ? th('bind.nextMeta', { cheap: eur0(next.eur), all: eur0(hunt.missingEur) }) : th('bind.nextMetaNoPrice', { all: eur0(hunt.missingEur) })}
                </span>
              </span>
              <span className="link hu-follow">{th('bind.follow')}</span>
            </button>
          )}
        </section>
      )}

      <div className="filters hu-filters" role="group" aria-label={th('bind.filters')}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className={filter === f ? 'f on' : 'f'} aria-pressed={filter === f}
            onClick={() => { setFilter(f); setPage(1); }}>{th(`bind.f.${f}`)}</button>
        ))}
        <span className="sp" />
        <button type="button" className={cheap ? 'f on' : 'f'} aria-pressed={cheap} onClick={() => { setCheap(!cheap); setPage(1); }}>{th('bind.sort.cheap')}</button>
      </div>

      <div className="hu-pagebar">
        <p><b>{th('bind.page', { n: page })}</b> <span className="dim">{cheap ? th('bind.page.cheap') : th('bind.page.set')}</span></p>
        <span className="hu-pagebtns">
          {page > 1 && <button type="button" className="hit" aria-label={th('bind.prev')} onClick={() => goPage(page - 1)}><Icon name="back" /></button>}
          {page < pages && <button type="button" className="hit" aria-label={th('bind.next.page')} onClick={() => goPage(page + 1)}><Icon name="next" /></button>}
        </span>
      </div>

      {!cards ? <Spinner /> : cards.length === 0 ? <p className="dim hu-pad">{th('bind.empty')}</p> : (
        <Binder className="hu-binder">
          {cards.map((c) => <HuntPocket key={c.id} card={c} lang={lang} onOpen={() => openCard(c.id, c.entry?.lang)} />)}
        </Binder>
      )}
      <p className="dim hu-note">{th('bind.pendingNote')}</p>

      <Sheet open={menu} onClose={() => setMenu(false)} label={th('bind.menu')}>
        <button type="button" className="btn c-danger hu-del" onClick={() => { setMenu(false); void remove(); }}>
          <Icon name="close" small />{th('bind.delete')}
        </button>
        <p className="dim hu-del-help">{th('bind.deleteHelp')}</p>
      </Sheet>
    </div>
  );
}

// Pochette d'une carte de la chasse : rangée (visuel, quantité et prix dessous), vide (carte grisée) ou « à venir »
function HuntPocket({ card, lang, onOpen }: { card: Card; lang: ReturnType<typeof useApp>['lang']; onOpen: () => void }) {
  const owned = card.owned > 0;
  const pending = !owned && card.insight?.kind === 'upcoming';
  const name = cardName(card, lang);
  const price = card.price.eur;
  const label = owned ? `${name}, ${card.number}, ×${card.owned}, ${formatEur(price)}`
    : pending ? `${name}, ${card.number}, ${th('bind.pendingLabel')}` : `${name}, ${card.number}, ${formatEur(price)}`;
  return (
    <button type="button" className={owned || pending ? 'pk' : 'pk ghost'} aria-label={label} onClick={onOpen}>
      <Slot card={pending ? null : card} lang={lang}>
        {pending && <span className="hu-pend">{card.number}<br />{th('bind.pending')}</span>}
      </Slot>
      <span className="cap">
        <span>{name}{owned && <> <b>×{card.owned}</b></>}</span>
        {!pending && <span>{formatEur(price)}</span>}
      </span>
    </button>
  );
}
