#!/usr/bin/env node
// Régénère game/online/optcgsim/catalog.json, le catalogue des RPC d'OPTCGSim, depuis le code décompilé du jeu
// (NetworkPlayerScript.cs) : empreinte, nom, sens, et l'ordre exact des écritures générées par ILPP entre
// __beginSend… et __endSend…. Reprend l'extracteur du prototype (outils/extraire-catalogue-rpc.mjs).
//
//   node scripts/optcgsim/catalogue.mjs [--source <dossier Source-recupere>] [--sortie <catalog.json>] [--verifier]
//
// --verifier : n'écrit rien, compare au catalogue existant et sort en erreur s'il diffère.
// Lit le code décompilé hors du dépôt (jamais copié dedans) : ne tourne pas dans `npm test`. Aucun accès réseau.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DEFAUT = process.env.OPTCGSIM_SOURCE ?? path.join(os.homedir(), 'Desktop', 'optcgsim', 'Source-recupere');
const SORTIE_DEFAUT = path.join(RACINE, 'game', 'online', 'optcgsim', 'catalog.json');

/** Extrait le catalogue du texte de NetworkPlayerScript.cs : { catalogue, inconnus }. */
export function extraireCatalogue(texte) {
  const lignes = texte.split(/\r?\n/);
  const catalogue = {};
  const inconnus = new Set();
  for (let i = 0; i < lignes.length; i++) {
    const sig = lignes[i].match(/^\s*(?:public|private|internal) void ([A-Za-z0-9_]+(Server|Client)Rpc)\(([^)]*)\)/);
    if (!sig || !/\[(Server|Client)Rpc/.test(lignes[i - 1] ?? '')) continue;
    const [, nom, sens, brut] = sig;
    const types = {};
    for (const p of brut.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = p.match(/^([A-Za-z0-9_\[\]<>.]+) ([A-Za-z0-9_]+)/);
      if (m) types[m[2]] = m[1];
    }
    // Bloc d'envoi
    let debut = -1, hash = null;
    for (let j = i; j < Math.min(i + 400, lignes.length); j++) {
      const b = lignes[j].match(/__beginSend(?:Server|Client)Rpc\((\d+)u/);
      if (b) { debut = j; hash = Number(b[1]); break; }
    }
    if (debut < 0) continue;
    const ecritures = [];
    for (let k = debut + 1; k < lignes.length && !/__endSend/.test(lignes[k]); k++) {
      const l = lignes[k];
      let m;
      if ((m = l.match(/bool (value\d*) = ([A-Za-z0-9_]+) != null;/))) { ecritures.push({ param: m[2], type: types[m[2]], codage: types[m[2]] === 'string' ? 'chaine' : 'tableau', nullable: true }); continue; }
      if (/WriteValueSafe\(in value\d*, default\(FastBufferWriter\.ForPrimitives\)\)/.test(l)) continue; // drapeau « non nul » déjà compté
      if (/^\s*if \(value\d*\)|^\s*[{}]\s*$/.test(l)) continue;
      if ((m = l.match(/BytePacker\.WriteValueBitPacked\(bufferWriter, ([A-Za-z0-9_]+)\)/))) {
        const t = types[m[1]] ?? '?'; ecritures.push({ param: m[1], type: t, codage: t === 'int' ? 'int-compacte' : t === 'ulong' ? 'ulong-compacte' : t === 'uint' ? 'uint-compacte' : `compacte-${t}` }); continue;
      }
      if ((m = l.match(/WriteValueSafe\(in ([A-Za-z0-9_]+), default\(FastBufferWriter\.(ForPrimitives|ForEnums|ForNetworkSerializable|ForStructs)\)\)/))) {
        const t = types[m[1]] ?? '?';
        const codage = m[2] === 'ForEnums' ? 'enum' : m[2] === 'ForNetworkSerializable' ? 'serialisable' : t === 'bool' ? 'bool' : t === 'float' ? 'float' : `brut-${t}`;
        ecritures.push({ param: m[1], type: t, codage }); continue;
      }
      if ((m = l.match(/WriteValueSafe\(([A-Za-z0-9_]+)(?:, default\(FastBufferWriter\.(\w+)\))?\)/))) {
        // corps d'une chaîne ou d'un tableau nullable : déjà déclaré par le drapeau
        const dernier = ecritures[ecritures.length - 1];
        if (dernier?.param === m[1]) { if (m[2]) dernier.forme = m[2]; continue; }
      }
      if (/\S/.test(l)) inconnus.add(`${nom}: ${l.trim()}`);
    }
    catalogue[hash] = { nom, sens: sens === 'Server' ? 'client->hote' : 'hote->clients', ecritures };
  }
  return { catalogue, inconnus: [...inconnus] };
}

function main() {
  const args = process.argv.slice(2);
  let source = SOURCE_DEFAUT, sortie = SORTIE_DEFAUT, verifier = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') source = path.resolve(args[++i]);
    else if (args[i] === '--sortie') sortie = path.resolve(args[++i]);
    else if (args[i] === '--verifier') verifier = true;
    else { console.error('Usage : node scripts/optcgsim/catalogue.mjs [--source dossier] [--sortie fichier] [--verifier]'); process.exit(2); }
  }
  const fichier = path.join(source, 'Assembly-CSharp', 'NetworkPlayerScript.cs');
  if (!fs.existsSync(fichier)) { console.error(`Code décompilé introuvable : ${fichier} (--source).`); process.exit(2); }
  const { catalogue, inconnus } = extraireCatalogue(fs.readFileSync(fichier, 'utf8'));
  const texte = JSON.stringify(catalogue, null, 1) + '\n';
  const n = Object.keys(catalogue).length;
  const codages = {};
  for (const r of Object.values(catalogue)) for (const e of r.ecritures) codages[e.codage] = (codages[e.codage] ?? 0) + 1;
  console.log(`${n} RPC lues dans ${fichier}`);
  console.log('Codages :', JSON.stringify(codages));
  if (inconnus.length) { console.log(`${inconnus.length} ligne(s) non reconnue(s) :`); for (const l of inconnus.slice(0, 30)) console.log('  ', l); }
  if (verifier) {
    const actuel = fs.existsSync(sortie) ? fs.readFileSync(sortie, 'utf8') : '';
    if (actuel.replace(/\r\n/g, '\n') === texte) { console.log(`Identique à ${sortie}.`); return; }
    console.error(`DIFFÉRENT de ${sortie} : relance sans --verifier pour le régénérer.`); process.exit(1);
  }
  fs.writeFileSync(sortie, texte);
  console.log(`Écrit : ${sortie}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
