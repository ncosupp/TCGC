// Jeu d'icônes du jeu, dessiné pour TCGC (rien de Bandai) : traits sur une grille de 24 × 24, épaisseur 2, bouts
// arrondis, couleur du texte. Chaque icône est une liste de tracés SVG (attribut `d`). Pour en ajouter une : un nom,
// ses tracés et son libellé (affiché dans l'atelier « kit » et lu par les lecteurs d'écran quand l'icône est seule).

// Un cercle de centre (x, y) et de rayon r, en tracé (deux demi-arcs)
const circle = (x: number, y: number, r: number) => `M${x + r} ${y}a${r} ${r} 0 1 1-${2 * r} 0 ${r} ${r} 0 0 1 ${2 * r} 0`;
// Un rectangle aux coins arrondis (r) de coin haut gauche (x, y), de largeur w et de hauteur h
const rect = (x: number, y: number, w: number, h: number, r = 2) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1-${r}-${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r}-${r}z`;
// Le panneau « interdit » (cercle barré) qui entoure les icônes « ne peut pas »
const forbidden = [circle(12, 12, 9.5), 'M5.3 5.3l13.4 13.4'];

export const ICONS = {
  // ---------- Interface ----------
  back: ['M19 12H5', 'M12 19l-7-7 7-7'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  settings: [circle(12, 12, 3), circle(12, 12, 6.5), 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.9 4.9L7 7', 'M17 17l2.1 2.1', 'M4.9 19.1L7 17', 'M17 7l2.1-2.1'],
  help: [circle(12, 12, 9.5), 'M9.3 9.3a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9v.4', 'M12 17.3v.1'],
  log: [rect(5, 3, 14, 18), 'M9 8h6', 'M9 12h6', 'M9 16h3.5'],
  deck: ['M9 3h9a2 2 0 0 1 2 2v12', rect(4, 6.5, 13, 15)],
  hold: ['M4 11V9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2', 'M3 11h18v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z', 'M10.5 11v3.5h3V11', 'M3 15h7.5', 'M13.5 15H21'],
  shop: ['M3.5 9.5L5.5 4h13l2 5.5', 'M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0', 'M5 12.5V20h14v-7.5', 'M10 20v-4.5h4V20'],
  purse: ['M9 3.5h6L13.5 7h-3z', 'M8.5 7h7', 'M10 7c-3.6 1.8-6 5.3-6 8.7A4.8 4.8 0 0 0 8.8 20.5h6.4a4.8 4.8 0 0 0 4.8-4.8c0-3.4-2.4-6.9-6-8.7', 'M12 11.5v6', 'M10.3 13.2h2.9a1.3 1.3 0 0 1 0 2.6h-2.9'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3.5 3.5V8H8', 'M12 7.5V12l3 2'],
  pause: ['M9 5v14', 'M15 5v14'],
  // la prime (un niveau, jamais ฿) : tête de mort, comme dans la collection (web/src/cale/kit/Icon.tsx)
  skull: ['M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4 2.5 5v2.5h9V15c1.3-1 2.5-2.6 2.5-5a7 7 0 0 0-7-7z', circle(9.3, 10.5, 1.3), circle(14.7, 10.5, 1.3), 'M10.5 17.5V20', 'M13.5 17.5V20'],
  dice: [rect(4, 4, 16, 16, 3), 'M8.5 8.5h.01', 'M15.5 8.5h.01', 'M12 12h.01', 'M8.5 15.5h.01', 'M15.5 15.5h.01'],
  'sound-on': ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4.2 4.2 0 0 1 0 6', 'M18.3 6.3a8.2 8.2 0 0 1 0 11.4'],
  'sound-off': ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9.5l5 5', 'M20.5 9.5l-5 5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  more: [circle(5, 12, 1), circle(12, 12, 1), circle(19, 12, 1)],
  drag: [circle(9, 6, 1), circle(15, 6, 1), circle(9, 12, 1), circle(15, 12, 1), circle(9, 18, 1), circle(15, 18, 1)],
  retry: ['M20 12a8 8 0 1 1-2.4-5.7', 'M20.5 3.5V9H15'],
  alert: ['M10.3 4.2a2 2 0 0 1 3.4 0l7.6 13.3a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3z', 'M12 9.5v4', 'M12 17v.1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],

  // ---------- Modes et progression (étape J) ----------
  // deux sabres croisés, avec leurs gardes
  swords: ['M4 4l11 11', 'M12.5 17.5l5-5', 'M15 15l5 5', 'M20 4L9 15', 'M6.5 12.5l5 5', 'M9 15l-5 5'],
  globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  compass: [circle(12, 12, 9), 'M15.5 8.5l-2 5-5 2 2-5z'],
  map: ['M3.5 6.5L9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z', 'M9 4v13.5', 'M15 6.5V20'],
  ship: ['M3 15.5h18l-2.5 4.5h-13z', 'M12 3v12.5', 'M12 4.5l6.5 8.5H12', 'M12 6.5L6.5 13H12'],
  anchor: [circle(12, 5.5, 2), 'M12 7.5v13', 'M8 11h8', 'M4.5 13.5a7.5 7.5 0 0 0 15 0', 'M4.5 13.5L3 15', 'M19.5 13.5L21 15'],
  trophy: ['M7.5 4h9v5a4.5 4.5 0 0 1-9 0z', 'M7.5 6h-3v1.5a3 3 0 0 0 3 3', 'M16.5 6h3v1.5a3 3 0 0 1-3 3', 'M12 13.5V17', 'M8.5 20.5h7', 'M9.5 20.5L10 17h4l.5 3.5'],
  scroll: ['M7 3.5h11a2 2 0 0 1 2 2v1H9', 'M7 3.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12', 'M7 3.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2', 'M12 10.5h4', 'M12 14h4'],
  search: [circle(10.5, 10.5, 6.5), 'M20 20l-4.8-4.8'],
  clock: [circle(12, 12, 9), 'M12 7v5l3.5 2'],
  rematch: ['M4 10a8 8 0 0 1 14.3-4.3', 'M18.5 2.5V6H15', 'M20 14a8 8 0 0 1-14.3 4.3', 'M5.5 21.5V18H9'],
  chat: ['M4 5.5h16v10H10l-4.5 4v-4H4z', 'M8 10.5h.1', 'M12 10.5h.1', 'M16 10.5h.1'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z'],
  chest: ['M4 10a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1H4z', 'M4 11h16v8.5H4z', 'M10.5 11v3.5h3V11', 'M9 5v6', 'M15 5v6'],
  gift: [rect(3.5, 8, 17, 4, 1), 'M5 12v8.5h14V12', 'M12 8v12.5', 'M12 8C10.5 4 7 4 7 6s3 2 5 2 5 0 5-2-3.5-2-5 2'],
  user: [circle(12, 8, 4), 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
  users: [circle(9, 8, 3.5), 'M3 20a6 6 0 0 1 12 0', 'M15.5 4.8a3.5 3.5 0 0 1 0 6.4', 'M17.5 14.3a6 6 0 0 1 3.5 5.7'],
  // l'avis de recherche : une affiche et son portrait
  bounty: [rect(4.5, 3, 15, 18, 1.5), circle(12, 10, 3), 'M8 17h8', 'M9.5 6h5'],
  play: ['M8 5.5v13l10.5-6.5z'],
  lock: [rect(5, 10.5, 14, 10), 'M8 10.5v-3a4 4 0 0 1 8 0v3'],

  // ---------- États d'une carte ----------
  // épuisée : une carte couchée, avec la flèche du quart de tour
  rested: [rect(3, 11, 14, 9.5), 'M13.5 3.5a7 7 0 0 1 7 7', 'M20.5 6.5v4h-4'],
  blocker: ['M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z'],
  frozen: ['M12 2.5v19', 'M3.8 7.2l16.4 9.6', 'M3.8 16.8l16.4-9.6', 'M9.5 4l2.5 2 2.5-2', 'M9.5 20l2.5-2 2.5 2'],
  'no-attack': [...forbidden, 'M12 6.5v8', 'M9 14.5h6', 'M12 14.5v3.5'],
  'no-block': [...forbidden, 'M12 7.5l4 1.5v3c0 2.3-1.7 4-4 4.5-2.3-.5-4-2.2-4-4.5V9z'],
  // KO impossible : un bouclier marqué d'une croix de soin
  'no-ko': ['M12 3l8 3v6c0 4.6-3.4 8-8 9-4.6-1-8-4.4-8-9V6z', 'M12 8.5v7', 'M8.5 12h7'],
  // retirée de la partie : une spirale qui disparaît
  exile: ['M12 12a1 1 0 0 1 1 1 2 2 0 0 1-2 2 3 3 0 0 1-3-3 4 4 0 0 1 4-4 5 5 0 0 1 5 5 6 6 0 0 1-6 6 7 7 0 0 1-7-7'],
  // renvoyée (en main ou dans le deck) : une flèche qui fait demi-tour vers une carte
  returned: [rect(12, 3.5, 9, 13), 'M3.5 10L6.5 7l3 3', 'M6.5 7v7.5a5 5 0 0 0 5 5h4'],
  attack: ['M20.5 3.5v3L11 16l-3-3 9.5-9.5z', 'M5.5 11.5l7 7', 'M8 16l-4 4', 'M3 19l2 2'],
  // protégée (des effets) : un dôme au-dessus de la carte
  protection: ['M3.5 18a8.5 8.5 0 0 1 17 0', 'M2 21h20', 'M12 6V3', 'M6.3 8.3L4.5 6.5', 'M17.7 8.3l1.8-1.8'],
  'power-up': ['M12 19.5v-15', 'M6 10.5l6-6 6 6'],
  'power-down': ['M12 4.5v15', 'M6 13.5l6 6 6-6'],
  // vient d'être jouée : « Zz », la carte dort encore
  asleep: ['M4 5.5h7.5L4 15h7.5', 'M14 11h6l-6 7.5h6'],
  // ne peut pas être épuisée : une carte couchée, barrée
  'no-rest': [...forbidden, rect(6.5, 9, 11, 6.5, 1.5)],
  // effets annulés : l'étincelle d'un effet, barrée
  negated: [...forbidden, 'M12 6.5l1.4 4.1 4.1 1.4-4.1 1.4-1.4 4.1-1.4-4.1-4.1-1.4 4.1-1.4z'],
  // [Double attaque] : deux épées croisées (celle d'« attack » et son reflet)
  'double-attack': ['M20.5 3.5v3L11 16l-3-3 9.5-9.5z', 'M5.5 11.5l7 7', 'M8 16l-4 4', 'M3 19l2 2', 'M3.5 3.5v3L13 16l3-3-9.5-9.5z', 'M18.5 11.5l-7 7', 'M16 16l4 4', 'M21 19l-2 2'],
  // [Imblocable] : un fantôme, qui passe à travers les Bloqueurs
  unblockable: ['M5 20.5V11a7 7 0 0 1 14 0v9.5l-2.3-1.8-2.4 1.8-2.3-1.8-2.3 1.8-2.4-1.8z', circle(9.5, 11, 0.8), circle(14.5, 11, 0.8)],
  // panneau du plateau : le replier vers la droite, le déplier vers la gauche
  'panel-hide': ['M6 6l6 6-6 6', 'M13 6l6 6-6 6'],
  'panel-show': ['M18 6l-6 6 6 6', 'M11 6l-6 6 6 6'],
} satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** Ce que représente chaque icône, en français */
export const ICON_LABELS: Record<IconName, string> = {
  back: 'Retour',
  close: 'Fermer',
  settings: 'Réglages',
  help: 'Aide',
  log: 'Journal',
  deck: 'Deck',
  hold: 'Cale',
  shop: 'Boutique',
  purse: 'Bourse',
  history: 'Mes parties',
  pause: 'Pause',
  skull: 'Prime',
  dice: 'Au hasard',
  'sound-on': 'Son activé',
  'sound-off': 'Son coupé',
  undo: 'Annuler',
  more: 'Plus d’actions',
  drag: 'Glisser',
  retry: 'Réessayer',
  alert: 'Attention',
  check: 'Validé',
  swords: 'Combat',
  globe: 'En ligne',
  compass: 'Apprendre',
  map: 'Carte',
  ship: 'Aventure',
  anchor: 'Ancre',
  trophy: 'Exploits',
  scroll: 'Missions',
  search: 'Chercher',
  clock: 'Temps',
  rematch: 'Revanche',
  chat: 'Réactions',
  star: 'Étoile',
  chest: 'Coffre',
  gift: 'Cadeau',
  user: 'Profil',
  users: 'Joueurs',
  bounty: 'Avis de recherche',
  play: 'Jouer',
  lock: 'Verrouillé',
  rested: 'Épuisée',
  blocker: 'Bloqueur',
  frozen: 'Gelée',
  'no-attack': 'Ne peut pas attaquer',
  'no-block': 'Ne peut pas bloquer',
  'no-ko': 'Ne peut pas être mise KO',
  exile: 'Retirée de la partie',
  returned: 'Renvoyée',
  attack: 'Attaque',
  protection: 'Protégée',
  'power-up': 'Puissance augmentée',
  'power-down': 'Puissance diminuée',
  asleep: 'Vient d’être jouée',
  'no-rest': 'Ne peut pas être épuisée',
  negated: 'Effets annulés',
  'double-attack': 'Double attaque',
  unblockable: 'Imblocable',
  'panel-hide': 'Replier le panneau',
  'panel-show': 'Déplier le panneau',
};

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
