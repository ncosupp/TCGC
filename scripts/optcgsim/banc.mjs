#!/usr/bin/env node
// Banc d'essai réel des parties croisées (tâche O2.4) : rejoint une salle OPTCGSim avec un deck joy-boy, joue à la
// place du joueur, et écrit un journal complet (octets de chaque lot, RPC décodées, état du miroir à chaque tour,
// bilan final). Le journal a le format de celui du prototype : `anonymiser.mjs` en tire une fixture de test.
//
//   node scripts/optcgsim/banc.mjs <CODE> [--deck ST-01 | <fichier.deck> | <deck.json>] [--nom JoyBoy-banc]
//        [--pilote auto | ia | minimal] [--journal <dossier>] [--minutes 60]
//
// Pilotes :
// - « ia » : l'IA de joy-boy joue, à travers le moteur et les modules de la vague O2 (inbound O2.2, outbound O2.1,
//   combat O2.3) ; tant qu'un de ces modules n'est pas livré (« pas encore fait »), le banc le dit et prend « minimal » ;
// - « minimal » : l'adversaire du prototype (validé le 17 nov.) : garde sa main, pioche, prend ses DON, finit son
//   tour ; en défense, ni bloqueur, ni contre, ni déclencheur ;
// - « auto » (par défaut) : « ia » si possible, sinon « minimal ».
// Ctrl+C : abandon propre (ConcedeServerRpc), puis bilan.
//
// PARLE AUX SERVEURS UNITY (identification anonyme et Relay) : c'est l'utilisateur qui le lance, avec son jeu ouvert.
// Ne tourne jamais dans `npm test` (les tests injectent un faux transport, banc.test.ts). Le journal contient des
// pseudos et des identifiants : il est écrit hors du dépôt (par défaut ~/Desktop/optcgsim/journaux-banc/).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECKS } from '../../game/engine/decks.ts';
import { applyRpc, counts, createMirror } from '../../game/online/optcgsim/mirror.ts';
import { HANDSHAKE, MESSAGE_TYPE, NetcodeClient, inspectBatch, messageName } from '../../game/online/optcgsim/netcode.ts';
import { decode, rpcMessage } from '../../game/online/optcgsim/rpc.ts';
import { connect, parseRoomCode } from '../../game/online/optcgsim/transport.ts';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
export const DOSSIER_JOURNAL = path.join(os.homedir(), 'Desktop', 'optcgsim', 'journaux-banc');
const NOM_DEFAUT = 'JoyBoy-banc';

// ---------------------------------------------------------------------------------------------------- deck
/**
 * Deck au format d'OPTCGSim (leader + liste de 50 codes) depuis : un identifiant de deck joy-boy (« ST-01 »), un
 * fichier .deck d'OPTCGSim (« 4xST01-002 » par ligne, leader en tête) ou un .json joy-boy ({ leader, cards }).
 */
export function deckOptcgsim(source) {
  let leader, cartes, nom;
  if (DECKS[source]) {
    ({ leader } = DECKS[source]); nom = `${source} (${DECKS[source].name})`;
    cartes = Object.entries(DECKS[source].cards).flatMap(([c, n]) => Array(n).fill(c));
  } else if (fs.existsSync(source) && source.endsWith('.json')) {
    const d = JSON.parse(fs.readFileSync(source, 'utf8'));
    leader = d.leader; nom = d.name ?? path.basename(source);
    cartes = Object.entries(d.cards ?? {}).flatMap(([c, n]) => Array(n).fill(c));
  } else if (fs.existsSync(source)) {
    const lignes = fs.readFileSync(source, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lire = (l) => { const m = /^(\d+)x(.+)$/.exec(l); if (!m) throw new Error(`Ligne de deck illisible : « ${l} »`); return [Number(m[1]), m[2]]; };
    leader = lire(lignes[0])[1]; nom = path.basename(source);
    cartes = lignes.slice(1).flatMap((l) => { const [n, c] = lire(l); return Array(n).fill(c); });
  } else throw new Error(`Deck inconnu « ${source} » : identifiant joy-boy (ex. ST-01), fichier .deck ou .json.`);
  if (!leader || cartes.length !== 50) throw new Error(`Deck « ${nom} » : un leader et 50 cartes attendus (${cartes.length} cartes).`);
  return { leader, cartes, nom };
}

// ---------------------------------------------------------------------------------------------------- journal
const hex = (b, max = 96) => Buffer.from(b).subarray(0, max).toString('hex').replace(/(..)/g, '$1 ').trim() + (b.length > max ? ` … (${b.length} o)` : '');
const resume = (v) => Object.entries(v ?? {}).map(([k, x]) => {
  const s = typeof x === 'bigint' ? x.toString() : JSON.stringify(x, (_k, y) => (typeof y === 'bigint' ? y.toString() : y));
  return `${k}=${s && s.length > 60 ? s.slice(0, 57) + '…' : s}`;
}).join(' ');

/** Journal au format du prototype (lu par anonymiser.mjs : lignes « -> lot … », messages, « complet : »). */
export function creerJournal(ecrire, { console: aussiConsole = false } = {}) {
  const horo = () => `[${new Date().toISOString().slice(11, 23)}]`;
  const brut = (l) => { ecrire(l + '\n'); };
  const ligne = (...m) => { const l = `${horo()} ${m.join(' ')}`; brut(l); if (aussiConsole) console.log(l); };
  function lot(octets, canal, sens) {
    const d = inspectBatch(octets);
    const messages = d.messages ?? [];
    // bruit : les lots non fiables qui ne portent que l'horloge
    if (canal.startsWith('non fiable') && messages.length && messages.every((m) => messageName(m.type) === 'TimeSync')) return;
    if (d.error) { ligne(sens, canal, `lot illisible (${d.error})`, hex(octets)); return; }
    ligne(sens, `lot ${canal} : ${messages.length} message(s), taille ${d.sizeOk ? 'ok' : 'FAUSSE'}, empreinte ${d.hashOk ? 'ok' : 'FAUSSE'}`);
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

function resumeMiroir(m) {
  const z = (s) => { const c = counts(m, s); return `deck ${c.deck}, main ${c.hand}, vie ${c.life}, terrain ${c.deploy}, DON ${c.donCost}+${c.attachedDon}, défausse ${c.trash}`; };
  return `tour ${m.turn} (à ${m.turnPlayer === 1 ? 'joy-boy' : 'l’hôte'}) — hôte : ${z(0)} | joy-boy : ${z(1)}`;
}

// ---------------------------------------------------------------------------------------------------- pilotes
/**
 * Un pilote reçoit chaque RPC de l'hôte (pas les échos des nôtres) et répond par `ctx.envoyer`. ctx : envoyer(...[nom,
 * valeurs]), ligne(...), attendre(ms), miroir(), deck, objet (notre objet joueur).
 */
export function piloteMinimal(ctx) {
  let hoteCommence = null, viesHote = false, viesMoi = false, premierFait = false;
  let attenteResultat = false, chronoPrec = null;
  const demarrerSiPret = () => {
    if (viesHote && viesMoi && hoteCommence === false && !premierFait) { premierFait = true; void tour(true); }
  };
  async function tour(premier) {
    await ctx.attendre(1500);
    // premier joueur, tour 1 : pas de pioche, 1 DON ; ensuite 1 carte et 2 DON
    if (premier) ctx.envoyer(['DrawDonServerRpc', { iCount: 1 }]);
    else ctx.envoyer(['DrawCardServerRpc', { iCount: 1 }], ['DrawDonServerRpc', { iCount: 2 }]);
    ctx.ligne('>>> Pioche et DON envoyés, fin de tour dans 3 s');
    await ctx.attendre(3000);
    ctx.envoyer(['AttemptingToEndTurnServerRpc', {}]);
    await ctx.attendre(500);
    ctx.envoyer(['EndTurnServerRpc', {}]);
    ctx.ligne('>>> Fin de tour envoyée');
  }
  async function defendre() {
    ctx.ligne('>>> Attaque reçue : pas de bloqueur, pas de contre');
    await ctx.attendre(1000);
    ctx.envoyer(['NoBlockerServerRpc', {}]);
    await ctx.attendre(1000);
    ctx.envoyer(['AllOnKOResolvedServerRpc', {}], ['ResolveAttackServerRpc', {}]);
    attenteResultat = true; chronoPrec = null;
  }
  // SetTimer (chrono de l'hôte, le nôtre) : si le nôtre baisse encore après la résolution, l'hôte attend notre décision
  // de déclencheur (le leader a été touché).
  function chrono(hote, nous) {
    if (attenteResultat && chronoPrec) {
      if (nous < chronoPrec.nous) {
        attenteResultat = false;
        ctx.ligne('>>> Leader touché : on refuse le déclencheur et on rend la main');
        ctx.envoyer(['AllOnKOResolvedServerRpc', {}], ['SwitchTurnsServerRpc', {}], ['ResetActionPhaseServerRpc', {}], ['NoMorePendingActionsServerRpc', {}]);
      } else if (hote < chronoPrec.hote) { attenteResultat = false; ctx.ligne('>>> Attaque repoussée, la main revient à l’hôte'); }
    }
    chronoPrec = { hote, nous };
  }
  return {
    nom: 'minimal',
    surRpc(r) {
      if (r.name === 'ChooseTurnOrderClientRpc') {
        hoteCommence = r.values.iFirst === 1;
        ctx.ligne(`>>> L’hôte ${hoteCommence ? 'commence' : 'nous laisse commencer'} ; ouverture : mélange, 5 cartes, on garde, 5 vies`);
        const ordre = [...Array(ctx.deck.cartes.length).keys()];
        for (let j = 0; j < ordre.length; j++) { const k = j + crypto.randomInt(ordre.length - j); [ordre[j], ordre[k]] = [ordre[k], ordre[j]]; }
        ctx.envoyer(['ShuffleDeckServerRpc', { s_ShuffleString: ordre.join('-') }], ['DrawCardServerRpc', { iCount: 5 }],
          ['PopulateLifeDeckServerRpc', { iLifeCount: 5 }]);
        viesMoi = true; demarrerSiPret();
      } else if (r.name === 'PopulateLifeDeckClientRpc') { viesHote = true; demarrerSiPret(); }
      else if (r.name === 'EndTurnClientRpc') { ctx.ligne('>>> Fin du tour de l’hôte : à nous'); void tour(false); }
      else if (r.name === 'SelectBlockerClientRpc') void defendre();
      else if (r.name === 'SetTimerClientRpc') chrono(r.values.fServerTime, r.values.fClientTime);
    },
  };
}

const PAS_FAIT = /pas encore fait/;
/**
 * Modules de la vague O2 dont l'IA a besoin. Un module encore à l'état de squelette lève « pas encore fait » : il est
 * alors signalé manquant. `modules` est injectable (tests, ou modules de remplacement).
 */
export async function modulesO2(modules) {
  const m = modules ?? {
    inbound: await import('../../game/online/optcgsim/inbound.ts'),
    outbound: await import('../../game/online/optcgsim/outbound.ts'),
    combat: await import('../../game/online/optcgsim/combat.ts'),
  };
  const essai = { name: 'TapCardClientRpc', object: 0, behaviour: 0, values: {} };
  const sondes = [
    ['O2.2 (inbound)', () => m.inbound.translateInbound(essai, {})],
    ['O2.1 (outbound)', () => m.outbound.translateOutbound(createMirror(), {})],
    ['O2.3 (combat)', () => m.combat.handleCombatRpc(essai, {})],
  ];
  const manque = [];
  for (const [nom, f] of sondes) {
    try { f(); } catch (e) { if (PAS_FAIT.test(String(e?.message))) manque.push(nom); }
  }
  return { modules: m, manque };
}

/**
 * Pilote « ia » : le moteur de joy-boy tient la table partagée, l'IA heuristique décide pour le siège 1.
 * - RPC de l'hôte → mutations externes (inbound) appliquées au moteur (applyExternal), et combat (O2.3) ;
 * - décision du joueur joy-boy → heuristicChooser → answerExternal (jamais act()) → RPC à envoyer (outbound).
 * Les appels aux modules O2 passent un second argument de contexte ({ miroir, etat, avant }) : c'est le point de
 * branchement à ajuster si leurs signatures finales diffèrent (le chef de la vague O2 le règle à l'intégration).
 * Les décisions que le moteur ne sait pas traduire font tomber le banc en « minimal » pour la suite de la partie.
 */
export async function piloteIA(ctx, { modules }) {
  await import('../../game/data/load-local.ts');
  const cartes = await import('../../game/engine/cards/index.ts'); // avant le moteur (voir 00-regles-communes § 6)
  const { newGame } = await import('../../game/engine/engine.ts');
  const { applyExternal, answerExternal } = await import('../../game/online/optcgsim/external.ts');
  const { heuristicChooser } = await import('../../game/ai/heuristic.ts');
  let etat = null, secours = null;
  const inconnues = (codes) => [...new Set(codes)].filter((c) => !cartes.CARDS[c]);
  const versSecours = (pourquoi) => {
    ctx.ligne(`>>> IA : ${pourquoi} ; le pilote « minimal » prend la suite`);
    ctx.ecart(`ia → minimal : ${pourquoi}`);
    secours = piloteMinimal(ctx);
  };
  function demarrer() {
    const m = ctx.miroir(), hote = m.players[0];
    const codesHote = [hote.leader.code, ...hote.zones.deck.map((c) => c.code)];
    const manque = inconnues([...codesHote, ctx.deck.leader, ...ctx.deck.cartes]);
    if (manque.length) { ctx.inconnues(manque); versSecours(`cartes inconnues de joy-boy : ${manque.join(', ')}`); return; }
    const liste = (leader, codes) => ({ id: 'OPTCGSIM', name: 'OPTCGSim', series: 'PERSO', leader, cards: codes.reduce((t, c) => ({ ...t, [c]: (t[c] ?? 0) + 1 }), {}) });
    etat = newGame({ decks: [liste(hote.leader.code, codesHote.slice(1)), liste(ctx.deck.leader, ctx.deck.cartes)],
      names: [hote.name || 'Hôte', ctx.nom], first: m.first ?? 0 });
    ctx.ligne('>>> IA : moteur prêt (table partagée)');
  }
  function jouerDecisions() {
    for (let garde = 0; garde < 200 && etat?.decision && etat.decision.player === 1 && etat.winner === null; garde++) {
      const avant = etat, choix = heuristicChooser(etat, etat.decision);
      etat = answerExternal(etat, choix, { joyboy: 1 });
      const rpcs = modules.outbound.translateOutbound(ctx.miroir(), { avant, etat, choix });
      if (rpcs.length) ctx.envoyer(...rpcs.map((r) => [r.name, r.values]));
    }
  }
  return {
    nom: 'ia',
    surRpc(r, sortie) {
      if (secours) return secours.surRpc(r, sortie);
      try {
        if (!etat && r.name === 'ChooseTurnOrderClientRpc') demarrer();
        if (secours) return secours.surRpc(r, sortie);
        if (!etat) return;
        for (const ext of modules.inbound.translateInbound(r, { miroir: ctx.miroir(), etat, externes: sortie.externals })) {
          etat = applyExternal(etat, ext, { joyboy: 1 });
        }
        const reponses = modules.combat.handleCombatRpc(r, { miroir: ctx.miroir(), etat });
        if (reponses.length) ctx.envoyer(...reponses.map((x) => [x.name, x.values]));
        jouerDecisions();
      } catch (e) { versSecours(`erreur sur ${r.name} (${e.message})`); }
    },
  };
}

// ---------------------------------------------------------------------------------------------------- le banc
/**
 * Lance le banc. Options : code (« P… »), deck (source, voir deckOptcgsim), nom, pilote ('auto' | 'ia' | 'minimal'),
 * ecrire (sortie du journal), console, minutes (durée maximale), vitesse (facteur des attentes : 1 en vrai, ~0 en test),
 * connect (remplace transport.connect : faux transport des tests), transport (options passées à connect : faux fetch
 * et faux udp), modules (modules O2 injectés).
 * Rend { fini: Promise<bilan>, arreter(raison) }.
 */
export function lancerBanc(o) {
  const debut = Date.now();
  const j = creerJournal(o.ecrire, { console: o.console });
  const deck = deckOptcgsim(o.deck ?? 'ST-01');
  const nom = o.nom ?? NOM_DEFAUT;
  const { style } = parseRoomCode(o.code);
  const vitesse = o.vitesse ?? 1;
  const bilan = { code: o.code.trim().toUpperCase(), deck: deck.nom, pilote: null, lotsRecus: 0, lotsEnvoyes: 0, rpcRecues: 0,
    issue: null, ecarts: [], cartesInconnues: [], erreursMiroir: [], nonGerees: {}, duree: 0 };
  let miroir = createMirror(), transport = null, client = null, objet = null, pilote = null, termine = false;
  let optionsMiroir = {};
  let resoudre;
  const fini = new Promise((r) => { resoudre = r; });
  const minuteur = setTimeout(() => arreter(`durée maximale atteinte (${o.minutes ?? 60} min)`, true), (o.minutes ?? 60) * 60000);
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms * vitesse));

  function envoyer(...rpcs) {
    if (termine || !client) return;
    const messages = rpcs.map(([n, v]) => rpcMessage(n, v, { object: objet }));
    client.send(messages);
  }
  const ctx = {
    envoyer, ligne: j.ligne, attendre, deck, nom, miroir: () => miroir,
    ecart: (t) => bilan.ecarts.push(t), inconnues: (c) => bilan.cartesInconnues.push(...c),
  };

  function finir(issue) {
    if (termine) return;
    termine = true; clearTimeout(minuteur);
    bilan.issue = issue; bilan.duree = Math.round((Date.now() - debut) / 1000);
    bilan.erreursMiroir = miroir.errors.slice(0, 50); bilan.nonGerees = miroir.unhandled;
    j.ligne('>>> Fin :', issue);
    j.ligne('>>> Miroir :', resumeMiroir(miroir));
    j.ligne('BILAN', JSON.stringify(bilan));
    try { transport?.close(); } catch { /* déjà fermé */ }
    resoudre(bilan);
  }
  /** Arrêt demandé (Ctrl+C, durée) : on abandonne la partie avant de partir, pour ne pas bloquer l'hôte. */
  function arreter(raison, conceder = true) {
    if (termine) return;
    if (conceder && objet != null && !miroir.over) { j.ligne('>>> Abandon envoyé (ConcedeServerRpc)'); envoyer(['ConcedeServerRpc', {}]); }
    setTimeout(() => finir(raison), conceder ? 500 * vitesse : 0);
  }

  function surMessage(m) {
    if (m.type !== MESSAGE_TYPE.ClientRpc || termine) return;
    let r;
    try { r = decode(m.payload); } catch (e) { bilan.ecarts.push(`RPC illisible : ${e.message}`); return; }
    bilan.rpcRecues++;
    const siege = r.object === objet ? 1 : 0;
    let sortie = { state: miroir, externals: [] };
    try { sortie = applyRpc(miroir, r, siege, optionsMiroir); miroir = sortie.state; } catch (e) { bilan.ecarts.push(`miroir, ${r.name} : ${e.message}`); }
    if (r.name === 'EndTurnClientRpc') j.ligne('>>> Miroir :', resumeMiroir(miroir));
    if (siege === 0) {
      try { pilote?.surRpc(r, sortie); } catch (e) { bilan.ecarts.push(`pilote, ${r.name} : ${e.message}`); j.ligne('>>> Erreur du pilote :', e.message); }
    }
    if (miroir.over) {
      const issue = miroir.over.loser === 1 ? `défaite de joy-boy (${miroir.over.reason})` : `victoire de joy-boy (${miroir.over.reason})`;
      setTimeout(() => finir(issue), 2000 * vitesse);
    }
  }

  async function choisirPilote() {
    const voulu = o.pilote ?? 'auto';
    if (voulu === 'minimal') return piloteMinimal(ctx);
    const o2 = await modulesO2(o.modules);
    if (o2.manque.length) {
      const t = `IA indisponible, modules pas encore livrés : ${o2.manque.join(', ')}`;
      if (voulu === 'ia') j.ligne('>>> ATTENTION :', t);
      j.ligne(`>>> ${t} ; pilote « minimal »`);
      bilan.ecarts.push(t);
      return piloteMinimal(ctx);
    }
    return piloteIA(ctx, o2);
  }

  (async () => {
    j.ligne(`Banc d'essai joy-boy ↔ OPTCGSim ${HANDSHAKE.gameVersion} — salle ${bilan.code} (style ${style}), deck ${deck.nom}, leader ${deck.leader}`);
    // Puissance imprimée et mots-clés des cartes (catalogue joy-boy) : le miroir en a besoin pour suivre les combats.
    try {
      await import('../../game/data/load-local.ts');
      const { cardData } = await import('../../game/engine/cards/index.ts');
      const cartes = cardData();
      optionsMiroir = { stats: (c) => (cartes[c] ? { power: cartes[c].power, keywords: cartes[c].keywords } : undefined) };
    } catch (e) { j.ligne(`>>> Catalogue des cartes illisible (${e.message}) : le miroir suit les combats sans les puissances`); }
    pilote = await choisirPilote();
    bilan.pilote = pilote.nom;
    j.ligne(`Pilote : ${pilote.nom}`);
    const relier = o.connect ?? connect;
    transport = await relier(o.code, { ...o.transport, log: (l) => j.ligne(l) });
    transport.onClose?.((raison) => finir(`connexion terminée : ${raison}`));
    // Un seul abonné au transport (il remet au premier les lots arrivés avant) : le journal passe avant le client NGO.
    const journalise = {
      userId: transport.userId,
      send(lot) { bilan.lotsEnvoyes++; j.lot(lot, 'fiable', '->'); transport.send(lot); },
      onData(h) { transport.onData((lot, canal) => { bilan.lotsRecus++; j.lot(lot, canal ?? 'fiable', '<-');
        try { h(lot, canal); } catch (e) { bilan.ecarts.push(`lot reçu : ${e.message}`); j.ligne('>>> Lot rejeté :', e.message); }
      }); },
      close() { transport.close(); },
    };
    client = new NetcodeClient(journalise);
    client.onMessage(surMessage);
    client.onReady(({ playerObject, clientId }) => {
      objet = playerObject;
      j.ligne(`Identifiant client ${clientId}, objet joueur ${objet} : mise en place (${deck.cartes.length} cartes)`);
      const appareil = crypto.randomBytes(20).toString('hex');
      const rpc = (n, v) => rpcMessage(n, v, { object: objet });
      client.completeSync([
        rpc('VersionCheckServerRpc', { sVersion: HANDSHAKE.gameVersion }),
        rpc('SetNameServerRpc', { sName: nom, bSpectator: false }),
        rpc('MakeEmptyDeckListServerRpc', { iDeckSize: deck.cartes.length }),
        rpc('LoadLeaderServerRpc', { sCardID: deck.leader, sPatron: '', sDeviceID: appareil, sPlayerName: nom, sPlayerID: transport.userId ?? '' }),
        ...deck.cartes.map((c, i) => rpc('LoadDeckCardServerRpc', { sCardID: c, iIdx: i })),
        rpc('SetMyTurnRollServerRpc', { iRoll: 0 }), // tirage 0 : l'hôte gagne et choisit qui commence
      ]);
    });
    client.start(style);
    j.ligne('Connecté au jeu, demande de connexion NGO envoyée');
  })().catch((e) => { j.ligne('ERREUR :', e.message); finir(`erreur : ${e.message}`); });

  return { fini, arreter };
}

// ---------------------------------------------------------------------------------------------------- entrée
function usage() {
  console.error('Usage : node scripts/optcgsim/banc.mjs <CODE> [--deck ST-01|fichier.deck|deck.json] [--nom Nom] [--pilote auto|ia|minimal] [--journal dossier] [--minutes 60]');
  process.exit(2);
}
async function main() {
  const args = process.argv.slice(2);
  const o = { pilote: 'auto', deck: 'ST-01', nom: NOM_DEFAUT, minutes: 60, dossier: DOSSIER_JOURNAL, console: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], v = () => args[++i] ?? usage();
    if (a === '--deck') o.deck = v();
    else if (a === '--nom') o.nom = v();
    else if (a === '--pilote') { o.pilote = v(); if (!['auto', 'ia', 'minimal'].includes(o.pilote)) usage(); }
    else if (a === '--journal') o.dossier = path.resolve(v());
    else if (a === '--minutes') o.minutes = Number(v());
    else if (!a.startsWith('--') && !o.code) o.code = a;
    else usage();
  }
  if (!o.code) usage();
  if (path.resolve(o.dossier).toLowerCase().startsWith(RACINE.toLowerCase())) {
    console.error('Le journal contient des pseudos : choisis un dossier hors du dépôt.'); process.exit(2);
  }
  fs.mkdirSync(o.dossier, { recursive: true });
  const fichier = path.join(o.dossier, `banc-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const flux = fs.createWriteStream(fichier, { flags: 'a' });
  console.log(`Journal : ${fichier}`);
  const banc = lancerBanc({ ...o, ecrire: (t) => flux.write(t) });
  process.on('SIGINT', () => banc.arreter('arrêté par Ctrl+C'));
  const b = await banc.fini;
  console.log(`\nIssue : ${b.issue}\nPilote : ${b.pilote} ; ${b.lotsRecus} lots reçus, ${b.lotsEnvoyes} envoyés ; ${b.erreursMiroir.length} écart(s) du miroir ; ${b.ecarts.length} autre(s) écart(s)`);
  if (b.cartesInconnues.length) console.log(`Cartes inconnues de joy-boy : ${b.cartesInconnues.join(', ')}`);
  console.log(`Journal : ${fichier}\nPour une fixture de test : node scripts/optcgsim/anonymiser.mjs "${fichier}"`);
  flux.end(() => setTimeout(() => process.exit(0), 100));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
