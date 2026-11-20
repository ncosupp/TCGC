// Réactions demandées par OPTCGSim (tâche O3.2, écart n° 2 : Loki OP17-119 contre Zoro OP17-095).
//
// Quand un effet du joueur OPTCGSim veut retirer des Personnages de joy-boy et que l'un d'eux pourrait l'empêcher (effet
// « à la place », comme Zoro OP17-095), le jeu ne retire rien lui-même : il met les Personnages visés en file
// (QueueOpponentPlayerSaveQueue ou …KOQueue, indice dans NOTRE zone de Personnages), nous passe la main (SwitchTurns),
// nous transmet la réaction (ProcOpponentV3Action, puis TriggerOpponentMultiActions) et attend. C'est notre client qui
// résout la réaction, retire les Personnages restés en file (GameplayLogicScript.ResolvePendingKOs : DiscardFromSelfDeploy,
// effets [En cas de KO]) puis rend la main (ReturnToOpponentActionPhase : AllOnKOResolved, SwitchTurns, ResetActionPhase,
// NoMorePendingActions). Sans réponse, les deux jeux s'attendent : c'est le blocage de la partie du 18 nov., 16 h 30.
//
// Le joueur joy-boy choisit (interprétation 4500) : pour chaque Personnage en file, dans l'ordre du jeu, les effets de
// remplacement que le moteur connaît (CardBehavior.replaceRemoval, comme removeByEffect de rules.ts) lui sont proposés ;
// sans remplacement choisi, le Personnage est retiré comme le veut l'effet adverse. Les questions de l'effet de
// remplacement (Zoro : 3 cartes de la Défausse) sont rejouées depuis l'état de départ à chaque réponse (runReplacement),
// comme le moteur rejoue ses effets. Le reste (RPC, rendre la main) est fait par la session.
import { heuristicChooser } from '../../ai/heuristic.ts';
import { def, fieldCards, findField, isNegated } from '../../engine/rules.ts';
import { answerExternal, applyExternal, externalIndexOf } from './external.ts';
import { baseName, type Mirror } from './mirror.ts';
import type { EffectCtx, GameState, Option, PendingEffect, PlayerId } from '../../engine/types.ts';
import type { Rpc } from './types.ts';

/** RemovalEffect d'OPTCGSim (RemovalEffect.cs) → zone d'arrivée et KO (effets [En cas de KO]) pour le moteur. */
export const REMOVAL: Record<number, { to: 'trash' | 'hand' | 'deck'; ko?: boolean }> = {
  1: { to: 'trash', ko: true }, 8: { to: 'trash', ko: true }, 5: { to: 'trash' }, 12: { to: 'trash' },
  6: { to: 'hand' }, 9: { to: 'hand' }, 7: { to: 'deck' }, 13: { to: 'deck' },
};

/** RPCs de l'hôte qui mettent un Personnage de joy-boy en file. */
export const QUEUE_RPCS = new Set(['QueueOpponentPlayerSaveQueue', 'QueueOpponentPlayerKOQueue']);

/** Personnage de joy-boy (uid du miroir) mis en file par cette RPC de l'hôte, ou undefined. */
export function queuedUid(mirror: Mirror, rpc: Rpc, joyboy: 0 | 1 = 1): number | undefined {
  if (!QUEUE_RPCS.has(baseName(rpc.name))) return undefined;
  return mirror.players[joyboy].zones.deploy[Number(rpc.values.iDeployIdx)]?.uid;
}

/** La réaction transmise : null si ce n'en est pas une, sinon le retrait demandé (et si on sait le jouer). */
export function reactionOf(rpc: Rpc): { removal: number; forced: boolean } | null {
  if (baseName(rpc.name) !== 'ProcOpponentV3Action') return null;
  return { removal: Number(rpc.values.eRemoval), forced: Boolean(rpc.values.bForcedOpp || rpc.values.bTriggerChance) };
}

/**
 * Retire du moteur les Personnages de joy-boy restés en file, dans l'ordre du jeu (depuis la fin de la file), comme un
 * effet du joueur OPTCGSim (`by` 0 : ses [En cas de KO] se déclenchent). Rend le nouvel état et le nombre retiré.
 */
export function resolveQueued(game: GameState, uids: number[], removal: number, joyboy: 0 | 1 = 1): { game: GameState; removed: number; supported: boolean } {
  const how = REMOVAL[removal];
  if (!how) return { game, removed: 0, supported: false };
  let g = game, removed = 0;
  for (const uid of [...uids].reverse()) {
    const index = externalIndexOf(g, joyboy, 'deploy', uid);
    if (index === null) continue; // déjà parti
    g = applyExternal(g, { kind: 'move', player: joyboy, from: 'deploy', index, to: how.to }, { joyboy, by: joyboy === 1 ? 0 : 1, ...(how.ko ? { cause: 'ko' as const } : {}) });
    removed++;
  }
  return { game: g, removed, supported: true };
}

/** Remplacements possibles (cartes de joy-boy sur le terrain) pour ce Personnage visé par un effet adverse. */
export function replacementsFor(game: GameState, owner: PlayerId, victimUid: number, ko: boolean): Option[] {
  const victim = findField(game, victimUid);
  if (!victim || victim.player !== owner || victim.leader || victim.stage) return [];
  return fieldCards(game, owner).flatMap((self) => {
    const r = def(self.num).replaceRemoval;
    if (!r || isNegated(game, self.uid) || (r.onlyKo && !ko) || (r.exceptKo && ko) || (r.oncePerTurn && self.usedOpt.includes('replace'))
      || !r.condition(game, owner, self, victim.card)) return [];
    return [{ id: `replace:${self.uid}`, label: r.label(game, self, victim.card), uid: self.uid }];
  });
}

/** Question posée par un effet de remplacement, à montrer au joueur. */
export interface ReplacementAsk { player?: PlayerId; prompt: string; options: Option[]; tag?: string; cards?: { uid: number; num: string; owner?: PlayerId }[] }
class NeedAnswer extends Error { spec: ReplacementAsk; constructor(spec: ReplacementAsk) { super('réponse attendue'); this.spec = spec; } }

/**
 * Joue l'effet de remplacement de `replacerUid` pour `victimUid`, avec les réponses déjà données. Rend le nouvel état,
 * ou la question suivante (l'état reçu n'est jamais modifié : on rejoue depuis lui à chaque réponse).
 */
export function runReplacement(game: GameState, owner: PlayerId, replacerUid: number, victimUid: number, answers: string[]):
  { game: GameState } | { ask: ReplacementAsk } {
  const s = structuredClone(game);
  const self = findField(s, replacerUid)?.card, victim = findField(s, victimUid)?.card;
  const r = self && def(self.num).replaceRemoval;
  if (!self || !victim || !r) return { game };
  let k = 0;
  const ctx: EffectCtx = {
    s, me: (owner === 1 ? 0 : 1) as PlayerId, opp: owner, source: -1, num: '',
    pending: { kind: 'system', source: -1, num: '', controller: (owner === 1 ? 0 : 1) as PlayerId, answers: [] } satisfies PendingEffect,
    ask(spec) { if (k < answers.length) return answers[k++]; throw new NeedAnswer(spec); },
  };
  try {
    if (r.oncePerTurn) self.usedOpt.push('replace');
    r.apply(s, owner, self, victim, ctx);
  } catch (e) {
    if (e instanceof NeedAnswer) return { ask: e.spec };
    throw e;
  }
  return { game: s };
}

/** Retire un seul Personnage (sans remplacement) ; rend l'état inchangé s'il n'est plus sur le terrain. */
export function removeOne(game: GameState, uid: number, removal: number, joyboy: 0 | 1 = 1): GameState {
  return resolveQueued(game, [uid], removal, joyboy).game;
}

/**
 * Questions qu'un effet de joy-boy pose au joueur OPTCGSim dans le moteur (écart n° 3 de O3.2 : Loki de joy-boy, Zoro de
 * l'hôte, « 0/effect/replace » sans réponse, tour forcé). Personne ne peut y répondre côté OPTCGSim : ces choix ne lui
 * sont pas encore transmis (interprétation 4503). Repli : un remplacement est refusé (le Personnage part, comme l'effet
 * le veut) ; toute autre question (carte à défausser…) est tranchée à sa place par l'IA heuristique. Rend l'état après
 * ces réponses et les questions répondues (étiquettes).
 */
export function answerForOpponent(game: GameState, opponent: PlayerId = 0): { game: GameState; answered: string[] } {
  let g = game;
  const answered: string[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const d = g.decision;
    if (!d || d.player !== opponent || !d.inEffect || g.winner !== null) break;
    const choice = d.tag === 'replace' ? (d.options.find((o) => o.id === 'none') ?? d.options[d.options.length - 1]).id : heuristicChooser(g, d);
    answered.push(d.tag ?? d.kind);
    g = answerExternal(g, choice, { joyboy: opponent === 0 ? 1 : 0 });
  }
  return { game: g, answered };
}

// ---------------------------------------------------------------------------------------------------- dans l'autre sens
// Un effet de joy-boy retire des Personnages du joueur OPTCGSim et l'un d'eux a un remplacement (Loki de joy-boy, Zoro de
// l'hôte : écart n° 3). Le moteur pose la question au joueur OPTCGSim ; joy-boy la lui transmet comme le jeu le fait
// (GameplayLogicScript : TransferKOAndSaveQueues puis BeginOpponentV3Action, séquence relevée dans la partie de 16 h 30) :
//   QueueOpponentPlayerSaveQueue(i) (indice dans la zone de Personnages de l'hôte), SwitchTurns, AllOnKOResolved,
//   ProcOpponentV3Action(iActor = −identifiant de la carte qui remplace, iAction, eRemoval = AllyKO…, iRemovalPlayer 0),
//   TriggerOpponentMultiActions([]).
// L'hôte joue sa réaction (remplacement : 3 cartes de sa Défausse sous son deck ; sinon DiscardFromSelfDeploy) puis rend
// la main (AllOnKOResolved, SwitchTurns, ResetActionPhase, NoMorePendingActions). joy-boy reporte alors dans le moteur ce
// que l'hôte a fait (answerOutgoing).

/**
 * Indice de l'action « à la place » dans la définition OPTCGSim de la carte (iAction de ProcOpponentV3Action), relevé
 * dans les parties réelles (le jeu nous l'a transmis pour Zoro le 18 nov.). Une carte absente : pas de transmission
 * (repli : remplacement refusé, interprétation 4503).
 */
export const OPTCGSIM_REPLACE_ACTION: Record<string, number> = { 'OP17-095': 1 };

/** RemovalEffect « Ally… » à transmettre pour un retrait du moteur (vu de l'hôte, ce sont ses Personnages). */
export const ALLY_REMOVAL = { ko: 8, other: 12 } as const;

/** Identifiant OPTCGSim d'une carte du deck (deckUniqueID : (indice de chargement + 1) × 10, MakeMyDeck). */
export const uniqueDeckId = (loadIndex: number) => (loadIndex + 1) * 10;

/**
 * Le Personnage du joueur OPTCGSim visé par la question de remplacement en cours : celui que le moteur retire si on
 * répond « Non » (départage par le nom en tête de la question quand plusieurs partent ensuite).
 */
export function replaceVictim(game: GameState, opponent: PlayerId = 0): number | null {
  const d = game.decision;
  if (!d || d.player !== opponent || d.tag !== 'replace' || !d.options.some((o) => o.id === 'none')) return null;
  const after = answerExternal(game, 'none', { joyboy: opponent === 0 ? 1 : 0 });
  const gone = game.players[opponent].chars.filter((c) => !after.players[opponent].chars.some((x) => x.uid === c.uid));
  if (gone.length <= 1) return gone[0]?.uid ?? null;
  return (gone.find((c) => d.prompt.startsWith(`${def(c.num).name} va`)) ?? gone[0]).uid;
}

/**
 * Réponses du moteur après la réaction de l'hôte : « Non » si le Personnage est parti, sinon le remplacement puis, à
 * chaque question de l'effet (Zoro : carte de la Défausse), la carte que l'hôte a déplacée (même numéro).
 */
export function answerOutgoing(game: GameState, replacerUid: number, saved: boolean, movedNums: string[], opponent: PlayerId = 0): GameState {
  const joyboy = opponent === 0 ? 1 : 0;
  if (!saved) return answerExternal(game, 'none', { joyboy });
  let g = answerExternal(game, `replace:${replacerUid}`, { joyboy });
  const rest = [...movedNums];
  for (let guard = 0; guard < 20; guard++) {
    const d = g.decision;
    if (!d || d.player !== opponent || !d.inEffect || d.tag === 'replace') break;
    const want = rest.shift();
    const pick = d.options.find((o) => want !== undefined && (o.num === want || (o.uid !== undefined && g.players[opponent].trash.find((c) => c.uid === o.uid)?.num === want)))
      ?? d.options[0];
    g = answerExternal(g, pick.id, { joyboy });
  }
  return g;
}

/**
 * Sécurité (Décision 9) : termine par un repli sûr la question d'effet en suspens du moteur (« Non » ou « non » s'ils
 * existent, sinon le premier choix), quel que soit le joueur, jusqu'à ce que plus rien n'attende au milieu d'un effet.
 * Rend le nouvel état et la première question ainsi passée (null s'il n'y en avait pas).
 */
export function settlePending(game: GameState, joyboy: 0 | 1 = 1): { game: GameState; closed: { player: PlayerId; tag: string } | null } {
  let g = game;
  const first = g.decision?.inEffect ? { player: g.decision.player, tag: g.decision.tag ?? g.decision.kind } : null;
  for (let guard = 0; guard < 50 && g.decision?.inEffect; guard++) {
    const d = g.decision;
    const pick = d.options.find((o) => o.id === 'none') ?? d.options.find((o) => o.id === 'no') ?? d.options[0];
    g = answerExternal(g, pick.id, { joyboy });
  }
  return { game: g, closed: first };
}

// ---------------------------------------------------------------------------------------------------- action imposée
// Un effet du joueur OPTCGSim impose une action au joueur joy-boy (« votre adversaire défausse 1 carte »…) : le jeu lui
// transmet la suite de l'action de sa carte (ProcOpponentV3Action avec bForcedOpp, iActor = identifiant de sa carte,
// iStartOnStep = l'étape à jouer) et l'attend (bForcingOpponentAction, iPlayerAction = 1 chez lui). C'est le client du
// joueur visé qui la joue, puis lui rend la main en lui renvoyant la liste des actions restantes (GameplayLogicScript :
// TransferAllPendingActionsToOpponent, SwitchTurns puis TriggerOpponentMultiActions) ; c'est ce qui remet à zéro son
// attente (PopulateListOfActionsFromOpponent). L'essai de production du 19 nov. (i_tAJm) le montre : renvoyer la liste
// sans SwitchTurns le laisse bloqué (il croit encore que c'est à nous d'agir).
// Les définitions d'actions d'OPTCGSim (V3) ne sont pas lisibles ici : le genre d'action est lu dans le texte anglais
// officiel de la carte (forcedKindOf). Genre inconnu : la main est rendue sans rien faire (jamais de blocage).

// La remise de la main après une action imposée dépend du contexte : voir handBackFor (plus bas).

export type ForcedKind =
  | { kind: 'discard'; count: number }
  | { kind: 'field'; to: 'trash' | 'hand' | 'deck'; ko: boolean; count: number };

const WORD: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
const count = (x: string | undefined) => (x === undefined ? 1 : /^\d+$/.test(x) ? Number(x) : WORD[x.toLowerCase()] ?? 1);
const N = '(?:up to )?(\\d+|an?|one|two|three|four)';
const THEIR = '(?:their|his|her)';
const FORCED_PATTERNS: [RegExp, (n: number) => ForcedKind][] = [
  [new RegExp(`opponent (?:must )?(?:trash|discard)(?:es|s)? ${N} cards? from ${THEIR} hand`, 'i'), (n) => ({ kind: 'discard', count: n })],
  [new RegExp(`opponent (?:must )?(?:chooses?|selects?) ${N} of ${THEIR} Characters? and K\\.?O\\.?`, 'i'), (n) => ({ kind: 'field', to: 'trash', ko: true, count: n })],
  [new RegExp(`opponent (?:must )?K\\.?O\\.?(?:s|'s)? ${N} of ${THEIR} (?:own )?Characters?`, 'i'), (n) => ({ kind: 'field', to: 'trash', ko: true, count: n })],
  [new RegExp(`opponent (?:must )?trash(?:es)? ${N} of ${THEIR} Characters?`, 'i'), (n) => ({ kind: 'field', to: 'trash', ko: false, count: n })],
  [new RegExp(`opponent (?:must )?returns? ${N} of ${THEIR} Characters? to (?:${THEIR}|the owner's) hand`, 'i'), (n) => ({ kind: 'field', to: 'hand', ko: false, count: n })],
  [new RegExp(`opponent (?:must )?places? ${N} of ${THEIR} Characters? at the bottom of`, 'i'), (n) => ({ kind: 'field', to: 'deck', ko: false, count: n })],
];

/** Genre de l'action qu'une carte impose à l'adversaire, lu dans son texte anglais officiel ; null : inconnu. */
export function forcedKindOf(effectEn: string | undefined): ForcedKind | null {
  if (!effectEn) return null;
  for (const [re, make] of FORCED_PATTERNS) {
    const m = re.exec(effectEn);
    if (m) return make(count(m[1]));
  }
  return null;
}

/** Choix proposés au joueur joy-boy pour une action imposée (jamais de « Non » : il doit la faire s'il le peut). */
export function forcedOptions(game: GameState, kind: ForcedKind, joyboy: PlayerId = 1): Option[] {
  const P = game.players[joyboy];
  if (kind.kind === 'discard') return P.hand.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num }));
  return P.chars.map((c) => ({ id: `card:${c.uid}`, label: def(c.num).name, uid: c.uid, num: c.num }));
}

/** Applique un choix d'action imposée dans le moteur (comme un effet du joueur OPTCGSim). */
export function applyForced(game: GameState, kind: ForcedKind, uid: number, joyboy: 0 | 1 = 1): GameState {
  const by = joyboy === 1 ? 0 : 1;
  if (kind.kind === 'discard') {
    const index = externalIndexOf(game, joyboy, 'hand', uid);
    if (index === null) return game;
    return applyExternal(game, { kind: 'move', player: joyboy, from: 'hand', index, to: 'trash' }, { joyboy, by, cause: 'discard' });
  }
  const index = externalIndexOf(game, joyboy, 'deploy', uid);
  if (index === null) return game;
  return applyExternal(game, { kind: 'move', player: joyboy, from: 'deploy', index, to: kind.to }, { joyboy, by, ...(kind.ko ? { cause: 'ko' as const } : {}) });
}

// ---------------------------------------------------------------------------------------------------- rendre la main
// Tâche O5.0a (audit O5.0, § 3.5, CA4 et CA5) : le vrai client décide dans ResolveAction (GLS:14375) d'après SON état
// ce qu'il envoie à la fin d'une réaction. Envoyer SwitchTurns + ResetActionPhase pendant le tour de joy-boy (ce que
// faisait #39) rend la main à l'hôte en plein tour adverse : il croit jouer, SA pendule tourne, et chaque SwitchTurns
// suivant de joy-boy est inversé.

/** Où en est la partie quand joy-boy rend la main (d'après le miroir et le combat). */
export interface HandBackContext {
  /** Tour du joueur OPTCGSim (sinon tour de joy-boy). */
  hostTurn: boolean;
  /** Combat en cours : 'attack' = joy-boy attaque (l'hôte aux contres), 'defense' = l'hôte attaque. */
  combat: 'none' | 'attack' | 'defense';
  /** Action imposée (bForcedOpp) : l'hôte attend aussi la liste d'actions (PopulateListOfActionsFromOpponent). */
  forced: boolean;
  /** Actions de l'hôte reçues dans sa liste (TriggerOpponentMultiActions) : à lui renvoyer. */
  hostActions?: Record<string, unknown>[];
}

/** Une action de la liste reçue, renvoyée à son propriétaire : iOwner est relatif à celui qui envoie (0 ↔ 1). */
export const returnedAction = (a: Record<string, unknown>): Record<string, unknown> => ({ ...a, iOwner: a.iOwner === 1 ? 0 : 1 });

/**
 * RPC (nom sans suffixe, valeurs) qui rendent la main au joueur OPTCGSim, selon le contexte (tableau du § 3.5) :
 * - l'hôte a encore des actions (liste reçue non vide) : SwitchTurns + la liste renvoyée (TransferAllPendingActionsToOpponent) ;
 * - tour de l'hôte, hors combat : AllOnKOResolved, SwitchTurns, [liste vide si imposée], ResetActionPhase,
 *   NoMorePendingActions (ReturnToOpponentActionPhase, GLS:29644) ;
 * - tour de l'hôte, il attaque : AllOnKOResolved seul (la suite du combat reprend) ;
 * - tour de joy-boy, il attaque (l'hôte aux contres) : AllOnKOResolved, SwitchTurns (GLS:14425-14443) ;
 * - tour de joy-boy, phase principale : AllOnKOResolved seul, [liste vide si imposée] (GLS:14448-14472).
 * AllOnKOResolved remet à zéro l'attente de l'hôte (bOpponentResolving, bForcingOpponentAction).
 */
export function handBackFor(c: HandBackContext): [string, Record<string, unknown>][] {
  const list = (a: Record<string, unknown>[]): [string, Record<string, unknown>] => ['TriggerOpponentMultiActions', { aTransfer: a, bDontStartAny: false }];
  if (c.hostActions?.length) return [['AllOnKOResolved', {}], ['SwitchTurns', {}], list(c.hostActions.map(returnedAction))];
  if (c.hostTurn && c.combat === 'none') {
    return [['AllOnKOResolved', {}], ['SwitchTurns', {}], ...(c.forced ? [list([])] : []), ['ResetActionPhase', {}], ['NoMorePendingActions', {}]];
  }
  if (c.hostTurn) return [['AllOnKOResolved', {}], ...(c.forced ? [list([])] : [])];
  if (c.combat === 'attack') return [['AllOnKOResolved', {}], ['SwitchTurns', {}]];
  return [['AllOnKOResolved', {}], ...(c.forced ? [list([])] : [])];
}

