// Decks de démarrage officiels ST-02 à ST-09 et ST-11 (tâche 5.2) : branchés à la fin de DECKS (game/engine/decks.ts), après
// ADVENTURE_DECKS. Une source par liste, citée au-dessus du deck. ST-10, ST-12, ST-13 et ST-14 : pas de liste fiable avec
// quantités trouvée (voir la PR), non ajoutés.
import type { DeckList } from './decks.ts';

export const STARTERS_A: Record<string, DeckList> = {
  // STARTER DECK -Worst Generation- [ST-02] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck02
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-02': {
    id: 'ST-02',
    name: 'Eustass Kid (vert)',
    series: 'ST-02',
    leader: 'ST02-001',
    cards: {
      'ST02-002': 4, 'ST02-003': 2, 'ST02-004': 4, 'ST02-005': 2,
      'ST02-006': 4, 'ST02-007': 4, 'ST02-008': 4, 'ST02-009': 2,
      'ST02-010': 2, 'ST02-011': 4, 'ST02-012': 4, 'ST02-013': 2,
      'ST02-014': 4, 'ST02-015': 2, 'ST02-016': 4, 'ST02-017': 2,
    },
  },
  // STARTER DECK -The Seven Warlords of the Sea- [ST-03] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck03
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-03': {
    id: 'ST-03',
    name: 'Crocodile (bleu)',
    series: 'ST-03',
    leader: 'ST03-001',
    cards: {
      'ST03-002': 4, 'ST03-003': 2, 'ST03-004': 2, 'ST03-005': 2,
      'ST03-006': 4, 'ST03-007': 2, 'ST03-008': 4, 'ST03-009': 2,
      'ST03-010': 4, 'ST03-011': 4, 'ST03-012': 4, 'ST03-013': 4,
      'ST03-014': 2, 'ST03-015': 4, 'ST03-016': 4, 'ST03-017': 2,
    },
  },
  // STARTER DECK -Animal Kingdom Pirates- [ST-04] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck04
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-04': {
    id: 'ST-04',
    name: 'Kaido (violet)',
    series: 'ST-04',
    leader: 'ST04-001',
    cards: {
      'ST04-002': 4, 'ST04-003': 2, 'ST04-004': 2, 'ST04-005': 2,
      'ST04-006': 4, 'ST04-007': 4, 'ST04-008': 2, 'ST04-009': 4,
      'ST04-010': 2, 'ST04-011': 4, 'ST04-012': 4, 'ST04-013': 4,
      'ST04-014': 2, 'ST04-015': 2, 'ST04-016': 4, 'ST04-017': 4,
    },
  },
  // STARTER DECK -ONE PIECE FILM edition- [ST-05] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck05
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-05': {
    id: 'ST-05',
    name: 'Shanks (violet)',
    series: 'ST-05',
    leader: 'ST05-001',
    cards: {
      'ST05-002': 4, 'ST05-003': 4, 'ST05-004': 2, 'ST05-005': 2,
      'ST05-006': 2, 'ST05-007': 4, 'ST05-008': 2, 'ST05-009': 4,
      'ST05-010': 2, 'ST05-011': 2, 'ST05-012': 4, 'ST05-013': 4,
      'ST05-014': 4, 'ST05-015': 4, 'ST05-016': 2, 'ST05-017': 4,
    },
  },
  // STARTER DECK -Absolute Justice- [ST-06] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck06
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-06': {
    id: 'ST-06',
    name: 'Sakazuki (noir)',
    series: 'ST-06',
    leader: 'ST06-001',
    cards: {
      'ST06-002': 2, 'ST06-003': 4, 'ST06-004': 2, 'ST06-005': 4,
      'ST06-006': 4, 'ST06-007': 4, 'ST06-008': 2, 'ST06-009': 4,
      'ST06-010': 4, 'ST06-011': 4, 'ST06-012': 2, 'ST06-013': 4,
      'ST06-014': 2, 'ST06-015': 2, 'ST06-016': 4, 'ST06-017': 2,
    },
  },
  // STARTER DECK -Big Mom Pirates- [ST-07] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck07
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-07': {
    id: 'ST-07',
    name: 'Charlotte Linlin (jaune)',
    series: 'ST-07',
    leader: 'ST07-001',
    cards: {
      'ST07-002': 4, 'ST07-003': 2, 'ST07-004': 4, 'ST07-005': 2,
      'ST07-006': 4, 'ST07-007': 2, 'ST07-008': 4, 'ST07-009': 2,
      'ST07-010': 2, 'ST07-011': 4, 'ST07-012': 4, 'ST07-013': 4,
      'ST07-014': 4, 'ST07-015': 4, 'ST07-016': 2, 'ST07-017': 2,
    },
  },
  // STARTER DECK -Monkey.D.Luffy- [ST-08] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck08
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-08': {
    id: 'ST-08',
    name: 'Luffy (noir)',
    series: 'ST-08',
    leader: 'ST08-001',
    cards: {
      'ST08-002': 2, 'ST08-003': 4, 'ST08-004': 4, 'ST08-005': 2,
      'ST08-006': 4, 'ST08-007': 4, 'ST08-008': 4, 'ST08-009': 4,
      'ST08-010': 4, 'ST08-011': 4, 'ST08-012': 4, 'ST08-013': 4,
      'ST08-014': 4, 'ST08-015': 2,
    },
  },
  // STARTER DECK -Yamato- [ST-09] : liste relevée sur https://laughtale-pirates.com/askerbert/one-piece-cardlist-starterdeck09
  // (quantités par carte ; numéros lus sur les illustrations de la page)
  'ST-09': {
    id: 'ST-09',
    name: 'Yamato (jaune)',
    series: 'ST-09',
    leader: 'ST09-001',
    cards: {
      'ST09-002': 4, 'ST09-003': 4, 'ST09-004': 4, 'ST09-005': 2,
      'ST09-006': 4, 'ST09-007': 4, 'ST09-008': 4, 'ST09-009': 4,
      'ST09-010': 2, 'ST09-011': 4, 'ST09-012': 4, 'ST09-013': 4,
      'ST09-014': 2, 'ST09-015': 4,
    },
  },
  // STARTER DECK -Side Uta- [ST-11] : quantités relevées sur la revue Zatu
  // https://zatu.com/en-us/blogs/reviews/review-one-piece-card-game-starter-deck-uta-st-11 (51 cartes avec le Leader) ;
  // numéros trouvés dans le catalogue par nom (cartes OP02 vertes pour Law, Chopper, Jinbe, Robin, Usopp, Zoro, Brook, Franky, Luffy)
  'ST-11': {
    id: 'ST-11',
    name: 'Uta (vert)',
    series: 'ST-11',
    leader: 'ST11-001',
    cards: {
      'OP02-035': 4, 'OP02-034': 4, 'OP02-033': 4, 'ST11-002': 2, 'OP02-037': 4, 'OP02-028': 4, 'OP02-043': 4,
      'OP02-040': 4, 'OP02-039': 4, 'OP02-041': 4, 'ST11-004': 2, 'ST11-003': 2, 'ST11-005': 4, 'OP02-045': 4,
    },
  },
};
