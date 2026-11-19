// Transport d'OPTCGSim (1.45a puis 1.45b), tel que décompilé depuis les DLL du jeu et validé par le prototype `optcg-proto.mjs`
// (17 nov. 2026) : identification anonyme Unity (REST) > Unity Relay (UDP : liaison HMAC, ConnectRequest, Ping,
// Relay) > SimpleConnectionLayer (poignée de main 0x01505455, MTU, battements, déconnexion) > pipeline fiable
// (fenêtre 64, accusés, renvois) et non fiable > flux de lots NGO (int32 longueur + octets, découpé à 1000 octets).
//
// `connect(code)` rejoint une salle hébergée par le jeu ; `host()` en crée une (pour la capture de la demande de
// connexion). Le réseau est injectable : `fetch` pour le REST, `udp` pour les datagrammes. Les tests passent un faux
// transport et ne contactent jamais Unity.

import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import handshakeJson from './handshake.json' with { type: 'json' };

export type Channel = 'fiable' | 'non fiable' | 'non fiable séquencé';

/** Une connexion établie avec le jeu : on y envoie et on en reçoit des lots NGO complets. */
export interface Transport {
  /** Envoie un lot NGO sur le canal fiable (découpé et renvoyé au besoin). */
  send(data: Uint8Array): void;
  /** Chaque lot NGO recomposé, dans l'ordre, avec son canal. */
  onData(handler: (data: Uint8Array, channel?: Channel) => void): void;
  close(): void;
  /** Fin de la connexion (déconnexion demandée par le jeu, pair parti, ou close()). */
  onClose?(handler: (reason: string) => void): void;
  /** Identifiant du joueur Unity anonyme utilisé pour cette connexion. */
  readonly userId?: string;
}

// ---------------------------------------------------------------- réseau injectable
export interface UdpSocket {
  send(data: Uint8Array, port: number, address: string): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  bind(ready: () => void): void;
  close(): void;
}
export type UdpFactory = () => UdpSocket;
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// Garde-fou des tests (incident de la vague O1 : un test a contacté Unity) : sous `node --test`, ni vrai UDP ni vrai
// fetch, quel que soit le chemin (connect, host, authenticate, nodeUdp appelé directement).
const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT);
const NO_NETWORK = 'réseau réel interdit pendant les tests : injecte fetch et udp (faux transport)';

export const nodeUdp: UdpFactory = () => {
  if (underTest()) throw new Error(NO_NETWORK);
  const s = dgram.createSocket('udp4');
  return {
    send: (data, port, address) => s.send(data, port, address),
    onMessage: (h) => { s.on('message', (b) => h(b)); },
    bind: (ready) => s.bind(0, ready),
    close: () => { try { s.close(); } catch { /* déjà fermée */ } },
  };
};

export interface Intervals {
  /** Battement SimpleConnection et examen des renvois (prototype : 250 ms). */
  heartbeat: number;
  /** Délai avant de renvoyer un paquet fiable non acquitté (200 ms). */
  retransmit: number;
  /** Ping Relay une fois lié, nouvelle liaison sinon (1000 ms). */
  ping: number;
  /** Nouvelle tentative de ConnectRequest ou de poignée de main (500 ms). */
  retry: number;
  /** Sans aucun paquet de l'autre pair pendant ce temps, la connexion est tenue pour perdue (30 s, comme UTP). */
  idle: number;
}
export const DEFAULT_INTERVALS: Intervals = { heartbeat: 250, retransmit: 200, ping: 1000, retry: 500, idle: 30000 };

export interface UnityConfig { projectId: string; environment: string; authUrl: string; relayUrl: string }
export const UNITY: UnityConfig = (handshakeJson as { unity: UnityConfig }).unity;
const STYLES: Record<string, string> = (handshakeJson as { styles: Record<string, string> }).styles;

export interface TransportOptions {
  fetch?: FetchLike;
  udp?: UdpFactory;
  unity?: UnityConfig;
  intervals?: Partial<Intervals>;
  /** Abandon si la connexion n'est pas établie à temps (30 s ; 8 s pour le repli de la file, tâche O4.2). */
  timeoutMs?: number;
  /**
   * Annulation (tâche O4.2) : tant que la connexion n'est pas établie, un abandon du signal arrête tout (UDP fermé,
   * relances arrêtées) et `connect` échoue tout de suite (« connexion annulée »), au lieu d'attendre `timeoutMs`.
   */
  signal?: AbortSignal;
  log?: (line: string) => void;
  randomBytes?: (n: number) => Uint8Array;
  /**
   * Chaque datagramme SimpleConnection échangé avec le jeu (sans l'en-tête Relay), pour le diagnostic : sert à
   * `capturer.mjs`, qui enregistre les octets bruts quand le format change d'une version du jeu à l'autre.
   */
  onPacket?: (direction: 'reçu' | 'envoyé', packet: Uint8Array) => void;
}

// ---------------------------------------------------------------- codes de salle
/** « P1A2B3C » → style de la salle (énumération MultiplayerStyle) et code Relay. */
export function parseRoomCode(code: string): { style: string; joinCode: string } {
  const c = code.trim().toUpperCase();
  const style = STYLES[c[0]];
  if (!style || c.length < 2) throw new Error(`Code de salle inconnu « ${code} » (préfixe attendu : ${Object.keys(STYLES).join(', ')}).`);
  return { style, joinCode: c.slice(1) };
}

// ---------------------------------------------------------------- services Unity (REST)
interface RawAllocation {
  allocationId: string; allocationIdBytes?: string; key: string; connectionData?: string; hostConnectionData?: string;
  relayServer: { ipV4: string; port: number };
}
export interface Allocation {
  allocationId: Buffer; key: Buffer; connectionData: Buffer; hostConnectionData: Buffer | null; ip: string; port: number;
  raw: RawAllocation;
}

async function call(f: FetchLike, url: string, method: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const r = await f(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const texte = await r.text();
  let json: unknown; try { json = JSON.parse(texte); } catch { json = texte; }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}
/** Identification anonyme Unity : { idToken, userId }. */
export async function authenticate(f: FetchLike, unity: UnityConfig = UNITY): Promise<{ idToken: string; userId: string }> {
  if (underTest() && (f as unknown) === globalThis.fetch) throw new Error(NO_NETWORK);
  const r = await call(f, `${unity.authUrl}/v1/authentication/anonymous`, 'POST',
    { ProjectId: unity.projectId, UnityEnvironment: unity.environment }, {});
  return { idToken: r.idToken, userId: r.userId };
}
const relayCall = (f: FetchLike, unity: UnityConfig, token: string, route: string, body: unknown) =>
  call(f, `${unity.relayUrl}${route}`, 'POST', { Authorization: `Bearer ${token}` }, body);

export function readAllocation(a: RawAllocation): Allocation {
  const id = a.allocationIdBytes ? Buffer.from(a.allocationIdBytes, 'base64') : Buffer.from(a.allocationId.replace(/-/g, ''), 'hex');
  const pad255 = (b64?: string) => { const out = Buffer.alloc(255); if (b64) Buffer.from(b64, 'base64').copy(out); return out; };
  return {
    allocationId: id, key: Buffer.from(a.key, 'base64'), connectionData: pad255(a.connectionData),
    hostConnectionData: a.hostConnectionData ? pad255(a.hostConnectionData) : null, ip: a.relayServer.ipV4, port: a.relayServer.port,
    raw: a,
  };
}

// ---------------------------------------------------------------- couche Relay (RelayMessage*)
export const RELAY = { Bind: 0, BindReceived: 1, Ping: 2, ConnectRequest: 3, Accepted: 6, Rejected: 8, Disconnect: 9, Relay: 10, Error: 12 } as const;
const relayHeader = (type: number) => Buffer.from([0xda, 0x72, 0x00, type]);

/** Liaison : en-tête, nonce, données de connexion (263 o), puis HMAC-SHA256 avec la clé de l'allocation (295 o). */
export function bindMessage(alloc: Allocation, nonce: number): Buffer {
  const corps = Buffer.concat([relayHeader(RELAY.Bind), Buffer.from([0, nonce & 0xff, (nonce >> 8) & 0xff, 0xff]), alloc.connectionData]);
  return Buffer.concat([corps, crypto.createHmac('sha256', alloc.key).update(corps).digest()]);
}
export function connectRequestMessage(alloc: Allocation): Buffer {
  if (!alloc.hostConnectionData) throw new Error('allocation sans hostConnectionData (pas une allocation de join)');
  return Buffer.concat([relayHeader(RELAY.ConnectRequest), alloc.allocationId, Buffer.from([0xff]), alloc.hostConnectionData]);
}
export const pingMessage = (alloc: Allocation) => Buffer.concat([relayHeader(RELAY.Ping), alloc.allocationId, Buffer.from([1, 0])]);
export function relayMessage(from: Uint8Array, to: Uint8Array, data: Uint8Array): Buffer {
  const l = Buffer.alloc(2); l.writeUInt16BE(data.length);
  return Buffer.concat([relayHeader(RELAY.Relay), from, to, l, data]);
}
export type RelayEvent =
  | { type: 'bound' } | { type: 'accepted'; from: Buffer } | { type: 'rejected' } | { type: 'disconnect'; from: Buffer }
  | { type: 'error'; code: number } | { type: 'data'; from: Buffer; data: Buffer };
export function parseRelayMessage(b: Buffer): RelayEvent | null {
  if (b.length < 4 || b[0] !== 0xda || b[1] !== 0x72) return null;
  switch (b[3]) {
    case RELAY.BindReceived: return { type: 'bound' };
    case RELAY.Accepted: return { type: 'accepted', from: Buffer.from(b.subarray(4, 20)) };
    case RELAY.Rejected: return { type: 'rejected' };
    case RELAY.Disconnect: return { type: 'disconnect', from: Buffer.from(b.subarray(4, 20)) };
    case RELAY.Error: return { type: 'error', code: b[20] };
    case RELAY.Relay: {
      const l = b.readUInt16BE(36);
      return { type: 'data', from: Buffer.from(b.subarray(4, 20)), data: Buffer.from(b.subarray(38, 38 + l)) };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- SimpleConnectionLayer
export const HANDSHAKE_SIGNATURE = Buffer.from([0x55, 0x54, 0x50, 0x01]); // 0x01505455 (LE), protocole v1
export const SC = { Data: 1, Disconnect: 2, Heartbeat: 3, MtuCheck: 4, MtuAck: 5 } as const;
const RELAY_PADDING = 38;
export const PIPE = { UNRELIABLE: 1, UNRELIABLE_SEQUENCED: 2, RELIABLE: 3 } as const;
export const STREAM_CHUNK = 1000;
export const RELIABLE_WINDOW = 64;
const M64 = (1n << 64n) - 1n;

/** Pipeline fiable (ReliableSequencedPipelineStage) : numéros, accusés (dernier + masque 64), renvois, ordre. */
export class Reliable {
  private next = 0;
  private pending = new Map<number, { payload: Buffer; sentAt: number }>();
  private waiting: Buffer[] = [];
  private lastReceived = -1;
  private mask = 0n;
  private delivered = -1;
  private outOfOrder = new Map<number, Buffer>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  private header(type: number, seq: number): Buffer {
    const h = Buffer.alloc(16);
    h.writeUInt16LE(type, 0); h.writeUInt16LE(0, 2); h.writeUInt16LE(seq & 0xffff, 4);
    h.writeUInt16LE(this.lastReceived & 0xffff, 6); h.writeBigUInt64LE(this.mask & M64, 8);
    return h;
  }
  private packet(seq: number, payload: Buffer) { return Buffer.concat([Buffer.from([PIPE.RELIABLE]), this.header(0, seq), payload]); }
  private take(payload: Buffer): Buffer {
    const seq = this.next++;
    this.pending.set(seq, { payload, sentAt: this.now() });
    return this.packet(seq, payload);
  }
  /**
   * Fenêtre : un numéro ne part que s'il reste à moins de 64 du plus ancien non acquitté (au-delà, le masque
   * d'accusés de l'autre pair ne le couvrirait plus et il le jetterait).
   */
  private canSend(): boolean {
    for (const seq of this.pending.keys()) return this.next - seq < RELIABLE_WINDOW; // Map : ordre d'insertion = plus ancien d'abord
    return true;
  }
  /** Paquets de données à envoyer tout de suite (hors fenêtre, le reste attend les accusés). */
  send(payload: Buffer): Buffer[] {
    if (!this.canSend() || this.waiting.length) { this.waiting.push(payload); return []; }
    return [this.take(payload)];
  }
  /** Paquets non acquittés depuis `delay` ms, plus ceux libérés par la fenêtre. */
  resend(delay: number): Buffer[] {
    const out: Buffer[] = [], t = this.now();
    for (const [seq, p] of this.pending) if (t - p.sentAt >= delay) { p.sentAt = t; out.push(this.packet(seq, p.payload)); }
    return out.concat(this.release());
  }
  private release(): Buffer[] {
    const out: Buffer[] = [];
    while (this.waiting.length && this.canSend()) out.push(this.take(this.waiting.shift()!));
    return out;
  }
  get inFlight(): number { return this.pending.size + this.waiting.length; }
  ack(): Buffer { return Buffer.concat([Buffer.from([PIPE.RELIABLE]), this.header(1, 0), Buffer.from([0])]); }
  private readAck(ack16: number, mask: bigint) {
    for (const seq of this.pending.keys()) {
      const d = (ack16 - (seq & 0xffff) + 0x10000) & 0xffff;
      if (d < 64 && ((mask >> BigInt(d)) & 1n)) this.pending.delete(seq);
    }
  }
  /**
   * Reçoit un paquet du pipeline fiable (sans l'octet de pipeline). null : simple accusé (ne pas y répondre) ;
   * sinon les charges livrables dans l'ordre (éventuellement aucune) et les paquets libérés par la fenêtre.
   */
  receive(p: Buffer): { delivered: Buffer[] | null; released: Buffer[] } {
    const type = p.readUInt16LE(0), seq16 = p.readUInt16LE(4), ack = p.readUInt16LE(6), mask = p.readBigUInt64LE(8);
    this.readAck(ack, mask);
    const released = this.release();
    if (type === 1) return { delivered: null, released };
    const base = this.lastReceived < 0 ? 0 : this.lastReceived;
    let seq = (base & ~0xffff) + seq16;
    if (seq < base - 0x8000) seq += 0x10000; else if (seq > base + 0x8000) seq -= 0x10000;
    if (seq > this.lastReceived) {
      this.mask = this.lastReceived < 0 ? 1n : (((this.mask << BigInt(seq - this.lastReceived)) | 1n) & M64);
      this.lastReceived = seq;
    } else {
      const d = this.lastReceived - seq;
      if (d >= 64 || ((this.mask >> BigInt(d)) & 1n)) return { delivered: [], released };
      this.mask |= 1n << BigInt(d);
    }
    if (seq <= this.delivered) return { delivered: [], released };
    this.outOfOrder.set(seq, Buffer.from(p.subarray(16)));
    const out: Buffer[] = [];
    while (this.outOfOrder.has(this.delivered + 1)) {
      this.delivered++; out.push(this.outOfOrder.get(this.delivered)!); this.outOfOrder.delete(this.delivered);
    }
    return { delivered: out, released };
  }
}

/** Flux de messages de UnityTransport (BatchedSendQueue / BatchedReceiveQueue) : int32 longueur + octets. */
export class Stream {
  private buffer = Buffer.alloc(0);
  push(b: Uint8Array): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, b]);
    const out: Buffer[] = [];
    while (this.buffer.length >= 4) {
      const n = this.buffer.readInt32LE(0);
      if (n < 0) { this.buffer = Buffer.alloc(0); throw new Error(`flux corrompu : longueur ${n}`); }
      if (this.buffer.length < 4 + n) break;
      out.push(Buffer.from(this.buffer.subarray(4, 4 + n))); this.buffer = this.buffer.subarray(4 + n);
    }
    return out;
  }
  get pending(): number { return this.buffer.length; }
}
export const frame = (lot: Uint8Array): Buffer => { const l = Buffer.alloc(4); l.writeInt32LE(lot.length); return Buffer.concat([l, lot]); };

// ---------------------------------------------------------------- session Relay (UDP)
/** Raisons de fin de connexion : celles qui contiennent LEFT disent que le jeu (l'autre joueur) est parti. */
export const LEFT = 'le jeu a quitté la salle';
export const LOST = 'connexion perdue : ni le jeu ni le serveur Relay ne répondent';

interface RelaySession {
  send(b: Buffer): void;
  close(): void;
  /** Le serveur Relay nous a envoyé quelque chose il y a moins de `ms` : notre réseau marche. */
  alive(ms: number): boolean;
}
function openRelaySession(alloc: Allocation, udp: UdpFactory, iv: Intervals, log: (l: string) => void,
  onEvent: (ev: RelayEvent, rebind: () => void) => void): RelaySession {
  const sock = udp();
  let nonce = 0, bound = false, closed = false, heard = 0;
  const send = (b: Buffer) => { if (!closed) sock.send(b, alloc.port, alloc.ip); };
  const bind = () => { send(bindMessage(alloc, nonce)); nonce = (nonce + 1) & 0xffff; };
  sock.onMessage((raw) => {
    heard = Date.now();
    const ev = parseRelayMessage(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength));
    if (!ev) return;
    // une nouvelle liaison (la sonde ci-dessous) ne refait pas la mise en place
    if (ev.type === 'bound') { if (bound) return; bound = true; log('Relay : liaison acceptée (BindReceived)'); }
    if (ev.type === 'error') { log(`Relay : erreur ${ev.code}`); if (ev.code === 3) bind(); }
    onEvent(ev, bind);
  });
  sock.bind(() => { log(`Relay : connexion UDP au serveur Relay`); bind(); });
  // Comme le transport de Unity (RelayLayer) : un ping régulier ; sans rien entendre pendant 3 pings, une nouvelle
  // liaison, à laquelle le serveur Relay répond (BindReceived). On sait ainsi, quand le jeu se tait, si c'est lui qui est
  // parti (le Relay nous répond encore) ou si c'est notre réseau qui est coupé.
  const timer = setInterval(() => {
    if (!bound) { bind(); return; }
    if (Date.now() - heard >= 3 * iv.ping) bind(); else send(pingMessage(alloc));
  }, iv.ping);
  return {
    send, alive: (ms) => heard > 0 && Date.now() - heard < ms,
    close: () => { if (closed) return; clearInterval(timer); closed = true; sock.close(); },
  };
}

// ---------------------------------------------------------------- pair SimpleConnection
interface Peer {
  handshake(type: number): void;
  sendBatch(lot: Uint8Array): void;
  receive(b: Buffer): { handshake: number; token: Buffer } | null;
  disconnect(): void;
  stop(): void;
}
function createPeer(o: {
  session: RelaySession; alloc: Allocation; other: () => Buffer; token: Buffer; iv: Intervals; log: (l: string) => void;
  onBatch: (lot: Buffer, channel: Channel) => void; onDisconnect: (reason: string) => void;
  onPacket?: TransportOptions['onPacket'];
}): Peer {
  const reliable = new Reliable(), stream = new Stream();
  let lastHeard = Date.now();
  const sendSC = (b: Buffer) => { o.onPacket?.('envoyé', b); o.session.send(relayMessage(o.alloc.allocationId, o.other(), b)); };
  const data = (payload: Buffer) => sendSC(Buffer.concat([Buffer.from([SC.Data]), o.token, payload]));
  const timer = setInterval(() => {
    // Le Disconnect part une seule fois et peut se perdre : le silence prolongé vaut déconnexion.
    // Si le serveur Relay nous répond encore, c'est le jeu qui est parti (partie quittée, jeu fermé) ; sinon, notre réseau.
    if (Date.now() - lastHeard > o.iv.idle) {
      o.onDisconnect(o.session.alive(5 * o.iv.ping) ? `${LEFT} (plus aucune nouvelle du jeu, le serveur Relay répond)` : LOST);
      return;
    }
    sendSC(Buffer.concat([Buffer.from([SC.Heartbeat]), o.token]));
    for (const p of reliable.resend(o.iv.retransmit)) data(p);
  }, o.iv.heartbeat);
  return {
    handshake(type) { sendSC(Buffer.concat([HANDSHAKE_SIGNATURE, Buffer.from([type]), o.token])); },
    sendBatch(lot) {
      // Flux fiable : le lot cadré peut être découpé sur plusieurs paquets (BatchedReceiveQueue le recompose).
      const f = frame(lot);
      for (let k = 0; k < f.length; k += STREAM_CHUNK) for (const p of reliable.send(f.subarray(k, k + STREAM_CHUNK))) data(p);
    },
    receive(b) {
      lastHeard = Date.now();
      o.onPacket?.('reçu', b);
      if (b.length >= 13 && b.subarray(0, 4).equals(HANDSHAKE_SIGNATURE)) return { handshake: b[4], token: Buffer.from(b.subarray(5, 13)) };
      const type = b[0], payload = b.subarray(9);
      if (type === SC.MtuCheck) {
        const size = payload.readUInt16LE(0) + 9 + RELAY_PADDING + 2, p = Buffer.alloc(4);
        p.writeUInt16LE(2, 0); p.writeUInt16LE(size, 2);
        sendSC(Buffer.concat([Buffer.from([SC.MtuAck]), o.token, p]));
      } else if (type === SC.Disconnect) { o.log('SimpleConnection : déconnexion demandée par l\'autre pair'); o.onDisconnect(`${LEFT} (déconnexion demandée par le jeu)`); }
      else if (type === SC.Data && payload.length) {
        const pipe = payload[0], rest = payload.subarray(1);
        if (pipe === PIPE.RELIABLE) {
          const r = reliable.receive(rest);
          for (const p of r.released) data(p);
          if (r.delivered === null) return null;
          data(reliable.ack());
          for (const chunk of r.delivered) for (const lot of stream.push(chunk)) o.onBatch(lot, 'fiable');
        } else if (pipe === PIPE.UNRELIABLE) {
          for (const lot of new Stream().push(rest.subarray(2))) o.onBatch(lot, 'non fiable');
        } else if (pipe === PIPE.UNRELIABLE_SEQUENCED) {
          for (const lot of new Stream().push(rest.subarray(4))) o.onBatch(lot, 'non fiable séquencé');
        } else o.log(`Pipeline inconnu ${pipe}`);
      }
      return null;
    },
    disconnect() { sendSC(Buffer.concat([Buffer.from([SC.Disconnect]), o.token])); },
    stop() { clearInterval(timer); },
  };
}

/** Assemble l'objet Transport autour d'un pair. */
function makeTransport(userId: string, close: (reason: string, notify: boolean) => void) {
  const dataHandlers: ((d: Uint8Array, c?: Channel) => void)[] = [];
  const closeHandlers: ((r: string) => void)[] = [];
  const early: [Buffer, Channel][] = [];
  let peer: Peer | null = null, closed = false;
  const t = {
    userId,
    send(d: Uint8Array) { if (closed) throw new Error('connexion fermée'); peer!.sendBatch(d); },
    onData(h: (d: Uint8Array, c?: Channel) => void) {
      dataHandlers.push(h);
      // Les lots arrivés avant le premier abonné (pendant la poignée de main) lui sont remis dans l'ordre.
      for (const [lot, c] of early.splice(0)) h(lot, c);
    },
    onClose(h: (r: string) => void) { closeHandlers.push(h); },
    close() { end('fermée par joy-boy', true); },
  };
  function end(reason: string, notify: boolean) {
    if (closed) return; closed = true;
    close(reason, notify);
    for (const h of closeHandlers) h(reason);
  }
  return {
    transport: t as Transport,
    setPeer: (p: Peer) => { peer = p; },
    emit: (lot: Buffer, c: Channel) => {
      if (closed) return;
      if (!dataHandlers.length) early.push([lot, c]); else for (const h of dataHandlers) h(lot, c);
    },
    end,
  };
}

function settings(opts: TransportOptions) {
  // Garde-fou : sous `node --test`, jamais de vrai réseau (les tests injectent un faux fetch et un faux UDP).
  if (underTest() && (!opts.fetch || !opts.udp || (opts.fetch as unknown) === globalThis.fetch || opts.udp === nodeUdp)) {
    throw new Error(NO_NETWORK);
  }
  return {
    f: opts.fetch ?? (globalThis.fetch as unknown as FetchLike), udp: opts.udp ?? nodeUdp, unity: opts.unity ?? UNITY,
    iv: { ...DEFAULT_INTERVALS, ...opts.intervals }, timeout: opts.timeoutMs ?? 30000, log: opts.log ?? (() => {}),
    random: opts.randomBytes ?? ((n: number) => crypto.randomBytes(n)), onPacket: opts.onPacket,
  };
}

// ---------------------------------------------------------------- rejoindre une salle hébergée par le jeu
/** Message d'erreur de `connect` quand `signal` a été abandonné avant la connexion. */
export const CANCELLED = 'connexion annulée';
/** Rejoint la salle OPTCGSim du code donné (« P1A2B3C »). Résout quand le jeu a accepté la SimpleConnection. */
export async function connect(code: string, opts: TransportOptions = {}): Promise<Transport> {
  const { f, udp, unity, iv, timeout, log, random, onPacket } = settings(opts);
  const { joinCode } = parseRoomCode(code);
  const signal = opts.signal;
  const cancelled = () => { if (signal?.aborted) throw new Error(CANCELLED); };
  cancelled();
  const { idToken, userId } = await authenticate(f, unity);
  cancelled();
  log('Identification anonyme OK');
  const { data: { allocation } } = await relayCall(f, unity, idToken, '/v1/join', { joinCode });
  cancelled();
  const alloc = readAllocation(allocation);
  const token = Buffer.from(random(8));
  return new Promise<Transport>((resolve, reject) => {
    let host: Buffer | null = null, peer: Peer | null = null, connected = false, session: RelaySession;
    const fail = (e: Error) => { cleanup(); reject(e); };
    const onAbort = () => { if (!connected) { log('Connexion annulée'); fail(new Error(CANCELLED)); } };
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => { clearInterval(retry); clearTimeout(deadline); signal?.removeEventListener('abort', onAbort); peer?.stop(); session.close(); };
    const t = makeTransport(userId, (reason, notify) => {
      log(`Connexion terminée : ${reason}`);
      if (notify) peer?.disconnect();
      cleanup();
    });
    const retry = setInterval(() => {
      if (!host) session.send(connectRequestMessage(alloc));
      else if (!connected) peer!.handshake(1);
    }, iv.retry);
    const deadline = setTimeout(() => { if (!connected) fail(new Error('le jeu n’a pas répondu à temps')); }, timeout);
    session = openRelaySession(alloc, udp, iv, log, (ev) => {
      if (ev.type === 'bound') session.send(connectRequestMessage(alloc));
      else if (ev.type === 'rejected') { if (!connected) fail(new Error('salle pleine ou fermée (Relay : Rejected)')); }
      else if (ev.type === 'disconnect') { if (connected) t.end(LEFT, false); }
      else if (ev.type === 'accepted' && !host) {
        host = ev.from; log('Relay : l’hôte a accepté notre allocation');
        peer = createPeer({ session, alloc, other: () => host!, token, iv, log, onBatch: t.emit,
          onDisconnect: (reason) => t.end(reason, false), onPacket });
        t.setPeer(peer);
        peer.handshake(1);
      } else if (ev.type === 'data' && peer) {
        const r = peer.receive(ev.data);
        if (r && r.handshake === 2 && !connected) {
          connected = true; clearInterval(retry); clearTimeout(deadline); signal?.removeEventListener('abort', onAbort);
          log('SimpleConnection : connexion acceptée par le jeu');
          resolve(t.transport);
        }
      }
    });
  });
}

// ---------------------------------------------------------------- héberger une salle (capture)
export interface HostedRoom {
  /** Code Relay (sans préfixe de style). */
  joinCode: string;
  userId: string;
  /** Résout quand un jeu a rejoint et que la SimpleConnection est acceptée. */
  accepted: Promise<Transport>;
  close(): void;
}
/** Crée une salle que le jeu peut rejoindre (code « P » + joinCode) : sert à capturer sa demande de connexion. */
export async function host(opts: TransportOptions = {}): Promise<HostedRoom> {
  const { f, udp, unity, iv, log, onPacket } = settings(opts);
  const { idToken, userId } = await authenticate(f, unity);
  const { data: { allocation } } = await relayCall(f, unity, idToken, '/v1/allocate', { maxConnections: 2 });
  const alloc = readAllocation(allocation);
  const { data: { joinCode } } = await relayCall(f, unity, idToken, '/v1/joincode', { allocationId: allocation.allocationId });
  let game: Buffer | null = null, peer: Peer | null = null, connected = false;
  let resolveAccepted!: (t: Transport) => void;
  const accepted = new Promise<Transport>((r) => { resolveAccepted = r; });
  const t = makeTransport(userId, (reason, notify) => {
    log(`Connexion terminée : ${reason}`);
    if (notify) peer?.disconnect();
    peer?.stop(); session.close();
  });
  const session = openRelaySession(alloc, udp, iv, log, (ev) => {
    if (ev.type === 'disconnect') { if (connected) t.end(LEFT, false); return; }
    if (ev.type !== 'data') return;
    if (!game) { game = ev.from; log('Le jeu est arrivé sur la salle'); }
    if (!peer) {
      const p = ev.data;
      if (!(p.length >= 13 && p.subarray(0, 4).equals(HANDSHAKE_SIGNATURE))) { log('Paquet du jeu non reconnu'); return; }
      peer = createPeer({ session, alloc, other: () => game!, token: Buffer.from(p.subarray(5, 13)), iv, log, onBatch: t.emit,
        onDisconnect: (reason) => t.end(reason, false), onPacket });
      t.setPeer(peer);
      log('SimpleConnection : demande de connexion du jeu, on accepte');
    }
    const r = peer.receive(ev.data);
    if (r && r.handshake === 1) {
      peer.handshake(2);
      if (!connected) { connected = true; resolveAccepted(t.transport); }
    }
  });
  return { joinCode, userId, accepted, close: () => { if (connected) t.end('fermée par joy-boy', true); else session.close(); } };
}
