// Icônes des maquettes (Refonte-UI/refonte-ui-maquettes/ecrans) : traits de 1,4 px sur une grille de 24, en couleur
// du texte. Un nom par tracé ; ajouter ici une icône venue d'une maquette plutôt que d'en dessiner une ailleurs.
import type { ReactNode } from 'react';

const PATHS = {
  home: <path d="M4 10.5 12 4l8 6.5V20H4z" />,
  collection: <><rect x="7" y="3" width="12" height="16" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h9" /></>,
  scan: <path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" />,
  trades: <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  // deux sabres croisés, avec leurs gardes (une croix seule se lisait « fermer »)
  play: <path d="M4 4l11 11M12.5 17.5l5-5M15 15l5 5M20 4 9 15M6.5 12.5l5 5M9 15l-5 5" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></>,
  back: <path d="m15 6-6 6 6 6" />,
  next: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  more: <><circle cx="5" cy="12" r=".6" /><circle cx="12" cy="12" r=".6" /><circle cx="19" cy="12" r=".6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  star: <path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z" />,
  arrowUpRight: <path d="M8 16 16 8M9 8h7v7" />,
  pulse: <path d="M4 12h4l3-7 4 14 3-7h2" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
  skull: <><path d="M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4 2.5 5v2.5h9V15c1.3-1 2.5-2.6 2.5-5a7 7 0 0 0-7-7z" /><circle cx="9.3" cy="10.5" r="1.3" /><circle cx="14.7" cy="10.5" r="1.3" /><path d="M10.5 17.5V20M13.5 17.5V20" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></>,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  // Espace Jeu (Refonte-UI-jeu, maquettes de l'étape 2)
  swap: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  decks: <><rect x="4" y="6" width="11" height="14" rx="2" /><path d="M8 3h10a2 2 0 0 1 2 2v12" /></>,
  hold: <path d="M3 10h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 10V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2M10 10v3h4v-3" />,
  gift: <><rect x="4" y="9" width="16" height="11" rx="1" /><path d="M12 9v11M3 9h18M12 9c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" /></>,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6" />,
  friend: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6" /></>,
  pirate: <><path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.3 4.2 3 5.2V18h8v-2.8c1.7-1 3-2.7 3-5.2a7 7 0 0 0-7-7z" /><circle cx="9.5" cy="10.5" r="1.3" /><circle cx="14.5" cy="10.5" r="1.3" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.6" /><path d="M4 4v4.6h4.6M12 8v4l3 2" /></>,
  shop: <path d="M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
} satisfies Record<string, ReactNode>;

export type CaleIconName = keyof typeof PATHS;

// small : 18 px (.ic-s) ; className s'ajoute à .ic (ex. « chev » dans une ligne)
export function Icon({ name, small, className }: { name: CaleIconName; small?: boolean; className?: string }) {
  const cls = ['ic', small && 'ic-s', className].filter(Boolean).join(' ');
  return <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}
