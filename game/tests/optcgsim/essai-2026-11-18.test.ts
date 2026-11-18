// Premier essai réel complet du banc (18 nov. 2026, tâche O2.4-b) : OPTCGSim 1.45b, pilote ia, deck ST-01 (joy-boy,
// siège 1) contre Sabo OP13-004 (hôte), 9 tours. Le journal, anonymisé, est la fixture essais/banc-2026-11-18-0913.json.
// Rejoué ici sur un faux transport (aucun accès réseau). Les écarts constatés sont décrits dans le test « todo » : il
// échoue tant qu'ils ne sont pas corrigés, sans casser `npm test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTable, receive } from '../../online/optcgsim/inbound.ts';
import { MESSAGE_TYPE, inspectBatch, parseBatch } from '../../online/optcgsim/netcode.ts';
import { REST, decode, encodeRpc } from '../../online/optcgsim/rpc.ts';
import type { Rpc, Seat } from '../../online/optcgsim/types.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const outil = async (nom: string): Promise<any> => import(new URL(`../../../scripts/optcgsim/${nom}`, import.meta.url).href);
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const FIXTURE = JSON.parse(fs.readFileSync(ici('./fixtures/essais/banc-2026-11-18-0913.json'), 'utf8')) as { paquets: Paquet[] };
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
}

test('essai du 18 nov. : fixture 1.45b valide, anonyme, chaque RPC décodée et réencodée à l’octet près', () => {
  assert.equal(FIXTURE.paquets.length, 282);
  let n = 0;
  for (const p of FIXTURE.paquets) {
    const lot = Buffer.from(p.lot, 'hex'), d = inspectBatch(lot);
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
});

test('essai du 18 nov. : rejouée seule par inbound (puissances du moteur), la partie ne laisse aucun écart du miroir', () => {
  // Diagnostic de l'écart n° 3 : avec la puissance calculée par le moteur (effets passifs compris), le miroir de la
  // table croisée suit la partie sans erreur ; les 6 erreurs du bilan viennent du second miroir du banc.
  let t = createTable({ joyboy: 1 });
  for (const { rpc, siege } of recues()) t = receive(t, rpc, siege).table;
  assert.deepEqual(t.mirror.errors, []);
  assert.deepEqual(t.mirror.unhandled, {});
});

test('essai du 18 nov. : le banc (pilote ia) rejoue la partie sans écart', {
  todo: 'écarts n° 1 et 2 : inbound.ts (O2.2), rattrapage d’un moteur en avance de deux pas ; n° 3 : miroir du banc sans la puissance du moteur (banc.mjs)',
}, async () => {
  const banc = await outil('banc.mjs');
  const b = banc.lancerBanc({ code: 'W1A2B3C', pilote: 'ia', vitesse: 0.0005, ecrire: () => {}, connect: async () => fauxJeu() });
  const bilan = await b.fini;
  assert.equal(bilan.pilote, 'ia');
  assert.match(bilan.issue, /défaite de joy-boy \(touché sans vie\)/);
  assert.deepEqual(bilan.nonGerees, {});
  // n° 1 et 2 (inbound.ts, O2.2) : l'écho d'une action de joy-boy arrive quand le moteur a déjà fait l'action suivante
  // (DrawCard : Usopp ST01-002 déjà posé sur le terrain ; ResolveAttack : Guard Point ST01-014 déjà passé de la Vie à
  // la main puis à la Défausse par son [Déclenchement]) ; resolveOp ne regarde que les zones de départ et d'arrivée.
  assert.deepEqual(bilan.ecarts, [], 'écarts n° 1 et 2 (inbound.ts)');
  assert.equal(bilan.ia.ecartsMoteurMiroir, 0, 'écarts n° 1 et 2 vus par la table croisée');
  // n° 3 (banc.mjs) : le miroir propre au banc n'a que la puissance imprimée ; Jinbe OP17-083 (2000 imprimés, 7000 dans
  // le jeu : +3000 avec Jaguar D. Saul à 16 de coût, +1000 de Sabo, +1000 de Contre) y est mis KO à tort par
  // ResolveAttack (« Attack Fails » dans le jeu) ; ses voisins décalent alors d'une place et les SetCardAbilityUsed de
  // Loki (indice 3) et de Luffy OP17-093 (indice 4) désignent des places vides.
  assert.deepEqual(bilan.erreursMiroir, [], 'écart n° 3 (banc.mjs)');
});
