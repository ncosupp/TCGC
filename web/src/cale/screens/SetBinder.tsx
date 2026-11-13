// Page d'un set en classeur (maquette Classeur) : pochettes 3 × 3 paginées, Full set / Master set, barres de rareté,
// en-tête qui se replie, Ajout rapide, vue d'ensemble des pages, panneau d'une pochette vide.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, cardName, formatEur, type Card, type Lang, type RarityCount, type SetScope, type SetSummary } from '../../api';
import { locale } from '../../i18n';
import { readPref, writePref } from '../../prefs';
import { useApp } from '../../store';
import { DeckSheet } from '../../components/DeckSheet';
import { Legacy } from '../kit/Legacy';
import { Binder, Caps, Icon, Meter, Mini, miniDots, Pocket, Row, Rows, Sheet, Slot, Spinner } from '../kit';
import { ts } from '../i18n/setbinder';
import './setbinder.css';

const PER_PAGE = 9;
const SET_MODES = ['full', 'master'] as const;
type SetMode = typeof SET_MODES[number];

// Les rangs du set (rarities) : Full set = cartes normales, Master set = toutes les versions (même calcul que l'ancienne page)
const rarityKey = (r: RarityCount) => `${r.rarity}${r.alt ? ':alt' : ''}`;
const sumCounts = (rows: RarityCount[]) => rows.reduce((a, r) => ({ owned: a.owned + r.owned, total: a.total + r.total }), { owned: 0, total: 0 });

function setScope(rarities: RarityCount[] | null, mode: SetMode, rarity: string) {
  const hasBase = rarities?.some((r) => !r.alt) ?? true;
  const effMode: SetMode = hasBase ? mode : 'master';
  const inMode = (rarities ?? []).filter((r) => effMode === 'master' || !r.alt);
  const options = inMode.filter((r) => r.rarity);
  const active = options.find((r) => rarityKey(r) === rarity) ?? null;
  const query: SetScope = active
    ? { rarity: active.rarity ?? undefined, kind: active.alt ? 'special' : 'normal' }
    : { kind: effMode === 'full' ? 'normal' : undefined };
  return { hasBase, effMode, options, active, query, counts: sumCounts(active ? [active] : inMode), all: sumCounts(inMode) };
}

async function fetchAll(setId: number, kind?: 'normal') {
  const out: Card[] = [];
  for (;;) {
    const res = await api.cards({ set: String(setId), kind, sort: 'number', limit: 250, offset: out.length });
    out.push(...res.cards);
    if (out.length >= res.total || res.cards.length === 0) return out;
  }
}

// Numéro court d'une carte (OP14-011 → 011)
const shortNo = (card: Card) => card.number.split('-').pop() ?? card.number;

// Version d'une carte non normale, en capitales courtes (ALT, SP, MANGA…)
function versionLabel(card: Card) {
  const v = card.variant ?? '';
  if (/alternate/i.test(v)) return 'ALT';
  if (/^sp\b/i.test(v)) return 'SP';
  if (/manga/i.test(v)) return 'MANGA';
  return (v.split(/[\s·]+/)[0] || 'ALT').slice(0, 5).toUpperCase();
}

const percent = (ratio: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(ratio);

const RARITY_NAMES = ['C', 'UC', 'R', 'SR', 'SEC', 'L', 'TR', 'DON!!'];
function rarityName(r: string | null) {
  return r && RARITY_NAMES.includes(r) ? ts(`r.${r}` as 'r.C') : r ?? '';
}

function rarityLabel(r: RarityCount) {
  const name = r.rarity === 'L' ? ts('rar.leader') : r.rarity ?? '';
  return r.alt ? ts('rar.alt', { r: name }) : name;
}

export function SetBinder({ setId }: { setId: number }) {
  const { version, lang, openCard, toast, cardChanged, wishChanged } = useApp();
  const [summary, setSummary] = useState<SetSummary | null>(null);
  const [rarities, setRarities] = useState<RarityCount[] | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [normalIds, setNormalIds] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<SetMode>(() => readPref('tcgc.setMode', SET_MODES, 'full'));
  const [rarity, setRarity] = useState('');
  const [page, setPage] = useState(0);
  const [overview, setOverview] = useState(false);
  const [todoOnly, setTodoOnly] = useState(false);
  const [quick, setQuick] = useState(false);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [compact, setCompact] = useState(false);
  const [menu, setMenu] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [sheetLang, setSheetLang] = useState<Lang>(lang);
  const track = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);
  pageRef.current = page;

  // Autre set (le composant reste monté quand seule l'adresse change) : on repart de zéro
  useEffect(() => {
    setSummary(null); setRarities(null); setCards(null); setRarity(''); setPage(0); setOverview(false); setQuick(false); setFlash(new Set());
  }, [setId]);

  useEffect(() => {
    let cancelled = false;
    api.collectionSets(true).then((list) => { if (!cancelled) setSummary(list.find((s) => s.id === setId) ?? null); }).catch(() => {});
    api.setRarities(setId).then((r) => { if (!cancelled) setRarities(r); }).catch(() => {});
    Promise.all([fetchAll(setId), fetchAll(setId, 'normal')])
      .then(([all, normal]) => { if (!cancelled) { setCards(all); setNormalIds(new Set(normal.map((c) => c.id))); } })
      .catch((err: Error) => { if (!cancelled) toast(err.message); });
    return () => { cancelled = true; };
    // toast est recréé par le store : version suffit à recharger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId, version]);

  // En-tête replié au défilement : un en-tête plus court que le complet, posé par-dessus (pas de saut de page)
  useEffect(() => {
    if (overview) return;
    const onScroll = () => setCompact(window.scrollY > 150);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overview]);

  const scope = setScope(rarities, mode, rarity);

  const shown = useMemo(() => {
    const list = (cards ?? []).filter((c) => {
      const normal = normalIds.has(c.id);
      if (scope.effMode === 'full' && !normal) return false;
      if (scope.active) return c.rarity === scope.active.rarity && (scope.active.alt ? !normal : normal);
      return true;
    });
    // Ordre des numéros du serveur (OP14-… puis EB04-…) ; Master set : chaque version juste après sa carte normale
    const order = new Map<string, number>();
    (cards ?? []).forEach((c, i) => { if (!order.has(c.number)) order.set(c.number, i); });
    return list.sort((a, b) =>
      (order.get(a.number)! - order.get(b.number)!)
      || Number(normalIds.has(b.id)) - Number(normalIds.has(a.id))
      || (a.variant ?? '').localeCompare(b.variant ?? '') || a.id - b.id);
  }, [cards, normalIds, scope.effMode, scope.active]);

  const pages = useMemo(() => {
    const out: Card[][] = [];
    for (let i = 0; i < shown.length; i += PER_PAGE) out.push(shown.slice(i, i + PER_PAGE));
    return out;
  }, [shown]);
  const pageCount = pages.length;
  const cur = Math.min(page, Math.max(0, pageCount - 1));

  const progress = rarities ? scope.all : { owned: summary?.owned ?? 0, total: summary?.total ?? 0 };
  const ratio = progress.total ? progress.owned / progress.total : 0;
  const modeName = scope.effMode === 'full' ? ts('full') : ts('master');
  const code = summary?.code ?? '…';
  const unwished = shown.filter((c) => c.owned === 0 && !c.wish);

  // Retour du classeur (vue d'ensemble fermée, filtre changé) : se replace sur la page courante
  useLayoutEffect(() => {
    const el = track.current;
    if (!el || overview) return;
    if (Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) !== pageRef.current) el.scrollLeft = pageRef.current * el.clientWidth;
  }, [overview, mode, rarity, pageCount, cards === null]);

  const goPage = (i: number, smooth = false) => {
    const el = track.current;
    setPage(i);
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  };

  const changeMode = (next: SetMode) => {
    setMode(next); setRarity(''); setPage(0); writePref('tcgc.setMode', next);
  };
  const changeRarity = (key: string) => { setRarity(key); setPage(0); };

  const patch = useCallback((card: Card) => setCards((list) => list && list.map((c) => (c.id === card.id ? card : c))), []);
  const displayLang = (c: Card): Lang => (c.ownedByLang.fr > 0 ? 'fr' : c.ownedByLang.en > 0 ? 'en' : lang);
  const langName = (l: Lang) => ts(l === 'fr' ? 'lang.fr' : 'lang.en');

  // Range un exemplaire de plus ; le toast permet d'annuler
  const store = async (card: Card, l: Lang) => {
    try {
      const res = await api.add(card.id, 1, l);
      patch(res.card);
      cardChanged(res.card, res.totals);
      setFlash((s) => new Set(s).add(card.id));
      toast(
        <><b className="sb-strong">{ts('stored', { name: cardName(card, l), no: shortNo(card) })}</b> <span className="dim">{ts('stored.in', { lang: langName(l) })}</span></>,
        {
          label: ts('undo'),
          run: () => {
            api.add(card.id, -1, l)
              .then((undone) => {
                patch(undone.card);
                cardChanged(undone.card, undone.totals);
                setFlash((s) => { const next = new Set(s); next.delete(card.id); return next; });
              })
              .catch((err: Error) => toast(err.message));
          },
        },
      );
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const touch = (card: Card) => {
    if (quick) void store(card, lang);
    else if (card.owned > 0) openCard(card.id, displayLang(card));
    else { setSheetLang(lang); setSheetId(card.id); }
  };

  const sheetCard = sheetId == null ? null : cards?.find((c) => c.id === sheetId) ?? null;

  const toggleWish = async (card: Card) => {
    try {
      const res = card.wish ? await api.unwish(card.id) : await api.wish(card.id, { lang: sheetLang });
      patch(res.card);
      wishChanged();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const wishAll = async () => {
    setMenu(false);
    try {
      const { added } = await api.wishMissing(setId, lang, scope.query);
      wishChanged();
      toast(ts('wished', { n: added }));
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const range = (list: Card[]) => {
    const a = shortNo(list[0]); const b = shortNo(list[list.length - 1]);
    return a === b ? a : ts('page.range', { from: a, to: b });
  };

  const moreButton = (
    <button type="button" className="hit" aria-label={ts('more')} onClick={() => setMenu(true)}><Icon name="more" /></button>
  );

  // Coût pour compléter la vue (Full ou Master set, rareté choisie) : prix des pochettes vides qui ont un prix
  const missingCards = shown.filter((c) => c.owned === 0);
  const missingCost = missingCards.reduce((sum, c) => sum + (c.price.eur ?? 0), 0);
  const unpricedMissing = missingCards.filter((c) => c.price.eur == null).length;
  const isStarter = /^ST-?\d/.test(summary?.code ?? '');

  const missingOf = (list: Card[]) => list.filter((c) => c.owned === 0).length;
  const completePages = pages.filter((p) => missingOf(p) === 0).length;
  const todoPages = pageCount - completePages;

  /* ---------- Vue d'ensemble des pages ---------- */
  if (overview) {
    return (
      <div className="sb">
        <div className="sb-ch">
          <button type="button" className="hit" aria-label={ts('pages.backTo', { n: cur + 1 })} onClick={() => setOverview(false)}><Icon name="close" /></button>
          <div className="sb-ch-t"><b>{ts('pages.title', { n: pageCount })}</b><span>{code} · {scope.effMode === 'full' ? ts('fullSet') : ts('masterSet')}</span></div>
          <span className="sb-ch-gap" />
        </div>
        <Meter ratio={ratio} />
        <div className="sb-ovtools">
          <Caps label={ts('pages.todo')} value={todoOnly ? 'todo' : 'all'} onChange={(v) => setTodoOnly(v === 'todo')}
            options={[
              { value: 'all', label: ts('pages.all') },
              { value: 'todo', label: <>{ts('pages.todo')} <span className="dim">{todoPages}</span></> },
            ]} />
          <span className="dim sb-done">{ts('pages.done', { n: completePages })}</span>
        </div>
        <div className="sb-pages">
          {pages.map((p, i) => ({ p, i, missing: missingOf(p) })).filter((x) => !todoOnly || x.missing > 0).map(({ p, i, missing }) => (
            <button key={i} type="button" className={`sb-pg${missing === 0 ? ' full' : ''}${i === cur ? ' cur' : ''}`}
              aria-label={missing === 0 ? ts('pages.labelDone', { n: i + 1 }) : ts('pages.labelMissing', { n: i + 1, m: missing })}
              onClick={() => { setOverview(false); setPage(i); }}>
              <Mini dots={miniDots(p.map((c) => c.owned > 0))} full={missing === 0} />
              <span className="sb-pg-l"><span>p. {i + 1}</span><b>{missing === 0 ? ts('page.complete') : ts('pages.state', { n: p.length - missing, total: p.length })}</b></span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ---------- Classeur ---------- */
  const date = summary?.releaseDate
    ? new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(summary.releaseDate))
    : null;

  return (
    <div className="sb">
      {/* En-tête replié : une ligne, posée par-dessus quand l'en-tête complet est sorti de l'écran */}
      <div className="sb-sticky">
        <div className="sb-chw" hidden={!compact}>
          <div className="sb-ch">
            <a className="hit" href="#collection" aria-label={ts('back')}><Icon name="back" /></a>
            <div className="sb-ch-t"><b>{code}</b><span>{percent(ratio)} · {progress.owned} / {progress.total} · {modeName}</span></div>
            {moreButton}
          </div>
          <Meter ratio={ratio} />
        </div>
      </div>

      <div className="topbar">
        <a className="hit" href="#collection" aria-label={ts('back')}><Icon name="back" /></a>
        <span className="sp" />
        {moreButton}
      </div>
      <section className="sb-hero">
        <p className="over">{code}{date ? ` — ${date}` : ''}</p>
        <h2 className="title">{summary?.name ?? ''}</h2>
        <div className="sb-fig">
          <p className="display">{Math.round(ratio * 100)}<small>%</small></p>
          <p className="sb-of"><b>{progress.owned}</b> / {progress.total}<br />{scope.effMode === 'full' ? ts('ofCards') : ts('ofVersions')}</p>
          <span className="sp" />
          {scope.hasBase && (
            <Caps label={ts('mode')} value={scope.effMode} onChange={changeMode}
              options={[{ value: 'full', label: ts('full') }, { value: 'master', label: ts('master') }]} />
          )}
        </div>
        <Meter ratio={ratio} style={{ marginTop: 16 }} />
      </section>

      {scope.options.length > 1 && (
        <div className="sb-rar" role="group" aria-label={ts('rar.label')}>
          {[{ key: '', label: ts('rar.all'), ...scope.all }, ...scope.options.map((r) => ({ key: rarityKey(r), label: rarityLabel(r), owned: r.owned, total: r.total }))]
            .map((r) => {
              const all = r;
              return (
                <button key={r.key} type="button" aria-pressed={rarity === r.key}
                  className={`sb-r${rarity === r.key ? ' on' : ''}${all.total > 0 && all.owned >= all.total ? ' done' : ''}`}
                  onClick={() => changeRarity(r.key)}>
                  <span className="k">{r.label}</span>
                  <span className="n">{all.owned} / {all.total}</span>
                  <span className="t"><i style={{ width: `${all.total ? (100 * all.owned) / all.total : 0}%` }} /></span>
                </button>
              );
            })}
        </div>
      )}

      {quick && (
        <div className="sb-qa">
          <div className="sp"><b>{ts('quick.title')}</b><span>{ts(lang === 'fr' ? 'quick.fr' : 'quick.en')}</span></div>
          <button type="button" className="sb-pill" onClick={() => setQuick(false)}>{ts('quick.done')}</button>
        </div>
      )}

      {cards === null ? <Spinner /> : pageCount === 0 ? <p className="dim sb-empty">{ts('empty')}</p> : (
        <>
          <div className="sb-pagehead">
            <button type="button" className="sb-pagebtn" aria-label={ts('page.allPages')} onClick={() => setOverview(true)}>
              <b>{ts('page', { n: cur + 1 })}</b>{' '}
              <span className="dim">· {range(pages[cur])} · {scope.effMode === 'full' || scope.active
                ? (missingOf(pages[cur]) > 0 ? ts('page.missing', { n: missingOf(pages[cur]) }) : ts('page.complete'))
                : ts('page.of', { n: pageCount })}</span>
            </button>
            <button type="button" className="hit" aria-label={ts('page.next')} disabled={cur >= pageCount - 1}
              onClick={() => goPage(cur + 1, true)}><Icon name="next" /></button>
          </div>
          <div className="sb-track" ref={track} onScroll={(e) => {
            const el = e.currentTarget;
            const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (i !== pageRef.current && i < pageCount) setPage(i);
          }}>
            {pages.map((p, i) => (
              <div key={i} className="sb-slide" aria-hidden={i !== cur}>
                <Binder>
                  {p.map((c) => {
                    const normal = normalIds.has(c.id);
                    const price = c.price.eur;
                    const name = cardName(c, lang);
                    return (
                      <Pocket key={c.id} card={c} lang={displayLang(c)} number={shortNo(c)} version={normal ? undefined : versionLabel(c)}
                        qty={c.owned} price={price} onClick={() => touch(c)}
                        state={sheetId === c.id ? 'sel' : flash.has(c.id) ? 'flash' : undefined}
                        label={c.owned === 0
                          ? ts('pocket.empty', { name, no: shortNo(c), price: formatEur(price) })
                          : ts(c.owned === 1 ? 'pocket.ownedOne' : 'pocket.owned', { name, no: shortNo(c), n: c.owned, price: formatEur(price) })} />
                    );
                  })}
                </Binder>
              </div>
            ))}
          </div>
          <div className="sb-dots" aria-hidden="true">
            {pages.map((_, i) => (pageCount <= 20 || Math.abs(i - cur) <= 5) && <i key={i} className={i === cur ? 'on' : undefined} />)}
          </div>
        </>
      )}

      {/* Menu ⋯ (non dessiné) */}
      <Sheet open={menu} onClose={() => setMenu(false)} label={ts('menu.title')}>
        <Rows>
          <Row title={ts('menu.quick')} meta={ts('menu.quickHint')} onClick={() => { setMenu(false); setQuick(true); }} />
          <Row title={ts('menu.pages')} onClick={() => { setMenu(false); setOverview(true); }} />
          {missingCards.length > 0 && (
            <Row title={ts('menu.cost', { price: formatEur(missingCost) })}
              meta={ts('menu.costHint', { n: missingCards.length }) + (unpricedMissing > 0 ? ts('menu.costUnpriced', { n: unpricedMissing }) : '')} />
          )}
          {isStarter && <Row title={ts('menu.deck')} meta={ts('menu.deckHint')} onClick={() => { setMenu(false); setDeckOpen(true); }} />}
          <Row title={ts('menu.wish')} meta={unwished.length > 0 ? ts('menu.wishHint', { n: unwished.length }) : ts('menu.wishNone')}
            onClick={unwished.length > 0 ? () => void wishAll() : undefined} chevron={false} />
        </Rows>
      </Sheet>

      {deckOpen && <Legacy><DeckSheet initialDeck={setId} onClose={() => setDeckOpen(false)} /></Legacy>}

      {/* Pochette vide touchée */}
      <Sheet open={sheetCard !== null} onClose={() => setSheetId(null)} label={ts('sheet.label', { no: sheetCard ? shortNo(sheetCard) : '' })}>
        {sheetCard && (
          <>
            <div className="sb-top">
              <Slot><span className="empty"><span className="no">{shortNo(sheetCard)}</span></span></Slot>
              <div>
                <p className="over">{sheetCard.number}{sheetCard.rarity ? ` · ${rarityName(sheetCard.rarity)}` : ''}</p>
                <h3>{cardName(sheetCard, sheetLang)}</h3>
                <p className="dim sb-price">{ts('sheet.emptyPrice', { price: formatEur(sheetCard.price.eur) })}</p>
              </div>
            </div>
            <div className="sb-acts">
              <button type="button" className="btn main" onClick={() => { const c = sheetCard; setSheetId(null); void store(c, sheetLang); }}>
                <Icon name="plus" small />{ts('sheet.have')}
              </button>
              <button type="button" className="btn line" onClick={() => void toggleWish(sheetCard)}>
                <Icon name="star" small />{ts(sheetCard.wish ? 'sheet.unwant' : 'sheet.want')}
              </button>
              <button type="button" className="btn quiet" onClick={() => { const c = sheetCard; setSheetId(null); openCard(c.id, sheetLang); }}>{ts('sheet.full')}</button>
            </div>
            <div className="sb-lang">
              <span>{ts('sheet.lang')}</span>
              <Caps label={ts('sheet.lang')} value={sheetLang} onChange={setSheetLang}
                options={[{ value: 'fr', label: ts('lang.fr') }, { value: 'en', label: ts('lang.en') }]} />
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
