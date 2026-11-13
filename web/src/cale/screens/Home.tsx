// Accueil (maquette Accueil-style) : valeur et courbe, à voir, classeurs, aventure.
import { useEffect, useState } from 'react';
import { api, cardName, formatEur, type Card, type Hunt, type SetSummary, type Stats, type TradeMatch } from '../../api';
import { loadAdventure, type AdventureState } from '../../../../game/ui/adventure/api';
import { useApp } from '../../store';
import { th } from '../i18n/home';
import { Caps, Glyph, Mini, Meter, Row, Rows, SetCover, Slot, type MiniDot } from '../kit';
import { PageHeader } from '../kit/PageHeader';
import { ValueChart, VariationText, shortDate, toPoints, variation, windowPoints } from './value/chart';
import './home.css';
import './value.css';

type Period = '7' | '30' | '365';
const PERIODS: Period[] = ['7', '30', '365'];

// Mini-page schématique : la part de pochettes rangées, sur les 9 points
function progressDots(ratio: number): MiniDot[] {
  const filled = ratio >= 1 ? 9 : Math.round(ratio * 9);
  return Array.from({ length: 9 }, (_, i) => (i < filled ? 'own' : 'miss'));
}

export function Home() {
  const { status, totals, version, lang } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [reached, setReached] = useState<Card[]>([]);
  const [matches, setMatches] = useState<TradeMatch[]>([]);
  const [adventure, setAdventure] = useState<AdventureState | null>(null);
  const [period, setPeriod] = useState<Period>('30');

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.collectionSets(false).then(setSets).catch(() => {});
    api.hunts().then(setHunts).catch(() => {});
    api.wishlist().then((w) => setReached(w.cards.filter((c) => c.wish?.targetEur != null && c.price.eur != null && c.price.eur <= c.wish.targetEur))).catch(() => {});
    api.trades().then((r) => setMatches(r.matches)).catch(() => {});
  }, [version, status?.priceDate, status?.priceSource]);
  useEffect(() => { loadAdventure().then(setAdventure).catch(() => {}); }, []);

  const t0 = stats?.totals ?? totals;
  const current = t0?.valueEur ?? null;
  const days = Number(period);
  const win = stats ? windowPoints(toPoints(stats.history), days) : [];
  const v = variation(win, current, days);

  const first = reached[0];
  const haveSum = matches.reduce((n, m) => n + m.theyWant.length, 0);
  const wantSum = matches.reduce((n, m) => n + m.theyHave.length, 0);
  const lookCount = (first ? 1 : 0) + (matches.length ? 1 : 0);
  const wonChapters = adventure ? Object.values(adventure.chapters).filter((c) => c.wins > 0).length : 0;
  const kindLabel = (k: string) => (k ? th(`kind.${k}` as 'kind.alt') : '');
  const firstLang = first?.wish?.lang ?? 'fr';

  return (
    <>
      <PageHeader brand />

      <section className="ho-sec ho-top">
        <div className="ho-head">
          <p className="over">{th('over')}</p>
          <Caps<Period> label={th('period')} value={period} onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p, label: th(`p.${p}` as 'p.7') }))} />
        </div>
        <a className="display ho-value" href="#value" aria-label={`${formatEur(current)} · ${th('valueOpen')}`}>{formatEur(current)}</a>
        {v && <p className="ho-var"><VariationText v={v} /> <span className="dim">{th('since', { date: shortDate(v.from.date) })}</span></p>}
        {win.length >= 2 && (
          <div className="ho-chart">
            <ValueChart points={win} ariaFor={(i) => th('chartAria', { days, from: i.from, to: i.to })} />
          </div>
        )}
        {t0 && <p className="dim ho-counts">{th('counts', { cards: t0.cards, distinct: t0.distinctCards, sets: stats?.bySet.length ?? sets.length })}</p>}
      </section>

      {lookCount > 0 && (
        <section className="ho-sec ho-block">
          <div className="sec-h"><h2 className="h">{th('look')}</h2><span className="dim ho-count">{lookCount}</span></div>
          <Rows>
            {first && (
              <Row href="#trades"
                lead={<Slot card={first} lang={firstLang} style={{ width: 40, flex: 'none' }} />}
                title={reached.length > 1 ? th('targetMany', { name: cardName(first, firstLang), n: reached.length - 1 }) : th('targetOne', { name: cardName(first, firstLang) })}
                meta={th('targetMeta', { price: formatEur(first.price.eur), target: formatEur(first.wish?.targetEur), number: first.number })} />
            )}
            {matches.length > 0 && (
              <Row href="#trades" lead={<Glyph icon="trades" />}
                title={th('trades', { n: matches.length })}
                meta={th('tradesMeta', { want: wantSum, have: haveSum })} />
            )}
          </Rows>
        </section>
      )}

      {(sets.length > 0 || hunts.length > 0) && (
        <section className="ho-block">
          <div className="ho-sec sec-h ho-binders-h"><h2 className="h">{th('binders')}</h2><a className="dim ho-all" href="#collection">{th('seeAll')}</a></div>
          <div className="ho-shelf">
            {sets.slice(0, 8).map((s) => {
              const ratio = s.total ? s.owned / s.total : 0;
              const missing = s.total - s.owned;
              return (
                <a className="tile" key={s.id} href={`#collection/set/${s.id}`}>
                  <span className="tile-top">
                    <SetCover set={s} lang={lang} className={missing <= 0 ? 'done' : undefined} />
                    <span className="ho-tile-id"><span className="over">{s.code ?? s.name}</span><span className="pct">{Math.floor(ratio * 100)}<small>%</small></span></span>
                  </span>
                  <Meter ratio={ratio} />
                  <span className="ho-small">{missing > 0 ? th('missing', { n: missing }) : <span className="ho-gold">{th('complete')}</span>}</span>
                </a>
              );
            })}
            {hunts.slice(0, 4).map((h) => {
              const ratio = h.total ? h.owned / h.total : 0;
              const name = [h.rarity, kindLabel(h.kind), h.color].filter(Boolean).join(' ');
              return (
                <a className="tile" key={`h${h.id}`} href={`#collection/hunt/${h.id}`}>
                  <span className="tile-top">
                    <Mini dots={progressDots(ratio)} full={h.total > 0 && h.owned >= h.total} />
                    <span className="ho-tile-id"><span className="over">{th('hunt')}</span><span className="pct" style={{ fontSize: 26 }}>{name}</span></span>
                  </span>
                  <Meter ratio={ratio} />
                  <span className="ho-small">{th('huntMeta', { owned: h.owned, total: h.total })}<span className="dim">{h.total > h.owned ? th('huntMissing', { price: formatEur(h.missingEur) }) : ''}</span></span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <section className="ho-sec ho-block">
        <Rows>
          <Row href="#play" lead={<Glyph icon="play" />} title={th(wonChapters || adventure?.deckId ? 'play' : 'playNew')}
            meta={wonChapters ? th('playMeta', { n: wonChapters }) : undefined} />
        </Rows>
        {/* Emplacement des succès (maquette) : rien d'affiché tant qu'ils n'existent pas */}
      </section>
    </>
  );
}
