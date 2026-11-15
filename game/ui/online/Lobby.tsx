// Jouer avec un ami (#play/ami, tâche R3.7) : « Créer une salle » en haut, avec le deck rappelé (« Changer » ouvre le
// sélecteur commun, en fenêtre) ; en dessous, rejoindre la salle d'un ami avec son code. Le lien d'un ami
// (#play/salle/<CODE>) met « Rejoindre » en haut, code rempli : rien ne part sans un appui. Un deck d'aventure se joue
// si son joueur possède encore toutes ses cartes de la Cale : le serveur le vérifie en entrant dans la partie ; l'écran
// prévient avant, d'après la Cale.
import { useEffect, useState, type ReactNode } from 'react';
import { CARDS } from '../../engine/cards/index.ts';
import { DECKS, isAdventureOnly, isCustomDeck } from '../../engine/decks.ts';
import { def } from '../../engine/rules.ts';
import { holdByNumber, loadHold } from '../adventure/api.ts';
import { holdProblems } from '../adventure/hold.ts';
import { DeckGuideModal } from '../DeckGuide.tsx';
import { GUIDES } from '../deckGuides.ts';
import { cardImage } from '../images.ts';
import { Button, Dialog, Icon, Screen } from '../kit/index.ts';
import { deckInfo, isAdventureDeck, useMyDecks } from '../myDecks.ts';
import { navigate } from '../routes.ts';
import { DeckPicker } from '../setup/DeckPicker.tsx';
import { COLOR } from '../setup/DeckTile.tsx';
import { CardZoom, useCardZoom } from '../Zoom.tsx';
import { createRoom, joinRoom, openRooms, queueStats } from './api.ts';
import { clearFound, startQueue, stopQueue, useQueue, waited } from './queue.ts';
import { randomDeck, type Config } from '../setup/config.ts';

import type { OpenRoom } from '../../online/match.ts';
import { cleanCode, CODE_LENGTH } from './room.ts';

const DECK_KEY = 'tcgc.game.online-deck';
const PUBLIC_KEY = 'tcgc.game.online-public';

// Les salles publiques en attente, relues toutes les 8 secondes tant que le salon est ouvert (null : pas encore lues)
function useOpenRooms(): { list: OpenRoom[] | null; refresh: () => void } {
  const [list, setList] = useState<OpenRoom[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const read = () => openRooms().then((r) => { if (!cancelled) setList(r); }).catch(() => { if (!cancelled) setList((l) => l ?? []); });
    read();
    const t = setInterval(read, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, [tick]);
  return { list, refresh: () => setTick((n) => n + 1) };
}

// Une salle publique : le Leader et le deck de l'hôte, son nom, « Rejoindre »
function RoomRow({ room, disabled, busy, onJoin }: { room: OpenRoom; disabled: boolean; busy: boolean; onJoin: () => void }) {
  const leader = room.leader && room.leader in CARDS ? def(room.leader) : null;
  return (
    <li className="op-lobby-room" data-ui="lobby.room">
      {leader ? <img src={cardImage(leader)} alt="" /> : <span className="op-lobby-room-img" aria-hidden="true" />}
      <span className="op-lobby-room-text">
        <strong>{room.host}</strong>
        <span>{room.deckName}{leader && leader.name !== room.deckName ? ` · ${leader.name}` : ''}</span>
      </span>
      <Button variant="primary" busy={busy} disabled={disabled} onClick={onJoin} data-ui="lobby.room-join">Rejoindre</Button>
    </li>
  );
}

function lastDeck(): string {
  try {
    const d = localStorage.getItem(DECK_KEY);
    if (d && ((DECKS[d] && !isAdventureOnly(d)) || isCustomDeck(d))) return d;  // deck perso : vérifié par le serveur
  } catch { /* stockage indisponible */ }
  return 'ST-35';
}

export function Lobby({ initialCode, queue = false, onOpen, onBack, onPlayAi }: {
  initialCode?: string;
  // « Trouver un adversaire » (#play/chercher, étape J) : la file d'attente plutôt que les salles
  queue?: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  // jouer contre l'IA Expert en attendant un adversaire
  onPlayAi?: (config: Config) => void;
}) {
  const [code, setCode] = useState(cleanCode(initialCode ?? ''));
  const [deck, setDeck] = useState(lastDeck);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<{ on: 'create' | 'join' | 'public'; text: string } | null>(null);
  // salle publique : listée pour tous les joueurs, qui la rejoignent sans code (choix gardé pour la prochaine fois)
  const [isPublic, setPublic] = useState(() => { try { return localStorage.getItem(PUBLIC_KEY) === '1'; } catch { return false; } });
  const rooms = useOpenRooms();
  const searching = useQueue();
  const [guide, setGuide] = useState<string | null>(null);
  const cardZoom = useCardZoom(1200);
  const myDecks = useMyDecks();  // pour savoir si le deck choisi est un deck d'aventure, et le nommer
  // deck perso effacé depuis : il faut en choisir un autre
  const lost = myDecks.ready && !deckInfo(deck);
  const holdDeck = isAdventureDeck(deck);
  const [hold, setHold] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!holdDeck || hold) return;
    let cancelled = false;
    loadHold().then((r) => { if (!cancelled) setHold(holdByNumber(r.cards)); }).catch(() => { /* le serveur vérifiera */ });
    return () => { cancelled = true; };
  }, [holdDeck, hold]);
  const chosen = holdDeck ? deckInfo(deck) : undefined;
  const missing = chosen && hold ? holdProblems(hold, chosen.leader, chosen.cards) : [];
  // le lien d'un ami : rejoindre sa salle d'abord
  const invited = Boolean(initialCode);

  const pick = (id: string) => {
    setDeck(id);
    setPicking(false);
    setError(null);
    try { localStorage.setItem(DECK_KEY, id); } catch { /* stockage indisponible */ }
  };

  const go = async (what: 'create' | 'join', roomCode = code) => {
    setBusy(what);
    setError(null);
    try {
      const v = what === 'create' ? await createRoom(deck, isPublic) : await joinRoom(roomCode, deck);
      onOpen(v.id);
    } catch (e) {
      setError({ on: what === 'join' && roomCode !== code ? 'public' : what, text: e instanceof Error ? e.message : String(e) });
      setBusy(null);
      rooms.refresh();
    }
  };
  const togglePublic = (on: boolean) => {
    setPublic(on);
    try { localStorage.setItem(PUBLIC_KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
  };
  const blocked = busy !== null || missing.length > 0 || lost;

  // file d'attente : adversaire trouvé pendant qu'on regarde cet écran, la partie s'ouvre
  useEffect(() => {
    if (!queue || !searching?.found) return;
    const id = searching.found;
    clearFound();
    onOpen(id);
  }, [queue, searching?.found, onOpen]);

  const deckLine = (
    <DeckLine id={deck} onChange={() => setPicking(true)} missing={missing} hold={holdDeck} loading={!myDecks.ready} />
  );
  const create = (
    <section className={`op-lobby-card${invited ? ' is-second' : ' is-main'}`} aria-labelledby="op-lobby-create" data-ui="lobby.create-card">
      <div className="op-lobby-card-head">
        <h2 id="op-lobby-create">{invited ? 'Ou crée ta propre salle' : 'Créer une salle'}</h2>
        <p>Le serveur te donne un code : envoie-le à ton ami, la partie commence dès qu’il entre.</p>
      </div>
      {!invited && deckLine}
      <label className="op-lobby-public" data-ui="lobby.public">
        <input type="checkbox" checked={isPublic} onChange={(e) => togglePublic(e.target.checked)} />
        <span><b>Salle publique</b> : n’importe quel joueur peut la rejoindre, sans code.</span>
      </label>
      {error?.on === 'create' && <p className="op-lobby-error" role="alert">{error.text}</p>}
      <Button variant={invited ? 'secondary' : 'primary'} size={invited ? 'normal' : 'big'} wide={!invited} busy={busy === 'create'}
        disabled={blocked} onClick={() => void go('create')} data-ui="lobby.create">
        Créer une salle
      </Button>
    </section>
  );
  const join = (
    <section className={`op-lobby-card${invited ? ' is-main' : ''}`} aria-labelledby="op-lobby-join" data-ui="lobby.join-card">
      <div className="op-lobby-card-head">
        <h2 id="op-lobby-join">{invited ? `Rejoindre la salle ${code}` : 'Rejoindre un ami'}</h2>
        <p>{invited ? 'Ton ami t’a invité : choisis ton deck, puis entre dans sa salle.' : 'Ton ami a créé une salle ? Entre le code qu’il t’a donné.'}</p>
      </div>
      {invited && deckLine}
      <form className="op-lobby-join" onSubmit={(e) => { e.preventDefault(); if (code.length === CODE_LENGTH && !blocked) void go('join'); }}>
        <input className="room-input" data-ui="lobby.code" value={code} onChange={(e) => { setCode(cleanCode(e.target.value)); if (error?.on === 'join') setError(null); }}
          placeholder="EX. K7MQ2P" autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text"
          aria-label="Code de la salle" enterKeyHint="go" />
        <Button type="submit" variant={invited ? 'primary' : 'secondary'} size={invited ? 'big' : 'normal'} busy={busy === 'join'}
          disabled={blocked || code.length !== CODE_LENGTH} data-ui="lobby.join">
          Rejoindre
        </Button>
      </form>
      {error?.on === 'join' && <p className="op-lobby-error" role="alert">{error.text}</p>}
    </section>
  );

  const publicRooms = (
    <section className="op-lobby-card" aria-labelledby="op-lobby-rooms" data-ui="lobby.rooms">
      <div className="op-lobby-card-head">
        <h2 id="op-lobby-rooms">Salles publiques</h2>
        <p>{rooms.list === null ? 'Recherche des joueurs qui attendent…'
          : rooms.list.length ? 'Des joueurs attendent un adversaire : entre dans leur salle avec ton deck.'
          : 'Personne n’attend pour l’instant. Crée une salle publique : les autres joueurs la verront ici.'}</p>
      </div>
      {rooms.list && rooms.list.length > 0 && (
        <ul className="op-lobby-rooms">
          {rooms.list.map((r) => <RoomRow key={r.code} room={r} disabled={blocked} busy={busy === 'join'} onJoin={() => void go('join', r.code)} />)}
        </ul>
      )}
      {error?.on === 'public' && <p className="op-lobby-error" role="alert">{error.text}</p>}
    </section>
  );

  if (queue) {
    return (
      <Screen className="op-lobby op-queue" data-ui="queue" title="Trouver un adversaire" subtitle="En ligne, contre un joueur au hasard"
        back={{ label: 'Accueil', onBack, 'data-ui': 'queue.back' }}>
        <div className="op-lobby-body">
          <QueueCard deck={deck} deckLine={deckLine} blocked={blocked} searching={searching}
            onPlayAi={onPlayAi && (() => onPlayAi({ myDeck: deck, aiDeck: randomDeck(deck), first: 'random', level: 3 }))} />
          {publicRooms}
          <p className="op-lobby-foot">Chaque joueur a 25 minutes de réflexion pour la partie (+5 s par décision) ; sans temps, la partie est
            perdue. En ligne, le coach est désactivé et chacun ne voit que ses propres cartes. Pour jouer avec un ami précis :
            <button type="button" className="op-link" onClick={() => navigate({ name: 'ami' })}>Jouer avec un ami</button>.</p>
        </div>
        {picking && (
          <Dialog title="Choisis ton deck" onClose={() => setPicking(false)} size="wide" className="op-lobby-decks" data-ui="lobby.decks">
            <DeckPicker selected={deck} onPick={pick} label="Choisir" onBuilder={() => navigate({ name: 'decks' })}
              onGuide={(id) => { setPicking(false); setGuide(id); }} />
          </Dialog>
        )}
        {guide && <DeckGuideModal deckId={guide} onClose={() => { setGuide(null); cardZoom.close(); setPicking(true); }} onHover={cardZoom.onHover} />}
        {cardZoom.zoom && <CardZoom preview={cardZoom.zoom} onClose={cardZoom.close} />}
      </Screen>
    );
  }

  return (
    <Screen
      className="op-lobby"
      data-ui="lobby"
      title="Jouer avec un ami"
      subtitle="En ligne, avec le code d’une salle"
      back={{ label: 'Accueil', onBack, 'data-ui': 'lobby.back' }}
    >
      <div className="op-lobby-body">
        {invited ? <>{join}{create}{publicRooms}</> : <>{create}{publicRooms}{join}</>}
        <p className="op-lobby-foot">En ligne, le coach et ses conseils sont désactivés, et chacun ne voit que ses propres cartes. Une salle reste ouverte 15 minutes.</p>
      </div>
      {picking && (
        <Dialog title="Choisis ton deck" onClose={() => setPicking(false)} size="wide" className="op-lobby-decks" data-ui="lobby.decks">
          <DeckPicker selected={deck} onPick={pick} label="Choisir" onBuilder={() => navigate({ name: 'decks' })}
            onGuide={(id) => { setPicking(false); setGuide(id); }} />
        </Dialog>
      )}
      {/* le guide (ancienne fenêtre) remplace le choix le temps de le lire, puis le choix revient */}
      {guide && <DeckGuideModal deckId={guide} onClose={() => { setGuide(null); cardZoom.close(); setPicking(true); }} onHover={cardZoom.onHover} />}
      {cardZoom.zoom && <CardZoom preview={cardZoom.zoom} onClose={cardZoom.close} />}
    </Screen>
  );
}

// Le deck choisi, rappelé dans la carte du haut : Leader, nom, style ; « Changer » ouvre le sélecteur
function DeckLine({ id, onChange, missing, hold, loading }: { id: string; onChange: () => void; missing: string[]; hold: boolean; loading: boolean }) {
  const deck = deckInfo(id);
  const known = deck && deck.leader in CARDS;
  const leader = known ? def(deck.leader) : null;
  const colors = leader ? leader.colors.map((c) => COLOR[c] ?? '#666') : [];
  const styles = GUIDES[id]?.styles.slice(0, 2).join(' · ');
  return (
    <div className="op-lobby-deck-wrap">
      <div className="op-lobby-deck" style={colors.length ? { ['--c1' as string]: colors[0], ['--c2' as string]: colors[1] ?? colors[0] } : undefined} data-ui="lobby.deck-line">
        {leader && <img src={cardImage(leader)} alt="" />}
        <div className="op-lobby-deck-text">
          <span className="op-lobby-deck-label">Ton deck</span>
          <strong>{deck?.name ?? (loading ? 'Chargement…' : 'Deck introuvable')}</strong>
          <span className="op-lobby-deck-detail">{hold ? 'Deck d’aventure' : styles ?? (leader ? leader.name : loading ? '' : 'Choisis-en un autre')}</span>
        </div>
        <Button variant="secondary" icon="deck" onClick={onChange} data-ui="lobby.deck">Changer</Button>
      </div>
      {hold && (
        <div className={`op-hold-note${missing.length ? ' op-hold-note-bad' : ''}`} role="status">
          {missing.length
            ? <><b>Il manque des cartes dans ta Cale pour ce deck</b> : {missing.slice(0, 3).join(' ; ')}{missing.length > 3 ? ` (et ${missing.length - 3} autres)` : ''}. Corrige-le dans « Mes decks » ou choisis-en un autre.</>
            : <><b>Deck d’aventure</b> : seulement des cartes gagnées dans l’Aventure. Ton ami le verra, et le serveur vérifie au début de la partie que tu les as toujours.</>}
        </div>
      )}
    </div>
  );
}

// La file : chercher avec le deck choisi ; pendant l'attente, le temps, les joueurs du jour, et l'IA Expert en attendant
function QueueCard({ deck, deckLine, blocked, searching, onPlayAi }: {
  deck: string;
  deckLine: ReactNode;
  blocked: boolean;
  searching: ReturnType<typeof useQueue>;
  onPlayAi?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [stats, setStats] = useState<{ today: number; waiting: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let cancelled = false;
    const read = () => queueStats().then((s) => { if (!cancelled) setStats(s); }).catch(() => undefined);
    read();
    const t = setInterval(read, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [searching]);
  const go = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await startQueue(deck);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const people = stats ? `${stats.today} joueur${stats.today > 1 ? 's' : ''} en ligne ces dernières 24 h${stats.waiting ? ` · ${stats.waiting} en attente maintenant` : ''}` : null;
  if (searching && !searching.found) {
    return (
      <section className="op-lobby-card is-main op-queue-wait" aria-live="polite" data-ui="queue.waiting">
        <div className="op-queue-radar" aria-hidden="true"><Icon name="search" size="2rem" /></div>
        <div className="op-lobby-card-head">
          <h2>Recherche d’un adversaire…</h2>
          <p>{waited(searching.since, now)} · {people ?? 'tu seras prévenu dès qu’un joueur arrive'}</p>
        </div>
        <p className="op-queue-tip">Personne pour l’instant ? Ne reste pas à attendre : joue contre l’<b>IA Expert</b> avec ton deck. La recherche
          continue, et un bandeau te prévient (avec un son) dès qu’un adversaire est trouvé.</p>
        {onPlayAi && <Button variant="primary" size="big" wide icon="swords" onClick={onPlayAi} data-ui="queue.ai">Jouer contre l’IA en attendant</Button>}
        <Button variant="secondary" onClick={() => void stopQueue()} data-ui="queue.cancel">Arrêter la recherche</Button>
        {searching.error && <p className="op-lobby-error" role="alert">{searching.error}</p>}
      </section>
    );
  }
  return (
    <section className="op-lobby-card is-main" aria-labelledby="op-queue-title" data-ui="queue.card">
      <div className="op-lobby-card-head">
        <h2 id="op-queue-title">Choisis ton deck, on te trouve un adversaire</h2>
        <p>{people ?? 'Un joueur au hasard, avec le deck de son choix.'}</p>
      </div>
      {deckLine}
      {error && <p className="op-lobby-error" role="alert">{error}</p>}
      <Button variant="primary" size="big" wide icon="search" busy={busy} disabled={blocked} onClick={() => void go()} data-ui="queue.start">
        Chercher un adversaire
      </Button>
    </section>
  );
}
