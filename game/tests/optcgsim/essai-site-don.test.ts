// Écart n° 4 des essais du site (tâche O3.2, 18 nov. 2026, parties de 18 h 18, 20 h 35 et 20 h 40) : OPTCGSim envoie sa
// pioche de DON!! (DrawDon 2) même quand son deck DON!! est vide (10 DON!! déjà sorties) ; le miroir notait un écart
// (« pas de carte top en donDeck »). Il prend maintenant ce qui reste ; et joy-boy n'envoie jamais de pioche de DON!!
// que son moteur n'a pas faite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTable, receive } from '../../online/optcgsim/inbound.ts';
import { applyRpc, counts, createMirror } from '../../online/optcgsim/mirror.ts';
import { MESSAGE_TYPE, parseBatch } from '../../online/optcgsim/netcode.ts';
import { translateOutbound } from '../../online/optcgsim/outbound.ts';
import { decode } from '../../online/optcgsim/rpc.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const FIXTURE = JSON.parse(fs.readFileSync(ici('./fixtures/essais/site-2026-11-18-1818.json'), 'utf8')) as { paquets: Paquet[] };

test('DON!! : pioche demandée avec un deck DON!! vide ou presque, le miroir prend ce qui reste sans écart', () => {
  let m = createMirror();
  const draw = (iCount: number, rested = false) => {
    m = applyRpc(m, { name: rested ? 'DrawRestedDonClientRpc' : 'DrawDonClientRpc', object: 1, behaviour: 0, values: { iCount, clientId: 0 } }, 0).state;
  };
  for (let k = 0; k < 4; k++) draw(2);
  draw(1, true);
  assert.equal(counts(m, 0).donDeck, 1);
  draw(2); // 1 seule restante
  assert.equal(counts(m, 0).donDeck, 0);
  assert.equal(m.players[0].zones.donCost.length, 10);
  draw(2); // plus aucune
  draw(1, true);
  assert.equal(m.players[0].zones.donCost.length, 10);
  assert.deepEqual(m.errors, []);
});

test('DON!! (fixture de 18 h 18) : la partie rejouée par inbound ne note plus d’écart, et joy-boy sans DON!! n’en pioche pas', () => {
  let t = createTable({ joyboy: 1 });
  let vide = false;
  for (const p of FIXTURE.paquets.filter((x) => x.sens === 'entrant')) {
    for (const m of parseBatch(Buffer.from(p.lot, 'hex'))) {
      if (m.type !== MESSAGE_TYPE.ClientRpc) continue;
      const r = decode(m.payload);
      if (r.name === 'DrawDonClientRpc' && r.object === 1 && t.mirror.players[0].zones.donDeck.length < Number(r.values.iCount)) vide = true;
      t = receive(t, r, r.object === 2 ? 1 : 0).table;
    }
  }
  assert.ok(vide, 'la fixture contient bien une pioche de DON!! plus grande que le deck DON!!');
  assert.deepEqual(t.mirror.errors, []);
  // joy-boy avec ses 10 DON!! sorties (deck DON!! vide dans le moteur et dans le miroir) : rien à envoyer pour ses DON!!
  const m = structuredClone(t.mirror), g = structuredClone(t.game!);
  const z = m.players[1].zones;
  while (z.donDeck.length) z.donCost.push({ ...z.donDeck.pop()!, rested: true });
  const P = g.players[1];
  P.donRested = z.donCost.filter((d) => d.rested).length;
  P.donActive = z.donCost.length - P.donRested;
  P.donDeck = 0;
  const out = translateOutbound(m, g, { seat: 1, scope: 'self' });
  assert.ok(!out.rpcs.some((r) => /DrawDon|DrawRestedDon/.test(r.name)), out.rpcs.map((r) => r.name).join(' '));
});
