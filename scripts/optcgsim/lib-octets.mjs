// Briques d'octets partagées par les outils OPTCGSim (anonymiseur, et plus tard régénération du catalogue) :
// empreinte XXH64 des lots NGO et compactage d'entiers de Netcode for GameObjects. Sans dépendance.

const M64 = (1n << 64n) - 1n;
const P1 = 11400714785074694791n, P2 = 14029467366897019727n, P3 = 1609587929392839161n, P4 = 9650029242287828579n, P5 = 2870177450012600261n;
const rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M64;
const round = (acc, v) => (rotl((acc + v * P2) & M64, 31) * P1) & M64;
const merge = (acc, v) => (((acc ^ round(0n, v)) * P1) + P4) & M64;

/** XXH64, graine 0 (empreinte de lot NGO). */
export function xxh64(buf) {
  let i = 0, h;
  const n = buf.length;
  if (n >= 32) {
    let v1 = (P1 + P2) & M64, v2 = P2, v3 = 0n, v4 = (0n - P1) & M64;
    while (i + 32 <= n) {
      v1 = round(v1, buf.readBigUInt64LE(i)); v2 = round(v2, buf.readBigUInt64LE(i + 8));
      v3 = round(v3, buf.readBigUInt64LE(i + 16)); v4 = round(v4, buf.readBigUInt64LE(i + 24)); i += 32;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) & M64;
    h = merge(h, v1); h = merge(h, v2); h = merge(h, v3); h = merge(h, v4);
  } else h = P5;
  h = (h + BigInt(n)) & M64;
  while (i + 8 <= n) { h ^= round(0n, buf.readBigUInt64LE(i)); h = ((rotl(h, 27) * P1) + P4) & M64; i += 8; }
  if (i + 4 <= n) { h ^= (BigInt(buf.readUInt32LE(i)) * P1) & M64; h = ((rotl(h, 23) * P2) + P3) & M64; i += 4; }
  while (i < n) { h ^= (BigInt(buf[i]) * P5) & M64; h = (rotl(h, 11) * P1) & M64; i++; }
  h ^= h >> 33n; h = (h * P2) & M64; h ^= h >> 29n; h = (h * P3) & M64; h ^= h >> 32n;
  return h;
}

/** uint compacté NGO : (v << 3) | nbOctets ; au-delà de 2^29 - 1 : 0x05 puis 4 octets. */
export function packUInt(v) {
  if (v > 536870911) { const b = Buffer.alloc(5); b[0] = 5; b.writeUInt32LE(v >>> 0, 1); return b; }
  let x = (v << 3) >>> 0, n = 1;
  while (n < 4 && (x >>> (8 * n)) !== 0) n++;
  x = (x | n) >>> 0;
  const b = Buffer.alloc(n);
  for (let k = 0; k < n; k++) b[k] = (x >>> (8 * k)) & 0xff;
  return b;
}

/** Lecture d'un uint compacté : { value, next }. */
export function readPackedUInt(buf, off) {
  const n = buf[off] & 7;
  if (n === 5) return { value: buf.readUInt32LE(off + 1), next: off + 5 };
  let x = 0;
  for (let k = 0; k < n; k++) x += buf[off + k] * 2 ** (8 * k);
  return { value: Math.floor(x / 8), next: off + n };
}

/** Lecture d'un ulong (bits = 4) ou ushort (bits = 2) compacté, petites valeurs. */
export function readPackedSmall(buf, off, bits) {
  const n = buf[off] & (2 ** bits - 1);
  let x = 0;
  for (let k = 0; k < n; k++) x += buf[off + k] * 2 ** (8 * k);
  return { value: Math.floor(x / 2 ** bits), next: off + n };
}

/** Lot NGO : en-tête (4448, nb de messages, taille, XXH64) + messages [type compacté, taille compactée, charge]. */
export function construireLot(messages) {
  const corps = Buffer.concat(messages.flatMap(({ type, charge }) => [packUInt(type), packUInt(charge.length), charge]));
  const h = Buffer.alloc(16);
  h.writeUInt16LE(4448, 0); h.writeUInt16LE(messages.length, 2); h.writeInt32LE(16 + corps.length, 4); h.writeBigUInt64LE(xxh64(corps), 8);
  return Buffer.concat([h, corps]);
}

/** Décodage d'un lot : { nb, tailleOk, empreinteOk, messages: [{ type, charge }] } ou { erreur }. */
export function decoderLot(lot) {
  if (lot.length < 16 || lot.readUInt16LE(0) !== 4448) return { erreur: 'pas un lot NGO' };
  const nb = lot.readUInt16LE(2), taille = lot.readInt32LE(4), empreinte = lot.readBigUInt64LE(8);
  const messages = [];
  let o = 16;
  for (let k = 0; k < nb && o < lot.length; k++) {
    const t = readPackedUInt(lot, o), s = readPackedUInt(lot, t.next);
    messages.push({ type: t.value, charge: lot.subarray(s.next, s.next + s.value) });
    o = s.next + s.value;
  }
  return { nb, tailleOk: taille === lot.length, empreinteOk: xxh64(lot.subarray(16)) === empreinte, messages };
}
