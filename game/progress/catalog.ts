// Progression du joueur (étape J, fiche Plan-aventure/etudes/joy-boy-1-0/01-game-design-progression.md) : prime,
// paliers, exploits et missions. Ce module ne contient que les définitions (noms, textes, montants) partagées par le
// serveur (server/game-progress.js, qui calcule tout à partir des données vérifiées) et les écrans. Aucun chiffre de
// récompense ailleurs.
import type { Color } from '../engine/types.ts';

// ---------- Prime ----------

export const BOUNTY = {
  game: 100_000,                                   // chaque partie vérifiée
  win: { 1: 500_000, 2: 1_000_000, 3: 2_000_000 } as Record<number, number>,   // victoire contre l'IA, par niveau
  online: 3_000_000,                               // victoire en ligne
  chapter: 5_000_000,                              // chapitre d'aventure gagné (une fois)
  exploit: { bronze: 1_000_000, argent: 3_000_000, or: 10_000_000 } as Record<ExploitRank, number>,
};

export interface BountyRank { id: string; name: string; min: number; line: string }

export const BOUNTY_RANKS: BountyRank[] = [
  { id: 'mousse', name: 'Mousse', min: 0, line: 'Tout le monde commence en lavant le pont.' },
  { id: 'matelot', name: 'Matelot', min: 3_000_000, line: 'Ton nom commence à circuler sur les quais.' },
  { id: 'pirate', name: 'Pirate', min: 10_000_000, line: 'La Marine a ouvert un dossier à ton nom.' },
  { id: 'redoute', name: 'Pirate redouté', min: 30_000_000, line: 'Les tavernes se taisent quand tu entres.' },
  { id: 'capitaine', name: 'Capitaine', min: 80_000_000, line: 'Ton pavillon fait changer de cap les navires.' },
  { id: 'terreur', name: 'Terreur des mers', min: 200_000_000, line: 'Les journaux parlent de toi chaque semaine.' },
  { id: 'legende', name: 'Légende vivante', min: 500_000_000, line: 'Les enfants jouent à être toi.' },
];

export function rankOf(amount: number): { rank: BountyRank; next: BountyRank | null } {
  let i = 0;
  while (i + 1 < BOUNTY_RANKS.length && amount >= BOUNTY_RANKS[i + 1].min) i++;
  return { rank: BOUNTY_RANKS[i], next: BOUNTY_RANKS[i + 1] ?? null };
}

// « 12 500 000 » : la prime est un niveau, pas une monnaie, jamais le signe ฿ des Berry (refonte du jeu) ; l'écran
// pose sa tête de mort
export const bountyText = (n: number) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');

// ---------- Exploits ----------

export type ExploitFamily = 'aventure' | 'combat' | 'en-ligne' | 'collection' | 'maitrise';
export type ExploitRank = 'bronze' | 'argent' | 'or';

export const FAMILIES: { id: ExploitFamily; name: string }[] = [
  { id: 'aventure', name: 'Aventure' },
  { id: 'combat', name: 'Combat' },
  { id: 'en-ligne', name: 'En ligne' },
  { id: 'collection', name: 'Collection' },
  { id: 'maitrise', name: 'Maîtrise' },
];

export const RANK_BERRY: Record<ExploitRank, number> = { bronze: 50, argent: 150, or: 400 };
export const RANK_NAMES: Record<ExploitRank, string> = { bronze: 'Bronze', argent: 'Argent', or: 'Or' };

// La mesure (calculée par le serveur) et le seuil à atteindre
export type ExploitMeasure =
  | 'learnWon' | 'chapters' | 'arc:east-blue' | 'arc:alabasta' | 'challenges' | 'challenges:east-blue'
  | 'wins' | 'expertWins' | 'colorsWon' | 'onlineGames' | 'onlineWins'
  | 'boostersOpened' | 'distinctCards' | 'srFound' | 'secFound' | 'album:OP03' | 'games' | 'days';

export interface ExploitDef {
  id: string;
  family: ExploitFamily;
  rank: ExploitRank;
  name: string;
  text: string;
  measure: ExploitMeasure;
  need: number;
  boosters?: { set: string; count: number };   // en plus des Berry (la partie guidée)
}

const x = (id: string, family: ExploitFamily, rank: ExploitRank, name: string, text: string, measure: ExploitMeasure, need = 1, boosters?: ExploitDef['boosters']): ExploitDef =>
  ({ id, family, rank, name, text, measure, need, ...(boosters ? { boosters } : {}) });

export const EXPLOITS: ExploitDef[] = [
  x('premiers-pas', 'maitrise', 'bronze', 'Premiers pas', 'Gagner la partie guidée', 'learnWon', 1, { set: 'OP03', count: 1 }),
  x('chapitre-1', 'aventure', 'bronze', 'Larguez les amarres', 'Gagner ton premier chapitre d’aventure', 'chapters'),
  x('east-blue', 'aventure', 'argent', 'Roi d’East Blue', 'Terminer l’arc East Blue', 'arc:east-blue'),
  x('defi-1', 'aventure', 'argent', 'Sans peur', 'Relever un défi de l’aventure', 'challenges'),
  x('defis-east-blue', 'aventure', 'or', 'Aucun adversaire de trop', 'Relever tous les défis d’East Blue', 'challenges:east-blue'),
  x('alabasta', 'aventure', 'or', 'Le royaume des sables', 'Terminer l’arc Alabasta', 'arc:alabasta'),
  x('victoire-1', 'combat', 'bronze', 'Premier sang', 'Gagner une partie', 'wins'),
  x('victoires-10', 'combat', 'argent', 'Bagarreur', 'Gagner 10 parties', 'wins', 10),
  x('victoires-50', 'combat', 'or', 'Vétéran des abordages', 'Gagner 50 parties', 'wins', 50),
  x('expert-1', 'combat', 'argent', 'Tombeur d’Expert', 'Battre l’IA Expert', 'expertWins'),
  x('expert-10', 'combat', 'or', 'Fléau des stratèges', 'Battre 10 fois l’IA Expert', 'expertWins', 10),
  x('arc-en-ciel', 'combat', 'or', 'Les six mers', 'Gagner avec un Leader de chacune des 6 couleurs', 'colorsWon', 6),
  x('en-ligne-1', 'en-ligne', 'bronze', 'Premier abordage', 'Jouer une partie en ligne', 'onlineGames'),
  x('en-ligne-victoire', 'en-ligne', 'argent', 'Premier trophée', 'Gagner une partie en ligne', 'onlineWins'),
  x('en-ligne-10', 'en-ligne', 'or', 'Redouté sur les mers', 'Gagner 10 parties en ligne', 'onlineWins', 10),
  x('booster-1', 'collection', 'bronze', 'Le goût du trésor', 'Ouvrir ton premier booster', 'boostersOpened'),
  x('cale-50', 'collection', 'bronze', 'Cale bien remplie', 'Avoir 50 cartes différentes dans ta Cale', 'distinctCards', 50),
  x('cale-150', 'collection', 'argent', 'Trésor de guerre', 'Avoir 150 cartes différentes dans ta Cale', 'distinctCards', 150),
  x('sr-1', 'collection', 'argent', 'Pièce rare', 'Trouver une SR', 'srFound'),
  x('sec-1', 'collection', 'or', 'Trésor légendaire', 'Trouver une SEC ou une version spéciale', 'secFound'),
  x('album-op03', 'collection', 'or', 'Archiviste de Grand Line', 'Avoir toutes les cartes d’OP03 dans ta Cale', 'album:OP03'),
  x('parties-25', 'maitrise', 'bronze', 'Habitué des tavernes', 'Jouer 25 parties', 'games', 25),
  x('parties-100', 'maitrise', 'argent', 'Vieux loup de mer', 'Jouer 100 parties', 'games', 100),
  x('jours-7', 'maitrise', 'argent', 'Fidèle au poste', 'Jouer 7 jours différents', 'days', 7),
];

export const exploitById = (id: string) => EXPLOITS.find((e) => e.id === id);

// ---------- Missions ----------

export type MissionMeasure = 'games' | 'wins' | 'strongWins' | 'colorWins' | 'chapterGames' | 'boostersOpened' | 'onlineGames';

export interface MissionDef { id: string; title: string; measure: MissionMeasure; need: number; berry: number; online?: true }

export const MISSIONS: MissionDef[] = [
  { id: 'jouer-2', title: 'Joue 2 parties', measure: 'games', need: 2, berry: 20 },
  { id: 'gagner-1', title: 'Gagne une partie', measure: 'wins', need: 1, berry: 25 },
  { id: 'gagner-2', title: 'Gagne 2 parties', measure: 'wins', need: 2, berry: 35 },
  { id: 'confirme', title: 'Bats l’IA Confirmé ou plus forte', measure: 'strongWins', need: 1, berry: 35 },
  { id: 'couleur', title: 'Gagne avec un Leader {couleur}', measure: 'colorWins', need: 1, berry: 30 },
  { id: 'chapitre', title: 'Joue un chapitre de l’aventure', measure: 'chapterGames', need: 1, berry: 25 },
  { id: 'booster', title: 'Ouvre un booster', measure: 'boostersOpened', need: 1, berry: 20 },
  { id: 'en-ligne', title: 'Joue une partie en ligne', measure: 'onlineGames', need: 1, berry: 30, online: true },
];

export const WEEKLY_MISSION = { id: 'semaine', title: 'Grand abordage : gagne 8 parties cette semaine', need: 8, berry: 150 };

export const MISSIONS_PER_DAY = 3;

export const COLORS: Color[] = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
export const COLOR_NAMES: Record<Color, string> = { Red: 'rouge', Green: 'vert', Blue: 'bleu', Purple: 'violet', Black: 'noir', Yellow: 'jaune' };

// ---------- Ce que renvoie le serveur (GET /api/game/progress) ----------

export interface ExploitState {
  id: string;
  family: ExploitFamily;
  rank: ExploitRank;
  name: string;
  text: string;
  have: number;
  need: number;
  done: boolean;         // obtenu
  claimed: boolean;      // récompense récupérée
  berry: number;
  boosters?: { set: string; count: number };
}

export interface MissionState { id: string; title: string; have: number; need: number; berry: number; done: boolean; claimed: boolean }

export interface Progress {
  bounty: { amount: number; rank: BountyRank; next: BountyRank | null };
  exploits: ExploitState[];
  missions: { day: string; items: MissionState[]; weekly: MissionState; week: string };
  toClaim: number;       // exploits et missions à récupérer
  profile: { title: string | null; leader: string | null };
  name: string;
}

export interface ClaimResult { progress: Progress; berry: number; boosters: { id: string; set: string; source: string; createdAt: string }[]; already: boolean }
