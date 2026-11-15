// IA par simulation (Monte-Carlo avec informations cachées) : pour chaque choix possible, on joue la suite de la
// partie jusqu'au bout plusieurs fois, en redistribuant au hasard les cartes que le joueur ne peut pas connaître,
// et on garde le choix qui gagne le plus souvent. Sert aussi au coach pour évaluer les décisions du joueur.
import { CARDS, cardStatus, HIDDEN } from '../engine/cards/index.ts';
import { MAX_COPIES } from '../engine/deckRules.ts';
import { isCustomDeck } from '../engine/decks.ts';
import { act, type Chooser } from '../engine/engine.ts';
import { random, shuffle, type RngState } from '../engine/rng.ts';
import { def, knows, other } from '../engine/rules.ts';
import type { Card, Decision, GameState, PlayerId } from '../engine/types.ts';
import { heuristicChooser } from './heuristic.ts';
import { playerStyle, STYLE_RANGES, styleOf, type Style } from './style.ts';
import { uselessReason } from './prune.ts';

export type Level = 1 | 2 | 3 | 4;

// Niveau 4 : modèle entraîné par apprentissage par renforcement (rl/, game/ai/rl.ts), proposé seulement quand un modèle
// est installé (web/public/rl-model/) ; ses décisions passent par le fil de calcul (AiWorker.chooseRl)
export const LEVELS: Record<Level, { name: string; samples: number; budgetMs: number; margin: number }> = {
  1: { name: 'Débutant', samples: 0, budgetMs: 0, margin: 0 },
  2: { name: 'Confirmé', samples: 16, budgetMs: 500, margin: 0.06 },
  3: { name: 'Expert', samples: 48, budgetMs: 1800, margin: 0.03 },
  4: { name: 'IA entraînée', samples: 0, budgetMs: 0, margin: 0 },
};

export interface OptionStat {
  id: string;
  label: string;
  wins: number;
  n: number;
  rate: number;
  refined?: boolean;  // estimée à nouveau avec des simulations indépendantes (voir coachAnalyze)
}

export interface Analysis {
  player: PlayerId;
  stats: OptionStat[];  // du meilleur au moins bon
  best: string;
  heuristic: string;    // choix de l'IA simple, pour comparaison
  samples: number;
  refinedSamples?: number;
  verifiedSamples?: number;  // erreur candidate du joueur revérifiée (voir coachAnalyze)
  failures?: number;         // tirages écartés parce qu'une suite a divergé ou levé une erreur
  failure?: string;          // ... le premier message d'erreur
  ms: number;
  pruned: { id: string; label: string; reason: string }[];  // choix sans intérêt, non simulés
}

// Cartes jouables d'un deck aux couleurs de ce Leader (pour deviner un deck personnalisé)
const colorPools = new Map<string, string[]>();
function colorPool(leader: string): string[] {
  let pool = colorPools.get(leader);
  if (!pool) {
    const colors = def(leader).colors;
    pool = Object.keys(CARDS).filter((n) => {
      const c = CARDS[n];
      return n !== HIDDEN && c.category !== 'LEADER' && c.colors.length > 0 && c.colors.every((x) => colors.includes(x)) && cardStatus(n) !== 'todo';
    });
    colorPools.set(leader, pool);
  }
  return pool;
}

// Deck adverse personnalisé : sa liste est secrète. Les cartes cachées que le joueur ne connaît pas reçoivent une
// identité devinée : le plus souvent un autre exemplaire d'une carte déjà vue de ce joueur (4 au plus par numéro),
// sinon une carte jouable au hasard parmi les couleurs de son Leader
function guessHidden(d: GameState, viewer: PlayerId, unknown: Card[], fixed: (c: Card) => boolean) {
  const O = d.players[other(viewer)];
  const counts = new Map<string, number>();
  const known = [...O.hand, ...O.deck, ...O.life].filter(fixed);
  for (const c of [...O.chars, ...(O.stage ? [O.stage] : []), ...O.trash, ...known]) counts.set(c.num, (counts.get(c.num) ?? 0) + 1);
  const extras: string[] = [];
  for (const [num, n] of counts) for (let i = n; i < MAX_COPIES; i++) extras.push(num);
  shuffle(d, extras);
  const pool = colorPool(O.leader.num);
  for (const c of unknown) {
    let num = extras.length && random(d) < 0.75 ? extras.pop() : undefined;
    for (let tries = 0; !num && tries < 20 && pool.length; tries++) {
      const pick = pool[Math.floor(random(d) * pool.length)];
      if ((counts.get(pick) ?? 0) < MAX_COPIES) num = pick;
    }
    num ??= extras.pop() ?? c.num;
    counts.set(num, (counts.get(num) ?? 0) + 1);
    c.num = num;
  }
}

// Redistribue au hasard les cartes cachées de l'adversaire (main, deck, Vie face cachée), sauf celles que le joueur
// connaît (carte du dessus de son deck regardée, cartes révélées : voir rules.ts, reveal), qui restent à leur place.
// secret : la liste du deck adverse est inconnue du joueur (deck personnalisé face à l'IA) : les cartes inconnues sont
// devinées au lieu d'être tirées parmi les vraies cartes restantes.
function shuffleOpponent(d: GameState, viewer: PlayerId, keepHand: boolean, secret = false) {
  const O = d.players[other(viewer)];
  const knownTop = d.peek[viewer] !== null && O.deck[0]?.uid === d.peek[viewer] ? O.deck[0].uid : null;
  const fixed = (c: Card) => c.uid === knownTop || Boolean(c.faceUp) || knows(d, viewer, c.uid);
  const pool = [...(keepHand ? [] : O.hand), ...O.deck, ...O.life].filter((c) => !fixed(c));
  if (secret && isCustomDeck(O.deckId)) guessHidden(d, viewer, pool, fixed);
  shuffle(d, pool);
  const refill = (cards: Card[]) => cards.map((c) => (fixed(c) ? c : pool.shift()!));
  if (!keepHand) O.hand = refill(O.hand);
  O.deck = refill(O.deck);
  O.life = refill(O.life);
}

// Redistribue son propre deck et sa Vie face cachée (le joueur ne connaît pas leur ordre), sauf les cartes qu'il
// connaît et les `keepTop` cartes du dessus de son deck
function shuffleOwn(d: GameState, viewer: PlayerId, keepTop: number, keepLife: boolean) {
  const P = d.players[viewer];
  const fixedDeck = (c: Card, i: number) => i < keepTop || knows(d, viewer, c.uid);
  const fixedLife = (c: Card) => keepLife || Boolean(c.faceUp) || knows(d, viewer, c.uid);
  const own = [...P.deck.filter((c, i) => !fixedDeck(c, i)), ...P.life.filter((c) => !fixedLife(c))];
  shuffle(d, own);
  P.life = P.life.map((c) => (fixedLife(c) ? c : own.shift()!));
  P.deck = P.deck.map((c, i) => (fixedDeck(c, i) ? c : own.shift()!));
}

// Ce que voit un joueur : sa main, le terrain, les cartes de Vie face visible et la carte du deck adverse qu'il a
// regardée. Le reste est redistribué au hasard entre les zones cachées concernées.
export function determinize(s: GameState, viewer: PlayerId, seed: number, secret = false): GameState {
  const d = structuredClone(s);
  d.rng = seed | 0;
  delete d.rng128;  // partie en ligne : les simulations tirent leur hasard de seed, pas du générateur de la partie
  shuffleOpponent(d, viewer, false, secret);
  shuffleOwn(d, viewer, 0, false);
  // Décision au milieu d'un effet : la suite se rejoue depuis l'instantané pris au début de l'effet, qu'on redistribue
  // aussi, sans toucher aux cartes que les réponses déjà données peuvent désigner (dessus de son deck, sa Vie, main
  // adverse si l'adversaire y a choisi une carte)
  const p = d.pending[0];
  if (d.decision?.inEffect && p?.snapshot) {
    const snap = JSON.parse(p.snapshot) as GameState;
    snap.rng = (seed * 31 + 7) | 0;
    delete snap.rng128;
    const named = new Set(p.answers.flatMap((a) => (/^[a-z]+:\d+$/i.test(a) ? [Number(a.split(':')[1])] : [])));
    shuffleOpponent(snap, viewer, snap.players[other(viewer)].hand.some((c) => named.has(c.uid)), secret);
    shuffleOwn(snap, viewer, 6, true);
    p.snapshot = JSON.stringify(snap);
  }
  d.log = [];
  d.history = [];
  return d;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface AnalyzeOptions {
  samples: number;
  budgetMs?: number;
  minSamples?: number;
  seed?: number;
  rollout?: Chooser;
  only?: string[];   // n'évaluer que ces options
  prune?: boolean;   // écarter les choix sans intérêt (par défaut)
  // l'IA ne connaît pas la liste d'un deck personnalisé adverse (le coach, lui, aide le joueur qui a construit le deck
  // de l'IA : il la connaît)
  secretOpponent?: boolean;
  // coach seulement : la suite est jouée par l'IA simple avec un style tiré au hasard à chaque décision (voir
  // variedRollout). L'IA (mcChoose) ne s'en sert pas : ses choix et l'entraînement de l'IA entraînée restent ceux d'avant.
  varyStyle?: boolean;
}

// Écart des styles tirés par le coach : chaque réglage du style du deck bouge au hasard d'au plus cette part de son
// intervalle (STYLE_RANGES), de chaque côté, sans en sortir. Mesuré le 15 novembre 2026 sur des parties de l'IA simple
// (part des taux à 0 ou 100 % : ST-35/ST-36, ST-31/ST-33, Sabo du méta/ST-32) : sans variation 0,64 / 0,62 / 0,20 ;
// tout l'intervalle 0,80 / 0,67 / 0,16 (des styles absurdes rendent les parties plus déséquilibrées) ; 0,15 : 0,57 /
// 0,52 / 0,15 ; 0,3 : 0,38 / 0,51 / 0,17 ; 0,5 : 0,43 / 0,25 / 0,16, le meilleur ensemble.
export const STYLE_SPREAD = 0.5;

// Style de jeu tiré au hasard autour d'un style
function randomStyle(r: RngState, around: Style): Style {
  const st = {} as Style;
  for (const k of Object.keys(STYLE_RANGES) as (keyof Style)[]) {
    const [lo, hi] = STYLE_RANGES[k];
    st[k] = Math.min(hi, Math.max(lo, around[k] + (random(r) * 2 - 1) * STYLE_SPREAD * (hi - lo)));
  }
  return st;
}

// Suite de partie jouée par un chooser (l'IA simple) dont le style de chaque joueur est tiré au hasard à chaque
// décision, autour du style de son deck (STYLE_SPREAD). L'IA simple est déterministe : sans cela, les simulations
// d'une même décision rejouent presque toutes la même suite, et les chances estimées sortent à 0 ou 100 % (mesuré le
// 16 octobre 2026 sur les parties d'un joueur : 35 % des taux à 0 ou 100 %, 10,4 « erreurs » par partie). Le style imposé (playerStyle, style.ts) est remis comme
// avant après chaque décision, même en cas d'erreur : hors de ces simulations, l'IA simple ne change pas.
export function variedRollout(base: Chooser, seed: number): Chooser {
  const r: RngState = { rng: seed | 0 };
  return (s, d) => {
    const saved: [Style | null, Style | null] = [playerStyle[0], playerStyle[1]];
    const own = [0, 1].map((p) => styleOf(s.players[p].deckId, p as PlayerId, s.players[p].leader.num));
    playerStyle[0] = randomStyle(r, own[0]);
    playerStyle[1] = randomStyle(r, own[1]);
    try {
      return base(s, d);
    } finally {
      playerStyle[0] = saved[0];
      playerStyle[1] = saved[1];
    }
  };
}

// Évalue chaque option de la décision en cours, du point de vue du joueur qui décide
export function analyze(s: GameState, opts: AnalyzeOptions): Analysis {
  const d = s.decision as Decision;
  const viewer = d.player;
  const rollout = opts.rollout ?? heuristicChooser;
  const pruned: Analysis['pruned'] = [];
  const candidates = d.options.filter((o) => {
    if (opts.only) return opts.only.includes(o.id);
    const reason = opts.prune === false ? null : uselessReason(s, d, o);
    if (reason) pruned.push({ id: o.id, label: o.label, reason });
    return !reason;
  });
  const stats: OptionStat[] = candidates.map((o) => ({ id: o.id, label: o.label, wins: 0, n: 0, rate: 0 }));
  const start = now();
  const seed = opts.seed ?? (s.rng ^ 0x5bd1e995);
  const minSamples = opts.minSamples ?? 4;
  let samples = 0;
  let failures = 0;
  let failure: string | undefined;
  for (let i = 0; i < opts.samples; i++) {
    if (opts.budgetMs && i >= minSamples && now() - start > opts.budgetMs) break;
    const base = determinize(s, viewer, seed + i * 7919, opts.secretOpponent);
    // les options sont jouées sur la même redistribution (et, pour le coach, avec les mêmes styles tirés au hasard) ; un
    // tirage où une suite a divergé (réponse rejouée devenue impossible) est écarté pour toutes les options, et compté
    const styleSeed = ((seed + i * 7919) ^ 0x2545f491) | 0;
    let wins: boolean[];
    try {
      wins = stats.map((stat) => act(base, stat.id, opts.varyStyle ? variedRollout(rollout, styleSeed) : rollout).winner === viewer);
    } catch (err) {
      failures++;
      failure ??= err instanceof Error ? err.message : String(err);
      continue;
    }
    stats.forEach((stat, k) => {
      stat.n++;
      if (wins[k]) stat.wins++;
    });
    samples++;
  }
  for (const stat of stats) stat.rate = stat.n ? stat.wins / stat.n : 0;
  const heuristic = heuristicChooser(s, d);
  stats.sort((a, b) => b.rate - a.rate || Number(b.id === heuristic) - Number(a.id === heuristic));
  return {
    player: viewer, stats, best: stats[0]?.id ?? heuristic, heuristic, samples, ms: Math.round(now() - start), pruned,
    ...(failures ? { failures, failure } : {}),
  };
}

export interface CoachOptions {
  samples: number;
  budgetMs: number;
  minSamples: number;
  refineSamples: number;
  refineBudgetMs: number;
  refineMin: number;
  include?: string;  // option à réévaluer en tout cas (le choix du joueur)
  seed?: number;
  // Erreur candidate : le choix du joueur (include) perd au moins verifyAbove de chances face au meilleur. Elle est
  // revérifiée par verifySamples nouvelles simulations des deux options seulement (nombre fixe, sans limite de temps)
  // avant d'être gardée : une « erreur » due au hasard des premiers tirages disparaît.
  verifySamples?: number;
  verifyAbove?: number;
}

// Analyse du coach en deux temps : toutes les options utiles, puis de nouvelles simulations, indépendantes des premières,
// pour les 3 meilleures et pour le choix du joueur. Sans ce deuxième temps, l'option qui a eu le plus de chance au
// premier tour paraîtrait meilleure qu'elle n'est (d'autant plus qu'il y a d'options).
// Toutes les simulations du coach jouent la suite avec des styles variés (variedRollout) ; une erreur candidate est
// revérifiée (verifySamples).
export function coachAnalyze(s: GameState, opts: CoachOptions): Analysis {
  const seed = opts.seed ?? (s.rng ^ 0x5bd1e995);
  const first = analyze(s, { samples: opts.samples, budgetMs: opts.budgetMs, minSamples: opts.minSamples, seed, varyStyle: true });
  const top = first.stats.slice(0, 3).map((x) => x.id);
  if (opts.include && !top.includes(opts.include) && s.decision!.options.some((o) => o.id === opts.include)) top.push(opts.include);
  if (top.length < 2) return first;
  const second = analyze(s, { samples: opts.refineSamples, budgetMs: opts.refineBudgetMs, minSamples: opts.refineMin, seed: seed + 104729, only: top, varyStyle: true });
  let refined: OptionStat[] = second.stats.map((x) => ({ ...x, refined: true }));
  let third: Analysis | undefined;
  const chosen = refined.find((x) => x.id === opts.include);
  if (opts.verifySamples && chosen && refined[0].id !== chosen.id && refined[0].rate - chosen.rate >= (opts.verifyAbove ?? 0)) {
    third = analyze(s, { samples: opts.verifySamples, seed: seed + 2 * 104729, only: [refined[0].id, chosen.id], varyStyle: true });
    const again = new Map(third.stats.map((x) => [x.id, x]));
    refined = refined.map((x) => ({ ...x, ...(again.get(x.id) ?? {}), refined: true }));
    refined.sort((a, b) => b.rate - a.rate || Number(b.id === first.heuristic) - Number(a.id === first.heuristic));
  }
  const stats = [...refined, ...first.stats.filter((x) => !top.includes(x.id))];
  const failures = (first.failures ?? 0) + (second.failures ?? 0) + (third?.failures ?? 0);
  return {
    ...first,
    stats,
    best: stats[0].id,
    refinedSamples: second.samples,
    ...(third ? { verifiedSamples: third.samples } : {}),
    ...(failures ? { failures, failure: first.failure ?? second.failure ?? third?.failure } : {}),
    ms: first.ms + second.ms + (third?.ms ?? 0),
    pruned: first.pruned.filter((x) => !top.includes(x.id)),
  };
}

// Choix de l'IA selon son niveau. Les petites décisions au milieu d'un effet restent à l'IA simple ; quand la
// simulation ne départage pas nettement, le choix de bon sens est gardé (moins de coups bizarres dus au hasard).
export function aiChoose(s: GameState, d: Decision, level: Level): string {
  if (level === 1 || level === 4) return heuristicChooser(s, d);
  return mcChoose(s, d, LEVELS[level]);
}

// Choix Monte-Carlo (niveaux 2 et 3). Sans budgetMs, le nombre de tirages est fixe : le choix ne dépend que de l'état,
// ce qui rend reproductibles les parties d'entraînement et d'évaluation de l'IA par apprentissage (game/rl/).
export function mcChoose(s: GameState, d: Decision, cfg: { samples: number; budgetMs?: number; margin: number }): string {
  if (d.inEffect || d.options.length === 1 || s.decision !== d) return heuristicChooser(s, d);
  const analysis = analyze(s, { samples: cfg.samples, budgetMs: cfg.budgetMs, secretOpponent: true });
  const best = analysis.stats[0];
  if (!best) return analysis.heuristic;
  const fallback = analysis.stats.find((x) => x.id === analysis.heuristic);
  if (fallback && fallback.rate >= best.rate - cfg.margin) return fallback.id;
  return best.id;
}
