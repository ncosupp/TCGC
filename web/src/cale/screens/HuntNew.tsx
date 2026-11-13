// Création d'une chasse (maquette Chasse-creation-style) : rareté, version, couleur, puis « Ouvrir ce classeur »
import { useEffect, useRef, useState } from 'react';
import { api, type CardKind, type Hunt, type HuntCriteria, type HuntProgress } from '../../api';
import { t, type MessageKey } from '../../i18n';
import { useApp } from '../../store';
import { th } from '../i18n/hunts';
import { Icon, Mini, Sheet, useSwipeClose } from '../kit';
import { eur0, huntTitle, pagesOf, sameCriteria } from './hunts/shared';
import './hunts.css';

const RARITIES = ['L', 'SEC', 'SR', 'R', 'UC', 'C', 'TR', 'PR', 'DON!!'];
const KINDS: (CardKind | '')[] = ['', 'normal', 'special', 'alt', 'sp', 'manga', 'fullart', 'foil'];
const COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

function Chips<T extends string>({ value, options, render, onChange, label }: {
  value: T; options: readonly T[]; render: (v: T) => string; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o || 'all'} type="button" className={o === value ? 'chip on' : 'chip'} aria-pressed={o === value} onClick={() => onChange(o)}>
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export function HuntNew() {
  const { toast } = useApp();
  // Glissé vers le bas, le panneau ramène aux chasses (comme la croix)
  const sheet = useRef<HTMLElement>(null);
  useSwipeClose(sheet, () => { window.location.hash = 'collection/hunts'; }, true);
  const [criteria, setCriteria] = useState<HuntCriteria>({ rarity: 'L', kind: 'alt', color: '' });
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [preview, setPreview] = useState<HuntProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [glossary, setGlossary] = useState(false);
  const empty = !criteria.rarity && !criteria.kind && !criteria.color;
  const existing = hunts.find((h) => sameCriteria(h, criteria));
  const set = (patch: Partial<HuntCriteria>) => setCriteria((c) => ({ ...c, ...patch }));
  const kindHint = criteria.kind === 'special' || criteria.kind === 'alt' ? t(`hunts.kindHint.${criteria.kind}`) : null;

  useEffect(() => { api.hunts().then(setHunts).catch(() => {}); }, []);

  // Nombre de cartes de la chasse choisie, mis à jour à chaque critère
  useEffect(() => {
    setPreview(null);
    if (empty) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.huntPreview(criteria).then((p) => { if (!cancelled) setPreview(p); }).catch(() => {});
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [criteria, empty]);

  const open = async () => {
    if (existing) { window.location.hash = `collection/hunt/${existing.id}`; return; }
    setBusy(true);
    try {
      const hunt = await api.createHunt(criteria);
      window.location.hash = `collection/hunt/${hunt.id}`;
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  const ownedDots = preview ? Math.round((preview.owned / Math.max(1, preview.total)) * 9) : 0;

  return (
    <div className="hu-new">
      <div className="hu-gap" aria-hidden="true" />
      <section ref={sheet} className="sheet hu-sheet" role="dialog" aria-modal="true" aria-labelledby="hu-new-title">
        <div className="grip" />
        <div className="hu-sheet-head">
          <h1 className="title" id="hu-new-title">{th('new.title')}</h1>
          <a className="hit" href="#collection/hunts" aria-label={th('new.close')}><Icon name="close" /></a>
        </div>

        <section className="sec hu-step">
          <div className="hu-step-h">
            <span className="hu-num">01</span><h2 className="h">{th('new.rarity')}</h2><span className="sp" />
            <button type="button" className="link hu-glossary" onClick={() => setGlossary(true)}>{th('new.glossary')}</button>
          </div>
          <Chips label={th('new.rarity')} value={criteria.rarity} options={['', ...RARITIES]} onChange={(rarity) => set({ rarity })}
            render={(r) => (r ? (r === 'L' ? t('set.rarity.leader') : r) : th('rarity.all'))} />
        </section>
        <section className="sec hu-step hu-step-n">
          <div className="hu-step-h"><span className="hu-num">02</span><h2 className="h">{th('new.version')}</h2></div>
          <Chips label={th('new.version')} value={criteria.kind} options={KINDS} onChange={(kind) => set({ kind })}
            render={(k) => t(`hunts.kind.${k || 'any'}` as MessageKey)} />
          {kindHint && <p className="dim hu-hint">{kindHint}</p>}
        </section>
        <section className="sec hu-step hu-step-n">
          <div className="hu-step-h"><span className="hu-num">03</span><h2 className="h">{th('new.color')}</h2></div>
          <Chips label={th('new.color')} value={criteria.color} options={['', ...COLORS]} onChange={(color) => set({ color })}
            render={(c) => (c ? t(`color.${c}` as MessageKey) : th('rarity.all'))} />
        </section>

        <span className="sp" />
        <div className="sheet-bar hu-bar">
          <div className="hu-sum">
            <Mini dots={Array.from({ length: 9 }, (_, i) => (i < ownedDots ? 'own' : 'miss'))} />
            <span className="hu-sum-t">
              {empty ? <span className="dim hu-sum-s">{th('new.need')}</span> : !preview ? <span className="dim hu-sum-s">{th('new.loading')}</span>
                : preview.total === 0 ? <span className="dim hu-sum-s">{th('new.none')}</span> : (
                  <>
                    <span className="hu-sum-m">{th('new.summary', { title: huntTitle(criteria), n: preview.total })}</span>
                    <span className="dim hu-sum-s">
                      {th('new.summary.sub', { pages: pagesOf(preview.total), value: eur0(preview.missingEur) })}
                      {existing && <> · {th('new.exists')}</>}
                    </span>
                  </>
                )}
            </span>
          </div>
          <button type="button" className="btn main" onClick={open} disabled={busy || empty || preview?.total === 0}>{th('new.open')}</button>
        </div>
      </section>

      <Sheet open={glossary} onClose={() => setGlossary(false)} label={th('new.glossary.title')}>
        <h2 className="title hu-gl-title">{th('new.glossary.title')}</h2>
        <dl className="kv">
          {RARITIES.map((r) => (
            <div key={r} className="hu-gl-row"><dt className="num">{r}</dt><dd>{th(`rarity.${r}` as Parameters<typeof th>[0])}</dd></div>
          ))}
        </dl>
      </Sheet>
    </div>
  );
}
