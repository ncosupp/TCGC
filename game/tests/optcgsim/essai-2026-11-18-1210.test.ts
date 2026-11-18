// Troisième essai réel du banc (18 nov. 2026, 12 h 10) : OPTCGSim 1.45b, pilote ia, deck ST-01 (joy-boy, siège 1),
// leader de l'hôte OP17-079 ; victoire de joy-boy, sans aucun écart. La partie couvre un bloqueur de l'hôte (Loki), des
// contres multiples, un Évènement [Contre] (BuffCardCombat +4000), un [Déclenchement] de joy-boy (Gum-Gum Jet Pistol,
// KO de Ryuma) et deux destructions en un seul effet. Test de non-régression : le banc la rejoue sur un faux transport
// (aucun accès réseau) et doit retrouver la victoire, sans écart ni erreur du miroir.
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
const FIXTURE = JSON.parse(fs.readFileSync(ici('./fixtures/essais/banc-2026-11-18-1210.json'), 'utf8')) as { paquets: Paquet[] };
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
  return {
    userId: 'JOUEUR-TEST',
    send() {
      if (rejoue) return;
      rejoue = true;
      const entrants = FIXTURE.paquets.filter((p) => p.sens === 'entrant');
      let k = 0;
      const suivant = () => {
        if (ferme) return;
        // fin de la fixture : le jeu ferme la salle
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

test('essai n° 3 du 18 nov. : fixture 1.45b valide, anonyme, chaque RPC décodée et réencodée à l’octet près', () => {
  assert.equal(FIXTURE.paquets.length, 297);
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
  for (const n of ['SelectBlockerClientRpc', 'AddCounterAmountClientRpc']) assert.ok(noms.has(n), n);
});

test('essai n° 3 du 18 nov. : le banc (pilote ia) rejoue la partie, victoire, sans écart ni erreur du miroir', async () => {
  const banc = await outil('banc.mjs');
  const b = banc.lancerBanc({ code: 'W1A2B3C', pilote: 'ia', vitesse: 0.0005, ecrire: () => {}, connect: async () => fauxJeu() });
  const bilan = await b.fini;
  assert.equal(bilan.pilote, 'ia');
  assert.match(bilan.issue, /^victoire de joy-boy/);
  assert.deepEqual(bilan.cartesInconnues, []);
  assert.deepEqual(bilan.ecarts, []);
  assert.deepEqual(bilan.erreursMiroir, []);
  assert.deepEqual(bilan.nonGerees, {});
  assert.equal(bilan.ia.ecartsMoteurMiroir, 0);
});
