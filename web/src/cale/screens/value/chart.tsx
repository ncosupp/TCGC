// Courbe de valeur (accueil et écran Valeur) : calcul de la période et tracé SVG avec les jetons (value.css, `va-`).
import { formatDate, formatEur, type Stats } from '../../../api';
import { locale } from '../../../i18n';

export interface Point { date: string; value: number; t: number }

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();

export function toPoints(history: Stats['history']): Point[] {
  return history.map((h) => ({ date: h.date, value: h.valueEur, t: at(h.date) })).sort((a, b) => a.t - b.t);
}

// Points de la période (les `days` derniers jours avant le dernier relevé)
export function windowPoints(points: Point[], days: number): Point[] {
  if (!points.length) return [];
  const cutoff = points[points.length - 1].t - days * DAY;
  return points.filter((p) => p.t >= cutoff);
}

export interface Variation { delta: number; ratio: number | null; from: Point; covers: boolean }

// Variation entre le premier relevé de la période et la valeur actuelle ; null s'il n'y a pas deux relevés
export function variation(window: Point[], current: number | null, days: number): Variation | null {
  if (window.length < 2) return null;
  const from = window[0];
  const to = current ?? window[window.length - 1].value;
  const last = window[window.length - 1];
  return { delta: to - from.value, ratio: from.value ? (to - from.value) / from.value : null, from, covers: last.t - from.t >= (days - 2) * DAY };
}

const pctFormat = () => new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const shortDate = (iso: string) => new Date(at(iso)).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const one = (v: number) => v.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// « ↓ 2,24 € · 4,2 % »
export function VariationText({ v }: { v: Variation }) {
  const cls = v.delta < 0 ? 'va-down' : v.delta > 0 ? 'va-up' : 'va-flat';
  const arrow = v.delta < 0 ? '↓ ' : v.delta > 0 ? '↑ ' : '';
  return <span className={cls}>{arrow}{formatEur(Math.abs(v.delta))}{v.ratio != null && ` · ${pctFormat().format(Math.abs(v.ratio))}`}</span>;
}

// Courbe avec échelle à droite ; detailed : 3 repères, point le plus haut et dates dessous (écran Valeur)
export function ValueChart({ points, detailed, ariaFor }: {
  points: Point[]; detailed?: boolean; ariaFor: (info: { from: string; to: string; max: string; date: string; showMax: boolean }) => string;
}) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const t0 = points[0].t;
  const tSpan = points[points.length - 1].t - t0 || 1;
  const X = (p: Point) => ((p.t - t0) / tSpan) * 100;
  const Y = (v: number) => 2 + (1 - (v - min) / span) * 96; // en % de la hauteur
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(2)},${Y(p.value).toFixed(2)}`).join(' ');
  const last = points[points.length - 1];
  const top = points.reduce((a, p) => (p.value > a.value ? p : a), points[0]);
  const showMax = detailed === true && top !== last && top !== points[0];
  const lines = detailed ? [0, 50, 100] : [0, 100];
  const mid = (min + max) / 2;
  return (
    <div className={detailed ? 'va-chart va-chart-big' : 'va-chart'}>
      <div className="va-plot" role="img" aria-label={ariaFor({ from: formatEur(points[0].value), to: formatEur(last.value), max: formatEur(top.value), date: shortDate(top.date), showMax })}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {lines.map((y) => <line key={y} className="va-grid" x1="0" x2="100" y1={y === 0 ? 2 : y === 100 ? 98 : 50} y2={y === 0 ? 2 : y === 100 ? 98 : 50} vectorEffect="non-scaling-stroke" />)}
          {showMax && <line className="va-cursor" x1={X(top)} x2={X(top)} y1="0" y2="100" vectorEffect="non-scaling-stroke" />}
          <path className="va-line" d={d} vectorEffect="non-scaling-stroke" />
        </svg>
        {showMax && <i className="va-dot va-dot-max" style={{ left: `${X(top)}%`, top: `${Y(top.value)}%` }} />}
        <i className="va-dot" style={{ left: `${X(last)}%`, top: `${Y(last.value)}%` }} />
      </div>
      <div className="va-scale" aria-hidden="true">
        <span>{one(max)}</span>{detailed && <span>{one(mid)}</span>}<span>{one(min)}</span>
      </div>
      {detailed && (
        <div className="va-dates" aria-hidden="true">
          <span>{shortDate(points[0].date)}</span>
          {showMax ? <span>{shortDate(top.date)} · {formatEur(top.value)}</span> : <span />}
          <span>{shortDate(last.date)}</span>
        </div>
      )}
    </div>
  );
}

export { formatDate };
