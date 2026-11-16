// Profil pirate (#play/profil, étape J) : l'avis de recherche (nom, prime, titre, Leader favori), les missions du jour
// et de la semaine, et les exploits par famille, chacun récupérable une fois obtenu. Tout vient du serveur
// (server/game-progress.js) ; le joueur ne choisit que son titre et le portrait.
import { useMemo, useState } from 'react';
import { cardData } from '../../engine/cards/index.ts';
import { bountyText, FAMILIES, type Progress } from '../../progress/catalog.ts';
import { BoosterOpening } from '../adventure/BoosterOpening.tsx';
import { useBoosterOpening } from '../economy/useBoosterOpening.ts';
import { AsyncState, Button, Screen } from '../kit/index.ts';
import { useMyDecks } from '../myDecks.ts';
import { BountyLine, ExploitRow, MissionRow, WantedPoster } from './ProgressUi.tsx';
import { saveProfile, useProgress } from './store.ts';

export function ProfileScreen({ onBack }: { onBack: () => void }) {
  const { progress, error } = useProgress();
  const opening = useBoosterOpening();
  if (opening.props) return <BoosterOpening {...opening.props} />;
  return (
    <Screen className="op-profile" data-ui={progress ? 'profile' : 'profile.loading'} title="Profil pirate"
      back={{ label: 'Accueil', onBack, 'data-ui': 'profile.back' }}>
      {!progress ? <AsyncState loading={!error} error={error ?? undefined} loadingText="Chargement de ton profil…" /> : (
        <div className="op-profile-body">
          <section className="op-profile-id" aria-label="Ton avis de recherche">
            <WantedPoster progress={progress} />
            <div className="op-profile-side">
              <BountyLine progress={progress} />
              <p className="op-muted op-small">{progress.bounty.rank.line}</p>
              <ProfileChoices progress={progress} />
              <ShareButton progress={progress} />
            </div>
          </section>

          <section className="op-profile-section" aria-labelledby="op-profile-missions">
            <h2 id="op-profile-missions" className="op-home-label">Missions du jour</h2>
            <ul className="op-prog-list">{progress.missions.items.map((m) => <MissionRow key={m.id} mission={m} />)}</ul>
            <p className="op-muted op-small">Nouvelles missions demain à minuit.</p>
            <h2 className="op-home-label">Mission de la semaine</h2>
            <ul className="op-prog-list"><MissionRow mission={progress.missions.weekly} /></ul>
          </section>

          <section className="op-profile-section" aria-labelledby="op-profile-exploits">
            <h2 id="op-profile-exploits" className="op-home-label">
              Exploits · {progress.exploits.filter((e) => e.done).length}/{progress.exploits.length}
            </h2>
            {FAMILIES.map((f) => (
              <div key={f.id} className="op-profile-family">
                <h3>{f.name}</h3>
                <ul className="op-prog-list">
                  {progress.exploits.filter((e) => e.family === f.id).map((e) => (
                    <ExploitRow key={e.id} exploit={e} onBoosters={(b) => void opening.start(b)} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </Screen>
  );
}

// Titre (exploits obtenus, paliers atteints) et portrait (Leaders de mes decks)
function ProfileChoices({ progress }: { progress: Progress }) {
  const { decks } = useMyDecks();
  const [error, setError] = useState<string>();
  const titles = useMemo(() => [
    ...progress.exploits.filter((e) => e.done).map((e) => ({ id: e.id, name: e.name })),
  ], [progress]);
  const leaders = useMemo(() => {
    const ids = new Set<string>(decks.map((d) => d.leader));
    if (progress.profile.leader) ids.add(progress.profile.leader);
    return [...ids].filter((id) => cardData()[id]).map((id) => ({ id, name: `${cardData()[id].name} (${id})` }));
  }, [decks, progress.profile.leader]);
  const save = (change: { title?: string | null; leader?: string | null }) => {
    setError(undefined);
    saveProfile(change).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <div className="op-profile-choices">
      <label>
        <span>Titre affiché</span>
        <select value={progress.profile.title ?? ''} onChange={(e) => save({ title: e.target.value || null })} data-ui="profile.title">
          <option value="">{progress.bounty.rank.name} (ton palier)</option>
          {titles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label>
        <span>Portrait</span>
        <select value={progress.profile.leader ?? ''} onChange={(e) => save({ leader: e.target.value || null })} data-ui="profile.leader">
          <option value="">Aucun</option>
          {leaders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      {!leaders.length && <p className="op-muted op-small">Crée un deck dans « Mes decks » pour choisir son Leader en portrait.</p>}
      {error && <p className="op-prog-error" role="alert">{error}</p>}
    </div>
  );
}

// Partager son avis de recherche : le partage du téléphone, sinon le texte copié
function ShareButton({ progress }: { progress: Progress }) {
  const [done, setDone] = useState(false);
  const text = `Ma prime sur Joy Boy : ${bountyText(progress.bounty.amount)}, ${progress.bounty.rank.name}. Viens jouer au One Piece Card Game !`;
  const url = `${location.origin}${import.meta.env.BASE_URL}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Joy Boy', text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setDone(true);
      }
    } catch {
      // partage annulé
    }
  };
  return <Button variant="secondary" icon="bounty" onClick={() => void share()} data-ui="profile.share">{done ? 'Texte copié' : 'Partager ma prime'}</Button>;
}
