import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './cale/fonts.css';
import './cale/style.css';
import './cale/kit/kit.css';
import './legacy.css';

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
