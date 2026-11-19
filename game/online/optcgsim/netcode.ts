// Netcode for GameObjects (NGO) tel que l'utilise OPTCGSim (version gelée : handshake.json) : compactage des entiers (BytePacker), lots
// (NetworkBatchHeader + empreinte XXH64), demande de connexion rejouée depuis handshake.json, synchronisation de
// scène (objets joueurs), synchro terminée et identifiant client. Portage du prototype `optcg-proto.mjs` (validé
// contre le vrai jeu le 17 nov. 2026), sans changement de comportement. Aucun accès réseau ici.

import { Buffer } from 'node:buffer';
import handshakeJson from './handshake.json' with { type: 'json' };
import type { Transport } from './transport.ts';

// ---------------------------------------------------------------- types de message
/**
 * Ordre des messages NGO : tri ordinal des noms complets, Approved puis Request en tête (NetworkMessageManager).
 * Vérifié le 17 nov. 2026 sur les empreintes XXH32 envoyées par le jeu.
 */
export const MESSAGE_TYPES = ['ConnectionApproved', 'ConnectionRequest', 'AnticipationCounterSyncPing',
  'AnticipationCounterSyncPong', 'ChangeOwnership', 'ClientConnected', 'ClientDisconnected', 'ClientRpc', 'CreateObject',
  'DestroyObject', 'DisconnectReason', 'Named', 'NetworkTransform', 'NetworkVariableDelta', 'ParentSync', 'Proxy', 'Rpc',
  'SceneEvent', 'ServerLog', 'ServerRpc', 'TimeSync', 'Unnamed'] as const;
export type MessageName = (typeof MESSAGE_TYPES)[number];
export const MESSAGE_TYPE = Object.fromEntries(MESSAGE_TYPES.map((n, i) => [n, i])) as Record<MessageName, number>;
export const messageName = (type: number): string => MESSAGE_TYPES[type] ?? `?${type}`;

export interface NgoMessage { type: number; payload: Uint8Array }

// ---------------------------------------------------------------- XXH64 (XXHash.Hash64, graine 0)
const M64 = (1n << 64n) - 1n;
const P1 = 11400714785074694791n, P2 = 14029467366897019727n, P3 = 1609587929392839161n, P4 = 9650029242287828579n,
  P5 = 2870177450012600261n;
const rotl = (x: bigint, r: number) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M64;
const round = (acc: bigint, v: bigint) => (rotl((acc + v * P2) & M64, 31) * P1) & M64;
const merge = (acc: bigint, v: bigint) => (((acc ^ round(0n, v)) * P1) + P4) & M64;

export function xxh64(data: Uint8Array): bigint {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let i = 0, h: bigint;
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

// ---------------------------------------------------------------- compactage (BytePacker / ByteUnpacker)
/** Nombre d'octets utilisés par x (au moins 1), comme BitCounter.GetUsedByteCount. */
function usedBytes(x: bigint): number { let n = 1; while (x >> BigInt(8 * n) !== 0n) n++; return n; }
/** Écrit (x | n) sur n octets, petit-boutiste, n = octets utilisés par x (x déjà décalé). */
function partial(x: bigint): Buffer {
  const n = usedBytes(x), v = x | BigInt(n), b = Buffer.alloc(n);
  for (let k = 0; k < n; k++) b[k] = Number((v >> BigInt(8 * k)) & 0xffn);
  return b;
}
function readPartial(buf: Uint8Array, off: number, n: number): bigint {
  if (off + n > buf.length) throw new RangeError('entier compacté tronqué');
  let x = 0n;
  for (let k = 0; k < n; k++) x |= BigInt(buf[off + k]) << BigInt(8 * k);
  return x;
}
export interface Read<T> { value: T; next: number }

/** uint : (v << 3) | nbOctets ; au-delà de 2^29 - 1 : 0x05 puis 4 octets. */
export function packUInt(v: number): Buffer {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError(`uint invalide : ${v}`);
  if (v > 536870911) { const b = Buffer.alloc(5); b[0] = 5; b.writeUInt32LE(v, 1); return b; }
  return partial(BigInt(v) << 3n);
}
export function readUInt(buf: Uint8Array, off: number): Read<number> {
  const n = buf[off] & 7;
  if (n === 5) return { value: Number(readPartial(buf, off + 1, 4)), next: off + 5 };
  return { value: Number(readPartial(buf, off, n) >> 3n), next: off + n };
}
/** ushort : (v << 2) | nbOctets ; au-delà de 16383 : 0x03 puis 2 octets. */
export function packUShort(v: number): Buffer {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new RangeError(`ushort invalide : ${v}`);
  if (v > 16383) { const b = Buffer.alloc(3); b[0] = 3; b.writeUInt16LE(v, 1); return b; }
  return partial(BigInt(v) << 2n);
}
export function readUShort(buf: Uint8Array, off: number): Read<number> {
  const n = buf[off] & 3;
  if (n === 3) return { value: Number(readPartial(buf, off + 1, 2)), next: off + 3 };
  return { value: Number(readPartial(buf, off, n) >> 2n), next: off + n };
}
/** ulong : (v << 4) | nbOctets ; au-delà de 2^60 - 1 : 0x09 puis 8 octets. */
export function packULong(v: number | bigint): Buffer {
  const x = BigInt(v);
  if (x < 0n || x > M64) throw new RangeError(`ulong invalide : ${v}`);
  if (x > 0x0fffffffffffffffn) { const b = Buffer.alloc(9); b[0] = 9; b.writeBigUInt64LE(x, 1); return b; }
  return partial(x << 4n);
}
/** Lecture d'un ulong compacté : nombre quand il tient sans perte, sinon bigint. */
export function readULong(buf: Uint8Array, off: number): Read<number | bigint> {
  const n = buf[off] & 15;
  const x = n === 9 ? readPartial(buf, off + 1, 8) : readPartial(buf, off, n) >> 4n;
  return { value: x <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x, next: off + (n === 9 ? 9 : n) };
}
export const zigzag = (v: number): number => ((v << 1) ^ (v >> 31)) >>> 0;
export const unzigzag = (u: number): number => (u >>> 1) ^ -(u & 1);
export const packInt = (v: number): Buffer => {
  if (!Number.isInteger(v) || v < -0x80000000 || v > 0x7fffffff) throw new RangeError(`int invalide : ${v}`);
  return packUInt(zigzag(v));
};
export function readInt(buf: Uint8Array, off: number): Read<number> {
  const r = readUInt(buf, off);
  return { value: unzigzag(r.value), next: r.next };
}

// ---------------------------------------------------------------- lots (NetworkBatchHeader + NetworkMessageHeader)
export const BATCH_MAGIC = 4448;

/** Construit un lot NGO (en-tête, empreinte XXH64) à partir de messages déjà encodés. */
export function buildBatch(messages: NgoMessage[]): Uint8Array {
  const corps = Buffer.concat(messages.flatMap(({ type, payload }) => [packUInt(type), packUInt(payload.length), payload]));
  const h = Buffer.alloc(16);
  h.writeUInt16LE(BATCH_MAGIC, 0); h.writeUInt16LE(messages.length, 2); h.writeInt32LE(16 + corps.length, 4);
  h.writeBigUInt64LE(xxh64(corps), 8);
  return Buffer.concat([h, corps]);
}

export interface BatchInspection {
  error?: string; count: number; sizeOk: boolean; hashOk: boolean; messages: NgoMessage[];
  /** Octets restant après le dernier des `count` messages (NGO les ignore sans erreur : HandleIncomingData). */
  trailing: number;
}
/** Décode un lot sans lever d'erreur : en-tête, taille, empreinte, messages lus et octets en trop. */
export function inspectBatch(batch: Uint8Array): BatchInspection {
  const b = Buffer.from(batch.buffer, batch.byteOffset, batch.byteLength);
  if (b.length < 16 || b.readUInt16LE(0) !== BATCH_MAGIC) return { error: 'pas un lot NGO', count: 0, sizeOk: false, hashOk: false, messages: [], trailing: 0 };
  const count = b.readUInt16LE(2), taille = b.readInt32LE(4), empreinte = b.readBigUInt64LE(8);
  const messages: NgoMessage[] = [];
  let o = 16, error: string | undefined;
  try {
    for (let k = 0; k < count; k++) {
      if (o >= b.length) { error = 'lot tronqué'; break; }
      const t = readUInt(b, o), s = readUInt(b, t.next);
      if (s.next + s.value > b.length) { error = 'message tronqué'; break; }
      messages.push({ type: t.value, payload: b.subarray(s.next, s.next + s.value) });
      o = s.next + s.value;
    }
  } catch (e) { error = (e as Error).message; }
  return { error, count, sizeOk: taille === b.length, hashOk: xxh64(b.subarray(16)) === empreinte, messages, trailing: error ? 0 : b.length - o };
}

/**
 * Décode un lot NGO reçu ; lève une erreur si l'en-tête, la taille, l'empreinte ou un message ne vont pas. Comme NGO
 * (NetworkMessageManager.HandleIncomingData), les octets après le dernier message sont ignorés : `inspectBatch` les
 * compte (`trailing`) pour le journal.
 */
export function parseBatch(batch: Uint8Array): NgoMessage[] { return checkedMessages(inspectBatch(batch)); }
function checkedMessages(d: BatchInspection): NgoMessage[] {
  if (d.error) throw new Error(`lot NGO invalide : ${d.error}`);
  if (!d.sizeOk) throw new Error('lot NGO invalide : taille fausse');
  if (!d.hashOk) throw new Error('lot NGO invalide : empreinte XXH64 fausse');
  return d.messages;
}

// ---------------------------------------------------------------- demande de connexion (ConnectionRequestMessage)
export interface MessageVersion { hash: string; version: number }
export interface Handshake {
  gameVersion: string;
  capturedAt: string;
  messageType: number;
  configHash: string;
  versions: MessageVersion[];
  connectionData: string;
  payloadHex: string;
  styles: Record<string, string>;
  unity: { projectId: string; environment: string; authUrl: string; relayUrl: string };
}
export const HANDSHAKE = handshakeJson as Handshake;

export interface ConnectionRequestInfo {
  versions: MessageVersion[]; configHash: string; connectionData: string | null;
  /**
   * Octets inconnus entre le ConfigHash et les données de connexion (champ ajouté par une autre version de NGO),
   * en hexadécimal. Absent pour OPTCGSim 1.45a. Recopiés tels quels par `encodeConnectionRequest`.
   */
  extraHex?: string;
  /** Octets inconnus après les données de connexion, en hexadécimal (recopiés tels quels). Absent en 1.45a. */
  trailingHex?: string;
}

/** Données de connexion plausibles : « <version><style> » en ASCII imprimable (« 1.45aPrivate »). */
const CONNECTION_DATA = /^[0-9]+\.[0-9]+[0-9A-Za-z.]*$/;
const MAX_CONNECTION_DATA = 64;
function readConnectionData(c: Buffer, o: number): { text: string; end: number } | null {
  if (o + 4 > c.length) return null;
  const l = c.readInt32LE(o);
  if (l <= 0 || l > MAX_CONNECTION_DATA || o + 4 + l > c.length) return null;
  const text = c.subarray(o + 4, o + 4 + l).toString('latin1');
  return CONNECTION_DATA.test(text) ? { text, end: o + 4 + l } : null;
}

/**
 * Décode une ConnectionRequestMessage (pour la capture et les vérifications). En-tête figé par NGO (« forbidden
 * segment ») : nombre de versions, versions (empreinte uint32, version compactée), puis ConfigHash (ulong), puis les
 * données de connexion (int32 longueur + octets). Tolérant : si les données de connexion ne suivent pas directement
 * le ConfigHash, on les cherche plus loin (octets intercalés dans `extraHex`) ; ce qui suit va dans `trailingHex`.
 */
export function decodeConnectionRequest(payload: Uint8Array): ConnectionRequestInfo {
  const c = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const versions: MessageVersion[] = [];
  let o = 0;
  const n = readInt(c, o); o = n.next;
  if (n.value < 0 || n.value > 1024) throw new RangeError(`nombre de versions invalide : ${n.value}`);
  for (let k = 0; k < n.value; k++) {
    if (o + 4 > c.length) throw new RangeError('demande de connexion tronquée (versions)');
    const hash = c.readUInt32LE(o); o += 4;
    const v = readInt(c, o); o = v.next;
    versions.push({ hash: hash.toString(16), version: v.value });
  }
  if (o + 8 > c.length) throw new RangeError('demande de connexion tronquée (ConfigHash)');
  const configHash = c.readBigUInt64LE(o).toString(16); o += 8;
  const info: ConnectionRequestInfo = { versions, configHash, connectionData: null };
  if (o >= c.length) return info;
  // Cas 1.45a : la chaîne suit directement. Sinon, première chaîne plausible plus loin.
  let at = o, found = readConnectionData(c, o);
  for (let i = o + 1; !found && i + 4 <= c.length; i++) { found = readConnectionData(c, i); if (found) at = i; }
  if (!found) { info.trailingHex = c.subarray(o).toString('hex'); return info; }
  if (at > o) info.extraHex = c.subarray(o, at).toString('hex');
  info.connectionData = found.text;
  if (found.end < c.length) info.trailingHex = c.subarray(found.end).toString('hex');
  return info;
}

/** Encode une ConnectionRequestMessage (inverse exact de decodeConnectionRequest). */
export function encodeConnectionRequest(info: ConnectionRequestInfo): Buffer {
  const parts: Buffer[] = [packInt(info.versions.length)];
  for (const v of info.versions) {
    const h = Buffer.alloc(4); h.writeUInt32LE(parseInt(v.hash, 16) >>> 0); parts.push(h, packInt(v.version));
  }
  const ch = Buffer.alloc(8); ch.writeBigUInt64LE(BigInt('0x' + info.configHash)); parts.push(ch);
  if (info.extraHex) parts.push(Buffer.from(info.extraHex, 'hex'));
  if (info.connectionData != null) {
    const d = Buffer.from(info.connectionData, 'latin1'), l = Buffer.alloc(4); l.writeInt32LE(d.length); parts.push(l, d);
  }
  if (info.trailingHex) parts.push(Buffer.from(info.trailingHex, 'hex'));
  return Buffer.concat(parts);
}

/**
 * Demande de connexion du jeu, rejouée depuis handshake.json, avec les données de connexion
 * « <version><style> » de la salle visée (le jeu refuse un style différent du sien).
 */
export function connectionRequest(style: string, handshake: Handshake = HANDSHAKE): NgoMessage {
  const info = decodeConnectionRequest(Buffer.from(handshake.payloadHex, 'hex'));
  if (info.connectionData == null) throw new Error('handshake.json : données de connexion introuvables dans la demande capturée (relance capturer.mjs)');
  return { type: handshake.messageType, payload: encodeConnectionRequest({ ...info, connectionData: handshake.gameVersion + style }) };
}

// ---------------------------------------------------------------- client connecté, synchro de scène
/** ClientConnectedMessage : l'identifiant client attribué par l'hôte (ulong compacté en tête). */
export function readClientConnected(payload: Uint8Array): number {
  return Number(readULong(payload, 0).value);
}

export interface PlayerObject { id: number; owner: number }
export interface SceneSync { sceneHash: number; sceneHandle: number; objectCount: number; prefab: string; objects: PlayerObject[] }

/** Synchronisation de scène (SceneEventData, type Synchronize) : la scène et les objets joueurs. null sinon. */
export function readSceneSync(payload: Uint8Array): SceneSync | null {
  const c = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (c.length < 30 || c[0] !== 2) return null;
  const sceneHash = c.readUInt32LE(6), sceneHandle = c.readInt32LE(10);
  let o = 18; // type, mode, mode de synchro (int), empreinte, handle, empreinte de la scène active
  const nbScenes = c.readInt32LE(o); o += 4 + 4 * nbScenes;
  const nbHandles = c.readInt32LE(o); o += 4 + 4 * nbHandles;
  o += 4; const objectCount = c.readInt32LE(o); o += 4;
  // Objet n°1 : champ de bits, empreinte du préfabriqué, id, propriétaire. Les autres joueurs ont la même empreinte.
  const prefab = c.subarray(o + 1, o + 5), objects: PlayerObject[] = [];
  for (let i = o; i + 5 < c.length; i++) {
    if (!c.subarray(i + 1, i + 5).equals(prefab)) continue;
    const id = readULong(c, i + 5), owner = readULong(c, id.next);
    objects.push({ id: Number(id.value), owner: Number(owner.value) });
  }
  return { sceneHash, sceneHandle, objectCount, prefab: prefab.toString('hex'), objects };
}

/** SceneEvent « SynchronizeComplete » : mode 0, Guid nul, scène, liste des objets synchronisés. */
export function synchronizeComplete(sync: SceneSync, ids: number[] = sync.objects.map((o) => o.id)): NgoMessage {
  const b = Buffer.alloc(2 + 16 + 4 + 4 + 4 + 4 * ids.length);
  b[0] = 8;
  b.writeUInt32LE(sync.sceneHash, 18); b.writeInt32LE(sync.sceneHandle, 22); b.writeUInt32LE(ids.length, 26);
  ids.forEach((id, k) => b.writeUInt32LE(id, 30 + 4 * k));
  return { type: MESSAGE_TYPE.SceneEvent, payload: b };
}

// ---------------------------------------------------------------- client NGO au-dessus d'un transport
export interface NetcodeReady { clientId: number; sync: SceneSync; playerObject: number }

/**
 * Le côté « joueur qui rejoint » de NGO : envoie la demande de connexion, repère l'identifiant client et la synchro
 * de scène, puis signale qu'on peut terminer la synchro et se mettre en place (`completeSync`).
 */
export class NetcodeClient {
  readonly transport: Transport;
  clientId: number | null = null;
  sync: SceneSync | null = null;
  private readyHandlers: ((r: NetcodeReady) => void)[] = [];
  private messageHandlers: ((m: NgoMessage, canal: string) => void)[] = [];
  private warningHandlers: ((w: string) => void)[] = [];
  private readyFired = false;

  constructor(transport: Transport) {
    this.transport = transport;
    transport.onData((lot, canal) => this.receive(lot, canal ?? 'fiable'));
  }

  /** Envoie la demande de connexion pour une salle du style donné (« Private », « Western »...). */
  start(style: string, handshake: Handshake = HANDSHAKE): void { this.send([connectionRequest(style, handshake)]); }

  send(messages: NgoMessage[]): void { this.transport.send(buildBatch(messages)); }
  onMessage(h: (m: NgoMessage, canal: string) => void): void { this.messageHandlers.push(h); }
  onReady(h: (r: NetcodeReady) => void): void { this.readyHandlers.push(h); }
  /** Anomalies tolérées (octets en trop après le dernier message d'un lot, ignorés comme le fait NGO). */
  onWarning(h: (w: string) => void): void { this.warningHandlers.push(h); }

  /** Termine la synchro de scène ; les messages donnés partent dans le même lot (mise en place du prototype). */
  completeSync(extra: NgoMessage[] = []): void {
    if (!this.sync) throw new Error('pas encore de synchro de scène');
    this.send([synchronizeComplete(this.sync), ...extra]);
  }

  private receive(lot: Uint8Array, canal: string): void {
    const d = inspectBatch(lot), messages = checkedMessages(d), reste = d.trailing;
    if (reste) for (const h of this.warningHandlers) h(`lot ${canal} : ${reste} octet(s) en trop après le dernier message, ignorés`);
    for (const m of messages) {
      if (m.type === MESSAGE_TYPE.ClientConnected && this.clientId == null) this.clientId = readClientConnected(m.payload);
      if (m.type === MESSAGE_TYPE.SceneEvent && !this.sync) this.sync = readSceneSync(m.payload);
    }
    if (!this.readyFired && this.clientId != null && this.sync) {
      const mine = this.sync.objects.find((o) => o.owner === this.clientId);
      if (mine) {
        this.readyFired = true;
        for (const h of this.readyHandlers) h({ clientId: this.clientId, sync: this.sync, playerObject: mine.id });
      }
    }
    for (const m of messages) for (const h of this.messageHandlers) h(m, canal);
  }
}
