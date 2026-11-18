#!/usr/bin/env node
// Recapture la demande de connexion d'OPTCGSim (ConfigHash, versions des messages) et met à jour
// game/online/optcgsim/handshake.json. À relancer à chaque changement de version du jeu (Décision 5 du plan).
// Reprend le mode « capture » du prototype : on héberge une salle Relay, le jeu la rejoint, on enregistre sa demande.
//
//   node scripts/optcgsim/capturer.mjs [--sortie <handshake.json>] [--attente <secondes>]
//   node scripts/optcgsim/capturer.mjs --relire <fichier -brut.jsonl> [--sortie <handshake.json>]
//
// Robuste aux changements de format : tous les datagrammes et tous les lots reçus sont enregistrés bruts (hexadécimal)
// dans « <sortie sans .json>-brut.jsonl », à côté de la sortie (hors dépôt si --sortie est hors dépôt) ; une erreur de
// lecture est journalisée sans arrêter la capture ; la demande de connexion est extraite même avec des octets en trop.
// `--relire` refait l'analyse d'un fichier brut, sans réseau.
//
// PARLE AUX SERVEURS UNITY (identification anonyme et Relay) : c'est l'utilisateur qui le lance, avec son jeu ouvert
// (sauf --relire). Ne tourne jamais dans `npm test`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGE_TYPE, decodeConnectionRequest, inspectBatch, messageName, readUInt } from '../../game/online/optcgsim/netcode.ts';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SORTIE_DEFAUT = path.join(RACINE, 'game', 'online', 'optcgsim', 'handshake.json');
const hex = (b) => Buffer.from(b).toString('hex');

/**
 * Nouveau handshake.json à partir de l'ancien et de la charge d'une ConnectionRequest capturée. Le style de la salle
 * est retiré des données de connexion (« 1.45aPrivate » → version « 1.45a ») : on le remet à chaque connexion.
 */
export function majHandshake(ancien, charge, typeMessage, date = new Date()) {
  const info = decodeConnectionRequest(charge);
  const styles = Object.values(ancien.styles ?? {}).sort((a, b) => b.length - a.length);
  const donnees = info.connectionData ?? '';
  const style = styles.find((s) => donnees.endsWith(s));
  if (!style) throw new Error(`Données de connexion inattendues : ${JSON.stringify(donnees)} (style de salle introuvable).`);
  return {
    ...ancien,
    gameVersion: donnees.slice(0, donnees.length - style.length),
    capturedAt: date.toISOString(),
    messageType: typeMessage,
    configHash: info.configHash,
    versions: info.versions,
    connectionData: donnees,
    payloadHex: Buffer.from(charge).toString('hex'),
  };
}

/** Essaie de lire des octets comme une suite de messages NGO (type, taille compactés) : pour le diagnostic. */
export function lireMessagesLibres(octets) {
  const b = Buffer.from(octets), out = [];
  let o = 0;
  try {
    while (o < b.length) {
      // Un entier compacté annonce 1 à 5 octets (3 bits de poids faible) : 0, 6 ou 7 = pas un message.
      const valide = (x) => (x & 7) >= 1 && (x & 7) <= 5;
      if (!valide(b[o])) break;
      const t = readUInt(b, o);
      if (t.next >= b.length || !valide(b[t.next])) break;
      const s = readUInt(b, t.next);
      if (s.next + s.value > b.length) break;
      out.push({ type: t.value, nom: messageName(t.value), taille: s.value });
      o = s.next + s.value;
    }
  } catch { /* fin illisible */ }
  return { messages: out, lus: o, reste: b.length - o };
}

/**
 * Analyse un lot reçu sans jamais lever d'erreur : lignes de journal et, s'il y en a une, la demande de connexion
 * (type et charge) lue dans le lot, même avec des octets en trop, une taille ou une empreinte fausses.
 */
export function analyserLot(lot, canal = 'fiable') {
  const b = Buffer.from(lot), lignes = [];
  const d = inspectBatch(b);
  if (d.error === 'pas un lot NGO') {
    lignes.push(`lot ${canal} (${b.length} o) : pas un lot NGO (début ${hex(b.subarray(0, 16))})`);
    return { lignes, demande: null, inspection: d };
  }
  lignes.push(`lot ${canal} (${b.length} o) : ${d.count} message(s) annoncé(s), ${d.messages.length} lu(s), taille ${d.sizeOk ? 'ok' : `FAUSSE (en-tête ${b.readInt32LE(4)})`}, empreinte ${d.hashOk ? 'ok' : 'FAUSSE'}${d.error ? `, erreur : ${d.error}` : ''}`);
  for (const m of d.messages) lignes.push(`   ${messageName(m.type)} (#${m.type}, ${m.payload.length} o)`);
  if (d.trailing) {
    const reste = b.subarray(b.length - d.trailing);
    lignes.push(`   ${d.trailing} octet(s) en trop après le dernier message : ${hex(reste)}`);
    if (reste.length >= 2 && reste.readUInt16LE(0) === 4448) lignes.push('   → le reste commence par l’en-tête d’un lot NGO (deux lots collés ?)');
    const libres = lireMessagesLibres(reste);
    if (libres.messages.length) lignes.push(`   → lu comme messages : ${libres.messages.map((m) => `${m.nom} (${m.taille} o)`).join(', ')}${libres.reste ? `, puis ${libres.reste} o illisibles` : ''}`);
  }
  const m = d.messages.find((x) => x.type === MESSAGE_TYPE.ConnectionRequest);
  return { lignes, demande: m ? { type: m.type, payload: Buffer.from(m.payload) } : null, inspection: d };
}

/** Décrit la demande décodée (champs inconnus compris) pour le journal. */
export function decrireDemande(payload) {
  const info = decodeConnectionRequest(payload);
  const l = [`demande : ${payload.length} o, ${info.versions.length} versions de messages, ConfigHash ${info.configHash}, données ${JSON.stringify(info.connectionData)}`];
  if (info.extraHex) l.push(`   octets inconnus avant les données de connexion : ${info.extraHex}`);
  if (info.trailingHex) l.push(`   octets inconnus après les données de connexion : ${info.trailingHex}`);
  return { info, lignes: l };
}

function cheminBrut(sortie) { return sortie.replace(/\.json$/i, '') + '-brut.jsonl'; }

/**
 * Traite une demande capturée : écrit la sortie si elle se lit. Rend true si handshake.json a été écrit.
 */
function traiterDemande(demande, ancien, sortie, log) {
  try {
    for (const l of decrireDemande(demande.payload).lignes) log(l);
    const nouveau = majHandshake(ancien, demande.payload, demande.type);
    fs.writeFileSync(sortie, JSON.stringify(nouveau, null, 1) + '\n');
    log(`Demande capturée : version ${nouveau.gameVersion}, ConfigHash ${nouveau.configHash}, ${nouveau.versions.length} types de messages.`);
    if (nouveau.configHash !== ancien.configHash) log(`ConfigHash changé : ${ancien.configHash} → ${nouveau.configHash}`);
    log(`Écrit : ${sortie}`);
    if (nouveau.gameVersion !== ancien.gameVersion) log(`ATTENTION : version ${ancien.gameVersion} → ${nouveau.gameVersion}, régénère aussi le catalogue (catalogue.mjs).`);
    return true;
  } catch (e) {
    log(`Demande illisible : ${e.message} (octets : ${hex(demande.payload)})`);
    return false;
  }
}

/** Relit un fichier brut (lignes JSON { t, sens, genre, canal, hex }) et refait l'analyse, sans réseau. */
export function relire(fichier, ancien, sortie, log = console.log) {
  let ecrit = false;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    if (!ligne.trim()) continue;
    const e = JSON.parse(ligne);
    if (e.genre !== 'lot') continue;
    const a = analyserLot(Buffer.from(e.hex, 'hex'), e.canal);
    for (const l of a.lignes) log(l);
    if (a.demande && !ecrit) ecrit = traiterDemande(a.demande, ancien, sortie, log);
  }
  return ecrit;
}

async function main() {
  const args = process.argv.slice(2);
  let sortie = SORTIE_DEFAUT, attente = 5, relu = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sortie') sortie = path.resolve(args[++i]);
    else if (args[i] === '--attente') attente = Number(args[++i]);
    else if (args[i] === '--relire') relu = path.resolve(args[++i]);
    else { console.error('Usage : node scripts/optcgsim/capturer.mjs [--sortie handshake.json] [--attente s] [--relire brut.jsonl]'); process.exit(2); }
  }
  const ancien = JSON.parse(fs.readFileSync(SORTIE_DEFAUT, 'utf8'));
  if (relu) { process.exit(relire(relu, ancien, sortie) ? 0 : 1); }

  const brut = cheminBrut(sortie), t0 = Date.now();
  fs.writeFileSync(brut, '');
  const noter = (genre, sens, canal, octets) =>
    fs.appendFileSync(brut, JSON.stringify({ t: Date.now() - t0, sens, genre, canal, hex: hex(octets) }) + '\n');
  console.log(`Octets bruts enregistrés dans : ${brut}`);

  const { host } = await import('../../game/online/optcgsim/transport.ts');
  const salle = await host({
    log: (l) => console.log(l),
    onPacket: (sens, p) => { try { noter('paquet', sens, null, p); } catch { /* disque */ } },
  });
  console.log('\n=============================================================');
  console.log(`  Dans OPTCGSim : Rejoindre, puis entre le code   P${salle.joinCode}`);
  console.log('=============================================================\n');
  let ecrit = false, fin = null, lots = 0;
  const terminer = (code) => { salle.close(); setTimeout(() => process.exit(code), 300); };
  const t = await salle.accepted;
  t.onClose?.((r) => { console.log(`Connexion fermée : ${r}`); if (!fin) fin = setTimeout(() => terminer(ecrit ? 0 : 1), 200); });
  t.onData((lot, canal) => {
    lots++;
    try { noter('lot', 'reçu', canal ?? 'fiable', lot); } catch { /* disque */ }
    try {
      const a = analyserLot(lot, canal ?? 'fiable');
      for (const l of a.lignes) console.log(l);
      if (a.demande && !ecrit) ecrit = traiterDemande(a.demande, ancien, sortie, console.log);
      // On continue d'écouter quelques secondes après la première demande : d'autres lots peuvent aider l'analyse.
      if (a.demande && !fin) fin = setTimeout(() => { console.log(`${lots} lot(s) reçu(s), fin de la capture.`); terminer(ecrit ? 0 : 1); }, attente * 1000);
    } catch (e) { console.log(`Erreur d'analyse (capture poursuivie) : ${e.message}`); }
  });
  process.on('SIGINT', () => terminer(ecrit ? 0 : 1));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
