#!/usr/bin/env node
// Rejeu des parties OPTCGSim enregistrées (format RZ1 de CombatLogs\AutoSaved) dans le miroir des zones (tâche O1.2).
//
// Chaque ligne de déplacement RZ1 (« RZ1|seq|joueur|carte|zone|place|zone|place|… ») est traduite en la RPC
// d'OPTCGSim qui produit ce déplacement (DrawCard, MoveHandCardToDeploy, AttachDonToCard…), appliquée au miroir ; à
// chaque contrôle « RZ1|CHK » écrit par le jeu, on compare les nombres de cartes par zone. On vérifie aussi que la
// carte désignée par la ligne est bien, dans le miroir, à la place indiquée (même code, même instance).
//
//   node scripts/optcgsim/rejouer-rz1.mjs rejouer <partie.log | dossier>... [--journaux <dossier>] [--fixtures <dossier>]
//        rejoue les parties, puis écrit le rapport de couverture des RPC (par fréquence)
//   node scripts/optcgsim/rejouer-rz1.mjs extrait <partie.log> <sortie.rz1>
//        extrait anonymisé pour les tests : lignes RZ1 de déplacement et de contrôle seulement, pseudos remplacés
//   node scripts/optcgsim/rejouer-rz1.mjs fixture <journal.json> <sortie.json> --catalogue <rpc-catalogue.json>
//        liste des RPC décodées d'une fixture anonymisée (en attendant le codec de la tâche O1.1)
//
// Les parties et les journaux restent hors du dépôt (ils contiennent des pseudos) ; seuls les extraits anonymisés vont
// dans game/tests/optcgsim/fixtures/miroir/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRpc, cardAt, cloneMirror, counts, createMirror, DON, knownRpcs } from '../../game/online/optcgsim/mirror.ts';
import { decoderLot, readPackedSmall, readPackedUInt } from './lib-octets.mjs';

/** Zones RZ1 (ReplaySyncZone) → zones du miroir. 9 = DON attachée (place = parent × 100 + rang, parent 99 = leader). */
export const ZONE_RZ1 = ['deck', 'hand', 'deploy', 'life', 'donDeck', 'donCost', 'trash', 'stage', 'leader', 'attached'];
const CHAMPS_CHK = ['deck', 'hand', 'deploy', 'life', 'donDeck', 'donCost', 'trash', 'stage', 'leader', 'attachedDon'];

// ---------------------------------------------------------------------------------------------------- lecture RZ1

/** Lit une partie RZ1 : { type: 'hdr' | 'ply' | 'move' | 'chk', … } dans l'ordre du fichier. */
export function lireRz1(texte) {
  const evts = [];
  for (const ligne of texte.split(/\r?\n/)) {
    if (!ligne.startsWith('RZ1|')) continue;
    const f = ligne.split('|');
    if (f[1] === 'HDR') evts.push({ type: 'hdr', version: f[2] });
    else if (f[1] === 'PLY') evts.push({ type: 'ply', joueur: Number(f[2]), nom: f[3], leader: f[4] });
    else if (f[1] === 'CHK' && f.length >= 14) {
      const n = f.slice(4, 14).map(Number);
      evts.push({ type: 'chk', seq: Number(f[2]), joueur: Number(f[3]), compte: Object.fromEntries(CHAMPS_CHK.map((k, i) => [k, n[i]])) });
    } else if (/^\d+$/.test(f[1]) && f.length >= 14) {
      const [seq, joueur, , oz, os, dz, ds, vp, ve, repos, puissance, cout, inst] = f.slice(1).map((x, i) => (i === 2 ? x : Number(x)));
      evts.push({ type: 'move', seq, joueur, code: f[3], oz, os, dz, ds, vp, ve, repos: repos === 1, puissance, cout, inst });
    }
  }
  return evts;
}

/** Extrait anonymisé : en-tête, joueurs (pseudos remplacés), déplacements et contrôles. */
export function extraitAnonyme(texte) {
  const sortie = [];
  for (const ligne of texte.split(/\r?\n/)) {
    const f = ligne.split('|');
    if (f[0] !== 'RZ1') continue;
    if (f[1] === 'HDR') sortie.push(ligne);
    else if (f[1] === 'PLY') sortie.push(['RZ1', 'PLY', f[2], f[3] ? `Joueur${f[2]}` : '', f[4] ?? ''].join('|'));
    else if (f[1] === 'CHK' || /^\d+$/.test(f[1])) sortie.push(ligne);
  }
  return sortie.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------- traduction

const rpc = (name, values = {}) => ({ name: `${name}ClientRpc`, object: 0, behaviour: 0, values });
const parent = (place) => (Math.floor(place / 100) === 99 ? -1 : Math.floor(place / 100));
/** Permutation qui déplace la carte n° de vers la place a (nouvelle[j] = ancienne[ordre[j]]). */
const unDeplacement = (n, de, a) => { const o = [...Array(n).keys()]; o.splice(de, 1); o.splice(a, 0, de); return o.join('-'); };

/**
 * RPC d'OPTCGSim équivalentes à une ligne de déplacement, vues du joueur propriétaire de la carte (variantes « My »),
 * ou null si la ligne ne fait que signaler l'état d'une carte restée à sa place (inclinaison, puissance).
 * Rend { rpcs, envoyeur } ; rpcs vide = aucune RPC ne produit ce déplacement.
 */
export function equivalent(m, etat, siege) {
  const z = etat.players[siege].zones;
  const haut = (zone) => z[zone].length - 1;
  const { oz, os, dz, ds } = m;
  const autre = siege === 0 ? 1 : 0;
  const un = (...rpcs) => ({ rpcs, envoyeur: siege });
  if (oz === dz && os === ds) {
    // Signalement d'état (FlushFieldState, EmitCurrentZoneState) : seule l'inclinaison des cartes sur le terrain compte.
    const carte = oz === 8 ? etat.players[siege].leader : ZONE_RZ1[oz] === 'attached' ? undefined : z[ZONE_RZ1[oz]][os];
    if (!carte || !['deploy', 'leader', 'stage', 'donCost'].includes(ZONE_RZ1[oz]) || (carte.rested === true) === m.repos) return null;
    if (oz === 2 || oz === 8) return un(rpc(m.repos ? 'TapCard' : 'UntapCard', { iCardIndex: oz === 8 ? -1 : os }));
    if (oz === 7) return un(rpc(m.repos ? 'TapStageCard' : 'UntapStage'));
    return un(rpc(m.repos ? 'TapDon' : 'UntapDon', { iCount: 1 }));
  }
  switch (`${oz}>${dz}`) {
    case '0>0': return un(rpc('ShuffleDeck', { s_ShuffleString: unDeplacement(z.deck.length, os, ds) }));
    case '1>1': return un(rpc('ShuffleHand', { s_ShuffleString: unDeplacement(z.hand.length, os, ds) }));
    case '0>1': return un(os === haut('deck') ? rpc('DrawCard', { iCount: 1 }) : rpc('DrawSpecificCard', { iCardIndex: os }));
    case '0>2': return un(rpc('PlayCardFromDeck', { iCardIndex: os, bRested: m.repos }));
    case '0>3':
      if (os !== haut('deck')) return un(rpc('MoveSpecificDeckCardToLife', { iCardIndex: os, bForceFaceUp: false }));
      return un(ds === 0 && z.life.length ? rpc('SendDeckToBottomLife') : rpc('SendDeckToLife'));
    case '0>6': return un(os === haut('deck') ? rpc('MillCard', { iCount: 1 }) : rpc('MoveDeckCardToTrash', { iCardIndex: os }));
    case '0>7': return un(rpc('MoveDeckCardToStage', { iIdx: os }));
    case '1>0':
      if (ds === z.deck.length) return un(rpc('MoveHandCardToDeckTop', { iCardIdx: os }));
      return ds === 0 ? un(rpc('MoveHandCardToDeckBottom', { iCardIdx: os })) : un();
    case '1>2': return un(rpc('MoveHandCardToDeploy', { iIdx: os, bRested: m.repos }));
    case '1>3': return un(rpc('SendHandCardToMyLife', { iHandIdx: os, bForceFaceUp: false, bTop: ds === z.life.length }));
    case '1>5': return un(rpc('ZoroDon', { iHandIdx: os }));
    case '1>6': return un(rpc('MoveHandCardToDiscard', { iCardIdx: os }));
    case '1>7': return un(rpc('MoveHandCardToStage', { iIdx: os }));
    case '2>0': return ds === 0 ? un(rpc('ReturnCardToMyDeckBottom', { iDeployIdx: os })) : un();
    case '2>1': return un(rpc('ReturnCardToMyHand', { iDeployIdx: os }));
    case '2>3': return un(rpc('SendDeployCardToMyLife', { iDeployIdx: os, bForceFaceUp: false, bTop: ds === z.life.length }));
    case '2>6': return un(rpc('DiscardFromSelfDeploy', { iCardIndex: os }));
    case '3>0':
      if (ds === z.deck.length) return un(rpc('MoveLifeToDeck', { iLifeIdx: os }));
      return ds === 0 && os === 0 ? { rpcs: [rpc('BottomDeckOpponentLife', { iCount: 1 })], envoyeur: autre } : un();
    case '3>1':
      if (os === haut('life')) return un(rpc('PlayerDrawLife', { iCount: 1 }));
      return os === 0 ? un(rpc('PlayerDrawBottomLife', { iCount: 1 })) : un();
    case '3>2': return un(rpc('PlayCardFromLife', { iLifeIndex: os, bRested: m.repos }));
    case '3>3':
      if (ds === haut('life')) return un(rpc('MoveMyLifeToTop', { iLifeIdx: os }));
      return ds === 0 && os === haut('life') ? un(rpc('MoveMyTopLifeBottom')) : un();
    case '3>6':
      if (os === haut('life')) return un(rpc('TrashLife', { iCount: 1 }));
      return un(os === 0 ? rpc('TrashBottomLife', { iCount: 1 }) : rpc('TrashSpecificLife', { iIdx: os }));
    case '4>5': return un(m.repos ? rpc('DrawRestedDon', { iCount: 1 }) : rpc('DrawDon', { iCount: 1 }));
    case '5>4': return un(rpc('ReturnDon', { iDonIdx: os }));
    case '5>9': return un(rpc('AttachDonToCard', { iCardIdx: parent(ds), iDonIdx: os }));
    case '9>5': return un(rpc('DetachDonFromCard', { iCardIdx: parent(os), iDonIdx: os % 100 }));
    case '9>4': return un(rpc('ReturnDonFromCard', { iCardIdx: parent(os), iDonIdx: os % 100 }));
    case '9>9': return un(rpc('TransferAttachedDon', { iCardIdx: parent(ds), iSourceIdx: parent(os) }));
    case '6>0': return ds === 0 ? un(rpc('MoveTrashCardToDeckBottom', { iCardIdx: os })) : un();
    case '6>1': return un(rpc('DrawCardFromTrash', { iTrashIdx: os }));
    case '6>2': return un(rpc('MoveTrashCardToDeploy', { iIdx: os, bRested: m.repos }));
    case '6>3': return un(rpc('SendTrashCardToMyLife', { iTrashIdx: os, bForceFaceUp: false }));
    case '6>7': return un(rpc('MoveTrashCardToStage', { iIdx: os }));
    case '7>0': return os === 0 && ds === 0 ? un(rpc('MoveStageCardToDeckBottom')) : un();
    case '7>1': return os === 0 ? un(rpc('MoveStageCardToHand')) : un();
    case '7>6': return os === 0 ? un(rpc('MoveStageCardToTrash')) : un();
    default: return un();
  }
}

/** Déplacement sans RPC équivalente (effet d'une carte du jeu, ex. vie face visible renvoyée au deck) : appliqué tel quel. */
function deplacerTelQuel(etat, siege, m) {
  const s = cloneMirror(etat);
  const z = s.players[siege].zones, de = z[ZONE_RZ1[m.oz]], vers = z[ZONE_RZ1[m.dz]];
  if (!de || !vers || !de[m.os]) return { etat, ok: false };
  const [carte] = de.splice(m.os, 1);
  vers.splice(Math.min(m.ds, vers.length), 0, carte);
  return { etat: s, ok: true };
}

// ---------------------------------------------------------------------------------------------------- rejeu

const codeDe = (c) => (c === 'Don' ? DON : c);

/**
 * Rejoue une partie RZ1. Le joueur 1 du fichier (celui qui a enregistré) devient le siège 0, le joueur 2 le siège 1.
 * Rend { controles, ecarts, identite, rpcs, sansEquivalent, parties, etat }.
 */
export function rejouer(evts, options = {}) {
  const r = { controles: 0, ecarts: [], identite: { verifiees: 0, apprises: 0, fausses: [] }, rpcs: {}, sansEquivalent: {}, parties: 0, erreursMiroir: [], etat: undefined };
  let etat, instances, aBouge, cree;
  const nouvelle = () => { etat = createMirror(); instances = new Map(); aBouge = [new Set(), new Set()]; cree = [false, false]; r.parties++; };
  const appliquer = (x, envoyeur, compter = true) => {
    const res = applyRpc(etat, x, envoyeur, options);
    etat = res.state;
    if (compter) r.rpcs[x.name] = (r.rpcs[x.name] ?? 0) + 1;
  };
  // Mise en place sans RPC : le deck est créé localement (MakeMyCards, MakeEmptyDeckList) avant le premier mélange.
  const creerDeck = (siege, n) => { cree[siege] = true; if (n > 0) appliquer(rpc('MakeEmptyDeckList', { iDeckSize: n }), siege, false); };
  for (let i = 0; i < evts.length; i++) {
    const e = evts[i];
    if (e.type === 'hdr' || !etat) nouvelle();
    if (e.type === 'move' && !cree[e.joueur - 1] && (e.oz === 0 || e.dz === 0) && !counts(etat, e.joueur - 1).deck) {
      const suivant = evts.slice(i + 1).find((x) => x.type === 'chk' && x.joueur === e.joueur);
      if (suivant) creerDeck(e.joueur - 1, suivant.compte.deck + (e.oz === 0 ? 1 : 0) - (e.dz === 0 ? 1 : 0));
    }
    if (e.type === 'ply' && e.leader && !etat.players[e.joueur - 1].leader.code) appliquer(rpc('LoadLeader', { sCardID: e.leader }), e.joueur - 1, false);
    if (e.type === 'chk') {
      const siege = e.joueur - 1;
      // Mise en place sans RPC : deck créé localement (MakeMyCards), deck DON réduit selon le leader (SetDonMax).
      if (!cree[siege] && !aBouge[siege].has('deck') && counts(etat, siege).deck !== e.compte.deck) creerDeck(siege, e.compte.deck);
      if (!aBouge[siege].has('donDeck') && counts(etat, siege).donDeck > e.compte.donDeck) {
        etat = cloneMirror(etat);
        etat.players[siege].zones.donDeck.splice(0, counts(etat, siege).donDeck - e.compte.donDeck);
      }
      r.controles++;
      const c = counts(etat, siege);
      const diff = CHAMPS_CHK.filter((k) => c[k] !== e.compte[k]);
      if (diff.length) r.ecarts.push(`seq ${e.seq}, joueur ${e.joueur} : ${diff.map((k) => `${k} ${c[k]} au lieu de ${e.compte[k]}`).join(', ')}`);
    }
    if (e.type !== 'move') continue;
    const siege = e.joueur - 1;
    aBouge[siege].add(ZONE_RZ1[e.oz]).add(ZONE_RZ1[e.dz]);
    // Identité : la carte annoncée est-elle à cette place dans le miroir ?
    const zone = ZONE_RZ1[e.oz];
    const carte = zone === 'attached' ? undefined : zone === 'leader' ? etat.players[siege].leader : cardAt(etat, siege, zone, e.os);
    if (carte && codeDe(e.code) !== DON) {
      if (!carte.code) {
        if (zone === 'deck') appliquer(rpc('LoadDeckCard', { sCardID: e.code, iIdx: e.os }), siege, false);
        else { etat = cloneMirror(etat); cardAt(etat, siege, zone, zone === 'leader' ? -1 : e.os).code = e.code; }
        r.identite.apprises++;
      } else if (carte.code !== e.code) r.identite.fausses.push(`seq ${e.seq} : ${e.code} attendu en ${zone}[${e.os}], ${carte.code} trouvé`);
      else r.identite.verifiees++;
      const iid = instances.get(e.inst);
      if (iid === undefined) instances.set(e.inst, carte.iid);
      else if (iid !== carte.iid) r.identite.fausses.push(`seq ${e.seq} : instance ${e.inst} attendue en ${zone}[${e.os}]`);
    } else if (!carte && zone !== 'attached') r.identite.fausses.push(`seq ${e.seq} : pas de carte en ${zone}[${e.os}]`);
    const eq = equivalent(e, etat, siege);
    if (eq === null) continue;
    if (!eq.rpcs.length) {
      const cle = `${ZONE_RZ1[e.oz]} → ${ZONE_RZ1[e.dz]}`;
      r.sansEquivalent[cle] = (r.sansEquivalent[cle] ?? 0) + 1;
      const t = deplacerTelQuel(etat, siege, e);
      etat = t.etat;
      continue;
    }
    for (const x of eq.rpcs) appliquer(x, eq.envoyeur);
  }
  r.erreursMiroir = etat?.errors ?? [];
  r.etat = etat;
  return r;
}

// ---------------------------------------------------------------------------------------------------- fixtures

/** RPC décodées d'une fixture anonymisée (lots NGO), d'après un catalogue au format du prototype. */
export function decoderFixture(fixture, catalogue) {
  const sortie = [];
  for (const p of fixture.paquets) {
    const lot = decoderLot(Buffer.from(p.lot, 'hex'));
    lot.messages.forEach((m, i) => {
      if (!p.messages[i]?.rpc) return;
      const c = m.charge;
      const o = readPackedSmall(c, 0, 4), b = readPackedSmall(c, o.next, 2), h = readPackedUInt(c, b.next);
      const def = catalogue[h.value];
      if (!def) return;
      const values = {}, prm = c.subarray(h.next);
      let k = 0;
      for (const e of def.ecritures) {
        if (e.nullable && prm[k++] !== 1) { values[e.param] = null; continue; }
        if (e.codage === 'chaine') { const l = prm.readUInt32LE(k); k += 4; values[e.param] = prm.subarray(k, k + 2 * l).toString('utf16le'); k += 2 * l; }
        else if (e.codage === 'int-compacte') { const r = readPackedUInt(prm, k); k = r.next; values[e.param] = (r.value >>> 1) ^ -(r.value & 1); }
        else if (e.codage === 'uint-compacte') { const r = readPackedUInt(prm, k); k = r.next; values[e.param] = r.value; }
        else if (e.codage === 'ulong-compacte') {
          if ((prm[k] & 15) === 9) { values[e.param] = String(prm.readBigUInt64LE(k + 1)); k += 9; } else { const r = readPackedSmall(prm, k, 4); k = r.next; values[e.param] = r.value; }
        } else if (e.codage === 'bool') values[e.param] = prm[k++] === 1;
        else if (e.codage === 'float') { values[e.param] = Math.round(prm.readFloatLE(k) * 100) / 100; k += 4; }
        else if (e.codage === 'enum') { values[e.param] = prm.readInt32LE(k); k += 4; }
        else if (e.codage === 'brut-ActionStepResolver') { values[e.param] = [prm.readInt32LE(k), prm.readInt32LE(k + 4), prm.readInt32LE(k + 8)]; k += 12; }
        else { values[e.param] = null; break; }
      }
      sortie.push({ t: p.t, object: o.value, behaviour: b.value, name: def.nom, values });
    });
  }
  return sortie;
}

// ---------------------------------------------------------------------------------------------------- rapport

/** Rapport de couverture : chaque RPC client du jeu, sa famille, ses occurrences dans les journaux et les parties. */
export function rapport(frequences) {
  const connues = knownRpcs();
  const lignes = Object.entries(connues).map(([nom, famille]) => {
    const j = frequences.journaux[nom] ?? 0, p = frequences.parties[nom] ?? 0;
    return { nom, famille, journaux: j, parties: p, etat: famille === 'sans effet' ? 'sans effet sur la table' : j + p > 0 ? 'appliquée, vérifiée' : 'appliquée, non exercée' };
  });
  const inconnues = Object.keys(frequences.journaux).filter((n) => !(n in connues));
  for (const nom of inconnues) lignes.push({ nom, famille: '?', journaux: frequences.journaux[nom], parties: 0, etat: 'NON COUVERTE' });
  lignes.sort((a, b) => b.journaux + b.parties - (a.journaux + a.parties) || a.nom.localeCompare(b.nom));
  return lignes;
}

function compterJournaux(dossier, cible) {
  for (const f of fs.readdirSync(dossier)) {
    const plein = path.join(dossier, f);
    if (f.endsWith('.log')) {
      for (const m of fs.readFileSync(plein, 'utf8').matchAll(/ClientRpc objet \d+\/\d+ (\w+?)ClientRpc/g)) cible[m[1]] = (cible[m[1]] ?? 0) + 1;
    } else if (f.endsWith('.json')) {
      const x = JSON.parse(fs.readFileSync(plein, 'utf8'));
      for (const r of x.rpcs ?? []) { const n = r.name.replace(/ClientRpc$/, ''); cible[n] = (cible[n] ?? 0) + 1; }
    }
  }
}

// ---------------------------------------------------------------------------------------------------- ligne de commande

function principal(args) {
  const [mode, ...reste] = args;
  const opt = (nom) => { const i = reste.indexOf(nom); return i >= 0 ? reste.splice(i, 2)[1] : undefined; };
  if (mode === 'extrait') {
    const [entree, sortie] = reste;
    fs.writeFileSync(sortie, extraitAnonyme(fs.readFileSync(entree, 'utf8')));
    console.log(`Extrait écrit : ${sortie}`);
    return 0;
  }
  if (mode === 'fixture') {
    const catalogue = JSON.parse(fs.readFileSync(opt('--catalogue') ?? '', 'utf8'));
    const [entree, sortie] = reste;
    const fixture = JSON.parse(fs.readFileSync(entree, 'utf8'));
    const rpcs = decoderFixture(fixture, catalogue).filter((x) => x.name !== 'SetTimerClientRpc');
    const description = `RPC décodées de ${fixture.source} (fixture anonymisée), sans SetTimer. object 1 = hôte OPTCGSim (siège 0), 2 = joy-boy (siège 1).`;
    fs.writeFileSync(sortie, JSON.stringify({ description, source: fixture.source, rpcs }, null, 1) + '\n');
    console.log(`${rpcs.length} RPC écrites : ${sortie}`);
    return 0;
  }
  if (mode !== 'rejouer') {
    console.log('Usage : rejouer-rz1.mjs rejouer <partie.log|dossier>... [--journaux <dossier>] [--fixtures <dossier>]\n'
      + '        rejouer-rz1.mjs extrait <partie.log> <sortie.rz1>\n        rejouer-rz1.mjs fixture <journal.json> <sortie.json> --catalogue <catalogue.json>');
    return 2;
  }
  const journaux = opt('--journaux'), fixtures = opt('--fixtures');
  const fichiers = reste.flatMap((x) => (fs.statSync(x).isDirectory() ? fs.readdirSync(x).filter((f) => /\.(log|rz1)$/.test(f)).map((f) => path.join(x, f)) : [x]));
  const freq = { journaux: {}, parties: {} };
  let total = 0, sansEcart = 0, vides = 0;
  const sansEq = {};
  for (const f of fichiers) {
    const evts = lireRz1(fs.readFileSync(f, 'utf8'));
    if (!evts.some((e) => e.type === 'move')) { vides++; continue; }
    total++;
    const r = rejouer(evts);
    for (const [n, k] of Object.entries(r.rpcs)) { const b = n.replace(/ClientRpc$/, ''); freq.parties[b] = (freq.parties[b] ?? 0) + k; }
    for (const [n, k] of Object.entries(r.sansEquivalent)) sansEq[n] = (sansEq[n] ?? 0) + k;
    const ok = !r.ecarts.length && !r.identite.fausses.length && !r.erreursMiroir.length;
    if (ok) sansEcart++;
    console.log(`${ok ? 'OK    ' : 'ÉCART '} ${path.basename(f)} : ${r.controles} contrôles, ${r.ecarts.length} écart(s), identité ${r.identite.verifiees} vérifiée(s) / ${r.identite.apprises} apprise(s) / ${r.identite.fausses.length} fausse(s), ${r.erreursMiroir.length} erreur(s) du miroir`);
    for (const x of [...r.ecarts, ...r.identite.fausses, ...r.erreursMiroir].slice(0, 5)) console.log(`         ${x}`);
  }
  console.log(`\n${total} partie(s) rejouée(s), ${sansEcart} sans écart${vides ? ` (${vides} fichier(s) sans déplacement ignoré(s))` : ''}.`);
  if (Object.keys(sansEq).length) console.log(`Déplacements sans RPC équivalente (appliqués tels quels) : ${Object.entries(sansEq).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  if (journaux) compterJournaux(journaux, freq.journaux);
  if (fixtures) compterJournaux(fixtures, freq.journaux);
  const lignes = rapport(freq);
  console.log('\nCouverture des RPC (journaux = RPC reçues dans les essais réels ; parties = RPC équivalentes des parties RZ1)\n');
  console.log('| RPC | famille | journaux | parties | état |\n|---|---|---|---|---|');
  for (const l of lignes.filter((x) => x.journaux + x.parties > 0 || x.etat === 'NON COUVERTE')) console.log(`| ${l.nom} | ${l.famille} | ${l.journaux} | ${l.parties} | ${l.etat} |`);
  const parEtat = lignes.reduce((t, l) => ({ ...t, [l.etat]: (t[l.etat] ?? 0) + 1 }), {});
  console.log(`\nBilan des ${lignes.length} RPC : ${Object.entries(parEtat).map(([k, n]) => `${n} ${k}`).join(', ')}.`);
  return sansEcart === total ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = principal(process.argv.slice(2));
