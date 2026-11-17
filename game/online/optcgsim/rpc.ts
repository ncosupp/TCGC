// Encodage et décodage génériques des RPC d'OPTCGSim d'après le catalogue (catalog.json, régénéré par
// scripts/optcgsim/catalogue.mjs). Une RPC est la charge d'un message NGO ClientRpc (hôte → clients) ou ServerRpc
// (client → hôte) : objet réseau (ulong compacté), comportement (ushort compacté), empreinte (uint compacté), puis
// les paramètres dans l'ordre exact des écritures générées par ILPP. decode puis encode redonne les mêmes octets.

import { Buffer } from 'node:buffer';
import catalogJson from './catalog.json' with { type: 'json' };
import {
  MESSAGE_TYPE, packInt, packUInt, packULong, packUShort, readInt, readUInt, readULong, readUShort, type NgoMessage,
} from './netcode.ts';
import type { Rpc } from './types.ts';

export interface CatalogWrite { param: string; type: string; codage: string; nullable?: boolean; forme?: string }
export interface CatalogEntry { nom: string; sens: 'client->hote' | 'hote->clients'; ecritures: CatalogWrite[] }
export type Catalog = Record<string, CatalogEntry>;

export const CATALOG = catalogJson as unknown as Catalog;
const HASH_BY_NAME = new Map<string, number>(Object.entries(CATALOG).map(([h, d]) => [d.nom, Number(h)]));

/** Champ des valeurs qui garde, en hexadécimal, les octets que le catalogue ne sait pas lire (aller-retour exact). */
export const REST = '$reste';
/** clientId « tous les clients » (ulong maximal). */
export const ALL_CLIENTS = (1n << 64n) - 1n;

export const rpcHash = (name: string): number | undefined => HASH_BY_NAME.get(name);
export const rpcEntry = (name: string): CatalogEntry | undefined => {
  const h = HASH_BY_NAME.get(name); return h == null ? undefined : CATALOG[String(h)];
};

// ---------------------------------------------------------------- structures sérialisées
// Champs des structures passées en paramètre (code décompilé : ActionStepResolver.cs, TransferAction.cs).
type Field = [name: string, kind: 'int32' | 'bool'];
const STRUCTS: Record<string, Field[]> = {
  ActionStepResolver: [['iActorID', 'int32'], ['iActionIdx', 'int32'], ['iStepIdx', 'int32']],
  TransferAction: [['iOwner', 'int32'], ['iLocation', 'int32'], ['iCard', 'int32'], ['iAction', 'int32'],
    ['iTarget', 'int32'], ['iSaveTarget', 'int32'], ['eRemoval', 'int32'], ['iRemovalPlayer', 'int32'],
    ['iStackIdx', 'int32'], ['iStepIdx', 'int32'], ['iPrevTarget', 'int32'], ['bFree', 'bool'], ['bTriggerOffer', 'bool']],
};
const structSize = (f: Field[]) => f.reduce((s, [, k]) => s + (k === 'bool' ? 1 : 4), 0);
function readStruct(p: Buffer, o: number, fields: Field[]): Record<string, number | boolean> {
  const v: Record<string, number | boolean> = {};
  for (const [n, k] of fields) { if (k === 'bool') v[n] = p[o++] === 1; else { v[n] = p.readInt32LE(o); o += 4; } }
  return v;
}
function writeStruct(v: Record<string, unknown>, fields: Field[], ctx: string): Buffer {
  const b = Buffer.alloc(structSize(fields)); let o = 0;
  for (const [n, k] of fields) {
    const x = v?.[n];
    if (k === 'bool') { if (typeof x !== 'boolean') throw new TypeError(`${ctx}.${n} : booléen attendu`); b[o++] = x ? 1 : 0; }
    else { if (!Number.isInteger(x)) throw new TypeError(`${ctx}.${n} : entier attendu`); b.writeInt32LE(x as number, o); o += 4; }
  }
  return b;
}
const elementType = (t: string) => t.replace(/\[\]$/, '');

// ---------------------------------------------------------------- paramètres
function readParams(def: CatalogEntry, p: Buffer): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  let o = 0;
  for (const e of def.ecritures) {
    const debut = o;
    if (e.nullable) {
      const present = p[o++];
      if (present === 0) { v[e.param] = null; continue; }
      if (present !== 1) { o = debut; break; }
    }
    let lu = true;
    try {
      switch (e.codage) {
        case 'chaine': {
          const l = p.readUInt32LE(o); o += 4;
          if (o + 2 * l > p.length) throw new RangeError('chaîne tronquée');
          v[e.param] = p.subarray(o, o + 2 * l).toString('utf16le'); o += 2 * l; break;
        }
        case 'int-compacte': { const r = readInt(p, o); v[e.param] = r.value; o = r.next; break; }
        case 'uint-compacte': { const r = readUInt(p, o); v[e.param] = r.value; o = r.next; break; }
        case 'ulong-compacte': { const r = readULong(p, o); v[e.param] = r.value; o = r.next; break; }
        case 'bool': { const x = p[o++]; if (x > 1) { o = debut; lu = false; break; } v[e.param] = x === 1; break; }
        case 'float': v[e.param] = p.readFloatLE(o); o += 4; break;
        case 'enum': v[e.param] = p.readInt32LE(o); o += 4; break;
        case 'tableau': {
          const fields = STRUCTS[elementType(e.type)];
          if (!fields) { o = debut; lu = false; break; }
          const n = p.readInt32LE(o); o += 4;
          if (n < 0 || o + n * structSize(fields) > p.length) throw new RangeError('tableau tronqué');
          const arr = [];
          for (let k = 0; k < n; k++) { arr.push(readStruct(p, o, fields)); o += structSize(fields); }
          v[e.param] = arr; break;
        }
        default: {
          const fields = e.codage.startsWith('brut-') ? STRUCTS[e.type] : undefined;
          if (!fields) { o = debut; lu = false; break; }
          if (o + structSize(fields) > p.length) throw new RangeError('structure tronquée');
          v[e.param] = readStruct(p, o, fields); o += structSize(fields); break;
        }
      }
      if (o > p.length) throw new RangeError(`paramètre ${e.param} tronqué`);
    } catch { delete v[e.param]; o = debut; lu = false; } // illisible : la suite part brute dans $reste
    if (!lu) break;
  }
  if (o < p.length) v[REST] = p.subarray(o).toString('hex');
  return v;
}

function writeParams(def: CatalogEntry, values: Record<string, unknown>): Buffer {
  const out: Buffer[] = [];
  for (const e of def.ecritures) {
    if (!(e.param in values)) {
      if (REST in values) break; // le reste brut reprend à partir d'ici
      throw new TypeError(`${def.nom} : paramètre manquant ${e.param}`);
    }
    const x = values[e.param], ctx = `${def.nom}.${e.param}`;
    if (e.nullable) {
      if (x == null) { out.push(Buffer.from([0])); continue; }
      out.push(Buffer.from([1]));
    } else if (x == null) throw new TypeError(`${ctx} : valeur nulle interdite`);
    switch (e.codage) {
      case 'chaine': {
        if (typeof x !== 'string') throw new TypeError(`${ctx} : chaîne attendue`);
        const l = Buffer.alloc(4); l.writeUInt32LE(x.length); out.push(l, Buffer.from(x, 'utf16le')); break;
      }
      case 'int-compacte': out.push(packInt(x as number)); break;
      case 'uint-compacte': out.push(packUInt(x as number)); break;
      case 'ulong-compacte': {
        // nombre, bigint, ou chaîne décimale (une valeur décodée passée par JSON.stringify)
        if (typeof x === 'string' && !/^\d+$/.test(x)) throw new TypeError(`${ctx} : ulong attendu`);
        out.push(packULong(typeof x === 'string' ? BigInt(x) : x as number | bigint)); break;
      }
      case 'bool': if (typeof x !== 'boolean') throw new TypeError(`${ctx} : booléen attendu`); out.push(Buffer.from([x ? 1 : 0])); break;
      case 'float': { if (typeof x !== 'number') throw new TypeError(`${ctx} : nombre attendu`); const b = Buffer.alloc(4); b.writeFloatLE(x); out.push(b); break; }
      case 'enum': { if (!Number.isInteger(x)) throw new TypeError(`${ctx} : entier attendu`); const b = Buffer.alloc(4); b.writeInt32LE(x as number); out.push(b); break; }
      case 'tableau': {
        const fields = STRUCTS[elementType(e.type)];
        if (!fields || !Array.isArray(x)) throw new TypeError(`${ctx} : tableau de ${e.type} non encodable`);
        const n = Buffer.alloc(4); n.writeInt32LE(x.length); out.push(n);
        x.forEach((el, k) => out.push(writeStruct(el as Record<string, unknown>, fields, `${ctx}[${k}]`)));
        break;
      }
      default: {
        const fields = e.codage.startsWith('brut-') ? STRUCTS[e.type] : undefined;
        if (!fields) throw new TypeError(`${ctx} : codage ${e.codage} non encodable`);
        out.push(writeStruct(x as Record<string, unknown>, fields, ctx));
      }
    }
  }
  if (typeof values[REST] === 'string') out.push(Buffer.from(values[REST] as string, 'hex'));
  return Buffer.concat(out);
}

// ---------------------------------------------------------------- API
export interface RpcTarget { object?: number; behaviour?: number }

/**
 * Encode la charge d'une RPC (en-tête objet / comportement / empreinte, puis paramètres). `values` porte un champ
 * par paramètre du catalogue (null pour une chaîne ou un tableau absent). L'objet réseau est celui du joueur visé.
 */
export function encode(name: string, values: Record<string, unknown>, target: RpcTarget = {}): Uint8Array {
  const hash = HASH_BY_NAME.get(name) ?? (/^\?(\d+)$/.test(name) ? Number(name.slice(1)) : undefined);
  if (hash == null) throw new Error(`RPC inconnue du catalogue : ${name}`);
  const def = CATALOG[String(hash)] ?? { nom: name, sens: 'client->hote', ecritures: [] };
  return Buffer.concat([packULong(target.object ?? 0), packUShort(target.behaviour ?? 0), packUInt(hash), writeParams(def, values)]);
}

/** Décode la charge d'une RPC. Une empreinte inconnue donne le nom « ?<empreinte> » et ses octets dans `$reste`. */
export function decode(bytes: Uint8Array): Rpc {
  const c = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = readULong(c, 0), b = readUShort(c, o.next), h = readUInt(c, b.next);
  const def = CATALOG[String(h.value)];
  const params = c.subarray(h.next);
  const values = def ? readParams(def, params) : (params.length ? { [REST]: params.toString('hex') } : {});
  return { name: def?.nom ?? `?${h.value}`, object: Number(o.value), behaviour: b.value, values };
}

/** Réencode une RPC décodée. */
export const encodeRpc = (rpc: Rpc): Uint8Array => encode(rpc.name, rpc.values, rpc);

/** Le message NGO qui porte la RPC : ServerRpc pour « …ServerRpc », ClientRpc sinon. */
export function rpcMessage(name: string, values: Record<string, unknown>, target: RpcTarget = {}): NgoMessage {
  const type = name.endsWith('ServerRpc') ? MESSAGE_TYPE.ServerRpc : MESSAGE_TYPE.ClientRpc;
  return { type, payload: encode(name, values, target) };
}
