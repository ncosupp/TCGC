// « La table » : l'éditeur de deck de l'espace Jeu (maquette Editeur-deck de Refonte-UI-jeu, étape 2 ; règles dans
// game/ui/builder/table.ts). De haut en bas :
// - en-tête : retour, nom du deck (toucher pour renommer), puce Ranked (deck libre), « ••• » ;
// - la table : total et jauge, 8 piles par coût (toucher une pile filtre la réserve), chiffres +1000 / +2000 / év.
//   (filtres eux aussi), « Composition › » ;
// - la réserve : Toutes | Ma Cale (deck libre), filtre actif, loupe, Filtres, grille de 4 colonnes. Toucher une carte
//   l'ajoute, « − » en retire une, toucher son nom ouvre sa fiche. Glisser une carte sur la table l'ajoute aussi (souris :
//   directement ; doigt : appui long de 250 ms, puis glisser) ;
// - messages avec « Annuler », et un seul bouton plein en bas.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CARDS } from '../../../../game/engine/cards/index.ts';
import { DECK_SIZE, formatIssues, playableErrors, type Regulations } from '../../../../game/engine/deckRules.ts';
import { def } from '../../../../game/engine/rules.ts';
import { chooseAdventureDeck } from '../../../../game/ui/adventure/api.ts';
import { call } from '../../../../game/ui/api.ts';
import { DonPicker, VersionPicker } from '../../../../game/ui/builder/LooksPicker.tsx';
import {
  advice, canAdd, composition, copyName, deckTotal, filterReserve, keepForLeader, maxCopies, outOfHold, pileLabel, pileOf, rankedEligible,
  reservePool, type Attr, type DeckKind, type Hold, type ReserveFilter,
} from '../../../../game/ui/builder/table.ts';
import { artVersions } from '../../../../game/ui/builder/versions.ts';
import {
  deckPrices, deckText, deleteMyDeck, newDeckId, ownedNumbers, saveMyDeck, wishMissing, type CardCollection,
} from '../../../../game/ui/myDecks.ts';
import { saveQuickChoice, loadQuickChoice } from '../../../../game/ui/setup/config.ts';
import { navigate } from '../../../../game/ui/routes.ts';
import { formatEur } from '../../api';
import { tjd } from '../i18n/jeu-decks';
import { Caps, Icon, Rows, Sheet, Switch, cx } from '../kit';
import { GameSlot, cardTintOf } from './cards';
import { LeaderStep, NameStep } from './DeckSteps';
import { useAutosave, type Draft } from './useAutosave';
import './decks.css';

export interface TableProps {
  initial: Draft;
  kind: DeckKind;
  isNew: boolean;              // deck neuf (parcours « Nouveau deck ») : « Terminer » mène au nom
  hold: Hold | null;           // Cale par numéro (null : pas encore lue, ou illisible)
  holdVariants?: Record<string, Record<string, number>>;
  chosenId: string | null;     // deck d'aventure choisi
  onChosen?: (id: string | null) => void;
  onBackToLeader?: () => void; // deck neuf encore vide : le retour ramène au choix du Leader
  onExit: (message?: string) => void;
}

type Overlay = null | 'menu' | 'comp' | 'filters' | 'clear' | 'delete' | { card: string };
type Toast = { text: string; warn?: boolean; undo?: { num: string; by: number }; stamp: number } | null;

let regsCache: Regulations | null = null;
const PAGE = 48;

export function DeckTable({ initial, kind, isNew, hold, holdVariants, chosenId, onChosen, onBackToLeader, onExit }: TableProps) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [step, setStep] = useState<'table' | 'name' | 'leader'>('table');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [source, setSource] = useState<'all' | 'cale'>(kind === 'aventure' ? 'cale' : 'all');
  const [cost, setCost] = useState<number | null>(null);
  const [attr, setAttr] = useState<Attr | null>(null);
  const [category, setCategory] = useState<ReserveFilter['category']>(null);
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [owned, setOwned] = useState<Record<string, number> | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [pulse, setPulse] = useState<{ k: number; stamp: number } | null>(null);
  const [shake, setShake] = useState<{ num: string; stamp: number } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [artOf, setArtOf] = useState<string | null>(null);
  const [donOpen, setDonOpen] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [regs, setRegs] = useState<Regulations>(regsCache ?? {});
  const saver = useAutosave(draft, kind, !isNew);

  useEffect(() => {
    if (regsCache) return;
    call<Regulations>('GET', 'regulations').then((r) => { regsCache = r; setRegs(r); }, () => {});
  }, []);
  // la collection réelle n'est lue que si on filtre dessus (pont vers la Collection, deck libre)
  useEffect(() => {
    if (onlyOwned && !owned) ownedNumbers().then(setOwned, () => setOwned({}));
  }, [onlyOwned, owned]);

  const cards = draft.cards;
  const total = deckTotal(cards);
  const full = total >= DECK_SIZE;
  const comp = useMemo(() => composition(cards), [cards]);
  const pool = useMemo(() => reservePool(draft.leader, kind, hold), [draft.leader, kind, hold]);
  const filter: ReserveFilter = { source, cost, attr, category, query: searchOpen ? query : '', owned: onlyOwned ? owned ?? {} : null };
  const shown = useMemo(() => filterReserve(pool, filter, hold), [pool, source, cost, attr, category, query, searchOpen, onlyOwned, owned, hold]);
  useEffect(() => { setLimit(PAGE); }, [source, cost, attr, category, query, onlyOwned, draft.leader]);
  const out = outOfHold(cards, hold);
  const ranked = rankedEligible(draft.leader, cards, hold);
  const L = def(draft.leader);
  const isChosen = kind === 'aventure' && chosenId === draft.id;

  /* ---------- Messages ---------- */
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const say = (text: string, opts: { warn?: boolean; undo?: { num: string; by: number } } = {}) => {
    const stamp = Date.now();
    setToast({ text, stamp, ...opts });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => (t?.stamp === stamp ? null : t)), 3200);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /* ---------- Ajouter, retirer ---------- */
  const setCount = (num: string, n: number) => setDraft((d) => {
    const next = { ...d.cards };
    if (n <= 0) delete next[num];
    else next[num] = n;
    return { ...d, cards: next };
  });
  const add = (num: string): boolean => {
    const check = canAdd(cards, num, kind, hold);
    const name = CARDS[num].name;
    if (check !== 'ok') {
      setShake({ num, stamp: Date.now() });
      say(check === 'full' ? tjd('table.full') : check === 'hold' ? tjd('table.hold', { n: hold?.[num] ?? 0, name })
        : maxCopies(def(num), kind, hold) > 4 ? tjd('table.maxAny') : tjd('table.max'), { warn: true });
      return false;
    }
    const k = pileOf(CARDS[num].cost);
    setCount(num, (cards[num] ?? 0) + 1);
    setPulse({ k, stamp: Date.now() });
    say(tjd('table.added', { name, k: pileLabel(k) }), { undo: { num, by: -1 } });
    return true;
  };
  const remove = (num: string) => {
    const have = cards[num] ?? 0;
    if (!have) return;
    setCount(num, have - 1);
    setPulse({ k: pileOf(CARDS[num].cost), stamp: Date.now() });
    say(tjd('table.removed', { name: CARDS[num].name }), { undo: { num, by: 1 } });
  };
  const undo = () => {
    const u = toast?.undo;
    if (!u) return;
    setDraft((d) => {
      const next = { ...d.cards };
      const n = (next[u.num] ?? 0) + u.by;
      if (n <= 0) delete next[u.num];
      else next[u.num] = n;
      return { ...d, cards: next };
    });
    setToast(null);
  };

  /* ---------- Quitter ---------- */
  const leave = async (message?: string) => {
    if (leaving) return;
    setLeaving(true);
    const ok = await saver.saveNow();
    setLeaving(false);
    if (!ok && saver.atRisk()) { setUnsaved(true); return; }
    onExit(message);
  };
  const back = () => {
    if (isNew && !saver.stored.current && total === 0 && onBackToLeader) { onBackToLeader(); return; }
    void leave(isNew ? undefined : tjd('list.saved'));
  };
  // Retour du navigateur (ou d'Android) : l'adresse revient à Mes decks, la table se ferme et ce qui attend part
  // aussitôt (useAutosave) ; pas d'entrée d'historique par étape, qui se marcheraient dessus
  const finish = () => {
    if (isNew) { setStep('name'); return; }
    void leave(tjd('list.saved'));
  };

  /* ---------- Glisser une carte sur la table ---------- */
  const tableRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const drag = useRef<{ num: string; id: number; x0: number; y0: number; mouse: boolean; lifted: boolean; moved: boolean; over: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);
  const overTable = (x: number, y: number) => {
    const r = tableRef.current?.getBoundingClientRect();
    return Boolean(r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  };
  const placeGhost = (x: number, y: number) => {
    const g = ghostRef.current;
    if (g) g.style.transform = `translate(${x}px, ${y}px) translate(-50%, -60%) rotate(-6deg) scale(1.08)`;
  };
  const lift = (d: NonNullable<typeof drag.current>, x: number, y: number) => {
    d.lifted = true;
    setGhost(d.num);
    requestAnimationFrame(() => placeGhost(x, y));
    tableRef.current?.classList.add('tb-target');
    navigator.vibrate?.(8);
  };
  const endDrag = (drop: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    tableRef.current?.classList.remove('tb-target', 'tb-over');
    if (d.lifted) {
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      setGhost(null);
      if (drop && d.moved && d.over) add(d.num);
    }
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.lifted) {
      // souris : le glisser commence au premier mouvement ; doigt : un mouvement avant l'appui long, c'est un défilement
      if (d.mouse && far >= 6) lift(d, e.clientX, e.clientY);
      else if (!d.mouse && far >= 10) endDrag(false);
      return;
    }
    d.moved = true;
    placeGhost(e.clientX, e.clientY);
    const over = overTable(e.clientX, e.clientY);
    if (over !== d.over) {
      d.over = over;
      tableRef.current?.classList.toggle('tb-over', over);
    }
  };
  const onUp = (e: PointerEvent) => { if (drag.current && e.pointerId === drag.current.id) endDrag(true); };
  const onCancel = () => endDrag(false);
  const startDrag = (e: React.PointerEvent, num: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    endDrag(false);
    const d = { num, id: e.pointerId, x0: e.clientX, y0: e.clientY, mouse: e.pointerType === 'mouse', lifted: false, moved: false, over: false } as NonNullable<typeof drag.current>;
    drag.current = d;
    if (!d.mouse) d.timer = setTimeout(() => { if (drag.current === d && !d.moved) lift(d, d.x0, d.y0); }, 250);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };
  // carte soulevée au doigt : la réserve ne défile plus (le premier touchmove est encore annulable)
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (drag.current?.lifted && e.cancelable) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [step]);
  useEffect(() => () => endDrag(false), []);
  // réserve : la suite se charge en approchant du bas
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) setLimit((l) => l + PAGE); }, { root: scrollerRef.current, rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length > limit, step]);

  /* ---------- Étapes : Leader, nom ---------- */
  if (step === 'leader') {
    return (
      <LeaderStep kind={kind} hold={hold} current={draft.leader} changing onBack={() => setStep('table')}
        onPick={(leader) => {
          setDraft((d) => ({ ...d, leader, cards: keepForLeader(leader, d.cards) }));
          setStep('table');
          setCost(null);
          say(tjd('leader.changed', { name: CARDS[leader].name }));
        }} />
    );
  }
  if (step === 'name') {
    return (
      <NameStep draft={draft} kind={kind} hold={hold} rename={!isNew} busy={leaving}
        onBack={() => setStep('table')}
        onName={(name) => setDraft((d) => ({ ...d, name }))}
        onSave={async () => {
          if (!isNew) { setStep('table'); say(tjd('name.renamed', { name: draft.name.trim() })); return; }
          setLeaving(true);
          const ok = await saver.saveNow(true);
          setLeaving(false);
          if (!ok) { setUnsaved(true); return; }
          onExit(tjd(total < DECK_SIZE ? 'name.savedDraft' : 'name.saved', { name: draft.name.trim() }));
        }} />
    );
  }

  /* ---------- La table ---------- */
  const filterChip = [cost !== null ? tjd('table.cost', { k: pileLabel(cost) }) : null, attr ? tjd(`table.attr.${attr}`) : null,
    category ? tjd(`filters.${category}`) : null, onlyOwned ? tjd('filters.owned') : null].filter(Boolean).join(' · ');
  const clearFilters = () => { setCost(null); setAttr(null); setCategory(null); setOnlyOwned(false); };
  const rankedChip = kind === 'libre' && total > 0 && hold !== null;
  const lastPile = pulse?.k ?? -1;

  return (
    <div className="cale jeu jx-table" data-ui="editor" data-save={saver.status}>
      <div className="topbar tb-head">
        <button type="button" className="hit" data-ui="editor.back" aria-label={isNew && total === 0 && !saver.stored.current ? tjd('table.back') : tjd('table.backSave')} onClick={back}><Icon name="back" /></button>
        <button type="button" className="tb-name" aria-label={tjd('table.rename', { name: draft.name })} onClick={() => setStep('name')}>
          <span className="tb-name-t">{draft.name || '…'}</span>
          <span className="tb-name-m dim">{L.name} · {kind === 'libre' ? tjd('table.libre') : tjd('table.aventure')}</span>
        </button>
        {rankedChip && (
          <button type="button" className={cx('tb-ranked', ranked && 'tb-ok')} data-ui="editor.ranked"
            aria-label={out ? tjd('table.rankedAria', { n: out }) : tjd('table.rankedOk')}
            onClick={() => {
              if (!out) { say(tjd('table.rankedYes')); return; }
              setSource('cale');
              setCost(null);
              say(tjd('table.rankedFiltered', { n: out }));
            }}>
            <Icon name="trophy" small />{out ? tjd('table.rankedOut', { n: out }) : tjd('table.ranked')}
          </button>
        )}
        <button type="button" className="hit" data-ui="editor.menu" aria-label={tjd('table.options')} aria-haspopup="dialog" onClick={() => setOverlay('menu')}><Icon name="more" /></button>
      </div>

      <div ref={tableRef} className="tb-table" data-ui="editor.table">
        <div className="tb-count">
          <p><b>{total}</b><span className="dim"> / {DECK_SIZE}</span><span className={cx('tb-status', full && 'tb-ready')}>{full ? tjd('table.ready') : tjd('table.left', { n: DECK_SIZE - total })}</span></p>
          <span className="tb-gauge" aria-hidden="true"><i style={{ width: `${Math.min(100, (total / DECK_SIZE) * 100)}%` }} /></span>
        </div>
        <div className="tb-piles">
          {comp.piles.map((n, k) => {
            const sel = cost === k;
            return (
              <button key={k} type="button" className={cx('tb-pile', sel && 'tb-sel', k === lastPile && 'tb-last', n === 0 && 'tb-empty')}
                aria-pressed={sel} aria-label={tjd('table.pile', { k: pileLabel(k), n }) + (sel ? tjd('table.pileOn') : tjd('table.pileOff'))}
                onClick={() => setCost(sel ? null : k)}>
                <span key={k === lastPile ? pulse?.stamp : undefined} className={cx('tb-stack', k === lastPile && 'tb-pop')}>
                  {n > 0 && <>
                    {n > 2 && <i className="tb-layer l2" />}
                    {n > 1 && <i className="tb-layer l1" />}
                    <span className="c-slot tb-top"><span className="c-card" style={cardTintOf(draft.leader)} /></span>
                    <b className="tb-n">{n}</b>
                  </>}
                </span>
                <span className="tb-pl">{pileLabel(k)}</span>
              </button>
            );
          })}
        </div>
        {total === 0 ? <p className="tb-hint">{tjd('table.empty')}</p> : (
          <div className="tb-attrs">
            {(['c1', 'c2', 'e'] as Attr[]).map((a) => {
              const v = a === 'c1' ? comp.c1000 : a === 'c2' ? comp.c2000 : comp.events;
              const on = attr === a;
              return (
                <button key={a} type="button" className={cx('tb-attr', on && 'on')} aria-pressed={on}
                  aria-label={`${v} ${tjd(`table.attrLong.${a}`)}${on ? tjd('table.attrOn') : tjd('table.attrOff')}`} onClick={() => setAttr(on ? null : a)}>
                  <span><b>{v}</b> {tjd(`table.attr.${a}`)}</span>
                </button>
              );
            })}
            <span className="sp" />
            <button type="button" className="tb-comp" data-ui="editor.comp" onClick={() => setOverlay('comp')}>{tjd('table.comp')}<Icon name="next" className="ic-xs" /></button>
          </div>
        )}
      </div>

      <div className="tb-bar">
        {kind === 'libre' ? (
          <Caps label={tjd('table.src')} value={source} onChange={setSource}
            options={[{ value: 'all', label: tjd('table.srcAll') }, { value: 'cale', label: tjd('table.srcHold') }]} />
        ) : <p className="dim tb-holdonly">{tjd('table.holdOnly')}</p>}
        <span className="sp" />
        {filterChip && (
          <button type="button" className="tb-chip" aria-label={tjd('table.clear')} onClick={clearFilters}>
            <span>{filterChip}</span><Icon name="close" className="ic-xs" />
          </button>
        )}
        <button type="button" className={cx('hit', (category || onlyOwned) && 'tb-on')} data-ui="editor.filters" aria-label={tjd('table.filters')} onClick={() => setOverlay('filters')}><Icon name="filter" small /></button>
        <button type="button" className={cx('hit', searchOpen && 'tb-on')} aria-label={tjd('table.search')} aria-pressed={searchOpen} onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setQuery(''); }}><Icon name="search" small /></button>
      </div>
      {searchOpen && (
        <label className="field tb-search">
          <span className="tb-sr">{tjd('table.searchField')}</span>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tjd('table.searchField')} enterKeyHint="search" />
        </label>
      )}

      <div ref={scrollerRef} className="tb-reserve" data-ui="editor.reserve">
        <div className="tb-grid">
          {shown.slice(0, limit).map((num) => {
            const d = CARDS[num];
            const q = cards[num] ?? 0;
            const max = maxCopies(def(num), kind, hold);
            const atMax = q >= max;
            const off = q === 0 && (atMax || full);
            const inHold = (hold?.[num] ?? 0) > 0;
            return (
              <div key={num} className={cx('tb-cell', off && 'tb-off')}>
                <button type="button" className={cx('tb-card', q > 0 && 'tb-in', shake?.num === num && 'tb-shake')} key={shake?.num === num ? shake.stamp : undefined}
                  data-ui="editor.card" aria-label={tjd('table.cardAria', { name: d.name, cost: d.cost ?? 0, inDeck: q ? tjd('table.inDeck', { n: q }) : '' })}
                  onPointerDown={(e) => startDrag(e, num)} onContextMenu={(e) => e.preventDefault()}
                  onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } add(num); }}>
                  <GameSlot num={num} virtual={inHold}><span className="k">{d.cost ?? 0}</span></GameSlot>
                </button>
                {q > 0 && <>
                  <span className={cx('tb-badge', atMax && 'tb-max')} aria-hidden="true">{atMax && max <= 4 ? `${q}/${max}` : q}</span>
                  <button type="button" className="tb-minus" aria-label={tjd('table.minus', { name: d.name })} onClick={() => remove(num)}><span>−</span></button>
                </>}
                <button type="button" className="tb-cname" aria-label={tjd('table.see', { name: d.name })} onClick={() => setOverlay({ card: num })}>{d.name}</button>
              </div>
            );
          })}
        </div>
        {shown.length > limit && <div ref={sentinel} className="tb-more"><button type="button" className="btn line" onClick={() => setLimit((l) => l + PAGE)}>{tjd('table.more')}</button></div>}
        {!shown.length && (
          <p className="dim tb-noresult">{kind === 'aventure' && !pool.length ? tjd('table.noHold') : searchOpen && query.trim() ? tjd('table.noResult', { q: query.trim() }) : tjd('table.noResultCost')}</p>
        )}
      </div>

      {toast && (
        <div className="toast tb-toast" role="status" aria-live="polite">
          <span className={cx('sp', toast.warn && 'tb-warn')}>{toast.text}</span>
          {toast.undo && <button type="button" className="tb-undo" onClick={undo}>{tjd('table.undo')}</button>}
        </div>
      )}

      <div className="sheet-bar tb-foot">
        <button type="button" className="btn main" data-ui="editor.finish" disabled={leaving} onClick={finish}>
          {leaving ? tjd('table.saving') : isNew ? (full ? tjd('table.finish') : tjd('table.later')) : tjd('table.save')}
        </button>
      </div>

      {ghost && (
        <div ref={ghostRef} className="tb-ghost" aria-hidden="true">
          <GameSlot num={ghost} virtual={(hold?.[ghost] ?? 0) > 0} eager><span className="k">{CARDS[ghost].cost ?? 0}</span></GameSlot>
        </div>
      )}
      <p className="tb-sr" aria-live="polite">{ghost ? tjd('table.drop') : ''}</p>

      {/* ---------- Panneaux ---------- */}
      {typeof overlay === 'object' && overlay && (
        <CardSheet num={overlay.card} kind={kind} hold={hold} count={cards[overlay.card] ?? 0} full={full}
          onClose={() => setOverlay(null)} onAdd={() => add(overlay.card)} onRemove={() => remove(overlay.card)}
          onVersion={() => { const n = overlay.card; setOverlay(null); setArtOf(n); }} />
      )}
      <CompSheet open={overlay === 'comp'} onClose={() => setOverlay(null)} draft={draft} kind={kind} hold={hold} regs={regs}
        onAdd={add} onRemove={remove} />
      <FiltersSheet open={overlay === 'filters'} onClose={() => setOverlay(null)} kind={kind} draft={draft}
        category={category} setCategory={setCategory} attr={attr} setAttr={setAttr} onlyOwned={onlyOwned} setOnlyOwned={setOnlyOwned}
        onReset={clearFilters} />
      <Sheet open={overlay === 'menu'} onClose={() => setOverlay(null)} label={tjd('table.options')} className="tb-menu">
        <Rows>
          <MenuRow label={tjd('menu.rename')} onClick={() => { setOverlay(null); setStep('name'); }} />
          <MenuRow label={tjd('menu.leader')} onClick={() => { setOverlay(null); setStep('leader'); }} />
          {artVersions(draft.leader, CARDS[draft.leader]).length > 1 && <MenuRow ui="editor.art" label={tjd('menu.leaderArt')} onClick={() => { setOverlay(null); setArtOf(draft.leader); }} />}
          <MenuRow ui="editor.don" label={tjd('menu.don')} onClick={() => { setOverlay(null); setDonOpen(true); }} />
          {kind === 'aventure' && (isChosen
            ? <MenuRow label={tjd('menu.chosen')} disabled />
            : playableErrors(draft.leader, cards).length === 0 && <MenuRow label={tjd('menu.choose')} onClick={async () => {
              setOverlay(null);
              if (!(await saver.saveNow())) return;
              chooseAdventureDeck(draft.id).then((s) => { onChosen?.(s.deckId); say(tjd('chosen')); }, (e: Error) => say(e.message, { warn: true }));
            }} />)}
          {playableErrors(draft.leader, cards).length === 0 && (
            <MenuRow ui="editor.play" label={tjd('menu.play')} onClick={async () => {
              setOverlay(null);
              if (!(await saver.saveNow())) return;
              saveQuickChoice({ ...loadQuickChoice(), myDeck: draft.id });
              navigate({ name: 'rapide' });
            }} />
          )}
          <MenuRow label={tjd('menu.duplicate')} onClick={async () => {
            setOverlay(null);
            try {
              await saveMyDeck({ id: newDeckId(), name: copyName(draft.name.trim() || L.name), leader: draft.leader, cards, looks: draft.looks, ...(kind === 'aventure' ? { mode: 'aventure' as const } : {}) });
              await saver.saveNow();
              onExit(tjd('duplicated'));
            } catch (e) { say((e as Error).message, { warn: true }); }
          }} />
          <MenuRow label={tjd('menu.export')} onClick={() => {
            setOverlay(null);
            navigator.clipboard?.writeText(deckText(draft)).then(() => say(tjd('menu.exported')), () => {});
          }} />
          {total > 0 && <MenuRow label={tjd('menu.clear')} onClick={() => setOverlay('clear')} />}
          {isChosen
            ? <p className="dim tb-menu-note">{tjd('menu.chosenNoDelete')}</p>
            : <MenuRow danger label={isNew && !saver.stored.current ? tjd('menu.abandon') : tjd('menu.delete')} onClick={() => {
              if (isNew && !saver.stored.current) { onExit(tjd('abandoned')); return; }
              setOverlay('delete');
            }} />}
        </Rows>
      </Sheet>
      {overlay === 'clear' && (
        <Confirm title={tjd('confirm.clearT')} text={tjd('confirm.clearM', { n: total })} action={tjd('confirm.clear')} onCancel={() => setOverlay(null)}
          onConfirm={() => { setDraft((d) => ({ ...d, cards: {} })); setCost(null); setOverlay(null); say(tjd('cleared')); }} />
      )}
      {overlay === 'delete' && (
        <Confirm title={tjd('confirm.deleteT', { name: draft.name })} text={kind === 'aventure' ? tjd('confirm.deleteM') : tjd('confirm.deleteMLibre')}
          action={tjd('confirm.delete')} onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            setOverlay(null);
            try {
              await deleteMyDeck(draft.id);
              onExit(tjd('deleted'));
            } catch (e) { say((e as Error).message, { warn: true }); }
          }} />
      )}
      {unsaved && (
        <Confirm title={tjd('unsaved.title')} text={saver.error ?? tjd('name.empty')} action={tjd('unsaved.leave')} cancel={tjd('unsaved.stay')}
          onCancel={() => setUnsaved(false)} onConfirm={() => { setUnsaved(false); onExit(); }} />
      )}
      {artOf && (
        <VersionPicker num={artOf} chosen={draft.looks?.arts?.[artOf]} owned={kind === 'aventure' ? holdVariants?.[artOf] ?? {} : undefined} adventure={kind === 'aventure'}
          onPick={(v) => setDraft((d) => ({ ...d, looks: { ...d.looks, arts: { ...d.looks?.arts, [artOf]: v } } }))} onClose={() => setArtOf(null)} />
      )}
      {donOpen && <DonPicker chosen={draft.looks?.don} onPick={(id) => setDraft((d) => ({ ...d, looks: { ...d.looks, don: id } }))} onClose={() => setDonOpen(false)} />}
    </div>
  );
}

function MenuRow({ label, onClick, danger, disabled, ui }: { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; ui?: string }) {
  return (
    <button type="button" className={cx('row tb-menu-row', danger && 'tb-danger')} disabled={disabled} onClick={onClick} data-ui={ui}>
      <span className="row-main"><span className="row-t">{label}</span></span>
    </button>
  );
}

// Fenêtre de confirmation au centre (Vider la table, Supprimer le deck, quitter sans enregistrer)
export function Confirm({ title, text, action, cancel, onCancel, onConfirm }: {
  title: string; text: string; action: string; cancel?: string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="cale tb-confirm-layer">
      <div className="veil" onClick={onCancel} />
      <div className="tb-confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <p className="tb-confirm-t">{title}</p>
        <p className="dim tb-confirm-m">{text}</p>
        <div className="tb-confirm-b">
          <button type="button" className="btn line" autoFocus onClick={onCancel}>{cancel ?? tjd('cancel')}</button>
          <button type="button" className="btn c-danger" onClick={onConfirm}>{action}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Fiche d'une carte ---------- */

function CardSheet({ num, kind, hold, count, full, onClose, onAdd, onRemove, onVersion }: {
  num: string; kind: DeckKind; hold: Hold | null; count: number; full: boolean; onClose: () => void; onAdd: () => void; onRemove: () => void; onVersion: () => void;
}) {
  const d = CARDS[num];
  const max = maxCopies(def(num), kind, hold);
  const inHold = hold?.[num] ?? 0;
  const versions = artVersions(num, d).length;
  const meta = [tjd('card.cost', { k: d.cost ?? 0 }), tjd(`card.${d.category}` as 'card.CHARACTER'), d.counter ? tjd('card.counter', { n: d.counter }) : null,
    d.power !== null ? tjd('card.power', { n: d.power.toLocaleString('fr-FR') }) : null].filter(Boolean).join(' · ');
  return (
    <Sheet open onClose={onClose} label={d.name} className="tb-cardsheet">
      <div className="tb-cs-top">
        <GameSlot num={num} virtual={inHold > 0} eager className="tb-cs-img" />
        <div className="tb-cs-info">
          <h2 className="h">{d.name}</h2>
          <p className="dim">{meta}</p>
          {d.typeLabels.length > 0 && <p className="dim">{d.typeLabels.join(' · ')}</p>}
          {hold && <p className={inHold ? 'sea' : 'dim'}>{inHold ? tjd('card.inHold', { n: inHold }) : tjd('card.notInHold')}</p>}
        </div>
      </div>
      {(d.effect || d.trigger) && (
        <div className="tb-cs-text">
          {d.effect && <p>{d.effect}</p>}
          {d.trigger && <p>{tjd('card.trigger', { text: d.trigger })}</p>}
        </div>
      )}
      {versions > 1 && <button type="button" className="link tb-cs-version" onClick={onVersion}><Icon name="image" small />{tjd('card.version', { n: versions })}</button>}
      <div className="tb-cs-step">
        <p>{tjd('card.inDeck')}<span className="dim">{max <= 4 ? tjd('card.atMost', { n: max }) : ''}</span></p>
        <span className="step">
          <button type="button" aria-label={tjd('table.minus', { name: d.name })} disabled={count <= 0} onClick={onRemove}><Icon name="minus" small /></button>
          <b>{count}</b>
          <button type="button" aria-label={tjd('table.plus', { name: d.name })} disabled={count >= max || full} onClick={onAdd}><Icon name="plus" small /></button>
        </span>
      </div>
    </Sheet>
  );
}

/* ---------- Composition ---------- */

function CompSheet({ open, onClose, draft, kind, hold, regs, onAdd, onRemove }: {
  open: boolean; onClose: () => void; draft: Draft; kind: DeckKind; hold: Hold | null; regs: Regulations; onAdd: (num: string) => boolean; onRemove: (num: string) => void;
}) {
  if (!open) return null;
  const cards = draft.cards;
  const total = deckTotal(cards);
  const comp = composition(cards);
  const peak = Math.max(1, ...comp.piles);
  const tip = advice(comp);
  const out = outOfHold(cards, hold);
  const rules = playableErrors(draft.leader, cards).filter((e) => !/^\d+ cartes au lieu de/.test(e));
  const official = kind === 'libre' ? formatIssues(draft.leader, cards, regs).errors : [];
  const stats: [string, number][] = [
    [tjd('comp.chars'), comp.characters], [tjd('comp.events'), comp.events], [tjd('comp.stages'), comp.stages],
    [tjd('comp.c1'), comp.c1000], [tjd('comp.c2'), comp.c2000], [tjd('comp.none'), comp.noCounter],
  ];
  const list = Object.entries(cards).sort(([a], [b]) => (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0) || CARDS[a].name.localeCompare(CARDS[b].name));
  return (
    <Sheet open onClose={onClose} label={tjd('comp.title')} className="tb-compsheet">
      <h2 className="title tb-comp-title">{tjd('comp.title')}</h2>
      <p className="dim">{total} / {DECK_SIZE} · {total >= DECK_SIZE ? tjd('table.ready') : tjd('table.left', { n: DECK_SIZE - total })}</p>
      <div className="tb-curve" aria-hidden="true">
        {comp.piles.map((n, k) => (
          <span key={k} className="tb-bin"><span className="num">{n || ''}</span><i className={n ? 'on' : undefined} style={{ height: n ? Math.max(3, Math.round((n / peak) * 48)) : 1 }} /></span>
        ))}
      </div>
      <div className="tb-curve-l">{comp.piles.map((_, k) => <span key={k} className="num dim">{pileLabel(k)}</span>)}</div>
      <div className="tb-stats">{stats.map(([l, v]) => <div key={l}><p className="tb-stat-v">{v}</p><p className="dim tb-stat-l">{l}</p></div>)}</div>
      {total > 0 && <p className="tb-advice">{tjd(`advice.${tip.key}`, tip.key === 'fewCounters' ? { n: tip.n } : {})}</p>}
      {kind === 'libre' && hold && out > 0 && <p className="tb-note">{tjd('comp.rankedNote', { n: out })}</p>}
      {rules.length > 0 && <div className="tb-note"><p className="over">{tjd('comp.rules')}</p>{rules.map((e) => <p key={e}>{e}</p>)}</div>}
      {official.length > 0 && <div className="tb-note"><p className="over">{tjd('comp.official')}</p>{official.map((e) => <p key={e}>{e}</p>)}</div>}
      {list.length === 0 ? <p className="dim tb-noresult">{tjd('comp.empty')}</p> : (
        <Rows className="tb-comp-rows">
          {list.map(([num, n]) => {
            const d = CARDS[num];
            const extra = kind === 'libre' && hold && n > (hold[num] ?? 0) ? ` · ${tjd('comp.outHold', { n: n - (hold[num] ?? 0) })}` : '';
            const cat = d.category === 'EVENT' ? tjd('card.EVENT') : d.category === 'STAGE' ? tjd('card.STAGE') : d.counter ? `+${d.counter}` : tjd('comp.none');
            return (
              <div key={num} className="row tb-comp-row">
                <span className="num dim tb-comp-k">{d.cost ?? 0}</span>
                <span className="row-main"><span className="row-t">{d.name}</span><span className="row-m">{cat}{extra}</span></span>
                <span className="step">
                  <button type="button" aria-label={tjd('table.minus', { name: d.name })} onClick={() => onRemove(num)}><Icon name="minus" small /></button>
                  <b>{n}</b>
                  <button type="button" aria-label={tjd('table.plus', { name: d.name })} disabled={canAdd(cards, num, kind, hold) !== 'ok'} onClick={() => onAdd(num)}><Icon name="plus" small /></button>
                </span>
              </div>
            );
          })}
        </Rows>
      )}
    </Sheet>
  );
}

/* ---------- Filtres et pont vers la collection réelle ---------- */

function FiltersSheet({ open, onClose, kind, draft, category, setCategory, attr, setAttr, onlyOwned, setOnlyOwned, onReset }: {
  open: boolean; onClose: () => void; kind: DeckKind; draft: Draft;
  category: ReserveFilter['category']; setCategory: (c: ReserveFilter['category']) => void;
  attr: Attr | null; setAttr: (a: Attr | null) => void; onlyOwned: boolean; setOnlyOwned: (on: boolean) => void; onReset: () => void;
}) {
  const [prices, setPrices] = useState<Record<string, CardCollection> | null>(null);
  const [wishLang, setWishLang] = useState<'fr' | 'en'>('fr');
  const [wished, setWished] = useState<string | null>(null);
  const numbers = [draft.leader, ...Object.keys(draft.cards)].join();
  useEffect(() => {
    if (!open || kind !== 'libre') return;
    setPrices(null);
    deckPrices([draft.leader, ...Object.keys(draft.cards)]).then(setPrices, () => setPrices({}));
  }, [open, numbers]);
  if (!open) return null;
  const needed: [string, number][] = [[draft.leader, 1], ...Object.entries(draft.cards)];
  const missing = prices ? needed.map(([num, n]) => [num, Math.max(0, n - (prices[num]?.owned ?? 0))] as [string, number]).filter(([, m]) => m > 0) : [];
  const missingCount = missing.reduce((s, [, m]) => s + m, 0);
  const cost = missing.reduce((s, [num, m]) => s + m * (prices?.[num]?.cheapest?.eur ?? 0), 0);
  const toWish = Object.fromEntries(missing.filter(([num]) => !prices?.[num]?.wished));
  const chip = (on: boolean, label: string, run: () => void) => <button type="button" className={cx('chip', on && 'on')} aria-pressed={on} onClick={run}>{label}</button>;
  return (
    <Sheet open onClose={onClose} label={tjd('filters.title')} className="tb-filters"
      bar={<><button type="button" className="btn line" onClick={onReset}>{tjd('filters.reset')}</button><button type="button" className="btn main tb-grow" onClick={onClose}>{tjd('filters.done')}</button></>}>
      <h2 className="h">{tjd('filters.title')}</h2>
      <p className="over tb-f-over">{tjd('filters.category')}</p>
      <div className="chips">
        {chip(!category, tjd('filters.any'), () => setCategory(null))}
        {(['CHARACTER', 'EVENT', 'STAGE'] as const).map((c) => chip(category === c, tjd(`filters.${c}`), () => setCategory(category === c ? null : c)))}
      </div>
      <p className="over tb-f-over">{tjd('filters.counter')}</p>
      <div className="chips">
        {chip(!attr, tjd('filters.any'), () => setAttr(null))}
        {(['c1', 'c2'] as const).map((a) => chip(attr === a, tjd(`filters.${a}`), () => setAttr(attr === a ? null : a)))}
      </div>
      {kind === 'libre' && (
        <section className="tb-bridge">
          <p className="over gold">{tjd('filters.collection')}</p>
          <div className="row tb-bridge-row">
            <span className="glyph gold"><Icon name="collection" /></span>
            <span className="row-main"><span className="row-t">{tjd('filters.owned')}</span><span className="row-m">{tjd('filters.ownedMeta')}</span></span>
            <Switch on={onlyOwned} onChange={setOnlyOwned} label={tjd('filters.owned')} />
          </div>
          <div className="tb-bridge-price">
            <p className="row-t">{tjd('filters.price')}</p>
            <p className="dim">{!prices ? tjd('filters.priceLoading') : !missingCount ? tjd('filters.priceAll') : tjd('filters.priceMissing', { n: missingCount, eur: formatEur(cost) })}</p>
            {prices && Object.keys(toWish).length > 0 && (
              <div className="tb-bridge-wish">
                <Caps label="VF / VO" value={wishLang} onChange={setWishLang} options={[{ value: 'fr', label: 'VF' }, { value: 'en', label: 'VO' }]} />
                <button type="button" className="btn line" onClick={() => wishMissing(toWish, wishLang).then((r) => { setWished(tjd('filters.wished', { n: r.added })); setPrices(null); deckPrices(needed.map(([n]) => n)).then(setPrices, () => {}); }, (e: Error) => setWished(e.message))}>
                  {tjd('filters.wish')}
                </button>
              </div>
            )}
            {wished && <p className="gold tb-bridge-done">{wished}</p>}
          </div>
        </section>
      )}
    </Sheet>
  );
}

export type { Draft };
export function TableLoading({ children }: { children?: ReactNode }) {
  return <div className="cale jeu jx-table tb-loading"><p className="dim">{children ?? tjd('table.open')}</p></div>;
}
