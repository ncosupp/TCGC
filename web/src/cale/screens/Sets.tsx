// Collection › Sets (maquette Sets-style) : un set par ligne, mini-page, valeur, taux Full set
import { useEffect, useRef, useState } from 'react';
import { api, formatEur, type RarityCount, type SetSummary } from '../../api';
import { DeckSheet } from '../../components/DeckSheet';
import { readPref, writePref } from '../../prefs';
import { useApp } from '../../store';
import { tsets } from '../i18n/sets';
import { Caps, Icon, Meter, Mini, Spinner, type MiniDot } from '../kit';
import { Legacy } from '../kit/Legacy';
import { CollectionHeader, pctText, ratioDots } from './hunts/shared';
import './sets.css';

type Sort = 'recent' | 'code';
type Scope = 'mine' | 'all';
type Counts = { owned: number; total: number };

// Taux Full set : même calcul que la page d'un set en mode Full (cartes normales ; un set sans carte normale
// n'a que son Master set)
function fullSetCounts(rows: RarityCount[]): Counts {
  const hasBase = rows.some((r) => !r.alt);
  return rows.filter((r) => !hasBase || !r.alt).reduce((a, r) => ({ owned: a.owned + r.owned, total: a.total + r.total }), { owned: 0, total: 0 });
}

const compare: Record<Sort, (a: SetSummary, b: SetSummary) => number> = {
  recent: (a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''),
  code: (a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, 'fr', { numeric: true }),
};

export function Sets() {
  const { version } = useApp();
  const [lists, setLists] = useState<{ mine: SetSummary[]; all: SetSummary[] } | null>(null);
  const [scope, setScope] = useState<Scope>(() => (readPref('tcgc.allSets', ['1', '0'] as const, '0') === '1' ? 'all' : 'mine'));
  const [sort, setSort] = useState<Sort>(() => readPref('tcgc.setSort', ['recent', 'code'] as const, 'recent'));
  const [full, setFull] = useState<Record<number, Counts>>({});
  const [deckOpen, setDeckOpen] = useState(false);
  const loaded = useRef<{ version: number; ids: Set<number> }>({ version: -1, ids: new Set() });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.collectionSets(false), api.collectionSets(true)])
      .then(([mine, all]) => { if (!cancelled) setLists({ mine, all }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [version]);

  const shown = lists && [...lists[scope]].sort(compare[sort]);

  // Taux Full set des sets affichés : un appel par set (6 à la fois), comme la page du set
  useEffect(() => {
    if (!lists) return;
    if (loaded.current.version !== version) loaded.current = { version, ids: new Set() };
    const todo = lists[scope].map((s) => s.id).filter((id) => !loaded.current.ids.has(id));
    todo.forEach((id) => loaded.current.ids.add(id));
    let cancelled = false;
    const run = async () => {
      while (todo.length && !cancelled) {
        const id = todo.shift()!;
        try {
          const rows = await api.setRarities(id);
          if (!cancelled) setFull((f) => ({ ...f, [id]: fullSetCounts(rows) }));
        } catch { loaded.current.ids.delete(id); }
      }
    };
    for (let i = 0; i < 6; i++) void run();
    return () => { cancelled = true; todo.forEach((id) => loaded.current.ids.delete(id)); };
  }, [lists, scope, version]);

  const changeScope = (next: Scope) => { setScope(next); writePref('tcgc.allSets', next === 'all' ? '1' : '0'); };
  const toggleSort = () => { const next = sort === 'recent' ? 'code' : 'recent'; setSort(next); writePref('tcgc.setSort', next); };

  return (
    <div className="st">
      <CollectionHeader active="sets" />
      <div className="st-bar">
        <Caps<Scope> label={tsets('caps.label')} value={scope} onChange={changeScope} options={[
          { value: 'mine', label: tsets('caps.mine', { n: lists?.mine.length ?? 0 }) },
          { value: 'all', label: tsets('caps.all', { n: lists?.all.length ?? 0 }) },
        ]} />
        <button type="button" className="link" aria-label={tsets(sort === 'recent' ? 'sort.aria.recent' : 'sort.aria.code')} onClick={toggleSort}>
          {tsets(sort === 'recent' ? 'sort.recent' : 'sort.code')} <Icon name="down" small />
        </button>
      </div>

      {!shown && <Spinner />}
      {shown && shown.length === 0 && <p className="dim st-empty">{tsets('empty')}</p>}
      <div className="st-list">
        {shown?.map((s) => <SetRow key={s.id} set={s} counts={full[s.id]} />)}
      </div>

      <p className="dim st-note">{tsets('rate')}</p>
      <div className="st-deck">
        <button type="button" className="btn line" onClick={() => setDeckOpen(true)}><Icon name="plus" small />{tsets('deck')}</button>
      </div>
      {deckOpen && <Legacy><DeckSheet onClose={() => setDeckOpen(false)} /></Legacy>}
    </div>
  );
}

function SetRow({ set, counts }: { set: SetSummary; counts: Counts | undefined }) {
  const value = formatEur(set.valueEur);
  const own = counts?.owned ?? 0;
  const total = counts?.total ?? 0;
  const dots: MiniDot[] = counts ? ratioDots(own, total) : ratioDots(0, 1);
  return (
    <a className="st-set" href={`#collection/set/${set.id}`}
      aria-label={counts ? tsets('set.aria', { name: set.name, own, total, value }) : undefined}>
      <Mini dots={dots} full={!!counts && total > 0 && own === total} />
      <span className="st-m">
        <span className="st-top"><span className="over st-code">{set.code ?? set.name}</span><span className="st-val">{value}</span></span>
        <span className="st-n">{set.name}</span>
        <Meter ratio={counts ? own / Math.max(1, total) : 0} />
        <span className="st-c"><span>{counts ? `${own} / ${total}` : '…'}</span><span>{counts ? pctText(own / Math.max(1, total)) : ''}</span></span>
      </span>
    </a>
  );
}
