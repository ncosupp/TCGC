// Intégration de la vague O5-1 (chef de projet ; audit O5.0 § 5.2) : les journaux réels déjà gardés (parties du 17 nov.,
// banc et site du 18 nov.) rejoués dans une session avec le filet anti-impasse actif (attente.ts, O5.1) et le combat
// d'O5.3 branché. Pas de faux positif attendu : aucun déblocage.
//
// Limite du rejeu : le faux jeu rejoue les lots de l'hôte sans attendre nos coups, pendule comprise. Quand le joueur
// joy-boy d'origine réfléchissait (la pendule de joy-boy baissait chez l'hôte), l'IA de ce rejeu a déjà répondu, ou n'a
// rien à décider (ses coups diffèrent) : ces secondes simulent alors une impasse qui n'existait pas. Deux rejeux :
// - pendule complète, pour les parties où le rejeu reste couplé (0859, banc 0913 et 1210) ;
// - les 7 journaux, sans les secondes de réflexion du joueur joy-boy d'origine (chrono où seul `fClientTime` baisse) :
//   la pendule de l'hôte, le suivi d'iPlayerAction et le cas H (SwitchTurns correctif) restent éprouvés.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildBatch, MESSAGE_TYPE, parseBatch } from '../../online/optcgsim/netcode.ts';
import { decode } from '../../online/optcgsim/rpc.ts';
import { startSession } from '../../online/optcgsim/session.ts';
import { DECKS } from '../../engine/decks.ts';
import { fauxJeu, joueurIA, st01, tirage } from './faux-jeu.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const BR = String.fromCharCode(10);
interface Paquet { sens: 'entrant' | 'sortant'; canal: string; lot: string }
type Lot = { lot: Uint8Array; canal: string };
const lots = (f: string): Lot[] => (JSON.parse(fs.readFileSync(ici(`./fixtures/${f}`), 'utf8')) as { paquets: Paquet[] }).paquets
  .filter((p) => p.sens === 'entrant').map((p) => ({ lot: Buffer.from(p.lot, 'hex') as Uint8Array, canal: p.canal }));

/** Les mêmes lots sans les chronos où seule la pendule de joy-boy baisse (réflexion du joueur d'origine). */
function sansReflexion(l: Lot[]): Lot[] {
  let me: number | null = null;
  return l.map((p) => ({
    ...p,
    lot: buildBatch(parseBatch(p.lot).filter((m) => {
      if (m.type !== MESSAGE_TYPE.ClientRpc) return true;
      const r = decode(m.payload);
      if (r.name !== 'SetTimerClientRpc') return true;
      const v = Number(r.values.fClientTime), garde = me === null || v >= me;
      me = v;
      return garde;
    })),
  })).filter((p) => parseBatch(p.lot).length);
}

const SABO = { leader: DECKS['META-SABO-2026-10'].leader, cards: Object.entries(DECKS['META-SABO-2026-10'].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) };
/** Journal, et deck du joueur joy-boy d'origine (ST-01, ou Sabo pour les parties du site). */
const FIXTURES: [string, () => { leader: string; cards: string[] }][] = [
  ['journal-2026-11-17-0841.json', st01], ['journal-2026-11-17-0859.json', st01], ['essais/banc-2026-11-18-0913.json', st01],
  ['essais/banc-2026-11-18-1210.json', st01], ['essais/banc-2026-11-18-1213.json', st01],
  ['essais/site-2026-11-18-1630.json', () => SABO], ['essais/site-2026-11-18-1818.json', () => SABO],
];
const COUPLES = new Set(['journal-2026-11-17-0859.json', 'essais/banc-2026-11-18-0913.json', 'essais/banc-2026-11-18-1210.json']);

async function rejouer(l: Lot[], deck: { leader: string; cards: string[] }) {
  const jeu = fauxJeu(l, { fin: 'le jeu a quitté la salle' });
  const lignes: string[] = [];
  const s = startSession({ code: 'P1A2B3C', deck, name: 'JoyBoy', connect: async () => jeu.transport, closeDelayMs: 0, randomInt: tirage(), log: (x) => lignes.push(x) });
  joueurIA(s);
  const fin = await s.done;
  return { s, fin, texte: lignes.join(BR) };
}

for (const [f, deck] of FIXTURES) {
  if (COUPLES.has(f)) {
    test(`rejeu avec le filet actif, pendule complète, ${f} : aucun déblocage`, { timeout: 60_000 }, async () => {
      const r = await rejouer(lots(f), deck());
      assert.equal(r.s.stats().unstuck, 0, r.texte);
    });
  }
  test(`rejeu avec le filet actif, sans la réflexion du joueur d'origine, ${f} : aucun déblocage`, { timeout: 60_000 }, async () => {
    const r = await rejouer(sansReflexion(lots(f)), deck());
    assert.equal(r.s.stats().unstuck, 0, r.texte);
  });
}
