// Icônes des maquettes (Refonte-UI/refonte-ui-maquettes/ecrans) : traits de 1,4 px sur une grille de 24, en couleur
// du texte. Un nom par tracé ; ajouter ici une icône venue d'une maquette plutôt que d'en dessiner une ailleurs.
import type { ReactNode } from 'react';

const PATHS = {
  home: <path d="M4 10.5 12 4l8 6.5V20H4z" />,
  collection: <><rect x="7" y="3" width="12" height="16" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h9" /></>,
  scan: <path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" />,
  trades: <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  play: <path d="M5 5l14 14M19 5 5 19" />,
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
} satisfies Record<string, ReactNode>;

export type CaleIconName = keyof typeof PATHS;

// small : 18 px (.ic-s) ; className s'ajoute à .ic (ex. « chev » dans une ligne)
export function Icon({ name, small, className }: { name: CaleIconName; small?: boolean; className?: string }) {
  const cls = ['ic', small && 'ic-s', className].filter(Boolean).join(' ');
  return <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}
