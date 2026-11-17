// Mutations externes appliquées au moteur, sans contrôle des règles (tâche O1.3).
//
// Table partagée : le jeu OPTCGSim fait foi. Les coups du joueur OPTCGSim arrivent en mutations (« carte n° 3 de la main
// vers le terrain », « 1 DON!! épuisée », « +1000 jusqu'à la fin du tour adverse ») qui changent l'état du moteur sans
// qu'il les vérifie ; le moteur garde seulement ses invariants (invariants.ts) et son journal. Les cartes du joueur
// joy-boy réagissent aux mutations qui les concernent par les évènements du moteur (emit) : un Personnage mis KO par un
// effet OPTCGSim résout son [En cas de KO]. Les effets des cartes du joueur OPTCGSim ne sont jamais résolus ici (son jeu
// les résout) : le moteur les écarte (engine.ts, advanceShared).
//
// Indices (contrat de l'étape O : le miroir, mirror.ts, traduit les positions d'OPTCGSim dans celles-ci) :
// - deck et Vie : 0 = dessus ; Défausse : dernier = dessus ; main : ordre du moteur ;
// - deploy : les Personnages (PlayerState.chars), stage : le Lieu (0), leader : le Leader (-1 ou 0) ;
// - donCost : les DON!! de la zone de Coût, les redressées d'abord (index < donActive), puis les épuisées ;
//   donDeck : le deck DON!! (l'index n'est pas lu) ;
// - `at` (move) : position d'arrivée, à la fin de la zone si absent (au-dessous du deck et de la Vie, dessus de la Défausse) ;
// - target (attachDon, power, cost) : -1 = Leader, sinon le Personnage à cet index.
// Une mutation impossible sans casser un invariant (6e Personnage, carte d'une autre catégorie dans la zone, index hors de
// la zone, DON!! qui n'existe pas) lève ExternalError et laisse l'état reçu tel quel : la session se resynchronise.
import { advanceShared } from '../../engine/engine.ts';
import { carryKnown, def, emit, isNegated, listens, log, other, reveal, untilOpponentsNextEnd } from '../../engine/rules.ts';
import type { Card, Decision, FieldCard, GameEvent, GameState, Option, PendingEffect, PlayerId } from '../../engine/types.ts';
import type { External, Seat, Zone } from './types.ts';

export class ExternalError extends Error {}

export interface ExternalOptions {
  /** Siège du joueur joy-boy (1, contrat de l'étape O) : seules ses cartes réagissent. */
  joyboy?: Seat;
  /** Joueur dont l'effet ou l'action cause la mutation : par défaut le joueur OPTCGSim. */
  by?: Seat;
  /**
   * Ce que la mutation représente, quand les évènements du moteur le distinguent :
   * - 'ko' / 'battleKo' : Personnage du terrain vers la Défausse, mis KO par un effet / en combat ([En cas de KO], 'ko') ;
   * - 'discard' : carte de la main vers la Défausse, défaussée par un effet ('discard') ;
   * - 'attack' : carte épuisée pour attaquer ('rest', cause 'attack') ;
   * - 'effect' : pioche par un effet ('draw') ; sinon, comme sans cause.
   * Sans cause : Personnage retiré du terrain autrement que par KO ('leave'), carte de la main vers la Défausse sans
   * défausse (Évènement joué, Contre), pioche de la phase de Pioche (rien n'est annoncé), carte épuisée par un effet.
   */
  cause?: 'ko' | 'battleKo' | 'discard' | 'attack' | 'effect';
  /** Carte dont l'effet est la cause (journal et évènements). */
  sourceNum?: string;
}

/** Décision qu'un effet OPTCGSim impose à un joueur (RPC « forcing opponent action »). */
export interface ForcedDecision {
  player: Seat;
  prompt: string;
  options: Option[];
  tag?: string;
  cards?: Decision['cards'];
}

const ZONE_TEXT: Record<Zone, string> = {
  deck: 'deck', hand: 'main', life: 'Vie', deploy: 'zone de Personnage', stage: 'zone de Lieu', leader: 'Leader',
  trash: 'Défausse', donDeck: 'deck DON!!', donCost: 'zone de Coût',
};
const PUBLIC: Zone[] = ['deploy', 'stage', 'leader', 'trash'];
const HIDDEN: Partial<Record<Zone, 'hand' | 'deck' | 'life'>> = { hand: 'hand', deck: 'deck', life: 'life' };

const fail = (text: string): never => {
  throw new ExternalError(text);
};

/**
 * Applique une mutation externe et renvoie le nouvel état (l'état reçu n'est pas modifié), après avoir résolu les
 * réactions des cartes du joueur joy-boy jusqu'à la prochaine décision (engine.ts, advanceShared).
 */
export function applyExternal(state: GameState, mutation: External, opts: ExternalOptions = {}): GameState {
  if (state.decision?.inEffect) fail('un effet du moteur attend une réponse : mutation refusée');
  const joyboy = opts.joyboy ?? 1;
  const by = opts.by ?? other(joyboy);
  const s = structuredClone(state);
  switch (mutation.kind) {
    case 'move':
      move(s, mutation, by, opts);
      break;
    case 'rest':
    case 'activate':
      restOrActivate(s, mutation, by, opts);
      break;
    case 'attachDon':
      attachDon(s, mutation);
      break;
    case 'power':
    case 'cost':
      modify(s, mutation, by, opts);
      break;
    case 'shuffle':
      shuffleImposed(s, mutation);
      break;
    case 'turn':
      return changeTurn(s, mutation.to, joyboy);
    default:
      fail(`mutation inconnue : ${(mutation as { kind: string }).kind}`);
  }
  return advanceShared(s, joyboy);
}

/**
 * Pose une décision qui ne vient pas des règles du moteur : un effet OPTCGSim fait choisir un joueur. La décision
 * ordinaire en cours (phase principale, contre...) est mise de côté, puis recalculée après la réponse (answerExternal).
 * Elle se reconnaît à `kind: 'effect'` hors d'un effet (isForced) ; act() la refuse.
 */
export function forceDecision(state: GameState, d: ForcedDecision): GameState {
  if (state.decision?.inEffect) fail('un effet du moteur attend une réponse : décision forcée refusée');
  if (!d.options.length) fail('décision forcée sans aucun choix');
  if (new Set(d.options.map((o) => o.id)).size !== d.options.length) fail('décision forcée avec des choix en double');
  const s = structuredClone(state);
  s.decision = {
    player: d.player,
    kind: 'effect',
    prompt: d.prompt,
    options: d.options.map((o) => ({ ...o })),
    tag: d.tag ?? 'forced',
    ...(d.cards ? { cards: d.cards.map((c) => ({ ...c })) } : {}),
  };
  return s;
}

export const isForced = (d: Decision | null | undefined): boolean => Boolean(d && d.kind === 'effect' && !d.inEffect);

/**
 * Réponse à la décision en cours d'une partie croisée : décision forcée (forceDecision), question d'un effet du moteur
 * ou décision ordinaire. Le moteur avance ensuite comme après une mutation (advanceShared).
 */
export function answerExternal(state: GameState, choice: string, opts: Pick<ExternalOptions, 'joyboy'> = {}): GameState {
  const d = state.decision;
  if (!d) fail('aucune décision attendue');
  if (!d!.options.some((o) => o.id === choice)) fail(`choix invalide : ${choice}`);
  // une question d'effet se rejoue depuis son instantané (l'état reçu n'est pas modifié) ; les autres sont copiées
  return advanceShared(d!.inEffect ? state : structuredClone(state), opts.joyboy ?? 1, choice);
}

/** Position d'une carte (uid) dans une zone du moteur, au sens des mutations (-1 pour le Leader, null si absente). */
export function externalIndexOf(s: GameState, player: Seat, zone: Zone, uid: number): number | null {
  const P = s.players[player];
  if (zone === 'leader') return P.leader.uid === uid ? -1 : null;
  if (zone === 'donDeck' || zone === 'donCost') return null;
  const i = cardsOf(s, player, zone).findIndex((c) => c.uid === uid);
  return i < 0 ? null : i;
}

// ---------- Déplacer ----------

function cardsOf(s: GameState, p: PlayerId, zone: Zone): Card[] {
  const P = s.players[p];
  switch (zone) {
    case 'deck': return P.deck;
    case 'hand': return P.hand;
    case 'life': return P.life;
    case 'trash': return P.trash;
    case 'deploy': return P.chars;
    case 'stage': return P.stage ? [P.stage] : [];
    case 'leader': return [P.leader];
    default: return fail(`la zone ${ZONE_TEXT[zone]} n'a pas de cartes`);
  }
}

function checkIndex(n: number, index: number, zone: Zone) {
  if (!Number.isInteger(index) || index < 0 || index >= n) fail(`index ${index} hors de la zone ${ZONE_TEXT[zone]} (${n} cartes)`);
}

function move(s: GameState, m: Extract<External, { kind: 'move' }>, by: PlayerId, opts: ExternalOptions) {
  const p = m.player;
  const P = s.players[p];
  if (m.from === m.to && m.from !== 'deck' && m.from !== 'hand' && m.from !== 'life' && m.from !== 'trash' && m.from !== 'deploy') {
    fail(`déplacement de ${ZONE_TEXT[m.from]} vers elle-même`);
  }
  if (m.from === 'leader' || m.to === 'leader') fail('le Leader ne change pas de zone');
  if (m.from === 'donDeck' || m.from === 'donCost' || m.to === 'donDeck' || m.to === 'donCost') {
    moveDon(s, p, m);
    return;
  }
  const source = cardsOf(s, p, m.from);
  checkIndex(source.length, m.index, m.from);
  const picked = source[m.index];
  const d = def(picked.num);
  // l'arrivée est vérifiée avant de toucher à quoi que ce soit (l'état reçu reste intact en cas d'erreur)
  const sameZone = m.from === m.to;
  if (m.to === 'deploy') {
    if (d.category !== 'CHARACTER') fail(`${d.name} n'est pas un Personnage : pas dans la zone de Personnage`);
    if (!sameZone && P.chars.length >= 5) fail('zone de Personnage pleine (5)');
  }
  if (m.to === 'stage') {
    if (d.category !== 'STAGE') fail(`${d.name} n'est pas un Lieu : pas dans la zone de Lieu`);
    if (P.stage) fail('zone de Lieu occupée');
  }
  const room = cardsOf(s, p, m.to).length - (sameZone ? 1 : 0);
  const at = m.at ?? room;
  if (!Number.isInteger(at) || at < 0 || at > room) fail(`position d'arrivée ${at} hors de la zone ${ZONE_TEXT[m.to]}`);

  // départ
  const fromField = m.from === 'deploy' || m.from === 'stage';
  const ko = fromField && m.from === 'deploy' && m.to === 'trash' && (opts.cause === 'ko' || opts.cause === 'battleKo');
  const onKO = ko && Boolean(d.onKO) && !isNegated(s, picked.uid)
    && (d.onKOCondition?.(s, p, picked as FieldCard, opts.cause === 'ko' ? 'effect' : 'battle', by) ?? true);
  let card: Card;
  let fieldCard: FieldCard | null = null;
  if (fromField) {
    fieldCard = picked as FieldCard;
    if (m.from === 'stage') P.stage = null;
    else P.chars.splice(m.index, 1);
    if (sameZone) {
      // réordonner la zone de Personnage : la carte garde son état
      P.chars.splice(at, 0, fieldCard);
      log(s, p, `${d.name} change de place dans la zone de Personnage`);
      return;
    }
    P.donRested += fieldCard.don;
    s.mods = s.mods.filter((x) => x.uid !== picked.uid);
    if (s.delayed.some((x) => x.uid === picked.uid)) s.delayed = s.delayed.filter((x) => x.uid !== picked.uid);
    card = { uid: picked.uid, num: picked.num };
  } else {
    source.splice(m.index, 1);
    card = { uid: picked.uid, num: picked.num };
  }

  // arrivée
  if (m.to === 'deploy' || m.to === 'stage') {
    const f: FieldCard = { uid: card.uid, num: card.num, rested: Boolean(m.rested), don: 0, playedTurn: s.turn, usedOpt: [] };
    if (m.to === 'stage') P.stage = f;
    else P.chars.splice(at, 0, f);
  } else {
    cardsOf(s, p, m.to).splice(at, 0, card);
  }

  // ce que chacun sait : une carte vue de tous qui entre dans une zone cachée reste connue des deux joueurs ; d'une zone
  // cachée à une autre, ceux qui la connaissaient la connaissent toujours (comme les pioches du moteur)
  const hiddenTo = HIDDEN[m.to];
  if (hiddenTo && PUBLIC.includes(m.from)) reveal(s, [card.uid], 'both');
  else if (hiddenTo && HIDDEN[m.from]) carryKnown(s, card.uid, hiddenTo);

  // journal : le nom de la carte seulement si elle est vue de tous au départ ou à l'arrivée
  const seen = PUBLIC.includes(m.from) || PUBLIC.includes(m.to);
  const what = seen ? d.name : 'une carte';
  if (ko) log(s, p, `${d.name} est mis KO${opts.cause === 'ko' ? ' par un effet' : ''}`);
  else if (sameZone) log(s, p, `${what} change de place (${ZONE_TEXT[m.from]})`);
  else log(s, p, `${what} : ${ZONE_TEXT[m.from]} → ${ZONE_TEXT[m.to]}${m.to === 'deploy' && m.rested ? ' (épuisé)' : ''}`);

  // évènements (réactions des cartes du joueur joy-boy ; celles du joueur OPTCGSim sont écartées par advanceShared)
  const source2 = opts.sourceNum ? { sourceNum: opts.sourceNum } : {};
  if (ko) {
    s.players[p].charKoTurn = s.turn;
    const effects: PendingEffect[] = onKO ? [{ kind: 'onKO', source: card.uid, num: card.num, controller: p, answers: [] }] : [];
    emit(s, { type: 'ko', player: p, uid: card.uid, num: card.num, zone: 'character', cause: opts.cause === 'ko' ? 'effect' : 'battle', by, ...source2 }, effects);
  } else if (m.from === 'deploy') {
    emit(s, { type: 'leave', player: p, uid: card.uid, num: card.num, zone: 'character', by, cause: 'effect', ...source2 });
  } else if (m.to === 'deploy' || m.to === 'stage') {
    // l'effet [Jouée] d'une carte posée par OPTCGSim n'est pas résolu ici : son jeu le résout
    const from = m.from === 'hand' || m.from === 'trash' ? { from: m.from } : {};
    const cause = m.from === 'hand' && !opts.cause ? {} : { cause: 'effect' as const, ...source2 };
    emit(s, { type: 'play', player: p, uid: card.uid, num: card.num, zone: m.to === 'stage' ? 'stage' : 'character', by, ...cause, ...from } as GameEvent);
  } else if (m.from === 'hand' && m.to === 'trash' && opts.cause === 'discard') {
    P.discardedTurn = s.turn;
    emit(s, { type: 'discard', player: p, count: 1, by, ...source2 });
  } else if (m.from === 'deck' && m.to === 'hand' && opts.cause === 'effect') {
    if (listens(s, 'draw')) emit(s, { type: 'draw', player: p, count: 1 });
  } else if (m.from === 'life' && m.to === 'hand') {
    if (listens(s, 'lifeToHand')) emit(s, { type: 'lifeToHand', player: p, count: 1 });
  }
}

// DON!! : deck DON!! ↔ zone de Coût (les DON!! données à une carte : attachDon ; elles reviennent épuisées quand la carte
// quitte le terrain)
function moveDon(s: GameState, p: PlayerId, m: Extract<External, { kind: 'move' }>) {
  const P = s.players[p];
  if (m.from === 'donDeck' && m.to === 'donCost') {
    if (P.donDeck <= 0) fail('deck DON!! vide');
    P.donDeck--;
    if (m.rested) P.donRested++;
    else P.donActive++;
    log(s, p, `ajoute 1 DON!! ${m.rested ? 'épuisée' : 'redressée'} depuis son deck DON!!`);
    return;
  }
  if (m.from === 'donCost' && m.to === 'donDeck') {
    const active = takeCostDon(P, m.index);
    if (active) P.donActive--;
    else P.donRested--;
    P.donDeck++;
    log(s, p, 'renvoie 1 DON!! dans son deck DON!!');
    emit(s, { type: 'donReturned', player: p, count: 1 });
    return;
  }
  fail(`déplacement impossible : ${ZONE_TEXT[m.from]} → ${ZONE_TEXT[m.to]}`);
}

// La DON!! de la zone de Coût à cet index est-elle redressée ? (redressées d'abord, puis épuisées)
function takeCostDon(P: GameState['players'][number], index: number): boolean {
  checkIndex(P.donActive + P.donRested, index, 'donCost');
  return index < P.donActive;
}

// ---------- Épuiser, redresser ----------

function restOrActivate(s: GameState, m: Extract<External, { kind: 'rest' | 'activate' }>, by: PlayerId, opts: ExternalOptions) {
  const p = m.player;
  const P = s.players[p];
  const rest = m.kind === 'rest';
  if (m.zone === 'donCost') {
    const active = takeCostDon(P, m.index);
    // la DON!! désignée est déjà dans l'état voulu : rien à faire (le miroir et le moteur se rejoignent)
    if (active !== rest) return;
    if (rest) {
      P.donActive--;
      P.donRested++;
    } else {
      P.donRested--;
      P.donActive++;
    }
    log(s, p, `${rest ? 'épuise' : 'redresse'} 1 DON!!`);
    return;
  }
  if (m.zone !== 'deploy' && m.zone !== 'stage' && m.zone !== 'leader') fail(`on n'épuise pas une carte de la zone ${ZONE_TEXT[m.zone]}`);
  const index = m.zone === 'leader' && m.index === -1 ? 0 : m.index;
  const cards = cardsOf(s, p, m.zone) as FieldCard[];
  checkIndex(cards.length, index, m.zone);
  const c = cards[index];
  if (c.rested === rest) return;
  c.rested = rest;
  log(s, p, `${rest ? 'épuise' : 'redresse'} ${def(c.num).name}`);
  if (rest) {
    const zone = m.zone === 'leader' ? 'leader' : m.zone === 'stage' ? 'stage' : 'character';
    emit(s, {
      type: 'rest', player: p, uid: c.uid, num: c.num, zone, by,
      cause: opts.cause === 'attack' ? 'attack' : 'effect', ...(opts.sourceNum ? { sourceNum: opts.sourceNum } : {}),
    });
  }
}

// ---------- DON!! données ----------

function holder(s: GameState, p: PlayerId, target: number): FieldCard {
  const P = s.players[p];
  if (target === -1) return P.leader;
  checkIndex(P.chars.length, target, 'deploy');
  return P.chars[target];
}

function attachDon(s: GameState, m: Extract<External, { kind: 'attachDon' }>) {
  const p = m.player;
  const P = s.players[p];
  const c = holder(s, p, m.target);
  // `rested` dit laquelle donner quand il est là ; sinon l'index dans la zone de Coût
  let active = m.rested === undefined ? takeCostDon(P, m.donIndex) : !m.rested;
  // la sorte demandée manque mais l'autre existe : le jeu OPTCGSim fait foi, on donne celle qui reste
  if (active && P.donActive === 0) active = false;
  if (!active && P.donRested === 0) active = true;
  if ((active ? P.donActive : P.donRested) === 0) fail('aucune DON!! dans la zone de Coût');
  if (active) P.donActive--;
  else P.donRested--;
  c.don++;
  log(s, p, `donne 1 DON!! ${active ? '' : 'épuisée '}à ${def(c.num).name}`);
  // 'donGiven' est relevé par le moteur (donWatch) quand une carte y réagit
}

// ---------- Puissance et coût ----------

function modify(s: GameState, m: Extract<External, { kind: 'power' | 'cost' }>, by: PlayerId, opts: ExternalOptions) {
  const c = holder(s, m.player, m.target);
  if (!Number.isInteger(m.delta)) fail(`modification invalide : ${m.delta}`);
  if (m.delta === 0) return;
  // « pendant ce combat » sans combat du moteur : jusqu'à la fin du tour (le combat se termine dans le même tour)
  // « jusqu'à la fin du prochain tour adverse » (OPTCGSim : ToOppEnd, ToOwnersStart) : adverse de celui qui applique l'effet
  const until = m.until === 'battle' ? (s.battle ? 'battle' : s.turn) : m.until === 'turn' ? s.turn : untilOpponentsNextEnd(s, by);
  const source = opts.sourceNum ? def(opts.sourceNum).name : 'OPTCGSim';
  s.mods.push({ uid: c.uid, stat: m.kind, amount: m.delta, until, source });
  const sign = m.delta > 0 ? '+' : '−';
  const label = m.kind === 'power' ? `${sign}${Math.abs(m.delta)} de puissance` : `${sign}${Math.abs(m.delta)} de coût`;
  log(s, m.player, `${def(c.num).name} : ${label}${until === 'battle' ? ' pendant ce combat' : until === s.turn ? ' pour le tour' : ' jusqu’à la fin du prochain tour adverse'}`);
}

// ---------- Mélange imposé ----------

function shuffleImposed(s: GameState, m: Extract<External, { kind: 'shuffle' }>) {
  const P = s.players[m.player];
  const n = P.deck.length;
  const ok = m.order.length === n && new Set(m.order).size === n && m.order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
  if (!ok) fail(`mélange invalide : il faut une permutation des ${n} cartes du deck`);
  const before = P.deck;
  P.deck = m.order.map((i) => before[i]);
  // comme shuffleDeck : plus personne ne sait où sont les cartes du deck
  if (s.known?.length) {
    const inDeck = new Set(P.deck.map((c) => c.uid));
    s.known = s.known.filter((k) => !(k.zone === 'deck' && inDeck.has(k.uid)));
  }
  if (s.peek[m.player] !== null) s.peek[m.player] = null;
  if (s.peek[other(m.player)] !== null) s.peek[other(m.player)] = null;
  log(s, m.player, 'mélange son deck');
}

// ---------- Changement de joueur actif ----------

// Le tour en cours se termine comme dans le moteur (phase de Fin : effets [Fin de votre tour] du joueur joy-boy, effets
// différés, fin des effets du tour), puis `to` commence le sien. Pendant le tour du joueur OPTCGSim, le moteur fait la
// phase de Recharge (redresser, DON!! données renvoyées), mais pas la Pioche ni la phase DON!! : elles arrivent en
// mutations. Vers le même joueur : tour supplémentaire.
function changeTurn(s: GameState, to: Seat, joyboy: Seat): GameState {
  if (s.flow.stage === 'setup' || s.flow.stage === 'mulligan') fail('la partie n’a pas encore commencé');
  if (s.flow.stage === 'over') fail('la partie est finie');
  if (to === s.active) s.players[to].extraTurn = s.turn;
  else delete s.players[s.active].extraTurn;
  // combat en cours abandonné (le jeu OPTCGSim a déjà fini le sien) et ses effets « pendant ce combat » avec
  if (s.battle) s.battle = null;
  s.mods = s.mods.filter((m) => m.until !== 'battle');
  s.decision = null;
  if (s.flow.stage !== 'end') s.flow = { stage: 'end' };
  return advanceShared(s, joyboy);
}
