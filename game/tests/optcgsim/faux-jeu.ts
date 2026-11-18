// Faux jeu OPTCGSim des tests de la session (O3.1) : rejoue les lots de l'hôte de la partie anonymisée du 17 nov.
// (fixture 0859) sur un faux transport, sans aucun accès réseau ; le joueur joy-boy y est joué par l'IA heuristique.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { heuristicChooser } from '../../ai/heuristic.ts';
import { DECKS } from '../../engine/decks.ts';
import { buildBatch, MESSAGE_TYPE, parseBatch } from '../../online/optcgsim/netcode.ts';
import { decode, rpcMessage } from '../../online/optcgsim/rpc.ts';
import type { CrossplaySession } from '../../online/optcgsim/session.ts';
import type { Channel, Transport } from '../../online/optcgsim/transport.ts';
import type { Rpc } from '../../online/optcgsim/types.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const FIXTURE = (JSON.parse(fs.readFileSync(ici('./fixtures/journal-2026-11-17-0859.json'), 'utf8')) as { paquets: Paquet[] }).paquets;
export const ENTRANTS = FIXTURE.filter((p) => p.sens === 'entrant').map((p) => ({ lot: Buffer.from(p.lot, 'hex') as Uint8Array, canal: p.canal }));

export const st01 = () => ({ leader: DECKS['ST-01'].leader, cards: Object.entries(DECKS['ST-01'].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) });

/** Faux jeu : rejoue les lots donnés dès la demande de connexion ; `arret` : nombre de lots avant de s'arrêter. */
/** `pause` : le faux hôte s'arrête dès qu'elle est vraie (il attend alors, comme un vrai joueur qui attend notre coup). */
export function fauxJeu(lots = ENTRANTS, { arret, fin, pause }: { arret?: number; fin?: string; pause?: () => boolean } = {}) {
  const envoyes: Uint8Array[] = [];
  let recevoir: (d: Uint8Array, c?: Channel) => void = () => {};
  let fermer: (r: string) => void = () => {};
  let ferme = false, rejoue = false;
  const transport: Transport = {
    userId: 'JOUEUR-TEST',
    send(d) {
      envoyes.push(d);
      if (rejoue) return;
      rejoue = true;
      let k = 0;
      const suivant = () => {
        if (ferme || pause?.()) return;
        if (k >= (arret ?? lots.length)) { if (fin) { ferme = true; fermer(fin); } return; }
        const p = lots[k++];
        recevoir(p.lot, p.canal as Channel);
        setTimeout(suivant, 1);
      };
      setTimeout(suivant, 1);
    },
    onData(h) { recevoir = h; },
    onClose(h) { fermer = h; },
    close() { if (!ferme) { ferme = true; fermer('fermée par joy-boy'); } },
  };
  const rpcs = (): Rpc[] => envoyes.flatMap((l) => parseBatch(l)).filter((m) => m.type === MESSAGE_TYPE.ServerRpc).map((m) => decode(m.payload));
  return { transport, rpcs };
}

/**
 * Le joueur joy-boy joue avec l'IA heuristique, dès que sa vue lui donne une décision (tout de suite : le faux hôte
 * rejoue la partie sans attendre nos coups, comme le banc le faisait).
 */
export function joueurIA(s: CrossplaySession) {
  let occupe = false;
  s.onChange(() => {
    if (occupe) return;
    occupe = true;
    try {
      for (let garde = 0; garde < 100; garde++) {
        const v = s.snapshot();
        const d = v.state?.decision;
        if (!d || d.player !== 1 || v.end) break;
        s.answer(v.seq, heuristicChooser(v.state!, d));
      }
    } finally { occupe = false; }
  });
}

/** Les lots de l'hôte, avec ces cartes à la place des premières cartes de son deck (Décision 4). */
export function avecCartes(codes: string[]) {
  let k = 0;
  return ENTRANTS.map(({ lot, canal }) => {
    const messages = parseBatch(lot);
    let touche = false;
    const nouveaux = messages.map((m) => {
      if (m.type !== MESSAGE_TYPE.ClientRpc) return m;
      const r = decode(m.payload);
      if (r.name !== 'LoadDeckCardClientRpc' || r.object === 2 || k >= codes.length) return m;
      touche = true;
      const msg = rpcMessage(r.name, { ...r.values, sCardID: codes[k++] }, { object: r.object, behaviour: r.behaviour });
      return { ...m, payload: msg.payload };
    });
    return { lot: touche ? buildBatch(nouveaux) : lot, canal };
  });
}


/** Tirage fixé des mélanges (les tests rejouent toujours la même partie). */
export function tirage(graine = 20261118): (max: number) => number {
  let x = graine >>> 0;
  return (max) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % max; };
}
