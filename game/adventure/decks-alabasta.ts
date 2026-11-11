// Decks des adversaires de l'arc Alabasta (tâche 5.5) : identifiants AV-AL-<NOM>, series 'AVENTURE' (absents de la
// partie rapide). Branchés à la fin de DECKS (game/engine/decks.ts), après STARTERS_B. Toutes les cartes sont déjà
// jouables (rien à coder). Choix des cartes et des Leaders : game/docs/aventure-alabasta.md ; l'équilibrage fin est
// la tâche 5.8 (scripts/game/adventure-balance.ts).
import type { DeckList } from '../engine/decks.ts';

const deck = (id: string, name: string, leader: string, cards: Record<string, number>): DeckList =>
  ({ id, name, series: 'AVENTURE', leader, cards });

const DECK_LIST: DeckList[] = [
  // Chapitre 1, Reverse Mountain : Mr. 9 et Miss Wednesday, chasseurs de baleine, et les petits agents de Baroque
  // Works. Petits coûts, peu de finisseurs : c'est l'entrée dans Grand Line. Crocodile OP01-062 (bleu/violet), le
  // patron dans l'ombre, faute de Leader Mr. 9. Tâche 5.8 : Miss All Sunday (OP12-075) et Mr. 4 à la place de Mr. 13
  // et Miss Friday et des Agents d'élite, pour un premier chapitre un peu plus dur que la fin d'East Blue.
  deck('AV-AL-MR9', 'Mr. 9 et Miss Wednesday (Reverse Mountain)', 'OP01-062', {
    'EB01-037': 4, 'EB01-034': 4, 'EB01-035': 4, 'OP01-083': 4, 'OP01-085': 2, 'OP01-079': 2, 'OP01-080': 4,
    'OP04-066': 2, 'OP04-069': 2, 'OP01-090': 4, 'OP01-088': 4, 'OP04-074': 4, 'OP04-076': 4, 'OP12-075': 4,
    'OP04-071': 2,
  }),
  // Chapitre 2, Whisky Peak : Mr. 5 (et son Nez-Palm Cannon) et Miss Valentine, les chasseurs de primes de la ville et
  // Miss All Sunday venue en observatrice. Crocodile OP01-062 (bleu/violet), comme au chapitre 1. Tâche 5.8 : Miss
  // All Sunday (OP12-075) et Mr. 4 à la place de Mr. 13 et Miss Friday et de quelques [Contre] DON!! −1.
  deck('AV-AL-MR5', 'Mr. 5 et Miss Valentine (Whisky Peak)', 'OP01-062', {
    'OP04-072': 4, 'OP04-066': 4, 'EB01-037': 4, 'EB01-034': 4, 'EB01-035': 4, 'OP04-064': 2, 'OP04-070': 2,
    'OP04-075': 4, 'OP04-074': 2, 'OP04-076': 4, 'OP01-083': 2, 'OP01-090': 4, 'OP01-088': 2, 'OP12-075': 4,
    'OP04-071': 4,
  }),
  // Chapitre 3, Little Garden : Mr. 3 (la cire) et Miss Goldenweek (Colors Trap), avec Mr. 5, Miss Valentine, Mr. 4 et
  // Miss Merry Christmas en renfort, et Miss All Sunday. Crocodile OP01-062 (bleu/violet). Tâche 5.8 : plus de
  // Personnages, moins d'Événements (l'IA simple joue mal les [Contre] DON!! −1 et les recherches).
  deck('AV-AL-MR3', 'Mr. 3 et Miss Goldenweek (Little Garden)', 'OP01-062', {
    'OP04-070': 4, 'OP01-085': 4, 'OP04-065': 4, 'OP04-072': 4, 'OP04-066': 4, 'OP12-075': 4, 'OP04-064': 4,
    'OP04-071': 4, 'OP01-084': 4, 'OP04-075': 3, 'OP04-067': 4, 'OP01-079': 3, 'OP04-073': 4,
  }),
  // Chapitre 4, royaume de Drum : Wapol (deux versions), Chess et Kuromarimo (et leur fusion), les Lapins, Robson,
  // Dalton et les vingt médecins du roi ; le fruit Bak Bak (Munch-Munch Mutation). Aucun Leader Wapol n'existe :
  // Chopper OP08-001 est le seul Leader {Drum Kingdom}, comme Kobby à Shells Town. Tâche 5.8 : Musshuru, Dalton et
  // Chopper (OP08-007) à la place de l'ours, de la scène et de quelques Événements.
  deck('AV-AL-WAPOL', 'Royaume de Drum (Wapol)', 'OP08-001', {
    'OP08-014': 4, 'OP13-018': 4, 'OP08-005': 4, 'OP08-004': 4, 'OP08-006': 4, 'OP08-013': 4, 'OP08-012': 4,
    'OP08-003': 2, 'OP08-009': 4, 'OP08-011': 4, 'OP08-019': 2, 'OP08-017': 2, 'OP08-008': 4, 'OP08-007': 4,
  }),
  // Chapitre 5, Yuba : Vivi veut arrêter la guerre seule ; Luffy l'affronte pour qu'elle accepte l'aide de ses amis.
  // Que des cartes {Alabasta} : Koza, Chaka, Pell, Igaram, Karoo (EB02-001), Cobra, Nami en danseuse et les canards.
  // Tâche 5.8 : des Personnages plus forts (Karoo, Cobra et Chaka à 5 coûts, Chaka et Pell, Vivi OP04-118) à la place
  // des Jugons, des petits Karoo, de Cobra OP04-012 et de Terracotta.
  deck('AV-AL-VIVI', 'Royaume d’Alabasta (Vivi)', 'OP04-001', {
    'OP04-006': 4, 'EB01-004': 2, 'OP04-008': 4, 'OP04-013': 4, 'OP05-014': 2, 'OP04-002': 2, 'EB04-021': 2,
    'OP04-009': 2, 'EB04-023': 4, 'OP04-118': 4, 'OP04-018': 2, 'EB03-011': 4, 'EB02-001': 4, 'OP13-011': 4,
    'OP05-008': 4, 'EB03-006': 2,
  }),
  // Défi de Nanohana : Ace aux Poings ardents, de passage, et des Pirates de Barbe Blanche (cartes d'OP02 et d'OP03,
  // de l'époque) ; Striker, son bateau. Plus fort que les chapitres qui l'entourent (inchangé par la tâche 5.8).
  deck('AV-AL-ACE', 'Ace aux Poings ardents (Nanohana)', 'OP03-001', {
    'OP02-013': 4, 'OP03-013': 4, 'OP03-003': 4, 'OP03-004': 2, 'OP03-005': 2, 'OP03-009': 2, 'OP03-011': 2,
    'OP03-006': 2, 'OP03-007': 2, 'OP02-011': 2, 'OP03-010': 2, 'OP02-003': 2, 'OP02-019': 2, 'OP03-016': 2,
    'OP03-017': 4, 'OP03-018': 4, 'OP03-019': 2, 'OP03-020': 2, 'OP02-022': 4,
  }),
  // Chapitre 6, Rainbase : la Marine de Smoker et de Tashigi (plusieurs versions), qui protège ses Personnages pendant
  // le tour adverse (effet du Leader Smoker OP10-001, rouge/vert). Tâche 5.8, un peu allégé : sans le Smoker [Banish]
  // ni deux des Tashigi à 7000, avec plus de Toile argileuse.
  deck('AV-AL-SMOKER', 'Marine de Smoker (Rainbase)', 'OP10-001', {
    'OP11-005': 4, 'OP16-028': 4, 'OP15-031': 4, 'OP10-032': 4, 'EB03-018': 2, 'OP11-007': 4, 'OP14-029': 4,
    'OP11-008': 4, 'OP15-016': 4, 'OP11-004': 4, 'OP12-033': 4, 'OP11-019': 4, 'OP15-010': 4,
  }),
  // Défi d'Alubarna : les agents d'élite de Baroque Works (Mr. 1 et Miss Doublefinger, Mr. 2, Mr. 4 et Miss Merry
  // Christmas, Miss All Sunday), tous ensemble. Tâche 5.8 : Crocodile OP01-062 (bleu/violet) au lieu d'OP04-058, pour
  // les versions bleues de Mr. 1 (OP09-055, EB01-027) et de Mr. 2 (OP02-064, OP01-084), bien plus solides.
  deck('AV-AL-AGENTS', 'Agents d’élite de Baroque Works (Alubarna)', 'OP01-062', {
    'OP09-055': 4, 'EB01-027': 4, 'OP01-080': 4, 'OP05-073': 4, 'OP02-064': 4, 'OP01-084': 4, 'OP04-069': 2,
    'OP04-071': 4, 'OP04-067': 4, 'OP12-075': 4, 'OP04-064': 4, 'OP01-088': 4, 'OP01-086': 4,
  }),
  // Chapitre 7, Alubarna (final) : Crocodile et tout Baroque Works. Tâche 5.8 : Crocodile OP01-062 (bleu/violet) au
  // lieu du Leader noir OP14-079, qui interdit à ses propres effets de faire quitter le terrain aux Personnages adverses
  // (ST-01 gagnait plus de la moitié des parties) ; Crocodile en plusieurs versions (OP01-067 [Banish], OP02-053,
  // ST03-003, OP04-060) et ses agents, de Mr. 1 à Miss Merry Christmas.
  deck('AV-AL-CROCODILE', 'Baroque Works (Crocodile)', 'OP01-062', {
    'OP01-067': 4, 'OP02-053': 2, 'ST03-003': 2, 'OP04-060': 2, 'EB01-027': 2, 'OP12-075': 4, 'OP04-071': 4,
    'OP02-065': 4, 'OP01-084': 4, 'OP01-080': 4, 'OP04-066': 2, 'OP04-067': 4, 'OP04-072': 2, 'OP01-083': 4,
    'OP02-064': 2, 'OP01-088': 2, 'OP01-090': 2,
  }),
];

export const ALABASTA_DECKS: Record<string, DeckList> = Object.fromEntries(DECK_LIST.map((d) => [d.id, d]));
