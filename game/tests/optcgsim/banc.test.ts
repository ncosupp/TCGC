// Tâche O2.4 : le banc d'essai réel (scripts/optcgsim/banc.mjs), testé sur un faux transport qui rejoue la partie
// anonymisée du 17 nov. (fixture 0859) côté hôte. Aucun accès réseau : sans faux transport, le banc refuse de partir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MESSAGE_TYPE, decodeConnectionRequest, parseBatch } from '../../online/optcgsim/netcode.ts';
import { CATALOG, decode } from '../../online/optcgsim/rpc.ts';
import type { Rpc } from '../../online/optcgsim/types.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const outil = async (nom: string): Promise<any> => import(new URL(`../../../scripts/optcgsim/${nom}`, import.meta.url).href);
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const FIXTURE = (JSON.parse(fs.readFileSync(ici('./fixtures/journal-2026-11-17-0859.json'), 'utf8')) as { paquets: Paquet[] }).paquets;

/** Faux transport : l'hôte rejoue les lots entrants de la fixture dès la demande de connexion reçue. */
function fauxJeu() {
  const envoyes: Uint8Array[] = [];
  let recevoir: (d: Uint8Array, c?: string) => void = () => {};
  let fermer: (r: string) => void = () => {};
  let ferme = false, rejoue = false;
  const transport = {
    userId: 'JOUEUR-TEST',
    send(d: Uint8Array) {
      envoyes.push(d);
      if (rejoue) return;
      rejoue = true;
      const entrants = FIXTURE.filter((p) => p.sens === 'entrant');
      let k = 0;
      const suivant = () => {
        if (ferme || k >= entrants.length) return;
        const p = entrants[k++];
        recevoir(Buffer.from(p.lot, 'hex'), p.canal);
        setTimeout(suivant, 1);
      };
      setTimeout(suivant, 1);
    },
    onData(h: typeof recevoir) { recevoir = h; },
    onClose(h: typeof fermer) { fermer = h; },
    close() { if (!ferme) { ferme = true; fermer('fermée par joy-boy'); } },
  };
  const rpcs = () => envoyes.flatMap((l) => parseBatch(l)).filter((m) => m.type === MESSAGE_TYPE.ServerRpc).map((m) => decode(m.payload));
  return { transport, envoyes, rpcs };
}

function lancer(banc: any, extra: Record<string, unknown> = {}) {
  const jeu = fauxJeu();
  let journal = '';
  const b = banc.lancerBanc({ code: 'P1A2B3C', vitesse: 0.0005, ecrire: (t: string) => { journal += t; }, connect: async () => jeu.transport, ...extra });
  return { jeu, b, journal: () => journal };
}

test('banc : sans faux transport, aucun appel à Unity pendant les tests', async () => {
  const banc = await outil('banc.mjs');
  const b = banc.lancerBanc({ code: 'P000000', ecrire: () => {} });
  const bilan = await b.fini;
  assert.match(bilan.issue, /réseau réel interdit/);
});

test('banc : decks joy-boy, .deck d’OPTCGSim et .json', async () => {
  const { deckOptcgsim } = await outil('banc.mjs');
  const st01 = deckOptcgsim('ST-01');
  assert.equal(st01.leader, 'ST01-001');
  assert.equal(st01.cartes.length, 50);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banc-'));
  const f = path.join(dir, 'essai.deck');
  fs.writeFileSync(f, ['1xST01-001', ...Array.from({ length: 12 }, (_, i) => `4xST01-${String(i + 2).padStart(3, '0')}`), '2xST01-014'].join('\r\n'));
  assert.deepEqual(deckOptcgsim(f).cartes.slice(0, 5), ['ST01-002', 'ST01-002', 'ST01-002', 'ST01-002', 'ST01-003']);
  const g = path.join(dir, 'essai.json');
  fs.writeFileSync(g, JSON.stringify({ name: 'Essai', leader: 'ST01-001', cards: { 'ST01-002': 10 } }));
  assert.throws(() => deckOptcgsim(g), /50 cartes/);
  assert.throws(() => deckOptcgsim('NOPE-99'), /Deck inconnu/);
  fs.rmSync(dir, { recursive: true });
});

test('banc : une partie rejouée de bout en bout (pilote minimal, IA pas encore livrée), journal anonymisable', async () => {
  const banc = await outil('banc.mjs');
  const { jeu, b, journal } = lancer(banc);
  const bilan = await b.fini;
  // demande de connexion au style de la salle
  const demande = parseBatch(jeu.envoyes[0])[0];
  assert.equal(demande.type, MESSAGE_TYPE.ConnectionRequest);
  assert.equal(decodeConnectionRequest(demande.payload).connectionData, '1.45aPrivate');
  // mise en place : synchro terminée, puis nom, leader et 50 cartes au nom de notre objet joueur
  const miseEnPlace = parseBatch(jeu.envoyes[1]);
  assert.equal(miseEnPlace[0].type, MESSAGE_TYPE.SceneEvent);
  const rpcs = jeu.rpcs(), noms = rpcs.map((r: Rpc) => r.name);
  const leader = rpcs.find((r: Rpc) => r.name === 'LoadLeaderServerRpc')!;
  assert.equal(leader.values.sCardID, 'ST01-001');
  assert.equal(leader.values.sPlayerID, 'JOUEUR-TEST');
  assert.equal(noms.filter((n: string) => n === 'LoadDeckCardServerRpc').length, 50);
  assert.equal(new Set(rpcs.map((r: Rpc) => r.object)).size, 1, 'tout part au nom de notre objet joueur');
  // ouverture, tours, défense
  for (const n of ['ShuffleDeckServerRpc', 'PopulateLifeDeckServerRpc', 'DrawDonServerRpc', 'EndTurnServerRpc', 'NoBlockerServerRpc', 'ResolveAttackServerRpc']) {
    assert.ok(noms.includes(n), n);
  }
  const melange = rpcs.find((r: Rpc) => r.name === 'ShuffleDeckServerRpc')!;
  assert.deepEqual(String(melange.values.s_ShuffleString).split('-').map(Number).sort((x, y) => x - y), [...Array(50).keys()]);
  // bilan
  assert.equal(bilan.pilote, 'minimal');
  assert.deepEqual(bilan.erreursMiroir, [], 'le miroir suit la partie sans écart (puissances du catalogue)');
  assert.deepEqual(bilan.nonGerees, {});
  assert.ok(bilan.ecarts.some((e: string) => /IA indisponible.*O2\.2/.test(e)), bilan.ecarts.join(' ; '));
  assert.match(bilan.issue, /(victoire|défaite) de joy-boy \(abandon\)/);
  // la partie s'arrête à l'abandon de l'hôte : les derniers lots de la fixture (après l'abandon) ne sont pas lus
  const entrants = FIXTURE.filter((p) => p.sens === 'entrant').length;
  assert.ok(bilan.lotsRecus <= entrants && bilan.lotsRecus > entrants - 5, `${bilan.lotsRecus} / ${entrants}`);
  assert.equal(bilan.lotsEnvoyes, jeu.envoyes.length);
  assert.ok(bilan.rpcRecues > 50);
  // journal : relu par l'anonymiseur de O0, chaque lot complet, rien d'identifiant ne reste
  const texte = journal();
  assert.match(texte, />>> Miroir : tour \d+/);
  assert.match(texte, /^\[[\d:.]+\] BILAN \{/m);
  const { lireJournal, anonymiser, chercherRestes } = await outil('anonymiser.mjs');
  const { lots } = lireJournal(texte);
  assert.equal(lots.filter((l: { sens: string }) => l.sens === 'entrant').length, bilan.lotsRecus, 'chaque lot reçu relu (aucun non fiable dans la fixture)');
  assert.equal(lots.filter((l: { sens: string }) => l.sens === 'sortant').length, jeu.envoyes.length);
  const { fixtures, sensibles } = anonymiser([texte], CATALOG);
  // La fixture rejouée est déjà anonyme (Hote#0001…) : seuls nos propres nom et identifiant doivent disparaître.
  const restes: string[] = chercherRestes({ paquets: fixtures[0] }, sensibles);
  assert.ok(!restes.some((r) => /JoyBoy|JOUEUR-TEST/.test(r)), restes.join(', '));
  const sortie = JSON.stringify(fixtures[0]);
  for (const s of ['JoyBoy-banc', 'JOUEUR-TEST']) assert.ok(!sortie.includes(Buffer.from(s, 'utf16le').toString('hex')), `${s} remplacé`);
  assert.ok(texte.includes(Buffer.from('JoyBoy-banc', 'utf16le').toString('hex').replace(/(..)/g, '$1 ').trim()), 'le journal brut porte bien notre nom');
});

test('banc : pilote ia branché sur les modules O2 injectés', async () => {
  const banc = await outil('banc.mjs');
  const vus: string[] = [];
  const modules = {
    inbound: { translateInbound: (r: Rpc) => { vus.push(r.name); return []; } },
    outbound: { translateOutbound: () => [] },
    combat: { handleCombatRpc: () => [] },
  };
  assert.deepEqual((await banc.modulesO2(modules)).manque, []);
  assert.deepEqual((await banc.modulesO2()).manque.length, 3, 'les squelettes O2 sont signalés');
  const { b, journal } = lancer(banc, { pilote: 'ia', modules });
  const bilan = await b.fini;
  assert.equal(bilan.pilote, 'ia');
  // Soit le moteur a pris la table (et reçoit les RPC de l'hôte), soit le deck de l'hôte a des cartes inconnues et le
  // banc l'a dit avant de passer au pilote minimal.
  if (bilan.cartesInconnues.length) assert.match(journal(), /cartes inconnues de joy-boy/);
  else {
    assert.match(journal(), /moteur prêt/);
    assert.ok(vus.includes('EndTurnClientRpc'), vus.join(' '));
  }
});
