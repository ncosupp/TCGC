// Briques de la progression (étape J, fiche UI § 5) : badge d'exploit, ligne d'exploit et de mission avec
// « Récupérer », barre de prime, avis de recherche. Visuels maison (icônes du kit, papier en CSS) : rien de Bandai.
import { useState } from 'react';
import { cardData } from '../../engine/cards/index.ts';
import { bountyText, RANK_NAMES, type ExploitFamily, type ExploitState, type MissionState, type Progress } from '../../progress/catalog.ts';
import { ApiError } from '../api.ts';
import { berry } from '../economy/Wallet.tsx';
import { cardImage } from '../images.ts';
import { Button, Icon, type IconName } from '../kit/index.ts';
import { claimExploit, claimMission } from './store.ts';
import type { BoosterToOpen } from '../economy/useBoosterOpening.ts';

const FAMILY_ICON: Record<ExploitFamily, IconName> = {
  aventure: 'anchor', combat: 'swords', 'en-ligne': 'globe', collection: 'chest', maitrise: 'star',
};

export function ExploitBadge({ exploit, size = 'normal' }: { exploit: Pick<ExploitState, 'family' | 'rank' | 'done'>; size?: 'normal' | 'big' }) {
  return (
    <span className={`op-prog-badge is-${exploit.rank}${exploit.done ? '' : ' is-locked'}${size === 'big' ? ' is-big' : ''}`} aria-hidden="true">
      <Icon name={FAMILY_ICON[exploit.family]} />
    </span>
  );
}

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

function Bar({ have, need, label }: { have: number; need: number; label: string }) {
  const pct = need ? Math.min(100, Math.round((have / need) * 100)) : 0;
  return (
    <span className="op-prog-bar" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={have} aria-label={label}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

// Un exploit : badge, nom, texte, avancement, et « Récupérer » quand il est obtenu. onBoosters : des boosters donnés
// (« Premiers pas ») à ouvrir tout de suite
export function ExploitRow({ exploit, onBoosters }: { exploit: ExploitState; onBoosters?: (b: BoosterToOpen[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = exploit.done && !exploit.claimed;
  const claim = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await claimExploit(exploit.id);
      if (r.boosters.length) onBoosters?.(r.boosters);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const reward = `${berry(exploit.berry)}${exploit.boosters ? ` + ${exploit.boosters.count} booster ${exploit.boosters.set}` : ''}`;
  return (
    <li className={`op-prog-row${ready ? ' is-ready' : ''}${exploit.claimed ? ' is-claimed' : ''}`} data-ui={`exploit.${exploit.id}`}>
      <ExploitBadge exploit={exploit} />
      <div className="op-prog-row-text">
        <strong>{exploit.name}</strong>
        <span className="op-prog-row-detail">{exploit.text} · {RANK_NAMES[exploit.rank]}</span>
        {!exploit.done && exploit.need > 1 && (
          <span className="op-prog-row-progress"><Bar have={exploit.have} need={exploit.need} label={`${exploit.have} sur ${exploit.need}`} /> {exploit.have}/{exploit.need}</span>
        )}
        {error && <span className="op-prog-error" role="alert">{error}</span>}
      </div>
      <div className="op-prog-row-end">
        {ready ? (
          <Button variant="primary" icon="gift" busy={busy} onClick={() => void claim()} data-ui={`exploit.${exploit.id}.claim`}>Récupérer {reward}</Button>
        ) : exploit.claimed ? (
          <span className="op-prog-done"><Icon name="check" /> Récupéré</span>
        ) : (
          <span className="op-prog-reward">{reward}</span>
        )}
      </div>
    </li>
  );
}

export function MissionRow({ mission }: { mission: MissionState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = mission.done && !mission.claimed;
  const claim = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await claimMission(mission.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`op-prog-mission${ready ? ' is-ready' : ''}${mission.claimed ? ' is-claimed' : ''}`} data-ui={`mission.${mission.id}`}>
      <div className="op-prog-row-text">
        <strong>{mission.title}</strong>
        <span className="op-prog-row-progress"><Bar have={mission.have} need={mission.need} label={`${mission.have} sur ${mission.need}`} /> {mission.have}/{mission.need}</span>
        {error && <span className="op-prog-error" role="alert">{error}</span>}
      </div>
      <div className="op-prog-row-end">
        {ready ? (
          <Button variant="primary" busy={busy} onClick={() => void claim()} data-ui={`mission.${mission.id}.claim`}>Récupérer {berry(mission.berry)}</Button>
        ) : mission.claimed ? (
          <span className="op-prog-done"><Icon name="check" /> {berry(mission.berry)}</span>
        ) : (
          <span className="op-prog-reward">{berry(mission.berry)}</span>
        )}
      </div>
    </li>
  );
}

// La prime, le palier et la barre vers le suivant
export function BountyLine({ progress }: { progress: Progress }) {
  const { amount, rank, next } = progress.bounty;
  return (
    <div className="op-prog-bounty">
      <span className="op-prog-bounty-amount">{bountyText(amount)}</span>
      <span className="op-prog-bounty-rank">{rank.name}</span>
      {next ? (
        <span className="op-prog-bounty-next">
          <Bar have={amount - rank.min} need={next.min - rank.min} label={`Vers ${next.name}`} />
          <span>Prochain palier : {next.name} ({bountyText(next.min)})</span>
        </span>
      ) : <span className="op-prog-bounty-next">Le plus haut palier : la légende est écrite.</span>}
    </div>
  );
}

// Le titre affiché : un exploit obtenu ou un palier
export function titleOf(progress: Progress): string {
  const t = progress.profile.title;
  if (t?.startsWith('rang:')) return progress.bounty.rank.id === t.slice(5) ? progress.bounty.rank.name : t.slice(5);
  return (t && progress.exploits.find((e) => e.id === t)?.name) || progress.bounty.rank.name;
}

// L'avis de recherche : nom, prime, titre, portrait du Leader favori, 3 exploits les plus forts
export function WantedPoster({ progress, compact = false }: { progress: Progress; compact?: boolean }) {
  const leader = progress.profile.leader ? cardData()[progress.profile.leader] : undefined;
  const best = [...progress.exploits].filter((e) => e.done)
    .sort((a, b) => ['or', 'argent', 'bronze'].indexOf(a.rank) - ['or', 'argent', 'bronze'].indexOf(b.rank)).slice(0, 3);
  return (
    <figure className={`op-wanted${compact ? ' is-compact' : ''}`} data-ui="profile.poster" aria-label={`Avis de recherche : ${progress.name}, ${bountyText(progress.bounty.amount)}`}>
      <p className="op-wanted-head">Recherché</p>
      <div className="op-wanted-portrait">
        {leader ? <img src={cardImage(leader)} alt="" draggable={false} /> : <Icon name="user" size="3.5rem" />}
      </div>
      <p className="op-wanted-name">{progress.name}</p>
      <p className="op-wanted-title">{titleOf(progress)}</p>
      <p className="op-wanted-amount">{bountyText(progress.bounty.amount)}</p>
      {!compact && best.length > 0 && (
        <p className="op-wanted-badges">{best.map((e) => <ExploitBadge key={e.id} exploit={e} />)}</p>
      )}
      <p className="op-wanted-foot">Mort ou vif · Joy Boy</p>
    </figure>
  );
}
