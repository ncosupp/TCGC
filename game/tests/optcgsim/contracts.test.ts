// Contrat de l'étape O (parties croisées avec OPTCGSim) : les squelettes existent et compilent, les types partagés
// sont utilisables, l'outil d'anonymisation ne laisse rien passer, et les fixtures du 17 nov. sont des lots valides.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as combat from '../../online/optcgsim/combat.ts';
import * as external from '../../online/optcgsim/external.ts';
import * as inbound from '../../online/optcgsim/inbound.ts';
import * as netcode from '../../online/optcgsim/netcode.ts';
import * as outbound from '../../online/optcgsim/outbound.ts';
import * as rpc from '../../online/optcgsim/rpc.ts';
import * as session from '../../online/optcgsim/session.ts';
import * as transport from '../../online/optcgsim/transport.ts';
import type { External, MirrorState, Rpc, Seat, Zone } from '../../online/optcgsim/types.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
// Les outils .mjs n'ont pas de types : import dynamique par chemin variable.
const outil = async (nom: string): Promise<any> => import(new URL(`../../../scripts/optcgsim/${nom}`, import.meta.url).href);

test('les squelettes lèvent « pas encore fait » tant que leur tâche n’est pas livrée', () => {
  const rpcExemple: Rpc = { name: 'TapCardClientRpc', object: 1, behaviour: 0, values: {} };
  const miroir = {} as MirrorState;
  const mutation: External = { kind: 'turn', to: 1 };
  const appels: Array<() => unknown> = [
    () => transport.connect('P000000'), () => netcode.buildBatch([]), () => netcode.parseBatch(new Uint8Array()),
    () => rpc.encode('x', {}), () => rpc.decode(new Uint8Array()),
    () => external.applyExternal({} as never, mutation),
    () => outbound.translateOutbound(miroir), () => inbound.translateInbound(rpcExemple),
    () => combat.handleCombatRpc(rpcExemple), () => session.startSession('P000000'),
  ];
  for (const appel of appels) assert.throws(appel, /pas encore fait/);
});

test('les types partagés sont utilisables', () => {
  const sieges: Seat[] = [0, 1];
  const zones: Zone[] = ['deck', 'hand', 'life', 'deploy', 'stage', 'leader', 'trash', 'donDeck', 'donCost'];
  assert.equal(sieges.length, 2);
  assert.equal(new Set(zones).size, 9);
});

test('les fichiers de l’arborescence du contrat existent', () => {
  for (const f of ['catalog.json', 'handshake.json', 'transport.ts', 'netcode.ts', 'rpc.ts', 'mirror.ts', 'external.ts',
    'outbound.ts', 'inbound.ts', 'combat.ts', 'session.ts', 'types.ts']) {
    assert.ok(fs.existsSync(ici(`../../online/optcgsim/${f}`)), f);
  }
  assert.ok(fs.existsSync(ici('../../../server/game-crossplay.js')));
});

test('l’anonymiseur remplace pseudos et identifiants, réencode et recalcule les empreintes', async () => {
  const { anonymiser, chercherRestes } = await outil('anonymiser.mjs');
  const { decoderLot, construireLot } = await outil('lib-octets.mjs');
  const catalogue = { 1: { nom: 'SetNameClientRpc', sens: 'hote->clients', ecritures: [{ param: 'sName', type: 'string', codage: 'chaine', nullable: true }, { param: 'b', type: 'bool', codage: 'bool' }] } };
  const pseudo = 'Secretario​#99887';
  const chaine = Buffer.from(pseudo, 'utf16le');
  const l = Buffer.alloc(4); l.writeUInt32LE(pseudo.length);
  const charge = Buffer.concat([Buffer.from([0x11, 0x01, 0x09, 0x01]), l, chaine, Buffer.from([1])]);
  const lot = construireLot([{ type: 7, charge }]);
  assert.equal(decoderLot(lot).empreinteOk, true);
  const journal = [
    '[08:00:00.000] <- lot fiable : 1 message(s), taille ok, empreinte ok',
    '[08:00:00.001]     ClientRpc objet 1/0 SetNameClientRpc …',
    `        complet : ${charge.toString('hex')}`,
  ].join('\n');
  const { fixtures, sensibles } = anonymiser([journal], catalogue);
  assert.equal(fixtures[0].length, 1);
  const sortie = Buffer.from(fixtures[0][0].lot, 'hex');
  const d = decoderLot(sortie);
  assert.ok(d.tailleOk && d.empreinteOk, 'lot reconstruit valide');
  assert.ok(sortie.includes(Buffer.from('Hote#0001', 'utf16le')), 'pseudo inventé présent');
  assert.deepEqual(chercherRestes({ paquets: fixtures[0] }, sensibles), []);
  assert.ok(chercherRestes({ paquets: [{ lot: lot.toString('hex') }] }, sensibles).length > 0, 'détecte une fuite');
});

test('les fixtures du 17 nov. sont des lots NGO valides et anonymes', async () => {
  const { decoderLot } = await outil('lib-octets.mjs');
  const dossier = ici('./fixtures/');
  const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.json'));
  assert.ok(fichiers.includes('journal-2026-11-17-0841.json') && fichiers.includes('journal-2026-11-17-0859.json'));
  for (const f of fichiers) {
    const fixture = JSON.parse(fs.readFileSync(dossier + f, 'utf8'));
    assert.ok(fixture.paquets.length > 50, f);
    for (const p of fixture.paquets) {
      const d = decoderLot(Buffer.from(p.lot, 'hex'));
      assert.ok(!d.erreur && d.tailleOk && d.empreinteOk, `${f} : lot invalide à t=${p.t}`);
      assert.equal(d.nb, p.messages.length);
      assert.ok(['entrant', 'sortant'].includes(p.sens));
    }
    assert.ok(fixture.paquets.some((p: { messages: { rpc?: string }[] }) => p.messages.some((m) => m.rpc === 'SetNameClientRpc')), f);
    const octets = Buffer.concat(fixture.paquets.map((p: { lot: string }) => Buffer.from(p.lot, 'hex')));
    assert.ok(octets.includes(Buffer.from('Hote#0001', 'utf16le')), `${f} : pseudo inventé attendu`);
  }
});
