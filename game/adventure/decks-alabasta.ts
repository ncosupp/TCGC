// Decks des adversaires de l'arc Alabasta (tâche 5.5) : identifiants AV-AL-<NOM>, series 'AVENTURE' (absents de la
// partie rapide). Branchés à la fin de DECKS (game/engine/decks.ts), après STARTERS_B. Toutes les cartes sont déjà
// jouables (rien à coder). Choix des cartes et des Leaders : game/docs/aventure-alabasta.md ; l'équilibrage fin est
// la tâche 5.8 (scripts/game/adventure-balance.ts).
import type { DeckList } from '../engine/decks.ts';

const deck = (id: string, name: string, leader: string, cards: Record<string, number>): DeckList =>
  ({ id, name, series: 'AVENTURE', leader, cards });

const DECK_LIST: DeckList[] = [
  // Chapitre 1, Reverse Mountain : Mr. 9 et Miss Wednesday, chasseurs de baleine, et les petits agents de Baroque
  // Works. Volontairement simple (petits coûts, peu de finisseurs) : c'est l'entrée dans Grand Line. Crocodile
  // OP01-062 (bleu/violet), le patron dans l'ombre, faute de Leader Mr. 9.
  deck('AV-AL-MR9', 'Mr. 9 et Miss Wednesday (Reverse Mountain)', 'OP01-062', {
    'EB01-037': 4, 'EB01-034': 4, 'EB01-035': 4, 'OP04-073': 4, 'OP01-083': 4, 'OP01-085': 2, 'OP01-079': 2,
    'OP01-080': 4, 'OP04-066': 2, 'OP04-069': 2, 'OP01-090': 4, 'OP01-088': 4, 'OP01-087': 2, 'OP04-074': 4,
    'OP04-076': 4,
  }),
  // Chapitre 2, Whisky Peak : Mr. 5 (et son Nez-Palm Cannon) et Miss Valentine, les chasseurs de primes de la ville et
  // Miss All Sunday venue en observatrice. Crocodile OP01-062 (bleu/violet), comme au chapitre 1.
  deck('AV-AL-MR5', 'Mr. 5 et Miss Valentine (Whisky Peak)', 'OP01-062', {
    'OP04-072': 4, 'OP04-066': 4, 'EB01-037': 4, 'EB01-034': 4, 'EB01-035': 4, 'OP04-073': 4, 'OP04-064': 2,
    'OP04-070': 2, 'OP04-075': 4, 'OP04-074': 4, 'OP04-076': 4, 'EB01-038': 2, 'OP01-083': 2, 'OP01-090': 4,
    'OP01-088': 2,
  }),
  // Chapitre 3, Little Garden : Mr. 3 (la cire) et Miss Goldenweek (Colors Trap), avec Mr. 5, Miss Valentine et Mr. 4
  // en renfort, et Miss All Sunday. Crocodile OP01-062 (bleu/violet), pour les deux versions de Mr. 3.
  deck('AV-AL-MR3', 'Mr. 3 et Miss Goldenweek (Little Garden)', 'OP01-062', {
    'OP04-070': 4, 'OP01-085': 4, 'OP04-065': 4, 'OP04-072': 4, 'OP04-066': 4, 'OP12-075': 4, 'OP04-064': 4,
    'OP04-071': 4, 'OP01-084': 2, 'OP04-074': 4, 'OP04-075': 4, 'OP01-088': 4, 'OP01-090': 4,
  }),
  // Chapitre 4, royaume de Drum : Wapol (deux versions), Chess et Kuromarimo (et leur fusion), les Lapins, Robson et
  // les vingt médecins du roi ; le fruit Bak Bak (Munch-Munch Mutation). Aucun Leader Wapol n'existe : Chopper
  // OP08-001 est le seul Leader {Drum Kingdom}, comme Kobby à Shells Town.
  deck('AV-AL-WAPOL', 'Royaume de Drum (Wapol)', 'OP08-001', {
    'OP08-014': 4, 'OP13-018': 4, 'OP08-005': 4, 'OP08-004': 4, 'OP08-006': 4, 'OP08-013': 4, 'OP08-012': 4,
    'OP08-010': 2, 'OP08-003': 4, 'OP08-009': 4, 'OP08-011': 2, 'OP08-020': 2, 'OP08-019': 4, 'OP08-017': 4,
  }),
  // Chapitre 5, Yuba : Vivi veut arrêter la guerre seule ; Luffy l'affronte pour qu'elle accepte l'aide de ses amis.
  // Que des cartes {Alabasta} : Koza, Chaka, Pell, Igaram, Cobra, Karoo, les canards et les Jugons.
  deck('AV-AL-VIVI', 'Royaume d’Alabasta (Vivi)', 'OP04-001', {
    'OP04-006': 4, 'EB01-004': 2, 'OP04-008': 4, 'OP04-013': 4, 'OP05-014': 2, 'OP04-002': 4, 'EB04-021': 2,
    'OP04-012': 2, 'OP04-004': 4, 'OP04-005': 4, 'OP04-009': 4, 'EB04-024': 2, 'EB04-023': 2, 'OP04-118': 2,
    'OP04-018': 4, 'EB03-011': 4,
  }),
  // Défi de Nanohana : Ace aux Poings ardents, de passage, et des Pirates de Barbe Blanche (cartes d'OP02 et d'OP03,
  // de l'époque) ; Striker, son bateau. Plus fort que les chapitres qui l'entourent.
  deck('AV-AL-ACE', 'Ace aux Poings ardents (Nanohana)', 'OP03-001', {
    'OP02-013': 4, 'OP03-013': 4, 'OP03-003': 4, 'OP03-004': 2, 'OP03-005': 2, 'OP03-009': 2, 'OP03-011': 2,
    'OP03-006': 2, 'OP03-007': 2, 'OP02-011': 2, 'OP03-010': 2, 'OP02-003': 2, 'OP02-019': 2, 'OP03-016': 2,
    'OP03-017': 4, 'OP03-018': 4, 'OP03-019': 2, 'OP03-020': 2, 'OP02-022': 4,
  }),
  // Chapitre 6, Rainbase : la Marine de Smoker et de Tashigi (plusieurs versions), qui protège ses Personnages pendant
  // le tour adverse (effet du Leader Smoker OP10-001, rouge/vert).
  deck('AV-AL-SMOKER', 'Marine de Smoker (Rainbase)', 'OP10-001', {
    'OP10-030': 2, 'OP11-005': 4, 'OP16-028': 2, 'OP15-031': 4, 'OP10-032': 4, 'EB03-018': 2, 'OP11-007': 4,
    'OP12-031': 2, 'OP14-029': 2, 'EB05-015': 2, 'OP11-008': 4, 'OP15-016': 4, 'OP11-004': 4, 'OP12-033': 4,
    'OP11-019': 2, 'OP15-010': 4,
  }),
  // Défi d'Alubarna : les agents d'élite de Baroque Works (Mr. 1 et Miss Doublefinger, Mr. 2, Mr. 4 et Miss Merry
  // Christmas, Miss All Sunday), tous ensemble. Crocodile OP04-058 (violet/jaune).
  deck('AV-AL-AGENTS', 'Agents d’élite de Baroque Works (Alubarna)', 'OP04-058', {
    'OP05-075': 4, 'OP05-073': 4, 'OP04-069': 4, 'EB01-061': 2, 'OP04-071': 4, 'OP04-067': 4, 'OP04-064': 2,
    'OP12-075': 4, 'OP12-069': 2, 'OP04-060': 2, 'OP04-072': 2, 'OP04-070': 2, 'OP04-066': 2, 'OP04-076': 4,
    'EB01-038': 4, 'OP04-075': 2, 'OP04-074': 2,
  }),
  // Chapitre 7, Alubarna (final) : Crocodile et tout Baroque Works, en noir (OP14-079) : le Leader met KO ses propres
  // agents pour faire tomber le coût des Personnages adverses, que Mr. 1, Mr. 5 et Crocodile exploitent ensuite.
  deck('AV-AL-CROCODILE', 'Baroque Works (Crocodile)', 'OP14-079', {
    'OP14-120': 4, 'OP14-084': 2, 'OP14-090': 4, 'OP14-086': 2, 'EB03-046': 2, 'OP14-091': 4, 'OP14-092': 2,
    'OP14-093': 4, 'OP14-094': 4, 'OP14-088': 2, 'OP14-087': 4, 'OP14-085': 2, 'OP14-083': 2, 'EB05-045': 2,
    'EB05-044': 2, 'OP14-099': 4, 'OP14-098': 2, 'EB05-048': 2,
  }),
];

export const ALABASTA_DECKS: Record<string, DeckList> = Object.fromEntries(DECK_LIST.map((d) => [d.id, d]));
