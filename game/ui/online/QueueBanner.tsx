// Bandeau de la file « Trouver un adversaire » (étape J), en haut de tous les écrans du jeu pendant la recherche
// (partie contre l'IA en attendant, accueil...) : l'étape de la recherche (joueur joy-boy, puis salle OPTCGSim, O4.4),
// le temps d'attente et « Arrêter » ; quand un adversaire arrive, « Adversaire trouvé : Rejoindre ». Rien ne quitte
// l'écran sans un appui.
import { useEffect, useState } from 'react';
import { Button, Icon, IconButton } from '../kit/index.ts';
import { navigate, useRoute } from '../routes.ts';
import { clearFound, queueStep, stopQueue, useQueue, useQueuePresence, waited } from './queue.ts';

export function QueueBanner() {
  const q = useQueue();
  const route = useRoute();
  const [now, setNow] = useState(Date.now);
  // le joueur voit le bandeau, sauf pendant une partie (contre l'IA en attendant, chapitre d'aventure) : pas de repli
  // OPTCGSim à ce moment-là (l'hôte lancerait la partie sans lui) ; la file joy-boy continue
  const playing = route.name === 'jeu' || (route.name === 'aventure' && route.screen?.kind === 'chapter');
  useQueuePresence(Boolean(q && !q.found && !playing));
  useEffect(() => {
    if (!q || q.found) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [q]);
  if (!q) return null;
  if (q.found) {
    const found = q.found;
    const cross = found.kind === 'optcgsim';
    return (
      <div className="op-queue-banner is-found" role="alert" data-ui="queue.banner-found">
        <Icon name="swords" />
        <span><strong>{cross ? 'Adversaire OPTCGSim trouvé !' : 'Adversaire trouvé !'}</strong> {cross ? 'Ta partie a commencé.' : 'Ta partie en ligne t’attend.'}</span>
        <Button variant="primary" onClick={() => { clearFound(); navigate(cross ? { name: 'optcgsim', id: found.id } : { name: 'partie', id: found.id }); }} data-ui="queue.join">Rejoindre</Button>
      </div>
    );
  }
  const step = queueStep(q, now);
  return (
    <div className="op-queue-banner" role="status" data-ui="queue.banner">
      <span className="op-kit-spinner" aria-hidden="true" />
      <span>{step.title} {step.countdown !== null ? `${step.countdown} s` : waited(q.since, now)}{q.error ? ' · connexion difficile, nouvel essai' : ''}</span>
      <Button variant="quiet" onClick={() => navigate({ name: 'chercher' })} data-ui="queue.open">Voir</Button>
      <IconButton icon="close" variant="quiet" label="Arrêter la recherche" onClick={() => void stopQueue()} data-ui="queue.stop" />
    </div>
  );
}
