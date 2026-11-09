// Intégration de la vague S-3 (chef de projet) : « jusqu'à 1 » du deck vers la Vie (n° 3104), terrain sans Personnage (n° 1902),
// coût payé même si l'effet ne peut rien faire (n° 1000), évènement [Déclenchement], coût réduit lu par « jouez », coût
// « ce Personnage et 1 autre », garde-fous du compilateur. Numéros et valeurs, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heuristicChooser } from '../ai/heuristic.ts';
import { compileRecipe } from '../engine/recipes/compile.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import type { Recipe } from '../engine/recipes/types.ts';
import { act } from '../engine/engine.ts';
import { donOnField, handCost, power } from '../engine/rules.ts';
import type { EffectCtx, GameEvent, GameState, PlayerId } from '../engine/types.ts';
import { playFromHandAtCost } from '../engine/cards/bricks-play.ts';
import { charUid, leaderTyped, leaderUid, list, oppLeaderDon, scene } from './eb-scene.ts';
import { choose, coherent, play, setChars, setDon, setHand, setLife } from './helpers.ts';

const F = 'ST-21';
const OPP = 'ST-36';
const WEAK = 'ST21-005';
const yes = (s: GameState) => choose(s, 'yes');
const no = (s: GameState) => choose(s, 'no');

// ---------- n° 3104 : « jusqu'à 1 » du deck vers la Vie ----------

test('EB04-054 (recette) : « jusqu’à 1 carte du deck à la Vie » : on peut refuser (Q&A d’OP07-119) ; condition fausse : pas de question', () => {
  const me = list(leaderTyped('Straw Hat Crew'), ['EB04-054'], F);
  const start = (life: string[]) => scene([me, OPP], (g) => { setHand(g, 0, ['EB04-054']); setDon(g, 0, 10); setLife(g, 0, life); });
  let s = play(start([WEAK, WEAK]), 'EB04-054');
  assert.equal(s.decision?.tag, 'may');
  assert.equal(no(s).players[0].life.length, 2, 'refus : rien d’ajouté');
  assert.equal(yes(s).players[0].life.length, 3, 'accepté : 1 carte de plus');
  s = play(start([WEAK, WEAK, WEAK]), 'EB04-054');
  assert.notEqual(s.decision?.tag, 'may', '3 Vies : la condition est fausse');
  assert.equal(s.players[0].life.length, 3);
  coherent(s);
});

test('OP06-115 (recette) : [Déclenchement] « vous pouvez ajouter jusqu’à 1 » : une seule question', () => {
  assert.equal(confidence('OP06-115'), 'verified');
});

// ---------- n° 1902 : « les seuls Personnages ... » sans Personnage ----------

test('OP16-022 (Q&A) : sans Personnage, pas de redressement ; {Impel Down} seuls, oui ; un autre type, non', () => {
  assert.equal(confidence('OP16-022'), 'verified');
  const me = list('OP16-022', ['EB01-022'], F);
  const run = (chars: string[]) => {
    const s = scene([me, OPP], (g) => { setChars(g, 0, chars.map((num) => ({ num }))); setDon(g, 0, 0, 4); });
    return act(s, `act:${s.players[0].leader.uid}`);
  };
  assert.equal(run([]).players[0].donActive, 0, 'sans Personnage : rien');
  const impel = scene([me, OPP], (g) => { setChars(g, 0, [{ num: 'EB01-022' }]); setDon(g, 0, 0, 4); });
  assert.equal(act(impel, `act:${impel.players[0].leader.uid}`).players[0].donActive, 2, '{Impel Down} seul : 2 DON!! redressées');
  const mixed = scene([me, OPP], (g) => { setChars(g, 0, [{ num: 'EB01-022' }, { num: WEAK }]); setDon(g, 0, 0, 4); });
  assert.equal(act(mixed, `act:${mixed.players[0].leader.uid}`).players[0].donActive, 0, 'un autre type : rien');
});

test('EB02-010 (Q&A) : sans Personnage, DON!! −2 se paie et rien ne suit, le +1000 non plus ; {Straw Hat Crew} seuls : les deux', () => {
  assert.equal(confidence('EB02-010'), 'verified');
  const me = list('EB02-010', [], F);
  const run = (chars: string[]) => {
    const s = scene([me, OPP], (g) => { setChars(g, 0, chars.map((num) => ({ num }))); setDon(g, 0, 2, 3); });
    const before = donOnField(s, 0);
    const base = power(s, leaderUid(s, 0));
    const t = act(s, `act:${leaderUid(s, 0)}`);
    return { paid: before - donOnField(t, 0), gain: power(t, leaderUid(t, 0)) - base, active: t.players[0].donActive };
  };
  const empty = run([]);
  assert.equal(empty.paid, 2, 'coût payé');
  assert.equal(empty.gain, 0, 'pas de +1000');
  const crew = run(['ST21-012']);
  assert.equal(crew.paid, 2);
  assert.equal(crew.gain, 1000);
});

test('OP13-097 et EB03-038 (Q&A) : le coût se propose, sans Personnage rien ne suit', () => {
  assert.equal(confidence('OP13-097'), 'verified');
  const me = list('OP13-079', ['OP13-097'], F);
  let s = scene([me, OPP], (g) => { setHand(g, 0, ['OP13-097']); setDon(g, 0, 7); setChars(g, 1, [{ num: 'ST36-003' }]); });
  s = play(s, 'OP13-097');
  assert.equal(s.decision?.tag, 'mayIdle');
  s = yes(s);
  assert.equal(s.players[1].chars.length, 1, 'pas de KO');
  coherent(s);
  const m2 = list(leaderTyped('GERMA', true), ['EB03-038'], F);
  let t = scene([m2, OPP], (g) => { setHand(g, 0, ['EB03-038']); setDon(g, 0, 2); oppLeaderDon(g, 3); });
  const don = donOnField(t, 0);
  t = yes(play(t, 'EB03-038'));
  assert.equal(donOnField(t, 0), don, 'aucune DON!! ajoutée sans Personnage');
});

// ---------- n° 1000 : le coût se paie même si l'effet ne peut rien faire ----------

test('recette : coût payable, effet sans cible : question « mayIdle » ; le joueur peut payer ; l’IA refuse', () => {
  const me = list(leaderTyped('Straw Hat Crew'), ['ST13-008'], F);
  const s = scene([me, OPP], (g) => { setHand(g, 0, ['ST13-008']); setDon(g, 0, 10); setLife(g, 0, [WEAK, WEAK]); setChars(g, 1, []); });
  const q = play(s, 'ST13-008');
  assert.equal(q.decision?.tag, 'mayIdle', 'aucune cible');
  assert.equal(heuristicChooser(q, q.decision!), 'no', 'l’IA ne paie pas pour rien');
  const paid = yes(q);
  const paid2 = paid.decision?.options.some((o) => o.id === 'top') ? choose(paid, 'top') : paid;
  assert.equal(paid2.players[0].life.length, 1, 'le joueur paie, rien ne suit');
  // avec une cible : question ordinaire
  const u = scene([me, OPP], (g) => { setHand(g, 0, ['ST13-008']); setDon(g, 0, 10); setLife(g, 0, [WEAK, WEAK]); setChars(g, 1, [{ num: 'ST36-003' }]); });
  assert.equal(play(u, 'ST13-008').decision?.tag, 'may');
});

test('OP05-082 (Q&A) et ST13-007, OP08-101 : l’activation se paie quand l’effet ne peut rien faire', () => {
  const m1 = list('OP13-079', ['OP05-082'], F);
  const a = scene([m1, OPP], (g) => { setChars(g, 0, [{ num: 'OP05-082' }]); g.players[0].trash.push({ uid: 9001, num: WEAK }, { uid: 9002, num: WEAK }); setHand(g, 1, []); });
  assert.ok(a.decision?.options.some((o) => o.id === `act:${charUid(a, 0, 'OP05-082')}`), 'adversaire avec 5 cartes ou moins : proposé');
  const m2 = list(leaderTyped('Navy'), ['OP08-101'], F);
  const b = scene([m2, OPP], (g) => { setChars(g, 0, [{ num: 'OP08-101' }]); setLife(g, 0, [WEAK, WEAK]); });
  const uid = charUid(b, 0, 'OP08-101');
  assert.ok(b.decision?.options.some((o) => o.id === `act:${uid}`), 'autre Leader : le coût se propose');
  const c = act(b, `act:${uid}`);
  assert.equal(c.players[0].life.length, 1, 'coût payé');
  assert.equal(c.delayed?.some((d) => d.action === 'lifeFromDeck') ?? false, false, 'rien ne suit');
});

// ---------- Compilateur ----------

const recipe = (r: Partial<Recipe> & Pick<Recipe, 'abilities'>): Recipe => ({ num: 'OP05-999', ...r });

test('évènement [Déclenchement] : les deux camps (Q&A d’OP05-109) ; byOpponent : l’adversaire seulement', () => {
  const mk = (byOpponent?: boolean) => {
    const c = compileRecipe(recipe({ abilities: [{ timing: 'when', event: { on: 'trigger', ...(byOpponent ? { byOpponent } : {}) }, steps: [{ action: { kind: 'draw', n: 1 } }] }] }));
    assert.ok(c.ok);
    return (c as { behavior: { when?: { if: (s: GameState, o: PlayerId, self: never, e: GameEvent) => boolean }[] } }).behavior.when![0];
  };
  const s = {} as GameState;
  const self = {} as never;
  const ev = (player: PlayerId): GameEvent => ({ type: 'trigger', player });
  assert.equal(mk().if(s, 0, self, ev(0)), true);
  assert.equal(mk().if(s, 0, self, ev(1)), true);
  assert.equal(mk(true).if(s, 0, self, ev(0)), false);
  assert.equal(mk(true).if(s, 0, self, ev(1)), true);
});

test('« jouez un Personnage de coût N ou moins » de la main : coût à payer (Q&A d’OP07-064) ; sans réduction : coût imprimé', () => {
  const brick = playFromHandAtCost({ costMax: 2 }, 'essai');
  const me = list(leaderTyped('Straw Hat Crew'), ['OP07-064'], F);
  // Sanji OP07-064 : réduit avec 2 DON!! ou plus de moins que l'adversaire
  const low = scene([me, OPP], (g) => { setHand(g, 0, ['OP07-064']); setDon(g, 0, 1); oppLeaderDon(g, 3); });
  const high = scene([me, OPP], (g) => { setHand(g, 0, ['OP07-064']); setDon(g, 0, 8); });
  const reduced = handCost(low, 0, low.players[0].hand[0]);
  const printed = handCost(high, 0, high.players[0].hand[0]);
  assert.ok(reduced < printed, 'la carte est réduite');
  assert.equal(playFromHandAtCost({ costMax: reduced }, 'essai').useful(low, 0, -1), true, 'coût réduit lu');
  assert.equal(playFromHandAtCost({ costMax: reduced }, 'essai').useful(high, 0, -1), false, 'coût imprimé sans réduction');
  assert.equal(typeof brick.run, 'function');
});

test('coût « ce Personnage et 1 de vos Personnages » : deux Personnages différents, sinon pas payable (8-3-1-3)', () => {
  const c = compileRecipe(recipe({ abilities: [{ timing: 'onPlay', cost: [{ kind: 'restSelf' }, { kind: 'restOwn', n: 1, what: 'characters' }], steps: [{ action: { kind: 'draw', n: 1 } }] }] }));
  assert.ok(c.ok);
  const ctxOf = (s: GameState, self: number) => ({ s, me: 0, opp: 1, source: self, num: 'OP05-999', ask: () => { throw new Error('question : le coût n’est pas payable'); } }) as unknown as EffectCtx;
  const me = list(leaderTyped('Straw Hat Crew'), [], F);
  const s1 = scene([me, OPP], (g) => setChars(g, 0, [{ num: 'ST21-012' }]));
  const uid = charUid(s1, 0, 'ST21-012');
  const on = (c as { behavior: { onPlay?: (ctx: EffectCtx) => void } }).behavior.onPlay!;
  assert.doesNotThrow(() => on(ctxOf(s1, uid)), 'seul : pas de question');
  const s2 = scene([me, OPP], (g) => setChars(g, 0, [{ num: 'ST21-012' }, { num: 'ST21-015' }]));
  assert.throws(() => on(ctxOf(s2, charUid(s2, 0, 'ST21-012'))), /question/, 'avec un second Personnage : question');
});

test('garde-fous : condition sur des Leaders ; évènement où le Personnage peut être la carte qui sort', () => {
  const lead = compileRecipe(recipe({ abilities: [{ timing: 'onPlay', steps: [{ cond: { kind: 'chars', side: 'opp', cmp: 'ge', n: 1, filter: { category: ['LEADER', 'CHARACTER'], powerMin: 5000 } }, action: { kind: 'draw', n: 1 } }] }] }));
  assert.equal(lead.ok, false);
  const own = compileRecipe({ num: 'ST21-012', abilities: [{ timing: 'when', event: { on: 'koOwnChar' }, steps: [{ action: { kind: 'draw', n: 1 } }] }] });
  assert.equal(own.ok, false, 'un Personnage qui peut être la carte mise KO : à la main (modèle EB01-047)');
  const leader = compileRecipe({ num: 'EB05-010', abilities: [{ timing: 'when', event: { on: 'koOwnChar' }, steps: [{ action: { kind: 'draw', n: 1 } }] }] });
  assert.equal(leader.ok, true, 'un Leader n’est jamais la carte mise KO');
});

test('P-105 : la Vie passe par lifeToHand : sous le Leader ST13-003, carte face visible : pas de DON!! ; sinon, 1 DON!! donnée', () => {
  const luffy = list('ST13-003', ['P-105'], F);
  const base = (faceUp: boolean) => scene([luffy, OPP], (g) => {
    setHand(g, 0, ['P-105']); setDon(g, 0, 8, 2);
    setLife(g, 0, [WEAK, WEAK]);
    g.players[0].life[0].faceUp = faceUp;
  });
  let s = choose(play(base(true), 'P-105'), 'top');
  assert.equal(s.players[0].deck.at(-1)?.num, WEAK, 'au-dessous du deck');
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.decision?.kind, 'main', 'coût non payé : rien ne suit');
  s = choose(play(base(false), 'P-105'), 'top');
  assert.equal(s.players[0].hand.length, 1, 'carte cachée : en main');
  coherent(s);
});

// ---------- n° 1660 : au-dessus ou au-dessous, toutes ensemble ----------

test('OP07-039, ST12-014 (Q&A d’OP01-073) : les 3 cartes regardées vont toutes du même côté, dans l’ordre choisi ; une seule question de côté', () => {
  const me = list('OP16-022', ['ST12-014'], F);
  const base = scene([me, OPP], (g) => { setHand(g, 0, ['ST12-014']); setDon(g, 0, 10); });
  const looked = base.players[0].deck.slice(0, 3).map((c) => c.uid);
  let s = play(base, 'ST12-014');
  assert.ok(s.decision?.options.some((o) => o.id === 'top') && s.decision?.options.some((o) => o.id === 'bottom'));
  assert.equal(s.decision?.cards?.length, 3, 'les 3 cartes dans une seule question');
  const bottom = choose(s, 'bottom');
  const b2 = (() => { let x = bottom; for (let i = 0; i < 6 && x.decision?.inEffect; i++) x = act(x, x.decision.options[0].id); return x; })();
  assert.deepEqual(new Set(b2.players[0].deck.slice(-3).map((c) => c.uid)), new Set(looked), 'les 3 au-dessous');
  s = choose(s, 'top');
  for (let i = 0; i < 6 && s.decision?.inEffect; i++) s = act(s, s.decision.options[0].id);
  assert.deepEqual(new Set(s.players[0].deck.slice(0, 3).map((c) => c.uid)), new Set(looked), 'les 3 au-dessus');
  assert.equal(confidence('OP07-039'), 'verified');
  assert.equal(confidence('ST17-004'), 'verified');
  coherent(s);
});

// ---------- n° 1991 : un retrait payé en coût est un retrait par effet ----------

test('OP07-038 (Leader) : un Personnage placé dans la Défausse pour payer un coût compte (règle 8-1-1, Q&A d’OP16-041) ; coût refusé : rien', () => {
  assert.equal(confidence('OP07-038'), 'coded');
  assert.equal(confidence('OP08-046'), 'coded');
  const me = list('OP07-038', ['OP07-085', 'OP07-012'], F);
  let s = scene([me, OPP], (g) => { setHand(g, 0, ['OP07-085']); setChars(g, 0, [{ num: 'OP07-012' }]); setChars(g, 1, []); setDon(g, 0, 10); });
  s = yes(play(s, 'OP07-085'));
  if (s.decision?.tag === 'trashOwn') s = choose(s, (o) => o.id.startsWith('card:'));
  // le Leader propose de piocher une fois l'effet résolu
  for (let i = 0; i < 6 && s.decision?.inEffect && s.decision.tag !== 'may'; i++) s = act(s, s.decision.options[0].id);
  assert.equal(s.decision?.tag, 'may', 'retrait payé en coût : le Leader réagit');
  coherent(s);
  const refused = no(play(scene([me, OPP], (g) => { setHand(g, 0, ['OP07-085']); setChars(g, 0, [{ num: 'OP07-012' }]); setChars(g, 1, []); setDon(g, 0, 10); }), 'OP07-085'));
  assert.equal(refused.decision?.kind, 'main', 'coût refusé : aucun retrait, pas de question');
});

