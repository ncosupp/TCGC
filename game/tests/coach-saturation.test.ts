// Le coach ne sature pas (audit du 14 novembre 2026, P1-3 et P2-15) : sur des parties figées générées ici (IA simple
// contre IA simple, graines fixes), ses simulations départagent les options au lieu de les sortir toutes à 0 ou 100 %,
// les tirages écartés sont comptés, une erreur candidate est revérifiée, et le récap se corrige d'après la décision
// suivante du même tour. Aussi : quelques comportements de l'IA simple, qui sert de référence à l'IA entraînée (sans
// la modifier).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heuristicChooser } from '../ai/heuristic.ts';
import { analyze, coachAnalyze, variedRollout } from '../ai/search.ts';
import { DEFAULT_STYLE, playerStyle } from '../ai/style.ts';
import { coherentReviews, isReviewable, MIN_SAMPLES, MISTAKE, toReview, type Move, type MoveReview } from '../coach/review.ts';
import { def } from '../engine/rules.ts';
import { act, newGame } from '../engine/engine.ts';
import type { GameState } from '../engine/types.ts';
import { scenario, setDon } from './helpers.ts';

// Décisions analysables d'une partie figée : le joueur 0 suit l'IA simple, et termine parfois son tour sans attaquer
function frozenMoves(decks: [string, string], seed: number): Move[] {
  let s = newGame({ decks, names: ['Toi', 'IA'], seed, first: 0 });
  const moves: Move[] = [];
  let id = 0;
  while (s.winner === null) {
    const d = s.decision!;
    let choice = heuristicChooser(s, d);
    if (d.player === 0) {
      if (d.kind === 'main' && s.turn % 4 === 3 && choice.startsWith('attack:')) choice = 'end';
      const m = { id: id++, state: s, choice };
      if (isReviewable(m, 0)) moves.push(m);
    }
    s = act(s, choice);
  }
  return moves;
}

const extremeShare = (stats: { rate: number }[][]) => {
  const all = stats.flat();
  return all.filter((x) => x.rate === 0 || x.rate === 1).length / all.length;
};

test('coach : les simulations ne sortent pas toutes les options à 0 ou 100 % (styles variés)', () => {
  const moves = [...frozenMoves(['ST-35', 'ST-36'], 5).slice(0, 8), ...frozenMoves(['ST-31', 'ST-33'], 7).slice(0, 8)];
  assert.ok(moves.length >= 12, `${moves.length} décisions`);
  const plain: { rate: number }[][] = [];
  const varied: { rate: number }[][] = [];
  for (const m of moves) {
    const seed = m.id * 7919;
    plain.push(analyze(m.state, { samples: 12, seed }).stats);
    const a = analyze(m.state, { samples: 12, seed, varyStyle: true });
    assert.equal(a.samples + (a.failures ?? 0), 12);
    varied.push(a.stats);
  }
  const before = extremeShare(plain);
  const after = extremeShare(varied);
  assert.ok(after < before, `taux à 0 ou 100 % : ${after} avec styles variés, ${before} sans`);
  assert.ok(after < 0.35, `taux à 0 ou 100 % : ${after}`);
  // décisions où toutes les options sortent au même taux (simulations qui ne départagent rien)
  const flat = varied.filter((st) => st.length > 1 && st.every((x) => x.rate === st[0].rate)).length / varied.length;
  assert.ok(flat < 0.3, `décisions sans écart : ${flat}`);
});

test('coach : le style imposé de l’IA simple est remis comme avant, même si la décision lève une erreur', () => {
  const saved: [typeof playerStyle[0], typeof playerStyle[1]] = [playerStyle[0], playerStyle[1]];
  const mine = { ...DEFAULT_STYLE, leaderAggro: 7 };
  playerStyle[0] = mine;
  try {
    const seen: number[] = [];
    const roll = variedRollout((s, d) => {
      seen.push(playerStyle[0]!.leaderAggro, playerStyle[1]!.leaderAggro);
      if (seen.length > 4) throw new Error('essai');
      return d.options[0].id;
    }, 42);
    const s = newGame({ decks: ['ST-35', 'ST-36'], names: ['a', 'b'], seed: 1 });
    roll(s, s.decision!);
    assert.equal(playerStyle[0], mine);
    roll(s, s.decision!);
    assert.throws(() => roll(s, s.decision!), /essai/);
    assert.equal(playerStyle[0], mine);
    assert.equal(playerStyle[1], saved[1]);
    // un style tiré à chaque décision, autour du style imposé, reproductible avec la même graine
    assert.ok(new Set(seen).size > 2);
    const again: number[] = [];
    const roll2 = variedRollout((_s, d) => { again.push(playerStyle[0]!.leaderAggro, playerStyle[1]!.leaderAggro); return d.options[0].id; }, 42);
    roll2(s, s.decision!);
    assert.deepEqual(again, seen.slice(0, 2));
  } finally {
    playerStyle[0] = saved[0];
    playerStyle[1] = saved[1];
  }
});

test('coach : les tirages écartés sont comptés et leur erreur remontée', () => {
  const s = newGame({ decks: ['ST-35', 'ST-36'], names: ['a', 'b'], seed: 3 });
  const a = analyze(s, { samples: 5, rollout: () => { throw new Error('suite impossible'); } });
  assert.equal(a.samples, 0);
  assert.equal(a.failures, 5);
  assert.equal(a.failure, 'suite impossible');
  // sans assez de tirages, l'analyse n'est pas montrée
  const r = toReview({ id: 1, state: s, choice: s.decision!.options[0].id }, a);
  assert.deepEqual(coherentReviews([r]), []);
  assert.ok(MIN_SAMPLES >= 8);
});

test('coach : une erreur candidate est revérifiée par de nouvelles simulations', () => {
  // le coup fatal (coach.test.ts) : terminer son tour au lieu d'attaquer le Leader adverse sans Vie
  const s = scenario(['ST-35', 'ST-35'], (g) => {
    g.players[0].leader.don = 2;
    g.players[0].life = [];
    g.players[0].hand = [];
    g.players[0].chars = [];
    g.players[1].life = [];
    g.players[1].hand = [];
    g.players[1].chars = ['OP12-045', 'OP11-068', 'OP10-101'].map((num, i) => ({ uid: 9100 + i, num, rested: false, don: 0, playedTurn: 0, usedOpt: [] }));
  });
  const opts = { samples: 8, budgetMs: 0, minSamples: 8, refineSamples: 8, refineBudgetMs: 0, refineMin: 8, verifySamples: 16, verifyAbove: MISTAKE };
  const a = coachAnalyze(s, { ...opts, include: 'end' });
  assert.equal(a.verifiedSamples, 16);
  const r = toReview({ id: 1, state: s, choice: 'end' }, a);
  assert.equal(r.verified, 16);
  assert.ok(r.delta >= 0.3, `écart ${r.delta}`);
  // le bon choix n'est pas revérifié
  const lethal = a.best;
  assert.equal(coachAnalyze(s, { ...opts, include: lethal }).verifiedSamples, undefined);
});

// Une analyse synthétique (MoveReview) : id, tour, chances du choix et du meilleur
const rv = (id: number, turn: number, chosenRate: number, bestRate: number, samples = 32): MoveReview => ({
  id, turn, kind: 'main', prompt: '', choice: 'a', choiceLabel: 'a', chosenRate, best: 'b', bestLabel: 'b', bestRate,
  delta: Math.max(0, bestRate - chosenRate), spread: 0, samples, stats: [],
});

test('coach : une « erreur » démentie par la décision suivante du même tour n’est plus signalée', () => {
  const out = coherentReviews([
    rv(1, 3, 0.3, 0.6),   // « erreur » de 30 points...
    rv(2, 3, 0.55, 0.58), // ... mais juste après, dans le même tour, encore 58 % : démentie
    rv(3, 4, 0.2, 0.5),   // erreur suivie d'une décision d'un autre tour : gardée
    rv(4, 5, 0.1, 0.5),   // erreur confirmée : la décision suivante du tour n'a plus que 15 %
    rv(5, 5, 0.15, 0.15),
    rv(6, 6, 0.1, 0.9, 4), // trop peu de tirages : pas montrée
  ]);
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3, 4, 5]);
  const [a, , c, d] = out;
  assert.equal(a.corrected, true);
  assert.equal(a.chosenRate, 0.58);
  assert.ok(a.delta < MISTAKE);
  assert.equal(c.delta, 0.3);
  assert.ok(Math.abs(d.delta - 0.35) < 1e-9);
  assert.deepEqual(coherentReviews(out), out, 'appliquée deux fois, rien ne change');
});

// ---------- IA simple : quelques comportements de référence ----------

test('IA simple : garde une main de départ avec assez de petits Personnages, sinon en change ; suit le style imposé', () => {
  const s = newGame({ decks: ['ST-35', 'ST-36'], names: ['a', 'b'], seed: 11, first: 0 });
  const d = s.decision!;
  const cheap = s.players[0].hand.filter((c) => def(c.num).category === 'CHARACTER' && (def(c.num).cost ?? 0) <= 4).length;
  const saved = playerStyle[0];
  try {
    playerStyle[0] = { ...DEFAULT_STYLE, mulliganCheap: 0 };
    assert.equal(heuristicChooser(s, d), 'keep');
    playerStyle[0] = { ...DEFAULT_STYLE, mulliganCheap: cheap + 1 };
    assert.equal(heuristicChooser(s, d), 'mulligan');
  } finally {
    playerStyle[0] = saved;
  }
  // même situation : même choix (déterministe)
  assert.equal(heuristicChooser(s, d), heuristicChooser(structuredClone(s), structuredClone(d)));
});

test('IA simple : porte le coup fatal au Leader adverse sans Vie, mais pas une attaque trop faible', () => {
  const s = scenario(['ST-35', 'ST-36'], (g) => {
    g.players[1].life = [];
    g.players[1].chars = [];
    g.players[1].hand = [];
    // 4000 + 3000 contre 5000 : l'attaque passe avec l'avance exigée par le style appris de ST-35 (minEdge 1,5). Avec
    // 2 DON!! seulement, elle passerait aussi (aucune Vie, aucun Contre possible) mais l'IA simple finit son tour :
    // minEdge s'applique même au coup fatal (relevé à l'audit, IA non modifiée : elle sert de référence)
    g.players[0].leader.don = 3;
    setDon(g, 0, 0);
  });
  assert.equal(heuristicChooser(s, s.decision!), `attack:${s.players[0].leader.uid}:${s.players[1].leader.uid}`);
  // sans DON!! (4000 contre 5000), l'attaque ne passerait pas : il finit son tour
  const weak = scenario(['ST-35', 'ST-36'], (g) => {
    g.players[1].life = [];
    g.players[1].chars = [];
    g.players[1].hand = [];
    setDon(g, 0, 0);
  });
  assert.equal(heuristicChooser(weak, weak.decision!), 'end');
});

test('IA simple : sa réponse est toujours l’une des options, sur des parties complètes', () => {
  for (const [decks, seed] of [[['ST-32', 'ST-34'], 2], [['META-ROBIN-2026-10', 'ST-01'], 4]] as [[string, string], number][]) {
    let s: GameState = newGame({ decks, names: ['a', 'b'], seed });
    for (let guard = 0; s.winner === null && guard < 3000; guard++) {
      const choice = heuristicChooser(s, s.decision!);
      assert.ok(s.decision!.options.some((o) => o.id === choice), `${choice} : pas une option`);
      s = act(s, choice);
    }
    assert.notEqual(s.winner, null);
  }
});
