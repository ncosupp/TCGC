// OP18 (tâche « nouveau set » de l'étape C) : cartes codées à la main, recettes écrites à la main et cas que les tests
// générés ne savent pas vérifier ([Contre] « pendant ce combat », Lieux, effets permanents, remplacements). Chaque effet a un
// cas où la condition est vraie et un cas où elle est fausse. Aucun texte de carte : les tests citent des numéros et des
// valeurs (01-contrats.md § 15.8).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { buildSituation, drive, emptySide, inertPool, maxChooser, type Chooser, type SideSpec } from '../engine/recipes/bench.ts';
import { act, advance } from '../engine/engine.ts';
import { basePower, def, emit, fieldCost, handCost, hasKeyword, power } from '../engine/rules.ts';
import { anyNumber, deckErrors } from '../engine/deckRules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { choose, coherent, play } from './helpers.ts';

const FILL = 'EB05-041';          // Personnage sans effet (coût 2, 4000)
const V3000 = 'EB05-003';         // Personnage sans effet (coût 1, 3000)
const BIG = 'OP17-088';           // Personnage sans effet {Elbaph} (coût 7, 8000)
const STAGE1 = 'OP05-097';        // Lieu de coût 1
const STAGE5 = 'OP18-075';        // Lieu de coût 5 (Thousand Sunny)
const SEA_CAT = 'OP18-003';       // {Animal}{Alabasta} sans effet (coût 5, 6000)
const IGARAM = 'OP18-002';        // {Alabasta} (coût 1, 2000)
const VIVI = 'EB03-001';          // Leader [Nefeltari Vivi]
const leader = () => inertPool().leaders[0];

const side = (lead: string, o: Partial<SideSpec> = {}): SideSpec => ({ ...emptySide(lead), donActive: 10, ...o });
const sit = (a: SideSpec, b: SideSpec, active: PlayerId = 0): GameState => buildSituation({ sides: [a, b], active, filler: [FILL, FILL], seed: 5 });
const uidOf = (s: GameState, p: PlayerId, num: string) => {
  const P = s.players[p];
  const c = [P.leader, ...P.chars, ...(P.stage ? [P.stage] : []), ...P.hand, ...P.trash, ...P.life, ...P.deck].find((x) => x.num === num);
  assert.ok(c, `${num} introuvable`);
  return c.uid;
};
const fieldOf = (s: GameState, p: PlayerId, num: string) => {
  const P = s.players[p];
  const c = [P.leader, ...P.chars, ...(P.stage ? [P.stage] : [])].find((x) => x.num === num);
  assert.ok(c, `${num} absente du terrain`);
  return c;
};
// Répond aux questions de l'effet en cours : `pick` (premier choix utile par défaut ; « oui » aux questions oui / non)
const finish = (s: GameState, pick?: (s: GameState) => string | undefined) => {
  for (let i = 0; i < 60 && s.decision?.inEffect; i++) {
    const d = s.decision;
    const answer = pick?.(s) ?? (d.options.some((o) => o.id === 'yes') ? 'yes' : d.options.find((o) => o.id !== 'none' && o.id !== 'no')?.id ?? d.options[0].id);
    s = act(s, answer);
  }
  return s;
};
// Réponses fixes, dans l'ordre des questions (les identifiants qui n'existent pas sont ignorés : première option)
const answers = (...ids: string[]) => (s: GameState) => {
  const id = ids.shift();
  return id && s.decision?.options.some((o) => o.id === id) ? id : undefined;
};
const hasMod = (s: GameState, uid: number, stat: string, amount?: number) => s.mods.some((m) => m.uid === uid && m.stat === stat && (amount === undefined || m.amount === amount));

// Combat : le joueur 1 attaque (ou le joueur 0), le défenseur ne bloque ni ne contre ; rend la partie à la fin du combat
function fight(s: GameState, attacker: number, target: number): GameState {
  s = act(s, `attack:${attacker}:${target}`);
  for (let i = 0; i < 40 && s.decision && s.decision.kind !== 'main'; i++) {
    const ids = s.decision.options.map((o) => o.id);
    s = act(s, s.decision.inEffect ? (ids.includes('yes') ? 'yes' : ids[0]) : ids.find((id) => id === 'noblock' || id === 'pass') ?? ids[0]);
  }
  return s;
}

// [Contre] joué pendant une attaque du joueur 1 sur le Leader du joueur 0 : puissance gagnée par le Leader (lue au journal :
// le combat est fini quand le banc rend la main)
function counterGain(s: GameState, num: string, chooser: Chooser = maxChooser()): { gain: number; state: GameState; ran: boolean } {
  const r = drive(s, 'counter', uidOf(s, 0, num), chooser, uidOf(s, 1, FILL));
  const gains = r.state.log.filter((l) => /gagne \+\d+ de puissance pour le combat/.test(l.text));
  return { gain: gains.length ? Number(/gagne \+(\d+)/.exec(gains.at(-1)!.text)![1]) : 0, state: r.state, ran: r.ran };
}

test('OP18 : toutes les cartes du set sont jouables', () => {
  const nums = Object.keys(CARDS).filter((n) => n.startsWith('OP18-'));
  assert.ok(nums.length >= 119);
  assert.deepEqual(nums.filter((n) => !['verified', 'coded', 'auto'].includes(confidence(n))), []);
});

// ---------- Recettes écrites à la main ----------

test('OP18-001 (Leader) : ses Personnages {Animal} et {Alabasta} gagnent [Initiative] et +1000 ; un [Alabasta] mis KO : piocher 1 (une fois par tour)', () => {
  let s = sit(side('OP18-001', { chars: [{ num: SEA_CAT }, { num: IGARAM }] }), side(leader()));
  const [cat, igaram] = s.players[0].chars;
  assert.equal(hasKeyword(s, 0, cat, 'Rush'), true);
  assert.equal(power(s, cat.uid), 6000 + 1000);
  assert.equal(hasKeyword(s, 0, igaram, 'Rush'), false);
  assert.equal(power(s, igaram.uid), 2000);
  // un Personnage {Alabasta} épuisé est mis KO par l'attaque adverse : le Leader pioche 1 carte, une seule fois par tour
  s = sit(side('OP18-001', { chars: [{ num: IGARAM, rested: true }, { num: IGARAM, rested: true }] }), side(leader(), { chars: [{ num: BIG }, { num: BIG }] }), 1);
  const hand = s.players[0].hand.length;
  s = fight(s, s.players[1].chars[0].uid, s.players[0].chars[0].uid);
  s = fight(s, s.players[1].chars[1].uid, s.players[0].chars[0].uid);
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(s.players[0].hand.length, hand + 1);
  // un Personnage d'un autre type : rien
  s = sit(side('OP18-001', { chars: [{ num: V3000, rested: true }] }), side(leader(), { chars: [{ num: BIG }] }), 1);
  const h2 = s.players[0].hand.length;
  s = fight(s, s.players[1].chars[0].uid, s.players[0].chars[0].uid);
  assert.equal(s.players[0].hand.length, h2);
  coherent(s);
});

test('OP18-004 : [Initiative] à 5000, [Exil] à 6000, [Imblocable] à 7000 de puissance (DON!! comprises, pendant son tour)', () => {
  const kw = (don: number, active: PlayerId = 0) => {
    const s = sit(side(leader(), { chars: [{ num: 'OP18-004', don }] }), side(leader()), active);
    const c = s.players[0].chars[0];
    return (['Rush', 'Banish', 'Unblockable'] as const).map((k) => hasKeyword(s, 0, c, k));
  };
  assert.deepEqual(kw(0), [false, false, false]);   // 4000
  assert.deepEqual(kw(1), [true, false, false]);    // 5000
  assert.deepEqual(kw(2), [true, true, false]);     // 6000
  assert.deepEqual(kw(3), [true, true, true]);      // 7000
  assert.deepEqual(kw(3, 1), [false, false, false]);   // pendant le tour adverse, les DON!! ne comptent pas
});

test('OP18-005 : +1000 pour chacun de vos [Kung Fu Jugon], pendant votre tour seulement', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP18-005' }, { num: 'OP18-005' }, { num: FILL }] }), side(leader()));
  assert.equal(power(s, s.players[0].chars[0].uid), 0 + 2000);
  s = sit(side(leader(), { chars: [{ num: 'OP18-005' }, { num: 'OP18-005' }] }), side(leader()), 1);
  assert.equal(power(s, s.players[0].chars[0].uid), 0);
});

test('OP18-011 : +1000 aux Personnages {Animal} et {Alabasta} ; [Tour adverse] [Bloqueur] et +6000 pour elle', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP18-011' }, { num: SEA_CAT }, { num: IGARAM }] }), side(leader()));
  const [vivi, cat, igaram] = s.players[0].chars;
  assert.equal(power(s, cat.uid), 7000);
  assert.equal(power(s, igaram.uid), 2000);
  assert.equal(power(s, vivi.uid), 0);
  assert.equal(hasKeyword(s, 0, vivi, 'Blocker'), false);
  s = sit(side(leader(), { chars: [{ num: 'OP18-011' }] }), side(leader()), 1);
  assert.equal(power(s, s.players[0].chars[0].uid), 6000);
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Blocker'), true);
});

test('OP18-012 [En attaquant] : un Personnage {Animal} et {Alabasta} gagne +1000 (pas un {Alabasta} seul)', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP18-012' }, { num: SEA_CAT }, { num: IGARAM }] }), side(leader()));
  let r = drive(s, 'whenAttacking', uidOf(s, 0, 'OP18-012'), (st, d) => (d.options.some((o) => o.id === `card:${uidOf(st, 0, SEA_CAT)}`) ? `card:${uidOf(st, 0, SEA_CAT)}` : maxChooser()(st, d)));
  assert.ok(r.ran, r.reason ?? '');
  const powers = r.state.mods.filter((m) => m.stat === 'power' && m.amount === 1000);
  assert.equal(powers.length, 1);
  assert.equal(powers[0].uid, uidOf(r.state, 0, SEA_CAT));
  // refuser : aucune modification
  s = sit(side(leader(), { chars: [{ num: 'OP18-012' }, { num: SEA_CAT }] }), side(leader()));
  r = drive(s, 'whenAttacking', uidOf(s, 0, 'OP18-012'), maxChooser({ none: true }));
  assert.equal(r.state.mods.filter((m) => m.stat === 'power').length, 0);
});

test('OP18-020 [Contre] : toute sa Vie en main ; avec un Leader [Nefeltari Vivi], −5000 au Leader et aux Personnages adverses', () => {
  const opp = side(leader(), { chars: [{ num: FILL }, { num: FILL }] });
  let s = sit(side(VIVI, { hand: ['OP18-020'], life: [V3000, V3000, V3000] }), opp, 1);
  let r = drive(s, 'counter', uidOf(s, 0, 'OP18-020'), maxChooser(), s.players[1].chars[0].uid);
  assert.ok(r.ran, r.reason ?? '');
  s = r.state;
  assert.equal(s.players[0].life.length, 0);
  assert.equal(s.players[0].hand.filter((c) => c.num === V3000).length, 3);
  assert.ok(hasMod(s, s.players[1].leader.uid, 'power', -5000));
  for (const c of s.players[1].chars) assert.ok(hasMod(s, c.uid, 'power', -5000));
  // un autre Leader : la Vie est quand même payée, aucun effet
  s = sit(side(leader(), { hand: ['OP18-020'], life: [V3000, V3000] }), opp, 1);
  r = drive(s, 'counter', uidOf(s, 0, 'OP18-020'), maxChooser(), s.players[1].chars[0].uid);
  assert.ok(r.ran, r.reason ?? '');
  assert.equal(r.state.players[0].life.length, 0);
  assert.equal(r.state.mods.filter((m) => m.stat === 'power' && m.amount === -5000).length, 0);
  // refuser le coût : rien
  s = sit(side(VIVI, { hand: ['OP18-020'], life: [V3000, V3000] }), opp, 1);
  r = drive(s, 'counter', uidOf(s, 0, 'OP18-020'), maxChooser({ refuse: true }), s.players[1].chars[0].uid);
  assert.equal(r.state.players[0].life.length, 2);
});

test('OP18-091 [En attaquant] : défausser 1 carte pour reprendre un Personnage de coût 2 ou moins de sa Défausse ; coût +12', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP18-091' }], hand: [V3000], trash: [FILL, BIG] }), side(leader()));
  assert.equal(fieldCost(s, s.players[0].chars[0].uid), 4 + 12);
  let r = drive(s, 'whenAttacking', uidOf(s, 0, 'OP18-091'), maxChooser());
  assert.ok(r.ran, r.reason ?? '');
  assert.ok(r.state.players[0].hand.some((c) => c.num === FILL));
  assert.ok(!r.state.players[0].hand.some((c) => c.num === BIG));
  assert.ok(r.state.players[0].trash.some((c) => c.num === V3000));
  // rien de coût 2 ou moins dans la Défausse : le Personnage de coût 7 reste
  s = sit(side(leader(), { chars: [{ num: 'OP18-091' }], hand: [V3000], trash: [BIG] }), side(leader()));
  r = drive(s, 'whenAttacking', uidOf(s, 0, 'OP18-091'), maxChooser());
  assert.ok(!r.state.players[0].hand.some((c) => c.num === BIG));
});

// ---------- Recettes relues : cas hors du banc ----------

test('OP18 [Contre] avec coût ou condition : la carte attaquée est renforcée (059, 096, 116, 074)', () => {
  // 059 : défausser 1 carte ; refusé : rien
  let s = sit(side(leader(), { hand: ['OP18-059', V3000] }), side(leader(), { chars: [{ num: FILL }] }), 1);
  assert.equal(counterGain(s, 'OP18-059').gain, 3000);
  assert.equal(counterGain(s, 'OP18-059', maxChooser({ refuse: true })).gain, 0);
  // 116 : défausser 1 carte
  s = sit(side(leader(), { hand: ['OP18-116', V3000] }), side(leader(), { chars: [{ num: FILL }] }), 1);
  assert.equal(counterGain(s, 'OP18-116').gain, 3000);
  assert.equal(counterGain(s, 'OP18-116', maxChooser({ refuse: true })).gain, 0);
  // 096 : seulement avec 10 cartes ou plus dans la Défausse (l'Événement activé y est déjà, Q&A d'OP04-093 : 9 autres suffisent)
  const ten = Array.from({ length: 9 }, () => V3000);
  s = sit(side(leader(), { hand: ['OP18-096'], trash: ten }), side(leader(), { chars: [{ num: FILL }] }), 1);
  assert.equal(counterGain(s, 'OP18-096').gain, 4000);
  s = sit(side(leader(), { hand: ['OP18-096'], trash: ten.slice(0, 8) }), side(leader(), { chars: [{ num: FILL }] }), 1);
  assert.equal(counterGain(s, 'OP18-096').gain, 0);
  // 074 : seulement avec un Lieu de coût 5 ou plus
  s = sit(side(leader(), { hand: ['OP18-074'], stage: STAGE5 }), side(leader(), { chars: [{ num: FILL }] }), 1);
  assert.equal(counterGain(s, 'OP18-074').gain, 4000);
  s = sit(side(leader(), { hand: ['OP18-074'], stage: STAGE1 }), side(leader(), { chars: [{ num: FILL }] }), 1);
  assert.equal(counterGain(s, 'OP18-074').gain, 0);
  s = sit(side(leader(), { hand: ['OP18-074'] }), side(leader(), { chars: [{ num: FILL }] }), 1);
  assert.equal(counterGain(s, 'OP18-074').gain, 0);
});

test('OP18-074 [Déclenchement] : DON!! −1, puis jusqu\'à 2 Lieux de la Défausse en main', () => {
  let s = sit(side(leader(), { life: ['OP18-074'], trash: [STAGE1, STAGE5, V3000], donActive: 2 }), side(leader(), { chars: [{ num: FILL, don: 3 }] }), 1);
  const r = drive(s, 'trigger', uidOf(s, 0, 'OP18-074'), maxChooser(), uidOf(s, 1, FILL));
  assert.ok(r.ran, r.reason ?? '');
  s = r.state;
  assert.equal(s.players[0].hand.filter((c) => def(c.num).category === 'STAGE').length, 2);
  assert.ok(s.players[0].trash.some((c) => c.num === V3000));
});

// ---------- Lieux ----------

test('OP18-075 (Lieu) : [Jouée] piocher 1 et ajouter 1 DON!! épuisée ; [Activation : Principale] DON!! −2 et s\'épuiser : redresser un {Straw Hat Crew} de 7000 ou moins', () => {
  let s = sit(side(leader(), { hand: [STAGE5], deckTop: [V3000], donActive: 6 }), side(leader()));
  const deck = s.players[0].donDeck;
  s = finish(play(s, STAGE5));
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[0].donDeck, deck - 1);
  // activation : un {Straw Hat Crew} de 5000 est redressé (OP18-017 : 4000), pas un de 8000 de puissance
  s = sit(side(leader(), { stage: STAGE5, chars: [{ num: 'OP18-017', rested: true }, { num: BIG, rested: true }], donActive: 4 }), side(leader()));
  const stage = s.players[0].stage!.uid;
  s = finish(choose(s, `act:${stage}`));
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP18-017')!.rested, false);
  assert.equal(s.players[0].chars.find((c) => c.num === BIG)!.rested, true);
  coherent(s);
  // sans DON!! pour payer (1 seule DON!! sur le terrain) : pas d'activation
  s = sit(side(leader(), { stage: STAGE5, chars: [{ num: 'OP18-017', rested: true }], donActive: 1 }), side(leader()));
  s.players[0].donDeck += s.players[0].donActive + s.players[0].donRested;
  s.players[0].donActive = 1;
  s.players[0].donDeck -= 1;
  assert.equal(CARDS[STAGE5].activateMain?.canActivate?.(s, 0, s.players[0].stage!), false);
});

test('OP18-077 (Lieu) : s\'épuiser pour donner [Initiative : Personnage] à un {Straw Hat Crew} ; rien sans cible', () => {
  let s = sit(side(leader(), { stage: 'OP18-077', chars: [{ num: 'OP18-017' }, { num: FILL }] }), side(leader()));
  s = finish(choose(s, `act:${s.players[0].stage!.uid}`));
  assert.equal(s.players[0].stage!.rested, true);
  assert.ok(s.mods.some((m) => m.stat === 'keyword' && m.keyword === 'Rush: Character' && m.uid === s.players[0].chars.find((c) => c.num === 'OP18-017')!.uid));
  s = sit(side(leader(), { stage: 'OP18-077', chars: [{ num: FILL }] }), side(leader()));
  assert.equal(CARDS['OP18-077'].activateMain?.useful?.(s, 0, s.players[0].stage!), false);
});

test('OP18-076 (Lieu) [Attaque adverse] : s\'épuiser pour +1000 au Leader (5000 ou moins) et à 2 Personnages', () => {
  const attacked = (leaderNum: string) => {
    const s = sit(side(leaderNum, { stage: 'OP18-076', chars: [{ num: FILL }, { num: FILL }, { num: V3000 }] }), side(leader(), { chars: [{ num: FILL }] }), 1);
    return fight0(s, s.players[1].chars[0].uid, s.players[0].leader.uid);
  };
  // les questions de l'effet : oui, puis les cibles
  function fight0(s: GameState, a: number, t: number) {
    s = act(s, `attack:${a}:${t}`);
    for (let i = 0; i < 20 && s.decision?.inEffect; i++) s = act(s, s.decision.options.find((o) => o.id === 'yes')?.id ?? s.decision.options.find((o) => o.id !== 'none')!.id);
    return s;
  }
  let s = attacked(leader());
  const mine = s.mods.filter((m) => m.stat === 'power' && m.amount === 1000);
  assert.equal(mine.length, 3);       // Leader + 2 Personnages
  assert.equal(s.players[0].stage!.rested, true);
  // Leader de plus de 5000 de puissance : seulement les Personnages
  let big = sit(side(leader(), { stage: 'OP18-076', chars: [{ num: FILL }] }), side(leader(), { chars: [{ num: FILL }] }), 1);
  big.mods.push({ uid: big.players[0].leader.uid, stat: 'power', amount: 1000, until: 'turn', source: 'essai' });
  big = fight0(big, big.players[1].chars[0].uid, big.players[0].leader.uid);
  assert.equal(big.mods.filter((m) => m.uid === big.players[0].leader.uid && m.source !== 'essai' && m.stat === 'power').length, 0);
  assert.equal(big.mods.filter((m) => m.stat === 'power' && m.amount === 1000 && m.source !== 'essai').length, 1);
  void s;
});

test('OP18-078 (Lieu) : s\'épuiser pour donner 1 DON!! épuisée à chacun de jusqu\'à 4 Leader ou Personnages', () => {
  let s = sit(side(leader(), { stage: 'OP18-078', chars: [{ num: FILL }, { num: FILL }, { num: FILL }, { num: FILL }], donActive: 0, donRested: 6 }), side(leader()));
  s = finish(choose(s, `act:${s.players[0].stage!.uid}`));
  const given = [s.players[0].leader, ...s.players[0].chars].map((c) => c.don);
  assert.equal(given.reduce((a, b) => a + b, 0), 4);
  assert.ok(given.every((d) => d <= 1));
  assert.equal(s.players[0].donRested, 2);
  // 1 seule DON!! épuisée : 1 seule carte
  s = sit(side(leader(), { stage: 'OP18-078', chars: [{ num: FILL }], donActive: 0, donRested: 1 }), side(leader()));
  s = finish(choose(s, `act:${s.players[0].stage!.uid}`));
  assert.equal([s.players[0].leader, ...s.players[0].chars].reduce((a, c) => a + c.don, 0), 1);
  // aucune DON!! épuisée : l'effet ne sert à rien
  s = sit(side(leader(), { stage: 'OP18-078', chars: [{ num: FILL }], donActive: 2, donRested: 0 }), side(leader()));
  assert.equal(CARDS['OP18-078'].activateMain?.useful?.(s, 0, s.players[0].stage!), false);
});

test('OP18-097 (Lieu) : −1 de coût pour les {Ordre des chevaliers divins} et {Cinq Doyens} de coût 2 ou plus, avec un Leader {Dragon céleste}', () => {
  const s = sit(side('OP18-060', { stage: 'OP18-097', hand: ['OP18-064', 'OP18-084', 'OP18-062'] }), side(leader()));
  const cost = (num: string) => handCost(s, 0, s.players[0].hand.find((c) => c.num === num)!);
  assert.equal(cost('OP18-064'), 5 - 1);          // {Ordre des chevaliers divins}, coût 5
  assert.equal(cost('OP18-084'), 1);              // coût 1 : pas réduit
  assert.equal(cost('OP18-062'), 8);              // {Géant}
  const other = sit(side(leader(), { stage: 'OP18-097', hand: ['OP18-064'] }), side(leader()));
  assert.equal(handCost(other, 0, other.players[0].hand[0]), 5);
  // [Jouée] : piocher 1 carte et placer 2 cartes du dessus du deck dans la Défausse
  let t = sit(side(leader(), { hand: ['OP18-097'], deckTop: [FILL, V3000, V3000] }), side(leader()));
  const deck = t.players[0].deck.length;
  t = finish(play(t, 'OP18-097'));
  assert.equal(t.players[0].deck.length, deck - 3);
  assert.equal(t.players[0].trash.filter((c) => c.num === V3000).length, 2);
});

// ---------- Leaders ----------

test('OP18-021 (Leader) : ses Lieux en main ont Contre +3000 ; DON!! −1 : jouer un Lieu de coût 5 ou moins de sa main', () => {
  // Contre : le Lieu de la main est proposé au Contre (Franky seulement)
  const counterOptions = (lead: string) => {
    let s = sit(side(lead, { hand: [STAGE1] }), side(leader(), { chars: [{ num: BIG }] }), 1);
    s = act(s, `attack:${s.players[1].chars[0].uid}:${s.players[0].leader.uid}`);
    for (let i = 0; i < 10 && s.decision && s.decision.kind !== 'counter'; i++) s = act(s, s.decision.options.find((o) => o.id === 'noblock')?.id ?? s.decision.options[0].id);
    return s.decision?.kind === 'counter' ? s.decision.options.map((o) => o.id) : [];
  };
  assert.ok(counterOptions('OP18-021').some((id) => id.startsWith('counter:')));
  assert.ok(!counterOptions(leader()).some((id) => id.startsWith('counter:')));
  // un Lieu défaussé en Contre donne bien +3000
  let s = sit(side('OP18-021', { hand: [STAGE1] }), side(leader(), { chars: [{ num: BIG }] }), 1);
  const base = power(s, s.players[0].leader.uid);
  s = act(s, `attack:${s.players[1].chars[0].uid}:${s.players[0].leader.uid}`);
  for (let i = 0; i < 10 && s.decision?.kind !== 'counter'; i++) s = act(s, s.decision!.options.find((o) => o.id === 'noblock')?.id ?? s.decision!.options[0].id);
  s = choose(s, 'counter');
  assert.equal(power(s, s.players[0].leader.uid), base + 3000);
  // activation : jouer un Lieu de coût 5 ou moins, une fois par tour, avec DON!! −1
  s = sit(side('OP18-021', { hand: [STAGE5, STAGE1, BIG] }), side(leader()));
  const don = s.players[0].donDeck;
  s = finish(choose(s, `act:${s.players[0].leader.uid}`), answers(`card:${uidOf(s, 0, STAGE1)}`));
  assert.equal(s.players[0].stage?.num, STAGE1);
  assert.ok(s.players[0].hand.some((c) => c.num === BIG), 'un Personnage n’est pas un Lieu');
  assert.equal(s.players[0].donDeck, don + 1);
  assert.equal(s.decision?.options.some((o) => o.id === `act:${s.players[0].leader.uid}`), false, 'une fois par tour');
  // pas de Lieu en main : rien à jouer (mais le coût se propose : l'IA ne le choisit pas)
  s = sit(side('OP18-021', { hand: [BIG] }), side(leader()));
  assert.equal(CARDS['OP18-021'].activateMain?.useful?.(s, 0, s.players[0].leader), false);
});

test('OP18-022 (Leader) [DON!! x3] [En attaquant] : se redresser (une fois par tour), sans se redresser à la prochaine phase de Recharge', () => {
  let s = sit(side('OP18-022', { leaderDon: 3 }), side(leader()));
  s = act(s, `attack:${s.players[0].leader.uid}:${s.players[1].leader.uid}`);
  s = choose(s, 'yes');
  assert.equal(s.players[0].leader.rested, false);
  assert.ok(s.mods.some((m) => m.uid === s.players[0].leader.uid && m.stat === 'noRefresh' && m.until === 7));
  // refusé : le Leader reste épuisé, aucun verrou
  s = sit(side('OP18-022', { leaderDon: 3 }), side(leader()));
  s = act(s, `attack:${s.players[0].leader.uid}:${s.players[1].leader.uid}`);
  s = choose(s, 'no');
  assert.equal(s.players[0].leader.rested, true);
  assert.ok(!s.mods.some((m) => m.stat === 'noRefresh'));
  // moins de 3 DON!! données : rien n'est proposé
  s = sit(side('OP18-022', { leaderDon: 2 }), side(leader()));
  s = act(s, `attack:${s.players[0].leader.uid}:${s.players[1].leader.uid}`);
  assert.notEqual(s.decision?.tag, 'may');
});

test('OP18-060 (Leader) : un Personnage joué de la Défausse fait piocher 2 et défausser 1 ; défausser 1 : 1 DON!! redressée avec un Personnage de 8000 de base', () => {
  // joué de la Défausse par OP18-096 (Je vous fais venir)
  let s = sit(side('OP18-060', { hand: ['OP18-096', V3000], trash: ['OP18-084', V3000], donActive: 4 }), side(leader()));
  const before = s.players[0].hand.length;
  s = finish(play(s, 'OP18-096'), answers('yes', `card:${uidOf(s, 0, 'OP18-084')}`));
  assert.equal(s.players[0].chars.some((c) => c.num === 'OP18-084'), true);
  // main : 1 - 1 (carte jouée) + 2 pioches - 1 défausse
  assert.equal(s.players[0].hand.length, before - 1 + 2 - 1);
  // le même tour, un deuxième Personnage joué de la Défausse ne pioche pas (une fois par tour)
  assert.equal(s.players[0].leader.usedOpt.includes('OP18-060'), true);
  // activation
  s = sit(side('OP18-060', { hand: [V3000], chars: [{ num: BIG }], donActive: 0, donRested: 0 }), side(leader()));
  s.players[0].donDeck = 10;
  s = finish(choose(s, `act:${s.players[0].leader.uid}`));
  assert.equal(s.players[0].donActive, 1);
  s = sit(side('OP18-060', { hand: [V3000], chars: [{ num: FILL }], donActive: 0 }), side(leader()));
  s.players[0].donDeck = 10;
  s = finish(choose(s, `act:${s.players[0].leader.uid}`));
  assert.equal(s.players[0].donActive, 0, 'aucun Personnage de 8000 de puissance de base');
  assert.equal(s.players[0].hand.length, 0, 'la carte est défaussée quand même (coût)');
});

// ---------- Remplacements ----------

const SHC1 = 'OP04-007';          // {Straw Hat Crew} sans effet (coût 1)
const DP2 = 'OP12-111';           // {Donquixote Pirates} sans effet (coût 2)
const BW2 = 'OP18-053';           // « Baroque Works » (coût 2)

// Le joueur 0 joue [Hibari] (EB05-027) pour placer sous le deck le Personnage `victim` du joueur 1 : un effet adverse qui le fait quitter le terrain
function removeVictim(s: GameState, victim: number): GameState {
  s = play(s, 'EB05-027');
  for (let i = 0; i < 10 && s.decision?.tag === 'discard'; i++) s = act(s, s.decision.options[0].id);
  return choose(s, `card:${victim}`);
}
const asksReplace = (s: GameState) => s.decision?.tag === 'replace' && s.decision.player === 1;

test('OP18-017 [Une fois par tour] : un {Alabasta} reste si son Leader reçoit −2000 ; pas pour un autre type', () => {
  const base = () => sit(side(leader(), { hand: ['EB05-027'] }), side(leader(), { chars: [{ num: 'OP18-017' }, { num: IGARAM }, { num: V3000 }] }));
  let s = base();
  s = removeVictim(s, uidOf(s, 1, IGARAM));
  assert.ok(asksReplace(s));
  s = choose(s, (o) => o.id.startsWith('replace:'));
  assert.ok(s.players[1].chars.some((c) => c.num === IGARAM));
  assert.ok(hasMod(s, s.players[1].leader.uid, 'power', -2000));
  assert.equal(s.players[1].chars.find((c) => c.num === 'OP18-017')!.usedOpt.includes('replace'), true);
  coherent(s);
  // refuser : la carte part
  s = base();
  s = removeVictim(s, uidOf(s, 1, IGARAM));
  s = choose(s, 'none');
  assert.ok(!s.players[1].chars.some((c) => c.num === IGARAM));
  // un Personnage d'un autre type : aucun remplacement proposé
  s = base();
  s = removeVictim(s, uidOf(s, 1, V3000));
  assert.ok(!asksReplace(s));
  assert.ok(!s.players[1].chars.some((c) => c.num === V3000));
});

test('OP18-017 [En attaquant] : jusqu\'à 1 Personnage {Alabasta} gagne [Initiative]', () => {
  const s = sit(side(leader(), { chars: [{ num: 'OP18-017' }, { num: IGARAM }, { num: V3000 }] }), side(leader()));
  const r = drive(s, 'whenAttacking', uidOf(s, 0, 'OP18-017'), (st, d) => (d.options.some((o) => o.id === `card:${uidOf(st, 0, IGARAM)}`) ? `card:${uidOf(st, 0, IGARAM)}` : maxChooser()(st, d)));
  assert.ok(r.ran, r.reason ?? '');
  assert.ok(r.state.mods.some((m) => m.stat === 'keyword' && m.keyword === 'Rush' && m.uid === uidOf(r.state, 0, IGARAM)));
  assert.ok(!r.state.mods.some((m) => m.uid === uidOf(r.state, 0, V3000)));
});

test('OP18-026 : un {Straw Hat Crew} reste si Sanji se place dans la Défausse ; pas pour un autre type, ni pour Sanji lui-même', () => {
  const base = () => sit(side(leader(), { hand: ['EB05-027'] }), side(leader(), { chars: [{ num: 'OP18-026' }, { num: SHC1 }, { num: V3000 }] }));
  let s = base();
  s = removeVictim(s, uidOf(s, 1, SHC1));
  assert.ok(asksReplace(s));
  s = choose(s, (o) => o.id.startsWith('replace:'));
  assert.ok(s.players[1].chars.some((c) => c.num === SHC1));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'OP18-026'));
  assert.ok(s.players[1].trash.some((c) => c.num === 'OP18-026'));
  s = base();
  s = removeVictim(s, uidOf(s, 1, V3000));
  assert.ok(!asksReplace(s));
  s = base();
  s = removeVictim(s, uidOf(s, 1, 'OP18-026'));
  assert.ok(!asksReplace(s));
});

test('OP18-031 [Tour adverse] : Robin s\'épuise à la place d\'un Personnage retiré par l\'adversaire ; épuisée, elle ne le peut plus', () => {
  const base = (rested: boolean) => sit(side(leader(), { hand: ['EB05-027'] }), side(leader(), { chars: [{ num: 'OP18-031', rested }, { num: V3000 }] }));
  let s = base(false);
  s = removeVictim(s, uidOf(s, 1, V3000));
  assert.ok(asksReplace(s));
  s = choose(s, (o) => o.id.startsWith('replace:'));
  assert.equal(s.players[1].chars.find((c) => c.num === 'OP18-031')!.rested, true);
  assert.ok(s.players[1].chars.some((c) => c.num === V3000));
  s = base(true);
  s = removeVictim(s, uidOf(s, 1, V3000));
  assert.ok(!asksReplace(s));
});

test('OP18-031 [Fin de votre tour] : redresser une carte {Water Seven} et une DON!!', () => {
  let s = sit(side('OP18-022', { leaderRested: true, chars: [{ num: 'OP18-031' }], donActive: 0, donRested: 3 }), side(leader()));
  let r = drive(s, 'endOfTurn', uidOf(s, 0, 'OP18-031'), maxChooser());
  assert.ok(r.ran, r.reason ?? '');
  assert.equal(r.state.players[0].leader.rested, false);
  assert.equal(r.state.players[0].donActive, 1);
  // aucune carte {Water Seven} épuisée : seule la DON!! est redressée
  s = sit(side(leader(), { leaderRested: true, chars: [{ num: 'OP18-031' }], donActive: 0, donRested: 3 }), side(leader()));
  r = drive(s, 'endOfTurn', uidOf(s, 0, 'OP18-031'), maxChooser());
  assert.equal(r.state.players[0].leader.rested, true);
  assert.equal(r.state.players[0].donActive, 1);
});

test('OP18-054 [Tour adverse] [Une fois par tour] : défausser 1 carte pour garder un Personnage « Baroque Works » ; pas sans carte en main', () => {
  const base = (hand: string[], victim = BW2) => sit(side(leader(), { hand: ['EB05-027'] }), side(leader(), { hand, chars: [{ num: 'OP18-054' }, { num: victim }] }));
  let s = base([V3000]);
  s = removeVictim(s, uidOf(s, 1, BW2));
  assert.ok(asksReplace(s));
  s = finish(choose(s, (o) => o.id.startsWith('replace:')));
  assert.ok(s.players[1].chars.some((c) => c.num === BW2));
  assert.equal(s.players[1].hand.length, 0);
  assert.ok(s.players[1].trash.some((c) => c.num === V3000));
  s = base([]);
  s = removeVictim(s, uidOf(s, 1, BW2));
  assert.ok(!asksReplace(s));
  s = base([V3000], V3000);
  s = removeVictim(s, uidOf(s, 1, V3000));
  assert.ok(!asksReplace(s));
  // [DON!! x1] +1000
  const t = sit(side(leader(), { chars: [{ num: 'OP18-054', don: 1 }] }), side(leader()));
  assert.equal(power(t, t.players[0].chars[0].uid), 3000 + 1000 + 1000);
});

test('OP18-071 : une fois par tour, DON!! −1 garde un {Équipage de Don Quijote} ; [Tour adverse] avec un Leader [Sugar] : [Bloqueur] et +2000', () => {
  const base = (donActive: number) => sit(side(leader(), { hand: ['EB05-027'] }), side(leader(), { chars: [{ num: 'OP18-071' }, { num: DP2 }], donActive }));
  let s = base(3);
  s = removeVictim(s, uidOf(s, 1, DP2));
  assert.ok(asksReplace(s));
  const don = s.players[1].donDeck;
  s = choose(s, (o) => o.id.startsWith('replace:'));
  assert.ok(s.players[1].chars.some((c) => c.num === DP2));
  assert.equal(s.players[1].donDeck, don + 1);
  // aucune DON!! sur le terrain : pas de remplacement
  s = base(0);
  s = removeVictim(s, uidOf(s, 1, DP2));
  assert.ok(!asksReplace(s));
  // effets permanents
  const t = sit(side('OP10-003', { chars: [{ num: 'OP18-071' }] }), side(leader()), 1);
  assert.equal(hasKeyword(t, 0, t.players[0].chars[0], 'Blocker'), true);
  assert.equal(power(t, t.players[0].chars[0].uid), 6000 + 2000);
  const u = sit(side('OP10-003', { chars: [{ num: 'OP18-071' }] }), side(leader()), 0);
  assert.equal(hasKeyword(u, 0, u.players[0].chars[0], 'Blocker'), false);
  assert.equal(power(u, u.players[0].chars[0].uid), 6000);
  const v = sit(side(leader(), { chars: [{ num: 'OP18-071' }] }), side(leader()), 1);
  assert.equal(hasKeyword(v, 0, v.players[0].chars[0], 'Blocker'), false);
});

test('OP18-068 : [Une fois par tour] DON!! −1 à la place de sa mise KO ; [Jouée] DON!! −1 : un Personnage de coût 7 ou moins ne peut pas être épuisé', () => {
  const ko = (donActive: number) => sit(side(leader(), { chars: [{ num: 'OP18-068', rested: true }], donActive }), side(leader(), { chars: [{ num: BIG, don: 2 }, { num: BIG, don: 2 }] }), 1);
  let s = ko(2);
  const don = s.players[0].donDeck;
  s = fight(s, s.players[1].chars[0].uid, s.players[0].chars[0].uid);
  assert.equal(s.players[0].chars.length, 1, 'remplacé par DON!! −1');
  assert.equal(s.players[0].donDeck, don + 1);
  // une seule fois par tour : la seconde attaque le met KO
  s = fight(s, s.players[1].chars[1].uid, s.players[0].chars[0].uid);
  assert.equal(s.players[0].chars.length, 0);
  // sans DON!! sur le terrain
  s = ko(0);
  s = fight(s, s.players[1].chars[0].uid, s.players[0].chars[0].uid);
  assert.equal(s.players[0].chars.length, 0);
  // [Jouée]
  s = sit(side(leader(), { hand: ['OP18-068'], donActive: 10 }), side(leader(), { chars: [{ num: FILL }, { num: 'OP18-068' }] }));
  s = finish(play(s, 'OP18-068'), answers('yes', `card:${uidOf(s, 1, FILL)}`));
  assert.ok(s.mods.some((m) => m.stat === 'cantRest' && m.uid === uidOf(s, 1, FILL)));
  assert.ok(!s.mods.some((m) => m.stat === 'cantRest' && m.uid === uidOf(s, 1, 'OP18-068')), 'coût 8 : pas visé');
});

test('OP18-069 : DON!! −1 et s\'épuiser pour qu\'un {La Franky Family} ne soit pas mis KO ; épuisé, il ne le peut plus', () => {
  const base = (rested: boolean) => sit(side(leader(), { chars: [{ num: 'OP18-069', rested }, { num: 'OP18-063', rested: true }], donActive: 2 }), side(leader(), { chars: [{ num: BIG }] }), 1);
  let s = base(false);
  const don = s.players[0].donDeck;
  s = fight(s, s.players[1].chars[0].uid, s.players[0].chars[1].uid);
  assert.equal(s.players[0].chars.length, 2);
  assert.equal(s.players[0].chars[0].rested, true);
  assert.equal(s.players[0].donDeck, don + 1);
  s = base(true);
  s = fight(s, s.players[1].chars[0].uid, s.players[0].chars[1].uid);
  assert.equal(s.players[0].chars.length, 1);
});

// ---------- Effets [Jouée], [En attaquant], [En cas de KO], [Activation : Principale] ----------

test('OP18-027 : [Tour adverse] la puissance de base d\'un Leader [Monkey.D.Luffy] redressé ayant 3 DON!! devient 7000 ; [Jouée] 2 DON!! redressées et un Personnage de coût 6 ou moins ne peut pas être épuisé', () => {
  const lead = (o: Partial<SideSpec>, active: PlayerId = 1) => {
    const s = sit(side('OP18-022', { chars: [{ num: 'OP18-027' }], ...o }), side(leader()), active);
    return basePower(s, s.players[0].leader.uid);
  };
  assert.equal(lead({ leaderDon: 3 }), 7000);
  assert.equal(lead({ leaderDon: 2 }), 5000);
  assert.equal(lead({ leaderDon: 3, leaderRested: true }), 5000);
  assert.equal(lead({ leaderDon: 3 }, 0), 5000, 'seulement pendant le tour adverse');
  let s = sit(side(leader(), { hand: ['OP18-027'], donActive: 5, donRested: 4 }), side(leader(), { chars: [{ num: FILL }, { num: BIG }] }));
  s = finish(play(s, 'OP18-027'));
  assert.equal(s.players[0].donActive, 2);
  assert.ok(s.mods.some((m) => m.stat === 'cantRest' && m.uid === uidOf(s, 1, FILL)));
  assert.ok(!s.mods.some((m) => m.stat === 'cantRest' && m.uid === uidOf(s, 1, BIG)));
});

test('OP18-029 [En attaquant] : donner jusqu\'à 3 DON!! épuisées au Leader et se redresser, sans se redresser à la prochaine phase de Recharge', () => {
  const s = sit(side(leader(), { chars: [{ num: 'OP18-029' }], donActive: 0, donRested: 5 }), side(leader()));
  const r = drive(s, 'whenAttacking', uidOf(s, 0, 'OP18-029'), maxChooser());
  assert.ok(r.ran, r.reason ?? '');
  assert.equal(r.state.players[0].leader.don, 3);
  assert.equal(r.state.players[0].chars[0].rested, false);
  assert.ok(r.state.mods.some((m) => m.uid === r.state.players[0].chars[0].uid && m.stat === 'noRefresh' && m.until === 7));
  // une fois par tour : la clé est prise
  assert.ok(r.state.players[0].chars[0].usedOpt.includes('OP18-029'));
  // sans DON!! épuisée : il se redresse quand même
  const t = sit(side(leader(), { chars: [{ num: 'OP18-029' }], donActive: 0, donRested: 0 }), side(leader()));
  const r2 = drive(t, 'whenAttacking', uidOf(t, 0, 'OP18-029'), maxChooser());
  assert.equal(r2.state.players[0].leader.don, 0);
  assert.equal(r2.state.players[0].chars[0].rested, false);
});

test('OP18-034 [Jouée] : jouer un Personnage ou un Lieu {Franky Family} / {Straw Hat Crew} de coût 5 ou moins ; avec un Lieu de coût 5 ou plus, épuiser un Personnage adverse de coût 6 ou moins', () => {
  // un Lieu de la main est joué, puis la condition est lue : Lieu de coût 5
  let s = sit(side(leader(), { hand: ['OP18-034', 'OP18-077'] }), side(leader(), { chars: [{ num: FILL }, { num: BIG }] }));
  s = finish(play(s, 'OP18-034'), answers(`card:${uidOf(s, 0, 'OP18-077')}`));
  assert.equal(s.players[0].stage?.num, 'OP18-077');
  assert.equal(s.players[1].chars.find((c) => c.num === FILL)!.rested, true);
  assert.equal(s.players[1].chars.find((c) => c.num === BIG)!.rested, false);
  // un Personnage de coût 2, sans Lieu : rien n'est épuisé
  s = sit(side(leader(), { hand: ['OP18-034', 'OP18-036'] }), side(leader(), { chars: [{ num: FILL }] }));
  s = finish(play(s, 'OP18-034'), answers(`card:${uidOf(s, 0, 'OP18-036')}`));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP18-036'));
  assert.equal(s.players[1].chars[0].rested, false);
  // Lieu de coût 1 sur le terrain : condition fausse
  s = sit(side(leader(), { hand: ['OP18-034'], stage: STAGE1 }), side(leader(), { chars: [{ num: FILL }] }));
  s = finish(play(s, 'OP18-034'));
  assert.equal(s.players[1].chars[0].rested, false);
});

test('OP18-037 [En cas de KO] : épuiser jusqu\'à 1 carte adverse (Leader, Personnage, Lieu ou DON!!)', () => {
  const s = sit(side(leader(), { trash: ['OP18-037'] }), side(leader(), { donActive: 0 }));
  const r = drive(s, 'onKO', uidOf(s, 0, 'OP18-037'), maxChooser());
  assert.ok(r.ran, r.reason ?? '');
  assert.equal(r.state.players[1].leader.rested, true);
  const t = sit(side(leader(), { trash: ['OP18-037'] }), side(leader(), { donActive: 0, leaderRested: true }));
  const r2 = drive(t, 'onKO', uidOf(t, 0, 'OP18-037'), maxChooser());
  assert.equal(r2.state.players[1].leader.rested, true);
  assert.equal(r2.state.players[1].chars.length, 0);
});

test('OP18-039 [Contre] : +2000 à un [Monkey.D.Luffy] ; puis, avec un Leader redressé, piocher 1 carte', () => {
  const state = (leaderRested: boolean, lead = 'OP18-022') => sit(side(lead, { hand: ['OP18-039', V3000], leaderRested }), side(leader(), { chars: [{ num: FILL }] }), 1);
  let r = counterGain(state(false), 'OP18-039');
  assert.equal(r.gain, 2000);
  assert.equal(r.state.players[0].hand.length, 1 + 1);
  r = counterGain(state(true), 'OP18-039');
  assert.equal(r.state.players[0].hand.length, 1, 'Leader épuisé : pas de pioche');
  // aucun [Monkey.D.Luffy] : pas de puissance, mais la pioche reste (Puis)
  r = counterGain(state(false, leader()), 'OP18-039');
  assert.equal(r.gain, 0);
  assert.equal(r.state.players[0].hand.length, 2);
});

test('OP18-046 : [Jouée] piocher 2 et donner jusqu\'à 2 DON!! épuisées à chaque Leader et Personnage ; [Attaque adverse] défausser 1 : base 7000 pour un Leader « Baroque Works »', () => {
  let s = sit(side(leader(), { hand: ['OP18-046'], chars: [{ num: FILL }, { num: FILL }], donActive: 9, donRested: 0 }), side(leader()));
  const hand = s.players[0].hand.length;
  s = finish(play(s, 'OP18-046'));
  assert.equal(s.players[0].hand.length, hand - 1 + 2);
  // 9 DON!! épuisées pour jouer la carte : 2 au Leader, 2 à chacun des 3 Personnages (la carte comprise)
  assert.equal(s.players[0].leader.don, 2);
  assert.deepEqual(s.players[0].chars.map((c) => c.don), [2, 2, 2]);
  // [Attaque adverse]
  const defend = (lead: string) => {
    let t = sit(side(lead, { chars: [{ num: 'OP18-046' }], hand: [V3000] }), side(leader(), { chars: [{ num: FILL }] }), 1);
    t = act(t, `attack:${t.players[1].chars[0].uid}:${t.players[0].leader.uid}`);
    return finish(t);
  };
  let t = defend('OP18-041');
  assert.equal(basePower(t, t.players[0].leader.uid), 7000);
  assert.equal(t.players[0].hand.length, 0);
  t = defend(leader());
  assert.equal(basePower(t, t.players[0].leader.uid), 5000);
});

test('OP18-047 [Jouée] : un Leader {Cross Guild} ou « Baroque Works » gagne [Imblocable] ; pas un autre', () => {
  for (const [lead, wanted] of [['OP18-041', true], ['OP09-042', true], [leader(), false]] as const) {
    const s = sit(side(lead, { hand: ['OP18-047'] }), side(leader()));
    const t = finish(play(s, 'OP18-047'));
    assert.equal(hasKeyword(t, 0, t.players[0].leader, 'Unblockable'), wanted, lead);
  }
});

test('OP18-051 [Jouée] : épuiser 5 DON!! pour placer sous le deck un Personnage de coût 6 ou moins et un autre de coût 5 ou moins', () => {
  let s = sit(side(leader(), { hand: ['OP18-051'], chars: [{ num: V3000 }] }), side(leader(), { chars: [{ num: FILL }, { num: BIG }] }));
  s = finish(play(s, 'OP18-051'), answers('yes', `card:${uidOf(s, 1, FILL)}`, `card:${uidOf(s, 0, V3000)}`));
  assert.ok(!s.players[1].chars.some((c) => c.num === FILL));
  assert.ok(!s.players[0].chars.some((c) => c.num === V3000));
  assert.ok(s.players[1].chars.some((c) => c.num === BIG));
  assert.equal(s.players[1].deck.at(-1)!.num, FILL);
  assert.equal(s.players[0].donRested, 2 + 5);
  coherent(s);
  // les deux d'un même propriétaire : il choisit l'ordre
  s = sit(side(leader(), { hand: ['OP18-051'] }), side(leader(), { chars: [{ num: FILL }, { num: V3000 }] }));
  s = finish(play(s, 'OP18-051'), answers('yes', `card:${uidOf(s, 1, FILL)}`, `card:${uidOf(s, 1, V3000)}`));
  assert.equal(s.players[1].chars.length, 0);
  assert.deepEqual(s.players[1].deck.slice(-2).map((c) => c.num).sort(), [FILL, V3000].sort());
  // aucun Personnage de coût 6 ou moins : l'effet ne sert à rien
  s = sit(side(leader(), { hand: ['OP18-051'] }), side(leader(), { chars: [{ num: BIG }] }));
  s = finish(play(s, 'OP18-051'), answers('no'));
  assert.equal(s.players[1].chars.length, 1);
});

test('OP18-056 [Jouée] : placer un autre Personnage « Baroque Works » sous son deck : l\'adversaire défausse 1 carte', () => {
  let s = sit(side(leader(), { hand: ['OP18-056'], chars: [{ num: BW2 }] }), side(leader(), { hand: [V3000, V3000] }));
  s = finish(play(s, 'OP18-056'));
  assert.ok(!s.players[0].chars.some((c) => c.num === BW2));
  assert.equal(s.players[1].hand.length, 1);
  // aucun autre Personnage « Baroque Works » (elle ne peut pas se payer elle-même)
  s = sit(side(leader(), { hand: ['OP18-056'], chars: [{ num: V3000 }] }), side(leader(), { hand: [V3000, V3000] }));
  s = finish(play(s, 'OP18-056'));
  assert.equal(s.players[1].hand.length, 2);
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP18-056'));
});

test('OP18-063 : mettre KO son Lieu de coût 5 ou moins pour ajouter 1 DON!! épuisée ; sans Lieu, rien', () => {
  let s = sit(side(leader(), { hand: ['OP18-063'], stage: STAGE1, donActive: 5 }), side(leader()));
  const don = s.players[0].donRested;
  s = finish(play(s, 'OP18-063'));
  assert.equal(s.players[0].stage, null);
  assert.ok(s.players[0].trash.some((c) => c.num === STAGE1));
  assert.equal(s.players[0].donRested, don + 3 + 1);
  s = sit(side(leader(), { hand: ['OP18-063'], donActive: 5 }), side(leader()));
  s = finish(play(s, 'OP18-063'));
  assert.equal(s.players[0].donRested, 3);
});

test('OP18-064 : [Votre tour] [Jouée] DON!! −1 : deux Personnages adverses (5000 et 7000 de base) ne peuvent pas attaquer ; [En cas de KO] DON!! −1 : se rejouer', () => {
  let s = sit(side(leader(), { hand: ['OP18-064'], donActive: 6 }), side(leader(), { chars: [{ num: FILL }, { num: V3000 }, { num: BIG }] }));
  s = finish(play(s, 'OP18-064'), answers('yes', `card:${uidOf(s, 1, FILL)}`, `card:${uidOf(s, 1, V3000)}`));
  assert.ok(hasMod(s, uidOf(s, 1, FILL), 'cantAttack'));
  assert.ok(hasMod(s, uidOf(s, 1, V3000), 'cantAttack'));
  assert.ok(!hasMod(s, uidOf(s, 1, BIG), 'cantAttack'), '8000 de puissance de base');
  // refuser le coût : rien
  s = sit(side(leader(), { hand: ['OP18-064'], donActive: 6 }), side(leader(), { chars: [{ num: FILL }] }));
  s = finish(play(s, 'OP18-064'), answers('no'));
  assert.equal(s.mods.filter((m) => m.stat === 'cantAttack').length, 0);
  // [En cas de KO]
  const d = sit(side(leader(), { trash: ['OP18-064'], donActive: 2 }), side(leader()));
  const r = drive(d, 'onKO', uidOf(d, 0, 'OP18-064'), maxChooser());
  assert.ok(r.ran, r.reason ?? '');
  assert.ok(r.state.players[0].chars.some((c) => c.num === 'OP18-064'));
  const none = sit(side(leader(), { trash: ['OP18-064'], donActive: 0 }), side(leader()));
  const r2 = drive(none, 'onKO', uidOf(none, 0, 'OP18-064'), maxChooser());
  assert.ok(!r2.state.players[0].chars.some((c) => c.num === 'OP18-064'));
});

test('OP18-066 : mettre KO son Lieu de coût 5 ou moins pour gagner [Initiative] ; sans Lieu, pas d\'activation', () => {
  let s = sit(side(leader(), { stage: STAGE1, chars: [{ num: 'OP18-066' }] }), side(leader()));
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP18-066')}`));
  assert.equal(s.players[0].stage, null);
  assert.ok(s.mods.some((m) => m.stat === 'keyword' && m.keyword === 'Rush' && m.uid === uidOf(s, 0, 'OP18-066')));
  s = sit(side(leader(), { chars: [{ num: 'OP18-066' }] }), side(leader()));
  assert.equal(s.decision?.options.some((o) => o.id.startsWith('act:')), false);
});

test('OP18-072 : mettre KO son Lieu pour −3000 à un Personnage adverse, si elle a été jouée ce tour', () => {
  const base = (playedTurn: number) => {
    const s = sit(side(leader(), { stage: STAGE1, chars: [{ num: 'OP18-072' }] }), side(leader(), { chars: [{ num: FILL }] }));
    s.players[0].chars[0].playedTurn = playedTurn;
    return s;
  };
  let s = base(5);
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP18-072')}`));
  assert.equal(s.players[0].stage, null);
  assert.ok(hasMod(s, uidOf(s, 1, FILL), 'power', -3000));
  s = base(2);
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP18-072')}`));
  assert.equal(s.players[0].stage, null, 'le coût est payé');
  assert.ok(!hasMod(s, uidOf(s, 1, FILL), 'power'));
});

test('OP18-080 [Votre tour] [Une fois par tour] : une carte défaussée par l\'effet de son Leader [Marshall.D.Teach] fait piocher 1 carte, sans autre [Van Augur] ; [En cas de KO] piocher 1', () => {
  const TEACH = 'OP09-081';
  const discarded = (s: GameState, sourceNum = TEACH) => {
    s.decision = null;
    emit(s, { type: 'discard', player: 0, count: 1, by: 0, sourceNum });
    return advance(s);
  };
  let s = sit(side(TEACH, { chars: [{ num: 'OP18-080' }] }), side(leader()));
  const hand = s.players[0].hand.length;
  s = discarded(s);
  assert.equal(s.players[0].hand.length, hand + 1);
  s = discarded(s);
  assert.equal(s.players[0].hand.length, hand + 1, 'une fois par tour');
  // un autre [Van Augur] sur le terrain
  s = sit(side(TEACH, { chars: [{ num: 'OP18-080' }, { num: 'OP18-080' }] }), side(leader()));
  const h2 = s.players[0].hand.length;
  s = discarded(s);
  assert.equal(s.players[0].hand.length, h2);
  // l'effet d'une autre carte que le Leader [Marshall.D.Teach]
  s = sit(side(TEACH, { chars: [{ num: 'OP18-080' }] }), side(leader()));
  const h3 = s.players[0].hand.length;
  s = discarded(s, FILL);
  assert.equal(s.players[0].hand.length, h3);
  // un Leader qui n'est pas [Marshall.D.Teach]
  s = sit(side(leader(), { chars: [{ num: 'OP18-080' }] }), side(leader()));
  const h4 = s.players[0].hand.length;
  s = discarded(s, leader());
  assert.equal(s.players[0].hand.length, h4);
  // pendant le tour adverse
  s = sit(side(TEACH, { chars: [{ num: 'OP18-080' }] }), side(leader()), 1);
  const h5 = s.players[0].hand.length;
  s = discarded(s);
  assert.equal(s.players[0].hand.length, h5);
  // [En cas de KO]
  const t = sit(side(leader(), { trash: ['OP18-080'] }), side(leader()));
  const r = drive(t, 'onKO', uidOf(t, 0, 'OP18-080'), maxChooser());
  assert.equal(r.state.players[0].hand.length, t.players[0].hand.length + 1);
});

test('OP18-081 : avec un [Gecko Moria], [Double attaque] et [Bloqueur] ; [Déclenchement] jouer un {Équipage de Thriller Bark} de coût 4 ou moins de la Défausse, épuisé', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP18-081' }, { num: 'OP02-054' }] }), side(leader()));
  const oz = s.players[0].chars[0];
  assert.equal(hasKeyword(s, 0, oz, 'Double Attack'), true);
  assert.equal(hasKeyword(s, 0, oz, 'Blocker'), true);
  s = sit(side(leader(), { chars: [{ num: 'OP18-081' }, { num: FILL }] }), side(leader()));
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Double Attack'), false);
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Blocker'), false);
  s = sit(side(leader(), { life: ['OP18-081'], trash: ['ST12-005', BIG] }), side(leader(), { chars: [{ num: FILL, don: 2 }] }), 1);
  const r = drive(s, 'trigger', uidOf(s, 0, 'OP18-081'), maxChooser(), uidOf(s, 1, FILL));
  assert.ok(r.ran, r.reason ?? '');
  const played = r.state.players[0].chars.find((c) => c.num === 'ST12-005');
  assert.ok(played);
  assert.equal(played.rested, true);
  assert.ok(!r.state.players[0].chars.some((c) => c.num === BIG));
});

test('OP18-082 : [En attaquant] sa puissance de base devient celle du Leader adverse ; [En cas de KO] défausser 1 carte : avec un Leader {Équipage de Barbe Noire}, se rejouer épuisée', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP18-082' }] }), side(leader()));
  s.mods.push({ uid: s.players[1].leader.uid, stat: 'power', amount: 3000, until: 'turn', source: 'essai' });
  let r = drive(s, 'whenAttacking', uidOf(s, 0, 'OP18-082'), maxChooser());
  assert.ok(r.ran, r.reason ?? '');
  assert.equal(basePower(r.state, uidOf(r.state, 0, 'OP18-082')), 8000);
  s = sit(side(leader(), { trash: ['OP18-082'], hand: [V3000] }), side(leader()));
  const play = (lead: string, hand: string[], chooser = maxChooser()) => {
    const t = sit(side(lead, { trash: ['OP18-082'], hand }), side(leader()));
    return drive(t, 'onKO', uidOf(t, 0, 'OP18-082'), chooser);
  };
  r = play('OP09-081', [V3000]);
  const back = r.state.players[0].chars.find((c) => c.num === 'OP18-082');
  assert.ok(back);
  assert.equal(back.rested, true);
  assert.equal(r.state.players[0].hand.length, 0);
  r = play(leader(), [V3000]);
  assert.ok(!r.state.players[0].chars.some((c) => c.num === 'OP18-082'), 'Leader d\'un autre type');
  assert.equal(r.state.players[0].hand.length, 0, 'la carte est défaussée quand même');
  r = play('OP09-081', [V3000], maxChooser({ refuse: true }));
  assert.ok(!r.state.players[0].chars.some((c) => c.num === 'OP18-082'));
  assert.equal(r.state.players[0].hand.length, 1);
  r = play('OP09-081', []);
  assert.ok(!r.state.players[0].chars.some((c) => c.num === 'OP18-082'));
});

test('OP18-083, OP18-088, OP18-119 [En cas de KO] : défausser des cartes pour se rejouer depuis la Défausse', () => {
  for (const [num, cost] of [['OP18-083', 2], ['OP18-088', 2], ['OP18-119', 1]] as const) {
    const hand = Array.from({ length: cost }, () => V3000);
    let s = sit(side(leader(), { trash: [num], hand }), side(leader()));
    let r = drive(s, 'onKO', uidOf(s, 0, num), maxChooser());
    assert.ok(r.ran, r.reason ?? '');
    assert.ok(r.state.players[0].chars.some((c) => c.num === num), num);
    assert.equal(r.state.players[0].hand.length, 0, num);
    // pas assez de cartes en main : le coût ne se paie pas
    s = sit(side(leader(), { trash: [num], hand: hand.slice(1) }), side(leader()));
    r = drive(s, 'onKO', uidOf(s, 0, num), maxChooser());
    assert.ok(!r.state.players[0].chars.some((c) => c.num === num), num);
  }
});

test('OP18-083 [Votre tour] [Jouée] : jouer un [Sleeptids] de sa Défausse ; OP18-088 [Jouée] : mettre KO un Personnage adverse de coût de base 4 ou moins', () => {
  let s = sit(side(leader(), { hand: ['OP18-083'], trash: ['OP18-093'] }), side(leader()));
  s = finish(play(s, 'OP18-083'));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP18-093'));
  s = sit(side(leader(), { hand: ['OP18-083'], trash: [BIG] }), side(leader()));
  s = finish(play(s, 'OP18-083'));
  assert.ok(!s.players[0].chars.some((c) => c.num === BIG));
  s = sit(side(leader(), { hand: ['OP18-088'] }), side(leader(), { chars: [{ num: FILL }, { num: BIG }] }));
  s = finish(play(s, 'OP18-088'));
  assert.ok(s.players[1].trash.some((c) => c.num === FILL));
  assert.ok(s.players[1].chars.some((c) => c.num === BIG));
  // le coût de base compte : +3 de coût ne protège pas un Personnage de coût de base 2
  s = sit(side(leader(), { hand: ['OP18-088'] }), side(leader(), { chars: [{ num: FILL }] }));
  s.mods.push({ uid: s.players[1].chars[0].uid, stat: 'cost', amount: 3, until: 'turn', source: 'essai' });
  s = finish(play(s, 'OP18-088'));
  assert.equal(s.players[1].chars.length, 0);
});

test('OP18-085 : renvoyer en main pour donner [Initiative], [Exil] ou [Imblocable] à un [Saint Shamrock]', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP18-085' }, { num: 'OP18-119' }] }), side(leader()));
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP18-085')}`), answers(`card:${uidOf(s, 0, 'OP18-119')}`, 'choice:Banish'));
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP18-085'));
  assert.ok(s.mods.some((m) => m.stat === 'keyword' && m.keyword === 'Banish' && m.uid === uidOf(s, 0, 'OP18-119')));
  s = sit(side(leader(), { chars: [{ num: 'OP18-085' }, { num: 'OP18-119' }] }), side(leader()));
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP18-085')}`), answers(`card:${uidOf(s, 0, 'OP18-119')}`, 'choice:Unblockable'));
  assert.ok(s.mods.some((m) => m.stat === 'keyword' && m.keyword === 'Unblockable'));
  // aucun [Saint Shamrock] : l'effet ne sert à rien
  s = sit(side(leader(), { chars: [{ num: 'OP18-085' }, { num: FILL }] }), side(leader()));
  assert.equal(CARDS['OP18-085'].activateMain?.useful?.(s, 0, s.players[0].chars[0]), false);
});

test('OP18-093 : autant d\'exemplaires que l\'on veut dans le deck (comme OP01-075) ; [Bloqueur]', () => {
  assert.equal(anyNumber(CARDS['OP18-093']), true);
  assert.equal(anyNumber(CARDS['OP18-098']), false);
  assert.deepEqual(CARDS['OP18-093'].keywords, ['Blocker']);
  const errors = (n: number) => deckErrors('OP18-079', { 'OP18-093': n }).filter((e) => e.includes('exemplaires'));
  assert.deepEqual(errors(8), []);
  assert.equal(deckErrors('OP18-079', { 'OP18-098': 8 }).filter((e) => e.includes('exemplaires')).length, 1);
});

test('OP18-099 [Jouée] : une carte {CP} de sa main face visible au-dessus ou au-dessous de sa Vie ; [Déclenchement] avec un Leader {CP}, piocher 1 et placer un Personnage de coût 8 ou moins sous son deck', () => {
  let s = sit(side(leader(), { hand: ['OP18-099', 'OP18-109'] }), side(leader()));
  s = finish(play(s, 'OP18-099'), answers(`card:${uidOf(s, 0, 'OP18-109')}`, 'top'));
  assert.equal(s.players[0].life[0].num, 'OP18-109');
  assert.equal(s.players[0].life[0].faceUp, true);
  s = sit(side(leader(), { hand: ['OP18-099', 'OP18-109'], life: [V3000] }), side(leader()));
  s = finish(play(s, 'OP18-099'), answers(`card:${uidOf(s, 0, 'OP18-109')}`, 'bottom'));
  assert.equal(s.players[0].life.at(-1)!.num, 'OP18-109');
  assert.equal(s.players[0].life.length, 2);
  coherent(s);
  // aucune carte {CP} en main : rien
  s = sit(side(leader(), { hand: ['OP18-099', V3000] }), side(leader()));
  s = finish(play(s, 'OP18-099'));
  assert.equal(s.players[0].life.length, 0);
  // [Déclenchement]
  const trig = (lead: string) => {
    const t = sit(side(lead, { life: ['OP18-099'] }), side(leader(), { chars: [{ num: FILL, don: 2 }, { num: BIG }] }), 1);
    return drive(t, 'trigger', uidOf(t, 0, 'OP18-099'), maxChooser(), uidOf(t, 1, FILL));
  };
  let r = trig('OP18-079');
  assert.ok(r.ran, r.reason ?? '');
  assert.equal(r.state.players[0].hand.length, 1);   // une pioche ; la carte de Vie révélée va dans la Défausse
  assert.equal(r.state.players[1].chars.length, 1);
  r = trig(leader());
  assert.equal(r.state.players[1].chars.length, 2);
});

test('OP18-100 [Jouée] : piocher 1 carte, puis une carte {CP} face visible dans sa Vie ; [Déclenchement] avec un Leader {CP}, piocher 1 et épuiser un Leader ou Personnage adverse', () => {
  let s = sit(side(leader(), { hand: ['OP18-100', 'OP18-109'], deckTop: [V3000] }), side(leader()));
  s = finish(play(s, 'OP18-100'), answers(`card:${uidOf(s, 0, 'OP18-109')}`, 'top'));
  assert.equal(s.players[0].life[0].num, 'OP18-109');
  assert.ok(s.players[0].hand.some((c) => c.num === V3000));
  // la carte {CP} piochée peut elle-même être placée dans la Vie (« Puis »)
  s = sit(side(leader(), { hand: ['OP18-100'], deckTop: ['OP18-109'] }), side(leader()));
  s = finish(play(s, 'OP18-100'), answers(`card:${uidOf(s, 0, 'OP18-109')}`, 'top'));
  assert.equal(s.players[0].life[0].num, 'OP18-109');
  const trig = (lead: string) => {
    const t = sit(side(lead, { life: ['OP18-100'] }), side(leader(), { chars: [{ num: FILL, don: 2 }] }), 1);
    return drive(t, 'trigger', uidOf(t, 0, 'OP18-100'), maxChooser(), uidOf(t, 1, FILL));
  };
  let r = trig('OP18-079');
  assert.ok(r.ran, r.reason ?? '');
  assert.ok(r.state.players[1].leader.rested || r.state.players[1].chars.some((c) => c.rested));
  r = trig(leader());
  assert.ok(!r.state.players[1].leader.rested);
});

test('OP18-101, OP18-109 [Déclenchement] : avec un Leader {CP}, mettre KO ou épuiser un Personnage adverse de coût 6 ou moins (au choix) ; OP18-101 [En cas de KO] : une carte {CP} dans sa Vie', () => {
  for (const num of ['OP18-101', 'OP18-109']) {
    for (const [branch, gone] of [[0, true], [1, false]] as const) {
      const t = sit(side('OP18-079', { life: [num] }), side(leader(), { chars: [{ num: BIG }, { num: FILL }] }), 1);
      const r = drive(t, 'trigger', uidOf(t, 0, num), maxChooser({ branch }), uidOf(t, 1, BIG));
      assert.ok(r.ran, r.reason ?? '');
      const fill = r.state.players[1].chars.find((c) => c.num === FILL);
      assert.equal(fill === undefined, gone, `${num} branche ${branch}`);
      if (fill) assert.equal(fill.rested, true);
      assert.ok(r.state.players[1].chars.some((c) => c.num === BIG), 'coût 7 : pas visé');
    }
    const t = sit(side(leader(), { life: [num] }), side(leader(), { chars: [{ num: FILL }, { num: BIG }] }), 1);
    const r = drive(t, 'trigger', uidOf(t, 0, num), maxChooser(), uidOf(t, 1, BIG));
    assert.equal(r.state.players[1].chars.find((c) => c.num === FILL)?.rested ?? false, false, 'Leader non {CP}');
  }
  const k = sit(side(leader(), { trash: ['OP18-101'], hand: ['OP18-109'] }), side(leader()));
  const r = drive(k, 'onKO', uidOf(k, 0, 'OP18-101'), maxChooser());
  assert.ok(r.ran, r.reason ?? '');
  assert.equal(r.state.players[0].life[0].num, 'OP18-109');
  assert.equal(r.state.players[0].life[0].faceUp, true);
});

test('OP18-105 [Déclenchement] : avec un Leader {CP}, révéler une carte {CP} (autre que [Spandam]) de sa main et activer son [Déclenchement]', () => {
  const trig = (lead: string, hand: string[]) => {
    const t = sit(side(lead, { life: ['OP18-105'], hand }), side(leader(), { chars: [{ num: FILL, don: 2 }, { num: BIG }] }), 1);
    return drive(t, 'trigger', uidOf(t, 0, 'OP18-105'), maxChooser(), uidOf(t, 1, FILL));
  };
  let r = trig('OP18-079', ['OP18-099', V3000]);
  assert.ok(r.ran, r.reason ?? '');
  // le [Déclenchement] d'OP18-099 : piocher 1 carte, placer un Personnage sous son deck ; la carte reste en main
  assert.equal(r.state.players[0].hand.filter((c) => c.num === 'OP18-099').length, 1);
  assert.equal(r.state.players[0].hand.length, 2 + 1);   // la carte révélée reste en main, plus la pioche de son [Déclenchement]
  assert.equal(r.state.players[1].chars.length, 1);
  // une carte {CP} sans [Déclenchement], ou un autre Leader : rien
  r = trig('OP18-079', [V3000]);
  assert.equal(r.state.players[1].chars.length, 2);
  r = trig(leader(), ['OP18-099']);
  assert.equal(r.state.players[1].chars.length, 2);
});

test('OP18-117 : toute sa Vie dans la Défausse : avec un Leader [Spandam], tous les Personnages dans la Défausse, jusqu\'à 5 {Vice-amiral} de noms différents', () => {
  const setup = (lead: string) => sit(
    side(lead, { hand: ['OP18-117'], life: [V3000, V3000], chars: [{ num: FILL }], trash: ['OP18-098', 'OP18-098', 'OP18-104'], deckTop: ['OP18-106'] }),
    side(leader(), { chars: [{ num: BIG }] }),
  );
  let s = setup('OP18-079');
  s = finish(play(s, 'OP18-117'));
  assert.equal(s.players[0].life.length, 0);
  assert.equal(s.players[1].chars.some((c) => c.num === BIG), false);
  assert.equal(s.players[1].trash.some((c) => c.num === BIG), true);
  assert.equal(s.players[0].chars.some((c) => c.num === FILL), false);
  assert.deepEqual(s.players[0].chars.map((c) => c.num).sort(), ['OP18-098', 'OP18-104', 'OP18-106']);
  assert.equal(s.players[0].trash.filter((c) => c.num === 'OP18-098').length, 1, 'un seul [Onigumo] : noms différents');
  coherent(s);
  // un autre Leader : la Vie est payée, rien d'autre
  s = finish(play(setup(leader()), 'OP18-117'));
  assert.equal(s.players[0].life.length, 0);
  assert.equal(s.players[0].chars.length, 1);
  assert.equal(s.players[1].chars.length, 1);
  // refuser le coût : la Vie reste
  s = finish(play(setup('OP18-079'), 'OP18-117'), answers('no'));
  assert.equal(s.players[0].life.length, 2);
  assert.equal(s.players[1].chars.length, 1);
});

test('OP18-118 : [Jouée] redresser jusqu\'à 3 DON!!, puis un Personnage adverse ne peut pas être épuisé ; [Fin de votre tour] redresser une carte {Water Seven}', () => {
  let s = sit(side(leader(), { hand: ['OP18-118'], donActive: 9, donRested: 1 }), side(leader(), { chars: [{ num: BIG }] }));
  s = finish(play(s, 'OP18-118'));
  assert.equal(s.players[0].donActive, 3);
  assert.ok(hasMod(s, uidOf(s, 1, BIG), 'cantRest'));
  s = sit(side('OP18-022', { leaderRested: true, chars: [{ num: 'OP18-118' }] }), side(leader()));
  let r = drive(s, 'endOfTurn', uidOf(s, 0, 'OP18-118'), maxChooser());
  assert.equal(r.state.players[0].leader.rested, false);
  s = sit(side(leader(), { leaderRested: true, chars: [{ num: 'OP18-118' }] }), side(leader()));
  r = drive(s, 'endOfTurn', uidOf(s, 0, 'OP18-118'), maxChooser());
  assert.equal(r.state.players[0].leader.rested, true);
});

test('OP18-119 [Activation : Principale] [Une fois par tour] : si elle a été jouée ce tour, jouer un {Ordre des chevaliers divins} de coût 6 ou moins de la Défausse', () => {
  const base = (playedTurn: number) => {
    const s = sit(side(leader(), { chars: [{ num: 'OP18-119' }], trash: ['OP18-084', BIG] }), side(leader()));
    s.players[0].chars[0].playedTurn = playedTurn;
    return s;
  };
  let s = base(5);
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP18-119')}`));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP18-084'));
  assert.ok(!s.players[0].chars.some((c) => c.num === BIG));
  s = base(2);
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP18-119')}`));
  assert.ok(!s.players[0].chars.some((c) => c.num === 'OP18-084'));
});

test('OP18-045 : +1000 de puissance par tranche de 5 Événements dans sa Défausse ; nom aussi [Sanji]', () => {
  const at = (n: number) => {
    const s = sit(side(leader(), { chars: [{ num: 'OP18-045' }], trash: Array.from({ length: n }, () => 'OP18-018') }), side(leader()));
    return power(s, s.players[0].chars[0].uid);
  };
  assert.equal(at(4), 4000);
  assert.equal(at(5), 5000);
  assert.equal(at(9), 5000);
  assert.equal(at(10), 6000);
  assert.ok(CARDS['OP18-045'].names.includes('Sanji'));
});
