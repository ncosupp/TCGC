// Le deck d'aventure (tâche 1.18, refait par R3.4) : le deck avec lequel on joue les chapitres, construit avec les
// cartes de la Cale. L'écran résume le deck choisi, puis montre mes decks d'aventure dans le même sélecteur que pour
// jouer (DeckPicker) : toucher un deck jouable le choisit pour l'aventure (chooseAdventureDeck) ; « Modifier » ouvre
// « La table » (web/src/cale/jeu, refonte du jeu) avec la réserve de la Cale : seules les cartes possédées sont
// proposées, au plus min(possédées, 4) par numéro, et le deck est enregistré en mode 'aventure'.
import { useEffect, useMemo, useState } from 'react';
import { CARDS } from '../../engine/cards/index.ts';
import { copyName, fits, playableNums } from '../builder/table.ts';
import { CostCurve } from '../DeckGuide.tsx';
import { Button, Screen } from '../kit/index.ts';
import { isAdventureDeck, loadMyDecks, newDeckId, playable, saveMyDeck, useMyDecks, type MyDeck } from '../myDecks.ts';
import { navigate } from '../routes.ts';
import { DeckPicker } from '../setup/DeckPicker.tsx';
import { useSettings } from '../settings.ts';
import { ADVENTURE_DECK, BACK } from '../texts.ts';
import { CardZoom, useCardZoom } from '../Zoom.tsx';
import { chooseAdventureDeck } from './api.ts';
import { holdLimit } from './hold.ts';
import { arcStarted, useHoldState } from './holdState.ts';

// Exemplaires de la Cale qui pourraient encore rejoindre ce deck (cartes jouables, permises avec son Leader)
function roomInDeck(deck: MyDeck, hold: Record<string, number>): number {
  return playableNums().filter((n) => (hold[n] ?? 0) > 0 && fits(deck.leader, n))
    .reduce((sum, n) => sum + Math.max(0, holdLimit(hold, CARDS[n]) - (deck.cards[n] ?? 0)), 0);
}

export function AdventureDeckScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload, setAdventure } = useHoldState();
  const { decks, ready, error: decksError } = useMyDecks();
  const [settings] = useSettings();
  const zoom = useCardZoom(settings.zoomDelay);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // le deck de départ est créé par le serveur au début de l'aventure : relire mes decks
  useEffect(() => { void loadMyDecks(); }, []);

  const mine = decks.filter((d) => isAdventureDeck(d));
  const chosenId = data?.adventure.deckId ?? null;
  const chosen = mine.find((d) => d.id === chosenId);
  const room = useMemo(() => (chosen && data ? roomInDeck(chosen, data.byNumber) : 0), [chosen, data]);
  const holdCount = data ? Object.values(data.byNumber).reduce((a, b) => a + b, 0) : 0;

  // un deck s'ouvre sur « La table » (#play/decks/<id>) ; son retour revient ici
  const edit = (d: MyDeck) => navigate({ name: 'decks', id: d.id });
  const copy = (d: MyDeck) => {
    setBusy(true);
    setMessage(null);
    const id = newDeckId();
    saveMyDeck({ id, name: copyName(d.name), leader: d.leader, cards: { ...d.cards }, looks: d.looks, mode: 'aventure' })
      .then(() => navigate({ name: 'decks', id }), (e: Error) => setMessage(e.message)).finally(() => setBusy(false));
  };
  // toucher un deck : le choisir pour l'aventure s'il est jouable, sinon l'ouvrir pour le terminer
  const pick = (id: string) => {
    const d = mine.find((x) => x.id === id);
    if (!d || busy || id === chosenId) return;
    if (!playable(d)) return edit(d);
    setBusy(true);
    setMessage(null);
    chooseAdventureDeck(id).then(setAdventure, (e: Error) => setMessage(e.message)).finally(() => setBusy(false));
  };
  return (
    <Screen title={ADVENTURE_DECK.title} back={{ label: BACK.map, onBack, 'data-ui': 'adventure-deck.back' }} className="op-adeck" data-ui="adventure-deck">
      <div className="op-adeck-body">
        {!data && !error && <p className="op-muted"><span className="op-spinner" /> Chargement de ta Cale…</p>}
        {(error || decksError) && (
          <p className="danger">
            {error ?? 'Impossible de charger tes decks : vérifie ta connexion.'}{' '}
            <button className="op-btn op-btn-ghost btn-small" onClick={() => { void reload(); void loadMyDecks(); }}>Réessayer</button>
          </p>
        )}
        {data && !arcStarted(data.adventure) && (
          <div className="history-empty">
            <p>Ton aventure n’a pas encore commencé.</p>
            <p className="op-muted op-small">Prends la mer depuis la carte du monde : tu recevras ton deck de départ, et ses cartes rempliront ta Cale.</p>
          </div>
        )}
        {data && arcStarted(data.adventure) && (
          <>
            <p className="op-muted op-adeck-intro">
              Tu joues les chapitres avec le deck choisi. Améliore-le avec les cartes gagnées dans les boosters : ta Cale
              en contient {holdCount}.
            </p>
            <section className="op-adeck-current" aria-label="Deck choisi">
              {chosen ? (
                <div className="op-adeck-chosen">
                  <div className="op-adeck-chosen-text">
                    <h2>Deck choisi : {chosen.name}</h2>
                    {!playable(chosen) && <p className="danger op-small">⚠ Ce deck n’est pas jouable (il faut 50 cartes qui respectent les règles) : complète-le pour combattre.</p>}
                    <p className="op-small">{room > 0
                      ? <>🆕 <b>{room}</b> carte{room > 1 ? 's' : ''} de ta Cale pourrai{room > 1 ? 'ent' : 't'} rejoindre ce deck : appuie sur « Modifier ».</>
                      : <span className="op-muted">Toutes les cartes de ta Cale qui vont avec ce Leader y sont déjà.</span>}</p>
                    <div className="db-actions">
                      <Button variant="primary" data-ui="adventure-deck.edit" onClick={() => edit(chosen)}>Modifier</Button>
                      <Button data-ui="adventure-deck.copy" busy={busy} onClick={() => copy(chosen)}>Copier</Button>
                    </div>
                  </div>
                  <div className="op-adeck-curve"><CostCurve deck={chosen} /></div>
                </div>
              ) : ready ? (
                <p className="op-muted">Aucun deck choisi : touche un de tes decks d’aventure ci-dessous, ou crée-en un.</p>
              ) : null}
            </section>
            <section>
              <h2>Mes decks d’aventure</h2>
              {mine.length > 1 && <p className="op-small op-muted">Touche un deck pour jouer l’aventure avec lui. Pour essayer une autre idée sans toucher à ton deck, fais-en une copie.</p>}
              <DeckPicker source="adventure" selected={chosenId ?? ''} chosen={chosenId} onPick={pick} label="Choisir pour l’aventure"
                actions={(id) => {
                  const d = mine.find((x) => x.id === id);
                  return d && <button className="deck-guide-btn" data-ui="adventure-deck.edit-one" onClick={() => edit(d)} aria-label={`Modifier ${d.name}`}>Modifier</button>;
                }}
                empty={ready && <p className="op-small op-muted">Pas encore de deck d’aventure.</p>} />
              <div className="db-actions op-adeck-actions">
                <Button variant="primary" data-ui="adventure-deck.new" onClick={() => navigate({ name: 'decks', id: 'nouveau-aventure' })}>＋ Nouveau deck d’aventure</Button>
              </div>
            </section>
            {message && <p className="danger">{message}</p>}
          </>
        )}
      </div>
      {zoom.zoom && <CardZoom preview={zoom.zoom} onClose={zoom.close} />}
    </Screen>
  );
}
