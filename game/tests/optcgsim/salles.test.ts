// Tâche O4.1 : salles publiques d'OPTCGSim (lobbies.ts), outil de listage et option --publique du banc. Fiches
// inventées, faux service Lobby : aucun accès réseau (sans faux fetch, tout refuse de partir).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CARD_DATA, FROZEN_VERSION, LobbyScout, STYLE_PREFIX, listPublicRooms, pickRooms, queryBody, queryLobbies, readRoom,
  tokenExpiry, type RawLobby,
} from '../../online/optcgsim/lobbies.ts';
import type { FetchLike } from '../../online/optcgsim/transport.ts';
import handshakeJson from '../../online/optcgsim/handshake.json' with { type: 'json' };

const outil = async (nom: string): Promise<any> => import(new URL(`../../../scripts/optcgsim/${nom}`, import.meta.url).href);

const T0 = Date.parse('2026-11-19T12:00:00Z');
const iso = (msAvant: number) => new Date(T0 - msAvant).toISOString();

/** Fiche inventée, comme celle d'HostJoinScript.MakeALobby. */
function fiche(id: string, o: { mode?: string; version?: string; card?: string | null; timer?: boolean; code?: string | null;
  leader?: string; name?: string; age?: number; maj?: number; locked?: boolean; prive?: boolean; slots?: number } = {}): RawLobby {
  const data: RawLobby['data'] = {
    Version: { value: o.version ?? FROZEN_VERSION, visibility: 'public', index: 'S1' },
    Mode: { value: o.mode ?? 'Western', visibility: 'public', index: 'S2' },
  };
  if (o.card !== null) data.CardData = { value: o.card ?? CARD_DATA, visibility: 'public', index: 'S3' };
  if (o.code !== null) data.JoinCode = { value: o.code ?? `CODE${id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`, visibility: 'public' };
  if (o.timer) data.IsTimerLobby = { value: 'True', visibility: 'public', index: 'S4' };
  if (o.leader !== undefined) data.leader = { value: o.leader, visibility: 'public', index: 'S5' };
  return {
    id, name: o.name ?? `[1.45b]Hote${id}'s Lobby`, maxPlayers: 2, availableSlots: o.slots ?? 1, isPrivate: o.prive ?? false,
    isLocked: o.locked ?? false, data, hostId: `HOTE-${id}`, created: iso(o.age ?? 60000), lastUpdated: iso(o.maj ?? 5000),
  };
}

/** Faux Unity : identification anonyme et `POST /query`. `reponses` : statuts à rendre dans l'ordre (sinon 200). */
function fauxLobby(fiches: () => RawLobby[], reponses: number[] = []) {
  const stats = { auth: 0, query: 0, corps: [] as any[], jetons: [] as string[] };
  let n = 0;
  const fetch: FetchLike = async (url, init) => {
    const ok = (v: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(v) });
    if (url.endsWith('/v1/authentication/anonymous')) {
      stats.auth++; n++;
      const charge = Buffer.from(JSON.stringify({ exp: Math.floor((T0 + 3600000) / 1000) })).toString('base64url');
      return ok({ idToken: `x.${charge}.jeton${n}`, userId: `JOUEUR-${n}` });
    }
    assert.equal(url, `${handshakeJson.unity.lobbyUrl}/query`);
    assert.equal(init.method, 'POST');
    stats.query++; stats.corps.push(JSON.parse(init.body)); stats.jetons.push(init.headers.Authorization);
    const s = reponses.shift();
    if (s && s !== 200) return { ok: false, status: s, text: async () => '{"title":"erreur"}' };
    return ok({ results: fiches() });
  };
  return { fetch, stats };
}

test('salles : handshake.json donne l’adresse du service Lobby, et le préfixe de chaque format', () => {
  assert.equal(handshakeJson.unity.lobbyUrl, 'https://lobby.services.api.unity.com/v1');
  assert.equal(STYLE_PREFIX.Western, 'W');
  assert.equal(STYLE_PREFIX.Eastern, 'E');
});

test('salles : filtres (version, format, CardData, minuteur, verrou, privée, pleine, JoinCode absent)', () => {
  const raw = [
    fiche('ok'),
    fiche('vieux', { version: '1.45a' }), fiche('neuf', { version: '1.46' }),
    fiche('est', { mode: 'Eastern' }), fiche('cd', { card: '1' }), fiche('sanscd', { card: null }),
    fiche('pendule', { timer: true }), fiche('verrou', { locked: true }), fiche('prive', { prive: true }),
    fiche('pleine', { slots: 0 }), fiche('sanscode', { code: null }), fiche('mauvaiscode', { code: 'ab-12' }),
    fiche('inconnu', { mode: 'Bizarre' }),
  ];
  assert.deepEqual(pickRooms(raw, { now: T0 }).map((r) => r.lobbyId), ['ok']);
  assert.deepEqual(pickRooms(raw, { now: T0, allowTimed: true }).map((r) => r.lobbyId).sort(), ['ok', 'pendule']);
  assert.deepEqual(pickRooms(raw, { now: T0, styles: ['Western', 'Eastern'] }).map((r) => r.lobbyId).sort(), ['est', 'ok']);
  assert.deepEqual(pickRooms(raw, { now: T0, version: '1.45a' }).map((r) => r.lobbyId), ['vieux']);
  assert.equal(readRoom(fiche('x', { locked: true })).reason, 'verrouillée');
  assert.equal(readRoom(fiche('x', { code: null })).reason, 'sans code Relay');
});

test('salles : la salle produite (code W…, minuteur, Leader, dates) et rien du nom de la salle', () => {
  const [r] = pickRooms([fiche('a1', { code: 'k7xq2m', leader: 'OP01-001' })], { now: T0 });
  assert.deepEqual(r, {
    lobbyId: 'a1', code: 'WK7XQ2M', style: 'Western', version: FROZEN_VERSION, cardData: '0', timed: false,
    leader: 'OP01-001', created: iso(60000), lastUpdated: iso(5000),
  });
  assert.equal(pickRooms([fiche('a2', { leader: '' })], { now: T0 })[0].leader, null);
  const [e] = pickRooms([fiche('e', { mode: 'Eastern', code: 'ZZ1234' })], { now: T0, styles: ['Eastern'] });
  assert.equal(e.code, 'EZZ1234');
  assert.ok(!JSON.stringify(r).includes('Hote'));
});

test('salles : tri (fiches fraîches d’abord, puis la plus ancienne), doublons et exclusions', () => {
  const raw = [
    fiche('recente', { age: 20000, maj: 3000 }),
    fiche('ancienne', { age: 300000, maj: 10000 }),
    fiche('figee', { age: 900000, maj: 600000 }), // plus ancienne mais sans signe de vie depuis 10 min
    fiche('moyenne', { age: 120000, maj: 1000 }),
  ];
  assert.deepEqual(pickRooms(raw, { now: T0 }).map((r) => r.lobbyId), ['ancienne', 'moyenne', 'recente', 'figee']);
  const codes = pickRooms(raw, { now: T0 }).map((r) => r.code);
  assert.deepEqual(pickRooms(raw, { now: T0, exclude: [codes[0], 'recente'] }).map((r) => r.lobbyId), ['moyenne', 'figee']);
  // deux fiches pour le même code (fiche fantôme d'une revanche) : une seule salle
  const doublon = [fiche('d1', { code: 'SAME01', age: 50000 }), fiche('d2', { code: 'SAME01', age: 40000 })];
  assert.deepEqual(pickRooms(doublon, { now: T0 }).map((r) => r.lobbyId), ['d1']);
});

test('salles : --seulement ne garde que les salles dont le nom contient le texte', () => {
  const raw = [fiche('a', { name: "[1.45b]Inconnu's Lobby" }), fiche('b', { name: "[1.45b]MonPseudo's Lobby (essai)" })];
  assert.deepEqual(pickRooms(raw, { now: T0, only: 'monpseudo' }).map((r) => r.lobbyId), ['b']);
  assert.deepEqual(pickRooms(raw, { now: T0, only: 'personne' }), []);
});

test('salles : requête Lobby (filtres S1/S2, jeton, erreurs)', async () => {
  assert.deepEqual(queryBody({ style: 'Western' }), { count: 30, sampleResults: false, filter: [
    { field: 'AvailableSlots', op: 'GT', value: '0' }, { field: 'S1', op: 'EQ', value: FROZEN_VERSION },
    { field: 'S2', op: 'EQ', value: 'Western' }] });
  assert.deepEqual(queryBody({ version: null, count: 500 }).filter.length, 1);
  assert.equal(queryBody({ count: 500 }).count, 100);
  const u = fauxLobby(() => [fiche('a'), fiche('b', { mode: 'Eastern' })], [200, 500]);
  const salles = await listPublicRooms({ fetch: u.fetch, now: T0 });
  assert.deepEqual(salles.map((r) => r.code), ['WCODEA']);
  assert.equal(u.stats.auth, 1);
  assert.deepEqual(u.stats.corps[0].filter.map((f: any) => f.field), ['AvailableSlots', 'S1', 'S2']);
  await assert.rejects(queryLobbies({ fetch: u.fetch, token: 'j' }), (e: any) => e.status === 500);
});

test('salles : garde-fou réseau sous node --test (ni fetch absent, ni vrai fetch)', async () => {
  await assert.rejects(queryLobbies({ token: 'j' }), /réseau réel interdit/);
  await assert.rejects(queryLobbies({ token: 'j', fetch: globalThis.fetch as unknown as FetchLike }), /réseau réel interdit/);
  await assert.rejects(listPublicRooms(), /réseau réel interdit/);
  const scout = new LobbyScout();
  assert.deepEqual(await scout.rooms(), []);
  assert.match(scout.state().lastError ?? '', /réseau réel interdit/);
});

test('éclaireur : jeton réutilisé, cache de 5 s, lectures simultanées partagées, 401 → nouvelle identité', async () => {
  let t = T0;
  const u = fauxLobby(() => [fiche('a')], [200, 200, 401, 200]);
  const scout = new LobbyScout({ fetch: u.fetch, now: () => t });
  const [a, b] = await Promise.all([scout.rooms(), scout.rooms()]);
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  assert.equal(u.stats.query, 1, 'deux demandes simultanées = une lecture');
  t += 4000; await scout.rooms();
  assert.equal(u.stats.query, 1, 'cache de 5 s');
  t += 2000; await scout.rooms();
  assert.equal(u.stats.query, 2);
  assert.equal(u.stats.auth, 1, 'identité anonyme gardée');
  assert.equal(u.stats.jetons[0], u.stats.jetons[1]);
  t += 6000; assert.equal((await scout.rooms()).length, 1); // 401 puis nouvel essai avec une nouvelle identité
  assert.equal(u.stats.auth, 2);
  assert.equal(u.stats.query, 4);
  assert.notEqual(u.stats.jetons[3], u.stats.jetons[0]);
  // exclusions passées à chaque demande
  t += 6000; assert.deepEqual(await scout.rooms({ exclude: ['a'] }), []);
});

test('éclaireur : jeton renouvelé avant expiration', async () => {
  let t = T0;
  const u = fauxLobby(() => []);
  const scout = new LobbyScout({ fetch: u.fetch, now: () => t });
  await scout.rooms();
  t += 58 * 60000; await scout.rooms();
  assert.equal(u.stats.auth, 1);
  t += 2 * 60000; await scout.rooms(); // à moins d'une minute de l'expiration (1 h)
  assert.equal(u.stats.auth, 2);
  assert.equal(tokenExpiry('pas-un-jwt'), null);
});

test('éclaireur : 429 → pause de 60 s sans aucune requête, puis reprise', async () => {
  let t = T0;
  const lignes: string[] = [];
  const u = fauxLobby(() => [fiche('a')], [429]);
  const scout = new LobbyScout({ fetch: u.fetch, now: () => t, log: (l) => lignes.push(l) });
  assert.deepEqual(await scout.rooms(), []);
  assert.equal(scout.stats.tooMany, 1);
  assert.equal(scout.state().pausedUntil, T0 + 60000);
  assert.match(lignes[0], /429/);
  for (const d of [5000, 20000, 30000]) { t = T0 + d; assert.deepEqual(await scout.rooms(), []); }
  assert.equal(u.stats.query, 1, 'aucune lecture pendant la pause');
  t = T0 + 60001;
  assert.equal((await scout.rooms()).length, 1);
  assert.equal(u.stats.query, 2);
  assert.equal(scout.state().pausedUntil, null);
  assert.equal(scout.state().lastError, null);
});

test('outil de listage : une lecture, comptes, aucun pseudo, nom de salle ni code affiché', async () => {
  const { lister } = await outil('lister-salles.mjs');
  const u = fauxLobby(() => [
    fiche('a', { leader: 'OP01-001', code: 'SECRT1' }), fiche('b', { mode: 'Eastern', code: 'SECRT2' }),
    fiche('c', { timer: true, code: 'SECRT3' }), fiche('d', { version: '1.46', code: 'SECRT4' }), fiche('e', { version: '1.45a' }),
  ]);
  const lignes: string[] = [];
  const r = await lister({ fetch: u.fetch, maintenant: () => T0, ecrire: (l: string) => lignes.push(l), attendre: async () => {} });
  const texte = lignes.join('\n');
  assert.equal(r.lectures, 1);
  assert.equal(u.stats.query, 1);
  assert.equal(u.stats.corps[0].count, 100);
  assert.deepEqual(u.stats.corps[0].filter.map((f: any) => f.field), ['AvailableSlots'], 'toutes versions, tous formats');
  assert.match(texte, /5 fiche\(s\)/);
  assert.match(texte, /1\.45a 1, 1\.45b 3, 1\.46 1/);
  assert.match(texte, /1 fiche\(s\) d'une version plus récente/);
  assert.match(texte, /Eastern 1, Western 2/);
  assert.match(texte, /Western, Leader OP01-001, âge 60 s, mise à jour il y a 5 s — visée par joy-boy/);
  assert.match(texte, /Western, minuteur.*hors décision/);
  for (const secret of ['Hote', 'HOTE', 'SECRT', 'Lobby', 'JOUEUR', 'jeton']) assert.ok(!texte.includes(secret), secret);
});

test('outil de listage : --suivre (durée de vie, lastUpdated, 429) et --json anonymisé', async () => {
  const { lister, anonymiser } = await outil('lister-salles.mjs');
  let t = T0;
  let fiches = [fiche('a', { age: 30000 }), fiche('b', { age: 90000 })];
  const u = fauxLobby(() => fiches, [200, 429, 200, 200]);
  const lignes: string[] = [];
  let tour = 0;
  const r = await lister({
    fetch: u.fetch, secondes: 120, maintenant: () => t, ecrire: (l: string) => lignes.push(l),
    attendre: async (ms: number) => {
      t += ms; tour++;
      // l'hôte de « a » renouvelle sa fiche ; « b » disparaît (partie lancée)
      fiches = [{ ...fiche('a', { age: 30000 }), lastUpdated: new Date(t - 1000).toISOString() }];
      if (tour === 1) fiches.push(fiche('b', { age: 90000 }));
    },
  });
  const texte = lignes.join('\n');
  assert.match(texte, /pause de 60 s/);
  assert.equal(u.stats.auth, 1, 'une seule identité pour tout le suivi');
  assert.equal(r.lectures, 13); // 0 s, puis 65 s à 120 s (pause de 60 s après le 429)
  assert.match(texte, /fiches disparues : salle 2 \(vie/);
  assert.match(texte, /lastUpdated a changé pour 1 fiche\(s\) sur \d vues plusieurs fois : il suit le signal de vie/);
  const z = fiche('z', { code: 'SECRT9' });
  z.data!.Description = { value: 'TexteLibreSECRET', visibility: 'public' }; // donnée inconnue (version future) : écartée
  const json = JSON.stringify(anonymiser([z], r.suivi));
  for (const secret of ['Hote', 'HOTE', 'SECRT9', '"z"', 'TexteLibreSECRET']) assert.ok(!json.includes(secret), secret);
  assert.match(json, /"Mode":\{"value":"Western"/);
  assert.match(json, /"codePresent":true/);
});

test('outil de listage : sans faux fetch, rien ne part', async () => {
  const { lister } = await outil('lister-salles.mjs');
  const lignes: string[] = [];
  const r = await lister({ ecrire: (l: string) => lignes.push(l) });
  assert.equal(r.lectures, 0);
  assert.match(lignes.join('\n'), /réseau réel interdit/);
});

test('banc --publique : salle visée par format et --seulement, sinon erreur claire', async () => {
  const { choisirSallePublique } = await outil('banc.mjs');
  const u = fauxLobby(() => [
    fiche('inconnu', { name: "[1.45b]Inconnu's Lobby", age: 900000 }),
    fiche('moi', { name: "[1.45b]MonPseudo's Lobby", code: 'MOI123' }),
    fiche('moi-pendule', { name: "[1.45b]MonPseudo's Lobby", timer: true }),
  ]);
  const salle = await choisirSallePublique({ format: 'Western', seulement: 'MonPseudo', fetch: u.fetch });
  assert.equal(salle.code, 'WMOI123');
  assert.equal(u.stats.corps[0].count, 100);
  await assert.rejects(choisirSallePublique({ format: 'Western', seulement: 'Personne', fetch: u.fetch }), /Aucune salle publique Western/);
  await assert.rejects(choisirSallePublique({ format: 'Western', seulement: '', fetch: u.fetch }), /--seulement/);
  await assert.rejects(choisirSallePublique({ format: 'Private', seulement: 'x', fetch: u.fetch }), /Format inconnu/);
  await assert.rejects(choisirSallePublique({ format: 'Western', seulement: 'x' }), /réseau réel interdit/);
});
