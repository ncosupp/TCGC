#!/usr/bin/env node
// Banc d'essai réel des parties croisées (tâche O2.4) : rejoint une salle OPTCGSim avec un deck joy-boy, joue à la
// place du joueur, et écrit un journal complet (octets de chaque lot, RPC décodées, état du miroir à chaque tour,
// bilan final). Le journal a le format de celui du prototype : `anonymiser.mjs` en tire une fixture de test.
//
//   node scripts/optcgsim/banc.mjs <CODE> [--deck ST-01 | <fichier.deck> | <deck.json>] [--nom JoyBoy-banc]
//        [--pilote auto | ia | minimal] [--journal <dossier>] [--minutes 60] [--blocage 20]
//
// Pilotes :
// - « ia » : l'IA de joy-boy joue, à travers le moteur et les modules de la vague O2 (inbound O2.2, outbound O2.1,
//   combat O2.3, branchés par le chef de la vague O2 en attendant la session de O3.1) ; si un module manque ou lève une
//   erreur, le banc le note et « minimal » prend la suite ;
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
    surRpc(r, _sortie, siege = 0) {
      if (siege !== 0) return; // nos échos ne l'intéressent pas
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

/** Fonctions des modules de la vague O2 dont l'IA a besoin (signatures livrées ; branchement du chef de la vague O2). */
const BESOINS = {
  inbound: ['createTable', 'receive', 'withGame'],
  outbound: ['translateOutbound'],
  combat: ['createCombat', 'handleCombatRpc', 'combatAnswer', 'mirrorOptions', 'routesTo', 'waiting', 'COMBAT_RPCS'],
};
const NOMS_O2 = { inbound: 'O2.2 (inbound)', outbound: 'O2.1 (outbound)', combat: 'O2.3 (combat)' };
/**
 * Modules de la vague O2 dont l'IA a besoin. Un module auquel il manque une de ces fonctions est signalé manquant.
 * `modules` est injectable (tests, ou modules de remplacement).
 */
export async function modulesO2(modules) {
  const m = modules ?? {
    inbound: await import('../../game/online/optcgsim/inbound.ts'),
    outbound: await import('../../game/online/optcgsim/outbound.ts'),
    combat: await import('../../game/online/optcgsim/combat.ts'),
  };
  const manque = Object.entries(BESOINS).filter(([k, noms]) => !m[k] || noms.some((n) => m[k][n] === undefined)).map(([k]) => NOMS_O2[k]);
  return { modules: m, manque };
}

/**
 * Pilote « ia » : le moteur de joy-boy tient la table partagée, l'IA heuristique décide pour le siège 1. Branchement
 * provisoire des modules O2 (la session de O3.1 le reprendra), pour chaque ClientRpc reçue (hôte, ou écho des nôtres) :
 * 1. combat (O2.3), avant inbound, si un combat est en cours ou si la RPC en relève : `handleCombatRpc` ;
 * 2. inbound (O2.2) : `receive` sur la table croisée (miroir + moteur liés par uid), avec `mirrorOptions` du combat ;
 * 3. décisions du joueur joy-boy (après chaque RPC, écho compris) : l'ouverture (garder ou repiocher) part
 *    directement en RPC (le moteur ne joue pas l'ouverture d'une partie croisée, O2.2) ; pendant un combat,
 *    `combatAnswer` ; sinon `answerExternal` (jamais `act()`) puis outbound (O2.1) `translateOutbound(vu, moteur,
 *    { before, choice })` ;
 * 4. après une RPC de l'hôte, hors ouverture et hors combat : outbound sans choix, sur ses propres zones
 *    (`scope: 'self'`), pour la pioche, les DON!! et les réactions de ses cartes.
 * `vu` est la table telle qu'OPTCGSim la verra (contexte du combat et d'outbound) : nos ServerRpc y sont appliquées à
 * l'envoi, les ClientRpc de l'hôte à réception, nos échos jamais (déjà comptés). Une erreur fait tomber le banc en
 * « minimal » pour la suite de la partie ; les écarts des modules vont au bilan.
 */
export async function piloteIA(ctx, { modules }) {
  await import('../../game/data/load-local.ts');
  const cartes = await import('../../game/engine/cards/index.ts'); // avant le moteur (voir 00-regles-communes § 6)
  const { answerExternal } = await import('../../game/online/optcgsim/external.ts');
  const { heuristicChooser } = await import('../../game/ai/heuristic.ts');
  const { applyRpc, baseName } = await import('../../game/online/optcgsim/mirror.ts');
  const { inbound, outbound, combat: cb } = modules;
  let table = inbound.createTable({ joyboy: 1 }), combat = cb.createCombat(), vu = null, secours = null;
  let ouverture = 'attente'; // attente → main (5 cartes demandées) → vies (réponse donnée)
  let decisions = 0, envoyees = 0;
  const dejaVus = new Set();
  const versSecours = (pourquoi) => {
    ctx.ligne(`>>> IA : ${pourquoi} ; le pilote « minimal » prend la suite`);
    ctx.ecart(`ia → minimal : ${pourquoi}`);
    secours = piloteMinimal(ctx);
  };
  const moteur = () => table.game;
  const optsMiroir = () => (moteur() ? cb.mirrorOptions(combat, moteur()) : undefined);
  const ctxCombat = () => ({ mirror: vu, joyboy: 1, object: ctx.objet() });
  const ecarts = (liste, quoi) => {
    for (const e of liste ?? []) { const t = `${quoi} : ${e}`; if (!dejaVus.has(t)) { dejaVus.add(t); ctx.ecart(t); } }
  };
  const versServeur = (n, v = {}) => ({ name: `${n}ServerRpc`, object: ctx.objet(), behaviour: 0, values: v });
  /** Envoie des ServerRpc ({ name, values }) ; `appliquer` : les poser sur `vu` (outbound et combat l'ont déjà fait). */
  function envoyer(rpcs, appliquer) {
    if (!rpcs.length) return;
    if (appliquer) for (const r of rpcs) vu = applyRpc(vu, r, 1, optsMiroir()).state;
    envoyees += rpcs.length;
    chronoRef = null;
    ctx.envoyer(...rpcs.map((r) => [r.name, r.values]));
  }
  /**
   * Garde-fou (O2.4-d) : SetTimer porte (chrono de l'hôte, le nôtre) ; le nôtre ne baisse que quand le jeu attend une
   * action de joy-boy. S'il a baissé de `ctx.blocage` secondes depuis notre dernier envoi, joy-boy est figé : on journalise
   * la décision en attente et l'état du combat, puis, si c'est son tour, on le finit (le combat repart de zéro).
   */
  let chronoRef = null, deblocages = 0, signale = false;
  function surveiller(nous) {
    if (typeof nous !== 'number' || !vu || !moteur()) return;
    if (chronoRef === null || nous > chronoRef) { chronoRef = nous; signale = false; return; }
    if (chronoRef - nous < ctx.blocage || signale) return;
    signale = true;
    const e = moteur(), d = e.decision;
    ctx.ligne(`>>> IA figée depuis ${Math.round(chronoRef - nous)} s (chrono de joy-boy) : tour ${vu.turn} à ${vu.turnPlayer === 1 ? 'joy-boy' : 'l’hôte'},`,
      `décision ${d ? `${d.player}/${d.kind}${d.tag ? '/' + d.tag : ''} « ${d.prompt} » [${d.options.map((o) => o.id).slice(0, 8).join(', ')}]` : 'aucune'},`,
      `combat ${combat.phase}/${combat.step}${combat.snap ? ` (moteur : ${combat.snap.outcome}, ${combat.snap.attacker} contre ${combat.snap.target})` : ''},`,
      `backlog ${table.backlog.length}, carte retenue ${table.held ? 'oui' : 'non'}`);
    if (vu.turnPlayer !== 1) { ctx.ecart(`IA figée pendant le tour de l’hôte (combat ${combat.phase}/${combat.step})`); return; }
    deblocages++;
    ctx.ecart(`IA figée à son tour ${vu.turn} (combat ${combat.phase}/${combat.step}) : fin de tour forcée`);
    combat = cb.createCombat();
    const fin = e.decision?.player === 1 && !e.decision.inEffect && e.decision.options.find((o) => o.id === 'end');
    if (fin) {
      table = inbound.withGame(table, answerExternal(e, 'end', { joyboy: 1 }), { mirror: optsMiroir() }).table;
      sortant(e, moteur(), 'end', 'all');
    } else {
      envoyer([versServeur('AttemptingToEndTurn'), versServeur('AddLogLine', { s: 'Log.EndTurn', bPlayer: true, s1: '', s2: '', i1: -999, i2: -999 }),
        versServeur('EndTurn')], true);
    }
    ctx.ligne('>>> IA : fin de tour forcée envoyée');
  }
  function melange() {
    const ordre = [...Array(vu.players[1].zones.deck.length).keys()];
    for (let j = 0; j < ordre.length; j++) { const k = j + crypto.randomInt(ordre.length - j); [ordre[j], ordre[k]] = [ordre[k], ordre[j]]; }
    return versServeur('ShuffleDeck', { s_ShuffleString: ordre.join('-') });
  }
  function sortant(avant, apres, choix, scope) {
    const out = outbound.translateOutbound(vu, apres, { seat: 1, before: avant, choice: choix, scope, object: ctx.objet(), mirror: optsMiroir() });
    ecarts(out.problems, 'outbound');
    envoyer(out.rpcs, false);
    vu = out.mirror;
  }
  /** Ouverture : l'hôte a choisi qui commence ; mélange et 5 cartes (le moteur demandera alors « garder sa main ? »). */
  function ouvrir() {
    if (ouverture !== 'attente' || !vu) return;
    ouverture = 'main';
    ctx.ligne('>>> IA : ouverture (mélange, 5 cartes)');
    envoyer([melange()], true);
    envoyer([versServeur('DrawCard', { iCount: 5 })], true);
  }
  /** Garder ou repiocher, en RPC (O2.2), une seule fois ; puis les vies (nombre de vies du Leader). */
  function repondreOuverture(e, choix) {
    if (ouverture !== 'main') return;
    ouverture = 'vies';
    ctx.ligne(`>>> IA : ${choix === 'mulligan' ? 'on repioche 5 cartes' : 'on garde sa main'}, puis les vies`);
    if (choix === 'mulligan') {
      envoyer([versServeur('MoveHandToDeck')], true);
      envoyer([melange()], true); // tiré sur le deck après le retour de la main
      envoyer([versServeur('DrawCard', { iCount: 5 })], true);
    }
    const vies = cartes.cardData()[e.players[1].leader.num]?.life ?? 5;
    envoyer([versServeur('PopulateLifeDeck', { iLifeCount: vies })], true);
  }
  /**
   * Lots d'un pas de combat. Les effets des cartes de joy-boy pendant ce pas (ses [En attaquant] : bonus, KO…) ne sont
   * pas dans `send` : combat.ts indique où ils vont (`effectsBefore`, avant SelectBlocker) et c'est outbound qui les
   * traduit, depuis le miroir où les lots précédents sont déjà posés. Correction O2.4-d : sans eux (essai réel n° 4, le
   * +1000 de Jinbe ST01-005 à Sanji), le jeu et le moteur ne voyaient plus le même combat, et le moteur attendait une
   * main rendue qui ne venait pas.
   */
  function envoyerCombat(res, avant) {
    const k = res.effectsBefore ?? res.send.length;
    for (const l of res.send.slice(0, k)) envoyer(l, true);
    if (res.effectsBefore !== undefined && avant) sortant(avant, moteur(), undefined, 'all');
    for (const l of res.send.slice(k)) envoyer(l, true);
  }
  function jouerDecisions() {
    for (let garde = 0; garde < 300; garde++) {
      const e = moteur(), d = e?.decision;
      if (!d || d.player !== 1 || e.winner !== null || table.backlog.length || cb.waiting(combat, e, 1)) return;
      const choix = heuristicChooser(e, d);
      if (d.kind === 'mulligan') { repondreOuverture(e, choix); return; }
      decisions++;
      if (cb.routesTo(combat, choix)) {
        const r = cb.combatAnswer(combat, e, choix, ctxCombat());
        combat = r.combat;
        ecarts(r.notes, 'combat');
        table = inbound.withGame(table, r.game, { mirror: optsMiroir() }).table;
        envoyerCombat(r, e);
      } else {
        table = inbound.withGame(table, answerExternal(e, choix, { joyboy: 1 }), { mirror: optsMiroir() }).table;
        sortant(e, moteur(), choix, 'all');
      }
    }
    ctx.ecart('IA : plus de 300 décisions d’affilée, boucle arrêtée');
  }
  function surRpcIA(r, siege) {
    if (/ServerRpc$/.test(r.name)) return;
    const n = baseName(r.name);
    // 1. combat (avant inbound)
    if (moteur() && (combat.phase !== 'idle' || cb.COMBAT_RPCS.has(n))) {
      const apres = applyRpc(table.mirror, r, siege, optsMiroir());
      if (siege === 0) vu = applyRpc(vu, r, 0, optsMiroir()).state;
      const res = cb.handleCombatRpc(combat, moteur(), r, siege, apres.externals, ctxCombat());
      combat = res.combat;
      ecarts(res.notes, 'combat');
      const avantCombat = moteur();
      table = inbound.withGame(table, res.game, { mirror: optsMiroir() }).table;
      envoyerCombat(res, avantCombat);
    } else if (siege === 0 && vu) vu = applyRpc(vu, r, 0, optsMiroir()).state;
    // 2. inbound
    const avant = moteur();
    const res = inbound.receive(table, r, siege, { mirror: optsMiroir() });
    table = res.table;
    ecarts(res.errors, 'inbound');
    if (!avant && moteur()) {
      const inconnues = table.unknown.map((u) => u.code);
      if (inconnues.length) { ctx.inconnues(inconnues); versSecours(`cartes inconnues de joy-boy : ${inconnues.join(', ')}`); return; }
      vu = structuredClone(table.mirror);
      ctx.ligne('>>> IA : moteur prêt (table partagée)');
    }
    if (!moteur()) return;
    if (n === 'ChooseTurnOrder') ouvrir();
    // 4. conséquences : seulement sur une RPC de l'hôte (nos échos ne font que confirmer ce que le moteur a déjà)
    if (siege === 0 && ouverture === 'vies' && moteur().flow.stage !== 'mulligan' && combat.phase === 'idle' && !table.backlog.length && !table.held) {
      sortant(moteur(), moteur(), undefined, 'self');
    }
    // 3. décisions : aussi après nos échos (la question « garder sa main ? » vient de l'écho de nos 5 cartes)
    jouerDecisions();
  }
  return {
    nom: 'ia',
    bilan: () => ({ decisions, envoyees, ecartsMoteurMiroir: table.errors.length, deblocages }),
    /** Options du miroir avec la puissance du moteur (effets passifs compris), pour le miroir du bilan aussi. */
    optionsMiroir: () => (secours ? undefined : optsMiroir()),
    surRpc(r, sortie, siege = 0) {
      if (secours) { if (siege === 0) secours.surRpc(r, sortie); return; }
      try {
        surRpcIA(r, siege);
        if (siege === 0 && r.name === 'SetTimerClientRpc') surveiller(r.values.fClientTime);
      } catch (e) {
        versSecours(`erreur sur ${r.name} (${e.message})`);
        if (siege === 0) secours.surRpc(r, sortie);
      }
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
    envoyer, ligne: j.ligne, attendre, deck, nom, miroir: () => miroir, objet: () => objet, blocage: o.blocage ?? 20,
    ecart: (t) => bilan.ecarts.push(t), inconnues: (c) => bilan.cartesInconnues.push(...c),
  };

  function finir(issue) {
    if (termine) return;
    termine = true; clearTimeout(minuteur);
    bilan.issue = issue; bilan.duree = Math.round((Date.now() - debut) / 1000);
    bilan.erreursMiroir = miroir.errors.slice(0, 50); bilan.nonGerees = miroir.unhandled;
    if (pilote?.bilan) bilan.ia = pilote.bilan();
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
    // Puissance du moteur quand le pilote ia l'a (comme la table croisée), sinon puissance imprimée : un combat mal
    // tranché ici décalerait les indices du terrain (essai du 18 nov., Jinbe OP17-083).
    const opts = pilote?.optionsMiroir?.() ?? optionsMiroir;
    try { sortie = applyRpc(miroir, r, siege, opts); miroir = sortie.state; } catch (e) { bilan.ecarts.push(`miroir, ${r.name} : ${e.message}`); }
    if (r.name === 'EndTurnClientRpc') j.ligne('>>> Miroir :', resumeMiroir(miroir));
    // le pilote voit tout : les RPC de l'hôte et l'écho des nôtres (la table croisée d'O2.2 en a besoin)
    try { pilote?.surRpc(r, sortie, siege); } catch (e) { bilan.ecarts.push(`pilote, ${r.name} : ${e.message}`); j.ligne('>>> Erreur du pilote :', e.message); }
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
  console.error('Usage : node scripts/optcgsim/banc.mjs <CODE> [--deck ST-01|fichier.deck|deck.json] [--nom Nom] [--pilote auto|ia|minimal] [--journal dossier] [--minutes 60] [--blocage 20]');
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
    else if (a === '--blocage') { o.blocage = Number(v()); if (!(o.blocage > 0)) usage(); }
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
