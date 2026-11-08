// OP07 (tâche S12) : un test par effet des cartes codées à la main (condition vraie et fausse), les réponses des Q&A
// officielles, et les recettes que le banc d'essai ne sait pas mesurer ([Contre] « pendant ce combat », coût « épuisez ce
// Lieu », [Déclenchement], valeurs calculées : 01-contrats.md § 15.4). Numéros et valeurs seulement, aucun texte de carte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import type { DeckList } from '../engine/decks.ts';
import { act } from '../engine/engine.ts';
import { confidence } from '../engine/recipes/confidence.ts';
import { attackTargets, fieldCost, knows, power } from '../engine/rules.ts';
import type { GameState, PlayerId } from '../engine/types.ts';
import { viewFor } from '../engine/view.ts';
import { charUid, counterGain, leaderUid, list, oppLeaderDon, scene } from './eb-scene.ts';
import { attack, choose, hasOption, keepOrder, logHas, play, setChars, setDeckTop, setDon, setHand, setLife } from './helpers.ts';

const F = 'ST-21';      // deck d'appoint
const OPP = 'ST-21';
const DRAGON_L = 'OP07-001';
const BONNEY_L = 'OP07-019';
const HANCOCK_L = 'OP07-038';
const FOXY_L = 'OP07-059';
const LUCCI_L = 'OP07-079';
const VEGAPUNK_L = 'OP07-097';
const NEUTRAL_L = 'ST21-001';
const yes = (s: GameState) => choose(s, 'yes');
const no = (s: GameState) => choose(s, 'no');

// [Déclenchement] de la carte du dessus de ma Vie, révélée par une attaque du Leader adverse
function triggerFromLife(me: DeckList, top: string, extra: (g: GameState) => void = () => {}, opp: DeckList | string = OPP): GameState {
  let s = scene([me, opp], (g) => {
    setLife(g, 0, [top, ...g.players[0].life.slice(1).map((c) => c.num)]);
    oppLeaderDon(g, 3);
    extra(g);
  }, 1);
  s = attack(s, leaderUid(s, 1), leaderUid(s, 0));
  while (s.decision?.kind === 'blocker' || s.decision?.kind === 'counter') s = act(s, s.decision.kind === 'blocker' ? 'noblock' : 'pass');
  assert.equal(s.decision?.tag, 'trigger', `[Déclenchement] attendu (${s.decision?.prompt})`);
  return choose(s, 'trigger');
}

const donOf = (s: GameState, p: PlayerId, num: string) => s.players[p].chars.find((c) => c.num === num)!.don;

test('Dragon (Leader OP07-001) : jusqu’à 2 DON!! déjà données sur 1 seul Personnage (Q&A)', () => {
  const at = (setup: (g: GameState) => void) => scene([list(DRAGON_L, ['OP07-007', 'OP07-012', 'OP07-009'], F), OPP], setup);
  // deux Personnages à 1 DON!! : les deux passent sur un troisième
  let s = at((g) => setChars(g, 0, [{ num: 'OP07-007', extra: { don: 1 } }, { num: 'OP07-012', extra: { don: 1 } }, { num: 'OP07-009' }]));
  const lead = leaderUid(s, 0);
  s = act(s, `act:${lead}`);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-009'));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-007'));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-012'));
  assert.equal(donOf(s, 0, 'OP07-009'), 2);
  assert.equal(donOf(s, 0, 'OP07-007'), 0);
  assert.equal(donOf(s, 0, 'OP07-012'), 0);
  assert.ok(!hasOption(s, `act:${lead}`));   // une fois par tour
  // celles du Leader comptent ; on peut s'arrêter à 1
  s = at((g) => { setChars(g, 0, [{ num: 'OP07-007' }]); g.players[0].leader.don = 3; });
  s = act(s, `act:${leaderUid(s, 0)}`);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-007'));
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  s = choose(s, 'none');
  assert.equal(donOf(s, 0, 'OP07-007'), 1);
  assert.equal(s.players[0].leader.don, 2);
  // le seul à porter des DON!! ne peut pas se les redonner, et ne peut pas les partager entre deux autres (une seule cible)
  s = at((g) => setChars(g, 0, [{ num: 'OP07-007', extra: { don: 2 } }, { num: 'OP07-012' }, { num: 'OP07-009' }]));
  s = act(s, `act:${leaderUid(s, 0)}`);
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 0, 'OP07-007')));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-012'));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-007'));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-007'));
  assert.equal(donOf(s, 0, 'OP07-012'), 2);
  assert.equal(donOf(s, 0, 'OP07-009'), 0);
  assert.equal(s.decision?.kind, 'main');
  // aucune DON!! donnée : pas proposé
  s = at((g) => setChars(g, 0, [{ num: 'OP07-007' }]));
  assert.ok(!hasOption(s, `act:${leaderUid(s, 0)}`));
});

test('Ain (OP07-002) : puissance à 0 pour le tour ; ce qui s’ajoute ensuite compte, ce qui dure au-delà revient (Q&A)', () => {
  let s = scene([list(NEUTRAL_L, ['OP07-002'], F), OPP], (g) => {
    setChars(g, 1, [{ num: 'ST21-014' }]);
    setHand(g, 0, ['OP07-002']);
    setDon(g, 0, 10);
    g.mods.push({ uid: g.players[1].chars[0].uid, stat: 'power', amount: 2000, until: g.turn + 1, source: 'essai' });
  });
  const uid = charUid(s, 1, 'ST21-014');
  const base = CARDS['ST21-014'].power!;
  assert.equal(power(s, uid), base + 2000);
  s = play(s, 'OP07-002');
  s = choose(s, (o) => o.uid === uid);
  assert.equal(power(s, uid), 0);
  s.mods.push({ uid, stat: 'power', amount: 1000, until: 'battle', source: 'essai' });
  assert.equal(power(s, uid), 1000);
  // à la fin du tour, la baisse et le +1000 s'en vont, le +2000 qui dure au-delà reste
  s.mods = s.mods.filter((m) => m.source !== 'Ain' && m.amount !== 1000);
  assert.equal(power(s, uid), base + 2000);
});

test('Masked Deuce (OP07-013) : [Portgas.D.Ace] ou Événement rouge ; sans le Leader, le deck n’est pas regardé', () => {
  const ACE_L = Object.keys(CARDS).sort().find((n) => CARDS[n].category === 'LEADER' && CARDS[n].names.includes('Portgas.D.Ace'))!;
  const me = (leader: string) => list(leader, ['OP07-013', 'OP07-053', 'OP07-016', 'OP07-055', 'OP07-007', 'OP07-012'], F);
  const top = ['OP07-053', 'OP07-016', 'OP07-055', 'OP07-007', 'OP07-012'];  // Ace bleu, Événement rouge, Événement bleu, deux Personnages
  let s = scene([me(ACE_L), OPP], (g) => { setHand(g, 0, ['OP07-013']); setDon(g, 0, 10); setDeckTop(g, 0, top); });
  s = play(s, 'OP07-013');
  const nums = s.decision!.options.map((o) => o.num).filter(Boolean);
  assert.ok(nums.includes('OP07-053'));
  assert.ok(nums.includes('OP07-016'));
  assert.ok(!nums.includes('OP07-055'));
  assert.ok(!nums.includes('OP07-007'));
  s = choose(s, (o) => o.num === 'OP07-016');
  s = keepOrder(s);
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP07-016'));
  // le reste au-dessous du deck
  assert.deepEqual(s.players[0].deck.slice(-4).map((c) => c.num).sort(), ['OP07-007', 'OP07-012', 'OP07-053', 'OP07-055']);
  // autre Leader : rien
  s = scene([me(NEUTRAL_L), OPP], (g) => { setHand(g, 0, ['OP07-013']); setDon(g, 0, 10); setDeckTop(g, 0, top); });
  s = play(s, 'OP07-013');
  assert.equal(s.decision?.kind, 'main');
  assert.deepEqual(s.players[0].deck.slice(0, 5).map((c) => c.num), top);
});

test('Boa Hancock (Leader OP07-038) : facultatif, un refus ou une grande main n’usent pas la limite (Q&A, n° 1980)', () => {
  const me = list(HANCOCK_L, ['OP07-047', 'OP07-040', 'OP07-007', 'OP07-044'], F);
  // Crocodile OP07-040 (épuiser 1 DON!!) renvoie en main un Personnage de coût 2 ou moins, adverse ici : effet de ma carte
  const scn = (hand: string[]) => scene([me, OPP], (g) => {
    setChars(g, 1, [{ num: 'ST21-005' }, { num: 'ST21-008' }]);
    g.players[1].chars.forEach((c) => { g.mods.push({ uid: c.uid, stat: 'cost', amount: -9, until: 'turn', source: 'essai' }); });
    setHand(g, 0, hand);
    setDon(g, 0, 10);
  });
  const playBottom = (g: GameState, target: number) => {
    let s = yes(play(g, 'OP07-040'));
    return choose(s, (o) => o.uid === target);
  };
  let s = scn(['OP07-040', 'OP07-040']);
  const n = s.players[0].hand.length;
  s = playBottom(s, s.players[1].chars[0].uid);
  assert.equal(s.decision?.tag, 'may');
  s = no(s);
  assert.equal(s.players[0].hand.length, n - 1);
  // deuxième retrait du tour : encore proposé, on pioche
  s = playBottom(s, s.players[1].chars[0].uid);
  assert.equal(s.decision?.tag, 'may');
  s = yes(s);
  assert.equal(s.players[0].hand.length, n - 1);
  // plus de 5 cartes : pas de question
  s = scn(['OP07-040', 'OP07-007', 'OP07-007', 'OP07-007', 'OP07-007', 'OP07-044', 'OP07-044']);
  s = playBottom(s, s.players[1].chars[0].uid);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(confidence(HANCOCK_L), 'doubt');
});

test('Gecko Moria (OP07-042) : remplacement sous condition ; pas sans autre Personnage d’un autre nom (Q&A)', () => {
  const KO_OPP = 'OP07-118';   // Sabo : KO d'un Personnage adverse de coût 5 ou moins
  const WARLORD_L = HANCOCK_L;
  const at = (leader: string, chars: string[]) => scene([list('OP07-079', [KO_OPP, 'OP07-007'], F), list(leader, ['OP07-042', 'OP07-083', 'OP07-007', 'OP07-012'], F)], (g) => {
    setChars(g, 1, chars.map((num) => ({ num })));
    setHand(g, 0, [KO_OPP, 'OP07-007']);
    setDon(g, 0, 10);
  });
  const hit = (g: GameState) => {
    let s = play(g, KO_OPP);
    s = yes(s);    // payer : défausser 1 carte
    if (s.decision?.tag === 'discard') s = choose(s, (o) => o.uid !== undefined);
    return choose(s, (o) => o.uid === charUid(s, 1, 'OP07-042'));
  };
  let s = hit(at(WARLORD_L, ['OP07-042', 'OP07-083', 'OP07-007', 'OP07-012']));
  assert.equal(s.decision?.tag, 'replace');
  assert.equal(s.decision?.player, 1);
  s = choose(s, (o) => o.id.startsWith('replace:'));
  // un autre [Gecko Moria] ne peut pas être choisi
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 1, 'OP07-083')));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'OP07-007'));
  assert.ok(s.players[1].chars.some((c) => c.num === 'OP07-042'));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'OP07-007'));
  assert.equal(s.players[1].deck.at(-1)!.num, 'OP07-007');
  // seul : pas de remplacement
  s = hit(at(WARLORD_L, ['OP07-042', 'OP07-083']));
  assert.notEqual(s.decision?.tag, 'replace');
  assert.ok(!s.players[1].chars.some((c) => c.num === 'OP07-042'));
  // Leader d'un autre type : pas de remplacement
  s = hit(at(NEUTRAL_L, ['OP07-042', 'OP07-007']));
  assert.notEqual(s.decision?.tag, 'replace');
  assert.ok(!s.players[1].chars.some((c) => c.num === 'OP07-042'));
});

test('Perfume Femur (OP07-057) : +2000 et pas de [Bloqueur] contre la carte choisie seulement ; [Déclenchement] pioche', () => {
  const me = list(HANCOCK_L, ['OP07-057', 'OP07-044', 'OP07-007'], F);
  const opp = list(NEUTRAL_L, ['OP07-084'], F);
  const at = () => scene([me, opp], (g) => {
    setChars(g, 0, [{ num: 'OP07-044' }, { num: 'OP07-007' }]);
    setChars(g, 1, [{ num: 'OP07-084' }]);
    setHand(g, 0, ['OP07-057']);
    setDon(g, 0, 10);
  });
  let s = at();
  s = play(s, 'OP07-057');
  // un Personnage hors type n'est pas proposé
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 0, 'OP07-007')));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-044'));
  assert.equal(power(s, charUid(s, 0, 'OP07-044')), 12000);
  const other = attack(s, charUid(s, 0, 'OP07-007'), leaderUid(s, 1));
  assert.equal(other.decision?.kind, 'blocker');
  const chosen = attack(s, charUid(s, 0, 'OP07-044'), leaderUid(s, 1));
  assert.notEqual(chosen.decision?.kind, 'blocker');
  // Leader du type : il peut être choisi
  s = at();
  s = play(s, 'OP07-057');
  assert.ok(s.decision!.options.some((o) => o.uid === leaderUid(s, 0)));
  s = choose(s, 'none');
  assert.equal(s.decision?.kind, 'main');
  // [Déclenchement]
  const before = scene([me, OPP], (g) => { setHand(g, 0, []); }).players[0].hand.length;
  s = triggerFromLife(me, 'OP07-057', (g) => { setHand(g, 0, []); });
  assert.equal(s.players[0].hand.length, before + 1);
});

test('Foxy (Leader OP07-059) : DON!! −3, 3 {Foxy Pirates} : Leader et Personnage épuisés non redressés, l’un sans l’autre possible (Q&A)', () => {
  const FOXY_CHARS = ['OP07-071', 'OP07-072', 'OP07-068'];
  const at = (chars: string[], leaderRested: boolean) => scene([list(FOXY_L, FOXY_CHARS, F), OPP], (g) => {
    setChars(g, 0, chars.map((num) => ({ num })));
    setChars(g, 1, [{ num: 'ST21-005', extra: { rested: true } }, { num: 'ST21-008' }]);
    g.players[1].leader.rested = leaderRested;
    setDon(g, 0, 5);
  });
  // les deux choisis
  let s = at(FOXY_CHARS, true);
  s = attack(s, leaderUid(s, 0), charUid(s, 1, 'ST21-005'));
  s = yes(s);
  assert.equal(s.players[0].donActive, 2);
  s = choose(s, (o) => o.uid === leaderUid(s, 1));
  const locked = charUid(s, 1, 'ST21-005');
  s = choose(s, (o) => o.uid === locked);
  assert.ok(s.mods.some((m) => m.uid === leaderUid(s, 1) && m.stat === 'noRefresh'));
  assert.ok(s.mods.some((m) => m.uid === locked && m.stat === 'noRefresh'));
  // Leader adverse redressé : le Personnage reste possible
  s = at(FOXY_CHARS, false);
  s = attack(s, leaderUid(s, 0), charUid(s, 1, 'ST21-005'));
  s = yes(s);
  assert.ok(!s.decision!.options.some((o) => o.uid === leaderUid(s, 1)));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  assert.ok(s.mods.some((m) => m.stat === 'noRefresh'));
  // moins de 3 {Foxy Pirates} : pas proposé (l'effet ne peut pas servir, n° 1000)
  s = at(FOXY_CHARS.slice(0, 2), true);
  s = attack(s, leaderUid(s, 0), charUid(s, 1, 'ST21-005'));
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(s.players[0].donActive, 5);
});

test('Itomimizu (OP07-060) : 1 DON!! épuisée avec le Leader, sans autre [Itomimizu]', () => {
  const at = (leader: string, chars: string[]) => scene([list(leader, ['OP07-060'], F), OPP], (g) => {
    setChars(g, 0, chars.map((num) => ({ num })));
    setDon(g, 0, 2);
  });
  let s = at(FOXY_L, ['OP07-060']);
  const uid = charUid(s, 0, 'OP07-060');
  s = act(s, `act:${uid}`);
  assert.equal(s.players[0].donRested, 1);
  assert.ok(!hasOption(s, `act:${uid}`));
  s = at(FOXY_L, ['OP07-060', 'OP07-060']);
  assert.ok(!hasOption(s, `act:${s.players[0].chars[0].uid}`));
  s = at(NEUTRAL_L, ['OP07-060']);
  assert.ok(!hasOption(s, `act:${charUid(s, 0, 'OP07-060')}`));
});

test('Pickles (OP07-069) : avec autant de DON!! ou moins, ses {Foxy Pirates} autres que [Pickles] protégés des KO par effet adverse', () => {
  const at = (mine: number, theirs: number) => scene([list(LUCCI_L, ['OP07-118', 'OP07-007'], F), list(FOXY_L, ['OP07-069', 'OP07-072', 'OP07-007'], F)], (g) => {
    setHand(g, 0, ['OP07-118', 'OP07-007']);
    setDon(g, 0, 10);
    setDon(g, 1, 10, 0);
    setChars(g, 1, [{ num: 'OP07-069' }, { num: 'OP07-072' }, { num: 'OP07-007' }]);
    g.players[0].donActive = mine;
    g.players[1].donActive = theirs;
  });
  const targets = (g: GameState) => {
    let s = play(g, 'OP07-118');
    s = yes(s);
    if (s.decision?.tag === 'discard') s = choose(s, (o) => o.uid !== undefined);
    return s.decision!.options.map((o) => o.uid).filter(Boolean);
  };
  // Je joue depuis 10 DON!! ; lui en a 10 : condition vraie
  let g = at(10, 10);
  let list1 = targets(g);
  assert.ok(list1.includes(charUid(g, 1, 'OP07-069')));     // lui-même
  assert.ok(!list1.includes(charUid(g, 1, 'OP07-072')));    // {Foxy Pirates} protégé
  assert.ok(list1.includes(charUid(g, 1, 'OP07-007')));     // autre type
  // condition fausse (il a plus de DON!! que moi)
  g = at(10, 10);
  g.players[1].donActive = 11;
  list1 = targets(g);
  assert.ok(list1.includes(charUid(g, 1, 'OP07-072')));
});

test('Slow-Slow Beam (OP07-075) : DON!! −1, −2000 pour le tour au Leader et à 1 Personnage adverses', () => {
  const me = list(NEUTRAL_L, ['OP07-075'], F);
  const opp = scene([me, OPP], (g) => {
    setHand(g, 0, ['OP07-075']);
    setDon(g, 0, 2);
    setChars(g, 1, [{ num: 'ST21-005' }]);
    oppLeaderDon(g, 1);
  }, 1);
  let s = attack(opp, leaderUid(opp, 1), leaderUid(opp, 0));
  while (s.decision?.kind === 'blocker') s = choose(s, 'noblock');
  const base = power(s, leaderUid(s, 1));
  const uid = s.players[0].hand.find((c) => c.num === 'OP07-075')!.uid;
  s = act(s, `cevent:${uid}`);
  s = yes(s);
  s = choose(s, (o) => o.uid === leaderUid(s, 1));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  assert.ok(logHas(s, /reçoit −2000/));
  assert.ok(s.mods.some((m) => m.uid === leaderUid(s, 1) && m.amount === -2000));
  assert.equal(power(s, leaderUid(s, 1)), base - 2000);
  assert.ok(s.mods.some((m) => m.uid === charUid(s, 1, 'ST21-005') && m.amount === -2000));
});

test('Morgans (OP07-090) : l’adversaire défausse, révèle le reste, puis pioche sans montrer ; main vide : il pioche quand même', () => {
  const at = (hand: string[]) => scene([list(NEUTRAL_L, ['OP07-090'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-090']);
    setHand(g, 1, hand);
    setDon(g, 0, 10);
    setDeckTop(g, 1, ['ST21-013']);
  });
  let s = at(['ST21-005', 'ST21-008', 'ST21-014']);
  s = play(s, 'OP07-090');
  assert.equal(s.decision?.player, 1);
  s = choose(s, (o) => o.num === 'ST21-005' || s.players[1].hand.some((c) => c.uid === o.uid && c.num === 'ST21-005'));
  const hand = s.players[1].hand;
  assert.equal(hand.length, 3);
  assert.equal(s.players[1].trash.at(-1)!.num, 'ST21-005');
  for (const c of hand.filter((x) => x.num !== 'ST21-013')) assert.ok(knows(s, 0, c.uid));
  const drawn = hand.find((c) => c.num === 'ST21-013')!;
  assert.ok(!knows(s, 0, drawn.uid));
  // la vue du joueur 0 montre les cartes révélées, pas la carte piochée
  const v = viewFor(s, 0);
  const seen = v.players[1].hand.map((c) => c.num);
  assert.equal(seen.filter((n) => n === 'ST21-008' || n === 'ST21-014').length, 2);
  assert.ok(!seen.includes('ST21-013'));
  s = at([]);
  s = play(s, 'OP07-090');
  assert.deepEqual(s.players[1].hand.map((c) => c.num), ['ST21-013']);
});

test('Luffy (OP07-091) : Défausse (pas un KO) puis autant de cartes qu’on veut ; +1000 par tranche de 3 (Q&A : 5 cartes, +1000)', () => {
  const trash = ['OP07-044', 'OP07-089', 'OP07-085', 'OP07-071', 'OP07-118', 'OP07-090', 'OP07-075'];
  const me = list(LUCCI_L, ['OP07-091'], F);
  const at = () => scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-091' }]);
    setChars(g, 1, [{ num: 'ST21-005' }]);
    g.players[1].chars.forEach((c) => { g.mods.push({ uid: c.uid, stat: 'cost', amount: -9, until: 'turn', source: 'essai' }); });
    g.players[0].trash = trash.map((num, i) => ({ uid: 8000 + i, num }));
  });
  let s = at();
  const uid = charUid(s, 0, 'OP07-091');
  s = attack(s, uid, leaderUid(s, 1));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  assert.equal(s.players[1].trash.at(-1)!.num, 'ST21-005');
  assert.ok(!logHas(s, /mis KO/));
  // seules les cartes Personnage de coût 4 ou plus sont proposées
  const nums = s.decision!.options.map((o) => o.num).filter(Boolean);
  assert.ok(!nums.includes('OP07-090'));
  assert.ok(!nums.includes('OP07-075'));
  for (let i = 0; i < 5; i++) s = choose(s, (o) => o.num !== undefined);
  s = keepOrder(s);
  assert.equal(power(s, uid), CARDS['OP07-091'].power! + 1000);
  assert.equal(s.players[0].trash.length, 2);
  // aucune carte : pas de bonus
  s = at();
  s = attack(s, uid, leaderUid(s, 1));
  s = choose(s, 'none');
  s = choose(s, 'none');
  assert.equal(power(s, charUid(s, 0, 'OP07-091')), CARDS['OP07-091'].power!);
  assert.equal(s.players[0].trash.length, trash.length);
});

test('Végapunk (Leader OP07-097) : ne peut pas attaquer ; jouer un Personnage ou un Lieu, un Événement seulement dans la Vie (Q&A)', () => {
  const me = list(VEGAPUNK_L, ['OP07-108', 'OP07-117', 'OP07-114', 'OP07-098'], F);
  const at = (hand: string[]) => scene([me, OPP], (g) => { setHand(g, 0, hand); setDon(g, 0, 1); });
  let s = at(['OP07-108', 'OP07-117', 'OP07-114', 'ST21-005']);
  assert.ok(!s.decision!.options.some((o) => o.id.startsWith(`attack:${leaderUid(s, 0)}`)));
  const lead = leaderUid(s, 0);
  s = act(s, `act:${lead}`);
  if (s.decision?.tag === 'may') s = yes(s);
  assert.equal(s.players[0].donActive, 0);
  assert.ok(!s.decision!.options.some((o) => o.num === 'ST21-005'));
  // Personnage joué
  s = choose(s, (o) => o.num === 'OP07-108');
  s = choose(s, 'play');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP07-108'));
  assert.ok(!hasOption(s, `act:${lead}`));
  // Personnage dans la Vie, face visible, au-dessus
  s = at(['OP07-108']);
  const life = s.players[0].life.length;
  s = act(s, `act:${lead}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.num === 'OP07-108');
  s = choose(s, 'life');
  assert.equal(s.players[0].life.length, life + 1);
  assert.equal(s.players[0].life[0].num, 'OP07-108');
  assert.equal(s.players[0].life[0].faceUp, true);
  // Événement : directement la Vie, sans question ; il n'est ni joué ni activé
  s = at(['OP07-114']);
  s = act(s, `act:${lead}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.num === 'OP07-114');
  assert.equal(s.players[0].life[0].num, 'OP07-114');
  // Lieu : se joue
  s = at(['OP07-117']);
  s = act(s, `act:${lead}`);
  if (s.decision?.tag === 'may') s = yes(s);
  s = choose(s, (o) => o.num === 'OP07-117');
  s = choose(s, 'play');
  assert.equal(s.players[0].stage?.num, 'OP07-117');
});

// ---------- Recettes : ce que le banc ne mesure pas, et les réponses des Q&A ----------

test('OP07 : toutes les cartes jouables ou en doute ; en doute : OP07-038 et OP07-039 seulement', () => {
  const all = Object.keys(CARDS).filter((num) => num.startsWith('OP07-'));
  assert.equal(all.length, 119);
  assert.deepEqual(all.filter((num) => !['verified', 'coded', 'auto', 'doubt'].includes(confidence(num))), []);
  assert.deepEqual(all.filter((num) => confidence(num) === 'doubt'), ['OP07-038', 'OP07-039']);
});

test('Sterry (OP07-006) : coût −5000 sur le Leader redressé seulement', () => {
  const at = (rested: boolean) => scene([list(NEUTRAL_L, ['OP07-006'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-006', 'ST21-005']);
    setDon(g, 0, 10);
    g.players[0].leader.rested = rested;
  });
  let s = at(false);
  const base = power(s, leaderUid(s, 0));
  s = play(s, 'OP07-006');
  s = yes(s);
  assert.equal(power(s, leaderUid(s, 0)), base - 5000);
  s = at(true);
  s = play(s, 'OP07-006');
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(power(s, leaderUid(s, 0)), base);
});

test('Moda, Salomé, Hattori (OP07-014, 043, 088) : [Votre tour] [Jouée] : une fois en jouant, pas de second bonus (Q&A)', () => {
  for (const [num, leader, named] of [['OP07-014', NEUTRAL_L, 'OP07-119'], ['OP07-043', HANCOCK_L, 'OP07-051'], ['OP07-088', LUCCI_L, 'OP07-093']]) {
    let s = scene([list(leader, [num, named], F), OPP], (g) => {
      setChars(g, 0, [{ num: named }]);
      setHand(g, 0, [num]);
      setDon(g, 0, 10);
    });
    s = play(s, num);
    s = choose(s, (o) => o.uid === charUid(s, 0, named));
    assert.equal(power(s, charUid(s, 0, named)), CARDS[named].power! + 2000, num);
    assert.equal(s.decision?.kind, 'main');
  }
});

test('Bonney (Leader OP07-019) : [Attaque adverse] : refuser à la première attaque, accepter à la seconde, puis plus rien (Q&A)', () => {
  const pass = (g: GameState) => {
    let s = g;
    while (s.decision?.player === 0) s = act(s, s.decision.kind === 'blocker' ? 'noblock' : s.decision.tag === 'trigger' ? 'hand' : 'pass');
    return s;
  };
  let s = scene([list(BONNEY_L, ['OP07-027'], F), OPP], (g) => {
    setDon(g, 0, 3);
    setHand(g, 0, []);
    setChars(g, 1, [{ num: 'ST21-005' }, { num: 'ST21-008' }]);
  }, 1);
  s = attack(s, charUid(s, 1, 'ST21-005'), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may');
  s = pass(no(s));
  assert.equal(s.players[0].donActive, 3);
  s = attack(s, charUid(s, 1, 'ST21-008'), leaderUid(s, 0));
  assert.equal(s.decision?.tag, 'may');
  s = yes(s);
  assert.equal(s.players[0].donActive, 2);
  s = choose(s, (o) => o.uid === leaderUid(s, 1));
  assert.ok(s.players[1].leader.rested);
  s = pass(s);
  assert.notEqual(s.decision?.tag, 'may');
});

test('Koala (OP07-024) : le Personnage qui gagne [Bloqueur] peut bloquer cette attaque-là (Q&A)', () => {
  let s = scene([list(NEUTRAL_L, ['OP07-024', 'OP07-027'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-024' }, { num: 'OP07-027' }]);
    setChars(g, 1, [{ num: 'ST21-005' }]);
  }, 1);
  s = attack(s, charUid(s, 1, 'ST21-005'), leaderUid(s, 0));
  s = yes(s);
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-027'));
  assert.equal(s.decision?.kind, 'blocker');
  assert.ok(s.decision!.options.some((o) => o.uid === charUid(s, 0, 'OP07-027')));
  assert.ok(s.players[0].chars.find((c) => c.num === 'OP07-024')!.rested);
});

test('Fisher Tiger (OP07-032) : attaque un Personnage (pas un Leader) le tour où il est joué', () => {
  let s = scene([list(LUCCI_L, ['OP07-032'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-032']);
    setDon(g, 0, 10);
    setChars(g, 1, [{ num: 'ST21-005', extra: { rested: true } }]);
  });
  s = play(s, 'OP07-032');
  assert.equal(s.decision?.kind, 'main');
  const tiger = s.players[0].chars.find((c) => c.num === 'OP07-032')!;
  const targets = attackTargets(s, 0, tiger);
  assert.ok(targets.includes(charUid(s, 1, 'ST21-005')));
  assert.ok(!targets.includes(leaderUid(s, 1)));
});

test('Doflamingo (OP07-048) : le type et le coût conviennent : jouée épuisée ou au-dessous ; sinon elle reste au-dessus, cachée (n° 1984)', () => {
  const at = (top: string) => scene([list(HANCOCK_L, ['OP07-048', 'OP07-045', 'OP07-044'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-048' }]);
    setDon(g, 0, 5);
    setDeckTop(g, 0, [top]);
  });
  let s = at('OP07-045');
  const uid = charUid(s, 0, 'OP07-048');
  s = act(s, `act:${uid}`);
  s = yes(s);
  assert.ok(s.players[0].chars.find((c) => c.num === 'OP07-045')!.rested);
  assert.ok(!hasOption(s, `act:${uid}`));
  // convient, mais on ne la joue pas : au-dessous
  s = at('OP07-045');
  s = act(s, `act:${charUid(s, 0, 'OP07-048')}`);
  s = no(s);
  assert.equal(s.players[0].deck.at(-1)!.num, 'OP07-045');
  // coût trop élevé : elle reste au-dessus
  s = at('OP07-044');
  s = act(s, `act:${charUid(s, 0, 'OP07-048')}`);
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].deck[0].num, 'OP07-044');
});

test('Snake Dance (OP07-055) : [Contre] +4000, puis renvoi d’un de ses Personnages ; [Déclenchement] à coût', () => {
  const me = list(NEUTRAL_L, ['OP07-055', 'OP07-027'], F);
  const { s, gain } = counterGain(scene([me, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-027' }]);
    setHand(g, 0, ['OP07-055']);
    setDon(g, 0, 10);
    oppLeaderDon(g, 1);
  }, 1), 'OP07-055', (g) => choose(g, (o) => o.uid === charUid(g, 0, 'OP07-027')));
  assert.equal(gain, 4000);
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP07-027'));
  let t = triggerFromLife(me, 'OP07-055', (g) => {
    setChars(g, 0, [{ num: 'OP07-027' }]);
    setChars(g, 1, [{ num: 'ST21-005' }]);
  });
  t = yes(t);
  const mine = t.players[0].chars.find((c) => c.num === 'OP07-027');
  if (mine && t.decision?.options.some((o) => o.uid === mine.uid)) t = choose(t, (o) => o.uid === mine.uid);
  t = choose(t, (o) => o.uid === charUid(t, 1, 'ST21-005'));
  assert.ok(t.players[0].hand.some((c) => c.num === 'OP07-027'));
  assert.ok(t.players[1].hand.some((c) => c.num === 'ST21-005'));
});

test('Île des femmes (OP07-058) : défausser et épuiser le Lieu : avec le Leader {Kuja Pirates}, renvoi d’un Personnage {Amazon Lily} ou {Kuja Pirates}', () => {
  const at = (leader: string) => scene([list(leader, ['OP07-058', 'OP07-041', 'OP07-027'], F), OPP], (g) => {
    g.players[0].stage = { uid: 9000, num: 'OP07-058', rested: false, don: 0, playedTurn: 0, usedOpt: [] };
    setChars(g, 0, [{ num: 'OP07-041' }, { num: 'OP07-027' }]);
    setHand(g, 0, ['OP07-027']);
  });
  const pay = (g: GameState) => {
    let s = act(g, 'act:9000');
    if (s.decision?.tag === 'may') s = yes(s);
    if (s.decision?.tag === 'discard' || s.decision?.tag === 'mayDiscard') s = choose(s, (o) => o.uid !== undefined);
    return s;
  };
  let s = pay(at(HANCOCK_L));
  assert.ok(s.players[0].stage!.rested);
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 0, 'OP07-027')));
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-041'));
  assert.ok(s.players[0].hand.some((c) => c.num === 'OP07-041'));
  assert.equal(s.players[0].trash.at(-1)!.num, 'OP07-027');
  // autre Leader : le coût est payé, rien ne suit
  s = pay(at(NEUTRAL_L));
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].chars.length, 2);
});

test('Big Bun (OP07-070) : autant de DON!! ou moins : un Personnage {Foxy Pirates} de coût 4 ou moins ; un Événement du type n’est pas proposé', () => {
  const at = (mine: number, theirs: number) => scene([list(FOXY_L, ['OP07-070', 'OP07-072', 'OP07-075'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-070', 'OP07-072', 'OP07-075']);
    setDon(g, 0, mine);
    setDon(g, 1, theirs);
  });
  // plus de DON!! que l'adversaire : rien
  let s = play(at(10, 4), 'OP07-070');
  assert.equal(s.decision?.kind, 'main');
  s = play(at(7, 8), 'OP07-070');
  assert.ok(s.decision!.options.some((o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === 'OP07-072')));
  assert.ok(!s.decision!.options.some((o) => s.players[0].hand.some((c) => c.uid === o.uid && c.num === 'OP07-075')));
});

test('Foxy (OP07-071) : [Tour adverse] −1000 aux Personnages adverses avec le Leader ; pas à mon tour, pas sans le Leader', () => {
  const at = (leader: string, active: PlayerId) => scene([list(leader, ['OP07-071'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-071' }]);
    setChars(g, 1, [{ num: 'ST21-005' }]);
  }, active);
  const base = CARDS['ST21-005'].power!;
  let s = at(FOXY_L, 1);
  assert.equal(power(s, charUid(s, 1, 'ST21-005')), base - 1000);
  s = at(FOXY_L, 0);
  assert.equal(power(s, charUid(s, 1, 'ST21-005')), base);
  s = at(NEUTRAL_L, 1);
  assert.equal(power(s, charUid(s, 1, 'ST21-005')), base);
});

test('Stussy (OP07-085) : sans autre Personnage, elle peut se placer elle-même dans la Défausse pour mettre KO (Q&A)', () => {
  let s = scene([list(LUCCI_L, ['OP07-085'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-085']);
    setDon(g, 0, 10);
    setChars(g, 1, [{ num: 'ST21-005' }]);
  });
  s = play(s, 'OP07-085');
  s = yes(s);
  const stussy = s.players[0].chars.find((c) => c.num === 'OP07-085');
  if (stussy && s.decision?.options.some((o) => o.uid === stussy.uid)) s = choose(s, (o) => o.uid === stussy.uid);
  assert.ok(!s.players[0].chars.some((c) => c.num === 'OP07-085'));
  assert.equal(s.players[0].trash.at(-1)!.num, 'OP07-085');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'ST21-005'));
});

test('Rob Lucci (OP07-093) : l’adversaire défausse, puis je choisis une carte de sa Défausse, placée au-dessous de son deck (Q&A)', () => {
  let s = scene([list(LUCCI_L, ['OP07-093', 'OP07-089'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-093']);
    setHand(g, 1, ['ST21-005', 'ST21-008']);
    setDon(g, 0, 10);
    g.players[0].trash = ['OP07-089', 'OP07-089', 'OP07-089'].map((num, i) => ({ uid: 8000 + i, num }));
    g.players[1].trash = [{ uid: 8100, num: 'ST21-014' }];
  });
  s = play(s, 'OP07-093');
  s = yes(s);
  for (let i = 0; i < 3 && s.decision?.tag === 'trashToDeck'; i++) s = choose(s, (o) => o.uid !== undefined);
  s = keepOrder(s);
  assert.equal(s.decision?.player, 1);
  s = choose(s, (o) => s.players[1].hand.some((c) => c.uid === o.uid && c.num === 'ST21-005'));
  // à moi de choisir, la carte défaussée comprise
  if (s.decision?.tag === 'may') s = yes(s);
  assert.equal(s.decision?.player, 0);
  assert.ok(s.decision!.options.some((o) => s.players[1].trash.some((c) => c.uid === o.uid && c.num === 'ST21-005')));
  s = choose(s, (o) => o.uid === 8100);
  s = keepOrder(s);
  assert.equal(s.players[1].deck.at(-1)!.num, 'ST21-014');
  assert.equal(s.players[1].trash.length, 1);
});

test('Shave, Iron Body, Tempest Kick (OP07-094, 095, 096) : avec 9 cartes en Défausse, l’Événement activé fait la dixième (Q&A)', () => {
  const trash = (g: GameState, n: number) => { g.players[0].trash = Array.from({ length: n }, (_, i) => ({ uid: 8000 + i, num: 'ST21-005' })); };
  // Shave
  const shave = list(LUCCI_L, ['OP07-094', 'OP07-089'], F);
  const atS = (n: number) => scene([shave, OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-089' }]);
    setHand(g, 0, ['OP07-094']);
    setDon(g, 0, 10);
    trash(g, n);
    oppLeaderDon(g, 1);
  }, 1);
  let r = counterGain(atS(9), 'OP07-094', (g) => choose(g, (o) => o.uid === charUid(g, 0, 'OP07-089')));
  assert.equal(r.gain, 2000);
  assert.ok(r.s.players[0].hand.some((c) => c.num === 'OP07-089'));
  r = counterGain(atS(8), 'OP07-094');
  assert.equal(r.gain, 2000);
  assert.ok(r.s.players[0].chars.some((c) => c.num === 'OP07-089'));
  // Iron Body
  const iron = list(LUCCI_L, ['OP07-095'], F);
  const atI = (n: number) => scene([iron, OPP], (g) => {
    setHand(g, 0, ['OP07-095']);
    setDon(g, 0, 10);
    trash(g, n);
    oppLeaderDon(g, 1);
  }, 1);
  assert.equal(counterGain(atI(9), 'OP07-095').gain, 6000);
  assert.equal(counterGain(atI(8), 'OP07-095').gain, 4000);
  // Tempest Kick
  const kick = list(LUCCI_L, ['OP07-096'], F);
  const atK = (n: number) => scene([kick, OPP], (g) => {
    setHand(g, 0, ['OP07-096']);
    setDon(g, 0, 10);
    setChars(g, 1, [{ num: 'ST21-014' }]);
    trash(g, n);
  });
  let s = play(atK(9), 'OP07-096');
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-014'));
  assert.equal(fieldCost(s, charUid(s, 1, 'ST21-014')), Math.max(0, CARDS['ST21-014'].cost! - 3));
  s = play(atK(8), 'OP07-096');
  assert.equal(s.decision?.kind, 'main');
});

test('Pythagoras (OP07-105) : [En cas de KO] avec 2 Vies ou moins, un Personnage {Egghead} de coût 4 ou moins de la Défausse, épuisé', () => {
  const me = list(VEGAPUNK_L, ['OP07-105', 'OP07-108'], F);
  const at = (life: number) => scene([list(LUCCI_L, ['OP07-118'], F), me], (g) => {
    setHand(g, 0, ['OP07-118', 'OP07-118']);
    setDon(g, 0, 10);
    setChars(g, 1, [{ num: 'OP07-105' }]);
    g.players[1].trash = [{ uid: 8000, num: 'OP07-108' }];
    g.players[1].life = g.players[1].life.slice(0, life);
  });
  const hit = (g: GameState) => {
    let s = play(g, 'OP07-118');
    s = yes(s);
    if (s.decision?.tag === 'discard' || s.decision?.tag === 'mayDiscard') s = choose(s, (o) => o.uid !== undefined);
    return choose(s, (o) => o.uid === charUid(s, 1, 'OP07-105'));
  };
  let s = hit(at(2));
  s = choose(s, (o) => o.uid === 8000);
  assert.ok(s.players[1].chars.find((c) => c.num === 'OP07-108')!.rested);
  s = hit(at(3));
  assert.ok(!s.players[1].chars.some((c) => c.num === 'OP07-108'));
});

test('Atlas (OP07-098) : [Déclenchement] « jouez cette carte » avec Vegapunk en Leader, pas sans ; pas de KO en combat avec moins de Vies', () => {
  let s = triggerFromLife(list(VEGAPUNK_L, ['OP07-098'], F), 'OP07-098');
  assert.ok(s.players[0].chars.some((c) => c.num === 'OP07-098'));
  s = triggerFromLife(list(NEUTRAL_L, ['OP07-098'], F), 'OP07-098');
  assert.ok(!s.players[0].chars.some((c) => c.num === 'OP07-098'));
  const at = (life: number) => scene([list(NEUTRAL_L, ['OP07-098'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-098', extra: { rested: true } }]);
    setHand(g, 0, []);
    oppLeaderDon(g, 5);
    g.players[0].life = g.players[0].life.slice(0, life);
    g.players[1].life = g.players[1].life.slice(0, 3);
  }, 1);
  const hit = (g: GameState) => {
    let t = attack(g, leaderUid(g, 1), charUid(g, 0, 'OP07-098'));
    while (t.decision?.player === 0) t = act(t, t.decision.kind === 'blocker' ? 'noblock' : 'pass');
    return t;
  };
  assert.ok(hit(at(2)).players[0].chars.some((c) => c.num === 'OP07-098'));
  assert.ok(!hit(at(3)).players[0].chars.some((c) => c.num === 'OP07-098'));
});

test('Lucy (OP07-112) : Vie en main, épuiser facultatif, puis avec 1 Vie ou moins, carte du deck dans la Vie (facultatif), une fois par tour', () => {
  const at = (life: number) => scene([list(NEUTRAL_L, ['OP07-112'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-112' }]);
    setChars(g, 1, [{ num: 'ST21-005' }]);
    g.players[0].life = g.players[0].life.slice(0, life);
  });
  const pay = (g: GameState) => {
    let s = yes(attack(g, charUid(g, 0, 'OP07-112'), leaderUid(g, 1)));
    if (s.decision?.options.some((o) => /life|top/i.test(o.id))) s = act(s, s.decision!.options.find((o) => /top/i.test(o.id))?.id ?? s.decision!.options[0].id);
    return s;
  };
  // 2 Vies : il en reste 1 après le coût : la carte du deck peut revenir, avec ou sans cible épuisée
  let s = pay(at(2));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  assert.ok(s.players[1].chars[0].rested);
  assert.equal(s.decision?.tag, 'may');
  s = yes(s);
  assert.equal(s.players[0].life.length, 2);
  // même chose, en refusant tout
  s = pay(at(2));
  s = choose(s, 'none');
  s = no(s);
  assert.equal(s.players[0].life.length, 1);
  assert.ok(!s.players[1].chars[0].rested);
  // 3 Vies : il en reste 2 : pas de carte du deck
  s = pay(at(3));
  s = choose(s, 'none');
  assert.notEqual(s.decision?.tag, 'may');
  assert.equal(s.players[0].life.length, 2);
});

test('I Re-Quasar (OP07-115) : [Contre] +3000 avec 2 Vies ou moins ; [Déclenchement] Personnage {Egghead} de coût 5 ou moins de la Défausse', () => {
  const me = list(NEUTRAL_L, ['OP07-115', 'OP07-108', 'OP07-114'], F);
  const at = (life: number) => scene([me, OPP], (g) => {
    setHand(g, 0, ['OP07-115']);
    setDon(g, 0, 10);
    g.players[0].life = g.players[0].life.slice(0, life);
    oppLeaderDon(g, 1);
  }, 1);
  assert.equal(counterGain(at(2), 'OP07-115').gain, 3000);
  assert.equal(counterGain(at(3), 'OP07-115').gain, 0);
  let s = triggerFromLife(me, 'OP07-115', (g) => {
    g.players[0].trash = [{ uid: 8000, num: 'OP07-108' }, { uid: 8001, num: 'OP07-114' }];
  });
  assert.ok(!s.decision!.options.some((o) => o.uid === 8001));
  s = choose(s, (o) => o.uid === 8000);
  assert.equal(s.players[0].chars.find((c) => c.num === 'OP07-108')!.rested, false);
});

test('Brise-flammes (OP07-116) : +1000 pour le tour ; puis, avec 2 Vies adverses ou moins, épuiser un Personnage adverse', () => {
  const me = list(NEUTRAL_L, ['OP07-116'], F);
  const main = (life: number) => scene([me, OPP], (g) => {
    setHand(g, 0, ['OP07-116']);
    setDon(g, 0, 10);
    setChars(g, 1, [{ num: 'ST21-005' }]);
    g.players[1].life = g.players[1].life.slice(0, life);
  });
  let s = play(main(2), 'OP07-116');
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  assert.ok(logHas(s, /\+1000/));
  s = choose(s, (o) => o.uid === charUid(s, 1, 'ST21-005'));
  assert.ok(s.players[1].chars[0].rested);
  s = play(main(3), 'OP07-116');
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  assert.equal(s.decision?.kind, 'main');
});

test('Egghead (OP07-117) : [Fin de votre tour] avec 3 Vies ou moins, redresser un de ses Personnages {Egghead} de coût 5 ou moins', () => {
  const at = (life: number) => scene([list(NEUTRAL_L, ['OP07-117', 'OP07-108'], F), OPP], (g) => {
    g.players[0].stage = { uid: 9000, num: 'OP07-117', rested: false, don: 0, playedTurn: 0, usedOpt: [] };
    setChars(g, 0, [{ num: 'OP07-108', extra: { rested: true } }]);
    g.players[0].life = g.players[0].life.slice(0, life);
  });
  let s = at(3);
  s = choose(s, (o) => o.id === 'end' || o.id === 'pass' || /fin/i.test(o.label));
  assert.equal(s.decision?.player, 0);
  assert.ok(s.decision!.options.some((o) => o.uid === charUid(s, 0, 'OP07-108')));
  s = at(4);
  s = choose(s, (o) => o.id === 'end' || o.id === 'pass' || /fin/i.test(o.label));
  assert.notEqual(s.decision?.player, 0);
});

test('Portgas D. Ace (OP07-119) : ne pas ajouter de Vie n’empêche pas [Initiative] avec 2 Vies ou moins (Q&A)', () => {
  const at = (life: number) => scene([list(NEUTRAL_L, ['OP07-119'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-119']);
    setDon(g, 0, 10);
    g.players[0].life = g.players[0].life.slice(0, life);
    setChars(g, 1, []);
  });
  // la carte du deck est refusée si la question est posée
  const refuse = (g: GameState) => {
    if (g.decision?.options.some((o) => o.id === 'no')) return no(g);
    if (g.decision?.options.some((o) => o.id === 'none')) return choose(g, 'none');
    return g;
  };
  let s = play(at(2), 'OP07-119');
  assert.equal(s.decision?.tag, 'may');
  s = refuse(s);
  assert.equal(s.players[0].life.length, 2);
  assert.ok(s.decision!.options.some((o) => o.id === `attack:${charUid(s, 0, 'OP07-119')}:${leaderUid(s, 1)}`));
  s = refuse(play(at(4), 'OP07-119'));
  assert.ok(!s.decision!.options.some((o) => o.id.startsWith(`attack:${charUid(s, 0, 'OP07-119')}:`)));
});

test('Valeurs calculées (OP07-062, 065, 066, 068, 078) : la comparaison des DON!! compte tout le terrain, données comprises ; égalité permise', () => {
  const donCount = (s: GameState, p: PlayerId) => s.players[p].donActive + s.players[p].donRested + s.players[p].leader.don + s.players[p].chars.reduce((n, c) => n + c.don, 0);
  // Gina : Leader {Foxy Pirates} et DON!! ≤ : 1 DON!! redressée
  const gina = (leader: string, mine: number, theirs: number) => scene([list(leader, ['OP07-065'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-065']);
    setDon(g, 0, mine);
    setDon(g, 1, theirs);
  });
  let s = play(gina(FOXY_L, 4, 4), 'OP07-065');
  assert.equal(donCount(s, 0), 5);
  s = play(gina(FOXY_L, 5, 4), 'OP07-065');
  assert.equal(donCount(s, 0), 5);
  s = play(gina(NEUTRAL_L, 4, 4), 'OP07-065');
  assert.equal(donCount(s, 0), 4);
  // Chopper : DON!! épuisée, avec DON!! données comprises dans le compte
  const chopper = (given: number, theirs: number) => scene([list(NEUTRAL_L, ['OP07-066'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-066']);
    setDon(g, 0, 4);
    g.players[0].leader.don = given;
    g.players[0].donDeck -= given;
    setDon(g, 1, theirs);
  });
  s = play(chopper(0, 4), 'OP07-066');
  assert.equal(s.players[0].donRested, 3);
  s = play(chopper(1, 4), 'OP07-066');
  assert.equal(s.players[0].donRested, 2);
  // Reiju : renvoie un {The Vinsmoke Family} de coût 1
  let r = scene([list(NEUTRAL_L, ['OP07-062', 'OP07-061'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-061' }]);
    setHand(g, 0, ['OP07-062']);
    setDon(g, 0, 4);
    setDon(g, 1, 4);
  });
  r = play(r, 'OP07-062');
  r = choose(r, (o) => o.uid === charUid(r, 0, 'OP07-061'));
  assert.ok(r.players[0].hand.some((c) => c.num === 'OP07-061'));
  // Hamburg : [DON!! x1] [En attaquant]
  const hamburg = (don: number) => scene([list(NEUTRAL_L, ['OP07-068'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-068', extra: { don } }]);
    g.players[0].donDeck -= don;
    setDon(g, 0, 0);
    setDon(g, 1, 4);
  });
  s = hamburg(1);
  s = attack(s, charUid(s, 0, 'OP07-068'), leaderUid(s, 1));
  assert.equal(s.players[0].donRested, 1);
  s = hamburg(0);
  s = attack(s, charUid(s, 0, 'OP07-068'), leaderUid(s, 1));
  assert.equal(s.players[0].donRested, 0);
  // Megaton : redresse une carte [Foxy], Leader compris ; [Déclenchement] DON!! redressée
  const mega = (theirs: number) => scene([list(FOXY_L, ['OP07-078', 'OP07-071', 'OP07-072'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-071', extra: { rested: true } }, { num: 'OP07-072', extra: { rested: true } }]);
    setHand(g, 0, ['OP07-078']);
    g.players[0].leader.rested = true;
    setDon(g, 0, 4);
    setDon(g, 1, theirs);
  });
  s = play(mega(4), 'OP07-078');
  assert.ok(s.decision!.options.some((o) => o.uid === leaderUid(s, 0)));
  assert.ok(!s.decision!.options.some((o) => o.uid === charUid(s, 0, 'OP07-072')));
  s = choose(s, (o) => o.uid === leaderUid(s, 0));
  assert.equal(s.players[0].leader.rested, false);
  s = play(mega(3), 'OP07-078');
  assert.equal(s.decision?.kind, 'main');
  assert.equal(s.players[0].leader.rested, true);
});

test('Boa Hancock (OP07-051) et Crocodile (OP07-040) : la cible sans « de vos » peut être un de ses propres Personnages', () => {
  const at = () => scene([list(HANCOCK_L, ['OP07-051', 'OP07-013'], F), OPP], (g) => {
    setChars(g, 0, [{ num: 'OP07-013' }]);
    setHand(g, 0, ['OP07-051']);
    setDon(g, 0, 10);
  });
  let s = play(at(), 'OP07-051');
  s = choose(s, (o) => o.uid === charUid(s, 0, 'OP07-013'));
  assert.equal(s.players[0].deck.at(-1)!.num, 'OP07-013');
  assert.ok(!s.players[0].chars.some((c) => c.num === 'OP07-013'));
});

test('He Possesses (OP07-114) : lui-même n’est pas proposé ; Lilith (OP07-111) : carte révélée, [Déclenchement] avec Vegapunk', () => {
  let s = scene([list(VEGAPUNK_L, ['OP07-114', 'OP07-108'], F), OPP], (g) => {
    setHand(g, 0, ['OP07-114']);
    setDon(g, 0, 10);
    setDeckTop(g, 0, ['OP07-114', 'OP07-108']);
  });
  s = play(s, 'OP07-114');
  const nums = s.decision!.options.map((o) => o.num).filter(Boolean);
  assert.ok(nums.includes('OP07-108'));
  assert.ok(!nums.includes('OP07-114'));
  const t = triggerFromLife(list(VEGAPUNK_L, ['OP07-111'], F), 'OP07-111');
  assert.ok(t.players[0].chars.some((c) => c.num === 'OP07-111'));
});
