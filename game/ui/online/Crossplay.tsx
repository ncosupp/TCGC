// Contre un joueur OPTCGSim (#play/optcgsim, tâche O3.1) : choisir son deck, coller le code de la salle OPTCGSim
// (« P… », « W… », « E… »…), rejoindre ; puis attendre l'adversaire et jouer sur le plateau commun (game/ui/table/),
// comme une partie en ligne : sans coach, chaque choix part au serveur, qui le traduit pour OPTCGSim. Rien ne part sans
// un appui sur « Rejoindre ». La partie se retrouve après un rechargement (#play/optcgsim/<id>, et « Reprendre » ici).
import { useCallback, useEffect, useRef, useState } from 'react';
import { sayReason } from '../../coach/logText.ts';
import { DECKS, isAdventureOnly, isCustomDeck } from '../../engine/decks.ts';
import type { GameState } from '../../engine/types.ts';
import { EndScreen } from '../end/EndScreen.tsx';
import { GameGain, useGameGain } from '../economy/GameGain.tsx';
import { AsyncState, Button, Dialog, Screen } from '../kit/index.ts';
import { deckInfo, useMyDecks } from '../myDecks.ts';
import { navigate, useLeaveGuard } from '../routes.ts';
import { DeckPicker } from '../setup/DeckPicker.tsx';
import { LeaveDialog, TableScreen } from '../table/TableScreen.tsx';
import { useGameKeys } from '../table/useGameKeys.ts';
import { useTable } from '../table/useTable.ts';
import { CROSSPLAY, LEAVE_GAME } from '../texts.ts';
import {
  cleanCrossCode, crossCodeOk, currentCross, joinCross, resignCross, sendCrossChoice, useCross, type CrossView, type CurrentCross,
} from './crossplay.ts';

const DECK_KEY = 'tcgc.game.optcgsim-deck';

function lastDeck(): string {
  try {
    const d = localStorage.getItem(DECK_KEY) ?? localStorage.getItem('tcgc.game.online-deck');
    if (d && ((DECKS[d] && !isAdventureOnly(d)) || isCustomDeck(d))) return d;
  } catch { /* stockage indisponible */ }
  return 'ST-01';
}

// ---------- Rejoindre une salle ----------

export function CrossplayLobby({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [deck, setDeck] = useState(lastDeck);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentCross | null>(null);
  const myDecks = useMyDecks();
  const info = deckInfo(deck);
  useEffect(() => {
    let live = true;
    currentCross().then((c) => { if (live) setCurrent(c); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const pick = (id: string) => {
    setDeck(id);
    setPicking(false);
    setError(null);
    try { localStorage.setItem(DECK_KEY, id); } catch { /* stockage indisponible */ }
  };
  const ok = crossCodeOk(code);
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await joinCross(code, deck);
      onOpen(v.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Screen className="op-lobby op-cross" data-ui="cross" title={CROSSPLAY.title} subtitle={CROSSPLAY.subtitle} back={{ label: 'Jouer avec un ami', onBack, 'data-ui': 'cross.back' }}>
      <div className="op-lobby-body">
        {current && (
          <section className="op-lobby-card is-main" data-ui="cross.current">
            <div className="op-lobby-card-head">
              <h2>Ta partie OPTCGSim est en cours</h2>
              <p>Avec {current.deckName}. Reprends-la là où tu l’as laissée.</p>
            </div>
            <Button variant="primary" size="big" wide onClick={() => onOpen(current.id)} data-ui="cross.resume">Reprendre la partie</Button>
          </section>
        )}
        <section className={`op-lobby-card${current ? '' : ' is-main'}`} aria-labelledby="op-cross-join" data-ui="cross.join-card">
          <div className="op-lobby-card-head">
            <h2 id="op-cross-join">Rejoindre une salle OPTCGSim</h2>
            <p>Ton adversaire crée une salle dans OPTCGSim et te donne son code. Le serveur de joy-boy la rejoint pour toi : tu joues ici, lui dans OPTCGSim.</p>
          </div>
          <div className="op-cross-deck" data-ui="cross.deck-line">
            <span className="op-cross-deck-text"><span className="op-lobby-deck-label">Ton deck</span><strong>{info?.name ?? (myDecks.ready ? 'Deck introuvable' : 'Chargement…')}</strong></span>
            <Button variant="secondary" icon="deck" onClick={() => setPicking(true)} data-ui="cross.deck">Changer</Button>
          </div>
          <form className="op-lobby-join" onSubmit={(e) => { e.preventDefault(); if (ok && !busy && !current) void join(); }}>
            <input className="room-input op-cross-code" data-ui="cross.code" value={code} onChange={(e) => { setCode(cleanCrossCode(e.target.value)); setError(null); }}
              placeholder="EX. P1A2B3C" autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text"
              aria-label="Code de la salle OPTCGSim" enterKeyHint="go" />
            <Button type="submit" variant="primary" busy={busy} disabled={!ok || busy || Boolean(current) || !info} data-ui="cross.join">Rejoindre</Button>
          </form>
          {code.length > 0 && !ok && <p className="op-small op-muted" role="status">{CROSSPLAY.codeHelp}</p>}
          {error && <p className="op-lobby-error" role="alert">{error}</p>}
        </section>
        <p className="op-lobby-foot">{CROSSPLAY.foot}</p>
      </div>
      {picking && (
        <Dialog title="Choisis ton deck" onClose={() => setPicking(false)} size="wide" className="op-lobby-decks" data-ui="cross.decks">
          <DeckPicker selected={deck} onPick={pick} label="Choisir" onBuilder={() => navigate({ name: 'decks' })} />
        </Dialog>
      )}
    </Screen>
  );
}

// ---------- La partie ----------

const WAITING: Record<string, string> = {
  connecting: 'Connexion à la salle OPTCGSim…',
  setup: 'Connecté : en attente de ton adversaire dans OPTCGSim…',
};

export function CrossplayMatch({ id, onLeave }: { id: string; onLeave: () => void }) {
  const { view, connected, error, refresh } = useCross(id);
  const back = { label: 'Accueil', onBack: onLeave, 'data-ui': 'cross.leave' };
  const [quitting, setQuitting] = useState(false);
  if (!view) {
    return (
      <Screen className="op-lobby op-cross" data-ui={error ? 'cross.error' : 'cross.loading'} title={CROSSPLAY.title} back={back}>
        <AsyncState loading={!error} loadingText="Connexion à la partie…" error={error && `Impossible d’ouvrir la partie : ${error}`} onRetry={refresh} />
      </Screen>
    );
  }
  if (!view.state || (view.status === 'stopped' && view.end?.winner == null)) {
    const waiting = view.status === 'connecting' || view.status === 'setup';
    const quit = async () => { setQuitting(true); await resignCross(id).catch(() => undefined); onLeave(); };
    return (
      <Screen className="op-lobby op-cross" data-ui={waiting ? 'cross.waiting' : 'cross.stopped'} title={waiting ? CROSSPLAY.title : 'Partie arrêtée'} subtitle="Contre un joueur OPTCGSim" back={back}>
        <div className="op-lobby-body">
          <section className="op-lobby-card is-main" aria-live="polite">
            {waiting && <span className="op-spinner" aria-hidden="true" />}
            <p role="status">{waiting ? WAITING[view.status] : view.message}</p>
            {view.unknown.length > 0 && (
              <ul className="op-cross-unknown" data-ui="cross.unknown">
                {view.unknown.map((u) => <li key={u.code}><b>{u.code}</b>{u.count > 1 ? ` ×${u.count}` : ''}</li>)}
              </ul>
            )}
            {waiting
              ? <Button variant="secondary" busy={quitting} onClick={() => void quit()} data-ui="cross.cancel">Quitter la salle</Button>
              : <Button variant="primary" size="big" wide onClick={() => navigate({ name: 'optcgsim' }, { replace: true })} data-ui="cross.new">{CROSSPLAY.again}</Button>}
          </section>
          {waiting && <p className="op-lobby-foot">{CROSSPLAY.waitFoot}</p>}
        </div>
      </Screen>
    );
  }
  return <CrossBoard view={view} game={view.state} connected={connected} refresh={refresh} onLeave={onLeave} />;
}

function CrossBoard({ view, game, connected, refresh, onLeave }: { view: CrossView; game: GameState; connected: boolean; refresh: () => void; onLeave: () => void }) {
  const seat = 1;
  const oppName = view.opponent?.name ?? 'Joueur OPTCGSim';
  const over = view.end !== null;
  const [leaving, setLeaving] = useState(false);
  const [sentSeq, setSentSeq] = useState<number | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  useLeaveGuard(!over, () => setLeaving(true));
  const mine = Boolean(game.decision?.player === seat && !over);
  const sending = mine && sentSeq === view.seq;
  const send = useCallback((choice: string) => {
    setSentSeq(view.seq);
    sendCrossChoice(view.id, view.seq, choice).catch((e: Error & { code?: string }) => {
      setSentSeq(null);
      if (e.code === 'stale' || e.code === 'not_your_turn') refresh();
      else setAlert(`Choix refusé : ${e.message}`);
    });
  }, [view.id, view.seq, refresh]);
  const table = useTable({ state: game, seat, active: mine && !sending, choose: send, aids: false, recommended: null }, { intro: false });
  useGameKeys(table);

  const { gain, claim, retry: retryGain } = useGameGain();
  const claimed = useRef(false);
  useEffect(() => {
    if (!over || claimed.current || !view.recordId || view.end?.winner == null) return;
    claimed.current = true;
    const recordId = view.recordId;
    claim(() => Promise.resolve(recordId));
  }, [over, view.recordId, view.end, claim]);
  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setAlert(null), 4000);
    return () => clearTimeout(t);
  }, [alert]);

  const resign = async () => {
    setLeaving(false);
    await resignCross(view.id).catch((e: Error) => setAlert(e.message));
  };
  const won = view.end?.winner === seat;
  const myDeck = view.you.deckName;
  const oppDeck = view.opponent?.leader ? `Leader ${view.opponent.leader}` : 'OPTCGSim';
  return (
    <TableScreen
      table={table}
      opponent={oppName}
      thinking
      top={{
        brand: 'Joy Boy · OPTCGSim',
        match: <>{myDeck} <span className="vs">contre</span> {oppName} · {oppDeck}</>,
        matchTitle: `${myDeck} contre ${oppName} (OPTCGSim) · ${oppDeck}`,
        rival: oppName,
        status: <span className="op-cross-badge" title="Ton adversaire joue dans OPTCGSim">OPTCGSim</span>,
        leave: { ...LEAVE_GAME, onClick: () => (over ? onLeave() : setLeaving(true)) },
      }}
      decks={{ mine: view.you.deck, theirsName: 'ton adversaire' }}
      sideNote={<p className="op-small op-muted online-note">{CROSSPLAY.sideNote}</p>}
      alert={(alert || !connected) && <div className="online-alert">{alert ?? 'Connexion perdue : reconnexion…'}</div>}
      sending={sending}
      reopenEnd
      celebration={won ? 'Bien joué, capitaine.' : `${oppName} remporte la partie.`}
      leave={leaving && (
        <LeaveDialog onStay={() => setLeaving(false)} text={`Tu peux revenir plus tard : la partie t’attend ici (au-delà de 10 minutes sans jouer, elle est abandonnée). Ou tu peux l’abandonner : ${oppName} gagne.`}>
          <button className="op-btn op-btn-ghost" data-ui="leave.yes" onClick={onLeave}>Revenir plus tard</button>
          <button className="op-btn op-btn-ghost danger" data-ui="leave.resign" onClick={resign}>Abandonner</button>
          <button className="op-btn op-btn-primary" data-ui="leave.no" onClick={() => setLeaving(false)}>Continuer</button>
        </LeaveDialog>
      )}
      end={over && (
        <EndScreen
          mode="en-ligne"
          won={won}
          reason={view.end?.reason ?? sayReason(game, seat)}
          turns={game.turn}
          matchup={<>{myDeck} contre {oppName} (OPTCGSim) · {oppDeck}</>}
          note={CROSSPLAY.endNote}
          gain={view.end?.winner == null ? undefined : <GameGain gain={gain} onRetry={retryGain} />}
          onHistory={() => navigate(view.recordId ? { name: 'parties', id: view.recordId } : { name: 'parties' })}
          onHome={onLeave}
          onBoard={() => table.setShowEnd(false)}
        />
      )}
    />
  );
}
