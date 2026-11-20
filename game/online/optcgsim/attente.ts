// Filet anti-impasse des parties croisées (tâche O5.1, audit O5.0 § 4, décisions 9 et 11 de l'étape O).
//
// Le principe : joy-boy ne reste jamais sans rien faire quand OPTCGSim l'attend. OPTCGSim n'a aucun délai pour une
// réponse qui ne vient pas ; sa seule issue est la pendule des salles à minuteur, qui dit chaque seconde qui l'hôte
// attend (SetTimerClientRpc : `fClientTime` en baisse = l'hôte attend joy-boy, `fServerTime` en baisse = l'hôte croit
// agir). Ce module, pur (aucun minuteur, aucun envoi), observe la situation que lui décrit la session et lui rend les
// actions à faire :
//
// - **Cas J** (OPTCGSim attend joy-boy, joy-boy n'a aucune décision à montrer à son joueur) : après 8 s (de pendule),
//   une échelle d'échelons de plus en plus forts, chacun suivi de 4 s d'attente ; succès dès que la pendule passe à
//   l'hôte, qu'une décision est montrée ou que l'hôte rejoue. Échelons (exécutés par la session, toujours par un choix
//   valide, jamais un refus muet) : 1. finir ce qui est en cours chez nous (action imposée, réaction, question d'effet,
//   mutations en attente, main à rendre) ; 2. répondre à l'étape de combat (pas de bloqueur, pas de contre, pas de
//   [Déclenchement]) ; 3. rendre les actions de l'hôte reçues dans une liste ; 4. rendre la main (`SwitchTurns`
//   seulement au tour de l'hôte) ; 5. au tour de joy-boy, finir le tour.
// - **Cas H pendant le tour de joy-boy** (la pendule de l'hôte tourne alors que joy-boy n'attend rien de lui : un
//   `SwitchTurns` de trop, CA4) : après 8 s sans RPC utile de l'hôte, **un** `SwitchTurns` correctif.
// - **Sans pendule** (salle sans minuteur, pendule arrêtée) : qui attend qui vient du suivi d'`iPlayerAction` (le miroir
//   tel que l'hôte le voit) et le cas J demande 20 s de silence utile dans les deux sens. Hôte qui doit agir et ne joue
//   plus depuis 5 min : victoire de joy-boy (décision 11, comme un départ), **seulement avec une preuve** que la main est
//   à lui (intégration O5-2) : il a joué après le dernier envoi de joy-boy (remise de main confirmée), le suivi
//   d'`iPlayerAction` (ou l'attaque de joy-boy) le désigne, et joy-boy n'a rien en suspens. Sinon (doute) : une échelle
//   côté joy-boy, sans `SwitchTurns` ni fin de tour, puis l'arrêt sans perdant ; jamais une victoire.
// - **Conclusion** : rien d'utile depuis 2 min après au moins une échelle complète, ou plus de 5 déblocages dans la
//   partie : arrêt sans perdant (comme au-delà de 25 écarts, décision 7).
//
// Le temps (`now`, ms) est celui de la partie : en salle à minuteur, la session l'avance avec la pendule (une seconde
// perdue par l'un ou l'autre joueur = une seconde) ; sans pendule, avec l'horloge murale. Les seuils sont ceux de la
// décision 11 (8 s / 2 min / 5 déblocages).
import type { Seat } from './types.ts';

// ---------------------------------------------------------------------------------------------------- seuils

export interface AttenteOptions {
  /** Cas J (pendule) : temps sans décision montrable avant le premier échelon (8 s). */
  stuckMs: number;
  /** Attente après chaque échelon avant le suivant (4 s). */
  settleMs: number;
  /** Sans pendule : silence utile (dans les deux sens) avant le premier échelon (20 s). */
  silenceMs: number;
  /** Rien d'utile depuis ce temps, après au moins une échelle complète : conclusion sans perdant (2 min). */
  concludeMs: number;
  /** Déblocages (échelles commencées et `SwitchTurns` correctifs) au-delà desquels la partie est conclue (5). */
  maxUnstuck: number;
  /** Sans pendule : l'hôte doit agir et n'envoie rien d'utile depuis ce temps : victoire de joy-boy (5 min). */
  hostIdleMs: number;
}

export const SEUILS: Readonly<AttenteOptions> = Object.freeze({
  stuckMs: 8_000, settleMs: 4_000, silenceMs: 20_000, concludeMs: 120_000, maxUnstuck: 5, hostIdleMs: 300_000,
});

// ---------------------------------------------------------------------------------------------------- situation

/** Ce que la session sait à un instant donné. */
export interface Situation {
  /** Temps de la partie (ms), croissant. */
  now: number;
  /** Pendule : celui dont le temps baisse (0 l'hôte, 1 joy-boy) ; null : pas de pendule fiable (sans minuteur, arrêtée). */
  clock: Seat | null;
  /** Suivi d'`iPlayerAction` de l'hôte (miroir tel qu'OPTCGSim le voit, `actingPlayer`). */
  acting: Seat;
  /** Tour de l'hôte (0) ou de joy-boy (1). */
  turnPlayer: Seat;
  /** Le joueur joy-boy a une décision montrée. */
  actionable: boolean;
  /** joy-boy attend l'hôte (son attaque, une réaction transmise) : c'est à l'hôte de jouer, selon joy-boy. */
  waitingHost: boolean;
  /**
   * joy-boy a quelque chose en suspens (action imposée, réaction, main à rendre, mutations en attente, combat où il
   * défend, question d'effet ouverte…) : l'inactivité de l'hôte n'est alors pas prouvée (intégration O5-2).
   */
  ownPending?: boolean;
}

/** Qui OPTCGSim attend : 'J' joy-boy, 'H' l'hôte lui-même (pendule, sinon suivi d'`iPlayerAction`). */
export function whoWaits(s: Pick<Situation, 'clock' | 'acting'>): 'J' | 'H' {
  const seat = s.clock ?? s.acting;
  return seat === 1 ? 'J' : 'H';
}

export type Rung = 1 | 2 | 3 | 4 | 5;

/** Ce que la session doit faire. */
export type Demande =
  /** Échelon de l'échelle n° `ladder` ; `switchTurns` : l'échelon 4 rend la main par `SwitchTurns` (tour de l'hôte). */
  | { kind: 'rung'; rung: Rung; ladder: number; switchTurns: boolean }
  /** Échelle finie sans succès (journal). */
  | { kind: 'failed'; ladder: number }
  /** L'impasse est levée (journal) : `rung` = dernier échelon joué. */
  | { kind: 'success'; rung: Rung | 0; ladder: number }
  /** Cas H pendant le tour de joy-boy : renvoyer un `SwitchTurns` correctif. */
  | { kind: 'switchFix'; count: number }
  /** Arrêt sans perdant : rien d'utile depuis 2 min après une échelle complète, ou trop de déblocages. */
  | { kind: 'conclude'; why: 'impasse' | 'plafond' }
  /** Sans pendule : l'hôte ne joue plus alors qu'il doit agir, preuve à l'appui (décision 11 : victoire de joy-boy). */
  | { kind: 'hostIdle' }
  /** Sans pendule : l'hôte se tait, mais rien ne prouve que la main est à lui : échelle côté joy-boy, puis arrêt sans perdant. */
  | { kind: 'hostIdleDoubt' };

export interface Attente {
  readonly o: AttenteOptions;
  /** Dernière RPC utile reçue de l'hôte ou envoyée par joy-boy (hors échelons), et dernière de l'hôte. */
  lastUseful: number;
  lastHost: number;
  /** Qui a envoyé la dernière RPC utile : l'hôte a-t-il joué depuis le dernier envoi de joy-boy (remise confirmée) ? */
  lastSpeaker: 'host' | 'joyboy' | null;
  /** Hôte silencieux sans preuve qu'il a la main : l'échelle tourne côté joy-boy (sans SwitchTurns ni fin de tour). */
  doubt: boolean;
  /** Cas J : début de l'épisode en cours (null : pas d'impasse). */
  stuckSince: number | null;
  /** Échelon en cours (0 : aucune échelle en cours), quand il a été joué, fin de la dernière échelle ratée. */
  rung: Rung | 0;
  rungAt: number;
  failedAt: number | null;
  /** Échelles complètes ratées dans la partie. */
  failed: number;
  /** Déblocages dans la partie (échelles commencées et `SwitchTurns` correctifs). */
  unstuck: number;
  /** Cas H : début, et correctif déjà envoyé pour cette remise de main. */
  hSince: number | null;
  fixed: boolean;
  /** Conclusion déjà demandée. */
  over: boolean;
}

export function createAttente(o: Partial<AttenteOptions> = {}, now = 0): Attente {
  return {
    o: { ...SEUILS, ...o }, lastUseful: now, lastHost: now, lastSpeaker: null, doubt: false, stuckSince: null, rung: 0, rungAt: now, failedAt: null,
    failed: 0, unstuck: 0, hSince: null, fixed: false, over: false,
  };
}

/** Une RPC utile (pas le chrono, le journal ni le chat) : reçue de l'hôte (`host`) ou envoyée par joy-boy. */
export function useful(a: Attente, from: 'host' | 'joyboy', now: number): void {
  a.lastUseful = Math.max(a.lastUseful, now);
  if (from === 'host') a.lastHost = Math.max(a.lastHost, now);
  a.lastSpeaker = from;
  if (from === 'host') a.doubt = false; // l'hôte rejoue : le doute est levé
}

/** L'échelon demandé n'a rien trouvé à faire : le suivant est demandé au prochain `tick` (la session l'appelle aussitôt). */
export function skip(a: Attente): void {
  a.rungAt = Number.NEGATIVE_INFINITY;
}

/** RPC qui ne disent rien de l'avancement de la partie (pendule, journal, chat). */
export const NOT_USEFUL: ReadonlySet<string> = new Set([
  'SetTimer', 'AddLogLine', 'TranslateLogLine', 'AddLogLineOpponent', 'AddChatLine',
]);

/** Échelon suivant (le 5, finir le tour, n'existe qu'au tour de joy-boy, et jamais dans le doute) ; null : échelle finie. */
function nextRung(r: Rung | 0, turnPlayer: Seat, doubt = false): Rung | null {
  const n = r + 1;
  if (n === 5 && (turnPlayer !== 1 || doubt)) return null;
  return n > 5 ? null : (n as Rung);
}

/**
 * Un pas d'observation : rend ce que la session doit faire maintenant. À appeler à chaque chrono reçu, après chaque
 * RPC utile et périodiquement (salles sans minuteur).
 */
export function tick(a: Attente, s: Situation): Demande[] {
  if (a.over) return [];
  const out: Demande[] = [];
  const o = a.o;
  const silent = s.clock === null;
  const who = whoWaits(s);

  // ---------- cas J : OPTCGSim attend joy-boy, qui n'a rien à montrer
  // dans le doute (hôte silencieux sans preuve qu'il a la main), joy-boy débloque d'abord de son côté
  const jStuck = (who === 'J' || a.doubt) && !s.actionable;
  const switchTurns = s.turnPlayer === 0 && !a.doubt;
  // l'hôte a rejoué depuis l'échelon : l'impasse est levée (s'il le faut, un nouvel épisode commencera)
  const hostMoved = a.rung !== 0 && a.lastHost > a.rungAt && Number.isFinite(a.rungAt);
  if (!jStuck || hostMoved) {
    if (a.rung !== 0 || a.failedAt !== null) out.push({ kind: 'success', rung: a.rung, ladder: a.unstuck });
    a.rung = 0; a.failedAt = null;
    a.stuckSince = jStuck ? s.now : null;
  } else {
    a.stuckSince ??= s.now;
    if (a.rung === 0) {
      const since = Math.max(a.stuckSince, a.lastUseful, a.failedAt ?? Number.NEGATIVE_INFINITY);
      if (s.now - since >= (silent ? o.silenceMs : o.stuckMs)) {
        if (a.unstuck >= o.maxUnstuck) return conclude(a, out, 'plafond');
        a.unstuck++;
        a.rung = 1; a.rungAt = s.now;
        out.push({ kind: 'rung', rung: 1, ladder: a.unstuck, switchTurns });
      }
    } else if (s.now - a.rungAt >= o.settleMs) {
      const n = nextRung(a.rung, s.turnPlayer, a.doubt);
      if (n === null) {
        a.failed++;
        out.push({ kind: 'failed', ladder: a.unstuck });
        a.rung = 0; a.failedAt = s.now;
      } else {
        a.rung = n; a.rungAt = s.now;
        out.push({ kind: 'rung', rung: n, ladder: a.unstuck, switchTurns });
      }
    }
    if (a.failed > 0 && s.now - a.lastUseful >= o.concludeMs) return conclude(a, out, 'impasse');
  }

  // ---------- cas H pendant le tour de joy-boy : l'hôte croit agir à tort (SwitchTurns de trop)
  if (s.clock === 1) a.fixed = false; // la main est revenue à joy-boy : un nouveau correctif sera possible
  const hWrong = !silent && s.clock === 0 && s.turnPlayer === 1 && !s.waitingHost;
  if (!hWrong) a.hSince = null;
  else {
    a.hSince ??= s.now;
    if (!a.fixed && s.now - Math.max(a.hSince, a.lastHost) >= o.stuckMs) {
      if (a.unstuck >= o.maxUnstuck) return conclude(a, out, 'plafond');
      a.unstuck++;
      a.fixed = true;
      out.push({ kind: 'switchFix', count: a.unstuck });
    }
  }

  // ---------- sans pendule : l'hôte doit agir et ne joue plus (décision 11 : victoire de joy-boy)
  // La victoire exige une preuve que la main est à lui (intégration O5-2) : il a joué après le dernier envoi de joy-boy
  // (sa dernière remise de main est confirmée), le suivi d'iPlayerAction ou l'attaque de joy-boy le désigne, et joy-boy
  // n'a rien en suspens. Sinon, doute : échelle côté joy-boy (sans SwitchTurns ni fin de tour) ; si l'hôte ne rejoue
  // pas, la conclusion ci-dessus arrête la partie sans perdant. Jamais de victoire dans le doute.
  if (silent && !a.doubt && (who === 'H' || s.waitingHost) && !s.actionable && s.now - a.lastHost >= o.hostIdleMs) {
    if (a.lastSpeaker === 'host' && !s.ownPending) {
      a.over = true;
      out.push({ kind: 'hostIdle' });
    } else {
      a.doubt = true;
      out.push({ kind: 'hostIdleDoubt' });
      if (a.unstuck >= o.maxUnstuck) return conclude(a, out, 'plafond');
      a.unstuck++;
      a.rung = 1; a.rungAt = s.now; a.stuckSince = s.now; a.failedAt = null;
      out.push({ kind: 'rung', rung: 1, ladder: a.unstuck, switchTurns: false });
    }
  }
  return out;
}

function conclude(a: Attente, out: Demande[], why: 'impasse' | 'plafond'): Demande[] {
  a.over = true;
  out.push({ kind: 'conclude', why });
  return out;
}

// ---------------------------------------------------------------------------------------------------- table des attentes

/**
 * Règle de code n° 1 de l'audit (§ 4.5) : toute RPC de l'hôte qui passe la main à joy-boy (ou attend sa réponse) a un
 * traitement nommé. `filet` : pas encore de traitement propre, l'échelle de ce module débloque (tâche qui le fera).
 */
export const HAND_TO_JOYBOY: Readonly<Record<string, { treatment: string; filet?: string }>> = Object.freeze({
  SwitchTurns: { treatment: 'mirror.ts (actingPlayer) ; combat.ts ; sinon échelle' },
  SetupAttack: { treatment: 'combat.ts : défense ouverte (CD1)', filet: 'CD2, combat ignoré par le moteur : échelon 2 (O5.3)' },
  SelectBlocker: { treatment: 'combat.ts : décision « bloqueur » (CD1)' },
  SelectBlockerNoProcs: { treatment: 'combat.ts : décision « bloqueur » (CD1)' },
  EnterTriggerPhase: { treatment: 'combat.ts : [Déclenchement] (CD5)' },
  MoveToSecondLifeTrigger: { treatment: 'combat.ts : seconde vie (CD6)' },
  CheckForKOdCharacterEffects: { treatment: 'combat.ts : KO en combat (CD7)', filet: 'échelon 4' },
  ProcOpponentV3Action: { treatment: 'session.ts : startForced (R4, genres de reaction.ts), startReaction (R1–R3, remplacement de soi R2), refuseForced (R5)' },
  TriggerOpponentMultiActions: { treatment: 'session.ts : actions de l’hôte gardées (hostActions) ; liste seule (R6) : startList, nos éléments joués, celles de l’hôte renvoyées' },
  QueueOpponentPlayerKOQueue: { treatment: 'session.ts : file des Personnages (queued)' },
  QueueOpponentPlayerSaveQueue: { treatment: 'session.ts : file des Personnages (queued)' },
  TriggerOpponentActionFromDeploy: { treatment: 'session.ts : startOld (R7), action d’une carte de joy-boy jouée par le moteur, main rendue' },
  TriggerOpponentActionFromDeployWithTarget: { treatment: 'session.ts : startOld (R7), action d’une carte de joy-boy jouée par le moteur, main rendue' },
  TriggerOpponentActionFromLeader: { treatment: 'session.ts : startOld (R7), action d’une carte de joy-boy jouée par le moteur, main rendue' },
  TriggerOpponentActionFromLeaderWithSaveTarget: { treatment: 'session.ts : startOld (R7), action d’une carte de joy-boy jouée par le moteur, main rendue' },
  TriggerOpponentActionFromTrash: { treatment: 'session.ts : startOld (R7), action d’une carte de joy-boy jouée par le moteur, main rendue' },
  ForceOpponentActionFromDeploy: { treatment: 'session.ts : startOld (R7), action imposée comme R4 (genre lu dans le texte), fin selon bMorePending' },
  ForceOpponentActionFromOppositeDeploy: { treatment: 'session.ts : startOld (R7), action imposée comme R4 (genre lu dans le texte), fin selon bMorePending' },
  ForceOpponentActionFromTrash: { treatment: 'session.ts : startOld (R7), action imposée comme R4 (genre lu dans le texte), fin selon bMorePending' },
  EndTurn: { treatment: 'moteur : début du tour de joy-boy (T1, T2)', filet: 'échelon 5' },
  AnotherTurn: { treatment: 'moteur : tour en plus de l’hôte (T4)' },
  ResetActionPhase: { treatment: 'session.ts : fin d’une réaction transmise ; combat.ts : main rendue (CA3)' },
  NoMorePendingActions: { treatment: 'session.ts : finishOutgoing (Q3)' },
  RequestCancelMatch: { treatment: 'session.ts : annulation acceptée, sans perdant (décision 11)' },
  RequestRestartTurn: { treatment: 'aucun : jamais accepté, l’hôte peut continuer (T5)', filet: 'O5.6' },
  ChooseTurnOrder: { treatment: 'session.ts : ouverture (openGame)', filet: 'tirage nul (M2) : O5.6' },
});
