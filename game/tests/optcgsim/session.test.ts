// Tâche O3.1 : la session d'une partie croisée (game/online/optcgsim/session.ts), sur un faux transport qui rejoue les
// lots de l'hôte de la partie anonymisée du 17 nov. (fixture 0859). Le joueur joy-boy est joué ici par l'IA heuristique,
// à travers `answer` comme un humain. Aucun accès réseau.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crossplayRecord, SessionError, setOf, startSession, type SessionOptions } from '../../online/optcgsim/session.ts';
import { avecCartes, ENTRANTS, fauxJeu, joueurIA, st01, tirage } from './faux-jeu.ts';

function lancer(extra: Partial<SessionOptions> = {}, jeu = fauxJeu()) {
  const s = startSession({ code: 'P1A2B3C', deck: st01(), name: 'JoyBoy', connect: async () => jeu.transport, closeDelayMs: 0, randomInt: tirage(), ...extra });
  return { s, jeu };
}

test('session : une partie complète rejouée, le joueur joy-boy répond par answer', async () => {
  const { s, jeu } = lancer();
  joueurIA(s);
  const statuts = new Set<string>();
  s.onChange(() => statuts.add(s.snapshot().status));
  const fin = await s.done;
  assert.ok(statuts.has('setup') && statuts.has('playing'), [...statuts].join(','));
  // la fixture se finit par l'abandon de l'hôte
  assert.equal(fin.kind, 'game');
  assert.equal(fin.winner, 1);
  assert.equal(fin.resigned, 0);
  assert.equal(s.snapshot().status, 'over');
  assert.ok(s.stats().decisions > 3, 'le joueur a décidé');
  assert.ok(s.stats().notes <= 25, `écarts : ${s.stats().notes}`);
  // mise en place, ouverture et tours partis au nom de notre objet joueur
  const noms = jeu.rpcs().map((r) => r.name);
  for (const n of ['SetNameServerRpc', 'LoadLeaderServerRpc', 'ShuffleDeckServerRpc', 'DrawCardServerRpc', 'PopulateLifeDeckServerRpc', 'DrawDonServerRpc']) {
    assert.ok(noms.includes(n), n);
  }
  assert.equal(noms.filter((n) => n === 'LoadDeckCardServerRpc').length, 50);
  assert.ok(!noms.includes('ConcedeServerRpc'), 'pas d’abandon de notre part');
  // fin de partie : état final, vue sans décision, enregistrement « Mes parties » marqué croisé
  const final = s.finalState()!;
  assert.equal(final.winner, 1);
  assert.equal(s.snapshot().state?.decision, null);
  assert.ok(s.opponentKey() && !s.opponentKey()!.includes('Hote'), 'empreinte, pas le pseudo');
  const rec = crossplayRecord({
    id: '2026-11-18_10-00-00_ST-01-contre-OPTCGSim_croisee', engine: 'test', startedAt: s.startedAt()!, now: new Date(), endedAt: new Date().toISOString(),
    initial: s.initialState()!, final, moves: s.moves(), myDeck: 'ST-01', myDeckName: 'Rouge', opponent: s.snapshot().opponent!.name,
    opponentLeader: s.snapshot().opponent!.leader, abandoned: false,
  });
  assert.equal(rec.mode, 'online');
  assert.equal(rec.crossplay, true);
  assert.equal(rec.status, 'won');
  assert.equal(rec.config.aiDeck, 'OPTCGSim');
  assert.ok(rec.decisions.length > 0, 'les décisions du joueur sont gardées');
});

test('session : réponses refusées (numéro périmé, pas son tour, choix inconnu)', async () => {
  const { s } = lancer({}, fauxJeu(ENTRANTS, { arret: 0 }));
  assert.throws(() => s.answer(5, 'x'), (e: unknown) => e instanceof SessionError && e.code === 'stale');
  assert.throws(() => s.answer(0, 'x'), (e: unknown) => e instanceof SessionError && e.code === 'not_your_turn');
  s.close();
  const fin = await s.done;
  assert.equal(fin.winner, null);
  assert.throws(() => s.answer(0, 'x'), (e: unknown) => e instanceof SessionError && e.code === 'not_playing');
});

test('session : abandon du joueur joy-boy en pleine partie', async () => {
  const { s, jeu } = lancer();
  joueurIA(s);
  await new Promise<void>((r) => { const off = s.onChange(() => { if (s.snapshot().status === 'playing' && s.stats().decisions >= 2) { off(); r(); } }); });
  s.concede();
  const fin = await s.done;
  assert.equal(fin.kind, 'concede');
  assert.equal(fin.winner, 0);
  assert.equal(fin.resigned, 1);
  assert.ok(jeu.rpcs().some((r) => r.name === 'ConcedeServerRpc'));
  assert.equal(s.finalState()?.winner, 0);
});

test('session : le jeu quitte la salle en pleine partie (victoire), connexion perdue (sans perdant)', async () => {
  const k = ENTRANTS.length - 30;
  const a = lancer({}, fauxJeu(ENTRANTS, { arret: k, fin: 'le jeu a quitté la salle' }));
  joueurIA(a.s);
  const fa = await a.s.done;
  assert.equal(fa.kind, 'left');
  assert.equal(fa.winner, 1);
  assert.equal(fa.resigned, 0);
  const b = lancer({}, fauxJeu(ENTRANTS, { arret: k, fin: 'plus aucun paquet du jeu depuis 30 s' }));
  joueurIA(b.s);
  const fb = await b.s.done;
  assert.equal(fb.kind, 'lost');
  assert.equal(fb.winner, null);
  assert.equal(b.s.snapshot().status, 'stopped');
});

test('session : joueur joy-boy absent trop longtemps, abandon en son nom', async () => {
  let attente = () => false;
  const { s, jeu } = lancer({ idleMs: 30 }, fauxJeu(ENTRANTS, { pause: () => attente() }));
  attente = () => s.snapshot().state?.decision?.player === 1;
  const fin = await s.done; // personne ne répond à « garder sa main ? »
  assert.equal(fin.kind, 'idle');
  assert.equal(fin.winner, 0);
  assert.ok(jeu.rpcs().some((r) => r.name === 'ConcedeServerRpc'));
});

// Codes d'un set fictif (OP99) : le cas réel du 18 nov. (OP18-092, OP18-094) dépend du catalogue téléchargé, qui peut les connaître
test('session : cartes inconnues de joy-boy (set fictif OP99) : relevé, message aux deux joueurs, abandon', async () => {
  const jeu = fauxJeu(avecCartes(['OP99-092', 'OP99-092', 'OP99-094']));
  const { s } = lancer({}, jeu);
  const fin = await s.done;
  assert.equal(fin.kind, 'unknown');
  assert.equal(fin.winner, null, 'pas de défaite comptée pour le joueur joy-boy');
  assert.deepEqual(s.unknownCards().map((u) => [u.code, u.count]).sort(), [['OP99-092', 2], ['OP99-094', 1]]);
  assert.match(s.snapshot().message!, /OP99-092, OP99-094/);
  const rpcs = jeu.rpcs();
  const chat = rpcs.find((r) => r.name === 'AddChatLineServerRpc');
  assert.match(String(chat?.values.s), /OP99-092, OP99-094/);
  assert.ok(rpcs.findIndex((r) => r.name === 'ConcedeServerRpc') > rpcs.indexOf(chat!), 'abandon après le message');
  assert.equal(s.initialState(), null, 'la partie n’a pas commencé');
  assert.equal(setOf('OP18-092'), 'OP18');
  assert.equal(setOf('P-012'), 'P');
});

test('session : sans faux transport, aucun appel à Unity pendant les tests', async () => {
  const s = startSession({ code: 'P000000', deck: st01(), name: 'JoyBoy' });
  const fin = await s.done;
  assert.equal(fin.kind, 'failed');
  assert.match(fin.reason, /réseau réel interdit/);
  assert.throws(() => startSession({ code: '?12', deck: st01(), name: 'J' }), /Code de salle inconnu/);
  assert.throws(() => startSession({ code: 'P12', deck: { leader: 'ST01-001', cards: [] }, name: 'J' }), /50 cartes/);
});
