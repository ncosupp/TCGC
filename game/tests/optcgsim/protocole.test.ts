// Tâche O1.1 : le protocole d'OPTCGSim (transport, netcode, RPC). Les fixtures anonymisées du 17 nov. sont rejouées
// à travers un faux réseau (faux REST Unity, faux serveur Relay, faux UDP avec pertes, doublons et désordre) : chaque
// lot se recompose, chaque empreinte est vérifiée, chaque RPC fait l'aller-retour à l'octet près. Aucun accès réseau.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HANDSHAKE, MESSAGE_TYPE, NetcodeClient, buildBatch, connectionRequest, decodeConnectionRequest, encodeConnectionRequest,
  inspectBatch, packInt, packUInt, packULong, packUShort, parseBatch, readClientConnected, readInt, readSceneSync, readUInt,
  readULong, readUShort, synchronizeComplete, xxh64, type NgoMessage,
} from '../../online/optcgsim/netcode.ts';
import { ALL_CLIENTS, CATALOG, REST, decode, encode, encodeRpc, rpcEntry, rpcMessage } from '../../online/optcgsim/rpc.ts';
import {
  HANDSHAKE_SIGNATURE, RELAY, Reliable, Stream, authenticate, connect, frame, host, nodeUdp, parseRoomCode, type FetchLike, type Transport,
  type UdpFactory,
} from '../../online/optcgsim/transport.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string; messages: { nom: string; rpc?: string }[] }
const FIXTURES = fs.readdirSync(ici('./fixtures/')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ nom: f, paquets: (JSON.parse(fs.readFileSync(ici(`./fixtures/${f}`), 'utf8')) as { paquets: Paquet[] }).paquets }));
const lots = (sens?: Paquet['sens']) => FIXTURES.flatMap((f) => f.paquets.filter((p) => !sens || p.sens === sens).map((p) => Buffer.from(p.lot, 'hex')));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// ---------------------------------------------------------------- catalogue et compactage
test('le catalogue contient les 490 RPC du jeu (1.45b : 488 + GrantCardCombatImmuneToOppEnd), noms uniques, codages connus', () => {
  const entrees = Object.values(CATALOG);
  assert.equal(entrees.length, 490);
  assert.equal(new Set(entrees.map((e) => e.nom)).size, 490);
  const connus = new Set(['int-compacte', 'uint-compacte', 'ulong-compacte', 'bool', 'float', 'enum', 'chaine', 'tableau', 'brut-ActionStepResolver']);
  for (const e of entrees) for (const w of e.ecritures) assert.ok(connus.has(w.codage), `${e.nom}.${w.param} : ${w.codage}`);
  assert.equal(rpcEntry('SetNameServerRpc')?.sens, 'client->hote');
  assert.equal(rpcEntry('EndTurnClientRpc')?.sens, 'hote->clients');
});

test('compactage NGO : aller-retour aux limites de chaque taille', () => {
  for (const v of [0, 1, 7, 31, 8191, 2097151, 536870911, 536870912, 0xffffffff]) {
    const b = packUInt(v); assert.deepEqual(readUInt(b, 0), { value: v, next: b.length }, `uint ${v}`);
  }
  assert.equal(hex(packUInt(0)), '01');
  assert.equal(packUInt(536870912)[0], 5);
  for (const v of [0, -1, 1, 5, -5, 2147483647, -2147483648]) {
    const b = packInt(v); assert.deepEqual(readInt(b, 0), { value: v, next: b.length }, `int ${v}`);
  }
  for (const v of [0, 1, 16383, 16384, 65535]) { const b = packUShort(v); assert.deepEqual(readUShort(b, 0), { value: v, next: b.length }); }
  for (const v of [0n, 1n, 2n ** 53n, 2n ** 60n - 1n, 2n ** 60n, ALL_CLIENTS]) {
    const b = packULong(v), r = readULong(b, 0);
    assert.equal(BigInt(r.value), v); assert.equal(r.next, b.length);
  }
  assert.equal(packULong(ALL_CLIENTS).length, 9);
  assert.throws(() => packInt(1.5)); assert.throws(() => packUInt(-1));
});

test('XXH64 : vecteurs de référence', () => {
  assert.equal(xxh64(Buffer.alloc(0)), 0xef46db3751d8e999n);
  assert.equal(xxh64(Buffer.from('abc')), 0x44bc2cf5ad770999n);
  // Plus de 32 octets : passe par les quatre accumulateurs.
  assert.equal(xxh64(Buffer.from('Nobody inspects the spammish repetition')), 0xfbcea83c8a378bf1n);
});

// ---------------------------------------------------------------- lots et RPC des fixtures
test('chaque lot des fixtures : empreinte vérifiée, recomposé à l’identique', () => {
  const tous = lots();
  assert.ok(tous.length > 300);
  for (const lot of tous) {
    const messages = parseBatch(lot);
    assert.equal(hex(buildBatch(messages)), hex(lot));
  }
  const abime = Buffer.from(tous[5]); abime[abime.length - 1] ^= 1;
  assert.throws(() => parseBatch(abime), /empreinte/);
  assert.equal(inspectBatch(abime).hashOk, false);
  assert.throws(() => parseBatch(Buffer.from('nope')), /pas un lot/);
});

test('chaque RPC des fixtures fait l’aller-retour à l’octet près, entièrement décodée', () => {
  let n = 0;
  const noms = new Set<string>();
  for (const lot of lots()) {
    for (const m of parseBatch(lot)) {
      if (m.type !== MESSAGE_TYPE.ClientRpc && m.type !== MESSAGE_TYPE.ServerRpc) continue;
      const r = decode(m.payload);
      assert.ok(!r.name.startsWith('?'), `empreinte inconnue ${r.name}`);
      assert.ok(!(REST in r.values), `${r.name} : octets non décodés`);
      assert.equal(hex(encodeRpc(r)), hex(m.payload), r.name);
      assert.equal(hex(encode(r.name, JSON.parse(JSON.stringify(r.values, (_k, x) => (typeof x === 'bigint' ? String(x) : x))), r)), hex(m.payload), `${r.name} après JSON`);
      noms.add(r.name); n++;
    }
  }
  assert.equal(n, 664);
  assert.ok(noms.has('SetNameClientRpc') && noms.has('EndTurnClientRpc') && noms.has('SetTimerClientRpc'));
});

test('encode : valeurs typées, chaînes nulles, structures et tableaux de TransferAction', () => {
  const nom = encode('SetNameServerRpc', { sName: 'Invite#0002', bSpectator: false }, { object: 3 });
  const r = decode(nom);
  assert.equal(r.name, 'SetNameServerRpc'); assert.equal(r.object, 3);
  assert.deepEqual(Object.values(r.values), ['Invite#0002', false]);
  const ecritures = rpcEntry('SetNameServerRpc')!.ecritures.map((e) => e.param);
  assert.deepEqual(Object.keys(r.values), ecritures);
  const nul = decode(encode('SetNameServerRpc', { [ecritures[0]]: null, [ecritures[1]]: true }));
  assert.equal(nul.values[ecritures[0]], null);
  assert.throws(() => encode('SetNameServerRpc', { [ecritures[0]]: 'x' }), /manquant/);
  assert.throws(() => encode('PasUneRpc', {}), /inconnue/);

  const transfert = { iOwner: 1, iLocation: 2, iCard: -1, iAction: 4, iTarget: 5, iSaveTarget: -1, eRemoval: 1, iRemovalPlayer: 0,
    iStackIdx: 0, iStepIdx: 2, iPrevTarget: 0, bFree: true, bTriggerOffer: false };
  const t = encode('TriggerOpponentMultiActionsServerRpc', { aTransfer: [transfert, { ...transfert, iCard: 7 }], bDontStartAny: true });
  const dt = decode(t);
  assert.deepEqual(dt.values, { aTransfer: [transfert, { ...transfert, iCard: 7 }], bDontStartAny: true });
  assert.equal(hex(encodeRpc(dt)), hex(t));
  assert.equal(decode(encode('TriggerOpponentMultiActionsServerRpc', { aTransfer: null, bDontStartAny: false })).values.aTransfer, null);

  const def = rpcEntry('GrantEffectToOpponentCardClientRpc')!;
  const v = { giverStepResolver: { iActorID: 1, iActionIdx: -2, iStepIdx: 3 }, iTargetDeployIdx: 4 };
  assert.equal(def.ecritures[0].codage, 'brut-ActionStepResolver');
  assert.deepEqual(decode(encode(def.nom, v)).values, v);

  const tous = encode('EndTurnClientRpc', {}, { object: 2, behaviour: 0 });
  assert.equal(decode(tous).name, 'EndTurnClientRpc');
  assert.equal(rpcMessage('EndTurnServerRpc', {}).type, MESSAGE_TYPE.ServerRpc);
  assert.equal(rpcMessage('EndTurnClientRpc', {}).type, MESSAGE_TYPE.ClientRpc);
  // Octets inattendus en fin de RPC : gardés bruts, réencodés tels quels.
  const plus = Buffer.concat([Buffer.from(tous), Buffer.from([0xab, 0xcd])]);
  assert.equal(decode(plus).values[REST], 'abcd');
  assert.equal(hex(encodeRpc(decode(plus))), hex(plus));
});

// ---------------------------------------------------------------- demande de connexion, synchro de scène
test('demande de connexion rejouée depuis handshake.json, au style de la salle', () => {
  assert.equal(HANDSHAKE.gameVersion, '1.45b'); // gel en 1.45b (18 nov., Décision 5) ; ConfigHash et versions inchangés
  assert.equal(HANDSHAKE.configHash, 'e4753a7aa6d727a7');
  assert.equal(HANDSHAKE.versions.length, 32);
  const capture = Buffer.from(HANDSHAKE.payloadHex, 'hex');
  const info = decodeConnectionRequest(capture);
  assert.equal(info.configHash, HANDSHAKE.configHash);
  assert.equal(info.connectionData, HANDSHAKE.connectionData);
  assert.equal(hex(encodeConnectionRequest(info)), hex(capture));
  assert.equal(hex(connectionRequest('Private').payload), hex(capture));
  // La demande envoyée par le prototype le 17 nov. (1.45a, salle Eastern) est exactement celle qu'on reconstruit :
  // de 1.45a à 1.45b, seul l'octet de la version change.
  const envoyee = parseBatch(lots('sortant')[0]).find((m) => m.type === MESSAGE_TYPE.ConnectionRequest)!;
  assert.equal(hex(connectionRequest('Eastern', { ...HANDSHAKE, gameVersion: '1.45a' }).payload), hex(envoyee.payload));
  assert.equal(hex(connectionRequest('Eastern').payload), hex(envoyee.payload).replace(hex(Buffer.from('1.45aEastern')), hex(Buffer.from('1.45bEastern'))));
  assert.equal(connectionRequest('Eastern').type, MESSAGE_TYPE.ConnectionRequest);
  assert.deepEqual(parseRoomCode('e1a2b3c'), { style: 'Eastern', joinCode: '1A2B3C' });
  assert.equal(parseRoomCode('P9ZZZZZ').style, 'Private');
  assert.throws(() => parseRoomCode('Z123456'), /inconnu/);
});

test('identifiant client, synchro de scène et synchro terminée (client NGO sur un faux transport)', () => {
  const entrants = FIXTURES[0].paquets.filter((p) => p.sens === 'entrant').map((p) => Buffer.from(p.lot, 'hex'));
  const handlers: ((d: Uint8Array) => void)[] = [];
  const envoyes: Uint8Array[] = [];
  const faux: Transport = { send: (d) => { envoyes.push(d); }, onData: (h) => { handlers.push(h); }, close: () => {} };
  const client = new NetcodeClient(faux);
  const prets: { clientId: number; playerObject: number }[] = [];
  client.onReady((r) => prets.push(r));
  const vus: NgoMessage[] = [];
  client.onMessage((m) => vus.push(m));
  client.start('Eastern');
  assert.equal(hex(parseBatch(envoyes[0])[0].payload), hex(connectionRequest('Eastern').payload));
  for (const lot of entrants) for (const h of handlers) h(lot);
  assert.equal(prets.length, 1);
  assert.ok(client.sync && client.sync.objects.length >= 1);
  const moi = client.sync!.objects.find((o) => o.owner === client.clientId)!;
  assert.equal(prets[0].playerObject, moi.id);
  assert.equal(readClientConnected(packULong(client.clientId!)), client.clientId);
  assert.ok(vus.length > 300);
  client.completeSync([rpcMessage('VersionCheckServerRpc', { sVersion: '1.45a' }, { object: moi.id })]);
  const fin = parseBatch(envoyes[1]);
  assert.equal(fin[0].type, MESSAGE_TYPE.SceneEvent);
  assert.equal(fin[0].payload[0], 8);
  assert.equal(Buffer.from(fin[0].payload).readUInt32LE(26), client.sync!.objects.length);
  assert.equal(hex(fin[0].payload), hex(synchronizeComplete(client.sync!).payload));
  assert.equal(decode(fin[1].payload).name, 'VersionCheckServerRpc');
  assert.equal(readSceneSync(Buffer.from([1, 2, 3])), null);
});

// ---------------------------------------------------------------- pipeline fiable et flux
test('pipeline fiable : ordre, doublons, fenêtre de 64, accusés et numéros au-delà de 65535', () => {
  let t = 0;
  const a = new Reliable(() => t), b = new Reliable(() => t);
  const charges = Array.from({ length: 70000 }, (_, k) => Buffer.from([k & 0xff, (k >> 8) & 0xff, k >> 16]));
  const recus: Buffer[] = [];
  // Avec 3 paquets en avance et retours d'accusés : désordre et doublons.
  let enVol: Buffer[] = [];
  const livrer = (p: Buffer) => {
    const r = b.receive(p.subarray(1));
    if (r.delivered) { recus.push(...r.delivered); for (const ack of [b.ack()]) a.receive(ack.subarray(1)); }
  };
  for (const c of charges) {
    enVol.push(...a.send(c));
    if (enVol.length >= 3) { const [x, y, z] = enVol.splice(0, 3); livrer(z); livrer(x); livrer(x); livrer(y); }
  }
  enVol.forEach(livrer); enVol = [];
  t += 1000; for (const p of a.resend(0)) livrer(p);
  assert.equal(recus.length, charges.length);
  assert.ok(recus.every((r, k) => r.equals(charges[k])));
  assert.equal(a.inFlight, 0);

  const c = new Reliable(() => 0);
  const partis = Array.from({ length: 100 }, (_, k) => c.send(Buffer.from([k]))).flat();
  assert.equal(partis.length, 64, 'au plus 64 paquets en vol');
  assert.equal(c.inFlight, 100);
  const d = new Reliable(() => 0);
  for (const p of partis) d.receive(p.subarray(1));
  const liberes = c.receive(d.ack().subarray(1)).released;
  assert.equal(liberes.length, 36);
});

test('flux : un lot cadré se recompose, même découpé n’importe où', () => {
  const big = buildBatch([{ type: MESSAGE_TYPE.Unnamed, payload: crypto.randomBytes(5000) }]);
  const f = Buffer.concat([frame(lots()[0]), frame(big), frame(lots()[1])]);
  for (const pas of [1, 7, 1000, f.length]) {
    const s = new Stream(), out: Buffer[] = [];
    for (let k = 0; k < f.length; k += pas) out.push(...s.push(f.subarray(k, k + pas)));
    assert.deepEqual(out.map(hex), [hex(lots()[0]), hex(big), hex(lots()[1])]);
    assert.equal(s.pending, 0);
  }
});

// ---------------------------------------------------------------- faux réseau : REST Unity, Relay, UDP
function prng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
interface FakeAlloc { id: Buffer; key: Buffer; connectionData: Buffer; hostConnectionData?: Buffer; socket?: (b: Buffer) => void }
/** Faux Unity : identification, allocations, codes, et un serveur Relay qui vérifie la liaison HMAC et relaie. */
function fakeUnity(o: { loss?: number; duplicate?: number; jitter?: number; seed?: number; reject?: boolean; silentHost?: boolean } = {}) {
  const rnd = prng(o.seed ?? 1);
  const allocs = new Map<string, FakeAlloc>(), codes = new Map<string, FakeAlloc>();
  const stats = { binds: 0, badHmac: 0, relayed: 0, dropped: 0, auth: 0 };
  let n = 0;
  const later = (fn: () => void) => setTimeout(fn, Math.floor(rnd() * (o.jitter ?? 0)));
  const newAlloc = (host?: FakeAlloc): FakeAlloc => {
    const a: FakeAlloc = { id: crypto.randomBytes(16), key: crypto.randomBytes(64), connectionData: crypto.randomBytes(16), hostConnectionData: host?.connectionData };
    allocs.set(hex(a.id), a); return a;
  };
  const json = (a: FakeAlloc) => ({
    allocationId: [8, 4, 4, 4, 12].reduce<[string[], number]>(([p, k], l) => [[...p, hex(a.id).slice(k, k + l)], k + l], [[], 0])[0].join('-'),
    allocationIdBytes: a.id.toString('base64'), key: a.key.toString('base64'), connectionData: a.connectionData.toString('base64'),
    hostConnectionData: a.hostConnectionData?.toString('base64'), relayServer: { ipV4: 'relay.test', port: 7777 },
  });
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body);
    const ok = (v: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(v) });
    if (url.endsWith('/v1/authentication/anonymous')) {
      assert.equal(init.headers.ProjectId, HANDSHAKE.unity.projectId);
      stats.auth++; return ok({ idToken: `jeton-${++n}`, userId: `JOUEUR-${n}` });
    }
    assert.match(init.headers.Authorization, /^Bearer jeton-/);
    if (url.endsWith('/v1/allocate')) return ok({ data: { allocation: json(newAlloc()) } });
    if (url.endsWith('/v1/joincode')) {
      const a = [...allocs.values()].find((x) => json(x).allocationId === body.allocationId)!;
      const code = `C${String(++n).padStart(5, '0')}`; codes.set(code, a); return ok({ data: { joinCode: code } });
    }
    if (url.endsWith('/v1/join')) {
      const h = codes.get(body.joinCode);
      if (!h) return { ok: false, status: 404, text: async () => '{"title":"join code not found"}' };
      return ok({ data: { allocation: json(newAlloc(h)) } });
    }
    return { ok: false, status: 404, text: async () => 'inconnu' };
  };
  const relay = (b: Buffer, reply: (b: Buffer) => void) => {
    const type = b[3], head = (t: number) => Buffer.from([0xda, 0x72, 0x00, t]);
    if (type === RELAY.Bind) {
      stats.binds++;
      assert.equal(b.length, 295);
      const a = [...allocs.values()].find((x) => b.subarray(8, 24).equals(x.connectionData));
      const mac = a && crypto.createHmac('sha256', a.key).update(b.subarray(0, 263)).digest();
      if (!a || !mac!.equals(b.subarray(263))) { stats.badHmac++; return; }
      a.socket = reply; reply(head(RELAY.BindReceived));
    } else if (type === RELAY.ConnectRequest) {
      const joiner = allocs.get(hex(b.subarray(4, 20)));
      const h = [...allocs.values()].find((x) => x.connectionData.equals(b.subarray(21, 37)));
      if (!joiner || !h) return;
      if (o.reject) { reply(head(RELAY.Rejected)); return; }
      if (!o.silentHost) reply(Buffer.concat([head(RELAY.Accepted), h.id, joiner.id]));
    } else if (type === RELAY.Relay) {
      const to = allocs.get(hex(b.subarray(20, 36)));
      if (!to?.socket || o.silentHost) return;
      if (rnd() < (o.loss ?? 0)) { stats.dropped++; return; }
      const copies = rnd() < (o.duplicate ?? 0) ? 2 : 1;
      for (let k = 0; k < copies; k++) { stats.relayed++; const s = to.socket; later(() => s(b)); }
    } else if (type === RELAY.Disconnect) {
      /* rien */
    }
  };
  const udp: UdpFactory = () => {
    let handler: (b: Uint8Array) => void = () => {}, closed = false;
    const deliver = (b: Buffer) => { if (!closed) handler(Buffer.from(b)); };
    return {
      send: (data, port, address) => { assert.equal(`${address}:${port}`, 'relay.test:7777'); const b = Buffer.from(data); setImmediate(() => { if (!closed) relay(b, deliver); }); },
      onMessage: (h) => { handler = h; },
      bind: (ready) => setImmediate(ready),
      close: () => { closed = true; },
    };
  };
  return { fetch, udp, stats };
}
const RAPIDE = { heartbeat: 5, retransmit: 30, ping: 30, retry: 15, idle: 400 };

async function paire(net: ReturnType<typeof fakeUnity>) {
  const salle = await host({ fetch: net.fetch, udp: net.udp, intervals: RAPIDE });
  const [invite, hote] = await Promise.all([
    connect(`W${salle.joinCode}`, { fetch: net.fetch, udp: net.udp, intervals: RAPIDE, timeoutMs: 5000 }),
    salle.accepted,
  ]);
  return { salle, invite, hote };
}
function attendre(recus: unknown[], n: number, ms = 20000) {
  return new Promise<void>((res, rej) => {
    const t0 = Date.now();
    const tic = setInterval(() => {
      if (recus.length >= n) { clearInterval(tic); res(); } else if (Date.now() - t0 > ms) { clearInterval(tic); rej(new Error(`reçu ${recus.length}/${n}`)); }
    }, 5);
  });
}

test('faux réseau : les fixtures traversent Relay et SimpleConnection, pertes, doublons et désordre compris', async () => {
  const net = fakeUnity({ loss: 0.15, duplicate: 0.1, jitter: 6, seed: 17 });
  const { salle, invite, hote } = await paire(net);
  assert.equal(invite.userId, 'JOUEUR-3'); // 1 : l'hôte, 2 : son code, 3 : l'invité
  const versInvite: Buffer[] = [], versHote: Buffer[] = [];
  const canaux = new Set<string | undefined>();
  invite.onData((d, c) => { versInvite.push(Buffer.from(d)); canaux.add(c); });
  hote.onData((d) => { versHote.push(Buffer.from(d)); });
  const entrants = lots('entrant'), sortants = lots('sortant');
  const gros = buildBatch([{ type: MESSAGE_TYPE.Unnamed, payload: crypto.randomBytes(9000) }]);
  for (const l of [...entrants, gros]) hote.send(l);
  for (const l of sortants) invite.send(l);
  await attendre(versInvite, entrants.length + 1);
  await attendre(versHote, sortants.length);
  assert.deepEqual(versInvite.map(hex), [...entrants, gros].map(hex), 'chaque lot recomposé, dans l’ordre');
  assert.deepEqual(versHote.map(hex), sortants.map(hex));
  assert.deepEqual([...canaux], ['fiable']);
  for (const lot of versInvite) for (const m of parseBatch(lot)) {
    if (m.type === MESSAGE_TYPE.ClientRpc) assert.equal(hex(encodeRpc(decode(m.payload))), hex(m.payload));
  }
  assert.ok(net.stats.dropped > 0, 'des paquets ont bien été perdus');
  assert.equal(net.stats.badHmac, 0);
  // Le Disconnect peut se perdre (15 % ici) : l'hôte le reçoit, ou constate le silence.
  const fermeture = new Promise<string>((r) => hote.onClose!(r));
  invite.close();
  assert.match(await fermeture, /^(déconnexion demandée par le jeu|le jeu ne répond plus)$/);
  salle.close();
});

test('faux réseau : le client NGO se met en place de bout en bout', async () => {
  const net = fakeUnity({ jitter: 2, seed: 3 });
  const { salle, invite, hote } = await paire(net);
  const recusHote: NgoMessage[][] = [];
  hote.onData((d) => recusHote.push(parseBatch(d)));
  const client = new NetcodeClient(invite);
  const pret = new Promise<number>((r) => client.onReady((x) => r(x.playerObject)));
  client.start(parseRoomCode(`W${salle.joinCode}`).style);
  await attendre(recusHote, 1);
  const demande = decodeConnectionRequest(recusHote[0][0].payload);
  assert.equal(demande.connectionData, '1.45bWestern');
  for (const p of FIXTURES[1].paquets) if (p.sens === 'entrant') hote.send(Buffer.from(p.lot, 'hex'));
  const objet = await pret;
  client.completeSync([rpcMessage('SetNameServerRpc', { sName: 'Invite#0002', bSpectator: false }, { object: objet })]);
  await attendre(recusHote, 2);
  assert.equal(recusHote[1][0].type, MESSAGE_TYPE.SceneEvent);
  assert.equal(decode(recusHote[1][1].payload).object, objet);
  invite.close(); salle.close();
});

test('faux réseau : salle pleine, hôte muet, code inconnu', async () => {
  const plein = fakeUnity({ reject: true });
  const s1 = await host({ fetch: plein.fetch, udp: plein.udp, intervals: RAPIDE });
  await assert.rejects(connect(`P${s1.joinCode}`, { fetch: plein.fetch, udp: plein.udp, intervals: RAPIDE }), /salle pleine/);
  s1.close();
  const muet = fakeUnity({ silentHost: true });
  const s2 = await host({ fetch: muet.fetch, udp: muet.udp, intervals: RAPIDE });
  await assert.rejects(connect(`P${s2.joinCode}`, { fetch: muet.fetch, udp: muet.udp, intervals: RAPIDE, timeoutMs: 150 }), /à temps/);
  s2.close();
  await assert.rejects(connect('PNOPE00', { fetch: muet.fetch, udp: muet.udp }), /404/);
  // Garde-fou : sans faux réseau injecté, aucun appel à Unity pendant les tests.
  await assert.rejects(connect('P000000'), /réseau réel interdit/);
  await assert.rejects(host({ fetch: muet.fetch }), /réseau réel interdit/);
  // Tous les chemins (vague O1) : vrai fetch ou vrai UDP passés explicitement, authenticate et nodeUdp appelés seuls.
  // Le « vrai » fetch est remplacé le temps du test par un leurre qui échoue : même si le garde-fou cédait, rien ne part.
  const vraiFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('leurre : le garde-fou a laissé passer un appel'); }) as never;
  try {
    await assert.rejects(connect('P000000', { fetch: globalThis.fetch as never, udp: muet.udp }), /réseau réel interdit/);
    await assert.rejects(connect('P000000', { fetch: muet.fetch, udp: nodeUdp }), /réseau réel interdit/);
    await assert.rejects(authenticate(globalThis.fetch as never), /réseau réel interdit/);
    assert.throws(() => nodeUdp(), /réseau réel interdit/);
  } finally {
    globalThis.fetch = vraiFetch;
  }
  assert.ok(HANDSHAKE_SIGNATURE.equals(Buffer.from('55545001', 'hex')));
});

// ---------------------------------------------------------------- outils
test('capturer : un nouveau handshake.json à partir d’une demande capturée', async () => {
  const { majHandshake } = await import(new URL('../../../scripts/optcgsim/capturer.mjs', import.meta.url).href);
  const envoyee = parseBatch(lots('sortant')[0]).find((m) => m.type === MESSAGE_TYPE.ConnectionRequest)!;
  const date = new Date('2026-11-17T12:00:00Z');
  const nouveau = majHandshake(HANDSHAKE, envoyee.payload, envoyee.type, date);
  assert.equal(nouveau.gameVersion, '1.45a');
  assert.equal(nouveau.connectionData, '1.45aEastern');
  assert.equal(nouveau.configHash, HANDSHAKE.configHash);
  assert.deepEqual(nouveau.versions, HANDSHAKE.versions);
  assert.equal(nouveau.capturedAt, date.toISOString());
  assert.deepEqual(nouveau.styles, HANDSHAKE.styles);
  assert.equal(hex(connectionRequest('Private', { ...nouveau, gameVersion: '1.45b' }).payload), HANDSHAKE.payloadHex);
  const etrange = encodeConnectionRequest({ ...decodeConnectionRequest(envoyee.payload), connectionData: '1.46Zzz' });
  assert.throws(() => majHandshake(HANDSHAKE, etrange, 1), /inattendues/);
});

// ---------------------------------------------------------------- tolérance aux changements de version (1.45b)
/** Lot NGO valide (taille et empreinte justes) dont le corps est suivi d'octets en trop. */
function lotAvecReste(messages: NgoMessage[], reste: Uint8Array): Buffer {
  const base = Buffer.from(buildBatch(messages)), corps = Buffer.concat([base.subarray(16), reste]), h = Buffer.from(base.subarray(0, 16));
  h.writeInt32LE(16 + corps.length, 4); h.writeBigUInt64LE(xxh64(corps), 8);
  return Buffer.concat([h, corps]);
}

test('lot avec des octets en trop après le dernier message : ignorés comme le fait NGO, comptés pour le journal', () => {
  const demande = connectionRequest('Private');
  const lot = lotAvecReste([demande], Buffer.from('00000000abcd', 'hex'));
  const d = inspectBatch(lot);
  assert.equal(d.error, undefined); assert.equal(d.trailing, 6); assert.ok(d.sizeOk && d.hashOk);
  assert.equal(hex(parseBatch(lot)[0].payload), hex(demande.payload));
  assert.equal(inspectBatch(buildBatch([demande])).trailing, 0);
  // Forme exacte du lot capturé le 18 nov. (1.45b, le jeu rejoint) : 208 o, la demande, puis 3 octets nuls.
  const capture = lotAvecReste([demande], Buffer.alloc(3));
  assert.equal(capture.length, 208); assert.equal(inspectBatch(capture).trailing, 3);
  assert.equal(hex(parseBatch(capture)[0].payload), HANDSHAKE.payloadHex);
  // Taille ou empreinte fausses : toujours refusées (NGO les rejette aussi).
  const taille = Buffer.from(lot); taille.writeInt32LE(lot.length + 1, 4);
  assert.throws(() => parseBatch(taille), /taille fausse/);
  const tronque = Buffer.from(buildBatch([demande])); tronque.writeUInt16LE(2, 2);
  assert.throws(() => parseBatch(tronque), /tronqué/);
  // Le client NGO continue et signale l'anomalie.
  const avertissements: string[] = [], recus: NgoMessage[] = [];
  let livrer: (d: Uint8Array) => void = () => {};
  const client = new NetcodeClient({ send() {}, close() {}, onData: (h) => { livrer = h; } } as Transport);
  client.onWarning((w) => avertissements.push(w)); client.onMessage((m) => recus.push(m));
  livrer(lot);
  assert.equal(recus.length, 1); assert.match(avertissements[0], /6 octet\(s\) en trop/);
});

test('demande de connexion d’une autre version de NGO : champs inconnus gardés, style remplacé, aller-retour exact', () => {
  const base = decodeConnectionRequest(Buffer.from(HANDSHAKE.payloadHex, 'hex'));
  assert.equal(base.extraHex, undefined); assert.equal(base.trailingHex, undefined);
  const prefixe = encodeConnectionRequest({ ...base, connectionData: null });
  const donnees = (t: string) => { const d = Buffer.from(t, 'latin1'), l = Buffer.alloc(4); l.writeInt32LE(d.length); return Buffer.concat([l, d]); };
  // Champ ajouté après les données de connexion.
  const apres = Buffer.concat([prefixe, donnees('1.45bPrivate'), Buffer.from('0107', 'hex')]);
  const a = decodeConnectionRequest(apres);
  assert.equal(a.connectionData, '1.45bPrivate'); assert.equal(a.trailingHex, '0107'); assert.equal(a.configHash, base.configHash);
  assert.equal(hex(encodeConnectionRequest(a)), hex(apres));
  // Champ intercalé entre le ConfigHash et les données de connexion.
  const entre = Buffer.concat([prefixe, Buffer.from('01e8030000', 'hex'), donnees('1.45bPrivate')]);
  const e = decodeConnectionRequest(entre);
  assert.equal(e.connectionData, '1.45bPrivate'); assert.equal(e.extraHex, '01e8030000'); assert.equal(e.trailingHex, undefined);
  assert.equal(hex(encodeConnectionRequest(e)), hex(entre));
  // Rejouée pour une salle Eastern : seul le style change, les champs inconnus restent.
  const hs = { ...HANDSHAKE, gameVersion: '1.45b', payloadHex: hex(entre) };
  assert.equal(hex(connectionRequest('Eastern', hs).payload), hex(Buffer.concat([prefixe, Buffer.from('01e8030000', 'hex'), donnees('1.45bEastern')])));
  // Pas de données de connexion reconnaissables : tout est gardé brut, et on refuse de rejouer.
  const illisible = Buffer.concat([prefixe, Buffer.from('ffffffff00', 'hex')]);
  const i = decodeConnectionRequest(illisible);
  assert.equal(i.connectionData, null); assert.equal(i.trailingHex, 'ffffffff00');
  assert.equal(hex(encodeConnectionRequest(i)), hex(illisible));
  assert.throws(() => connectionRequest('Private', { ...HANDSHAKE, payloadHex: hex(illisible) }), /introuvables/);
  assert.throws(() => decodeConnectionRequest(prefixe.subarray(0, 20)), /tronqu/);
});

test('capturer : analyse sans erreur un lot 1.45b inattendu et en extrait la demande ; relecture d’un fichier brut', async () => {
  const { analyserLot, majHandshake, relire } = await import(new URL('../../../scripts/optcgsim/capturer.mjs', import.meta.url).href);
  const base = decodeConnectionRequest(Buffer.from(HANDSHAKE.payloadHex, 'hex'));
  const charge = encodeConnectionRequest({ ...base, connectionData: '1.45bPrivate', trailingHex: '01' });
  const demande = { type: MESSAGE_TYPE.ConnectionRequest, payload: charge };
  // Octets en trop qui sont un second lot collé.
  const second = buildBatch([{ type: MESSAGE_TYPE.TimeSync, payload: Buffer.from('0102', 'hex') }]);
  const lot = lotAvecReste([demande], second);
  const a = analyserLot(lot);
  assert.equal(hex(a.demande.payload), hex(charge));
  assert.ok(a.lignes.some((l: string) => /octet\(s\) en trop/.test(l)));
  assert.ok(a.lignes.some((l: string) => /deux lots collés/.test(l)));
  // Même avec une empreinte fausse, la demande est extraite (journalisée FAUSSE).
  const abime = Buffer.from(lot); abime[abime.length - 1] ^= 1;
  const b = analyserLot(abime);
  assert.ok(b.demande); assert.ok(b.lignes[0].includes('empreinte FAUSSE'));
  assert.ok(analyserLot(Buffer.from('nope')).lignes[0].includes('pas un lot NGO'));
  const nouveau = majHandshake(HANDSHAKE, a.demande.payload, a.demande.type);
  assert.equal(nouveau.gameVersion, '1.45b'); assert.equal(nouveau.connectionData, '1.45bPrivate');
  assert.equal(hex(connectionRequest('Western', nouveau).payload), hex(encodeConnectionRequest({ ...base, connectionData: '1.45bWestern', trailingHex: '01' })));
  // Relecture hors ligne d'un fichier brut (comme celui qu'écrit la capture).
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'capturer-'));
  const brut = path.join(dossier, 'h-brut.jsonl'), sortie = path.join(dossier, 'h.json');
  fs.writeFileSync(brut, [{ genre: 'paquet', hex: '00' }, { genre: 'lot', canal: 'fiable', hex: hex(lot) }].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const journal: string[] = [];
  assert.equal(relire(brut, HANDSHAKE, sortie, (l: string) => journal.push(l)), true);
  assert.equal(JSON.parse(fs.readFileSync(sortie, 'utf8')).gameVersion, '1.45b');
  assert.ok(journal.some((l) => /après les données de connexion : 01/.test(l)));
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('catalogue.mjs : l’extracteur lit les écritures ILPP d’une RPC', async () => {
  const { extraireCatalogue } = await import(new URL('../../../scripts/optcgsim/catalogue.mjs', import.meta.url).href);
  // Extrait inventé, de la même forme que le code généré (aucune ligne du jeu).
  const texte = [
    '\t[ServerRpc(RequireOwnership = false)]',
    '\tpublic void FaireUnTrucServerRpc(int iIdx, string sNom, bool bOui, ulong clientId)',
    '\t{',
    '\t\tFastBufferWriter bufferWriter = __beginSendServerRpc(123456u, serverRpcParams, RpcDelivery.Reliable);',
    '\t\tBytePacker.WriteValueBitPacked(bufferWriter, iIdx);',
    '\t\tbool value = sNom != null;',
    '\t\tbufferWriter.WriteValueSafe(in value, default(FastBufferWriter.ForPrimitives));',
    '\t\tif (value)',
    '\t\t{',
    '\t\t\tbufferWriter.WriteValueSafe(sNom);',
    '\t\t}',
    '\t\tbufferWriter.WriteValueSafe(in bOui, default(FastBufferWriter.ForPrimitives));',
    '\t\tBytePacker.WriteValueBitPacked(bufferWriter, clientId);',
    '\t\t__endSendServerRpc(ref bufferWriter, 123456u, serverRpcParams, RpcDelivery.Reliable);',
  ].join('\n');
  const { catalogue, inconnus } = extraireCatalogue(texte);
  assert.deepEqual(inconnus, []);
  assert.deepEqual(catalogue[123456], {
    nom: 'FaireUnTrucServerRpc', sens: 'client->hote', ecritures: [
      { param: 'iIdx', type: 'int', codage: 'int-compacte' },
      { param: 'sNom', type: 'string', codage: 'chaine', nullable: true },
      { param: 'bOui', type: 'bool', codage: 'bool' },
      { param: 'clientId', type: 'ulong', codage: 'ulong-compacte' },
    ],
  });
});

test('faux réseau (O4.2) : connexion annulée par signal avant l’accord du jeu, sans attendre le délai', async () => {
  const muet = fakeUnity({ silentHost: true });
  const salle = await host({ fetch: muet.fetch, udp: muet.udp, intervals: RAPIDE });
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 40);
  await assert.rejects(connect(`W${salle.joinCode}`, { fetch: muet.fetch, udp: muet.udp, intervals: RAPIDE, timeoutMs: 5000, signal: ac.signal }), /connexion annulée/);
  assert.ok(Date.now() - t0 < 1000, 'pas d’attente du délai');
  await assert.rejects(connect(`W${salle.joinCode}`, { fetch: muet.fetch, udp: muet.udp, signal: AbortSignal.abort() }), /connexion annulée/);
  salle.close();
});
