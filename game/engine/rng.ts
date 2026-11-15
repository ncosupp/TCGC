// Hasard reproductible : l'état du générateur fait partie de l'état de la partie.
// - rng (31 bits utiles, mulberry32) : parties contre l'IA, parties en ligne d'avant le 14 novembre 2026, simulations
//   de l'IA et du coach. Avec si peu d'états, la graine d'une partie se retrouve par force brute à partir de sa main de
//   départ : sans importance contre l'IA, mais pas en ligne.
// - rng128 (128 bits, sfc32) : parties en ligne, tiré par le serveur avec crypto. Quand il est présent, c'est lui qui
//   sert, et rng n'est plus lu. Il ne sort jamais du serveur pendant la partie (view.ts le retire).
// Une partie garde son générateur du début à la fin : les parties archivées se rejouent avec celui de leur création
// (la présence de rng128 dans l'état de départ suffit à le reconnaître, sans changer RULES_VERSION).
export type Rng128 = [number, number, number, number];

export interface RngState {
  rng: number;
  rng128?: Rng128;
}

// sfc32 (Chris Doty-Humphrey) : 128 bits d'état, dont un compteur (jamais de cycle court, même depuis un état nul)
function sfc32(x: Rng128): number {
  const t = (((x[0] + x[1]) | 0) + x[3]) | 0;
  x[3] = (x[3] + 1) | 0;
  x[0] = x[1] ^ (x[1] >>> 9);
  x[1] = (x[2] + (x[2] << 3)) | 0;
  x[2] = (x[2] << 21) | (x[2] >>> 11);
  x[2] = (x[2] + t) | 0;
  return (t >>> 0) / 4294967296;
}

export function random(s: RngState): number {
  if (s.rng128) return sfc32(s.rng128);
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle<T>(s: RngState, items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

// État de 128 bits à partir de 4 entiers (tirés par crypto côté serveur). Les premiers tirages de sfc32 dépendent peu
// de l'état : on les écarte, comme le recommande son auteur.
export function rng128From(words: readonly number[]): Rng128 {
  if (words.length !== 4 || !words.every((w) => Number.isInteger(w))) throw new Error('Graine de 128 bits invalide');
  const x = words.map((w) => w | 0) as Rng128;
  for (let i = 0; i < 12; i++) sfc32(x);
  return x;
}

export const isRng128 = (x: unknown): x is Rng128 => Array.isArray(x) && x.length === 4 && x.every((w) => Number.isInteger(w));
