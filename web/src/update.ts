// Nouvelle version de l'appli : un nouveau service worker (nouveau build mis en ligne) a pris la main sur la page. La
// page continue avec l'ancienne version ; un message propose de recharger (ToastLayer, cale/kit).
import { useSyncExternalStore } from 'react';

const EVENT = 'tcgc:update-ready';
let ready = false;

export function announceUpdate() {
  if (ready) return;
  ready = true;
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (listener: () => void) => {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};

export function useUpdateReady() {
  return useSyncExternalStore(subscribe, () => ready, () => false);
}
