// OP04 (Kingdoms of Intrigue), version anglaise : 24 boosters de 12 cartes par display. Numéros et raretés : liste
// officielle anglaise (119 cartes de base, 25 parallèles dont une manga, 5 cartes SP). Taux : comptages publiés par
// Torecamap pour OP-04 (312 displays japonais ; un display japonais = un « lot » de 12 boosters anglais).
// Sources, calculs et incertitudes : game/docs/boosters.md.
import type { BoosterSet, Version } from './index.ts';

const nums = (list: string) => list.split(' ').map((n) => `OP04-${n}`);

// Version de base, par rareté imprimée (la 119, Rosinante, est une SEC dans les boosters ; le catalogue la range sous
// « SP CARD » à cause de la numérotation de sa liste, voir boosters.md)
const L = nums('001 019 020 039 040 058');
const C = nums('004 005 007 010 011 012 017 021 023 025 027 029 036 038 041 042 047 050 052 054 055 061 062 065 067 '
  + '068 073 076 077 078 079 084 086 087 095 096 097 101 106 107 109 110 113 114 115');
const UC = nums('003 006 009 014 018 022 032 033 034 037 046 048 049 053 057 059 069 070 071 075 080 085 088 091 093 '
  + '098 103 108 111 116');
const R = nums('002 008 015 016 026 028 030 035 043 045 051 056 063 066 072 074 081 082 089 092 094 099 100 102 105 117');
const SR = nums('013 024 031 044 060 064 083 090 104 112');
const SEC = nums('118 119');

// Parallèles : tous les Leaders, SR et SEC, et 6 des R ; visuel « _p1 » de la liste officielle
const parallels = (rarity: string, list: string[]): Version[] =>
  list.map((number) => ({ number, variant: 'parallele', rarity, imageId: `${number}_p1` }));
const PARALLEL_R = nums('028 030 051 072 082 100');

// Cartes SP : affiches « Wanted » de 5 SR d'OP01 et d'OP02, glissées dans les boosters d'OP04 (visuel « _p2 »)
const SP: Version[] = ['OP01-047', 'OP01-078', 'OP02-004', 'OP02-085', 'OP02-099']
  .map((number) => ({ number, variant: 'sp', rarity: 'SP CARD', imageId: `${number}_p2` }));

// Sabo à fond de planche de manga, la surprise la plus rare
const MANGA: Version = { number: 'OP04-083', variant: 'manga', rarity: 'SR', imageId: 'OP04-083_p2' };

export const OP04: BoosterSet = {
  set: 'OP04',
  lang: 'en',
  commons: 7,
  uncommons: 3,
  cards: { L, C, UC, R, SR, SEC },
  lot: {
    boosters: 12,
    superRares: [3, 4],
    leaders: [3, 4],
    // sur 312 displays japonais : 124 avec une SEC (39,74 %), 188 avec une ou deux surprises (111 avec une, 77 avec
    // deux : 265 surprises en tout, comme les comptages par genre ci-dessous)
    patterns: { sec: 124, oneHit: 111, twoHits: 77 },
  },
  // Poids : nombre de surprises de chaque genre dans les mêmes 312 displays (265 en tout). Torecamap ne sépare pas
  // les SR, R et SEC parallèles (188 en tout) : on les répartit à égalité par carte (10 SR, 6 R, 2 SEC), comme les
  // chiffres d'OP03. Manga : 2 comptées, une pour 156 displays japonais.
  hits: [
    { id: 'parallele-sr', label: 'SR parallèle', weight: 104.4, versions: parallels('SR', SR) },
    { id: 'parallele-r', label: 'R parallèle', weight: 62.7, versions: parallels('R', PARALLEL_R) },
    { id: 'parallele-l', label: 'Leader parallèle', weight: 50, versions: parallels('L', L) },
    { id: 'sp', label: 'Carte SP', weight: 25, versions: SP },
    { id: 'parallele-sec', label: 'SEC parallèle', weight: 20.9, versions: parallels('SEC', SEC) },
    { id: 'manga', label: 'SR manga', weight: 2, versions: [MANGA] },
  ],
};
