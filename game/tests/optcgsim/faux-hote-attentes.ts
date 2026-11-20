// Attentes jouées sur commande par le faux hôte fidèle (tâche O5.2, audit O5.0 § 3 et § 5.1) : pour chaque type de point
// d'attente de l'inventaire, la séquence exacte que le jeu 1.45b envoie (d'après la décompilation, lue sans rien
// recopier ; numéros de ligne de GameplayLogicScript = GLS) et ce qui libère l'hôte. Plus un joueur joy-boy automatique
// et une partie complète prête à l'emploi (`partie`), utilisés par attentes-hote.test.ts (et, plus tard, par le test
// « aucune impasse » de la tâche O5.5).
import { cardData } from '../../engine/cards/index.ts';
import { DECKS } from '../../engine/decks.ts';
import { startSession, type CrossplaySession, type SessionEnd, type SessionOptions } from '../../online/optcgsim/session.ts';
import type { Rpc } from '../../online/optcgsim/types.ts';
import { fauxHote, type FauxHote, type HoteApi, type Injection, type Moment, type OptionsHote } from './faux-hote.ts';
import { tirage } from './faux-jeu.ts';

// ---------------------------------------------------------------------------------------------------- decks

const deckDe = (id: string) => ({ leader: DECKS[id].leader, cards: Object.entries(DECKS[id].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) });
/** ST-01 (Luffy, sans effet passif sur la puissance : le faux hôte et le moteur calculent les mêmes combats). */
export const ST01 = () => deckDe('ST-01');
/** Deck de l'hôte : ST-01 avec `code` chargé en premier (identifiant OPTCGSim 10, `iActor` de ses actions). */
export const avecActeur = (code: string) => { const d = ST01(); return { leader: d.leader, cards: [code, ...d.cards.slice(1)] }; };
/** Identifiant OPTCGSim de la carte chargée en premier (deckUniqueID : (indice + 1) × 10). */
export const ACTEUR = 10;
/** Joy-boy avec des [Bloqueur] (Chopper ST01-006, 1000 : mis KO s'il bloque) et des Personnages à [Déclenchement]. */
export const BLOQUEURS = () => ({ leader: 'ST01-001', cards: [...Array<string>(25).fill('ST01-006'), ...Array<string>(25).fill('ST01-002')] });
/** Joy-boy dont toutes les cartes de Vie ont un [Déclenchement] (ST01-002 Personnage, ST01-014 Évènement [Contre]). */
export const DECLENCHEURS = () => ({ leader: 'ST01-001', cards: [...Array<string>(25).fill('ST01-002'), ...Array<string>(25).fill('ST01-014')] });

// ---------------------------------------------------------------------------------------------------- séquences du jeu

const V3 = { iAction: 0, eRemoval: 0, bForcedOpp: false, iStartOnStep: 0, iRemovalPlayer: -1, iMainTarget: 0, iPrevTarget: 0, bTriggerChance: false, bFree: false };
/** Élément d'une liste d'actions (TransferAction), `iOwner` relatif à celui qui REÇOIT (0 = lui, 1 = l'autre). */
export const transfert = (x: Partial<Record<string, number | boolean>> = {}) => ({
  iOwner: 0, iLocation: 0, iCard: 0, iAction: 0, iTarget: -1, iSaveTarget: -1, eRemoval: 0, iRemovalPlayer: -1, iStackIdx: 1, iStepIdx: 0, iPrevTarget: 0,
  bFree: false, bTriggerOffer: false, ...x,
});

/**
 * BeginOpponentV3Action (GLS:10540-10595), partie multijoueur : sans action imposée et si c'est à l'hôte, SwitchTurns
 * d'abord ; puis AllOnKOResolved, ProcOpponentV3Action, la liste du reste (TransferAllPendingActionsToOpponent), et
 * iPlayerAction = 1. Les drapeaux : bForcingOpponentAction pour une action imposée, bOpponentResolving sinon.
 */
export function procV3(h: HoteApi, v: Partial<typeof V3> & { iActor: number }, reste: Record<string, unknown>[] = []): void {
  const p = { ...V3, ...v };
  const lot: Rpc[] = [];
  if (!p.bForcedOpp && h.etat.action === 0) lot.push(h.rpc('SwitchTurns'));
  lot.push(h.rpc('AllOnKOResolved'), h.rpc('ProcOpponentV3Action', p), h.rpc('TriggerOpponentMultiActions', { aTransfer: reste, bDontStartAny: false }));
  h.emettre(lot);
  h.etat.action = 1;
  h.etat.forcing = p.bForcedOpp;
  h.etat.resolving = !p.bForcedOpp;
  if (h.miroir().turnPlayer === 0) h.etat.etat = 'OpponentResolving';
}

/** Attaque du Leader de l'hôte sur le Leader de joy-boy : TapCard, SetupAttack, SelectBlocker (la main passe à joy-boy). */
export function attaqueHote(id = 'attaque', { tour = 2, cible = -1 } = {}): Injection {
  return {
    id, quand: 'tourHote', si: (h) => h.toursHote() >= tour && !h.miroir().players[0].leader.rested,
    jouer: (h) => {
      h.emettre([h.rpc('TapCard', { iCardIndex: -1 }),
        h.rpc('SetupAttack', { iAttackerIdx: -1, iDefenderIdx: cible, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1 }),
        h.rpc('SelectBlocker', { bDontQueue: false })]);
      // libérée quand le combat est fini et la main revenue (repoussée : ResolveAttack ; touchée : main rendue)
      h.attendre(id);
    },
  };
}

/**
 * Offre de [Déclenchement] (R5, CA5) : un effet de l'hôte inflige des dégâts au Leader de joy-boy (la carte de Vie part
 * en main : OpponentDrawLife) et lui propose le [Déclenchement] (ProcOpponentV3Action, bTriggerChance, DealDamage
 * GLS:1043-1062). Au tour de l'hôte : main rendue (ReturnToOpponentActionPhase) ; au tour de joy-boy : AllOnKOResolved
 * seul (NoTrigger(bOutOfOrder), GLS:29557).
 */
export function offreDeclenchement(id = 'R5', quand: Moment = 'tourHote'): Injection {
  return {
    id, quand, si: (h) => h.miroir().players[1].zones.life.length > 1,
    jouer: (h) => {
      h.emettre([h.rpc('OpponentDrawLife', { iCount: 1 })]);
      procV3(h, { iActor: ACTEUR, bTriggerChance: true, iMainTarget: 20 });
      h.attendre(id); // puis la suite du déroulé en cours (la défense de l'hôte si joy-boy attaque déjà)
    },
  };
}

/**
 * Action imposée (R4, `bForcedOpp`) par la carte chargée en premier (ACTEUR) : au tour de l'hôte, pendant le tour de
 * joy-boy (CA4) ou pendant les contres de l'hôte quand joy-boy attaque (son [Contre] impose l'action).
 */
export function actionImposee(id = 'R4', quand: Moment = 'tourHote', si?: (h: HoteApi) => boolean): Injection {
  return {
    id, quand, ...(si ? { si } : {}),
    jouer: (h) => {
      procV3(h, { iActor: ACTEUR, bForcedOpp: true, iStartOnStep: 1 });
      if (quand === 'tourHote') h.attendre(id);
      // joy-boy attaque, l'hôte aux contres : l'étape des contres doit lui revenir (AllOnKOResolved, SwitchTurns)
      else if (quand === 'contresHote') h.attendre(id, { libere: () => !h.etat.forcing && h.etat.action === 0 });
      else h.attendre(id); // idem
    },
  };
}

/**
 * Liste de réactions (R6) : un effet de l'hôte met KO deux Personnages de joy-boy (DiscardFromDeploy) ; plusieurs
 * actions attendent et aucune n'est active : le jeu envoie SwitchTurns puis TriggerOpponentMultiActions avec la liste
 * complète, sans ProcOpponentV3Action (CreateActionChoices GLS:33231, SendAllActionChoicesToOpponent GLS:33171).
 * `avecHote` : la liste contient aussi une action de l'hôte, que joy-boy doit lui renvoyer.
 */
export function listeReactions(id = 'R6', { avecHote = false } = {}): Injection {
  return {
    id, quand: 'tourHote', si: (h) => h.miroir().players[1].zones.deploy.length >= 2,
    jouer: (h) => {
      h.emettre([h.rpc('DiscardFromDeploy', { iCardIndex: 1 }), h.rpc('DiscardFromDeploy', { iCardIndex: 0 })]);
      const t = h.miroir().players[1].zones.trash.length;
      const liste = [transfert({ iOwner: 0, iLocation: 0, iCard: t - 1, iStackIdx: 1 }), transfert({ iOwner: 0, iLocation: 0, iCard: t - 2, iStackIdx: 1 }),
        ...(avecHote ? [transfert({ iOwner: 1, iLocation: 1, iCard: 0, iStackIdx: 1 })] : [])];
      h.emettre([h.rpc('SwitchTurns'), h.rpc('TriggerOpponentMultiActions', { aTransfer: liste, bDontStartAny: false })]);
      h.etat.pending = true;
      h.etat.etat = 'OpponentResolving';
      h.attendre(id, avecHote ? { libere: () => h.repriseHote() || (h.etat.action === 0 && h.actionsRendues() >= 1) } : {});
    },
  };
}

/** Les 7 anciennes RPC d'actions (R7, cartes sans action V3) que le jeu envoie, avec leur préambule. */
export const ANCIENNES = ['TriggerOpponentActionFromDeploy', 'TriggerOpponentActionFromDeployWithTarget', 'TriggerOpponentActionFromLeader',
  'TriggerOpponentActionFromLeaderWithSaveTarget', 'TriggerOpponentActionFromTrash', 'ForceOpponentActionFromDeploy',
  'ForceOpponentActionFromOppositeDeploy', 'ForceOpponentActionFromTrash'] as const;
export const ANCIENNES_ENVOYEES = ANCIENNES; // BeginOpponentActionFromTrash n'est jamais envoyée par le jeu (code mort)

/**
 * Ancienne action (R7) : TriggerOpponentActionFrom… précédée de SwitchTurns, bOpponentResolving (BeginOpponentAction,
 * GLS:10597-10726) ; ForceOpponentActionFrom… sans SwitchTurns, bForcingOpponentAction (ForceOpponentFinishedAction,
 * GLS:10730-10783), ici sans autre action en attente (bMorePending faux). Dans les deux cas iPlayerAction = 1.
 */
export function ancienneAction(nom: (typeof ANCIENNES)[number], id = `R7 ${nom}`): Injection {
  return {
    id, quand: 'tourHote',
    si: (h) => !/Deploy|Opposite/.test(nom) || h.miroir().players[1].zones.deploy.length >= 1,
    jouer: (h) => {
      const v: Record<string, unknown> = { iCardIdx: 0, iActionIdx: 0 };
      if (nom.endsWith('WithTarget')) v.iOppIdx = 0;
      if (nom.endsWith('WithSaveTarget')) v.iSaveIdx = 0;
      if (nom.startsWith('Force')) { v.bMorePending = false; if (!nom.endsWith('Trash')) v.bFinished = true; }
      if (nom.startsWith('Trigger')) {
        h.emettre([h.rpc('SwitchTurns'), h.rpc(nom, v)]);
        h.etat.resolving = true;
      } else {
        h.emettre([h.rpc(nom, v)]);
        h.etat.forcing = true;
      }
      h.etat.action = 1;
      h.etat.etat = 'OpponentResolving';
      h.attendre(id);
    },
  };
}

/** Demande d'annulation de la partie (T6, F10) : la fenêtre de l'hôte attend AcceptCancelMatch ; acceptée, fin sans perdant. */
export function annulation(id = 'T6'): Injection {
  return {
    id, quand: 'tourHote', si: (h) => h.toursHote() >= 2,
    jouer: (h) => {
      const k = h.nbRecues();
      h.emettre([h.rpc('RequestCancelMatch')]);
      h.attendre(id, {
        libere: () => h.recuesDepuis(k).some((r) => r.name === 'AcceptCancelMatchServerRpc'),
        suite: () => h.finir('partie annulée d’un commun accord'),
      });
    },
  };
}

/** Demande de rembobinage du tour (T5) : l'hôte n'attend pas la réponse pour continuer ; joy-boy ne doit jamais l'accepter. */
export function rembobinage(id = 'T5'): Injection {
  return { id, quand: 'tourHote', si: (h) => h.toursHote() >= 2, jouer: (h) => { h.emettre([h.rpc('RequestRestartTurn')]); } };
}

/** Hôte muet (inactivité, décision 11) : à son tour, il ne fait plus rien (il n'attend pas joy-boy). */
export function hoteMuet(id = 'muet'): Injection {
  return { id, quand: 'tourHote', si: (h) => h.toursHote() >= 2, jouer: (h) => { h.etat.etat = 'Muet'; h.attendre(id, { libere: () => false, surJoyboy: false }); } };
}

/** Attaque sur une cible que le moteur ne connaît pas (CD2, « attaquant ou cible inconnus », combat.ts:362) : l'hôte attend son bloqueur. */
export function attaqueIgnoree(id = 'CD2'): Injection {
  return {
    id, quand: 'tourHote', si: (h) => h.toursHote() >= 2 && !h.miroir().players[0].leader.rested && h.miroir().players[1].zones.deploy.length < 5,
    jouer: (h) => {
      h.emettre([h.rpc('TapCard', { iCardIndex: -1 }),
        h.rpc('SetupAttack', { iAttackerIdx: -1, iDefenderIdx: 4, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1 }),
        h.rpc('SelectBlocker', { bDontQueue: false })]);
      h.attendre(id);
    },
  };
}

/**
 * Vraie attaque retenue (CD2, tâche O5.5) : l'hôte attaque pendant une question d'effet de joy-boy. Deux injections :
 * `${id} pose` (au tour `tour - 1` au plus tôt) pose un Personnage de l'hôte, coût payé ; `${id}` (au tour `tour`) attaque
 * le Leader de joy-boy avec le Leader de l'hôte ; dès que joy-boy a perdu sa Vie (il est en phase de déclenchement, sa
 * question du [Déclenchement] ouverte : joueur avec `pauseDeclenchement`), l'hôte, qui n'attend pas la fin de cette
 * phase, attaque avec son Personnage (TapCard, SetupAttack, SelectBlocker). joy-boy doit retenir l'attaque, finir la
 * question, puis jouer le combat (NoBlocker, ResolveAttack) et rendre la main, sans filet (combat.ts, étape `deferred`
 * et `queued`, O5.3). Joy-boy : un deck dont les Vies ont un [Déclenchement] (DECLENCHEURS).
 */
export function attaqueRetenue(id = 'CD2', { tour = 3 } = {}): Injection[] {
  const perso = (h: HoteApi) => h.miroir().players[0].zones.deploy.findIndex((c) => !c.rested && cardData()[c.code]?.category === 'CHARACTER');
  const pose: Injection = {
    id: `${id} pose`, quand: 'tourHote', si: (h) => h.toursHote() >= tour - 1 && h.miroir().players[0].zones.deploy.length < 5,
    jouer: (h) => {
      const z = h.miroir().players[0].zones;
      const actives = z.donCost.filter((d) => !d.rested).length;
      const i = z.hand.findIndex((c) => cardData()[c.code]?.category === 'CHARACTER' && (cardData()[c.code]?.cost ?? 99) <= actives);
      if (i < 0) return;
      const cout = cardData()[z.hand[i].code]?.cost ?? 0;
      h.emettre([...(cout ? [h.rpc('TapDon', { iCount: cout })] : []), h.rpc('MoveHandCardToDeploy', { iIdx: i, bRested: false })]);
    },
  };
  const attaque: Injection = {
    id, quand: 'tourHote',
    si: (h) => h.toursHote() >= tour && !h.miroir().players[0].leader.rested && perso(h) >= 0 && h.miroir().players[1].zones.life.length >= 2,
    jouer: (h) => {
      const p = perso(h);
      h.emettre([h.rpc('TapCard', { iCardIndex: -1 }),
        h.rpc('SetupAttack', { iAttackerIdx: -1, iDefenderIdx: -1, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1 }),
        h.rpc('SelectBlocker', { bDontQueue: false })]);
      h.attendre(`${id} (première attaque)`, {
        libere: () => h.etat.etat === 'Life_ActivateTrigger',
        suite: () => {
          // l'hôte se croit de nouveau maître du jeu et attaque pendant la question de joy-boy
          h.etat.action = 0;
          h.emettre([h.rpc('TapCard', { iCardIndex: p }),
            h.rpc('SetupAttack', { iAttackerIdx: p, iDefenderIdx: -1, iBlockerMustBeSmaller: -1, iBlockerMustBeLarger: -1, iBlockerMustCostMore: -1 }),
            h.rpc('SelectBlocker', { bDontQueue: false })]);
          h.attendre(id);
        },
      });
    },
  };
  return [pose, attaque];
}

/**
 * Effet de l'hôte pendant la fin du tour de joy-boy (T3, GLS:14579-14596) : AttemptingToEndTurn met l'hôte en
 * EndingTurn ; il prend la main (AllOnKOResolved, SwitchTurns), résout, la rend (AllOnKOResolved, SwitchTurns), et
 * joy-boy finit alors son tour (EndTurn). Un EndTurn envoyé avec AttemptingToEndTurn coupe l'effet (désaccord).
 */
export function effetFinTour(id = 'T3'): Injection {
  return {
    id, quand: 'finTourJoyboy',
    jouer: (h) => {
      h.effetFinTour(true);
      h.emettre([h.rpc('AllOnKOResolved'), h.rpc('SwitchTurns')]);
      setTimeout(() => {
        h.emettre([h.rpc('AllOnKOResolved'), h.rpc('SwitchTurns')]);
        h.effetFinTour(false);
      }, 10);
    },
  };
}

/**
 * Files « joueur courant » hors combat (R9, tâche O5.6) : pendant le tour de joy-boy (le suivi d'iPlayerAction le
 * désigne), un effet de l'hôte met en file un Personnage de joy-boy (QueueCurrentPlayerKOQueue, relative à
 * iPlayerAction : TransferKOAndSaveQueues) puis lui transmet la réaction (ProcOpponentV3Action, retrait d'allié 8 =
 * AllyKO, sans SwitchTurns : c'est déjà à joy-boy). joy-boy doit traiter la file comme R1 (Personnage retiré des deux
 * côtés, remplacement proposé s'il en a un), puis rendre la main (AllOnKOResolved seul, son tour continue).
 */
export function fileJoueurCourant(id = 'R9'): Injection {
  return {
    id, quand: 'poseJoyboy', si: (h) => h.miroir().players[1].zones.deploy.length >= 1 && h.miroir().actingPlayer === 1,
    jouer: (h) => {
      const i = h.miroir().players[1].zones.deploy.length - 1;
      h.emettre([h.rpc('QueueCurrentPlayerKOQueue', { iDeployIdx: i })]);
      procV3(h, { iActor: ACTEUR, eRemoval: 8, iRemovalPlayer: 1 });
      h.attendre(id);
    },
  };
}

/**
 * Remplacement de la carte elle-même (R2, eRemoval 1–7) : « si ce Personnage devait être mis KO… à la place » ; aucune
 * file, la victime est iActor (le Personnage de joy-boy, ici le premier). Joy-boy doit appliquer le retrait demandé
 * (EndActionEarlyV3, GLS:24666-24830) puis rendre la main.
 */
export function remplacementSoi(id = 'R2'): Injection {
  return {
    id, quand: 'tourHote', si: (h) => h.miroir().players[1].zones.deploy.length >= 1,
    jouer: (h) => { procV3(h, { iActor: 20, eRemoval: 1, iRemovalPlayer: 0 }); h.attendre(id); },
  };
}

// ---------------------------------------------------------------------------------------------------- joueur joy-boy

export interface Preferences {
  /** Pose un Personnage par tour (le premier jouable). */
  poser?: boolean;
  /** Attaque le Leader adverse avec tout ce qui peut attaquer. */
  attaquer?: boolean;
  bloquer?: boolean;
  /** Un contre par attaque (le premier proposé). */
  contrer?: boolean;
  declencher?: boolean;
  /** Attente (ms) avant de finir son tour (laisse l'hôte agir pendant le tour de joy-boy). */
  pauseFin?: number;
  /** Attente (ms) avant de répondre au [Déclenchement] (laisse l'hôte attaquer pendant la question : CD2). */
  pauseDeclenchement?: number;
}

export interface Vu { decisions: Record<string, number>; montree: boolean }

/** Joueur joy-boy automatique : répond tout de suite à chaque décision montrée, selon ses préférences. */
export function joueur(s: CrossplaySession, p: Preferences = {}): Vu {
  const { poser = true, attaquer = false, bloquer = false, contrer = false, declencher = false, pauseFin = 0, pauseDeclenchement = 0 } = p;
  const vu: Vu = { decisions: {}, montree: false };
  const poses = new Set<number>();
  let contre = false, attente: ReturnType<typeof setTimeout> | null = null;
  const jouer = () => {
    try {
      const v = s.snapshot(), d = v.state?.decision;
      vu.montree = Boolean(d && d.player === 1 && !v.end);
      if (!d || d.player !== 1 || v.end || attente) return;
      const cle = d.tag ?? d.kind;
      vu.decisions[cle] = (vu.decisions[cle] ?? 0) + 1;
      if (d.kind !== 'counter') contre = false;
      let choix = (d.options.find((o) => o.id !== 'none') ?? d.options[0]).id;
      if (d.kind === 'mulligan') choix = 'keep';
      else if (d.tag === 'replace') choix = d.options.some((o) => o.id === 'none') ? 'none' : choix;
      else if (d.tag === 'trigger') {
        choix = declencher ? 'trigger' : 'hand';
        if (pauseDeclenchement) {
          const seq = v.seq;
          attente = setTimeout(() => {
            attente = null;
            try { if (s.snapshot().seq === seq) s.answer(seq, choix); } catch { /* périmé */ }
            jouer();
          }, pauseDeclenchement);
          return;
        }
      }
      else if (d.kind === 'blocker') choix = bloquer ? (d.options.find((o) => o.id.startsWith('block:')) ?? { id: 'noblock' }).id : 'noblock';
      else if (d.kind === 'counter') {
        const c = d.options.find((o) => o.id.startsWith('counter:'));
        choix = contrer && !contre && c ? c.id : 'pass';
        if (choix !== 'pass') contre = true;
      } else if (d.kind === 'main') {
        const etat = v.state!;
        const pose = d.options.find((o) => o.id.startsWith('play:') && etat.players[1].hand.some((c) => `play:${c.uid}` === o.id && cardData()[c.num]?.category !== 'EVENT'))
          ?? d.options.find((o) => o.id.startsWith('play:'));
        const attaque = attaquer ? d.options.find((o) => o.id.startsWith('attack:') && o.target === etat.players[0].leader.uid) : undefined;
        if (poser && pose && !poses.has(etat.turn)) { poses.add(etat.turn); choix = pose.id; }
        else if (attaque) choix = attaque.id;
        else if (pauseFin) {
          attente = setTimeout(() => {
            attente = null;
            try { const w = s.snapshot(); if (w.state?.decision?.kind === 'main' && w.state.decision.player === 1) s.answer(w.seq, 'end'); } catch { /* périmé */ }
            jouer();
          }, pauseFin);
          return;
        } else choix = 'end';
      }
      s.answer(v.seq, choix);
    } catch (e) { if (!(e as { code?: string }).code) throw e; }
  };
  s.onChange(jouer);
  return vu;
}

// ---------------------------------------------------------------------------------------------------- une partie

export interface Partie {
  fin: SessionEnd;
  hote: FauxHote;
  s: CrossplaySession;
  texte: string;
  vu: Vu;
  /** La garde du test a dû arrêter la partie (ni fin, ni impasse relevée). */
  garde: boolean;
  /** ServerRpc reçues par l'hôte (noms, sans le journal). */
  noms: string[];
}

/**
 * Une partie complète : faux hôte fidèle (pendule simulée, détecteur d'impasse), session joy-boy, joueur automatique.
 * `garde` (ms réelles) : au-delà, la partie est fermée par le test.
 */
export async function partie(o: {
  hote?: { leader: string; cards: string[] }; joyboy?: { leader: string; cards: string[] }; options?: OptionsHote; injections?: Injection[];
  prefs?: Preferences; session?: Partial<SessionOptions>; garde?: number;
} = {}): Promise<Partie> {
  let vu: Vu = { decisions: {}, montree: false };
  const hote = fauxHote(o.hote ?? ST01(), { tours: 4, pendule: true, decisionMontree: () => vu.montree, injections: o.injections ?? [], ...o.options });
  const lignes: string[] = [];
  // fin de tour en deux temps (T3, O5.6) : l'attente d'EndTurn se compte en temps de la partie (la pendule simulée en
  // salle à minuteur : 3 s simulées ; sans pendule, l'horloge murale : quelques ms), assez pour que le faux hôte prenne
  // la main s'il a un effet en fin de tour
  const simulee = (o.options?.pendule ?? true) && o.options?.minuteur !== false;
  const endTurnMs = simulee ? 3000 : Math.max(15, 4 * (o.options?.msParSeconde ?? 3));
  const s = startSession({
    code: 'W1A2B3C', deck: o.joyboy ?? ST01(), name: 'JoyBoy', connect: async () => hote.transport, closeDelayMs: 0, randomInt: tirage(7),
    log: (l) => lignes.push(l), endTurnMs, ...o.session,
  });
  vu = joueur(s, o.prefs);
  let garde = false;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  const fin = await Promise.race([s.done, new Promise<SessionEnd>((r) => {
    minuterie = setTimeout(() => { garde = true; hote.fermer('garde du test'); s.close(); void s.done.then(r); }, o.garde ?? 15_000);
  })]);
  if (minuterie) clearTimeout(minuterie);
  hote.fermer();
  return { fin, hote, s, texte: lignes.join('\n'), vu, garde, noms: hote.recues().map((r) => r.name).filter((n) => !n.startsWith('AddLogLine')) };
}

/** Ce qui ne va pas (vide : la partie s'est déroulée sans impasse ni désaccord, la pendule de joy-boy jamais figée > 15 s). */
export function problemes(p: Partie, { silence = 15 } = {}): string[] {
  const out: string[] = [];
  for (const i of p.hote.impasses()) out.push(`impasse au tour ${i.tour} (${i.attente}), ${i.silence} s de silence`);
  for (const d of p.hote.listeDesaccords()) out.push(`désaccord : ${d}`);
  if (p.hote.silenceMax() > silence) out.push(`pendule de joy-boy figée ${p.hote.silenceMax()} s sans décision montrée`);
  if (p.garde) out.push('partie arrêtée par la garde du test');
  return out;
}
