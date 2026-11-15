// Accueil de « Jouer » (#play ; tâche R3.1, revu à l'étape J) : ce qu'il y a à faire, dans l'ordre où on le cherche.
// - en-tête : Joy Boy, bourse (mène à la boutique), aide, réglages ;
// - « À la une » : une seule chose, la plus utile maintenant (apprendre à jouer pour un nouveau, des récompenses à
//   récupérer, des boosters à ouvrir) ; puis l'invitation à garder sa progression pour un essai sans compte ;
// - « Continuer » : ce qui est en cours (partie en ligne ou salle, partie rapide interrompue, chapitre interrompu) ;
// - colonne « jouer » : l'Aventure en vedette, puis Trouver un adversaire, Partie rapide et Jouer avec un ami ;
// - colonne « progresser » : prime, missions du jour, exploits (Profil pirate), puis les accès secondaires.
// Sur ordinateur les deux colonnes sont côte à côte ; sur téléphone, l'une sous l'autre.
// Rien ne se lance tout seul : une partie interrompue est proposée, et reprise seulement sur « Reprendre ».
import { useState, type ReactNode } from 'react';
import { LEVELS, type Level } from '../../ai/search.ts';
import { replayRecord, type Replayed } from '../../coach/archive.ts';
import type { Progress } from '../../progress/catalog.ts';
import { dismissNudge, isGuestAccount, nudgeDismissedToday } from '../account.ts';
import type { HomeActions } from '../App.tsx';
import { loadRecord } from '../archiveClient.ts';
import { useWallet, WalletBadge } from '../economy/Wallet.tsx';
import { AsyncState, Button, Icon, IconButton, Screen, type IconName } from '../kit/index.ts';
import { deckLabel, useMyDecks } from '../myDecks.ts';
import type { CurrentMatch } from '../online/api.ts';
import { BountyLine, MissionRow } from '../progress/ProgressUi.tsx';
import { useProgress } from '../progress/store.ts';
import { navigate } from '../routes.ts';
import { learnStatus, setLearnStatus } from '../learn/LessonBubble.tsx';
import { adventureProgress, interruptedChapter, interruptedQuick, quickRecord, since, type AdventureProgress, type HomeGame } from './logic.ts';
import { useHome } from './useHome.ts';

// resume : reprise d'une partie rapide interrompue (même enregistrement, à l'adresse de la partie) ; help, settings :
// l'aide et les réglages, ouverts par App (comme avec la touche « ? »)
export interface HomeProps extends HomeActions {
  notice?: string;
  // emplacement du classé (étape 3), entre les modes de jeu : rien ne le remplit aujourd'hui
  ranked?: ReactNode;
}

const levelName = (level: number) => LEVELS[level as Level]?.name ?? `niveau ${level}`;

// Le nom du jeu et son soleil (le logo de l'appli)
export function Brand() {
  return (
    <span className="op-home-brand">
      <img src={`${import.meta.env?.BASE_URL ?? '/'}logo.png`} alt="" width={32} height={32} />
      <span>Joy Boy</span>
    </span>
  );
}

export function Home({ notice, resume, learn, help, settings, ranked }: HomeProps) {
  useMyDecks();   // noms de mes decks (parties interrompues avec un deck perso)
  // « Apprendre à jouer » : proposé en tête tant qu'il n'est ni fait ni écarté (« Je connais le jeu »)
  const [learnShown, setLearnShown] = useState(() => learnStatus() === 'new');
  const [nudge, setNudge] = useState(() => isGuestAccount() && !nudgeDismissedToday());
  const data = useHome();
  const { wallet } = useWallet();
  const { progress } = useProgress();
  const now = Date.now();
  const games = data.games ?? [];
  const quick = interruptedQuick(games, now, data.dismissed);
  const chapter = data.adventure ? interruptedChapter(games, data.adventure.deckId, now, data.dismissed) : undefined;
  const adv = data.adventure ? adventureProgress(data.adventure) : null;
  const record = quickRecord(games);
  const played = (progress?.bounty.amount ?? 0) > 0 || games.length > 0;

  return (
    <Screen
      className="op-home"
      data-ui={data.ready ? 'home' : 'home.loading'}
      title={<Brand />}
      extra={(
        <span className="op-home-wallet" data-ui="home.wallet">
          <WalletBadge wallet={wallet} onClick={() => navigate({ name: 'boutique' })} />
        </span>
      )}
      actions={[
        { id: 'help', label: 'Comment jouer ?', icon: 'help', onClick: help, 'data-ui': 'home.help' },
        { id: 'settings', label: 'Réglages', icon: 'settings', onClick: settings, 'data-ui': 'home.settings' },
      ]}
    >
      {!data.ready ? <AsyncState loading loadingText="Chargement de l’accueil…" /> : <div className="op-home-body">
        {notice && <p className="setup-notice">{notice}</p>}
        {learnShown ? (
          <section className="op-home-learn" aria-labelledby="op-home-learn" data-ui="home.learn-card">
            <span className="op-home-learn-icon" aria-hidden="true"><Icon name="compass" size="1em" /></span>
            <div className="op-home-learn-text">
              <h2 id="op-home-learn" className="op-home-learn-title">Nouveau au One Piece Card Game ?</h2>
              <p>Apprends en jouant : une vraie partie, chaque règle expliquée au bon moment. Environ 10 minutes, et ton
                premier booster à la clé.</p>
              <div className="op-home-learn-actions">
                <Button variant="primary" data-ui="home.learn" onClick={learn}>Apprendre à jouer</Button>
                <Button variant="quiet" data-ui="home.learn-skip" onClick={() => { setLearnStatus('dismissed'); setLearnShown(false); }}>Je connais le jeu</Button>
              </div>
            </div>
          </section>
        ) : <Spotlight progress={progress} boosters={adv?.boosters ?? 0} />}

        {nudge && played && (
          <div className="op-home-nudge" role="note" data-ui="home.account">
            <Icon name="lock" />
            <p>Ta Cale, tes Berry et ton aventure ne sont gardés que sur cet appareil. <strong>Crée ton compte</strong> pour
              les garder partout (20 secondes, sans e-mail obligatoire).</p>
            <a className="op-kit-btn op-kit-btn-primary" href="#creer-compte" data-ui="home.account-create"><span className="op-kit-btn-text">Créer mon compte</span></a>
            <IconButton icon="close" variant="quiet" label="Plus tard" onClick={() => { dismissNudge(); setNudge(false); }} data-ui="home.account-later" />
          </div>
        )}

        {(data.online || quick || chapter) && (
          <section className="op-home-continue" aria-labelledby="op-home-continue" data-ui="home.continue">
            <h2 id="op-home-continue" className="op-home-label">Continuer</h2>
            {data.online && <OnlineRow match={data.online} />}
            {quick && <QuickRow game={quick} now={now} onResume={resume} onDismiss={() => data.dismiss(quick.id)} />}
            {chapter && (
              <ContinueRow icon="map" data-ui="home.chapter"
                title={<>Aventure : {chapter.chapter.place}</>}
                detail={`Contre ${chapter.chapter.opponent.name} · tour ${chapter.game.turns} · ${since(chapter.game.updatedAt, now)}`}
                onDismiss={() => data.dismiss(chapter.game.id)}>
                <Button variant="primary" data-ui="home.chapter-resume"
                  onClick={() => navigate({ name: 'aventure', screen: { kind: 'chapter', id: chapter.chapter.id } })}>Reprendre</Button>
              </ContinueRow>
            )}
          </section>
        )}

        <div className="op-home-cols">
          <div className="op-home-play">
            <AdventureCard progress={adv} failed={data.adventureFailed} />
            <div className="op-home-modes">
              <ModeTile icon="search" title="Trouver un adversaire" data-ui="home.queue" featured={!learnShown}
                text="En ligne : un joueur au hasard, ou l’IA Expert en attendant" onClick={() => navigate({ name: 'chercher' })} />
              <ModeTile icon="swords" title="Partie rapide" data-ui="home.quick"
                text={record.played ? `Contre l’IA · ${record.wins} victoire${record.wins > 1 ? 's' : ''} sur ${record.played}` : 'Contre l’IA, avec le deck de ton choix'}
                onClick={() => navigate({ name: 'rapide' })} />
              <ModeTile icon="globe" title="Jouer avec un ami" data-ui="home.online" className="is-online"
                text="Avec le code d’un ami, ou une salle publique" onClick={() => navigate({ name: 'ami' })} />
              {ranked}
            </div>
          </div>

          <div className="op-home-side">
            {progress && <ProgressCard progress={progress} />}
            <nav className="op-home-more" aria-label="Plus">
              <SecondaryLink icon="deck" label="Mes decks" data-ui="home.decks" onClick={() => navigate({ name: 'decks' })} />
              <SecondaryLink icon="history" label="Mes parties" data-ui="home.history" onClick={() => navigate({ name: 'parties' })} />
              <SecondaryLink icon="hold" label="Ma Cale" data-ui="home.hold" onClick={() => navigate({ name: 'aventure', screen: { kind: 'hold' } })} />
              <SecondaryLink icon="shop" label="Boutique" data-ui="home.shop" onClick={() => navigate({ name: 'boutique' })} />
            </nav>
          </div>
        </div>
        <p className="op-home-foot">
          <a className="op-link" href="#legal" title="Projet de fan non officiel : mentions légales et confidentialité">À propos de Joy Boy</a>
        </p>
      </div>}
    </Screen>
  );
}

// ---------- À la une ----------

// Une seule carte : des récompenses à récupérer, sinon des boosters à ouvrir ; rien sinon
function Spotlight({ progress, boosters }: { progress: Progress | null; boosters: number }) {
  const claim = progress?.toClaim ?? 0;
  if (claim > 0) {
    return (
      <button type="button" className="op-home-spot" onClick={() => navigate({ name: 'profil' })} data-ui="home.spot-claim">
        <span className="op-home-spot-icon" aria-hidden="true"><Icon name="gift" size="1.8rem" /></span>
        <span className="op-home-spot-text">
          <strong>{claim > 1 ? `${claim} récompenses t’attendent` : 'Une récompense t’attend'}</strong>
          <span>Exploits et missions remplis : récupère tes Berry dans ton profil.</span>
        </span>
        <span className="op-home-spot-go" aria-hidden="true">Récupérer</span>
      </button>
    );
  }
  if (boosters > 0) {
    return (
      <button type="button" className="op-home-spot" onClick={() => navigate({ name: 'aventure', screen: { kind: 'hold' } })} data-ui="home.spot-boosters">
        <span className="op-home-spot-icon" aria-hidden="true"><Icon name="chest" size="1.8rem" /></span>
        <span className="op-home-spot-text">
          <strong>{boosters > 1 ? `${boosters} boosters à ouvrir` : 'Un booster à ouvrir'}</strong>
          <span>Ils t’attendent dans ta Cale.</span>
        </span>
        <span className="op-home-spot-go" aria-hidden="true">Ouvrir</span>
      </button>
    );
  }
  return null;
}

// ---------- Progression ----------

function ProgressCard({ progress }: { progress: Progress }) {
  const done = progress.exploits.filter((e) => e.done).length;
  return (
    <section className="op-home-prog" aria-labelledby="op-home-prog" data-ui="home.progress">
      <h2 id="op-home-prog" className="op-home-label">Ta progression</h2>
      <button type="button" className="op-home-prog-head" onClick={() => navigate({ name: 'profil' })} data-ui="home.profile">
        <Icon name="bounty" size="2rem" />
        <BountyLine progress={progress} />
      </button>
      <ul className="op-prog-list" aria-label="Missions du jour">
        {progress.missions.items.map((m) => <MissionRow key={m.id} mission={m} />)}
      </ul>
      <div className="op-home-prog-foot">
        <span>Exploits : {done}/{progress.exploits.length} · nouvelles missions à minuit</span>
        <Button variant="quiet" icon="trophy" onClick={() => navigate({ name: 'profil' })} data-ui="home.profile-open">Mon profil</Button>
      </div>
    </section>
  );
}

// ---------- Modes ----------

function ModeTile({ icon, title, text, onClick, featured, className, 'data-ui': dataUi }: {
  icon: IconName; title: string; text: string; onClick: () => void; featured?: boolean; className?: string; 'data-ui': string;
}) {
  return (
    <button type="button" className={`op-home-mode${featured ? ' is-featured' : ''}${className ? ` ${className}` : ''}`} data-ui={dataUi} onClick={onClick}>
      <span className="op-home-mode-icon" aria-hidden="true"><Icon name={icon} size="1em" /></span>
      <span className="op-home-mode-title">{title}</span>
      <span className="op-home-mode-text">{text}</span>
    </button>
  );
}

// ---------- Continuer ----------

function ContinueRow({ icon, title, detail, error, onDismiss, children, 'data-ui': dataUi }: {
  icon: IconName;
  title: ReactNode;
  detail: ReactNode;
  error?: string;
  onDismiss?: () => void;
  children: ReactNode;
  'data-ui'?: string;
}) {
  return (
    <div className="op-home-row" data-ui={dataUi}>
      <span className="op-home-row-icon" aria-hidden="true"><Icon name={icon} size="1em" /></span>
      <div className="op-home-row-text">
        <strong>{title}</strong>
        <span className="op-home-row-detail">{detail}</span>
        {error && <span className="op-home-row-error" role="alert">{error}</span>}
      </div>
      <div className="op-home-row-actions">
        {children}
        {onDismiss && <IconButton icon="close" variant="quiet" label="Ignorer : ne plus la proposer ici (elle reste dans « Mes parties »)" onClick={onDismiss} data-ui={dataUi && `${dataUi}-dismiss`} />}
      </div>
    </div>
  );
}

function OnlineRow({ match }: { match: CurrentMatch }) {
  const playing = match.status === 'playing';
  return (
    <ContinueRow icon="globe" data-ui="home.online-current"
      title={playing ? <>En ligne contre {match.opponent ?? 'ton ami'}</> : <>Ta salle {match.code} attend un adversaire</>}
      detail={playing ? 'La partie t’attend.' : 'Envoie le code à un ami, ou rouvre la salle.'}>
      <Button variant="primary" data-ui="home.online-resume" onClick={() => navigate({ name: 'partie', id: match.id })}>
        {playing ? 'Reprendre' : 'Ouvrir'}
      </Button>
    </ContinueRow>
  );
}

function QuickRow({ game, now, onResume, onDismiss }: { game: HomeGame; now: number; onResume: HomeActions['resume']; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { config } = game;
  const resume = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const rec = await loadRecord(game.id);
      let replayed: Replayed;
      try {
        replayed = replayRecord(rec);
      } catch {
        throw new Error('Cette partie ne peut plus être reprise : le jeu a été mis à jour depuis. Retrouve-la dans « Mes parties ».');
      }
      onResume(rec, replayed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <ContinueRow icon="swords" data-ui="home.resume" error={error} onDismiss={onDismiss}
      title={<>{deckLabel(config.myDeck, config.myDeckName)} <span className="op-home-vs">contre</span> {deckLabel(config.aiDeck, config.aiDeckName)}</>}
      detail={`Partie rapide · IA ${levelName(config.level)} · tour ${game.turns} · ${since(game.updatedAt, now)}`}>
      <Button variant="primary" busy={busy} onClick={() => void resume()} data-ui="home.resume-go">Reprendre</Button>
    </ContinueRow>
  );
}

// ---------- Aventure ----------

function AdventureCard({ progress, failed }: { progress: AdventureProgress | null; failed: boolean }) {
  const loading = !progress && !failed;
  const p = progress;
  const started = Boolean(p?.started);
  const title = !p || !started ? 'Prends la mer !'
    : p.finished || !p.next ? `${p.arc.title} : terminé !`
      : `Chapitre ${p.nextNumber} : ${p.next.place}`;
  const text = !p || !started
    ? 'Pars d’East Blue avec un deck de départ, affronte les adversaires de l’histoire et gagne des boosters pour améliorer ton deck.'
    : p.finished || !p.next
      ? (p.challengesLeft ? `Il te reste ${p.challengesLeft > 1 ? `${p.challengesLeft} défis` : 'un défi'} à relever. La suite du voyage arrive bientôt.` : 'Tous les adversaires sont battus. La suite du voyage arrive bientôt.')
      : `${p.next.title} · contre ${p.next.opponent.name}`;
  const open = () => {
    if (p && started && !p.finished && p.next) navigate({ name: 'aventure', screen: { kind: 'chapter', id: p.next.id } });
    else navigate({ name: 'aventure' });
  };
  return (
    <section className={`op-home-adv${loading ? ' is-loading' : ''}`} aria-labelledby="op-home-adv-title" data-ui="home.adventure-card">
      <div className="op-home-adv-sea" aria-hidden="true">
        <span className="op-home-adv-ship"><Icon name="ship" size="1em" /></span>
      </div>
      <div className="op-home-adv-body">
        <p className="op-home-label">Aventure{p ? ` · ${p.arc.title}` : ''}</p>
        <h2 id="op-home-adv-title" className="op-home-adv-title">{title}</h2>
        <p className="op-home-adv-text">{text}</p>
        {p && started && (
          <div className="op-home-adv-progress" role="img" aria-label={`${p.won} chapitre${p.won > 1 ? 's' : ''} gagné${p.won > 1 ? 's' : ''} sur ${p.total}`}>
            <span className="op-home-adv-dots" aria-hidden="true">
              {Array.from({ length: p.total }, (_, i) => <i key={i} className={i < p.won ? 'is-won' : i === p.won ? 'is-next' : undefined} />)}
            </span>
            <span className="op-home-adv-count">{p.won}/{p.total}</span>
          </div>
        )}
        <div className="op-home-adv-actions">
          <Button variant="primary" size="big" onClick={open} data-ui="home.adventure">
            {!started ? 'Partir à l’aventure' : p?.finished || !p?.next ? 'Ouvrir la carte' : 'Continuer l’aventure'}
          </Button>
          {started && p?.next && !p.finished && (
            <Button variant="quiet" icon="map" onClick={() => navigate({ name: 'aventure' })} data-ui="home.adventure-map">Carte</Button>
          )}
          {p && p.boosters > 0 && (
            <Button variant="quiet" icon="hold" onClick={() => navigate({ name: 'aventure', screen: { kind: 'hold' } })} data-ui="home.adventure-hold">
              {p.boosters} booster{p.boosters > 1 ? 's' : ''} à ouvrir
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- Accès secondaires ----------

function SecondaryLink({ icon, label, onClick, 'data-ui': dataUi }: { icon: IconName; label: string; onClick: () => void; 'data-ui': string }) {
  return (
    <button type="button" className="op-home-link" onClick={onClick} data-ui={dataUi}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}
