import { useEffect, useState } from 'react';
import { api, formatEur, type CardKind, type CardQuery, type Hunt, type HuntCriteria, type HuntProgress } from '../api';
import { CardGrid } from '../components/CardGrid';
import { COLORS } from '../components/Filters';
import { Icon } from '../components/Icon';
import { formatPercent, Progress } from '../components/Progress';
import { t, type MessageKey } from '../i18n';
import { readPref, writePref } from '../prefs';
import { useApp } from '../store';
import { useCards } from '../useCards';

// Chasses : cartes à réunir à travers tous les sets (« toutes les Leader alt. »), avec leur progression

const RARITIES = ['L', 'SEC', 'SR', 'R', 'UC', 'C', 'TR', 'PR', 'DON!!'];
const KINDS: (CardKind | '')[] = ['', 'normal', 'special', 'alt', 'sp', 'manga', 'fullart', 'foil'];

// Chasses proposées en un geste quand elles ne sont pas déjà suivies
const IDEAS: HuntCriteria[] = [
  { rarity: 'L', kind: 'alt', color: '' },
  { rarity: 'SR', kind: 'alt', color: '' },
  { rarity: 'SEC', kind: '', color: '' },
  { rarity: '', kind: 'manga', color: '' },
  { rarity: '', kind: 'sp', color: '' },
  { rarity: 'L', kind: 'normal', color: '' },
];

const sameCriteria = (a: HuntCriteria, b: HuntCriteria) => a.rarity === b.rarity && a.kind === b.kind && a.color === b.color;

const rarityName = (rarity: string) => (rarity === 'L' ? t('set.rarity.leader') : rarity);

// "Leader alt.", "SR normales", "Manga · Rouge"
export function huntTitle({ rarity, kind, color }: HuntCriteria) {
  const k = kind || 'any';
  const base = rarity
    ? t(`hunts.title.${k}` as MessageKey, { r: rarityName(rarity) })
    : t(`hunts.title.${k}.none` as MessageKey);
  return color ? `${base} · ${t(`color.${color}` as MessageKey)}` : base;
}

// ---------- Liste des chasses ----------

export function HuntsView({ onOpen }: { onOpen: (id: number) => void }) {
  const { version, toast } = useApp();
  const [hunts, setHunts] = useState<Hunt[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.hunts().then((h) => { if (!cancelled) setHunts(h); }).catch(() => {});
    return () => { cancelled = true; };
  }, [version]);

  const ideas = IDEAS.filter((idea) => !hunts?.some((h) => sameCriteria(h, idea)));

  const start = async (criteria: HuntCriteria) => {
    try {
      const hunt = await api.createHunt(criteria);
      onOpen(hunt.id);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  if (!hunts) return <div className="center"><div className="spinner" /></div>;

  return (
    <>
      {hunts.length === 0 && <p className="muted hunts-intro">{t('hunts.intro')}</p>}
      <div className="hunt-list">
        {hunts.map((h) => <HuntTile key={h.id} hunt={h} onOpen={() => onOpen(h.id)} />)}
      </div>
      <button className="btn btn-primary btn-block" onClick={() => setCreating(true)}>
        <Icon name="plus" size={18} /> {t('hunts.new')}
      </button>
      {ideas.length > 0 && (
        <div className="hunt-ideas">
          <div className="muted small">{t('hunts.ideas')}</div>
          <div className="choices">
            {ideas.map((idea) => (
              <button key={huntTitle(idea)} className="choice" onClick={() => start(idea)}>+ {huntTitle(idea)}</button>
            ))}
          </div>
        </div>
      )}
      {creating && (
        <HuntSheet hunts={hunts} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />
      )}
    </>
  );
}

function HuntTile({ hunt, onOpen }: { hunt: Hunt; onOpen: () => void }) {
  const done = hunt.total > 0 && hunt.owned === hunt.total;
  return (
    <button className="hunt-tile" onClick={onOpen}>
      <div className="hunt-tile-head">
        <span className="hunt-tile-title">{huntTitle(hunt)}</span>
        <span className="hunt-tile-pct">{formatPercent(hunt.owned / Math.max(1, hunt.total))}</span>
      </div>
      <Progress owned={hunt.owned} total={hunt.total} />
      <div className="hunt-tile-foot muted small">
        <span><strong className="hunt-tile-owned">{hunt.owned}</strong> / {hunt.total}</span>
        <span>{done ? <>✓ {t('hunts.complete')}</> : t('hunts.toFinish', { value: formatEur(hunt.missingEur, true) })}</span>
      </div>
    </button>
  );
}

// ---------- Nouvelle chasse ----------

function Choices<T extends string>({ label, value, options, render, onChange }: {
  label: string; value: T; options: readonly T[]; render: (v: T) => string; onChange: (v: T) => void;
}) {
  return (
    <fieldset className="hunt-field">
      <legend>{label}</legend>
      <div className="choices">
        {options.map((o) => (
          <button key={o || 'all'} type="button" className={o === value ? 'choice choice-on' : 'choice'} aria-pressed={o === value}
            onClick={() => onChange(o)}>
            {render(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function HuntSheet({ hunts, onClose, onCreated }: { hunts: Hunt[]; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useApp();
  const [criteria, setCriteria] = useState<HuntCriteria>({ rarity: 'L', kind: 'alt', color: '' });
  const [preview, setPreview] = useState<HuntProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = !criteria.rarity && !criteria.kind && !criteria.color;
  const existing = hunts.find((h) => sameCriteria(h, criteria));
  const set = (patch: Partial<HuntCriteria>) => setCriteria((c) => ({ ...c, ...patch }));
  const kindHint = criteria.kind === 'special' || criteria.kind === 'alt' ? t(`hunts.kindHint.${criteria.kind}`) : null;

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

  const create = async () => {
    if (existing) return onCreated(existing.id);
    setBusy(true);
    try {
      const hunt = await api.createHunt(criteria);
      onCreated(hunt.id);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="hunt-sheet-title">
        <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></button>
        <div className="recap-body">
          <h2 id="hunt-sheet-title">{t('hunts.new')}</h2>
          <Choices label={t('hunts.rarity')} value={criteria.rarity} options={['', ...RARITIES]}
            render={(r) => (r ? rarityName(r) : t('hunts.any'))} onChange={(rarity) => set({ rarity })} />
          <Choices label={t('hunts.kind')} value={criteria.kind} options={KINDS}
            render={(k) => t(`hunts.kind.${k || 'any'}` as MessageKey)} onChange={(kind) => set({ kind })} />
          {kindHint && <p className="muted small flush">{kindHint}</p>}
          <Choices label={t('hunts.color')} value={criteria.color} options={['', ...COLORS]}
            render={(c) => (c ? t(`color.${c}` as MessageKey) : t('hunts.any'))} onChange={(color) => set({ color })} />

          <div className="hunt-preview">
            {empty ? <span className="muted">{t('hunts.needCriterion')}</span> : (
              <>
                <strong>{huntTitle(criteria)}</strong>
                <span className="muted">
                  {!preview ? '…' : preview.total === 0 ? t('hunts.previewNone')
                    : t('hunts.preview', { owned: preview.owned, n: preview.total })}
                </span>
              </>
            )}
          </div>
          {existing && <p className="muted small flush">{t('hunts.exists')}</p>}
          <button className="btn btn-primary btn-block" onClick={create} disabled={busy || empty || preview?.total === 0}>
            {existing ? huntTitle(existing) : t('hunts.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Une chasse ----------

const FILTERS = ['all', 'owned', 'missing'] as const;
type Filter = typeof FILTERS[number];

const SORTS = [
  ['set', 'hunts.sort.set'],
  ['price', 'sort.price'],
  ['price-asc', 'sort.priceAsc'],
  ['rarity', 'sort.rarity'],
  ['color', 'sort.color'],
  ['name', 'sort.name'],
  ['number', 'sort.number'],
] as const satisfies readonly (readonly [string, MessageKey])[];
type Sort = typeof SORTS[number][0];

export function HuntDetail({ huntId, onBack }: { huntId: number; onBack: () => void }) {
  const { version, lang, toast, wishChanged } = useApp();
  const [hunt, setHunt] = useState<Hunt | null>(null);
  const [missingHunt, setMissingHunt] = useState(false);
  const [filter, setFilter] = useState<Filter>(() => readPref('tcgc.huntFilter', FILTERS, 'all'));
  const [sort, setSort] = useState<Sort>(() => readPref('tcgc.huntSort', SORTS.map(([v]) => v), 'set'));
  const [wishing, setWishing] = useState(false);
  const fetchCards = (query: CardQuery) => api.huntCards(huntId, query);
  const { cards, total, loading, hasMore, loadMore } = useCards(
    { sort, status: filter === 'all' ? undefined : filter },
    { pageSize: 120, fetch: fetchCards },
  );

  useEffect(() => {
    let cancelled = false;
    api.hunt(huntId).then((h) => { if (!cancelled) setHunt(h); }).catch(() => { if (!cancelled) setMissingHunt(true); });
    return () => { cancelled = true; };
  }, [huntId, version]);

  useEffect(() => { window.scrollTo(0, 0); }, [huntId]);

  const wishAll = async () => {
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
      onBack();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  if (missingHunt) {
    return (
      <div className="page">
        <button className="back-btn" onClick={onBack}><span aria-hidden="true">‹</span> {t('hunts.back')}</button>
      </div>
    );
  }

  const missing = hunt ? hunt.total - hunt.owned : 0;

  return (
    <div className="page">
      <div className="set-header">
        <button className="back-btn" onClick={onBack}><span aria-hidden="true">‹</span> {t('hunts.back')}</button>
        <h2>{hunt ? huntTitle(hunt) : '…'}</h2>
        {hunt && (
          <>
            <div className="set-header-stats">
              <span><strong>{hunt.owned}</strong>{t('set.ofTotal', { total: hunt.total })}</span>
              <span>{formatPercent(hunt.owned / Math.max(1, hunt.total))}</span>
            </div>
            <Progress owned={hunt.owned} total={hunt.total} />
            {missing > 0 ? (
              <div className="set-missing">
                <div>
                  <strong>{t('set.missing', { n: missing })}</strong>
                  <span className="muted"> · {t('set.missingValue', { value: formatEur(hunt.missingEur, true) })}</span>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={wishAll} disabled={wishing}>
                  <span aria-hidden="true">☆</span> {t('hunts.wishMissing')}
                </button>
              </div>
            ) : (
              <div className="set-missing"><strong>✓ {t('hunts.complete')}</strong></div>
            )}
          </>
        )}
      </div>

      <div className="list-head">
        <select className="select" value={filter} aria-label={t('set.filter')}
          onChange={(e) => { setFilter(e.target.value as Filter); writePref('tcgc.huntFilter', e.target.value); }}>
          {FILTERS.map((value) => <option key={value} value={value}>{t(`set.filter.${value}`)}</option>)}
        </select>
        <select className="select" value={sort} aria-label={t('common.sort')}
          onChange={(e) => { setSort(e.target.value as Sort); writePref('tcgc.huntSort', e.target.value); }}>
          {SORTS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </div>

      {loading && cards.length === 0 && <div className="center"><div className="spinner" /></div>}
      {!loading && total === 0 && filter === 'owned' && <p className="muted center-text">{t('hunts.empty')}</p>}
      <CardGrid cards={cards} quickAdd dimMissing langMode="owned" />
      {hasMore && <button className="btn btn-ghost btn-block" onClick={loadMore} disabled={loading}>{t('common.loadMore')}</button>}

      <button className="btn btn-ghost btn-block hunt-delete" onClick={remove}>
        <Icon name="trash" size={16} /> {t('hunts.delete')}
      </button>
    </div>
  );
}
