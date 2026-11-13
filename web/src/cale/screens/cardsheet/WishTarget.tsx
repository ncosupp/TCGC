// Fiche carte : prix cible et langue d'une recherche (non dessiné dans la maquette ; repris de l'ancien WishBox avec
// les éléments du style : filets, champ pilule, pastilles). Le prix cible commande les alertes « prix cible atteint ».
import { useEffect, useState } from 'react';
import { api, formatEur, formatPct, type Card, type Lang } from '../../../api';
import { inputEur, parseEur, wishGap } from '../../../components/WishBox';
import { useApp } from '../../../store';
import { tc } from '../../i18n/cardsheet';
import { Caps, Row, Rows } from '../../kit';

export function WishTarget({ card, onSaved }: { card: Card; onSaved: (res: { card: Card }) => void }) {
  const { wishChanged, toast } = useApp();
  const saved = card.wish?.targetEur ?? null;
  const suggested = card.insight?.target ?? null;
  const [text, setText] = useState(inputEur(saved));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(inputEur(saved)); }, [saved, card.id]);
  if (!card.wish) return null;

  const parsed = parseEur(text);
  const status = wishGap(card);

  const run = async (body: { lang?: Lang; targetEur?: number | null }, message?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onSaved(await api.wish(card.id, body));
      wishChanged();
      if (message) toast(message);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (parsed === undefined) { setText(inputEur(saved)); return; }
    if (parsed !== saved) void run({ targetEur: parsed }, parsed == null ? tc('target.cleared') : tc('target.saved'));
  };

  const meta = status
    ? status.reached ? <span className="cs-reached">{tc('target.reached')}</span> : tc('target.gap', { pct: formatPct(status.gap) })
    : saved == null ? tc('target.none') : null;

  return (
    <section className="sec">
      <div className="sec-h"><h2 className="h">{tc('target.title')}</h2></div>
      <Rows>
        <Row title={tc('target.label')} meta={meta} trail={
          <label className="field cs-target">
            <input type="text" inputMode="decimal" autoComplete="off" value={text} disabled={busy}
              placeholder="—" aria-label={tc('target.aria')} aria-invalid={parsed === undefined}
              onChange={(e) => setText(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <span className="dim">€</span>
          </label>
        } />
        {suggested != null && suggested !== saved && (
          <Row title={tc('target.suggested')} meta={formatEur(suggested)} trail={
            <button type="button" className="btn line cs-use" disabled={busy} onClick={() => void run({ targetEur: suggested }, tc('target.saved'))}>{tc('target.use')}</button>
          } />
        )}
        <Row title={tc('target.lang')} trail={
          <Caps label={tc('target.lang')} value={card.wish.lang} onChange={(l) => l !== card.wish?.lang && void run({ lang: l })}
            options={[{ value: 'fr', label: tc('name.fr') }, { value: 'en', label: tc('name.en') }]} />
        } />
      </Rows>
      <p className="dim cs-fine">{tc('target.help')}</p>
    </section>
  );
}
