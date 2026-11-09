// ST10 (tâche S15) : effets que le banc d'essai ne mesure pas, et la recette écrite à la main (ST10-002). Numéros et valeurs seulement.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECKS, type DeckList } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { donOnField, power, returnDon } from '../engine/rules.ts';
import type { GameState } from '../engine/types.ts';
import { attack, choose, coherent, hasOption, setChars, setDon, setHand, setLife } from './helpers.ts';
import { charUid, leaderUid, scene } from './eb-scene.ts';

const C3000 = 'ST21-004';  // coût 1, 3000
let decks = 0;
const deck = (leader: string): DeckList => ({ id: `PERSO-s15t-${decks++}`, name: 'Essai S15', series: 'PERSO', leader, cards: Object.fromEntries([C3000, 'ST21-008', 'OP07-064', 'ST10-007', 'ST10-011', 'ST10-014'].map((n) => [n, 12])) });
const OPP = deck(DECKS['ST-36'].leader);

test('Luffy (ST10-002) : DON!! ajoutée avec 0 ou 8 et plus sur le terrain, rien entre les deux ; une fois par tour', () => {
  const run = (active: number) => {
    let s = scene([deck('ST10-002'), OPP], (g) => { setDon(g, 0, active); g.players[0].donDeck = 10 - active; });
    s = act(s, `act:${leaderUid(s, 0)}`);
    return s;
  };
  assert.equal(donOnField(run(0), 0), 1);
  assert.equal(donOnField(run(8), 0), 9);
  assert.equal(donOnField(run(7), 0), 7);
  const s = run(0);
  assert.equal(s.players[0].donActive, 1, 'redressée');
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`), '[Une fois par tour]');
  coherent(s);
});

test('Kid (ST10-003) : [Votre tour] −1000 avec 4 Vies ou plus ; [En attaquant] DON!! −1 : +2000', () => {
  const setup = (life: number) => (g: GameState) => { setLife(g, 0, Array(life).fill(C3000)); setDon(g, 0, 2); setHand(g, 1, []); };
  let s = scene([deck('ST10-003'), OPP], setup(4));
  const u = leaderUid(s, 0);
  assert.equal(power(s, u), 4000);
  s = scene([deck('ST10-003'), OPP], setup(3));
  assert.equal(power(s, u), 5000);
  s = scene([deck('ST10-003'), OPP], setup(4), 1);
  assert.equal(power(s, u), 5000, 'tour adverse');
  s = scene([deck('ST10-003'), OPP], setup(3));
  s = attack(s, u, leaderUid(s, 1));
  s = choose(s, 'yes');
  assert.equal(donOnField(s, 0), 1);
  assert.ok(s.mods.some((m) => m.uid === u && m.amount === 2000) || s.log.some((l) => l.text.includes('+2000')));
});

test('Killer (ST10-007), Heat (ST10-011), Wire (ST10-014) : DON!! renvoyée ; bon joueur, bon tour, une fois par tour', () => {
  // Heat : à son tour, +2000 jusqu'à la fin du prochain tour adverse, une fois
  let s = scene([deck('ST10-003'), OPP], (g) => { setChars(g, 0, [{ num: 'ST10-011' }]); setDon(g, 0, 4); });
  const heat = charUid(s, 0, 'ST10-011');
  const base = power(s, heat);
  returnDon(s, 0, 1);
  s = act(act(s, `don:${leaderUid(s, 0)}`), `don:${leaderUid(s, 0)}`);
  assert.equal(power(s, heat), base + 2000);
  returnDon(s, 0, 1);
  s = act(s, `don:${leaderUid(s, 0)}`);
  assert.equal(power(s, heat), base + 2000, 'une fois par tour');
  // DON!! de l'adversaire : rien
  s = scene([deck('ST10-003'), OPP], (g) => { setChars(g, 0, [{ num: 'ST10-011' }]); setDon(g, 0, 2); setDon(g, 1, 2); });
  returnDon(s, 1, 1);
  s = act(s, `don:${leaderUid(s, 0)}`);
  assert.equal(power(s, heat), base);
  // Wire : aussi au tour adverse (pas de [Votre tour])
  s = scene([deck('ST10-003'), OPP], (g) => { setChars(g, 0, [{ num: 'ST10-014' }]); setHand(g, 0, [C3000]); setDon(g, 0, 2); }, 1);
  const before = s.players[0].deck.length;
  returnDon(s, 0, 1);
  s = act(s, 'end');
  while (s.decision?.player === 0 && s.decision.inEffect) s = act(s, s.decision.options[0].id);
  assert.ok(s.players[0].deck.length < before, 'pioche');
  // Killer : à son tour, KO d'un épuisé de coût 3 ou moins
  s = scene([deck('ST10-003'), OPP], (g) => { setChars(g, 0, [{ num: 'ST10-007' }]); setChars(g, 1, [{ num: C3000, extra: { rested: true } }]); setDon(g, 0, 3); });
  const t = s.players[1].chars[0].uid;
  returnDon(s, 0, 1);
  s = act(s, `don:${leaderUid(s, 0)}`);
  s = choose(s, `card:${t}`);
  assert.equal(s.players[1].chars.length, 0);
  coherent(s);
});

test('Law (ST10-001) : DON!! −3 : sous le deck et jouer un Personnage de coût 4 ou moins ; coût à payer, réductions comprises (Q&A d’OP07) ; une fois par tour', () => {
  const setup = (mine: number, opp: number, hand: string[]) => (g: GameState) => {
    setDon(g, 0, mine); setDon(g, 1, opp); setHand(g, 0, hand); setChars(g, 1, [{ num: C3000 }, { num: 'ST21-008' }]);
  };
  // Sanji OP07-064 (coût 6, −3 avec 2 DON!! de moins que l'adversaire, DON!! −3 comprises) : jouable
  let s = scene([deck('ST10-001'), OPP], setup(3, 2, ['OP07-064']));
  const law = leaderUid(s, 0);
  const t = s.players[1].chars[0].uid;
  assert.ok(!hasOption(s, `card:${s.players[1].chars[1].uid}`));
  s = act(s, `act:${law}`);
  assert.ok(!s.decision?.options.some((o) => o.uid === s.players[1].chars[1].uid), '6000 : pas une cible');
  s = choose(s, `card:${t}`);
  assert.equal(s.players[1].deck.at(-1)?.uid, t);
  assert.equal(donOnField(s, 0), 0);
  s = choose(s, (o) => o.id.startsWith('card:'));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP07-064'));
  assert.ok(!hasOption(s, `act:${law}`), '[Une fois par tour]');
  coherent(s);
  // même Sanji, autant de DON!! que l'adversaire : coût 6, pas proposé
  s = scene([deck('ST10-001'), OPP], setup(5, 2, ['OP07-064']));
  s = act(s, `act:${law}`);
  s = choose(s, `card:${s.players[1].chars[0].uid}`);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].chars.length, 0);
  // moins de 3 DON!! : pas d'activation
  s = scene([deck('ST10-001'), OPP], setup(2, 2, []));
  assert.ok(!hasOption(s, `act:${law}`));
});
