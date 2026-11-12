// Valeur de la collection (maquette Valeur-style) : remplace la moitié « stats » de l'ancien onglet Stats.
import { useEffect, useState } from 'react';
import { api, cardName, formatDate, formatEur, type Stats } from '../../api';
import { useApp } from '../../store';
import { tv } from '../i18n/value';
import { Caps, Icon, Meter, Row, Rows, Slot, Spinner } from '../kit';
import { ValueChart, VariationText, shortDate, toPoints, variation, windowPoints } from './value/chart';
import './value.css';

type Period = '7' | '30' | '91' | '365';
const PERIODS: Period[] = ['7', '30', '91', '365'];

export function Value() {
  const { status, version, openCard } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [period, setPeriod] = useState<Period>('30');

  useEffect(() => { api.stats().then(setStats).catch(() => {}); }, [version, status?.priceDate, status?.priceSource]);

  if (!stats) {
    return <><div className="topbar"><a className="hit" href="#home" aria-label={tv('back')}><Icon name="back" /></a></div><Spinner /></>;
  }

  const days = Number(period);
  const win = windowPoints(toPoints(stats.history), days);
  const current = stats.totals.valueEur;
  const v = variation(win, current, days);
  const maxSet = Math.max(0.01, ...stats.bySet.map((s) => s.valueEur));
  const footDate = formatDate(status?.priceSource === 'tcgplayer' ? status.priceDate : status?.cmPriceDate ?? status?.priceDate);

  return (
    <>
      <div className="topbar"><a className="hit" href="#home" aria-label={tv('back')}><Icon name="back" /></a></div>
      <section className="va-top">
        <p className="over">{tv('over')}</p>
        <p className="display va-big">{formatEur(current)}</p>
        {v && (
          <p className="va-line-1">
            <VariationText v={v} /> <span className="dim">{v.covers ? tv('over30', { days }) : tv('since', { date: shortDate(v.from.date) })}</span>
          </p>
        )}
        {stats.totals.unpriced > 0 && <p className="dim va-line-1">{tv('unpriced', { n: stats.totals.unpriced })}</p>}
        <div className="va-caps">
          <Caps<Period> label={tv('period')} value={period} onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p, label: tv(`p.${p}` as 'p.7') }))} />
        </div>
        <div className="va-chartbox">
          {win.length >= 2
            ? <ValueChart points={win} detailed ariaFor={(i) => tv(i.showMax ? 'chartAria' : 'chartAriaFlat', { days, from: i.from, to: i.to, max: i.max, date: i.date })} />
            : <p className="dim va-note">{tv('empty')}</p>}
        </div>
      </section>

      {stats.top.length > 0 && (
        <section className="sec va-sec-top">
          <div className="sec-h"><h2 className="h">{tv('top')}</h2></div>
          <Rows>
            {stats.top.slice(0, 5).map((c) => {
              const lang = c.entry?.lang ?? 'fr';
              const qty = c.entry?.quantity ?? c.owned;
              return (
                <Row key={`${c.id}-${lang}`} onClick={() => openCard(c.id, lang)} chevron={false}
                  lead={<Slot card={c} lang={lang} style={{ width: 36, flex: 'none' }} />}
                  title={cardName(c, lang)}
                  meta={<><span className="num">{c.number}</span> · {tv(lang === 'fr' ? 'lang.fr' : 'lang.en')}{qty > 1 && ` ×${qty}`}</>}
                  trail={<span className="va-price">{formatEur(c.price.eur)}</span>} />
              );
            })}
          </Rows>
        </section>
      )}

      {stats.bySet.length > 0 && (
        <section className="sec va-end">
          <div className="sec-h"><h2 className="h">{tv('bySet')}</h2></div>
          <div className="va-sets">
            {stats.bySet.map((s) => (
              <div className="va-set" key={`${s.code}-${s.name}`}>
                <div className="va-set-h">
                  <span><span className="over">{s.code ?? s.name}</span> <small>· {tv('copies', { n: s.cards })}</small></span>
                  <span>{formatEur(s.valueEur)}</span>
                </div>
                <Meter ratio={Math.max(0.015, s.valueEur / maxSet)} />
              </div>
            ))}
          </div>
          <p className="dim va-foot">{tv(status?.priceSource === 'tcgplayer' ? 'foot.tcgplayer' : 'foot.cardmarket', { date: footDate })}</p>
        </section>
      )}
    </>
  );
}
