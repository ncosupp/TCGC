// Feuilles de base d'abord : les feuilles des écrans (importées par App et ses écrans) passent après et l'emportent
import './cale/fonts.css';
import './cale/style.css';
import './cale/kit/kit.css';
import './legacy.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { reloadOnce } from './reload';

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
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Appui sur une notification alors que l'appli est déjà ouverte : on va sur la page indiquée
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'tcgc:navigate') window.location.hash = event.data.hash;
  });
}
