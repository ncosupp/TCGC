// Intégration de la vague S-2 (chef de projet) : [Une fois par tour] sur l'attaque adverse quand on refuse (n° 1980),
// Calgara (OP12-099), garde-fous du traducteur (phrases construites ici, aucun texte de carte). Numéros et valeurs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRecipe } from '../engine/recipes/compile.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { parseFilter } from '../engine/recipes/parse/target.ts';
import { act } from '../engine/engine.ts';
import { def, draw, power } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { charUid, leaderUid, list, oppLeaderDon, scene } from './eb-scene.ts';
import { attack, choose, coherent, play, setChars, setDon, setHand } from './helpers.ts';

const F = 'ST-21';
const yes = (s: GameState) => choose(s, 'yes');
const no = (s: GameState) => choose(s, 'no');

// Passe [Bloqueur] et [Contre] et garde les cartes de Vie en main pour le joueur `p`
function pass(s: GameState, p: PlayerId): GameState {
  for (let i = 0; i < 20 && s.decision?.player === p; i++) {
    const d = s.decision;
    if (d.kind === 'blocker') s = choose(s, 'noblock');
    else if (d.kind === 'counter') s = act(s, 'pass');
    else if (d.tag === 'trigger') s = choose(s, 'hand');
    else break;
  }
  return s;
}

const ATTACKERS = ['ST21-012', 'ST21-015', 'ST21-010'];

test('EB05-013 : [Attaque adverse] [Une fois par tour] avec coût : refuser n\'use pas l\'effet, payer l\'use', () => {
  const me = list('OP11-021', ['EB05-013'], F);
  let s = scene([me, F], (g) => {
    setChars(g, 0, [{ num: 'EB05-013' }]);
    setChars(g, 1, ATTACKERS.map((num) => ({ num })));
    setDon(g, 0, 3);
  }, 1);
  const base = def('OP11-021').power!;
  s = attack(s, charUid(s, 1, ATTACKERS[0]), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may', 'proposé à la première attaque');
  s = pass(no(s), 0);
  assert.equal(power(s, leaderUid(s, 0)), base);
  s = attack(s, charUid(s, 1, ATTACKERS[1]), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may', 'encore proposé après un refus');
  s = yes(s);
  assert.equal(power(s, leaderUid(s, 0)), base + 2000);
  s = pass(s, 0);
  s = attack(s, charUid(s, 1, ATTACKERS[2]), leaderUid(s, 0));
  assert.notEqual(s.decision?.tag, 'may', 'utilisé : plus proposé ce tour-ci');
  coherent(s);
});

test('OP17-001 (Leader) : [Attaque adverse] [Une fois par tour] avec coût : refuser n\'use pas l\'effet', () => {
  const me = list('OP17-001', [], F);
  let s = scene([me, F], (g) => {
    setHand(g, 0, ['ST21-012', 'ST21-012']);
    setChars(g, 1, ATTACKERS.map((num) => ({ num })));
  }, 1);
  const base = def('OP17-001').power!;
  s = attack(s, charUid(s, 1, ATTACKERS[0]), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may');
  s = pass(no(s), 0);
  s = attack(s, charUid(s, 1, ATTACKERS[1]), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may', 'encore proposé après un refus');
  s = yes(s);
  while (s.decision?.player === 0 && s.decision.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(power(s, leaderUid(s, 0)), base + 4000);
  coherent(s);
});

test('Calgara (OP12-099) : [Votre tour] pioche à la première carte de Vie perdue, puis plus de pioche par ses effets ce tour-ci', () => {
  assert.equal(confidence('OP12-099'), 'coded');
  const me = list('OP11-021', ['OP12-099'], F);
  const atk = 'ST21-012';
  let s = scene([me, F], (g) => {
    setChars(g, 0, [{ num: 'OP12-099' }, { num: atk, extra: { don: 4 } }, { num: 'ST21-015', extra: { don: 4 } }]);
    setDon(g, 0, 0);
  });
  let life = s.players[1].life.length;
  let hand = s.players[0].hand.length;
  s = pass(attack(s, charUid(s, 0, atk), leaderUid(s, 1)), 1);
  assert.equal(s.players[1].life.length, life - 1);
  assert.equal(s.players[0].hand.length, hand + 1, 'une carte quitte la Vie adverse : pioche');
  assert.equal(s.players[0].noEffectDrawTurn, s.turn);
  hand = s.players[0].hand.length;
  s = pass(attack(s, charUid(s, 0, 'ST21-015'), leaderUid(s, 1)), 1);
  assert.equal(s.players[1].life.length, life - 2);
  assert.equal(s.players[0].hand.length, hand, 'seconde carte : plus de pioche');
  draw(s, 0, 1);
  assert.equal(s.players[0].hand.length, hand, 'aucune pioche par effet ce tour-ci');
  s.turn += 1;
  draw(s, 0, 1);
  assert.equal(s.players[0].hand.length, hand + 1, 'le tour suivant : pioche possible');
  // tour adverse : rien
  s = scene([me, F], (g) => {
    setChars(g, 0, [{ num: 'OP12-099' }]);
    oppLeaderDon(g, 4);
  }, 1);
  life = s.players[0].life.length;
  hand = s.players[0].hand.length;
  s = pass(attack(s, leaderUid(s, 1), leaderUid(s, 0)), 0);
  assert.equal(s.players[0].life.length, life - 1);
  assert.equal(s.players[0].hand.length, hand + 1, 'seule la carte de Vie en main');
  coherent(s);
});

test('Koala (OP12-081) : « peut être activé » : un refus n\'use pas l\'effet', () => {
  const me = list('OP12-081', [], F);
  const opp = list('OP17-001', ['OP17-047'], F);
  let s = scene([me, opp], (g) => { setHand(g, 1, ['OP17-047', 'OP17-047']); setDon(g, 1, 10); }, 1);
  const life = s.players[1].life.length;
  s = play(s, 'OP17-047', 1);
  while (s.decision?.player === 1 && s.decision.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.decision?.tag, 'may');
  s = no(s);
  while (s.decision?.player === 1 && s.decision.inEffect) s = act(s, s.decision.options[0].id);
  assert.equal(s.players[1].life.length, life, 'refusé : la Vie adverse ne bouge pas');
  assert.ok(!s.players[0].leader.usedOpt.includes('koala081'), 'refusé : pas usé');
  coherent(s);
});

test('Ichiji (OP11-043) : « peut être activé » : un refus ne défausse rien et n\'use pas l\'effet', () => {
  const me = list('OP11-001', ['OP11-043'], F);
  let s = scene([me, F], (g) => {
    setChars(g, 0, [{ num: 'OP11-043' }]);
    setChars(g, 1, ATTACKERS.map((num) => ({ num })));
  }, 1);
  const trash = s.players[0].trash.length;
  s = attack(s, charUid(s, 1, ATTACKERS[0]), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may');
  s = no(s);
  assert.equal(s.players[0].trash.length, trash, 'refusé : rien dans la Défausse');
  s = pass(s, 0);
  s = attack(s, charUid(s, 1, ATTACKERS[1]), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may', 'encore proposé après un refus');
  coherent(s);
});

test('Nami (OP11-041) : avec plus de 7 cartes en main, une carte de Vie perdue n\'use pas l\'effet', () => {
  const when = def('OP11-041').when!.find((w) => w.on === 'lifeRemoved')!;
  const s = scene([list('OP11-041', [], F), F], (g) => g.players[0].hand = g.players[0].deck.splice(0, 8));
  const e = { type: 'lifeRemoved' as const, player: 1 as const, count: 1 };
  assert.equal(when.if(s, 0, s.players[0].leader, e), false, '8 cartes en main');
  s.players[0].hand.pop();
  assert.equal(when.if(s, 0, s.players[0].leader, e), true, '7 cartes en main');
});

test('Garde-fous du traducteur : la phrase échoue au lieu d\'être mal lue (S-2)', () => {
  // phrases construites avec des noms inventés
  for (const phrase of [
    '[Zed] or red Event',
    '{Alpha} type card or card with a type including "Beta"',
    'card with a type including "Beta" or [Zed]',
    '{Alpha} type Character card or [Zed]',
    '[Zed] and {Alpha} type Characters',
  ]) assert.throws(() => parseFilter(phrase), `« ${phrase} » doit échouer`);
  // ce qui se lit toujours
  assert.deepEqual(parseFilter('red or green Character').color, ['Red', 'Green']);
  assert.deepEqual(parseFilter('Character with 5000 power or more and a type including "Beta"').typeIncludes, 'Beta');
  assert.ok(parseFilter('[Zed] or {Alpha} type cards').anyOf);
  assert.ok(parseFilter('Event or {Alpha} type Character cards').anyOf);
  assert.deepEqual(parseFilter('{Alpha} or {Gamma} type Character').types, ['Alpha', 'Gamma']);
});

test('Garde-fou du compilateur : « si vous avez [nom d\'un Lieu] » n\'est pas compilé (EB02-033)', () => {
  const recipe = (name: string) => ({
    num: 'EB02-033',
    abilities: [{
      timing: 'static' as const,
      steps: [{
        cond: { kind: 'chars' as const, side: 'own' as const, cmp: 'ge' as const, n: 1, filter: { name: [name] } },
        action: { kind: 'keyword' as const, keyword: 'Blocker' as const, until: 'permanent' as const, target: { side: 'own' as const, zone: 'field' as const, self: true, characters: true, count: 1, upTo: false, filter: {} } },
      }],
    }],
  });
  const stage = compileRecipe(recipe('Merry Go'));
  assert.ok(!stage.ok && stage.missing.some((m) => m.includes('Lieu')), 'nom d\'un Lieu refusé');
  assert.ok(compileRecipe(recipe('Monkey.D.Luffy')).ok, 'nom d\'un Personnage accepté');
  assert.ok(compileRecipe(recipe('Nom inconnu du catalogue')).ok, 'nom inconnu : pas refusé');
});

test('Compilateur : les évènements « une carte quitte la Vie » et « [Déclenchement] activé » sont lus (S-2)', () => {
  const recipe = (on: 'lifeRemoved' | 'trigger') => ({
    num: 'OP12-099',
    abilities: [{ timing: 'when' as const, event: { on }, steps: [{ action: { kind: 'draw' as const, n: 1 } }] }],
  });
  for (const on of ['lifeRemoved', 'trigger'] as const) {
    const r = compileRecipe(recipe(on));
    assert.ok(r.ok && r.behavior.when?.some((w) => w.on === on), `évènement ${on}`);
  }
});
