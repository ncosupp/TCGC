// Courbe de prix de la fiche carte : filets, courbe or, point final, échelle à droite, dates dessous
import { formatEur } from '../../../api';
import { locale } from '../../../i18n';
import { tc } from '../../i18n/cardsheet';

export interface PricePoint { date: string; value: number }

const num = (v: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v);
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

export function PriceChart({ points, days }: { points: PricePoint[]; days: number }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const y = (v: number) => (max === min ? 45 : 2 + ((max - v) / (max - min)) * 86);
  const x = (i: number) => (i / (points.length - 1)) * 300;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <div className="cs-chart">
      <svg viewBox="0 0 300 90" preserveAspectRatio="none" role="img"
        aria-label={tc('chart.aria', { days, from: formatEur(points[0].value), to: formatEur(last.value) })}>
        {[2, 45, 88].map((v) => <line key={v} className="grid" x1="0" y1={v} x2="300" y2={v} />)}
        <path className="trace" d={path} vectorEffect="non-scaling-stroke" />
        <circle className="dot" cx="300" cy={y(last.value)} r="3" />
      </svg>
      <div className="scale"><span>{num(max)}</span><span>{num((max + min) / 2)}</span><span>{num(min)}</span></div>
      <div className="dates"><span>{day(points[0].date)}</span><span>{day(last.date)}</span></div>
    </div>
  );
}
