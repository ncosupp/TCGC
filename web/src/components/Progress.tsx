import { locale } from '../i18n';

// "58 %" en français, "58%" en anglais
export function formatPercent(ratio: number) {
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

// Barre de progression d'une collection (set, chasse) : cartes possédées sur le total
export function Progress({ owned, total }: { owned: number; total: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={owned}>
      <div style={{ width: `${total ? (100 * owned) / total : 0}%` }} />
    </div>
  );
}
