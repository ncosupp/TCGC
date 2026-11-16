// Decks de l'espace Jeu (#play/decks ; maquettes Decks, Nouveau-Deck et Editeur-deck de Refonte-UI-jeu, étape 2) :
// - #play/decks : Mes decks (filtre Tous / Libres / Aventure, brouillons, statut Ranked), « Nouveau », puis copier un
//   deck préconstruit ou importer une liste ;
// - #play/decks/nouveau (ou nouveau-aventure, depuis le deck d'aventure) : quel deck, le Leader, la table, son nom ;
// - #play/decks/<id> : la table d'un deck (toucher une ligne l'ouvre ; le retour enregistre).
// Deux types de deck, un seul éditeur : seule la réserve change (toutes les cartes, ou celles de la Cale).
import { useMemo, useState } from 'react';
import { CARDS, notYetPlayable, waitingLeader } from '../../../../game/engine/cards/index.ts';
import { DECK_SIZE } from '../../../../game/engine/deckRules.ts';
import { DECKS } from '../../../../game/engine/decks.ts';
import { useHoldState } from '../../../../game/ui/adventure/holdState.ts';
import { copyName, deckTotal, outOfHold, rankedEligible, type DeckKind, type Hold } from '../../../../game/ui/builder/table.ts';
import { holdVariants } from '../../../../game/ui/builder/versions.ts';
import { useDeckStats } from '../../../../game/ui/deckStats.ts';
import { isAdventureDeck, newDeckId, parseDeckText, useMyDecks, type MyDeck } from '../../../../game/ui/myDecks.ts';
import { goBack, navigate, useRoute } from '../../../../game/ui/routes.ts';
import { getUiLang } from '../../i18n';
import { useApp } from '../../store';
import { tjd } from '../i18n/jeu-decks';
import { Caps, Icon, Rows, Row, Sheet, Spinner, cx } from '../kit';
import { GameSlot } from './cards';
import { DeckTable, TableLoading } from './DeckTable';
import { LeaderStep, TypeStep } from './DeckSteps';
import { JeuScreen, JeuTopBar } from './parts';
import type { Draft } from './useAutosave';
import './decks.css';

// Decks neufs ouverts sur la table sans être encore enregistrés (copie d'un préconstruit, liste importée)
const fresh = new Map<string, { draft: Draft; kind: DeckKind }>();
const LIST = { name: 'decks' } as const;

export function DecksScreen() {
  const route = useRoute();
  const id = route.name === 'decks' ? route.id : undefined;
  const holdState = useHoldState();
  const hold = holdState.data?.byNumber ?? null;
  const { toast } = useApp();
  const exit = (message?: string) => {
    goBack(LIST);
    if (message) setTimeout(() => toast(message), 50);
  };
  if (!id) return <DecksList hold={hold} chosenId={holdState.data?.adventure.deckId ?? null} />;
  if (id === 'nouveau' || id === 'nouveau-aventure') {
    return <NewDeck key={id} preset={id === 'nouveau-aventure' ? 'aventure' : undefined} hold={hold} holdReady={Boolean(holdState.data || holdState.error)}
      variants={holdState.data ? holdVariants(holdState.data.cards) : undefined} chosenId={holdState.data?.adventure.deckId ?? null} onExit={exit} />;
  }
  return <ExistingDeck key={id} id={id} hold={hold} holdReady={Boolean(holdState.data || holdState.error)}
    variants={holdState.data ? holdVariants(holdState.data.cards) : undefined}
    chosenId={holdState.data?.adventure.deckId ?? null} onChosen={() => void holdState.reload()} onExit={exit} />;
}

/* ---------- Mes decks ---------- */

type Filter = 'all' | 'libre' | 'aventure';

function DecksList({ hold, chosenId }: { hold: Hold | null; chosenId: string | null }) {
  const { decks, ready, error } = useMyDecks();
  const stats = useDeckStats();
  const [filter, setFilter] = useState<Filter>('all');
  const [copying, setCopying] = useState(false);
  const [importing, setImporting] = useState(false);
  const adventure = decks.filter((d) => isAdventureDeck(d));
  const shown = filter === 'all' ? decks : filter === 'aventure' ? adventure : decks.filter((d) => !isAdventureDeck(d));
  const open = (draft: Draft, kind: DeckKind) => {
    fresh.set(draft.id, { draft, kind });
    navigate({ name: 'decks', id: draft.id });
  };
  return (
    <JeuScreen className="dl" data-ui="decks">
      <JeuTopBar />
      <div className="dl-head">
        <h1 className="title">{tjd('list.title')}</h1>
        <span className="sp" />
        <button type="button" className="btn line dl-new" data-ui="decks.new" onClick={() => navigate({ name: 'decks', id: 'nouveau' })}><Icon name="plus" small />{tjd('list.new')}</button>
      </div>
      {decks.length > 0 && (
        <div className="dl-caps">
          <Caps label={tjd('list.filter')} value={filter} onChange={setFilter} options={[
            { value: 'all', label: tjd('list.all', { n: decks.length }) },
            { value: 'libre', label: tjd('list.libre', { n: decks.length - adventure.length }) },
            { value: 'aventure', label: tjd('list.aventure', { n: adventure.length }) },
          ]} />
        </div>
      )}
      {!ready && !error && <div className="dl-wait" aria-label={tjd('list.loading')}><Spinner /></div>}
      {error && <p className="dl-error">{tjd('list.error')}</p>}
      {ready && !decks.length && <p className="dim dl-empty">{tjd('list.empty')}</p>}
      {shown.length > 0 && (
        <div className="rows dl-rows">
          {shown.map((d) => <DeckRow key={d.id} deck={d} hold={hold} chosen={d.id === chosenId} played={stats?.get(d.id)} />)}
        </div>
      )}
      <section className="sec dl-from">
        <p className="over">{tjd('list.from')}</p>
        <Rows className="dl-from-rows">
          <Row ui="decks.copy" onClick={() => setCopying(true)} lead={<span className="glyph"><Icon name="copy" /></span>} title={tjd('list.copy')} meta={tjd('list.copyMeta')} />
          <Row ui="decks.import" onClick={() => setImporting(true)} lead={<span className="glyph"><Icon name="download" /></span>} title={tjd('list.import')} meta={tjd('list.importMeta')} />
        </Rows>
      </section>
      <CopySheet open={copying} onClose={() => setCopying(false)} onPick={(src) => {
        setCopying(false);
        open({ id: newDeckId(), name: copyName(src.name), leader: src.leader, cards: { ...src.cards } }, 'libre');
      }} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} onImport={(draft) => { setImporting(false); open(draft, 'libre'); }} />
    </JeuScreen>
  );
}

const winsText = (s: { online: { wins: number; losses: number }; ai: { wins: number; losses: number } } | undefined) => {
  if (!s) return null;
  const w = s.online.wins + s.ai.wins;
  const l = s.online.losses + s.ai.losses;
  if (!w && !l) return null;
  return getUiLang() === 'en' ? `${w} W · ${l} L` : `${w} V · ${l} D`;
};

function DeckRow({ deck, hold, chosen, played }: { deck: MyDeck; hold: Hold | null; chosen: boolean; played?: Parameters<typeof winsText>[0] }) {
  const adventure = isAdventureDeck(deck);
  const total = deckTotal(deck.cards);
  const leader = CARDS[deck.leader]?.name ?? deck.leader;
  const ranked = hold !== null && rankedEligible(deck.leader, deck.cards, hold);
  const out = hold ? outOfHold(deck.cards, hold) : 0;
  const state = total < DECK_SIZE
    ? <>{tjd('list.draft', { n: total })}</>
    : ranked ? <>{tjd('list.ready')} · <span className="dl-ok">{tjd('list.ranked')}</span></>
      : !adventure && hold && out > 0 ? <>{tjd('list.ready')} · {tjd('list.out', { n: out })}</> : <>{tjd('list.ready')}</>;
  const w = winsText(played);
  return (
    <button type="button" className="row dl-row" data-ui="decks.item" onClick={() => navigate({ name: 'decks', id: deck.id })}>
      <GameSlot num={deck.leader} variant={deck.looks?.arts?.[deck.leader]} virtual={adventure} className="dl-thumb" />
      <span className="row-main">
        <span className={cx('over', adventure && chosen && 'sea')}>{adventure ? (chosen ? tjd('list.overChosen') : tjd('list.overAventure')) : tjd('list.overLibre')}</span>
        <span className="row-t">{deck.name}</span>
        <span className="row-m">{leader} · {state}{w ? ` · ${w}` : ''}</span>
      </span>
      <Icon name="next" className="chev" />
    </button>
  );
}

function CopySheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (d: { name: string; leader: string; cards: Record<string, number> }) => void }) {
  const list = useMemo(() => Object.values(DECKS).filter((d) => CARDS[d.leader]).sort((a, b) => a.name.localeCompare(b.name)), []);
  return (
    <Sheet open={open} onClose={onClose} label={tjd('copy.title')} className="dl-sheet dl-copysheet">
      <h2 className="h">{tjd('copy.title')}</h2>
      <p className="dim dl-sheet-hint">{tjd('copy.hint')}</p>
      <div className="rows dl-copy" data-ui="decks.copy-dialog">
        {list.map((d) => (
          <button key={d.id} type="button" className="row dl-row" data-ui={`deck.tile-${d.id}`} onClick={() => onPick(d)}>
            <GameSlot num={d.leader} className="dl-thumb" />
            <span className="row-main"><span className="row-t">{d.name}</span><span className="row-m">{CARDS[d.leader].name} · {d.series}</span></span>
            <Icon name="next" className="chev" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// Une liste collée (Limitless, OPTCG Sim…) : Leader compris ; les cartes pas encore jouables sont laissées de côté
function ImportSheet({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (d: Draft) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { toast } = useApp();
  const go = () => {
    const parsed = parseDeckText(text, (n) => CARDS[n]?.category === 'LEADER' || waitingLeader(n));
    if (!parsed.leader) { setError(tjd('import.noLeader')); return; }
    if (waitingLeader(parsed.leader)) { setError(tjd('import.waitingLeader', { num: parsed.leader })); return; }
    const waiting = Object.keys(parsed.cards).filter((n) => notYetPlayable(n));
    const unknown = [...parsed.unknown, ...Object.keys(parsed.cards).filter((n) => !CARDS[n] && !waiting.includes(n))];
    const cards = Object.fromEntries(Object.entries(parsed.cards).filter(([n]) => CARDS[n] && !waiting.includes(n)));
    setText('');
    setError(null);
    onImport({ id: newDeckId(), name: `Import ${CARDS[parsed.leader]?.name ?? parsed.leader}`.slice(0, 40), leader: parsed.leader, cards });
    const notes = [waiting.length ? tjd('import.left', { list: waiting.join(', ') }) : '', unknown.length ? tjd('import.unknown', { list: unknown.join(', ') }) : ''].filter(Boolean);
    if (notes.length) setTimeout(() => toast(notes.join(' ')), 50);
  };
  const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';
  const paste = async () => {
    try {
      const got = await navigator.clipboard.readText();
      if (got.trim()) { setText(got); setError(null); }
    } catch {
      setError(tjd('import.clipboard'));
    }
  };
  return (
    <Sheet open={open} onClose={onClose} label={tjd('import.title')} className="dl-sheet"
      bar={<>{canPaste && <button type="button" className="btn line" onClick={paste}>{tjd('import.paste')}</button>}<button type="button" className="btn main dl-grow" disabled={!text.trim()} onClick={go}>{tjd('import.go')}</button></>}>
      <h2 className="h">{tjd('import.title')}</h2>
      <p className="dim dl-sheet-hint">{tjd('import.hint')}</p>
      <textarea className="dl-text" rows={9} value={text} aria-label={tjd('import.field')} placeholder={'1xOP13-004\n4xOP13-008\n4xOP12-090\n…'}
        onChange={(e) => { setText(e.target.value); setError(null); }} />
      {error && <p className="dl-error">{error}</p>}
    </Sheet>
  );
}

/* ---------- Un deck sur la table ---------- */

function ExistingDeck({ id, hold, holdReady, variants, chosenId, onChosen, onExit }: {
  id: string; hold: Hold | null; holdReady: boolean; variants?: Record<string, Record<string, number>>; chosenId: string | null;
  onChosen: () => void; onExit: (message?: string) => void;
}) {
  const { decks, ready, error } = useMyDecks();
  const pending = fresh.get(id);
  const stored = decks.find((d) => d.id === id);
  const kind: DeckKind = pending?.kind ?? (stored && isAdventureDeck(stored) ? 'aventure' : 'libre');
  if (!pending && !stored) {
    if (ready || error) {
      // adresse d'un deck inconnu (supprimé, ou deck neuf avant un rechargement) : la liste
      setTimeout(() => navigate(LIST, { replace: true }), 0);
    }
    return <TableLoading />;
  }
  if (kind === 'aventure' && !holdReady) return <TableLoading />;
  const initial: Draft = pending?.draft ?? { id: stored!.id, name: stored!.name, leader: stored!.leader, cards: { ...stored!.cards }, looks: stored!.looks ?? {} };
  return (
    <DeckTable initial={initial} kind={kind} isNew={Boolean(pending)} hold={hold} holdVariants={variants} chosenId={chosenId} onChosen={onChosen}
      onExit={(m) => { fresh.delete(id); onExit(m); }} />
  );
}

function NewDeck({ preset, hold, holdReady, variants, chosenId, onExit }: {
  preset?: DeckKind; hold: Hold | null; holdReady: boolean; variants?: Record<string, Record<string, number>>; chosenId: string | null;
  onExit: (message?: string) => void;
}) {
  const [kind, setKind] = useState<DeckKind | null>(preset ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (!kind) return <TypeStep hold={hold} onPick={setKind} onCancel={() => onExit()} />;
  if (kind === 'aventure' && !holdReady) return <TableLoading />;
  if (!draft) {
    return (
      <LeaderStep kind={kind} hold={hold} onBack={() => (preset ? onExit() : setKind(null))}
        onPick={(leader) => setDraft({ id: newDeckId(), name: tjd('name.default', { leader: CARDS[leader].name }).slice(0, 40), leader, cards: {} })} />
    );
  }
  return (
    <DeckTable key={draft.id} initial={draft} kind={kind} isNew hold={hold} holdVariants={variants} chosenId={chosenId}
      onBackToLeader={() => setDraft(null)} onExit={onExit} />
  );
}
