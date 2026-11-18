// Quatrième essai réel du banc (18 nov. 2026, 12 h 13, tâche O2.4-d) : OPTCGSim 1.45b, pilote ia, deck ST-01 (joy-boy,
// siège 1) contre Luffy OP17-079. La partie contient la double attaque de l'hôte (Ryuma OP10-094 : PlayerDrawLife,
// MoveToSecondLifeTrigger), un [Déclenchement] de l'hôte (EB02-050) et un KO par Karoo. Au tour 8, joy-boy restait figé :
// Jinbe ST01-005 avait donné +1000 à Sanji ST01-004 par son [En attaquant] dans le moteur, mais le banc n'envoyait pas
// les effets des cartes pendant un combat (`effectsBefore` de combat.ts ignoré). Sanji attaquait donc à 5000 dans le
// moteur et à 4000 dans le jeu ; le jeu a repoussé l'attaque, le moteur l'a vue toucher et a attendu que l'hôte rende la
// main, ce qui n'arrive pas après une attaque repoussée. Rejouée ici sur un faux transport (aucun accès réseau).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MESSAGE_TYPE, inspectBatch, parseBatch } from '../../online/optcgsim/netcode.ts';
import { REST, decode, encodeRpc } from '../../online/optcgsim/rpc.ts';
import type { Rpc, Seat } from '../../online/optcgsim/types.ts';


const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const outil = async (nom: string): Promise<any> => import(new URL(`../../../scripts/optcgsim/${nom}`, import.meta.url).href);
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const FIXTURE = JSON.parse(fs.readFileSync(ici('./fixtures/essais/banc-2026-11-18-1213.json'), 'utf8')) as { paquets: Paquet[] };
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
/** ClientRpc reçues, dans l'ordre ; l'objet 2 est celui de joy-boy (échos de ses actions). */
const recues = (): { rpc: Rpc; siege: Seat }[] => FIXTURE.paquets.filter((p) => p.sens === 'entrant')
  .flatMap((p) => parseBatch(Buffer.from(p.lot, 'hex'))).filter((m) => m.type === MESSAGE_TYPE.ClientRpc)
  .map((m) => { const rpc = decode(m.payload); return { rpc, siege: (rpc.object === 2 ? 1 : 0) as Seat }; });

/** Faux transport : l'hôte rejoue les lots entrants de la fixture dès la demande de connexion reçue. */
function fauxJeu() {
  let recevoir: (d: Uint8Array, c?: string) => void = () => {};
  let fermer: (r: string) => void = () => {};
  let ferme = false, rejoue = false;
  const envoyes: Uint8Array[] = [];
  return {
    userId: 'JOUEUR-TEST',
    envoyes,
    send(d: Uint8Array) {
      envoyes.push(d);
      if (rejoue) return;
      rejoue = true;
      const entrants = FIXTURE.paquets.filter((p) => p.sens === 'entrant');
      let k = 0;
      const suivant = () => {
        if (ferme) return;
        // fin de la fixture : l'hôte quitte la salle
        if (k >= entrants.length) { setTimeout(() => { if (!ferme) { ferme = true; fermer('le jeu a quitté la salle'); } }, 20); return; }
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
}

test('essai n° 4 du 18 nov. : fixture 1.45b valide, anonyme, double attaque comprise', () => {
  assert.equal(FIXTURE.paquets.length, 436);
  let n = 0;
  for (const p of FIXTURE.paquets) {
    const d = inspectBatch(Buffer.from(p.lot, 'hex'));
    assert.ok(!d.error && d.sizeOk && d.hashOk, `lot invalide à t=${p.t}`);
    for (const m of d.messages) {
      if (m.type !== MESSAGE_TYPE.ClientRpc && m.type !== MESSAGE_TYPE.ServerRpc) continue;
      const r = decode(m.payload);
      assert.ok(!r.name.startsWith('?') && !(REST in r.values), r.name);
      assert.equal(hex(encodeRpc(r)), hex(m.payload), r.name);
      n++;
    }
  }
  assert.ok(n > 800, `${n} RPC`);
  const octets = Buffer.concat(FIXTURE.paquets.map((p) => Buffer.from(p.lot, 'hex')));
  for (const s of ['Hote#0001', 'Invite#0002']) assert.ok(octets.includes(Buffer.from(s, 'utf16le')), `${s} attendu`);
  assert.ok(!octets.includes(Buffer.from('JoyBoy-banc', 'utf16le')), 'pseudo du banc remplacé');
  const noms = new Set(recues().map((x) => x.rpc.name));
  for (const n of ['PlayerDrawLifeClientRpc', 'MoveToSecondLifeTriggerClientRpc', 'TellLeaderCharacterKOdClientRpc']) assert.ok(noms.has(n), n);
});

test('essai n° 4 du 18 nov. : le banc rejoue tout le journal, envoie l’[En attaquant] de Jinbe et ne reste pas figé', async () => {
  const banc = await outil('banc.mjs');
  const jeu = fauxJeu();
  let journal = '';
  const b = banc.lancerBanc({ code: 'W1A2B3C', pilote: 'ia', blocage: 20, vitesse: 0.0005, ecrire: (t: string) => { journal += t; }, connect: async () => jeu });
  const bilan = await b.fini;
  assert.equal(bilan.pilote, 'ia');
  assert.match(bilan.issue, /connexion terminée : le jeu a quitté la salle/);
  assert.equal(bilan.rpcRecues, recues().length, 'tout le journal est lu, double attaque comprise');
  assert.deepEqual(bilan.erreursMiroir, []);
  assert.deepEqual(bilan.nonGerees, {});
  assert.equal(bilan.ia.ecartsMoteurMiroir, 0);
  // L'[En attaquant] de Jinbe (attaquant n° 1, sur Ryuma n° 1) : +1000 à Sanji (n° 0), envoyé avant SelectBlocker.
  const sortie = jeu.envoyes.flatMap((l) => parseBatch(l)).filter((m) => m.type === MESSAGE_TYPE.ServerRpc).map((m) => decode(m.payload));
  const k = sortie.findIndex((r) => r.name === 'SetupAttackServerRpc' && r.values.iAttackerIdx === 1 && r.values.iDefenderIdx === 1);
  assert.ok(k >= 0, 'attaque de Jinbe');
  const fin = sortie.findIndex((r, i) => i > k && r.name === 'SelectBlockerServerRpc');
  assert.ok(sortie.slice(k, fin).some((r) => r.name === 'BuffCardPowerServerRpc' && r.values.iCardIndex === 0 && r.values.iBuff === 1000),
    sortie.slice(k, fin).map((r) => r.name).join(' '));
  // Le jeu de la fixture, lui, n'a jamais reçu ce bonus et a repoussé Sanji : le garde-fou voit le chrono de joy-boy
  // baisser, journalise la décision en attente et finit le tour au lieu de rester figé.
  assert.equal(bilan.ia.deblocages, 1);
  assert.match(bilan.ecarts[0], /IA figée à son tour 8 \(combat attack\/handBack\) : fin de tour forcée/);
  assert.match(journal, />>> IA figée depuis 20 s .*décision 1\/main .*\[end\].*combat attack\/handBack/);
  const derniere = sortie.map((r) => r.name).lastIndexOf('SetupAttackServerRpc');
  assert.ok(sortie.slice(derniere).some((r) => r.name === 'EndTurnServerRpc'), 'fin de tour envoyée après la dernière attaque');
});
