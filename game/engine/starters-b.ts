// Decks de démarrage officiels ST-15 à ST-29 (tâche 5.3) : branchés à la fin de DECKS (game/engine/decks.ts), après
// STARTERS_A. Une source par liste, citée en commentaire au-dessus du deck.
// Pas ajouté : ST-29 (aucune liste avec les quantités par carte, voir la PR de la tâche 5.3).
import type { DeckList } from './decks.ts';

export const STARTERS_B: Record<string, DeckList> = {
  // https://onepieceplayer.com/set/st-15-starter-deck-red-edward-newgate/ (quantités par numéro, total vérifié : 50)
  'ST-15': {
    id: 'ST-15',
    name: 'Edward Newgate (rouge)',
    series: 'ST-15',
    leader: 'OP02-001',
    cards: {
      'ST15-001': 4, 'ST15-002': 2, 'ST15-003': 4, 'ST15-004': 2, 'ST15-005': 2,
      'OP02-008': 4, 'OP02-018': 4, 'OP02-019': 4, 'OP02-023': 4,
      'OP03-003': 4, 'OP03-006': 4, 'OP03-007': 4, 'OP03-009': 4, 'OP03-010': 4,
    },
  },
  // https://onepieceplayer.com/set/st-17-starter-deck-blue-donquixote-doflamingo/ (total vérifié : 50)
  'ST-17': {
    id: 'ST-17',
    name: 'Donquixote Doflamingo (bleu)',
    series: 'ST-17',
    leader: 'OP01-060',
    cards: {
      'ST17-001': 4, 'ST17-002': 2, 'ST17-003': 2, 'ST17-004': 2, 'ST17-005': 4,
      'OP01-073': 4, 'OP01-086': 4, 'OP02-054': 4, 'OP02-057': 4,
      'ST03-002': 4, 'ST03-004': 4, 'ST03-005': 4, 'ST03-008': 4, 'P-030': 4,
    },
  },
  // https://onepieceplayer.com/set/st-18-starter-deck-purple-monkey-d-luffy/ (total vérifié : 50)
  'ST-18': {
    id: 'ST-18',
    name: 'Monkey D. Luffy (violet)',
    series: 'ST-18',
    leader: 'OP05-060',
    cards: {
      'ST18-001': 2, 'ST18-002': 4, 'ST18-003': 4, 'ST18-004': 2, 'ST18-005': 2,
      'OP05-061': 4, 'OP05-063': 4, 'OP05-066': 4, 'OP05-067': 4, 'OP05-068': 4, 'OP05-070': 4, 'OP05-072': 4,
      'OP05-076': 4, 'P-041': 4,
    },
  },
  // https://onepieceplayer.com/set/st-19-starter-deck-black-smoker/ (total vérifié : 50)
  'ST-19': {
    id: 'ST-19',
    name: 'Smoker (noir)',
    series: 'ST-19',
    leader: 'OP02-093',
    cards: {
      'ST19-001': 4, 'ST19-002': 2, 'ST19-003': 2, 'ST19-004': 2, 'ST19-005': 4,
      'OP02-098': 4, 'OP02-106': 4, 'OP02-108': 4, 'OP02-109': 4, 'OP02-113': 4, 'OP02-116': 4, 'OP02-117': 4,
      'OP03-079': 4, 'OP03-089': 4,
    },
  },
  // https://onepieceplayer.com/set/st-16-starter-deck-green-uta/ ; numéros : liste officielle des 15 numéros : https://en.onepiece-cardgame.com/cardlist/?series=569016 (la source donnait Backlight ST11-003 à 2 exemplaires, ce qui faisait 48 cartes : mis à 4 pour faire 50 comme les autres decks de la série (3 cartes à 2 exemplaires, le reste à 4), à valider)
  'ST-16': {
    id: 'ST-16',
    name: 'Uta (vert)',
    series: 'ST-16',
    leader: 'ST11-001',
    cards: {
      'ST16-001': 2, 'ST16-004': 2, 'ST16-005': 2, 'ST16-002': 4, 'ST16-003': 4,
      'ST11-003': 4, 'ST11-004': 4, 'ST11-005': 4, 'P-029': 4, 'P-057': 4,
      'P-058': 4, 'P-059': 4, 'P-060': 4, 'P-061': 4,
    },
  },
  // Nouvelles cartes : https://www.tcgplayer.com/content/article/How-to-Upgrade-the-One-Piece-TCG-Starter-Deck-23-RED-Shanks/3bff8ee9-3d6f-43ab-be3b-9e857b69bd5c/ (liste de base) ; liste officielle des 15 numéros : https://en.onepiece-cardgame.com/cardlist/?series=569023 (reprises à 4 exemplaires déduites du total de 50)
  'ST-23': {
    id: 'ST-23',
    name: 'Shanks (rouge)',
    series: 'ST-23',
    leader: 'OP09-001',
    cards: {
      'ST23-001': 2, 'ST23-002': 2, 'ST23-003': 2, 'ST23-004': 4, 'ST23-005': 4,
      'OP09-006': 4, 'OP09-010': 4, 'OP09-011': 4, 'OP09-012': 4, 'OP09-013': 4,
      'OP09-014': 4, 'OP09-015': 4, 'OP09-016': 4, 'OP09-020': 4,
    },
  },
  // Nouvelles cartes : https://www.tcgplayer.com/content/article/How-to-Upgrade-the-One-Piece-TCG-Starter-Deck-24-GREEN-Jewelry-Bonney/e305b37a-0ff9-4c30-b9fa-998d20de324e/ ; liste officielle des 15 numéros : https://en.onepiece-cardgame.com/cardlist/?series=569024 (reprises à 4 exemplaires déduites du total de 50)
  'ST-24': {
    id: 'ST-24',
    name: 'Jewelry Bonney (vert)',
    series: 'ST-24',
    leader: 'OP07-019',
    cards: {
      'ST24-002': 2, 'ST24-003': 2, 'ST24-004': 2, 'ST24-001': 4, 'ST24-005': 4,
      'EB01-015': 4, 'OP07-021': 4, 'OP07-023': 4, 'OP07-025': 4, 'OP07-031': 4,
      'OP07-033': 4, 'OP07-034': 4, 'OP07-036': 4, 'OP07-037': 4,
    },
  },
  // Nouvelles cartes : https://www.tcgplayer.com/content/article/How-to-Upgrade-the-One-Piece-TCG-Starter-Deck-25-BLUE-Buggy/17edd14d-fbbc-495f-a7af-3e3706611261/ ; liste officielle des 15 numéros : https://en.onepiece-cardgame.com/cardlist/?series=569025 (reprises à 4 exemplaires déduites du total de 50)
  'ST-25': {
    id: 'ST-25',
    name: 'Buggy (bleu)',
    series: 'ST-25',
    leader: 'OP09-042',
    cards: {
      'ST25-001': 2, 'ST25-003': 2, 'ST25-004': 2, 'ST25-002': 4, 'ST25-005': 4,
      'OP09-043': 4, 'OP09-045': 4, 'OP09-051': 4, 'OP09-053': 4, 'OP09-054': 4,
      'OP09-055': 4, 'OP09-056': 4, 'OP09-057': 4, 'P-084': 4,
    },
  },
  // Nouvelles cartes : https://www.tcgplayer.com/content/article/How-to-Upgrade-the-One-Piece-TCG-Starter-Deck-26-PURPLE-BLACK-Luffy/9ae55697-e61d-439c-b064-8a7d1cfd6dbb/ ; liste officielle des 15 numéros : https://en.onepiece-cardgame.com/cardlist/?series=569026 (reprises à 4 exemplaires déduites du total de 50)
  'ST-26': {
    id: 'ST-26',
    name: 'Monkey D. Luffy (violet/noir)',
    series: 'ST-26',
    leader: 'OP09-061',
    cards: {
      'ST26-002': 2, 'ST26-003': 2, 'ST26-005': 2, 'ST26-001': 4, 'ST26-004': 4,
      'OP05-065': 4, 'OP05-066': 4, 'OP05-070': 4, 'OP09-063': 4, 'OP09-070': 4,
      'OP09-076': 4, 'OP09-077': 4, 'OP09-078': 4, 'ST14-010': 4,
    },
  },
  // Nouvelles cartes : https://www.tcgplayer.com/content/article/How-to-Upgrade-the-One-Piece-TCG-Starter-Deck-27-BLACK-Marshall-D-Teach/6396491b-6ff1-4028-b6df-ed66c71ece91/ ; liste officielle des 15 numéros : https://en.onepiece-cardgame.com/cardlist/?series=569027 (reprises à 4 exemplaires déduites du total de 50)
  'ST-27': {
    id: 'ST-27',
    name: 'Marshall D. Teach (noir)',
    series: 'ST-27',
    leader: 'OP09-081',
    cards: {
      'ST27-003': 2, 'ST27-004': 2, 'ST27-005': 2, 'ST27-001': 4, 'ST27-002': 4,
      'OP09-083': 4, 'OP09-086': 4, 'OP09-088': 4, 'OP09-089': 4, 'OP09-090': 4,
      'OP09-091': 4, 'OP09-095': 4, 'OP09-099': 4, 'OP10-084': 4,
    },
  },
  // https://cardgamebase.com/one-piece-st28-decklist-card-list/ (noms, rapprochés des numéros par liste officielle des 15 numéros : https://en.onepiece-cardgame.com/cardlist/?series=569028)
  'ST-28': {
    id: 'ST-28',
    name: 'Yamato (vert/jaune)',
    series: 'ST-28',
    leader: 'OP06-022',
    cards: {
      'ST28-003': 2, 'ST28-004': 2, 'ST28-005': 2, 'ST28-001': 4, 'ST28-002': 4,
      'OP06-100': 4, 'OP06-103': 4, 'OP06-104': 4, 'OP06-109': 4, 'OP06-110': 4,
      'OP06-112': 4, 'OP07-116': 4, 'OP09-035': 4, 'ST13-016': 4,
    },
  },
  // https://onepieceplayer.com/set/st-20-starter-deck-yellow-charlotte-katakuri/ (total vérifié : 50)
  'ST-20': {
    id: 'ST-20',
    name: 'Charlotte Katakuri (jaune)',
    series: 'ST-20',
    leader: 'OP03-099',
    cards: {
      'ST20-001': 2, 'ST20-002': 4, 'ST20-003': 4, 'ST20-004': 2, 'ST20-005': 2,
      'OP03-106': 4, 'OP03-107': 4, 'OP03-110': 4, 'OP03-112': 4, 'OP03-115': 4,
      'ST07-005': 4, 'ST07-014': 4, 'OP03-118': 4, 'OP03-121': 4,
    },
  },
};
