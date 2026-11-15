// Bandeau de la file « Trouver un adversaire » (étape J), en haut de tous les écrans du jeu pendant la recherche
// (partie contre l'IA en attendant, accueil...) : le temps d'attente et « Arrêter » ; quand un adversaire arrive,
// « Adversaire trouvé : Rejoindre ». Rien ne quitte l'écran sans un appui.
import { useEffect, useState } from 'react';
import { Button, Icon, IconButton } from '../kit/index.ts';
import { navigate } from '../routes.ts';
import { clearFound, stopQueue, useQueue, waited } from './queue.ts';

export function QueueBanner() {
  const q = useQueue();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!q || q.found) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [q]);
  if (!q) return null;
  if (q.found) {
    const id = q.found;
    return (
      <div className="op-queue-banner is-found" role="alert" data-ui="queue.banner-found">
        <Icon name="swords" />
        <span><strong>Adversaire trouvé !</strong> Ta partie en ligne t’attend.</span>
        <Button variant="primary" onClick={() => { clearFound(); navigate({ name: 'partie', id }); }} data-ui="queue.join">Rejoindre</Button>
      </div>
    );
  }
  return (
    <div className="op-queue-banner" role="status" data-ui="queue.banner">
      <span className="op-kit-spinner" aria-hidden="true" />
      <span>Recherche d’un adversaire… {waited(q.since, now)}{q.error ? ' · connexion difficile, nouvel essai' : ''}</span>
      <Button variant="quiet" onClick={() => navigate({ name: 'chercher' })} data-ui="queue.open">Voir</Button>
      <IconButton icon="close" variant="quiet" label="Arrêter la recherche" onClick={() => void stopQueue()} data-ui="queue.stop" />
    </div>
  );
}
