// Faux hôte OPTCGSim interactif (tâche O3.2, rendu fidèle par la tâche O5.2), sans aucun accès réseau. Contrairement à
// faux-jeu.ts, qui rejoue les lots d'une partie enregistrée, il répond à ce qu'envoie la session : chaque ServerRpc du
// joueur joy-boy lui revient en ClientRpc (l'écho, comme dans le vrai jeu), et l'hôte joue ses propres tours (pioche,
// DON!!, Sanji OP17-082 « pioche 2, défausse 2 » quand il l'a en main, fin de tour).
//
// Fidélité (tâche O5.2, audit O5.0 § 1 et § 5.1, d'après la décompilation 1.45b, lue sans rien recopier) : le faux hôte
// tient, comme le jeu, SON `gsv_CurrentGame.iPlayerAction` (0 = lui, 1 = joy-boy), son état (`e_CurrentState`, réduit
// aux états utiles) et ses trois drapeaux d'attente (`bOpponentResolving`, `bForcingOpponentAction`,
// `bOpponentPendingActions`). Les RPC de joy-boy les changent comme les …ClientRpc du jeu (NetworkPlayerScript,
// branche `!IsOwner`) : SwitchTurns bascule, AllOnKOResolved efface deux drapeaux, ResetActionPhase ne reprend la phase
// principale que si les drapeaux sont effacés, la liste d'actions (PopulateListOfActionsFromOpponent) les efface tous,
// SelectBlocker / NoBlocker / ResolveAttack font avancer le combat. L'hôte **refuse d'avancer** tant que ce n'est pas
// à lui (il reste à attendre, comme le jeu) et compte les **désaccords** sur qui agit. Une **impasse** (« les deux camps
// s'attendent ») est relevée quand l'hôte attend joy-boy et que joy-boy se tait sans rien montrer à son joueur pendant
// `impasseSecondes` (secondes simulées) : le faux hôte quitte alors la partie (raison « impasse »), pour qu'un test
// échoue vite au lieu de rester figé.
//
// Horloge simulée (`pendule`) : une seconde simulée tous les `msParSeconde` ms ; dans une salle à minuteur l'hôte
// envoie `SetTimer` chaque seconde et décompte la pendule de celui que SON iPlayerAction désigne (TurnHandler), sauf
// pendant la mise en place. Sans `pendule`, l'ancien comportement (chrono de joy-boy qui baisse pendant son tour) reste.
//
// Attentes sur commande (`injections`, voir faux-hote-attentes.ts) : à des moments donnés (tour de l'hôte, coup de
// joy-boy, défense de l'hôte, fin du tour de joy-boy, mise en place), l'hôte envoie la séquence exacte du jeu pour un
// type d'attente (bloqueur, contre, [Déclenchement], action imposée, liste de réactions, anciennes actions…) et attend
// que joy-boy lui rende la main comme le vrai client.
//
// Mise en place : le lot de connexion de l'hôte (approbation, synchro de scène, nom, Leader, deck) vient de la partie
// anonymisée du 18 nov., 12 h 13 (fixture essais/banc-2026-11-18-1213.json), avec le deck de l'hôte remplacé par celui
// qu'on lui donne. Son ordre de tour (l'hôte commence), son mélange et sa main de départ viennent du lot suivant.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cardData } from '../../engine/cards/index.ts';
import { applyRpc, battlePower, counts, createMirror, locate, type Mirror, type MirrorOptions } from '../../online/optcgsim/mirror.ts';
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

/** Puissances et mots-clés imprimés (le faux hôte résout ses combats comme ResolveAttack_Internal, sans effets passifs). */
const STATS: MirrorOptions = {
  stats: (code) => { const d = cardData()[code]; return d ? { power: d.power, keywords: d.keywords } : undefined; },
};

/** États du jeu utiles au faux hôte (GameplayState, réduit). */
export type EtatJeu = 'MiseEnPlace' | 'Start_WaitOnTurnOrder' | 'PlayerTurn_Action' | 'OpponentTurn_Action' | 'OpponentResolving'
  | 'Attack_WaitOnBlocker' | 'Attack_WaitOnCounters' | 'Life_ActivateTrigger' | 'EndingTurn' | 'Muet';

/** Ce que l'hôte croit, comme le jeu (GameplayLogicScript). */
export interface EtatHote {
  /** gsv_CurrentGame.iPlayerAction vu de l'hôte : 0 = l'hôte agit, 1 = joy-boy. */
  action: 0 | 1;
  etat: EtatJeu;
  resolving: boolean;
  forcing: boolean;
  pending: boolean;
}

/** Moments où une attente peut être injectée. */
export type Moment =
  | 'miseEnPlace'   // joy-boy a envoyé son tirage (SetMyTurnRoll)
  | 'tourHote'      // tour de l'hôte, après pioche et DON!!, l'hôte a la main
  | 'poseJoyboy'    // tour de joy-boy, il vient de poser un Personnage
  | 'defenseHote'   // joy-boy attaque, l'hôte a reçu SelectBlocker et défend (avant son NoBlocker)
  | 'contresHote'   // joy-boy attaque, l'hôte est à l'étape des contres (après son NoBlocker)
  | 'finTourJoyboy'; // joy-boy a envoyé AttemptingToEndTurn

/** Une attente que le test fait jouer à l'hôte. `fois` : nombre de fois au plus (1 par défaut). */
export interface Injection {
  id: string;
  quand: Moment;
  si?: (h: HoteApi) => boolean;
  fois?: number;
  jouer: (h: HoteApi) => void;
}

/** Ce qu'une injection peut faire (faux-hote-attentes.ts). */
export interface HoteApi {
  etat: EtatHote;
  miroir: () => Mirror;
  /** Tours de l'hôte déjà commencés (1 = son premier tour). */
  toursHote: () => number;
  /** RPC de l'hôte (nom sans suffixe), valeurs complétées par défaut. */
  rpc: (n: string, v?: Record<string, unknown>) => Rpc;
  /** Envoie des ClientRpc de l'hôte (posées sur son miroir ; SwitchTurns bascule son iPlayerAction, comme le jeu). */
  emettre: (rpcs: Rpc[]) => void;
  /**
   * L'hôte attend joy-boy : `libere` dit quand il peut reprendre (par défaut : repriseHote au tour de l'hôte, remise
   * au tour de joy-boy) ; `suite` est appelée alors (par défaut : la suite du déroulé en cours). `surJoyboy` faux :
   * l'hôte attend autre chose que joy-boy (pas d'impasse comptée).
   */
  attendre: (nom: string, o?: { libere?: () => boolean; suite?: () => void; surJoyboy?: boolean }) => void;
  desaccord: (quoi: string) => void;
  /** ServerRpc reçues de joy-boy depuis le début de l'attente en cours (ou de la partie). */
  recuesDepuis: (k: number) => Rpc[];
  nbRecues: () => number;
  /** Actions de l'hôte que joy-boy lui a renvoyées dans une liste (TriggerOpponentMultiActions). */
  actionsRendues: () => number;
  /** Fin de la partie côté hôte (le jeu ferme la connexion). */
  finir: (raison: string) => void;
  /** Repris (tour de l'hôte) : c'est à lui, plus rien n'attend, phase principale reprise. */
  repriseHote: () => boolean;
  /** Effet de l'hôte en cours pendant la fin du tour de joy-boy (T3) : un EndTurn de joy-boy reçu entre-temps le coupe. */
  effetFinTour: (actif: boolean) => void;
}

export interface Impasse { seconde: number; tour: number; attente: string; etat: EtatHote; silence: number }

export interface FauxHote {
  /** Lokis joués par l'hôte (KO de deux Personnages de joy-boy, réaction transmise à joy-boy). */
  lokiHote: () => number;
  /** Désaccords sur qui agit (gsv_CurrentGame.iPlayerAction de l'hôte) : nombre, et le détail. */
  desaccords: () => number;
  listeDesaccords: () => string[];
  /** Impasses « les deux camps s'attendent » (le faux hôte a quitté la partie à la première). */
  impasses: () => Impasse[];
  /** Plus long silence de joy-boy (secondes simulées) pendant que l'hôte l'attendait sans décision montrée. */
  silenceMax: () => number;
  /** Attentes jouées (id des injections), dans l'ordre. */
  jouees: () => string[];
  /** Attentes dont l'hôte a été libéré (id), dans l'ordre. */
  liberees: () => string[];
  /** Ce que croit l'hôte maintenant. */
  etat: () => EtatHote;
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
  /** Ferme la connexion (fin de test). */
  fermer: (raison?: string) => void;
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
    else if (w.codage === 'tableau') out[w.param] = [];
    else out[w.param] = 0;
  }
  return out;
}

/** Coups de joy-boy qui supposent qu'il a la main (l'hôte doit le croire aussi). */
const COUPS = new Set(['MoveHandCardToDeploy', 'TapCard', 'SetupAttack', 'EndTurn', 'AttemptingToEndTurn', 'AttachDonToCard']);
/** RPC sans conséquence sur l'attente (chrono, journal, discussion). */
const BRUIT = new Set(['SetTimer', 'AddLogLine', 'TranslateLogLine', 'AddChatLine', 'VersionCheck']);

export interface OptionsHote {
  /** Tours de l'hôte avant qu'il quitte la salle (victoire de joy-boy). */
  tours?: number;
  /** Ancien chrono (sans `pendule`) : secondes perdues par joy-boy à chaque tic pendant son tour. */
  chrono?: number;
  loki?: boolean;
  lokiSi?: (m: Mirror) => boolean;
  forcee?: boolean;
  forceeActeur?: number;
  forceeTourJoyboy?: boolean;
  zoroHote?: 'accepte' | 'refuse';
  impatient?: boolean;
  refuse?: boolean;
  lanceApres?: number;
  /** Horloge simulée fidèle (SetTimer selon l'iPlayerAction de l'hôte) et détecteur d'impasse. */
  pendule?: boolean;
  /** Salle à minuteur (GameStart.bTimerLobby) ; sans minuteur, aucun SetTimer. */
  minuteur?: boolean;
  /** Durée réelle d'une seconde simulée (ms). */
  msParSeconde?: number;
  /** Silence de joy-boy (secondes simulées) au-delà duquel l'hôte qui l'attend relève une impasse et quitte. */
  impasseSecondes?: number;
  /** Le joueur joy-boy a-t-il une décision montrée ? (fourni par le test : la vue de la session). */
  decisionMontree?: () => boolean;
  /** Attentes à jouer sur commande. */
  injections?: Injection[];
  /** Égalité au tirage (M2) : l'hôte tire 0 comme joy-boy et attend que joy-boy choisisse l'ordre. */
  egalite?: boolean;
  /** Pendule de chacun au départ (secondes). */
  penduleDepart?: number;
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
export function fauxHote(deck: { leader: string; cards: string[] }, o: OptionsHote = {}): FauxHote {
  const { tours = 3, chrono = 10, loki = false, lokiSi = (_m: Mirror): boolean => true, forcee = false, forceeActeur = 30, forceeTourJoyboy = false,
    zoroHote = 'accepte', impatient = false, refuse = false, lanceApres = 0, pendule = false, minuteur = true, msParSeconde = 3,
    impasseSecondes = pendule ? 30 : Infinity, decisionMontree = () => false, injections = [], egalite = false, penduleDepart = 1050 } = o;
  const recues: Rpc[] = [];
  let recevoir: (d: Uint8Array, c?: Channel) => void = () => {};
  let fermer: (r: string) => void = () => {};
  let ferme = false, connecte = false, objetJoyboy = 2;
  let m: Mirror = createMirror();
  let lokiRecues = -1, reactions = 0, sauves = 0, impatience = false;
  const fileRecue: number[] = [];
  let lance = false;
  const enAttente: Uint8Array[] = [];
  let toursHote = 0, sanji = 0, lokis = 0, forceeJoyboy = false, horloge: ReturnType<typeof setInterval> | null = null, tempsJoyboy = 600;
  const etat: EtatHote = { action: 0, etat: 'MiseEnPlace', resolving: false, forcing: false, pending: false };
  const desaccords: string[] = [];
  const impasses: Impasse[] = [];
  const jouees: string[] = [], liberees: string[] = [];
  const faites = new Map<string, number>();
  let rendues = 0;
  /** Fenêtre où l'hôte agit pendant le tour de joy-boy (sa défense, une réaction que joy-boy lui a transmise). */
  let fenetreHote = false;
  /** Effet de l'hôte en cours pendant la fin du tour de joy-boy (T3). */
  let effetFinTour = false;
  let attente: { nom: string; libere: () => boolean; suite: () => void; surJoyboy: boolean; depuis: number; k: number } | null = null;
  /** Déroulé en cours (tour de l'hôte, défense…) : étapes restantes. */
  let file: (() => void)[] = [];
  let seconde = 0, silence = 0, silenceMax = 0, ticker: ReturnType<typeof setInterval> | null = null;
  const pendules = { hote: penduleDepart, joyboy: penduleDepart };

  const siege = (r: Rpc): Seat => (r.object === HOTE ? 0 : 1);
  const tourJoyboy = () => m.turnPlayer === 1 && m.turn > 0;
  const desaccord = (quoi: string) => { desaccords.push(`[s${seconde}, tour ${m.turn}] ${quoi}`); };
  /** Effets locaux d'une RPC envoyée par l'hôte (ce que fait le jeu en même temps qu'il l'envoie). */
  function effetEmis(r: Rpc) {
    if (r.name === 'SwitchTurnsClientRpc') {
      etat.action = etat.action === 0 ? 1 : 0;
      if (etat.action === 1) fenetreHote = false;
    }
    if (r.name === 'ProcOpponentV3ActionClientRpc') etat.action = 1;
    // l'attaquant passe la main au défenseur avant d'envoyer SelectBlocker (SetupAttackAfterOnAttackAction)
    if (r.name === 'SelectBlockerClientRpc' || r.name === 'SelectBlockerNoProcsClientRpc') { etat.action = etat.action === 0 ? 1 : 0; etat.etat = 'Attack_WaitOnBlocker'; }
  }
  /** Envoie des ClientRpc (et les pose sur le miroir de l'hôte). */
  function emettre(rpcs: Rpc[]) {
    if (ferme || !rpcs.length) return;
    for (const r of rpcs) {
      m = applyRpc(m, r, siege(r), STATS).state;
      if (r.object === HOTE) effetEmis(r);
    }
    envoyerLot(rpcs);
  }
  function envoyerLot(rpcs: Rpc[]) {
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
      if (r.name === 'SetMyTurnRollClientRpc' && egalite) return { ...r, values: { ...r.values, iRoll: 0 } };
      if (r.name === 'GameStartClientRpc') return { ...r, values: { ...r.values, bTimerLobby: minuteur } };
      return r;
    });
  }
  const finir = (raison: string) => {
    if (ferme) return;
    ferme = true;
    if (horloge) clearInterval(horloge);
    if (ticker) clearInterval(ticker);
    etat.etat = 'Muet';
    fermer(raison);
  };

  // ---------- attentes et déroulés
  const repriseHote = () => etat.action === 0 && !etat.resolving && !etat.forcing && etat.etat === 'PlayerTurn_Action';
  const remiseJoyboy = () => !etat.resolving && !etat.forcing;
  function attendre(nom: string, x: { libere?: () => boolean; suite?: () => void; surJoyboy?: boolean } = {}) {
    const auTour = m.turnPlayer === 0 || m.turn === 0;
    attente = { nom, libere: x.libere ?? (auTour ? repriseHote : remiseJoyboy), suite: x.suite ?? continuer, surJoyboy: x.surJoyboy ?? true, depuis: seconde, k: recues.length };
  }
  function verifierAttente() {
    if (!attente || ferme) return;
    if (!attente.libere()) return;
    const a = attente;
    attente = null;
    liberees.push(a.nom);
    setTimeout(() => { if (!ferme) a.suite(); }, 2);
  }
  /** Lance un déroulé : chaque étape peut poser une attente ; la suivante part quand l'hôte en est libéré. */
  function derouler(etapes: (() => void)[]) { file = [...etapes, ...file]; continuer(); }
  function continuer() {
    while (file.length && !attente && !ferme) file.shift()!();
  }
  const api: HoteApi = {
    etat, miroir: () => m, toursHote: () => toursHote, rpc: hote, emettre, attendre, desaccord,
    recuesDepuis: (k) => recues.slice(k), nbRecues: () => recues.length, actionsRendues: () => rendues, finir, repriseHote,
    effetFinTour: (actif) => { effetFinTour = actif; },
  };
  /** Étapes des injections prévues à ce moment. */
  function injectees(q: Moment): (() => void)[] {
    return injections.filter((x) => x.quand === q).map((x) => () => {
      const n = faites.get(x.id) ?? 0;
      if (n >= (x.fois ?? 1) || (x.si && !x.si(api))) return;
      faites.set(x.id, n + 1);
      jouees.push(x.id);
      x.jouer(api);
    });
  }

  // ---------- horloge simulée (pendule) et détecteur d'impasse
  function tic() {
    if (ferme || !lance) return;
    seconde++;
    // pendule (TurnHandler) : pas pendant la mise en place ; celle de celui que l'hôte croit voir agir
    if (pendule && minuteur && m.turn > 0) {
      if (etat.action === 0) pendules.hote--; else pendules.joyboy--;
      envoyerLot([{ name: 'SetTimerClientRpc', object: HOTE, behaviour: 0, values: { fServerTime: pendules.hote, fClientTime: pendules.joyboy } }]);
    }
    const attendJoyboy = attente ? attente.surJoyboy : etat.action === 1 && etat.etat !== 'Muet';
    if (!attendJoyboy || decisionMontree()) { silence = 0; return; }
    silence++;
    silenceMax = Math.max(silenceMax, silence);
    if (silence >= impasseSecondes) {
      impasses.push({ seconde, tour: m.turn, attente: attente?.nom ?? `iPlayerAction = 1 (${etat.etat})`, etat: { ...etat }, silence });
      finir(`impasse : l'hôte attend joy-boy depuis ${silence} s (${attente?.nom ?? etat.etat})`);
    }
  }

  // ---------- tours de l'hôte
  function tourHote() {
    if (ferme) return;
    etat.action = 0; etat.etat = 'PlayerTurn_Action'; etat.resolving = false; etat.forcing = false; etat.pending = false;
    fenetreHote = false;
    toursHote++;
    if (toursHote > tours) { setTimeout(() => finir('le jeu a quitté la salle'), 5); return; }
    const premier = toursHote === 1;
    const lot: Rpc[] = [];
    if (!premier) lot.push(hote('DrawCard', { iCount: 1 }));
    const dons = Math.min(premier ? 1 : 2, m.players[0].zones.donDeck.length);
    if (dons) lot.push(hote('DrawDon', { iCount: dons }));
    emettre(lot);
    file = [];
    derouler([etapeSanji, etapeZoro, etapeLoki, etapeForcee, ...injectees('tourHote'), finTour]);
  }
  // Sanji : pose, [Jouée] pioche 2 puis défausse 2 (séquence du jeu, partie de 12 h 13)
  function etapeSanji() {
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
  }
  // Zoro OP17-095 (son remplacement sera demandé par joy-boy, écart n° 3) : posé une fois s'il est en main
  function etapeZoro() {
    const Z = m.players[0].zones;
    const z = Z.hand.findIndex((c) => c.code === 'OP17-095');
    if (z >= 0 && Z.donCost.filter((d) => !d.rested).length >= 2 && Z.deploy.length < 5 && !Z.deploy.some((c) => c.code === 'OP17-095')) {
      emettre([hote('TapDon', { iCount: 2 }), hote('MoveHandCardToDeploy', { iIdx: z, bRested: false })]);
    }
  }
  // Loki OP17-119 ([Jouée] KO de Personnages adverses) : comme le jeu le 18 nov. à 16 h 33, avec Zoro OP17-095 chez
  // joy-boy, la réaction (« à la place ») lui est transmise et l'hôte attend qu'il rende la main
  function etapeLoki() {
    const siens = m.players[1].zones.deploy;
    if (!(loki && !lokis && siens.length >= 2 && lokiSi(m) && m.players[0].zones.hand.length && m.players[0].zones.deploy.length < 5)) return;
    lokis++;
    lokiRecues = recues.length;
    emettre([hote('MoveHandCardToDeploy', { iIdx: 0, bRested: false })]);
    const idx = m.players[0].zones.deploy.length - 1;
    emettre([hote('SetCardAbilityUsed', { iCardIndex: idx, iActionIdx: 2 }), hote('AllOnKOResolved'), hote('AllOnKOResolved'),
      hote('QueueOpponentPlayerSaveQueue', { iDeployIdx: 1 }), hote('QueueOpponentPlayerSaveQueue', { iDeployIdx: 0 }),
      hote('SwitchTurns'), hote('AllOnKOResolved'),
      hote('ProcOpponentV3Action', { iActor: -410, iAction: 1, eRemoval: 8, bForcedOpp: false, iStartOnStep: 0, iRemovalPlayer: 0, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false }),
      hote('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false })]);
    etat.resolving = true; etat.etat = 'OpponentResolving';
    jouees.push('loki');
    attendre('loki');
  }
  // action imposée à joy-boy (bForcedOpp) : l'hôte attend qu'il lui rende la main (SwitchTurns, puis la liste d'actions)
  function etapeForcee() {
    if (!(forcee && toursHote === 2)) return;
    emettre([hote('ProcOpponentV3Action', { iActor: forceeActeur, iAction: 0, eRemoval: 0, bForcedOpp: true, iStartOnStep: 1, iRemovalPlayer: -1, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false }),
      hote('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false })]);
    etat.forcing = true; etat.etat = 'OpponentResolving';
    jouees.push('forcee');
    attendre('forcee');
  }
  function finTour() {
    if (etat.action !== 0) desaccord(`l'hôte finit son tour sans avoir la main (${etat.etat})`); // le jeu ne le permet pas
    emettre([hote('AttemptingToEndTurn'), hote('EndTurn')]);
    etat.action = 1; etat.etat = 'OpponentTurn_Action';
    if (pendule) return;
    // ancien chrono : celui de joy-boy baisse tant qu'il ne joue pas
    tempsJoyboy = 600;
    horloge = setInterval(() => {
      tempsJoyboy -= chrono;
      emettre([{ name: 'SetTimerClientRpc', object: HOTE, behaviour: 0, values: { fServerTime: 600, fClientTime: tempsJoyboy } }]);
    }, 3);
  }

  // ---------- défense de l'hôte (joy-boy attaque)
  /** ResolveAttack de l'hôte défenseur (ResolveAttack, puis ResolveAttack_Internal et son verdict). */
  function resoudreDefense() {
    const b = m.battle;
    let touche = false;
    const lot: Rpc[] = [hote('AllOnKOResolved'), hote('ResolveAttack')];
    if (b) {
      const a = locate(m, b.attacker.iid), d = locate(m, b.defender.iid);
      const pa = a ? battlePower(m, a.seat, a.card, true, STATS) ?? 0 : 0, pd = d ? (battlePower(m, d.seat, d.card, false, STATS) ?? 0) + b.counter : 0;
      touche = pa >= pd;
      lot.push(hote('TranslateLogLine', { s: 'Log.CombatResult', bPlayer: false, s1: a?.card.code ?? '', s2: d?.card.code ?? '', i1: pa, i2: pd }));
    }
    emettre(lot);
    if (touche) {
      // Leader touché (pas de [Déclenchement] activé) ou Personnage mis KO : l'hôte rend la main (ReturnToOpponentActionPhase)
      emettre([hote('AllOnKOResolved'), hote('SwitchTurns'), hote('ResetActionPhase'), hote('NoMorePendingActions')]);
    } else {
      etat.action = 1; // repoussée : ResolveAttack_Internal rend la main localement
    }
    etat.etat = 'PlayerTurn_Action';
    fenetreHote = false;
  }
  function defendre() {
    file = [];
    derouler([...injectees('defenseHote'), () => { emettre([hote('NoBlocker')]); etat.etat = 'Attack_WaitOnCounters'; },
      ...injectees('contresHote'), resoudreDefense]);
  }

  // ---------- ce qu'envoie la session (branche !IsOwner des ClientRpc du jeu)
  /** Résultat du combat où joy-boy défend (ResolveAttack de joy-boy, appliqué au miroir de l'hôte). */
  function apresResolveJoyboy(avant: { life: number; deploy: number }) {
    const apres = counts(m, 1);
    if (apres.life < avant.life) { etat.etat = 'Life_ActivateTrigger'; return; } // l'hôte attend la phase de déclenchement de joy-boy
    if (apres.deploy < avant.deploy) { etat.etat = 'OpponentTurn_Action'; return; } // ses [En cas de KO], puis la main rendue
    if (etat.etat === 'Attack_WaitOnCounters') { etat.action = etat.action === 0 ? 1 : 0; if (!etat.forcing && !etat.resolving) etat.etat = 'PlayerTurn_Action'; }
  }
  function surRpcJoyboy(r: Rpc, base: string) {
    if (COUPS.has(base) && etat.action === 0) desaccord(`joy-boy joue (${base}) alors que l'hôte croit avoir la main (${etat.etat})`);
    switch (base) {
      case 'SwitchTurns':
        if (m.turnPlayer === 0 && m.turn > 0 && etat.action === 0 && !attente) desaccord('SwitchTurns de joy-boy alors que l’hôte avait déjà la main à son tour');
        etat.action = etat.action === 0 ? 1 : 0;
        break;
      case 'AllOnKOResolved': etat.resolving = false; etat.forcing = false; break;
      case 'ResetActionPhase': if (!etat.forcing && !etat.resolving) etat.etat = 'PlayerTurn_Action'; break;
      case 'NoMorePendingActions': etat.pending = false; break;
      case 'TriggerOpponentMultiActions': {
        etat.resolving = false; etat.forcing = false; etat.pending = false;
        const a = Array.isArray(r.values.aTransfer) ? r.values.aTransfer as Record<string, unknown>[] : [];
        rendues += a.filter((x) => x && x.iOwner === 0).length;
        if (etat.action === 0) etat.etat = 'PlayerTurn_Action';
        break;
      }
      case 'SelectBlocker': case 'SelectBlockerNoProcs':
        etat.etat = 'Attack_WaitOnBlocker';
        if (base === 'SelectBlocker' && r.values.bDontQueue !== true) etat.action = etat.action === 0 ? 1 : 0;
        fenetreHote = true;
        setTimeout(defendre, 2);
        break;
      case 'SetBlocker': case 'NoBlocker': etat.etat = 'Attack_WaitOnCounters'; break;
      case 'ProcOpponentV3Action': fenetreHote = true; break;
      case 'AttemptingToEndTurn': etat.etat = 'EndingTurn'; break;
      case 'EndTurn':
        if (effetFinTour) { desaccord('joy-boy finit son tour pendant un effet de l’hôte en fin de tour (T3)'); effetFinTour = false; attente = null; }
        break;
      default: break;
    }
  }
  function surLot(d: Uint8Array, dejaRecue = false) {
    const messages = parseBatch(d);
    const rpcs = messages.filter((x: NgoMessage) => x.type === MESSAGE_TYPE.ServerRpc).map((x) => decode(x.payload));
    if (!rpcs.length) return;
    if (!dejaRecue) recues.push(...rpcs);
    if (!lance) { enAttente.push(d); return; } // partie pas encore lancée par l'hôte : traité au lancement
    objetJoyboy = rpcs[0].object;
    if (horloge) { clearInterval(horloge); horloge = null; } // joy-boy a joué : son chrono s'arrête
    if (rpcs.some((r) => !BRUIT.has(r.name.replace(/ServerRpc$/, '')))) silence = 0;
    const echos: Rpc[] = [];
    for (const r of rpcs) {
      const base = r.name.replace(/ServerRpc$/, '');
      if (base === 'VersionCheck') continue;
      const nom = base === 'AddLogLine' ? 'TranslateLogLineClientRpc' : `${base}ClientRpc`;
      const v = valeursEcho(nom, r.values);
      if (!v) continue;
      const echo = { name: nom, object: objetJoyboy, behaviour: 0, values: v };
      const avant = counts(m, 1);
      m = applyRpc(m, echo, 1, STATS).state;
      echos.push(echo);
      surRpcJoyboy(r, base);
      if (base === 'ResolveAttack' && m.turnPlayer === 0) apresResolveJoyboy({ life: avant.life, deploy: avant.deploy });
    }
    // joy-boy a rendu la main à l'hôte pendant son propre tour, hors d'une fenêtre où l'hôte agit : l'hôte croit jouer
    if (tourJoyboy() && etat.action === 0 && !fenetreHote && !effetFinTour) desaccord(`l'hôte croit avoir la main pendant le tour de joy-boy (${etat.etat})`);
    envoyerLot(echos);
    const noms = rpcs.map((r) => r.name);
    // action imposée PENDANT le tour de joy-boy (un [Contre] ou un [En cas de KO] de l'hôte, CA4) : l'hôte la transmet
    // (sans SwitchTurns) et attend AllOnKOResolved ; joy-boy garde la main, son tour continue
    if (forceeTourJoyboy && !forceeJoyboy && m.turnPlayer === 1 && noms.includes('MoveHandCardToDeployServerRpc')) {
      forceeJoyboy = true;
      setTimeout(() => {
        emettre([hote('AllOnKOResolved'),
          hote('ProcOpponentV3Action', { iActor: forceeActeur, iAction: 0, eRemoval: 0, bForcedOpp: true, iStartOnStep: 1, iRemovalPlayer: -1, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false }),
          hote('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false })]);
        etat.forcing = true;
        jouees.push('forceeTourJoyboy');
        attendre('forceeTourJoyboy', { suite: () => {} });
      }, 5);
    }
    if (noms.includes('SetMyTurnRollServerRpc')) {
      if (egalite) {
        // égalité au tirage (M2, WaitOnTurnSelection) : chacun a les boutons « premier / second » ; ce joueur attend
        // que joy-boy choisisse
        etat.etat = 'Start_WaitOnTurnOrder';
        attendre('égalité au tirage (M2)', {
          libere: () => recues.some((r) => r.name === 'ChooseTurnOrderServerRpc'),
          suite: () => {
            const c = recues.find((r) => r.name === 'ChooseTurnOrderServerRpc')!;
            if (Number(c.values.iFirst) !== 0) desaccord('joy-boy choisit de commencer : non joué par le faux hôte');
            emettre(lotFixture(LOT_ORDRE, (r) => r.name !== 'ChooseTurnOrderClientRpc'));
          },
        });
      } else emettre(lotFixture(LOT_ORDRE)); // l'hôte commence, mélange, 5 cartes
      derouler(injectees('miseEnPlace'));
    }
    if (noms.includes('PopulateLifeDeckServerRpc')) {
      emettre([hote('PopulateLifeDeck', { iLifeCount: 5 })]);
      tourHote();
    }
    if (noms.includes('EndTurnServerRpc')) { file = []; attente = null; setTimeout(tourHote, 2); }
    if (m.turnPlayer === 1 && noms.includes('MoveHandCardToDeployServerRpc')) { const e = injectees('poseJoyboy'); if (e.length) setTimeout(() => derouler(e), 5); }
    if (noms.includes('AttemptingToEndTurnServerRpc')) {
      const k = noms.indexOf('AttemptingToEndTurnServerRpc');
      const prets = injections.filter((x) => x.quand === 'finTourJoyboy' && (faites.get(x.id) ?? 0) < (x.fois ?? 1) && (!x.si || x.si(api)));
      if (prets.length && noms.indexOf('EndTurnServerRpc', k) > k) {
        // T3 : AttemptingToEndTurn et EndTurn d'un bloc. Le jeu met l'hôte en EndingTurn ; s'il a un effet à résoudre
        // pendant la fin du tour adverse, il prend la main (AllOnKOResolved, SwitchTurns, GLS:14579-14596) et attend que
        // joy-boy finisse : le EndTurn arrivé dans le même lot coupe son effet.
        for (const x of prets) { faites.set(x.id, (faites.get(x.id) ?? 0) + 1); jouees.push(x.id); }
        desaccord('joy-boy finit son tour d’un bloc, sans attendre l’effet de l’hôte en fin de tour (T3)');
      } else if (prets.length) {
        const e = injectees('finTourJoyboy');
        setTimeout(() => derouler(e), 2);
      }
    }
    // hôte « impatient » (Décision 9) : joy-boy pose un Personnage et l'hôte, sans attendre la fin de son tour, joue le sien
    // (comme après la fin de tour forcée du 18 nov.) : la session doit suivre au lieu de rester bloquée
    if (impatient && !impatience && noms.includes('MoveHandCardToDeployServerRpc')) { impatience = true; setTimeout(tourHote, 20); }
    // joy-boy nous transmet une réaction (remplacement de Zoro) : file, SwitchTurns, ProcOpponentV3Action, Trigger…
    const fileR = rpcs.filter((r) => r.name === 'QueueOpponentPlayerSaveQueueServerRpc').map((r) => Number(r.values.iDeployIdx));
    if (fileR.length) fileRecue.push(...fileR);
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
    verifierAttente();
  }

  function demarrerHorloge() {
    if (ticker || !Number.isFinite(impasseSecondes) && !pendule) return;
    ticker = setInterval(tic, msParSeconde);
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
          demarrerHorloge();
          for (const r of rpcs) m = applyRpc(m, r, 0, STATS).state;
          recevoir(buildBatch(rpcs.map((r) => rpcMessage(r.name, r.values, { object: r.object, behaviour: r.behaviour }))), 'fiable' as Channel);
          for (const d2 of enAttente.splice(0)) surLot(d2, true);
        };
        if (!lanceApres) {
          lance = true;
          demarrerHorloge();
          for (const r of rpcs) m = applyRpc(m, r, 0, STATS).state;
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
  return {
    transport, lancee: () => lance, recues: () => recues, miroir: () => m, sanjiHote: () => sanji, lokiHote: () => lokis,
    desaccords: () => desaccords.length, listeDesaccords: () => [...desaccords], impasses: () => [...impasses], silenceMax: () => silenceMax,
    jouees: () => [...jouees], liberees: () => [...liberees], etat: () => ({ ...etat }),
    lokiA: () => lokiRecues, reactionsHote: () => reactions, sauvesHote: () => sauves,
    envoyer: (rpcs) => emettre(rpcs.map(([n, v]) => hote(n, v))),
    fermer: (raison = 'fin du test') => finir(raison),
  };
}
