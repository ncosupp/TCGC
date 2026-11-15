// Partie en ligne, ce que l'étape J ajoute au plateau (fiche 02-game-design-en-ligne.md) : le chrono des deux joueurs,
// les réactions prédéfinies (bulle de 3 s), et la revanche en fin de partie.
import { useEffect, useRef, useState } from 'react';
import { REACTION_TEXT, REACTIONS, type Reaction } from '../../online/match.ts';
import { Button, IconButton } from '../kit/index.ts';
import { navigate } from '../routes.ts';
import { useSettings } from '../settings.ts';
import { sfx } from '../sound.ts';
import { askRematch, sendReaction, type LiveView } from './api.ts';

// « 24:59 », « 0:07 »
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Temps restant de chaque joueur, compté dans la page à partir de la vue (date du serveur ramenée à l'horloge locale)
export function useClock(view: LiveView): [number, number] | null {
  const clock = view.clock;
  const offset = useRef(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (clock) offset.current = Date.now() - Date.parse(clock.now);
  }, [clock]);
  useEffect(() => {
    if (!clock || clock.seat === null || view.status !== 'playing') return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [clock, view.status]);
  if (!clock) return null;
  const elapsed = view.status === 'playing' && clock.seat !== null ? Date.now() - offset.current - Date.parse(clock.since) : 0;
  return [0, 1].map((s) => Math.max(0, clock.left[s] - (clock.seat === s ? elapsed : 0))) as [number, number];
}

export function MatchClock({ view }: { view: LiveView }) {
  const left = useClock(view);
  if (!left || !view.clock) return null;
  const me = view.seat;
  const opp = me === 0 ? 1 : 0;
  const cell = (seat: 0 | 1, who: string) => {
    const running = view.clock?.seat === seat && view.status === 'playing';
    const low = left[seat] < 120_000;
    return (
      <span className={`op-clock-cell${running ? ' is-running' : ''}${low ? ' is-low' : ''}`} title={`${who} : temps de réflexion restant`}>
        <span className="op-clock-who">{who}</span> {clockText(left[seat])}
      </span>
    );
  };
  return (
    <span className="op-clock" data-ui="online.clock" role="timer" aria-label={`Ton temps : ${clockText(left[me])}. Celui de ton adversaire : ${clockText(left[opp])}`}>
      {cell(me, 'Toi')}{cell(opp, 'Lui')}
    </span>
  );
}

// ---------- Réactions ----------

export function Reactions({ view }: { view: LiveView }) {
  const [settings] = useSettings();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<{ mine: boolean; text: string; n: number } | null>(null);
  const [error, setError] = useState<string>();
  const last = useRef(view.reaction?.n ?? 0);
  // une nouvelle réaction arrive : bulle de 3 s
  useEffect(() => {
    const r = view.reaction;
    if (!r || r.n === last.current) return;
    last.current = r.n;
    if (settings.reactions === false && r.seat !== view.seat) return;
    setShown({ mine: r.seat === view.seat, text: REACTION_TEXT[r.reaction], n: r.n });
    if (r.seat !== view.seat) sfx('click');
  }, [view.reaction, view.seat, settings.reactions]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(t);
  }, [shown]);
  const send = (reaction: Reaction) => {
    setOpen(false);
    setError(undefined);
    sendReaction(view.id, reaction).catch((e: Error) => setError(e.message));
  };
  if (settings.reactions === false) return null;
  return (
    <span className="op-react">
      <IconButton icon="chat" variant="quiet" label="Réactions" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-ui="online.react" />
      {open && (
        <span className="op-react-menu" role="menu" aria-label="Réactions">
          {REACTIONS.map((r) => (
            <button key={r} type="button" role="menuitem" className="op-react-item" onClick={() => send(r)} data-ui={`online.react-${r}`}>{REACTION_TEXT[r]}</button>
          ))}
        </span>
      )}
      {shown && <span key={shown.n} className={`op-react-bubble${shown.mine ? ' is-mine' : ''}`} role="status">{shown.mine ? 'Toi' : 'Lui'} : {shown.text}</span>}
      {error && <span className="op-react-bubble is-error" role="alert">{error}</span>}
    </span>
  );
}

// ---------- Revanche ----------

export function RematchButton({ view }: { view: LiveView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const offers = view.rematch?.offers ?? [];
  const next = view.rematch?.next ?? null;
  const asked = offers.includes(view.seat);
  const invited = offers.some((s) => s !== view.seat);
  // la revanche est créée : on y passe (les deux joueurs l'ont demandée)
  useEffect(() => {
    if (next) navigate({ name: 'partie', id: next }, { replace: true });
  }, [next]);
  useEffect(() => { if (invited && !asked) sfx('alert'); }, [invited, asked]);
  const go = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await askRematch(view.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!view.opponent) return null;
  return (
    <>
      <Button variant="primary" icon="rematch" busy={busy || (asked && !next)} disabled={asked} onClick={() => void go()} data-ui="end.rematch">
        {asked ? 'Revanche proposée…' : invited ? 'Accepter la revanche' : 'Revanche'}
      </Button>
      {invited && !asked && <span className="op-small op-end-rematch-note" role="status">{view.opponent.name} propose une revanche !</span>}
      {error && <span className="op-small danger" role="alert">{error}</span>}
    </>
  );
}
