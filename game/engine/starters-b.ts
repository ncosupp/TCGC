// Decks de démarrage officiels ST-15 à ST-29 (tâche 5.3) : branchés à la fin de DECKS (game/engine/decks.ts), après
// STARTERS_A. Une source par liste, citée en commentaire au-dessus du deck.
// Pas encore ajoutés : ST-20 (ci-dessous, en attente) ; ST-16, ST-23 à ST-29 (liste à quantités introuvable ou douteuse, voir la PR de la tâche 5.3) : ST-16, ST-23 à ST-29.
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
};

// ST-20 : liste prête mais PAS branchée dans le registre. Son Leader (OP03-099) regarde la Vie : la redistribution des
// cartes cachées du test « observation » de game/tests/rl-env.test.ts donne alors une observation différente (voir la PR
// de la tâche 5.3). À brancher (l'ajouter à STARTERS_B) quand ce point est tranché.
export const ST20_EN_ATTENTE: Record<string, DeckList> = {
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
