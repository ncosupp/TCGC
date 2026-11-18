// Journal complet d'une partie croisée (tâche O3.2), au format du prototype et du banc d'essai : chaque lot NGO échangé
// (octets complets, RPC décodées), plus des lignes « >>> » (ce que fait la session). `scripts/optcgsim/anonymiser.mjs`
// en tire une fixture de test. Partagé par le banc (scripts/optcgsim/banc.mjs) et par les parties du site
// (server/game-crossplay.js, quand TCGC_CROSSPLAY_JOURNAL désigne un dossier).
// Le journal contient des pseudos et des identifiants Unity : il s'écrit toujours HORS du dépôt.
import { inspectBatch, MESSAGE_TYPE, messageName } from './netcode.ts';
import { decode } from './rpc.ts';
import type { Channel, Transport } from './transport.ts';

const hex = (b: Uint8Array, max = 96) => Buffer.from(b).subarray(0, max).toString('hex').replace(/(..)/g, '$1 ').trim() + (b.length > max ? ` … (${b.length} o)` : '');
const resume = (v: Record<string, unknown> | undefined) => Object.entries(v ?? {}).map(([k, x]) => {
  const s = typeof x === 'bigint' ? x.toString() : JSON.stringify(x, (_k, y) => (typeof y === 'bigint' ? y.toString() : y));
  return `${k}=${s && s.length > 60 ? s.slice(0, 57) + '…' : s}`;
}).join(' ');

export interface Journal {
  /** Ligne horodatée (« >>> … » pour ce que fait joy-boy). */
  ligne(...m: unknown[]): void;
  /** Un lot NGO ; `sens` : « -> » envoyé, « <- » reçu. */
  lot(octets: Uint8Array, canal: string, sens: '->' | '<-'): void;
}

/** Journal au format du prototype (lu par anonymiser.mjs : lignes « -> lot … », messages, « complet : »). */
export function creerJournal(ecrire: (texte: string) => void, { console: aussiConsole = false } = {}): Journal {
  const horo = () => `[${new Date().toISOString().slice(11, 23)}]`;
  const brut = (l: string) => { ecrire(l + '\n'); };
  const ligne = (...m: unknown[]) => { const l = `${horo()} ${m.join(' ')}`; brut(l); if (aussiConsole) console.log(l); };
  function lot(octets: Uint8Array, canal: string, sens: '->' | '<-') {
    const d = inspectBatch(octets);
    const messages = d.messages ?? [];
    // bruit : les lots non fiables qui ne portent que l'horloge
    if (canal.startsWith('non fiable') && messages.length && messages.every((m) => messageName(m.type) === 'TimeSync')) return;
    if (d.error) { ligne(sens, canal, `lot illisible (${d.error})`, hex(octets)); return; }
    ligne(sens, `lot ${canal} : ${messages.length} message(s), taille ${d.sizeOk ? 'ok' : 'FAUSSE'}, empreinte ${d.hashOk ? 'ok' : 'FAUSSE'}${d.trailing ? `, ${d.trailing} octet(s) en trop ignorés : ${hex(Buffer.from(octets).subarray(octets.length - d.trailing), 1e7)}` : ''}`);
    for (const m of messages) {
      const nom = messageName(m.type);
      if (m.type === MESSAGE_TYPE.ClientRpc || m.type === MESSAGE_TYPE.ServerRpc) {
        let r = null; try { r = decode(m.payload); } catch { /* journalisé brut */ }
        ligne('   ', r ? `${nom} objet ${r.object}/${r.behaviour} ${r.name}` : nom, r ? resume(r.values) : hex(m.payload, 48));
      } else ligne('   ', `${nom} (#${m.type}, ${m.payload.length} o)`, hex(m.payload, 64));
      brut(`        complet : ${hex(m.payload, 1e7)}`);
    }
  }
  return { ligne, lot };
}

/**
 * Le transport, vu à travers le journal : chaque lot envoyé ou reçu y est écrit avant de passer. Un seul abonné à
 * `onData` (le transport remet au premier les lots arrivés avant), comme dans le banc.
 */
export function journaliser(t: Transport, j: Journal): Transport {
  return {
    get userId() { return t.userId; },
    send(lot) { try { j.lot(lot, 'fiable', '->'); } catch { /* le journal ne bloque jamais la partie */ } t.send(lot); },
    onData(h) {
      t.onData((lot, canal) => {
        try { j.lot(lot, canal ?? 'fiable', '<-'); } catch { /* idem */ }
        h(lot, canal as Channel | undefined);
      });
    },
    onClose: t.onClose ? (h) => t.onClose!((raison) => { try { j.ligne(`>>> Connexion terminée : ${raison}`); } catch { /* idem */ } h(raison); }) : undefined,
    close() { t.close(); },
  };
}
