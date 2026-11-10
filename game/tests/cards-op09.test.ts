// OP09, PRB01, ST16, ST17, ST20 (tâche S10 de l'étape C) : cartes codées à la main, et cas que les tests générés ne savent
// pas vérifier (Lieu, [Contre], « Si vous le faites », valeurs lues à la résolution). Aucun texte de carte : les tests citent
// des numéros et des valeurs (01-contrats.md § 15.8).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { buildSituation, drive, emptySide, inertPool, maxChooser, type SideSpec } from '../engine/recipes/bench.ts';
import { act, advance } from '../engine/engine.ts';
import { fieldCost, hasKeyword, isNegated, power } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { attack, choose, coherent, logHas, play } from './helpers.ts';

const RA2 = 'EB05-041';           // Personnage sans effet {Revolutionary Army} (coût 2, 4000)
const V3000 = 'EB05-003';         // Personnage sans effet (coût 1, 3000)
const BIG = 'OP09-093';           // Personnage coût 10, 12000
const LUCCI = 'OP09-038';         // Personnage {ODYSSEY} coût 4, 6000
const GORDON = 'ST16-002';        // [Bloqueur], 0 de puissance
// un Leader sans effet de 5000 de puissance (les calculs de [Contre] plus bas le supposent ; le premier Leader inerte change quand un set devient jouable : OP02-001, 6000, depuis S19)
const leader = () => inertPool().leaders.find((n) => CARDS[n].power === 5000) ?? inertPool().leaders[0];
const RHP_L = 'OP09-001';
const BB_L = 'OP09-081';
const CG_L = 'OP09-042';
const KID_L = 'OP10-099';

const side = (lead: string, o: Partial<SideSpec> = {}): SideSpec => ({ ...emptySide(lead), donActive: 6, ...o });
const sit = (a: SideSpec, b: SideSpec, active: PlayerId = 0): GameState =>
  buildSituation({ sides: [a, b], active, filler: [RA2, RA2], seed: 5 });
const uidOf = (s: GameState, p: PlayerId, num: string) => {
  const P = s.players[p];
  const c = [P.leader, ...P.chars, ...(P.stage ? [P.stage] : []), ...P.hand, ...P.trash, ...P.life, ...P.deck].find((x) => x.num === num);
  assert.ok(c, `${num} introuvable`);
  return c.uid;
};
const has = (s: GameState, id: string) => Boolean(s.decision?.options.some((o) => o.id === id));
// Répond aux questions de l'effet en cours (premier choix utile, sinon le premier)
const finish = (s: GameState) => {
  for (let i = 0; i < 40 && s.decision?.inEffect; i++) s = act(s, s.decision.options.find((o) => o.id !== 'none' && o.id !== 'no')?.id ?? s.decision.options[0].id);
  return s;
};
// Fin d'une attaque adverse : personne ne bloque, personne ne contre, aucun effet
const endBattle = (s: GameState) => {
  for (let i = 0; i < 40 && s.battle; i++) {
    const o = s.decision?.options;
    if (!o) break;
    s = act(s, o.find((x) => ['none', 'noblock', 'no', 'nocounter', 'pass', 'done', 'hand'].includes(x.id))?.id ?? o[o.length - 1].id);
  }
  return s;
};
// Révèle comme [Déclenchement] la carte du dessus de la Vie du joueur 0 (une attaque adverse la lui fait perdre)
const trigger = (me: Partial<SideSpec>, num: string, opp: Partial<SideSpec> = {}, lead = leader()) => {
  const s = sit(side(lead, { life: [num, V3000], ...me }), side(leader(), { chars: [{ num: RA2 }], ...opp }), 1);
  s.players[1].chars[0].don = 3;
  s.players[1].donDeck -= 3;
  const r = drive(s, 'trigger', uidOf(s, 0, num), maxChooser(), uidOf(s, 1, RA2));
  assert.ok(r.ran, `${num} : ${r.reason}`);
  coherent(r.state);
  return r.state;
};
// [Contre] joué pendant une attaque du joueur 1 sur le Leader du joueur 0 : l'attaque est-elle repoussée ?
function counterRepels(me: Partial<SideSpec>, num: string, gap: number, lead = leader()) {
  const s = sit(side(lead, { life: [V3000, V3000], ...me }), side(leader(), { chars: [{ num: RA2 }] }), 1);
  const d = (power(s, s.players[0].leader.uid) + gap - 4000) / 1000;
  s.players[1].chars[0].don = d;
  s.players[1].donDeck -= d;
  const r = drive(s, 'counter', uidOf(s, 0, num), maxChooser(), uidOf(s, 1, RA2));
  assert.ok(r.ran, `${num} : ${r.reason}`);
  coherent(r.state);
  return r.state.players[0].life.length === 2;
}

test('S10 : chaque carte d\'OP09, PRB01, ST15 à ST20 est jouable (doute OP09-093 levé par l\'utilisateur, lecture 1)', () => {
  const nums = Object.keys(CARDS).filter((n) => /^(OP09|PRB01|ST15|ST16|ST17|ST18|ST19|ST20)-/.test(n));
  assert.ok(nums.length >= 150);
  assert.deepEqual(nums.filter((n) => !['verified', 'coded', 'auto'].includes(confidence(n))), []);
  assert.equal(confidence(BIG), 'coded');
});

// ---------- Recettes : ce que le banc ne vérifie pas ----------

test('OP09-021 et OP09-099 (Lieux) : le Lieu s\'épuise pour payer, la condition de Leader vient après', () => {
  let s = sit(side(RHP_L, { stage: 'OP09-021' }), side(leader(), { chars: [{ num: V3000 }] }));
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP09-021')}`));
  assert.equal(s.players[0].stage!.rested, true);
  assert.equal(power(s, s.players[1].chars[0].uid), 2000);
  coherent(s);
  s = sit(side(leader(), { stage: 'OP09-021' }), side(leader(), { chars: [{ num: V3000 }] }));
  if (has(s, `act:${uidOf(s, 0, 'OP09-021')}`)) {
    s = finish(choose(s, `act:${uidOf(s, 0, 'OP09-021')}`));
    assert.equal(power(s, s.players[1].chars[0].uid), 3000);
  }
  s = sit(side(BB_L, { stage: 'OP09-099', hand: [V3000], deckTop: [BIG, V3000, V3000] }), side(leader()));
  s = finish(choose(s, `act:${uidOf(s, 0, 'OP09-099')}`));
  assert.equal(s.players[0].stage!.rested, true);
  assert.ok(s.players[0].trash.some((c) => c.num === V3000));
  assert.ok(s.players[0].hand.some((c) => c.num === BIG));
  coherent(s);
  // sans carte à défausser, pas d'activation
  s = sit(side(BB_L, { stage: 'OP09-099', deckTop: [BIG] }), side(leader()));
  assert.equal(has(s, `act:${uidOf(s, 0, 'OP09-099')}`), false);
});

test('OP09-019 : la pioche lit la puissance après le −3000 ; sans le Leader, rien du tout (n° 1983)', () => {
  const run = (lead: string, oppChar: string) => {
    let s = sit(side(lead, { hand: ['OP09-019'] }), side(leader(), { chars: [{ num: oppChar }] }));
    const before = s.players[0].hand.length;
    s = finish(play(s, 'OP09-019'));
    coherent(s);
    return { drew: s.players[0].hand.length - before + 1, pow: power(s, s.players[1].chars[0].uid) };
  };
  assert.deepEqual(run(RHP_L, BIG), { drew: 1, pow: 9000 });
  assert.deepEqual(run(RHP_L, LUCCI), { drew: 0, pow: 3000 });   // 6000 − 3000 : plus rien à 5000
  assert.deepEqual(run(leader(), BIG), { drew: 0, pow: 12000 });
  assert.deepEqual(run(leader(), LUCCI), { drew: 0, pow: 6000 });
});

test('OP09-051 : reste sur le terrain seulement avec 5 Personnages de coût 5 ou plus', () => {
  let s = sit(side(leader(), { hand: ['OP09-051'], donActive: 10, chars: [{ num: BIG }, { num: BIG }, { num: BIG }, { num: BIG }] }), side(leader()));
  s = finish(play(s, 'OP09-051'));
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP09-051'));
  coherent(s);
  s = sit(side(leader(), { hand: ['OP09-051'], donActive: 10, chars: [{ num: BIG }, { num: BIG }, { num: BIG }] }), side(leader()));
  s = finish(play(s, 'OP09-051'));
  assert.ok(!s.players[0].chars.some((c) => c.num === 'OP09-051'));
  assert.equal(s.players[0].deck[s.players[0].deck.length - 1].num, 'OP09-051');
});

test('OP09-056 : {Cross Guild} OU « Baroque Works » (pas les deux à la fois)', () => {
  let s = sit(side(leader(), { hand: ['OP09-056'], deckTop: ['OP09-048', 'EB01-061', V3000, 'OP09-056'] }), side(leader()));
  s = play(s, 'OP09-056');
  const nums = s.decision!.options.flatMap((o) => (o.num ? [o.num] : s.players[0].deck.concat(s.players[0].hand).filter((c) => c.uid === o.uid).map((c) => c.num)));
  const text = JSON.stringify(s.decision!.options) + JSON.stringify(nums);
  assert.ok(text.includes('OP09-048'), text);
  assert.ok(text.includes('EB01-061'), text);
});

test('OP09-074 : +1000 quand une DON!! retourne au deck DON!! à son tour', () => {
  let s = sit(side(KID_L, { hand: ['OP09-064'], chars: [{ num: 'OP09-074' }], leaderRested: true }), side(leader()));
  s = play(s, 'OP09-064');
  for (let i = 0; i < 20 && s.decision?.inEffect; i++) s = act(s, s.decision.options.find((o) => o.id === 'yes' || o.id.startsWith('card:'))?.id ?? s.decision.options[0].id);
  assert.equal(s.players[0].leader.rested, false);   // Killer : DON!! −1
  assert.ok(logHas(s, /gagne \+1000 de puissance/));
  coherent(s);
});

test('OP09-103 : Vie en main, jouer un {Revolutionary Army} : la pioche seulement si une carte est jouée', () => {
  let s = sit(side(leader(), { hand: ['OP09-103', RA2], life: [V3000, V3000] }), side(leader()));
  const hand = s.players[0].hand.length;
  s = finish(play(s, 'OP09-103'));
  const P = s.players[0];
  assert.equal(P.life.length, 1);
  assert.ok(P.chars.some((c) => c.num === RA2));
  assert.equal(P.hand.length, hand - 2 + 1 + 1);   // − Koala − jouée + Vie + pioche
  coherent(s);
  // refuser de jouer : pas de pioche
  s = sit(side(leader(), { hand: ['OP09-103', RA2], life: [V3000, V3000] }), side(leader()));
  s = play(s, 'OP09-103');
  for (let i = 0; i < 20 && s.decision?.inEffect; i++) {
    const o = s.decision.options;
    s = act(s, (o.find((x) => x.id === 'none') ?? o.find((x) => x.id === 'yes') ?? o[0]).id);
  }
  assert.equal(s.players[0].hand.length, hand - 1 + 1);
  assert.ok(!s.players[0].chars.some((c) => c.num === RA2));
  // sans cible en main : le coût se propose quand même, refusable, rien ne suit (n° 1000)
  s = sit(side(leader(), { hand: ['OP09-103'], life: [V3000, V3000] }), side(leader()));
  s = play(s, 'OP09-103');
  assert.equal(s.decision?.tag, 'mayIdle');
  s = act(s, 'no');
  assert.equal(s.players[0].life.length, 2);
});

test('OP09-104 [Déclenchement] : pioche 2 seulement avec un Leader multicolore', () => {
  const hand0 = sit(side('OP09-022', { life: [V3000, V3000] }), side(leader())).players[0].hand.length;
  assert.equal(trigger({}, 'OP09-104', {}, 'OP09-022').players[0].hand.length, hand0 + 2);
  assert.equal(trigger({}, 'OP09-104', {}, RHP_L).players[0].hand.length, hand0);
});

test('OP09-114 [Déclenchement] : le total des Vies ne compte pas la carte révélée', () => {
  const opp = (n: number) => ({ life: Array.from({ length: n }, () => V3000) });
  const on = (s: GameState) => s.players[0].chars.some((c) => c.num === 'OP09-114');
  assert.equal(on(trigger({}, 'OP09-114', opp(4))), true);     // 1 + 4
  assert.equal(on(trigger({}, 'OP09-114', opp(5))), false);    // 1 + 5
});

test('OP09-116 [Contre] : +2000 à la carte attaquée', () => {
  assert.equal(counterRepels({ hand: ['OP09-116'] }, 'OP09-116', 1000), true);
  assert.equal(counterRepels({ hand: ['OP09-116'] }, 'OP09-116', 3000), false);
});

// ---------- Codées à la main ----------

test('OP09-001 (Leader) : refuser à une attaque n\'use pas l\'effet ; une seule fois par tour', () => {
  let s = sit(side(RHP_L, { life: [V3000, V3000, V3000] }), side(leader(), { chars: [{ num: V3000 }, { num: V3000 }, { num: V3000 }] }), 1);
  const me = s.players[0].leader.uid;
  const [a, b, c] = s.players[1].chars.map((x) => x.uid);
  s = attack(s, a, me);
  assert.equal(s.decision?.tag, 'oppPower');
  s = endBattle(choose(s, 'none'));
  s = attack(s, b, me);
  assert.equal(s.decision?.tag, 'oppPower');
  s = choose(s, `card:${c}`);
  assert.equal(power(s, c), 2000);
  s = endBattle(s);
  s = attack(s, c, me);
  assert.notEqual(s.decision?.tag, 'oppPower');
  coherent(s);
});

test('OP09-012 : remplace le KO de [Bonk Punch] par un effet, pas en combat', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP09-010' }, { num: 'OP09-012' }] }), side(BB_L, { hand: ['OP09-098'] }), 1);
  s = play(s, 'OP09-098', 1);
  s = choose(s, `card:${uidOf(s, 0, 'OP09-010')}`);
  assert.equal(s.decision?.tag, 'replace');
  assert.equal(s.decision?.player, 0);
  s = finish(choose(s, 'yes'));
  assert.deepEqual(s.players[0].chars.map((c) => c.num), ['OP09-010']);
  assert.ok(s.players[0].trash.some((c) => c.num === 'OP09-012'));
  coherent(s);
  // en combat : aucune question, KO normal
  s = sit(side(leader(), { chars: [{ num: 'OP09-010', rested: true }, { num: 'OP09-012' }] }), side(leader(), { chars: [{ num: BIG }] }), 1);
  s = attack(s, uidOf(s, 1, BIG), uidOf(s, 0, 'OP09-010'));
  for (let i = 0; i < 20 && s.battle; i++) {
    assert.notEqual(s.decision?.tag, 'replace');
    s = endBattle(s);
    if (!s.decision) break;
  }
  assert.deepEqual(s.players[0].chars.map((c) => c.num), ['OP09-012']);
});

test('OP09-014 : le [Bloqueur] de 4000 ou moins ne peut plus bloquer pour le tour, même renforcé', () => {
  let s = sit(side(leader(), { hand: ['OP09-014'] }), side(leader(), { chars: [{ num: GORDON }, { num: V3000 }, { num: 'OP09-005' }] }));
  const g = uidOf(s, 1, GORDON);
  s = play(s, 'OP09-014');
  assert.deepEqual(s.decision!.options.map((o) => o.id), [`card:${g}`, 'none']);
  s = finish(choose(s, `card:${g}`));
  const card = s.players[1].chars.find((c) => c.uid === g)!;
  assert.equal(hasKeyword(s, 1, card, 'Blocker'), false);
  s.mods.push({ uid: g, stat: 'power', amount: 5000, until: 'turn', source: 'essai' });
  assert.equal(hasKeyword(s, 1, card, 'Blocker'), false);
  assert.equal(hasKeyword(s, 1, s.players[1].chars.find((c) => c.num === 'OP09-005')!, 'Blocker'), true);
});

test('OP09-017 : [Initiative] avec 1 DON!!, un Leader {Kid Pirates} et 7000 de puissance', () => {
  const rush = (lead: string, leaderDon: number, don: number) => {
    const s = sit(side(lead, { leaderDon, chars: [{ num: 'OP09-017', don }] }), side(leader()));
    return hasKeyword(s, 0, s.players[0].chars[0], 'Rush');
  };
  const need = (7000 - (CARDS[KID_L].power ?? 0)) / 1000;
  assert.equal(rush(KID_L, need, 1), true);
  assert.equal(rush(KID_L, need - 1, 1), false);
  assert.equal(rush(KID_L, need, 0), false);
  assert.equal(rush(leader(), 3, 1), false);
});

test('OP09-018 : 2 Personnages de 4000 au total, puissance négative comprise ; un seul possible', () => {
  let s = sit(side(leader(), { hand: ['OP09-018'] }), side(leader(), { chars: [{ num: V3000 }, { num: LUCCI }, { num: BIG }] }));
  const [low, lucci, big] = s.players[1].chars.map((c) => c.uid);
  s.mods.push({ uid: low, stat: 'power', amount: -5000, until: 'turn', source: 'essai' });
  s = play(s, 'OP09-018');
  assert.deepEqual(s.decision!.options.map((o) => o.id).sort(), [`card:${low}`, `card:${lucci}`, 'none'].sort());  // 12000 − 2000 dépasse
  void big;
  // 6000 seul dépasse le total : le second est obligatoire (seul possible ici : pas de question)
  s = finish(choose(s, `card:${lucci}`));
  assert.deepEqual(s.players[1].chars.map((c) => c.uid), [big]);
  coherent(s);
  s = sit(side(leader(), { hand: ['OP09-018'] }), side(leader(), { chars: [{ num: V3000 }, { num: V3000 }] }));
  s = play(s, 'OP09-018');
  s = choose(s, `card:${s.players[1].chars[0].uid}`);
  assert.equal(s.decision?.inEffect ? s.decision.options.some((o) => o.id.startsWith('card:')) : false, false);  // 3000 + 3000
  assert.equal(s.players[1].chars.length, 1);
});

test('OP09-022 (Leader) : Personnages joués épuisés, de la main ou par son effet', () => {
  let s = sit(side('OP09-022', { hand: [LUCCI, V3000], donActive: 8 }), side(leader()));
  s = finish(play(s, V3000));
  assert.equal(s.players[0].chars[0].rested, true);
  s = finish(choose(s, `act:${s.players[0].leader.uid}`));
  const P = s.players[0];
  const lucci = P.chars.find((c) => c.num === LUCCI)!;
  assert.equal(lucci.rested, true);
  assert.equal(P.donRested, 1 + 3 + 1);       // 1 (Pashia) + 3 (coût) + 1 ajoutée
  assert.equal(has(s, `act:${P.leader.uid}`), false);
  coherent(s);
  // un autre Leader : pas d'effet
  s = sit(side(leader(), { hand: [V3000] }), side(leader()));
  s = finish(play(s, V3000));
  assert.equal(s.players[0].chars[0].rested, false);
});

test('OP09-032 : se redresse une seule fois, seulement s\'il est épuisé, et peut bloquer aussitôt', () => {
  let s = sit(side(leader(), { chars: [{ num: 'OP09-032', rested: true }], life: [V3000, V3000] }), side(leader(), { chars: [{ num: V3000 }, { num: V3000 }, { num: V3000 }] }), 1);
  const me = s.players[0].leader.uid;
  const [a, b] = s.players[1].chars.map((x) => x.uid);
  s = attack(s, a, me);
  s = choose(s, 'yes');
  assert.equal(s.players[0].chars[0].rested, false);
  assert.equal(s.decision?.kind, 'blocker');
  s = endBattle(s);
  s.players[0].chars[0].rested = true;
  s = attack(s, b, me);
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(s.players[0].chars[0].rested, true);
});

test('OP09-046 : coût 5 ou moins, {Cross Guild} ou « Baroque Works »', () => {
  const costly = 'OP16-051';   // {Cross Guild} coût 6
  let s = sit(side(leader(), { hand: ['OP09-046', 'OP12-055', 'EB01-061', costly, V3000], donActive: 10 }), side(leader()));
  s = play(s, 'OP09-046');
  const ids = s.decision!.options.filter((o) => o.id !== 'none').map((o) => s.players[0].hand.find((c) => c.uid === o.uid)!.num).sort();
  assert.deepEqual(ids, ['EB01-061', 'OP12-055']);
});

test('OP09-060 : main → dessous du deck et Lieu épuisé ; pioche avec un Leader {Cross Guild}', () => {
  const run = (lead: string) => {
    let s = sit(side(lead, { stage: 'OP09-060', hand: [V3000, RA2, LUCCI] }), side(leader()));
    const u = uidOf(s, 0, 'OP09-060');
    s = finish(choose(s, `act:${u}`));
    assert.equal(s.players[0].stage!.rested, true);
    coherent(s);
    return s.players[0].hand.length;
  };
  assert.equal(run(CG_L), 3 - 2 + 2);
  assert.equal(run(leader()), 3 - 2);
  const s = sit(side(CG_L, { stage: 'OP09-060', hand: [V3000] }), side(leader()));
  assert.equal(has(s, `act:${uidOf(s, 0, 'OP09-060')}`), false);
});

test('OP09-061 (Leader) : +1 de coût avec 1 DON!! ; 2 DON!! d\'un coup au deck DON!! : 1 redressée et 1 épuisée', () => {
  let s = sit(side('OP09-061', { leaderDon: 1, chars: [{ num: V3000 }] }), side(leader(), { chars: [{ num: V3000 }] }));
  assert.equal(fieldCost(s, s.players[0].chars[0].uid), 2);
  assert.equal(fieldCost(s, s.players[1].chars[0].uid), 1);
  s = sit(side('OP09-061', { chars: [{ num: V3000 }] }), side(leader()));
  assert.equal(fieldCost(s, s.players[0].chars[0].uid), 1);
  // DON!! −2 (OP17-075) puis DON!! −1 (OP09-064, ne compte pas)
  s = sit(side('OP09-061', { hand: ['OP17-075', 'OP09-064'] }), side(leader(), { hand: [V3000] }));
  s = play(s, 'OP17-075');
  s = finish(s);
  const P = s.players[0];
  assert.ok(logHas(s, /1 DON!! redressée et 1 DON!! épuisée/), 'les 2 DON!! sont ajoutées');
  const dons = P.donActive + P.donRested;
  s = finish(play(s, 'OP09-064'));
  assert.ok(s.players[0].donActive + s.players[0].donRested <= dons);
  coherent(s);
});

test('OP09-081 (Leader) : ses [Jouée] annulés ; activation : ceux de l\'adversaire jusqu\'à la fin de son prochain tour', () => {
  // ses propres effets [Jouée]
  let s = sit(side(BB_L, { hand: ['OP09-048', V3000] }), side(leader()));
  const hand = s.players[0].hand.length;
  s = play(s, 'OP09-048');
  assert.equal(s.decision?.inEffect ?? false, false);
  assert.equal(s.players[0].hand.length, hand - 1);
  assert.ok(logHas(s, /\[Jouée\].*annulé/));
  // l'activation : le coût, et la durée
  s = sit(side(BB_L, { hand: [V3000] }), side(leader(), { hand: ['OP09-048'] }));
  s = finish(choose(s, `act:${s.players[0].leader.uid}`));
  assert.equal(s.players[1].onPlayNegatedUntil, s.turn + 1);
  assert.equal(s.players[0].hand.length, 0);
  const played = (until: number) => {
    let t = sit(side(leader()), side(leader(), { hand: ['OP09-048'] }), 1);
    t.players[1].onPlayNegatedUntil = t.turn + until;
    const n = t.players[1].hand.length;
    t = finish(play(t, 'OP09-048', 1));
    return t.players[1].hand.length - n + 1;
  };
  assert.equal(played(0), 0);           // annulé : ni pioche ni défausse
  assert.equal(played(-1), 1);          // la durée est passée : +2 − 1
  // [Déclenchement] « activez l'effet [Jouée] » sous annulation : rien, la carte part en Défausse (Q&A d'OP09)
  const fired = (until: number) => {
    const t = sit(side(leader(), { life: ['OP08-106', V3000] }), side(leader(), { chars: [{ num: RA2 }] }), 1);
    t.players[0].onPlayNegatedUntil = t.turn + until;
    t.players[1].chars[0].don = 3;
    t.players[1].donDeck -= 3;
    return drive(t, 'trigger', uidOf(t, 0, 'OP08-106'), maxChooser(), uidOf(t, 1, RA2)).state;
  };
  const off = fired(0);
  assert.ok(off.players[0].trash.some((c) => c.num === 'OP08-106'));
  assert.equal(logHas(off, /effet \[Jouée\]/), false);
});

test('OP09-084 : [Double attaque], [Exil] ou [Bloqueur] jusqu\'à la fin du prochain tour adverse, avec un Leader {Barbe Noire}', () => {
  let s = sit(side(BB_L, { chars: [{ num: 'OP09-084' }] }), side(leader()));
  const u = uidOf(s, 0, 'OP09-084');
  s = choose(s, `act:${u}`);
  assert.equal(s.decision?.options.length, 3);
  s = finish(choose(s, 'choice:2'));
  const c = s.players[0].chars[0];
  assert.equal(hasKeyword(s, 0, c, 'Blocker'), true);
  assert.deepEqual(s.mods.filter((m) => m.uid === u).map((m) => m.until), [s.turn + 1]);
  // annuler ses effets n'enlève pas le mot-clé reçu (Q&A d'OP09)
  s.mods.push({ uid: u, stat: 'negated', amount: 0, until: 'turn', source: 'essai' });
  assert.equal(hasKeyword(s, 0, c, 'Blocker'), true);
  coherent(s);
  s = sit(side(leader(), { chars: [{ num: 'OP09-084' }] }), side(leader()));
  if (has(s, `act:${s.players[0].chars[0].uid}`)) s = finish(choose(s, `act:${s.players[0].chars[0].uid}`));
  assert.equal(s.mods.filter((m) => m.stat === 'keyword').length, 0);
});

test('OP09-092 : piocher 2 et défausser 1 s\'il a au moins 3 cartes de moins en main', () => {
  const run = (mine: number, theirs: number) => {
    const fill = (n: number) => Array.from({ length: n }, () => V3000);
    let s = sit(side(leader(), { chars: [{ num: 'OP09-092' }], hand: fill(mine) }), side(leader(), { hand: fill(theirs) }));
    const u = s.players[0].chars[0].uid;
    s = finish(choose(s, `act:${u}`));
    assert.equal(s.players[0].chars[0].rested, true);
    return s.players[0].hand.length;
  };
  assert.equal(run(1, 4), 2);
  assert.equal(run(2, 4), 2);
});

test('OP09-093 (en doute, codée) : annule le Leader pour le tour, le Personnage et son attaque jusqu\'à la fin du prochain tour adverse', () => {
  let s = sit(side(BB_L, { chars: [{ num: BIG }] }), side(leader(), { chars: [{ num: V3000 }] }));
  const u = s.players[0].chars[0].uid;
  assert.equal(has(s, `act:${u}`), false);    // pas joué ce tour
  s = sit(side(BB_L, { chars: [{ num: BIG }] }), side(leader(), { chars: [{ num: V3000 }] }));
  s.players[0].chars[0].playedTurn = s.turn;
  s.decision = null;
  s = advance(s);
  s = finish(choose(s, `act:${s.players[0].chars[0].uid}`));
  const v = s.players[1].chars[0].uid;
  assert.equal(isNegated(s, s.players[1].leader.uid), true);
  assert.deepEqual(s.mods.filter((m) => m.uid === s.players[1].leader.uid).map((m) => m.until), [s.turn]);
  assert.deepEqual(s.mods.filter((m) => m.uid === v).map((m) => [m.stat, m.until]).sort(), [['cantAttack', s.turn + 1], ['negated', s.turn + 1]]);
  coherent(s);
});

test('OP09-097 : [Contre] annule et −4000 ; [Déclenchement] annule', () => {
  let s = sit(side(leader(), { hand: ['OP09-097'], life: [V3000, V3000] }), side(leader(), { chars: [{ num: BIG }] }), 1);
  const big = s.players[1].chars[0].uid;
  s = attack(s, big, s.players[0].leader.uid);
  while (s.decision?.kind === 'blocker') s = choose(s, 'noblock');
  s = act(s, `cevent:${uidOf(s, 0, 'OP09-097')}`);
  s = choose(s, `card:${big}`);
  assert.equal(isNegated(s, big), true);
  assert.equal(power(s, big), 8000);
  coherent(s);
  const t = trigger({}, 'OP09-097');
  assert.ok(t.mods.some((m) => m.stat === 'negated'));
  assert.ok(!t.mods.some((m) => m.amount === -4000));
});

test('OP09-098 : annule pour le tour et met KO à coût 4 ou moins ; [Déclenchement] annule', () => {
  let s = sit(side(BB_L, { hand: ['OP09-098'] }), side(leader(), { chars: [{ num: LUCCI }, { num: BIG }] }));
  const big = uidOf(s, 1, BIG);
  s = choose(play(s, 'OP09-098'), `card:${uidOf(s, 1, LUCCI)}`);
  assert.deepEqual(s.players[1].chars.map((c) => c.num), [BIG]);
  s = sit(side(BB_L, { hand: ['OP09-098'] }), side(leader(), { chars: [{ num: BIG }] }));
  s = choose(play(s, 'OP09-098'), `card:${s.players[1].chars[0].uid}`);
  assert.equal(s.players[1].chars.length, 1);
  assert.equal(isNegated(s, s.players[1].chars[0].uid), true);
  void big;
  // sans Leader {Barbe Noire} : aucune question, aucun effet
  s = sit(side(leader(), { hand: ['OP09-098'] }), side(leader(), { chars: [{ num: BIG }] }));
  s = play(s, 'OP09-098');
  assert.equal(s.mods.length, 0);
  assert.ok(trigger({}, 'OP09-098').mods.some((m) => m.stat === 'negated'));
});

test('OP09-101 : coût = Personnage adverse dans la Vie adverse, face visible ; sinon pas de défausse', () => {
  let s = sit(side(leader(), { hand: ['OP09-101'] }), side(leader(), { chars: [{ num: V3000 }], hand: [RA2, RA2], life: [V3000] }));
  const u = s.players[1].chars[0].uid;
  s = play(s, 'OP09-101');
  s = choose(s, 'yes');
  s = finish(choose(s, 'lifeTop'));   // une seule cible : pas de question
  const O = s.players[1];
  assert.equal(O.chars.length, 0);
  assert.equal(O.life.length, 2);
  assert.equal(O.life[0].uid, u);
  assert.equal(O.hand.length, 1);
  coherent(s);
  // aucune cible : pas d'activation
  s = sit(side(leader(), { hand: ['OP09-101'] }), side(leader(), { chars: [{ num: BIG }], hand: [RA2] }));
  s = play(s, 'OP09-101');
  assert.equal(s.decision?.inEffect ?? false, false);
  assert.equal(s.players[1].hand.length, 1);
});

test('OP09-118 : gagne si l\'adversaire active [Bloqueur] alors qu\'un joueur n\'a plus de Vie', () => {
  const run = (myLife: number, oppLife: number) => {
    const lives = (n: number) => Array.from({ length: n }, () => V3000);
    let s = sit(side(leader(), { chars: [{ num: 'OP09-118' }, { num: V3000 }], life: lives(myLife) }), side(leader(), { chars: [{ num: GORDON }], life: lives(oppLife) }));
    s = attack(s, uidOf(s, 0, V3000), s.players[1].leader.uid);
    s = choose(s, (o) => o.id.startsWith('block'));
    coherent(s);
    return s.winner;
  };
  assert.equal(run(2, 0), 0);
  assert.equal(run(0, 2), 0);
  assert.equal(run(2, 2), null);
});

test('PRB01-001 (Leader) : [Initiative] à un Personnage de coût 8 ou moins sans effet [Jouée]', () => {
  let s = sit(side('PRB01-001', { chars: [{ num: V3000 }, { num: 'OP09-048' }, { num: BIG }] }), side(leader()));
  const [v] = s.players[0].chars.map((c) => c.uid);
  s = choose(s, `act:${s.players[0].leader.uid}`);
  assert.deepEqual(s.decision!.options.map((o) => o.id), [`card:${v}`, 'none']);
  s = finish(choose(s, `card:${v}`));
  assert.equal(hasKeyword(s, 0, s.players[0].chars[0], 'Rush'), true);
  assert.equal(has(s, `act:${s.players[0].leader.uid}`), false);
  coherent(s);
  // annuler les [Jouée] ne rend pas le Personnage « sans effet [Jouée] » (Q&A d'OP09)
  s = sit(side('PRB01-001', { chars: [{ num: 'OP09-048' }] }), side(leader()));
  s.players[0].onPlayNegatedUntil = s.turn;
  if (has(s, `act:${s.players[0].leader.uid}`)) s = choose(s, `act:${s.players[0].leader.uid}`);
  assert.equal(s.mods.length, 0);
  assert.equal(s.decision?.inEffect ?? false, false);
});

test('ST16-002 : autant de {Music} défaussées, +1000 par carte à la carte choisie', () => {
  const music = 'EB02-008';
  let s = sit(side(leader(), { chars: [{ num: GORDON }], hand: [music, music, V3000], life: [V3000, V3000] }), side(leader(), { chars: [{ num: V3000 }] }), 1);
  s = attack(s, s.players[1].chars[0].uid, s.players[0].leader.uid);
  for (let i = 0; i < 12 && s.decision?.inEffect; i++) {
    const d = s.decision;
    if (d.tag === 'may') s = choose(s, 'yes');
    else if (d.tag === 'ownPower') s = choose(s, `card:${s.players[0].leader.uid}`);
    else s = act(s, d.options[0].id);
  }
  assert.equal(power(s, s.players[0].leader.uid), (CARDS[s.players[0].leader.num].power ?? 0) + 2000);
  assert.equal(s.players[0].hand.filter((c) => c.num === music).length, 0);
  assert.equal(s.players[0].hand.filter((c) => c.num === V3000).length, 1);
  coherent(s);
  // sans {Music} : aucune question
  s = sit(side(leader(), { chars: [{ num: GORDON }], hand: [V3000], life: [V3000] }), side(leader(), { chars: [{ num: V3000 }] }), 1);
  s = attack(s, s.players[1].chars[0].uid, s.players[0].leader.uid);
  assert.notEqual(s.decision?.tag, 'may');
});

test('ST17-005 : une carte de la main au-dessus du deck, jusqu\'à 2 DON!! épuisées', () => {
  let s = sit(side(leader(), { chars: [{ num: 'ST17-005' }], hand: [LUCCI], donActive: 0, donRested: 3 }), side(leader()));
  const u = uidOf(s, 0, 'ST17-005');
  s = choose(s, `act:${u}`);
  s = finish(s);
  const P = s.players[0];
  assert.equal(P.deck[0].num, LUCCI);
  assert.equal(P.donRested, 1);
  assert.equal(P.leader.don + P.chars[0].don, 2);
  assert.equal(has(s, `act:${u}`), false);
  coherent(s);
  s = sit(side(leader(), { chars: [{ num: 'ST17-005' }], donRested: 3 }), side(leader()));
  assert.equal(has(s, `act:${uidOf(s, 0, 'ST17-005')}`), false);
});

test('ST20-002 : une fois par tour, KO par un effet remplacé par la Vie ; pas en combat ; [Déclenchement] : défausser pour jouer', () => {
  // ST16-004 : KO d'un Personnage épuisé (le remplacement ne marche pas sous une annulation, n° 2905)
  let s = sit(side(leader(), { chars: [{ num: 'ST20-002', rested: true }], life: [V3000, V3000] }), side(leader(), { hand: ['ST16-004'], donActive: 10 }), 1);
  const u = s.players[0].chars[0].uid;
  s = choose(play(s, 'ST16-004', 1), `card:${u}`);
  assert.equal(s.decision?.tag, 'replace');
  s = finish(choose(s, 'yes'));
  assert.equal(s.players[0].chars.length, 1);
  assert.equal(s.players[0].life.length, 1);
  // déjà utilisé ce tour : plus de remplacement
  assert.equal(CARDS['ST20-002'].koReplace!.condition(s, 0, s.players[0].chars[0]), false);
  coherent(s);
  // en combat : KO normal
  s = sit(side(leader(), { chars: [{ num: 'ST20-002', rested: true }], life: [V3000, V3000] }), side(leader(), { chars: [{ num: BIG }] }), 1);
  s = attack(s, s.players[1].chars[0].uid, s.players[0].chars[0].uid);
  for (let i = 0; i < 20 && s.battle && s.decision; i++) {
    assert.notEqual(s.decision.tag, 'replace');
    s = endBattle(s);
  }
  assert.equal(s.players[0].chars.length, 0);
  assert.equal(s.players[0].life.length, 2);
  // [Déclenchement]
  const t = trigger({ hand: [V3000] }, 'ST20-002');
  assert.ok(t.players[0].chars.some((c) => c.num === 'ST20-002'));
  assert.ok(t.players[0].trash.some((c) => c.num === V3000));
  const t2 = trigger({}, 'ST20-002');
  assert.ok(!t2.players[0].chars.some((c) => c.num === 'ST20-002'));
});

test('ST20-003 [Déclenchement] : regarde une Vie puis ajoute la carte à sa main', () => {
  const t = trigger({}, 'ST20-003');
  assert.ok(t.players[0].hand.some((c) => c.num === 'ST20-003'));
  assert.ok(!t.players[0].trash.some((c) => c.num === 'ST20-003'));
});

test('ST16-003 : les DON!! épuisées comptent dans les 6 cartes épuisées', () => {
  const film = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'LEADER' && CARDS[n].types.includes('FILM'))!;
  const at = (donRested: number, lead = film) => {
    const s = sit(side(lead, { chars: [{ num: 'ST16-003' }], donActive: 0, donRested }), side(leader()));
    return power(s, s.players[0].chars[0].uid) - (CARDS['ST16-003'].power ?? 0);
  };
  assert.equal(at(6), 2000);
  assert.equal(at(5), 0);
  assert.equal(at(6, leader()), 0);
});
