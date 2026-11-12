// Récapitulatif de la session de scan (maquette Scan-recap-style). Rien n'est enregistré côté serveur.
import { useEffect, useState } from 'react';
import { cardName, formatEur } from '../../../api';
import { getUiLang, locale } from '../../../i18n';
import { Icon, Meter, Rows, Slot } from '../../kit';
import { tsc } from '../../i18n/scan';
import { langLabel, normalCards, setIdOf, type SessionEntry } from './helpers';

const FIRST = 6;

interface SetProgress {
  id: number; code: string; before: number; after: number;
  page: ('own' | 'new' | 'miss' | 'none')[]; filled: string[]; missing: number;
}

// Le set où la session a rempli le plus de pochettes de son Full set : avant / après, et la page concernée
async function computeProgress(entries: SessionEntry[]): Promise<SetProgress | null> {
  const bySet = new Map<string, SessionEntry[]>();
  for (const e of entries) {
    if (!e.fresh || e.card.variant || !e.card.setCode) continue;
    bySet.set(e.card.setCode, [...(bySet.get(e.card.setCode) ?? []), e]);
  }
  const [code, list] = [...bySet].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!code || !list) return null;
  const id = await setIdOf(list[0].card);
  if (!id) return null;
  const cards = await normalCards(id, true);
  const ids = new Set(list.map((e) => e.card.id));
  const mine = cards.filter((c) => ids.has(c.id));
  if (!cards.length || !mine.length) return null;
  const owned = cards.filter((c) => c.owned > 0).length;
  const start = Math.floor(cards.findIndex((c) => c.id === mine[0].id) / 9) * 9;
  const page = Array.from({ length: 9 }, (_, i) => {
    const c = cards[start + i];
    return !c ? 'none' as const : ids.has(c.id) ? 'new' as const : c.owned > 0 ? 'own' as const : 'miss' as const;
  });
  return {
    id, code, page,
    before: Math.max(0, Math.round((owned - mine.length) / cards.length * 100)),
    after: Math.round(owned / cards.length * 100),
    filled: mine.map((c) => c.number.split('-').pop() ?? c.number),
    missing: cards.length - owned,
  };
}

export function Recap({ entries, onClose, onFinish, onUndo, onOpen }: {
  entries: SessionEntry[]; onClose: () => void; onFinish: () => void;
  onUndo: (entry: SessionEntry) => void; onOpen: (entry: SessionEntry) => void;
}) {
  const ui = getUiLang();
  const [all, setAll] = useState(false);
  const [progress, setProgress] = useState<SetProgress | null>(null);
  const count = entries.reduce((sum, e) => sum + e.quantity, 0);
  const value = entries.reduce((sum, e) => sum + (e.card.price.eur ?? 0) * e.quantity, 0);
  // Les entrées de l'ancienne interface n'ont pas dit si la pochette était nouvelle : on n'affiche alors pas le détail
  const known = entries.every((e) => e.fresh !== undefined);
  const pockets = entries.filter((e) => e.fresh).length;
  const sorted = [...entries].sort((a, b) => (b.card.price.eur ?? 0) * b.quantity - (a.card.price.eur ?? 0) * a.quantity);
  const shown = all ? sorted : sorted.slice(0, FIRST);

  useEffect(() => {
    let stale = false;
    computeProgress(entries).then((p) => { if (!stale) setProgress(p); }).catch(() => { if (!stale) setProgress(null); });
    return () => { stale = true; };
  }, [entries]);

  const times = entries.map((e) => e.at).filter((t): t is number => t != null);
  const when = (() => {
    if (!times.length) return tsc('rec.today');
    const from = new Date(Math.min(...times));
    const to = new Date(Math.max(...times));
    const hour = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' });
    const day = from.toDateString() === new Date().toDateString()
      ? tsc('rec.today') : new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' }).format(from);
    return `${day}, ${hour.format(from)} – ${hour.format(to)}`;
  })();

  return (
    <div className="sc-recap">
      <div className="topbar">
        <button type="button" className="hit" onClick={onClose} aria-label={tsc('rec.back')}><Icon name="back" /></button>
      </div>
      <section className="sc-intro">
        <p className="over">{tsc('rec.session', { when })}</p>
        <p className="display sc-count">{count} <span>{tsc('rec.stored', { n: count })}</span></p>
        {count > 0 && (
          <p className="sc-sum">
            <span className="sc-gain">+{formatEur(value)}</span>
            {known && <span className="dim"> · {tsc('rec.newPockets', { n: pockets })} · {tsc('rec.doubles', { n: count - pockets })}</span>}
          </p>
        )}
      </section>

      {progress && (
        <section className="sec sc-set">
          <a className="tile" href={`#collection/set/${progress.id}`}>
            <span className="tile-top">
              <span className="mini" aria-hidden="true">
                {progress.page.map((d, i) => <i key={i} className={d === 'miss' ? 'm' : d === 'none' ? 'x' : d === 'new' ? 'sc-new' : undefined} />)}
              </span>
              <span className="sc-tilehead">
                <span className="over">{progress.code}</span>
                <span className="pct">{progress.before} → {progress.after}<small>%</small></span>
              </span>
            </span>
            <Meter ratio={progress.after / 100} />
            <span className="sc-tilefoot">
              <span className="dim">{tsc('rec.filled')}</span> {progress.filled.join(', ')} <span className="dim">· {tsc('rec.missing', { n: progress.missing })}</span>
            </span>
          </a>
        </section>
      )}

      <section className="sec sc-stored">
        {entries.length === 0 ? <p className="dim">{tsc('rec.empty')}</p> : (
          <>
            <div className="sec-h"><h2 className="h">{tsc('rec.stored2')}</h2><span className="dim sc-small">{tsc('rec.byPrice')}</span></div>
            <Rows>
              {shown.map((e) => {
                const name = cardName(e.card, e.lang);
                const meta = e.fresh ? tsc('rec.newPocket') : e.nth ? tsc('rec.nth', { n: e.nth }) : langLabel(e.lang, ui);
                return (
                  <div className="row" key={`${e.at ?? ''}-${e.card.id}-${e.lang}-${entries.indexOf(e)}`}>
                    <button type="button" className="sc-rowbtn" onClick={() => onOpen(e)} aria-label={tsc('rec.open', { name })}>
                      <Slot card={e.card} lang={e.lang} style={{ width: 34, flex: 'none' }} />
                      <span className="row-main">
                        <span className="row-t">{name}</span>
                        <span className="row-m"><span className="num">{e.card.number}</span> · {e.quantity > 1 ? `×${e.quantity} · ` : ''}{meta}</span>
                      </span>
                      <span className="sc-price">{formatEur(e.card.price.eur)}</span>
                    </button>
                    <button type="button" className="hit sc-undo" onClick={() => onUndo(e)} aria-label={tsc('rec.undo', { name })}><Icon name="undo" small /></button>
                  </div>
                );
              })}
              {!all && sorted.length > FIRST && (
                <button type="button" className="link sc-more" onClick={() => setAll(true)}>{tsc('rec.more', { n: sorted.length - FIRST })}</button>
              )}
            </Rows>
          </>
        )}
      </section>

      <div className="sc-bar">
        <button type="button" className="btn line" onClick={onClose}>{tsc('rec.continue')}</button>
        <button type="button" className="btn main sc-grow" onClick={onFinish}>{tsc('rec.finish')}</button>
      </div>
    </div>
  );
}
