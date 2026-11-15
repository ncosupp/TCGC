// Feuilles de base d'abord : les feuilles des écrans (importées par App et ses écrans) passent après et l'emportent
import './cale/fonts.css';
import './cale/style.css';
import './cale/kit/kit.css';
import './legacy.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { reloadOnce } from './reload';
import { announceUpdate } from './update';

// Un morceau de l'appli ne se charge plus (effacé par une mise en ligne) : on recharge la page une fois pour prendre la
// nouvelle version. Si la garde l'empêche, l'erreur remonte à la limite d'erreur de l'écran (message et « Recharger »).
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnce()) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
  // Une page déjà servie par un service worker qui en voit arriver un autre : un nouveau build vient d'être mis en
  // ligne (sans service worker avant, c'est la première installation : rien à annoncer)
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) announceUpdate(); });
  navigator.serviceWorker.register('sw.js').then((registration) => {
    // Onglet resté ouvert longtemps (appli installée) : on cherche une nouvelle version quand on y revient
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < 30 * 60_000) return;
      checked = Date.now();
      registration.update().catch(() => {});
    });
  }).catch(() => {});
  // Appui sur une notification alors que l'appli est déjà ouverte : on va sur la page indiquée
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'tcgc:navigate') window.location.hash = event.data.hash;
  });
}
