// Fiche carte en panneau du bas (maquettes Carte-style, Carte-EN-style). Ouverte de partout par openCard(id, lang).
import { useEffect, useMemo, useState } from 'react';
import { api, cardImageLarge, cardName, formatEur, formatPct, type Card, type CardDetail, type Lang } from '../../api';
import { locale, t } from '../../i18n';
import { huntTitle } from '../../pages/Hunts';
import { useApp } from '../../store';
import { tc, trAttr, trColor, trType } from '../i18n/cardsheet';
import { Caps, Icon, Row, Rows, Sheet, Slot, Spinner, Stepper, cardTint, cx } from '../kit';
import { PriceChart } from './cardsheet/PriceChart';
import { useSpot } from './cardsheet/useSpot';
import { WishTarget } from './cardsheet/WishTarget';
import './cardsheet.css';

const PERIODS = ['7', '30', '365'] as const;
type Period = (typeof PERIODS)[number];
const MILESTONES = [10, 25, 50];
const LANGS: Lang[] = ['fr', 'en'];

const money = (value: number, currency: string) =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(value);
const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export function CardSheet() {
  const { openedCard, closeCard, openCard, cardChanged, wishChanged, toast, version } = useApp();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [lang, setLang] = useState<Lang>('fr');
  const [period, setPeriod] = useState<Period>('30');
  const [busy, setBusy] = useState(false);
  const openedId = openedCard?.id ?? null;
  const { spot, hunts } = useSpot(card, version);

  useEffect(() => { if (openedCard) setLang(openedCard.lang); }, [openedCard]);

  useEffect(() => {
    if (openedId === null) { setCard(null); return; }
    let cancelled = false;
    api.card(openedId).then((c) => { if (!cancelled) setCard(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [openedId, version]);

  // Une autre carte s'ouvre : on repart d'un panneau en chargement
  useEffect(() => { setCard((old) => (old && old.id !== openedId ? null : old)); }, [openedId]);

  const history = useMemo(
    () => (card?.history ?? []).filter((h) => h.eur != null).map((h) => ({ date: h.date, value: h.eur! })),
    [card],
  );
  const shown = useMemo(() => history.filter((h) => h.date.slice(0, 10) >= isoDaysAgo(Number(period))), [history, period]);
  // Variation sur 30 jours
  const change = useMemo(() => {
    const pts = history.filter((h) => h.date.slice(0, 10) >= isoDaysAgo(30));
    if (pts.length < 2 || !pts[0].value) return null;
    return pts[pts.length - 1].value / pts[0].value - 1;
  }, [history]);

  const merge = (res: { card: Card }) => setCard((old) => (old ? { ...old, ...res.card } : old));

  const setQty = async (qtyLang: Lang, quantity: number) => {
    if (!card) return;
    const res = await api.setQuantity(card.id, Math.max(0, quantity), qtyLang);
    merge(res);
    cardChanged(res.card, res.totals);
    if (quantity <= 0) toast(tc('removed', { lang: tc(`name.${qtyLang}`) }));
  };

  const file = async () => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const res = await api.add(card.id, 1, lang);
      merge(res);
      cardChanged(res.card, res.totals);
      toast(tc('filed', { lang: tc(`name.${lang}`) }), { label: tc('undo'), run: () => { void setQty(lang, res.card.ownedByLang[lang] - 1); } });
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleWish = async () => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const res = card.wish ? await api.unwish(card.id) : await api.wish(card.id, { lang });
      merge(res);
      wishChanged();
      toast(card.wish ? tc('wish.removed') : tc('wish.added'));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label = card ? `${cardName(card, lang)}${card.variant ? `, ${card.variant}` : ''}` : '';
  const price = card?.price;

  const bar = card && (
    <>
      <button type="button" className={cx('btn', 'line', 'cs-wish', !!card.wish && 'on')} aria-pressed={!!card.wish} disabled={busy} onClick={toggleWish}>
        <Icon name="star" small />{card.wish ? tc('wished') : tc('wish')}
      </button>
      <button type="button" className="btn main cs-file" disabled={busy} onClick={file}>
        <Icon name="plus" small />{tc('file', { lang: tc(`name.${lang}`) })}
      </button>
    </>
  );

  return (
    <Sheet open={openedCard !== null} onClose={closeCard} label={label || tc('close')} className="cs-sheet" bar={bar}>
      <div className="cs-close"><button type="button" className="hit" aria-label={tc('close')} onClick={closeCard}><Icon name="close" /></button></div>
      {!card ? <div className="cs-loading"><Spinner /></div> : (
        <>
          <div className="cs-hero">
            <span className="c-slot">
              <span className="c-card" style={cardTint(card)}>
                <img key={lang} src={cardImageLarge(card, lang)} alt="" decoding="async" />
              </span>
            </span>
            <Caps label={tc('art.label')} value={lang} onChange={setLang}
              options={[{ value: 'fr', label: tc('art.fr') }, { value: 'en', label: tc('art.en') }]} />
            {lang === 'fr' && !card.imageFr && <p className="dim cs-note">{tc('noFr')}</p>}
          </div>

          <div className="cs-in cs-head">
            <p className="over">{[card.number, card.type && trType(card.type), card.variant].filter(Boolean).join(' · ')}</p>
            <h1 className="title">{cardName(card, lang)}</h1>
            <p className="dim cs-sub">
              {[card.setName, card.releaseDate && new Date(`${card.releaseDate.slice(0, 10)}T12:00:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })].filter(Boolean).join(' · ')}
            </p>
            <div className="cs-now">
              <span className="display">{formatEur(price?.eur)}</span>
              {change != null && Math.abs(change) >= 0.0005 && (
                <span className="cs-change">{change < 0 ? '↓' : '↑'} {tc('change', { pct: formatPct(Math.abs(change)) })}</span>
              )}
            </div>
            <p className="dim cs-sub">
              {[trendLabel(card), card.insight?.kind && t(`insight.label.${card.insight.kind}` as 'insight.label.good')].filter(Boolean).join(' · ')}
            </p>
          </div>

          <section className="sec">
            <div className="sec-h"><h2 className="h">{tc('binder')}</h2><span className="dim cs-hint">{card.owned > 0 ? tc('pocket.filled') : tc('pocket.empty')}</span></div>
            <Rows>
              {LANGS.map((l) => (
                <Row key={l} className="cs-copies" title={tc(`copies.${l}`)} meta={tc(`lang.${l}`)}
                  trail={<Stepper value={card.ownedByLang[l]} onChange={(n) => void setQty(l, n)} labels={{ minus: tc(`minus.${l}`), plus: tc(`plus.${l}`) }} />} />
              ))}
              {spot && (
                <Row href={`#collection/set/${spot.setId}`}
                  title={tc('slot.title', { set: card.setCode ?? '', mode: tc(spot.master ? 'slot.master' : 'slot.full') })}
                  meta={tc('slot.where', { page: spot.page, pocket: spot.pocket }) + (spot.nextToNormal ? tc('slot.nextToNormal') : '')} />
              )}
              {hunts.map((h) => (
                <Row key={h.id} href={`#collection/hunt/${h.id}`} title={huntTitle(h)}
                  meta={tc('hunt.count', { owned: h.owned, total: h.total }) + milestone(h.owned, h.total, card.owned)} />
              ))}
            </Rows>
          </section>

          <WishTarget card={card} onSaved={merge} />

          <section className="sec">
            <div className="sec-h">
              <h2 className="h">{tc('price')}</h2>
              <Caps label={tc('period')} value={period} onChange={setPeriod}
                options={PERIODS.map((p) => ({ value: p, label: tc(`p${p}`) }))} />
            </div>
            <PriceChart points={shown} days={Number(period)} />
            <dl className="kv cs-kv">
              {price?.cardmarket?.avg7 != null && <><dt>{tc('avg7')}</dt><dd>{formatEur(price.cardmarket.avg7)}</dd></>}
              {price?.cardmarket?.avg30 != null && <><dt>{tc('avg30')}</dt><dd>{formatEur(price.cardmarket.avg30)}</dd></>}
              {price?.tcgplayer && <><dt>{tc('tcg')}</dt><dd>{formatEur(price.tcgplayer.eur)} <span className="dim">· {money(price.tcgplayer.usd, 'USD')}</span></dd></>}
            </dl>
            {price?.cardmarket && <p className="dim cs-fine">{tc('mixed')}</p>}
            {(card.cardmarketUrl || card.tcgplayerUrl) && (
              <div className="cs-ext">
                {card.cardmarketUrl && <a className="btn line" href={card.cardmarketUrl} target="_blank" rel="noreferrer">Cardmarket <Icon name="arrowUpRight" small /></a>}
                {card.tcgplayerUrl && <a className="btn line" href={card.tcgplayerUrl} target="_blank" rel="noreferrer">TCGplayer <Icon name="arrowUpRight" small /></a>}
              </div>
            )}
          </section>

          {card.versions.length > 0 && (
            <section className="sec">
              <h2 className="h sec-h">{tc('versions', { number: card.number.split('-').pop() ?? card.number })}</h2>
              <div className="cs-ver">
                {[card, ...card.versions].sort((a, b) => Number(a.variant != null) - Number(b.variant != null)).map((v) => (
                  <button key={v.id} type="button" className={cx(v.id === card.id && 'on')} aria-current={v.id === card.id || undefined}
                    aria-label={`${v.variant ?? tc('version.normal')}${v.setCode ? `, ${v.setCode}` : ''}`}
                    onClick={() => v.id !== card.id && openCard(v.id, lang)}>
                    <Slot card={v} lang={lang} />
                    <p>{v.variant ?? tc('version.normal')}{v.owned > 0 && <> <span className="dim">×{v.owned}</span></>}<br /><span className="dim">{formatEur(v.price.eur)}</span></p>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="sec cs-last">
            <h2 className="h sec-h">{tc('details')}</h2>
            <dl className="kv cs-kv0">
              {(card.type || card.color) && <><dt>{tc('row.typeColor')}</dt><dd>{[card.type && trType(card.type), card.color && trColor(card.color)].filter(Boolean).join(' · ')}</dd></>}
              {card.life
                ? <><dt>{tc('row.powerLife')}</dt><dd>{[card.power, card.life].filter(Boolean).join(' · ')}</dd></>
                : (card.cost || card.power) && <><dt>{tc('row.costPower')}</dt><dd>{[card.cost, card.power].filter(Boolean).join(' · ')}</dd></>}
              {card.counter && <><dt>{tc('row.counter')}</dt><dd>{card.counter}</dd></>}
              {card.attribute && <><dt>{tc('row.attribute')}</dt><dd>{trAttr(card.attribute)}</dd></>}
              {card.subtypes && <><dt>{tc('row.families')}</dt><dd>{card.subtypes}</dd></>}
            </dl>
            {card.description && <p className="cs-text">{card.description}</p>}
          </section>
        </>
      )}
    </Sheet>
  );
}

// « Tendance Cardmarket » : source et base du prix retenu
function trendLabel(card: CardDetail) {
  const p = card.price;
  if (p.source === 'cardmarket' && p.cardmarket) return tc(`trend.cardmarket.${p.cardmarket.basis}`);
  if (p.source === 'tcgplayer') return tc('trend.tcgplayer');
  return tc('trend.none');
}

// Palier de chasse (10 / 25 / 50 %) que la carte, si on ne l'a pas, ferait atteindre ou approcherait
function milestone(owned: number, total: number, copies: number) {
  if (copies > 0 || total === 0) return '';
  const next = MILESTONES.find((m) => (owned / total) * 100 < m);
  return next ? tc('hunt.milestone', { pct: next }) : '';
}
