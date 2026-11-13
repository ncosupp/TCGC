// Adresses de l'appli (partie après #). Les onglets du dock : home, collection, scan, trades, play ; les pages hors
// onglets : search (loupe), value (depuis l'accueil), settings (avatar). Les anciennes adresses (liens des
// notifications, favoris) sont redirigées.

export type TabId = 'home' | 'collection' | 'scan' | 'trades' | 'play';
export type PageId = TabId | 'search' | 'value' | 'settings' | 'admin';

export interface Route { page: PageId; parts: string[] }

const PAGES: PageId[] = ['home', 'collection', 'scan', 'trades', 'play', 'search', 'value', 'settings', 'admin'];

// Ancienne adresse → nouvelle (préfixe)
const REDIRECTS: [RegExp, string][] = [
  [/^stats$/, 'value'],
  [/^catalog$/, 'search'],
  [/^profile$/, 'settings'],
  [/^collection\/wishlist$/, 'trades'],
  [/^collection\/doubles$/, 'trades/doubles'],
];

export function currentHash() {
  const raw = window.location.hash.slice(1);
  for (const [re, to] of REDIRECTS) if (re.test(raw)) return to;
  return raw;
}

export function readRoute(): Route {
  const [page, ...parts] = currentHash().split('/');
  return PAGES.includes(page as PageId) ? { page: page as PageId, parts } : { page: 'home', parts: [] };
}

export function go(hash: string) {
  window.location.hash = hash;
}

// Onglet allumé dans le dock pour une page (aucun pour les réglages et la recherche)
export function dockTab(page: PageId): TabId | null {
  if (page === 'value') return 'home';
  if (page === 'search' || page === 'settings' || page === 'admin') return null;
  return page;
}
