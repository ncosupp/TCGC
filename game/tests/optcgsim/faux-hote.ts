// Faux hôte OPTCGSim interactif (tâche O3.2), sans aucun accès réseau. Contrairement à faux-jeu.ts, qui rejoue les lots
// d'une partie enregistrée, il répond à ce qu'envoie la session : chaque ServerRpc du joueur joy-boy lui revient en
// ClientRpc (l'écho, comme dans le vrai jeu), et l'hôte joue ses propres tours (pioche, DON!!, Sanji OP17-082 « pioche 2,
// défausse 2 » quand il l'a en main, fin de tour). Pendant le tour de joy-boy, il envoie son chrono (SetTimer) qui baisse,
// comme le jeu, pour que le garde-fou de la session soit exercé.
//
// Mise en place : le lot de connexion de l'hôte (approbation, synchro de scène, nom, Leader, deck) vient de la partie
// anonymisée du 18 nov., 12 h 13 (fixture essais/banc-2026-11-18-1213.json), avec le deck de l'hôte remplacé par celui
// qu'on lui donne (partie « miroir » : mêmes codes de cartes des deux côtés). Son ordre de tour (l'hôte commence), son
// mélange et sa main de départ viennent du lot suivant de la même partie.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyRpc, createMirror, type Mirror } from '../../online/optcgsim/mirror.ts';
import { buildBatch, MESSAGE_TYPE, parseBatch, type NgoMessage } from '../../online/optcgsim/netcode.ts';
import { decode, rpcEntry, rpcMessage } from '../../online/optcgsim/rpc.ts';
import type { Channel, Transport } from '../../online/optcgsim/transport.ts';
import type { Rpc, Seat } from '../../online/optcgsim/types.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const PAQUETS = (JSON.parse(fs.readFileSync(ici('./fixtures/essais/banc-2026-11-18-1213.json'), 'utf8')) as { paquets: Paquet[] }).paquets;
const ENTRANTS = PAQUETS.filter((p) => p.sens === 'entrant').map((p) => Buffer.from(p.lot, 'hex') as Uint8Array);
const rpcsOf = (lot: Uint8Array) => parseBatch(lot).filter((m) => m.type === MESSAGE_TYPE.ClientRpc).map((m) => decode(m.payload));
/** Premier lot entrant : connexion et mise en place de l'hôte ; celui qui porte ChooseTurnOrder : ordre, mélange, main. */
const LOT_MISE_EN_PLACE = ENTRANTS.findIndex((l) => rpcsOf(l).some((r) => r.name === 'LoadLeaderClientRpc'));
const LOT_ORDRE = ENTRANTS.findIndex((l) => rpcsOf(l).some((r) => r.name === 'ChooseTurnOrderClientRpc'));

export const HOTE = 1; // objet réseau de l'hôte dans la fixture
const SANJI = 'OP17-082';

export interface FauxHote {
  /** Lokis joués par l'hôte (KO de deux Personnages de joy-boy, réaction transmise à joy-boy). */
  lokiHote: () => number;
  /** Désaccords sur qui agit (gsv_CurrentGame.iPlayerAction de l'hôte) : coup de joy-boy alors que l'hôte croit avoir
   * la main pendant le tour de joy-boy, ou fin de tour de l'hôte sans la main. */
  desaccords: () => number;
  /** Nombre de ServerRpc reçues quand l'hôte a transmis la réaction de Loki (début de la réponse de joy-boy). */
  lokiA: () => number;
  /** Réactions (remplacement de Zoro) que joy-boy a transmises à l'hôte, et Personnages sauvés par l'hôte. */
  reactionsHote: () => number;
  sauvesHote: () => number;
  transport: Transport;
  /** L'hôte a lancé la partie (sa mise en place est partie). */
  lancee: () => boolean;
  /** ServerRpc reçues de la session, dans l'ordre. */
  recues: () => Rpc[];
  /** Miroir tenu par le faux hôte (ce que « voit » le jeu). */
  miroir: () => Mirror;
  /** Sanji joués par l'hôte. */
  sanjiHote: () => number;
  /** Fait envoyer à l'hôte des ClientRpc choisies par le test (nom sans « ClientRpc », valeurs complétées par défaut). */
  envoyer: (rpcs: [string, Record<string, unknown>][]) => void;
}

/** Valeurs d'une ClientRpc d'écho : celles de la ServerRpc, complétées par défaut (clientId du joueur, etc.). */
function valeursEcho(nom: string, v: Record<string, unknown>): Record<string, unknown> | null {
  const e = rpcEntry(nom);
  if (!e) return null;
  const out: Record<string, unknown> = {};
  for (const w of e.ecritures) {
    if (w.param in v) out[w.param] = v[w.param];
    else if (w.param === 'clientId') out[w.param] = 3;
    else if (w.nullable) out[w.param] = null;
    else if (w.codage === 'chaine') out[w.param] = '';
    else if (w.codage === 'bool') out[w.param] = false;
    else if (w.codage === 'float') out[w.param] = 0;
    else out[w.param] = 0;
  }
  return out;
}

/**
 * Salles publiques (tâche O4.2) : `refuse` : l'hôte refuse la connexion (ApprovalCheck d'OPTCGSim : salle déjà prise,
 * partie lancée), il ferme la connexion sans rien envoyer ; `lanceApres` : l'hôte (spectateurs autorisés, bouton
 * « Prêt ») ne lance la partie qu'au bout de ce nombre de ms (Infinity : jamais) ; d'ici là, il approuve la connexion et
 * synchronise la scène, mais n'envoie pas sa mise en place et garde pour plus tard ce que lui envoie joy-boy.
 *
 * `deck` : Leader et 50 cartes de l'hôte. `tours` : nombre de tours de l'hôte avant qu'il quitte la salle (le jeu
 * ferme alors la connexion : victoire de joy-boy). `chrono` : secondes perdues par le chrono de joy-boy à chaque tic.
 */
export function fauxHote(deck: { leader: string; cards: string[] }, { tours = 3, chrono = 10, loki = false, lokiSi = (_m: Mirror): boolean => true, forcee = false, forceeActeur = 30, forceeTourJoyboy = false, zoroHote = 'accepte' as 'accepte' | 'refuse', impatient = false, refuse = false, lanceApres = 0 } = {}): FauxHote {
  const recues: Rpc[] = [];
  let recevoir: (d: Uint8Array, c?: Channel) => void = () => {};
  let fermer: (r: string) => void = () => {};
  let ferme = false, connecte = false, objetJoyboy = 2;
  let m: Mirror = createMirror();
  let lokiRecues = -1, reactions = 0, sauves = 0, impatience = false;
  const fileRecue: number[] = [];
  let lance = false;
  const enAttente: Uint8Array[] = [];
  let toursHote = 0, sanji = 0, lokis = 0, attenteReaction = false, attenteForcee = false, bascule = false, agit: 0 | 1 = 0, desaccords = 0, forceeJoyboy = false, horloge: ReturnType<typeof setInterval> | null = null, tempsJoyboy = 600;

  const siege = (r: Rpc): Seat => (r.object === HOTE ? 0 : 1);
  /** Envoie des ClientRpc (et les pose sur le miroir de l'hôte). */
  function emettre(rpcs: Rpc[]) {
    if (ferme || !rpcs.length) return;
    for (const r of rpcs) {
      m = applyRpc(m, r, siege(r)).state;
      // qui agit, vu de l'hôte (gsv_CurrentGame.iPlayerAction : 0 lui, 1 joy-boy), comme le jeu
      if (r.object === HOTE && r.name === 'SwitchTurnsClientRpc') agit = agit === 0 ? 1 : 0;
      if (r.object === HOTE && r.name === 'ProcOpponentV3ActionClientRpc') agit = 1;
    }
    const lot = buildBatch(rpcs.map((r) => rpcMessage(r.name, r.values, { object: r.object, behaviour: r.behaviour })));
    setTimeout(() => { if (!ferme) recevoir(lot, 'fiable' as Channel); }, 1);
  }
  const hote = (n: string, values: Record<string, unknown> = {}): Rpc => {
    const v = valeursEcho(`${n}ClientRpc`, { clientId: 0, ...values });
    return { name: `${n}ClientRpc`, object: HOTE, behaviour: 0, values: v ?? values };
  };
  /** Lot de la fixture, deck de l'hôte remplacé ; les échos du joueur de la fixture (objet 2) sont retirés. */
  function lotFixture(k: number, garder: (r: Rpc) => boolean = () => true): Rpc[] {
    return rpcsOf(ENTRANTS[k]).filter((r) => r.object === HOTE && garder(r)).map((r) => {
      if (r.name === 'LoadLeaderClientRpc') return { ...r, values: { ...r.values, sCardID: deck.leader } };
      if (r.name === 'LoadDeckCardClientRpc') return { ...r, values: { ...r.values, sCardID: deck.cards[Number(r.values.iIdx)] } };
      return r;
    });
  }
  const finir = (raison: string) => {
    if (ferme) return;
    ferme = true;
    if (horloge) clearInterval(horloge);
    fermer(raison);
  };

  // ---------- tours de l'hôte
  function tourHote() {
    agit = 0;
    toursHote++;
    if (toursHote > tours) { setTimeout(() => finir('le jeu a quitté la salle'), 5); return; }
    const premier = toursHote === 1;
    const lot: Rpc[] = [];
    if (!premier) lot.push(hote('DrawCard', { iCount: 1 }));
    const dons = Math.min(premier ? 1 : 2, m.players[0].zones.donDeck.length);
    if (dons) lot.push(hote('DrawDon', { iCount: dons }));
    emettre(lot);
    // Sanji : pose, [Jouée] pioche 2 puis défausse 2 (séquence du jeu, partie de 12 h 13)
    const P = m.players[0].zones;
    const i = P.hand.findIndex((c) => c.code === SANJI);
    const actives = P.donCost.filter((d) => !d.rested).length;
    if (i >= 0 && actives >= 2 && P.deploy.length < 5) {
      sanji++;
      emettre([hote('TapDon', { iCount: 2 }), hote('MoveHandCardToDeploy', { iIdx: i, bRested: false })]);
      const idx = m.players[0].zones.deploy.length - 1;
      emettre([hote('SetCardAbilityUsed', { iCardIndex: idx, iActionIdx: 1 }), hote('DrawCard', { iCount: 2 })]);
      emettre([hote('SetCardAbilityUsed', { iCardIndex: idx, iActionIdx: 1 }), hote('MoveHandCardToDiscard', { iCardIdx: 0 }),
        hote('MoveHandCardToDiscard', { iCardIdx: 0 }), hote('AllOnKOResolved')]);
    }
    // Zoro OP17-095 (son remplacement sera demandé par joy-boy, écart n° 3) : posé une fois s'il est en main
    {
      const Z = m.players[0].zones;
      const z = Z.hand.findIndex((c) => c.code === 'OP17-095');
      if (z >= 0 && Z.donCost.filter((d) => !d.rested).length >= 2 && Z.deploy.length < 5 && !Z.deploy.some((c) => c.code === 'OP17-095')) {
        emettre([hote('TapDon', { iCount: 2 }), hote('MoveHandCardToDeploy', { iIdx: z, bRested: false })]);
      }
    }
    // Loki OP17-119 ([Jouée] KO de Personnages adverses) : comme le jeu le 18 nov. à 16 h 33, avec Zoro OP17-095 chez
    // joy-boy, la réaction (« à la place ») lui est transmise et l'hôte attend qu'il rende la main
    const siens = m.players[1].zones.deploy;
    if (loki && !lokis && siens.length >= 2 && lokiSi(m) && m.players[0].zones.hand.length && m.players[0].zones.deploy.length < 5) {
      lokis++;
      lokiRecues = recues.length;
      emettre([hote('MoveHandCardToDeploy', { iIdx: 0, bRested: false })]);
      const idx = m.players[0].zones.deploy.length - 1;
      emettre([hote('SetCardAbilityUsed', { iCardIndex: idx, iActionIdx: 2 }), hote('AllOnKOResolved'), hote('AllOnKOResolved'),
        hote('QueueOpponentPlayerSaveQueue', { iDeployIdx: 1 }), hote('QueueOpponentPlayerSaveQueue', { iDeployIdx: 0 }),
        hote('SwitchTurns'), hote('AllOnKOResolved'),
        hote('ProcOpponentV3Action', { iActor: -410, iAction: 1, eRemoval: 8, bForcedOpp: false, iStartOnStep: 0, iRemovalPlayer: 0, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false }),
        hote('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false })]);
      attenteReaction = true;
      return; // la suite quand joy-boy rend la main (NoMorePendingActions)
    }
    // action imposée à joy-boy (bForcedOpp) : l'hôte attend qu'il lui renvoie la liste des actions (TriggerOpponentMultiActions)
    if (forcee && toursHote === 2) {
      emettre([hote('ProcOpponentV3Action', { iActor: forceeActeur, iAction: 0, eRemoval: 0, bForcedOpp: true, iStartOnStep: 1, iRemovalPlayer: -1, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false }),
        hote('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false })]);
      attenteForcee = true;
      return;
    }
    finTour();
  }
  function finTour() {
    if (agit !== 0) desaccords++; // l'hôte ne peut finir son tour que s'il a la main
    emettre([hote('AttemptingToEndTurn'), hote('EndTurn')]);
    agit = 1;
    // tour de joy-boy : son chrono baisse tant qu'il ne joue pas
    tempsJoyboy = 600;
    horloge = setInterval(() => {
      tempsJoyboy -= chrono;
      emettre([{ name: 'SetTimerClientRpc', object: HOTE, behaviour: 0, values: { fServerTime: 600, fClientTime: tempsJoyboy } }]);
    }, 3);
  }

  // ---------- ce qu'envoie la session
  function surLot(d: Uint8Array, dejaRecue = false) {
    const messages = parseBatch(d);
    const rpcs = messages.filter((x: NgoMessage) => x.type === MESSAGE_TYPE.ServerRpc).map((x) => decode(x.payload));
    if (!rpcs.length) return;
    if (!dejaRecue) recues.push(...rpcs);
    if (!lance) { enAttente.push(d); return; } // partie pas encore lancée par l'hôte : traité au lancement
    objetJoyboy = rpcs[0].object;
    if (horloge) { clearInterval(horloge); horloge = null; } // joy-boy a joué : son chrono s'arrête
    const echos: Rpc[] = [];
    for (const r of rpcs) {
      const base = r.name.replace(/ServerRpc$/, '');
      if (base === 'VersionCheck') continue;
      const nom = base === 'AddLogLine' ? 'TranslateLogLineClientRpc' : `${base}ClientRpc`;
      const v = valeursEcho(nom, r.values);
      if (v) echos.push({ name: nom, object: objetJoyboy, behaviour: 0, values: v });
    }
    // nos SwitchTurns rendent la main (ou la reprennent) ; un coup de joy-boy alors que l'hôte croit avoir la main
    // pendant le tour de joy-boy est un désaccord (tâche O5.0a : SwitchTurns de trop pendant notre tour)
    for (const r of rpcs) {
      if (r.name === 'SwitchTurnsServerRpc') agit = agit === 0 ? 1 : 0;
      if (agit === 0 && m.turnPlayer === 1 && ['MoveHandCardToDeployServerRpc', 'EndTurnServerRpc', 'TapCardServerRpc', 'SetupAttackServerRpc'].includes(r.name)) desaccords++;
    }
    emettre(echos);
    const noms = rpcs.map((r) => r.name);
    // action imposée PENDANT le tour de joy-boy (un [Contre] ou un [En cas de KO] de l'hôte, CA4) : l'hôte la transmet
    // (sans SwitchTurns) et attend AllOnKOResolved ; joy-boy garde la main, son tour continue
    if (forceeTourJoyboy && !forceeJoyboy && m.turnPlayer === 1 && noms.includes('MoveHandCardToDeployServerRpc')) {
      forceeJoyboy = true;
      setTimeout(() => emettre([hote('AllOnKOResolved'),
        hote('ProcOpponentV3Action', { iActor: forceeActeur, iAction: 0, eRemoval: 0, bForcedOpp: true, iStartOnStep: 1, iRemovalPlayer: -1, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false }),
        hote('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false })]), 5);
    }
    if (noms.includes('SetMyTurnRollServerRpc')) emettre(lotFixture(LOT_ORDRE)); // l'hôte commence, mélange, 5 cartes
    if (noms.includes('PopulateLifeDeckServerRpc')) {
      emettre([hote('PopulateLifeDeck', { iLifeCount: 5 })]);
      tourHote();
    }
    if (noms.includes('EndTurnServerRpc')) setTimeout(tourHote, 2);
    // hôte « impatient » (Décision 9) : joy-boy pose un Personnage et l'hôte, sans attendre la fin de son tour, joue le sien
    // (comme après la fin de tour forcée du 18 nov.) : la session doit suivre au lieu de rester bloquée
    if (impatient && !impatience && noms.includes('MoveHandCardToDeployServerRpc')) { impatience = true; setTimeout(tourHote, 20); }
    // comme le vrai jeu (PopulateListOfActionsFromOpponent) : la liste d'actions ne lui rend la main que s'il a d'abord
    // reçu SwitchTurns ; sinon il reste à attendre (blocage de la partie de production du 19 nov., i_tAJm)
    if (attenteForcee) {
      const k = noms.indexOf('TriggerOpponentMultiActionsServerRpc');
      if (noms.slice(0, k < 0 ? noms.length : k).includes('SwitchTurnsServerRpc')) bascule = true;
      if (k >= 0 && bascule && agit === 0) { attenteForcee = false; bascule = false; setTimeout(finTour, 2); }
    }
    if (attenteReaction && noms.includes('NoMorePendingActionsServerRpc')) { attenteReaction = false; setTimeout(finTour, 2); }
    // joy-boy nous transmet une réaction (remplacement de Zoro) : file, SwitchTurns, ProcOpponentV3Action, Trigger…
    const file = rpcs.filter((r) => r.name === 'QueueOpponentPlayerSaveQueueServerRpc').map((r) => Number(r.values.iDeployIdx));
    if (file.length) fileRecue.push(...file);
    if (noms.includes('ProcOpponentV3ActionServerRpc')) {
      reactions++;
      const Z = m.players[0].zones;
      const lot: Rpc[] = [];
      if (zoroHote === 'accepte' && Z.trash.length >= 3) {
        // 3 cartes de la Défausse au-dessous du deck (celle du dessus à chaque fois), le Personnage reste
        for (let k = 0; k < 3; k++) lot.push(hote('MoveTrashCardToDeckBottom', { iCardIdx: Z.trash.length - 1 - k }));
        sauves += fileRecue.length;
      } else {
        // ResolvePendingKOs : la file depuis la fin, chaque Personnage dans la Défausse
        for (const i of [...fileRecue].reverse()) lot.push(hote('DiscardFromSelfDeploy', { iCardIndex: i }));
      }
      fileRecue.length = 0;
      lot.push(hote('AllOnKOResolved'), hote('SwitchTurns'), hote('ResetActionPhase'), hote('NoMorePendingActions'));
      setTimeout(() => emettre(lot), 3);
    }
    if (noms.includes('ConcedeServerRpc')) setTimeout(() => finir('le jeu a quitté la salle'), 2);
  }

  const transport: Transport = {
    userId: 'JOUEUR-TEST',
    send(d) {
      if (ferme) return;
      if (!connecte) {
        connecte = true;
        // approbation refusée : OPTCGSim déconnecte le client sans raison (aucun message NGO)
        if (refuse) { setTimeout(() => finir('déconnexion demandée par le jeu'), 1); return; }
        // le lot de mise en place porte aussi les messages NGO (approbation, synchro de scène) : rejoué tel quel, deck remplacé
        const autres = parseBatch(ENTRANTS[LOT_MISE_EN_PLACE]).filter((x) => x.type !== MESSAGE_TYPE.ClientRpc);
        m = createMirror();
        const rpcs = lotFixture(LOT_MISE_EN_PLACE);
        const lancer = () => {
          if (ferme) return;
          lance = true;
          for (const r of rpcs) m = applyRpc(m, r, 0).state;
          recevoir(buildBatch(rpcs.map((r) => rpcMessage(r.name, r.values, { object: r.object, behaviour: r.behaviour }))), 'fiable' as Channel);
          for (const d2 of enAttente.splice(0)) surLot(d2, true);
        };
        if (!lanceApres) {
          lance = true;
          for (const r of rpcs) m = applyRpc(m, r, 0).state;
          const lot = buildBatch([...autres, ...rpcs.map((r) => rpcMessage(r.name, r.values, { object: r.object, behaviour: r.behaviour }))]);
          setTimeout(() => recevoir(lot, 'fiable' as Channel), 1);
        } else {
          setTimeout(() => recevoir(buildBatch(autres), 'fiable' as Channel), 1);
          if (Number.isFinite(lanceApres)) setTimeout(lancer, lanceApres);
        }
        return;
      }
      surLot(d);
    },
    onData(h) { recevoir = h; },
    onClose(h) { fermer = h; },
    close() { finir('fermée par joy-boy'); },
  };
  return { transport, lancee: () => lance, recues: () => recues, miroir: () => m, sanjiHote: () => sanji, lokiHote: () => lokis, desaccords: () => desaccords, lokiA: () => lokiRecues, reactionsHote: () => reactions, sauvesHote: () => sauves,
    envoyer: (rpcs) => emettre(rpcs.map(([n, v]) => hote(n, v))) };
}
