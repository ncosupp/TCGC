#!/usr/bin/env node
// Recapture la demande de connexion d'OPTCGSim (ConfigHash, versions des messages) et met à jour
// game/online/optcgsim/handshake.json. À relancer si le jeu change de version (gel en 1.45a, décision du 17 nov.).
// Reprend le mode « capture » du prototype : on héberge une salle Relay, le jeu la rejoint, on enregistre sa demande.
//
//   node scripts/optcgsim/capturer.mjs [--sortie <handshake.json>]
//
// PARLE AUX SERVEURS UNITY (identification anonyme et Relay) : c'est l'utilisateur qui le lance, avec son jeu ouvert.
// Ne tourne jamais dans `npm test`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGE_TYPE, decodeConnectionRequest, parseBatch } from '../../game/online/optcgsim/netcode.ts';
import { host } from '../../game/online/optcgsim/transport.ts';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SORTIE_DEFAUT = path.join(RACINE, 'game', 'online', 'optcgsim', 'handshake.json');

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

async function main() {
  const args = process.argv.slice(2);
  let sortie = SORTIE_DEFAUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sortie') sortie = path.resolve(args[++i]);
    else { console.error('Usage : node scripts/optcgsim/capturer.mjs [--sortie handshake.json]'); process.exit(2); }
  }
  const ancien = JSON.parse(fs.readFileSync(SORTIE_DEFAUT, 'utf8'));
  const salle = await host({ log: (l) => console.log(l) });
  console.log('\n=============================================================');
  console.log(`  Dans OPTCGSim : Rejoindre, puis entre le code   P${salle.joinCode}`);
  console.log('=============================================================\n');
  const t = await salle.accepted;
  t.onData((lot) => {
    const demande = parseBatch(lot).find((m) => m.type === MESSAGE_TYPE.ConnectionRequest);
    if (!demande) return;
    const nouveau = majHandshake(ancien, demande.payload, demande.type);
    fs.writeFileSync(sortie, JSON.stringify(nouveau, null, 1) + '\n');
    console.log(`Demande capturée : version ${nouveau.gameVersion}, ConfigHash ${nouveau.configHash}, ${nouveau.versions.length} types de messages.`);
    console.log(`Écrit : ${sortie}`);
    if (nouveau.gameVersion !== ancien.gameVersion) console.log(`ATTENTION : version ${ancien.gameVersion} → ${nouveau.gameVersion}, régénère aussi le catalogue (catalogue.mjs).`);
    salle.close();
    setTimeout(() => process.exit(0), 300);
  });
  process.on('SIGINT', () => { salle.close(); setTimeout(() => process.exit(0), 200); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
