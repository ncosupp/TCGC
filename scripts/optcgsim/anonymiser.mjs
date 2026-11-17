#!/usr/bin/env node
// Anonymise un journal du prototype OPTCGSim (journal-*.log) et écrit une fixture de test JSON.
//
//   node scripts/optcgsim/anonymiser.mjs <journal.log> [<autre.log> ...] [--sortie <dossier>] [--catalogue <rpc-catalogue.json>]
//
// Pour chaque lot NGO du journal : décode chaque RPC d'après le catalogue, remplace pseudos, identifiants d'appareil
// (sDeviceID) et de joueur (sPlayerID) par des valeurs inventées stables (Hote#0001, Invite#0002...), réencode
// les chaînes (les longueurs changent), reconstruit le lot (taille, empreinte XXH64) et écrit
// game/tests/optcgsim/fixtures/<nom>.json. Refuse d'écrire si une chaîne d'origine subsiste dans la sortie.
// Les journaux eux-mêmes ne doivent jamais entrer dans le dépôt. Aucun accès réseau.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireLot, decoderLot, readPackedSmall, readPackedUInt } from './lib-octets.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOGUE_DEFAUT = [
  path.join(RACINE, 'game/online/optcgsim/catalog.json'),
  path.join('C:\\Users\\nicol\\Desktop\\optcgsim\\prototype-crossplay', 'rpc-catalogue.json'),
];
// Ordre des types de message NGO (tri ordinal, vérifié sur les empreintes du jeu).
const TYPES = ['ConnectionApproved', 'ConnectionRequest', 'AnticipationCounterSyncPing', 'AnticipationCounterSyncPong',
  'ChangeOwnership', 'ClientConnected', 'ClientDisconnected', 'ClientRpc', 'CreateObject', 'DestroyObject', 'DisconnectReason',
  'Named', 'NetworkTransform', 'NetworkVariableDelta', 'ParentSync', 'Proxy', 'Rpc', 'SceneEvent', 'ServerLog', 'ServerRpc',
  'TimeSync', 'Unnamed'];
const CLIENT_RPC = TYPES.indexOf('ClientRpc'), SERVER_RPC = TYPES.indexOf('ServerRpc');
const ZWSP = '\u200b';

// ------------------------------------------------------------------ lecture du journal
/** Extrait les lots d'un journal : [{ t (ms), sens, canal, messages: [{ type, charge }] }]. */
export function lireJournal(texte) {
  const lots = [];
  let cur = null, msg = null, t0 = null, dernier = 0, jour = 0;
  const horloge = (h) => {
    const [a, b, c] = h.split(':'); const [s, ms] = c.split('.');
    return ((+a * 60 + +b) * 60 + +s) * 1000 + +ms;
  };
  for (const ligne of texte.split(/\r?\n/)) {
    const mc = /^\s+complet : ([0-9a-f ]*)$/.exec(ligne);
    if (mc) { if (msg) msg.charge = Buffer.from(mc[1].replace(/ /g, ''), 'hex'); msg = null; continue; }
    const ml = /^\[(\d\d:\d\d:\d\d\.\d{3})\] (.*)$/.exec(ligne);
    if (!ml) continue;
    let t = horloge(ml[1]) + jour * 86400000;
    if (t < dernier) { jour++; t += 86400000; }
    dernier = t; if (t0 === null) t0 = t;
    const corps = ml[2];
    const lot = /^(->|<-) lot (.+?) : (\d+) message/.exec(corps);
    if (lot) { cur = { t: t - t0, sens: lot[1] === '->' ? 'sortant' : 'entrant', canal: lot[2], nb: +lot[3], messages: [] }; lots.push(cur); msg = null; continue; }
    if (!corps.startsWith('    ')) { if (/^(->|<-) /.test(corps)) cur = null; continue; }
    if (!cur) continue;
    const type = TYPES.indexOf(/^\s+(\S+)/.exec(corps)[1]);
    if (type < 0) { msg = null; continue; }
    msg = { type, charge: Buffer.alloc(0) };
    cur.messages.push(msg);
  }
  return { lots: lots.filter((l) => l.messages.length === l.nb), texteSource: texte };
}

// ------------------------------------------------------------------ pseudonymes
class Pseudonymes {
  constructor() { this.noms = new Map(); this.ids = new Map(); this.compteur = 0; this.compteurIds = { appareil: 0, joueur: 0 }; }
  /** Enregistre un pseudo complet (ex. « Nom + ZWSP + #12345 ») et renvoie ses remplaçants. */
  nom(complet) {
    if (!this.noms.has(complet)) {
      const role = this.noms.size === 0 ? 'Hote' : 'Invite';
      const num = String(++this.compteur).padStart(4, '0');
      const base = complet.split(new RegExp(`[${ZWSP}#]`))[0].trim(), tag = /#\d+/.exec(complet)?.[0] ?? null;
      this.noms.set(complet, { complet, base, tag, rempl: `${role}#${num}`, remplBase: role + num, remplTag: `#${num}` });
    }
    return this.noms.get(complet);
  }
  id(valeur, genre) {
    if (!this.ids.has(valeur)) this.ids.set(valeur, { valeur, rempl: `${genre === 'appareil' ? 'APPAREIL' : 'JOUEUR'}-${String(++this.compteurIds[genre]).padStart(4, '0')}` });
    return this.ids.get(valeur);
  }
  /** Remplace dans une chaîne quelconque (ligne de journal de partie incluse). */
  appliquer(s) {
    let r = s;
    for (const { valeur, rempl } of [...this.ids.values()].sort((a, b) => b.valeur.length - a.valeur.length)) r = r.split(valeur).join(rempl);
    const noms = [...this.noms.values()];
    for (const n of [...noms].sort((a, b) => b.complet.length - a.complet.length)) r = r.split(n.complet).join(n.rempl);
    for (const n of noms) if (n.base.length >= 3) r = r.split(n.base).join(n.remplBase);
    for (const n of noms) if (n.tag) r = r.split(n.tag).join(n.remplTag);
    return r;
  }
  /** Toutes les chaînes d'origine qui ne doivent plus apparaître. */
  sensibles() {
    const s = new Set();
    for (const n of this.noms.values()) { s.add(n.complet); if (n.base.length >= 3) s.add(n.base); if (n.tag) s.add(n.tag); }
    for (const i of this.ids.values()) s.add(i.valeur);
    return [...s].filter((x) => x.length >= 3);
  }
}

// ------------------------------------------------------------------ parcours d'une RPC
/**
 * Parcourt les paramètres d'une RPC d'après le catalogue. Pour chaque champ présent, appelle `fn(ecriture, tranche)` ;
 * si `fn` renvoie un Buffer, il remplace la tranche. Les tableaux de structures (non décodables) sont recopiés bruts.
 */
function parcourir(def, p, fn) {
  const sortie = []; let o = 0;
  for (const e of def.ecritures) {
    const debut = o;
    let present = true;
    if (e.nullable) { present = p[o] === 1; o++; }
    if (present) {
      switch (e.codage) {
        case 'chaine': { const l = p.readUInt32LE(o); o += 4 + 2 * l; break; }
        case 'int-compacte': case 'uint-compacte': o = readPackedUInt(p, o).next; break;
        case 'ulong-compacte': o += (p[o] & 15) === 9 ? 9 : readPackedSmall(p, o, 4).next - o; break;
        case 'bool': o += 1; break;
        case 'float': case 'enum': o += 4; break;
        case 'brut-ActionStepResolver': o += 12; break;
        default: sortie.push(p.subarray(debut)); return Buffer.concat(sortie);
      }
    }
    if (o > p.length) throw new Error(`RPC ${def.nom} tronquée`);
    const tranche = p.subarray(debut, o);
    sortie.push(present ? (fn(e, tranche) ?? tranche) : tranche);
  }
  if (o !== p.length) sortie.push(p.subarray(o));
  return Buffer.concat(sortie);
}
const lireChaine = (tranche) => { const l = tranche.readUInt32LE(1); return tranche.subarray(5, 5 + 2 * l).toString('utf16le'); };
const ecrireChaine = (s) => { const l = Buffer.alloc(4); l.writeUInt32LE(s.length); return Buffer.concat([Buffer.from([1]), l, Buffer.from(s, 'utf16le')]); };
const GENRES = { sName: 'nom', sPlayerName: 'nom', sDeviceID: 'appareil', sPlayerID: 'joueur' };

function decouperRpc(charge, catalogue) {
  const o = readPackedSmall(charge, 0, 4), b = readPackedSmall(charge, o.next, 2), h = readPackedUInt(charge, b.next);
  return { entete: charge.subarray(0, h.next), params: charge.subarray(h.next), def: catalogue[String(h.value)] };
}
const estRpc = (type) => type === CLIENT_RPC || type === SERVER_RPC;

// ------------------------------------------------------------------ anonymisation
export function anonymiser(journaux, catalogue) {
  const ps = new Pseudonymes();
  const parsed = journaux.map((j) => lireJournal(j));
  // Passe 1 : collecte des pseudos et identifiants (RPC décodées) et des identifiants des lignes de journal.
  for (const { lots, texteSource } of parsed) {
    for (const m of texteSource.matchAll(/Identification anonyme OK, joueur (\S+)/g)) ps.id(m[1], 'joueur');
    for (const m of texteSource.matchAll(/Salle (\S+) - style/g)) ps.id(m[1], 'joueur');
    for (const lot of lots) for (const msg of lot.messages) {
      if (!estRpc(msg.type)) continue;
      const r = decouperRpc(msg.charge, catalogue);
      if (!r.def) continue;
      parcourir(r.def, r.params, (e, tr) => {
        const genre = GENRES[e.param];
        if (e.codage !== 'chaine' || !genre) return;
        const v = lireChaine(tr);
        if (v) { if (genre === 'nom') ps.nom(v); else ps.id(v, genre); }
      });
    }
  }
  // Passe 2 : réécriture des chaînes et reconstruction des lots.
  const fixtures = parsed.map(({ lots }) => lots.map((lot) => {
    const messages = lot.messages.map((msg) => {
      let charge = msg.charge, rpc;
      if (estRpc(msg.type)) {
        const r = decouperRpc(charge, catalogue);
        rpc = r.def?.nom;
        if (r.def) {
          const params = parcourir(r.def, r.params, (e, tr) => (e.codage === 'chaine' ? ecrireChaine(ps.appliquer(lireChaine(tr))) : undefined));
          charge = Buffer.concat([r.entete, params]);
        }
      }
      return { type: msg.type, nom: TYPES[msg.type], rpc, charge };
    });
    return {
      t: lot.t, sens: lot.sens, canal: lot.canal, lot: construireLot(messages).toString('hex'),
      messages: messages.map(({ nom, rpc }) => (rpc ? { nom, rpc } : { nom })),
    };
  }));
  return { fixtures, sensibles: ps.sensibles() };
}

/** Chaînes d'origine qui subsistent dans la fixture (UTF-16 et UTF-8, dans les octets et dans le JSON). */
export function chercherRestes(fixture, sensibles) {
  const json = JSON.stringify(fixture);
  const octets = Buffer.concat(fixture.paquets.map((p) => Buffer.from(p.lot, 'hex')));
  return sensibles.filter((s) => octets.includes(Buffer.from(s, 'utf16le')) || octets.includes(Buffer.from(s, 'utf8')) || json.includes(s));
}

// ------------------------------------------------------------------ ligne de commande
function main() {
  const args = process.argv.slice(2), journaux = [];
  let sortie = path.join(RACINE, 'game/tests/optcgsim/fixtures'), cataloguePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sortie') sortie = path.resolve(args[++i]);
    else if (args[i] === '--catalogue') cataloguePath = path.resolve(args[++i]);
    else journaux.push(path.resolve(args[i]));
  }
  if (!journaux.length) { console.error('Usage : node scripts/optcgsim/anonymiser.mjs <journal.log>... [--sortie dossier] [--catalogue fichier]'); process.exit(2); }
  let catalogue = null;
  for (const c of cataloguePath ? [cataloguePath] : CATALOGUE_DEFAUT) {
    if (!fs.existsSync(c)) continue;
    const j = JSON.parse(fs.readFileSync(c, 'utf8'));
    if (Object.keys(j).length) { catalogue = j; break; }
  }
  if (!catalogue) { console.error('Catalogue des RPC introuvable (--catalogue).'); process.exit(2); }
  const { fixtures, sensibles } = anonymiser(journaux.map((f) => fs.readFileSync(f, 'utf8')), catalogue);
  fs.mkdirSync(sortie, { recursive: true });
  let echec = false;
  journaux.forEach((f, k) => {
    const nom = /journal-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)/.exec(path.basename(f));
    const id = nom ? `journal-${nom[1]}-${nom[2]}${nom[3]}` : path.basename(f, '.log');
    const fixture = {
      description: 'Journal du prototype OPTCGSim 1.45a, anonymisé (pseudos et identifiants inventés, lots reconstruits). t en ms depuis le premier paquet ; sens vu de joy-boy ; lot = octets NGO complets en hexadécimal.',
      source: id, paquets: fixtures[k],
    };
    const restes = chercherRestes(fixture, sensibles);
    if (restes.length) { console.error(`ECHEC ${id} : ${restes.length} chaîne(s) d'origine subsistent dans la sortie (non écrite).`); echec = true; return; }
    const valide = fixture.paquets.every((p) => { const d = decoderLot(Buffer.from(p.lot, 'hex')); return !d.erreur && d.tailleOk && d.empreinteOk; });
    if (!valide) { console.error(`ECHEC ${id} : lot reconstruit invalide.`); echec = true; return; }
    fs.writeFileSync(path.join(sortie, `${id}.json`), JSON.stringify(fixture, null, 1) + '\n');
    console.log(`${id} : ${fixture.paquets.length} lots écrits, ${sensibles.length} chaînes sensibles vérifiées absentes.`);
  });
  process.exit(echec ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
