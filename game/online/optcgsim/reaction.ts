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
import { def, fieldCards, findField, isNegated } from '../../engine/rules.ts';
import { applyExternal, externalIndexOf } from './external.ts';
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

/** Rendre la main au joueur OPTCGSim (ReturnToOpponentActionPhase). */
export const HAND_BACK = ['AllOnKOResolved', 'SwitchTurns', 'ResetActionPhase', 'NoMorePendingActions'];
