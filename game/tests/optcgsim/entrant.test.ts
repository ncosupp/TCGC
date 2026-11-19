// OPTCGSim -> joy-boy (tâche O2.2) : chaque RPC reçue passe par le miroir puis, traduite en positions du moteur, par les
// mutations externes ; le moteur et le miroir restent alignés carte par carte (compareTables), les échos des coups de
// joy-boy déjà faits par le moteur ne sont pas rejoués, les cartes inconnues deviennent opaques, et les deux parties
// réelles du 17 nov. se rejouent jusqu'au bout sans écart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HIDDEN } from '../../engine/cards/registry.ts';
import { DECKS } from '../../engine/decks.ts';
import { invariantErrors } from '../../engine/invariants.ts';
import { def, power } from '../../engine/rules.ts';
import type { GameState } from '../../engine/types.ts';
import { answerExternal, applyExternal } from '../../online/optcgsim/external.ts';
import {
  compareTables, createTable, type CrossTable, flush, type InboundOptions, type InboundResult, isOpaque, receive, unknownCards, withGame,
} from '../../online/optcgsim/inbound.ts';
import type { External, Rpc, Seat } from '../../online/optcgsim/types.ts';

const HOTE: Seat = 0;
const JOYBOY: Seat = 1;
const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const rpc = (name: string, values: Record<string, unknown> = {}): Rpc => ({ name: `${name}ClientRpc`, object: 1, behaviour: 0, values });

interface Suite { table: CrossTable; applied: External[]; errors: string[]; last: InboundResult }
/** Joue une suite [nom, valeurs, envoyeur] ; rend la table finale, toutes les mutations appliquées et tous les écarts. */
function jouer(table: CrossTable, coups: [string, Record<string, unknown>, Seat][], opts: InboundOptions = {}): Suite {
  let last!: InboundResult;
  const applied: External[] = [];
  const errors: string[] = [];
  for (const [n, v, s] of coups) {
    last = receive(table, rpc(n, v), s, opts);
    table = last.table;
    applied.push(...last.applied);
    errors.push(...last.errors);
  }
  return { table, applied, errors, last };
}

const game = (t: CrossTable): GameState => {
  assert.ok(t.game, 'moteur créé');
  return t.game;
};
const aligne = (t: CrossTable) => {
  assert.deepEqual(compareTables(t), []);
  if (!t.game?.decision?.inEffect) assert.deepEqual(invariantErrors(game(t)), []);
};
const cartes = (id: string) => Object.entries(DECKS[id].cards).flatMap(([n, k]) => Array.from({ length: k }, () => n));

/** Mise en place des deux joueurs, comme le jeu : nom, deck vide, leader, cartes par indice (dessus = dernier indice). */
function miseEnPlace(hote: { leader: string; cards: string[] }, joy: { leader: string; cards: string[] }, opts: InboundOptions = {}): CrossTable {
  let t = createTable({ seed: 7 });
  for (const [seat, d, nom] of [[HOTE, hote, 'Hote#0001'], [JOYBOY, joy, 'Invite#0002']] as const) {
    t = jouer(t, [['SetName', { sName: nom, bSpectator: false }, seat], ['MakeEmptyDeckList', { iDeckSize: d.cards.length }, seat],
      ['LoadLeader', { sCardID: d.leader, sPlayerName: nom }, seat]], opts).table;
    for (let i = 0; i < d.cards.length; i++) t = receive(t, rpc('LoadDeckCard', { sCardID: d.cards[i], iIdx: i }), seat, opts).table;
  }
  return t;
}
const melange = (n: number, decale = 7) => Array.from({ length: n }, (_, i) => (i * decale + 3) % n).join('-');

/** Ouverture complète : l'hôte commence, garde puis repioche ; joy-boy garde. Rend la table au début du tour 1 de l'hôte. */
function ouverture(hote = { leader: 'ST01-001', cards: cartes('ST-01') }, opts: InboundOptions = {}): CrossTable {
  const t = miseEnPlace(hote, { leader: 'ST21-001', cards: cartes('ST-21') }, opts);
  const n = hote.cards.length;
  return jouer(t, [
    ['ChooseTurnOrder', { iFirst: 1 }, HOTE], ['ShuffleDeck', { s_ShuffleString: melange(n) }, HOTE], ['DrawCard', { iCount: 5 }, HOTE],
    ['ShuffleDeck', { s_ShuffleString: melange(50, 11) }, JOYBOY], ['DrawCard', { iCount: 5 }, JOYBOY], ['PopulateLifeDeck', { iLifeCount: 5 }, JOYBOY],
    ['MoveHandToDeck', {}, HOTE], ['ShuffleDeck', { s_ShuffleString: melange(n, 13) }, HOTE], ['DrawCard', { iCount: 5 }, HOTE],
    ['PopulateLifeDeck', { iLifeCount: 5 }, HOTE],
  ], opts).table;
}
/** Position dans la main du miroir de la première carte qui répond au critère. */
const enMain = (t: CrossTable, seat: Seat, ok: (num: string) => boolean) => {
  const i = t.mirror.players[seat].zones.hand.findIndex((c) => ok(c.code));
  assert.ok(i >= 0, 'carte en main');
  return i;
};
const personnage = (n: number) => (code: string) => def(code).category === 'CHARACTER' && (def(code).cost ?? 99) <= n;

test('mise en place : le moteur naît quand les deux decks sont chargés, carte par carte liée au miroir', () => {
  const t = miseEnPlace({ leader: 'ST01-001', cards: cartes('ST-01') }, { leader: 'ST21-001', cards: cartes('ST-21') });
  const s = game(t);
  assert.equal(s.players[HOTE].name, 'Hote#0001');
  assert.equal(s.players[JOYBOY].leader.num, 'ST21-001');
  assert.equal(s.players[HOTE].deck.length, 50);
  // dessus du deck : dernier élément du miroir, premier du moteur
  const m = t.mirror.players[HOTE].zones.deck;
  assert.equal(s.players[HOTE].deck[0].uid, m.at(-1)!.uid);
  assert.equal(s.players[HOTE].deck[0].num, m.at(-1)!.code);
  assert.equal(t.mirror.players[JOYBOY].leader.uid, s.players[JOYBOY].leader.uid);
  assert.deepEqual(unknownCards(t), []);
  assert.equal(s.flow.stage, 'mulligan');
  aligne(t);
});

test('ouverture reprise des RPC des deux joueurs : main de départ montrée à joy-boy, puis premier tour de l’hôte', () => {
  let t = miseEnPlace({ leader: 'ST01-001', cards: cartes('ST-01') }, { leader: 'ST21-001', cards: cartes('ST-21') });
  t = jouer(t, [['ChooseTurnOrder', { iFirst: 1 }, HOTE], ['ShuffleDeck', { s_ShuffleString: melange(50) }, HOTE], ['DrawCard', { iCount: 5 }, HOTE]]).table;
  assert.equal(game(t).players[HOTE].hand.length, 5);
  assert.notEqual(game(t).decision?.player, JOYBOY, 'pas de question avant d’avoir sa main');
  const r = jouer(t, [['ShuffleDeck', { s_ShuffleString: melange(50, 11) }, JOYBOY], ['DrawCard', { iCount: 5 }, JOYBOY]]);
  t = r.table;
  assert.equal(r.applied.filter((e) => e.kind === 'move').length, 5, 'l’ouverture de joy-boy n’est pas jouée par le moteur : reprise de l’écho');
  assert.equal(game(t).decision?.kind, 'mulligan');
  assert.equal(game(t).decision?.player, JOYBOY);
  aligne(t);
  t = ouverture();
  const s = game(t);
  assert.equal(s.turn, 1);
  assert.equal(s.active, HOTE);
  assert.equal(s.first, HOTE);
  assert.equal(s.flow.stage, 'main');
  assert.equal(s.decision?.player, HOTE);
  assert.equal(s.players[HOTE].life.length, 5);
  assert.equal(s.players[JOYBOY].hand.length, 5);
  assert.equal(s.players[HOTE].donActive, 0, 'phase DON!! du joueur OPTCGSim : elle arrive en RPC');
  assert.deepEqual(t.errors, []);
  aligne(t);
});

test('tour de l’hôte : DON!!, Personnage joué, DON!! donnée, attaque (inclinaison mise de côté jusqu’au SetupAttack)', () => {
  let t = ouverture();
  const i = enMain(t, HOTE, personnage(1));
  const code = t.mirror.players[HOTE].zones.hand[i].code;
  let r = jouer(t, [['DrawDon', { iCount: 1 }, HOTE], ['TapDon', { iCount: 1 }, HOTE], ['MoveHandCardToDeploy', { iIdx: i, bRested: false }, HOTE]]);
  t = r.table;
  const P = game(t).players[HOTE];
  assert.deepEqual([P.donActive, P.donRested, P.donDeck], [0, 1, 9]);
  assert.equal(P.chars[0].num, code);
  assert.equal(P.hand.length, 4);
  aligne(t);
  // tour 3 : pioche de la phase de Pioche, 2 DON!!, une donnée au Leader, attaque du Leader
  t = jouer(t, [['EndTurn', {}, HOTE]]).table;
  assert.equal(game(t).active, JOYBOY, 'le moteur joue le tour de joy-boy : pioche et DON!!');
  t = jouer(t, [['DrawCard', { iCount: 1 }, JOYBOY], ['DrawDon', { iCount: 2 }, JOYBOY]]).table;
  t = withGame(t, answerExternal(game(t), 'end')).table;
  r = jouer(t, [['EndTurn', {}, JOYBOY]]);
  t = r.table;
  assert.deepEqual(r.applied, [], 'écho de la fin de tour : le moteur y est déjà');
  t = jouer(t, [['DrawCard', { iCount: 1 }, HOTE], ['DrawDon', { iCount: 2 }, HOTE], ['AttachDonToCard', { iCardIdx: -1, iDonIdx: 2 }, HOTE]]).table;
  assert.equal(game(t).players[HOTE].leader.don, 1);
  aligne(t);
  r = jouer(t, [['TapCard', { iCardIndex: -1 }, HOTE]]);
  assert.deepEqual(r.applied, [], 'inclinaison mise de côté');
  assert.equal(game(r.table).players[HOTE].leader.rested, false);
  r = jouer(r.table, [['SetTimer', { fTime: 1 }, HOTE], ['SetupAttack', { iAttackerIdx: -1, iDefenderIdx: -1 }, HOTE]]);
  assert.deepEqual(r.applied, [{ kind: 'rest', player: HOTE, zone: 'leader', index: 0 }]);
  t = r.table;
  // joy-boy ne bloque pas ; le défenseur résout : 6000 contre 5000, une Vie de joy-boy passe en main
  const vies = game(t).players[JOYBOY].life.length;
  r = jouer(t, [['NoBlocker', {}, JOYBOY], ['ResolveAttack', {}, JOYBOY]]);
  t = r.table;
  assert.equal(game(t).players[JOYBOY].life.length, vies - 1);
  assert.equal(r.applied.at(-1)?.kind, 'move');
  assert.deepEqual(t.errors, []);
  aligne(t);
});

test('pioche par un effet, défausse et KO imposés à joy-boy', () => {
  let t = ouverture();
  // joy-boy a posé un Personnage (écho en retard sur un moteur qui ne l'a pas joué : rattrapé)
  const j = enMain(t, JOYBOY, personnage(10));
  const nom = def(t.mirror.players[JOYBOY].zones.hand[j].code).name;
  t = jouer(t, [['MoveHandCardToDeploy', { iIdx: j, bRested: false }, JOYBOY]]).table;
  assert.equal(game(t).players[JOYBOY].chars.length, 1);
  const r = jouer(t, [['DrawDon', { iCount: 1 }, HOTE], ['DrawCard', { iCount: 1 }, HOTE], ['DrawCard', { iCount: 2 }, HOTE],
    ['MoveOpponentHandCardToDiscard', { iCardIdx: 0 }, HOTE], ['DiscardFromDeploy', { iCardIndex: 0 }, HOTE]]);
  t = r.table;
  const s = game(t);
  assert.equal(s.players[HOTE].hand.length, 8);
  assert.equal(s.players[JOYBOY].trash.length, 2);
  assert.equal(s.players[JOYBOY].discardedTurn, s.turn, 'défausse imposée par un effet');
  assert.ok(s.log.some((l) => l.text === `${nom} est mis KO par un effet`), 'KO par un effet');
  if (!s.decision?.inEffect) aligne(t);
  assert.deepEqual(t.errors, []);
});

test('bonus : ceux de l’hôte appliqués et réémis à chaque tour ; ceux de joy-boy (écho) jamais rejoués', () => {
  let t = ouverture();
  let r = jouer(t, [['BuffCardToOppEnd', { iCardIndex: -1, iBuff: 1000 }, HOTE], ['BuffCardToOppEnd', { iCardIndex: -1, iBuff: 2000 }, JOYBOY]]);
  t = r.table;
  assert.deepEqual(r.applied, [{ kind: 'power', player: HOTE, target: -1, delta: 1000, until: 'turn' }]);
  const leaderHote = game(t).players[HOTE].leader.uid;
  assert.equal(power(game(t), leaderHote), 6000);
  r = jouer(t, [['EndTurn', {}, HOTE]]);
  t = r.table;
  assert.deepEqual(r.applied.filter((e) => e.kind === 'power'), [{ kind: 'power', player: HOTE, target: -1, delta: 1000, until: 'turn' }],
    'réémis pour le tour de joy-boy, pas le bonus de joy-boy');
  assert.equal(power(game(t), leaderHote), 6000, 'jusqu’à la fin du tour adverse');
  assert.equal(game(t).mods.filter((m) => m.uid === game(t).players[JOYBOY].leader.uid).length, 0);
});

test('écho en avance : ce que le moteur a déjà fait pour joy-boy n’est pas rejoué', () => {
  let t = jouer(ouverture(), [['EndTurn', {}, HOTE]]).table;
  const s = game(t);
  assert.equal(s.active, JOYBOY);
  assert.equal(s.players[JOYBOY].hand.length, 6, 'pioche du moteur');
  assert.equal(s.players[JOYBOY].donActive, 2, 'DON!! du moteur');
  const r = jouer(t, [['DrawCard', { iCount: 1 }, JOYBOY], ['DrawDon', { iCount: 2 }, JOYBOY], ['TapDon', { iCount: 0 }, JOYBOY]]);
  t = r.table;
  assert.deepEqual(r.applied, []);
  aligne(t);
  // l'écho de la fin de tour, si le moteur n'a pas fini le tour : rattrapé
  const fin = jouer(t, [['EndTurn', {}, JOYBOY]]);
  assert.deepEqual(fin.applied, [{ kind: 'turn', to: HOTE }]);
  assert.equal(game(fin.table).active, HOTE);
  aligne(fin.table);
});

test('cartes inconnues de joy-boy : relevées, opaques dans le moteur, montrées de dos avec ce qu’on en sait', () => {
  const cards = cartes('ST-01');
  cards.splice(45, 5, 'ZZ99-001', 'ZZ99-001', 'ZZ99-002', 'ZZ99-001', 'ZZ99-001');
  const describe = (code: string) => (code === 'ZZ99-001' ? { name: 'Inconnu', cost: 1, power: 3000 } : undefined);
  const t0 = miseEnPlace({ leader: 'ST01-001', cards }, { leader: 'ST21-001', cards: cartes('ST-21') }, { describe });
  assert.deepEqual(unknownCards(t0), [{ seat: HOTE, code: 'ZZ99-001', count: 4 }, { seat: HOTE, code: 'ZZ99-002', count: 1 }]);
  // ouverture sans mélange : les 5 cartes du dessus (indices 45 à 49) font la main de l'hôte
  let t = jouer(t0, [['ChooseTurnOrder', { iFirst: 1 }, HOTE], ['DrawCard', { iCount: 5 }, HOTE], ['DrawCard', { iCount: 5 }, JOYBOY],
    ['PopulateLifeDeck', { iLifeCount: 5 }, JOYBOY], ['PopulateLifeDeck', { iLifeCount: 5 }, HOTE]], { describe }).table;
  assert.ok(game(t).players[HOTE].hand.every((c) => isOpaque(c.num)));
  const i = t.mirror.players[HOTE].zones.hand.findIndex((c) => c.code === 'ZZ99-001');
  const r = jouer(t, [['DrawDon', { iCount: 1 }, HOTE], ['MoveHandCardToDeploy', { iIdx: i, bRested: false }, HOTE]], { describe });
  t = r.table;
  const perso = game(t).players[HOTE].chars[0];
  assert.ok(isOpaque(perso.num));
  assert.equal(power(game(t), perso.uid), 3000);
  assert.equal(r.last.view?.players[HOTE].chars[0].num, HIDDEN);
  assert.deepEqual(r.last.opaque.find((o) => o.uid === perso.uid), { uid: perso.uid, code: 'ZZ99-001', name: 'Inconnu', cost: 1, power: 3000 });
  assert.ok(!JSON.stringify(r.last.view).includes('optcgsim:'), 'la vue ne contient que des numéros que l’interface connaît');
  assert.deepEqual(t.errors, []);
  aligne(t);
});

test('le moteur attend une réponse au milieu d’un effet : les mutations attendent, puis passent', () => {
  let t = ouverture();
  const enCours = structuredClone(game(t));
  enCours.decision = { player: JOYBOY, kind: 'effect', prompt: 'Question', options: [{ id: 'a', label: 'A' }], inEffect: true };
  t = withGame(t, enCours).table;
  let r = jouer(t, [['DrawDon', { iCount: 1 }, HOTE], ['DrawCard', { iCount: 1 }, HOTE]]);
  assert.deepEqual(r.applied, []);
  assert.equal(r.table.backlog.length, 2);
  const libre = structuredClone(game(r.table));
  libre.decision = null;
  r = withGame(r.table, libre) as InboundResult & Suite;
  assert.equal(r.applied.length, 2);
  assert.equal(r.table.backlog.length, 0);
  // inclinaison seule, sans RPC qui suive : flush l'applique
  r = receive(r.table, rpc('TapCard', { iCardIndex: -1 }), HOTE) as InboundResult & Suite;
  assert.ok(r.table.held);
  r = flush(r.table) as InboundResult & Suite;
  assert.deepEqual(r.applied, [{ kind: 'rest', player: HOTE, zone: 'leader', index: 0 }]);
});

test('une RPC incohérente est notée sans rien casser ; les …ServerRpc sont ignorées', () => {
  const t = ouverture();
  const r = receive(t, rpc('MoveHandCardToDeploy', { iIdx: 9, bRested: false }), HOTE);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^miroir/);
  assert.deepEqual(r.applied, []);
  const srv = receive(t, { ...rpc('DrawCard', { iCount: 1 }), name: 'DrawCardServerRpc' }, JOYBOY);
  assert.deepEqual(srv.applied, []);
  assert.equal(srv.table.mirror.players[JOYBOY].zones.hand.length, 5);
  assert.equal(t.errors.length, 0, 'la table reçue n’est pas modifiée');
});

// ---------------------------------------------------------------------------------------------------- parties réelles

interface FixtureRpc { name: string; object: number; values: Record<string, unknown> }
const lireRpcs = (j: string): FixtureRpc[] => JSON.parse(fs.readFileSync(ici(`./fixtures/miroir/rpc-2026-11-17-${j}.json`), 'utf8')).rpcs;

/**
 * Rejoue une partie réelle : l'hôte est l'objet 1, joy-boy (le prototype) l'objet 2. Le moteur joue les tours de joy-boy
 * (pioche, DON!!) en avance sur leur écho : l'alignement se vérifie pendant les tours de l'hôte.
 */
function rejouer(j: string): CrossTable {
  let t = createTable({ seed: 1 });
  for (const r of lireRpcs(j)) {
    const res = receive(t, { ...r, behaviour: 0 }, r.object === 1 ? HOTE : JOYBOY);
    t = res.table;
    assert.deepEqual(res.errors, [], `${j} : ${r.name} à t=${(r as { t?: number }).t}`);
    if (t.game && t.game.flow.stage !== 'mulligan' && t.game.active === HOTE && t.mirror.turnPlayer === HOTE && !t.held && !t.game.decision?.inEffect) assert.deepEqual(compareTables(t), [], `${j} : ${r.name}`);
  }
  return t;
}

test('parties réelles du 17 nov. : rejouées jusqu’à l’abandon de l’hôte, moteur et miroir alignés pendant les tours de l’hôte', () => {
  const a = rejouer('0841');
  assert.deepEqual(a.mirror.over, { loser: HOTE, reason: 'abandon' });
  const s = game(a);
  assert.deepEqual(s.players[HOTE].chars.map((c) => c.num), ['OP17-082', 'OP17-086', 'EB05-047', 'OP17-080']);
  assert.equal(s.players[HOTE].trash.length, 5);
  assert.equal(s.players[JOYBOY].hand.length, 7);
  assert.deepEqual(invariantErrors(s), []);
  assert.deepEqual(compareTables(a), []);
  const b = rejouer('0859');
  assert.equal(game(b).players[JOYBOY].life.length, 4, '4000 contre 5000 repoussée, puis 9000 touche : une Vie perdue');
  assert.equal(game(b).players[JOYBOY].hand.length, 8);
  assert.deepEqual(invariantErrors(game(b)), []);
  assert.deepEqual(compareTables(b), []);
});

// ---------------------------------------------------------------------------------------------------- échos dépassés

test('écho dépassé : le moteur a déjà pioché puis défaussé la carte, rien n’est rejoué ni signalé', () => {
  let t = jouer(ouverture(), [['EndTurn', {}, HOTE]]).table;
  // le moteur a pioché pour joy-boy (phase de Pioche) ; il pose ensuite cette carte ailleurs avant l'écho de la pioche
  const s = game(t);
  const pioche = s.players[JOYBOY].hand.at(-1)!;
  const i = s.players[JOYBOY].hand.findIndex((c) => c.uid === pioche.uid);
  t = withGame(t, applyExternal(s, { kind: 'move', player: JOYBOY, from: 'hand', index: i, to: 'trash' }, { by: JOYBOY })).table;
  const r = jouer(t, [['DrawCard', { iCount: 1 }, JOYBOY], ['DrawDon', { iCount: 2 }, JOYBOY]]);
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.errors, [], 'écho reconnu sans écart');
  assert.equal(game(r.table).players[JOYBOY].trash.at(-1)?.uid, pioche.uid);
});

test('un vrai désaccord n’est pas masqué : déplacement de l’hôte d’une carte que le moteur a mise ailleurs', () => {
  let t = ouverture();
  const s = game(t);
  // le dessus du deck de l'hôte part en Défausse dans le moteur seulement ; l'hôte, lui, le pioche
  t = withGame(t, applyExternal(s, { kind: 'move', player: HOTE, from: 'deck', index: 0, to: 'trash' })).table;
  const r = jouer(t, [['DrawCard', { iCount: 1 }, HOTE]]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /ni en deck ni en hand/);
});

/** Faux transport : l'hôte rejoue les lots entrants de l'essai du 18 nov. dès la demande de connexion (aucun réseau). */
function fauxJeu(paquets: { sens: string; canal: string; lot: string }[]) {
  let recevoir: (d: Uint8Array, c?: string) => void = () => {};
  let fermer: (r: string) => void = () => {};
  let ferme = false, rejoue = false;
  return {
    userId: 'JOUEUR-TEST',
    send() {
      if (rejoue) return;
      rejoue = true;
      const entrants = paquets.filter((p) => p.sens === 'entrant');
      let k = 0;
      const suivant = () => {
        if (ferme) return;
        // fin de la fixture : le jeu a fermé la salle (le dernier écho, celui du coup fatal, n'a jamais été reçu)
        if (k >= entrants.length) { setTimeout(() => { if (!ferme) { ferme = true; fermer('le jeu a quitté la salle'); } }, 20); return; }
        const p = entrants[k++];
        recevoir(Buffer.from(p.lot, 'hex'), p.canal);
        setTimeout(suivant, 1);
      };
      setTimeout(suivant, 1);
    },
    onData(h: typeof recevoir) { recevoir = h; },
    onClose(h: typeof fermer) { fermer = h; },
    close() { if (!ferme) { ferme = true; fermer('fermée par joy-boy'); } },
  };
}

test('essai réel du 18 nov. (banc, pilote ia) : les échos dépassés (Usopp posé, Guard Point défaussé) ne font plus d’écart', async () => {
  const fixture = JSON.parse(fs.readFileSync(ici('./fixtures/essais/banc-2026-11-18-0913.json'), 'utf8'));
  const banc: any = await import(new URL('../../../scripts/optcgsim/banc.mjs', import.meta.url).href);
  const b = banc.lancerBanc({ code: 'W1A2B3C', pilote: 'ia', vitesse: 0.0005, ecrire: () => {}, connect: async () => fauxJeu(fixture.paquets) });
  const bilan = await b.fini;
  // le miroir du banc prend la puissance du moteur (O2.4b) : il ne conclut plus à tort, la partie va jusqu'à la fermeture
  assert.match(bilan.issue, /connexion terminée : le jeu a quitté la salle/);
  assert.deepEqual(bilan.ecarts, [], 'écarts n° 1 et 2 (DrawCard ST01-002, ResolveAttack ST01-014)');
  assert.equal(bilan.ia.ecartsMoteurMiroir, 0);
});
