// Tâche O3.1 : la session d'une partie croisée (game/online/optcgsim/session.ts), sur un faux transport qui rejoue les
// lots de l'hôte de la partie anonymisée du 17 nov. (fixture 0859). Le joueur joy-boy est joué ici par l'IA heuristique,
// à travers `answer` comme un humain. Aucun accès réseau.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECKS } from '../../engine/decks.ts';
import { crossplayRecord, publicName, SessionError, setOf, startSession, type SessionOptions } from '../../online/optcgsim/session.ts';
import { fauxHote } from './faux-hote.ts';
import { avecCartes, carteSansEffet, ENTRANTS, fauxJeu, joueurIA, st01, tirage } from './faux-jeu.ts';

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

test('session : cartes adverses connues sans effet codé : relevées, la partie continue (Décision 8)', async (t) => {
  const code = await carteSansEffet();
  if (!code) { t.skip('aucune carte sans effet codé dans le catalogue'); return; }
  const { s, jeu } = lancer({}, fauxJeu(avecCartes([code, code])));
  joueurIA(s);
  const fin = await s.done;
  assert.notEqual(fin.kind, 'unknown');
  assert.ok(s.initialState(), 'la partie a commencé');
  assert.deepEqual(s.uncodedCards().map((u) => [u.code, u.count]), [[code, 2]]);
  assert.deepEqual(s.unknownCards(), []);
  assert.ok(!jeu.rpcs().some((r) => r.name === 'AddChatLineServerRpc'), 'pas de message : la partie continue');
});

// ---------------------------------------------------------------- tâche O4.2 : salles publiques
const deckDe = (id: string) => ({ leader: DECKS[id].leader, cards: Object.entries(DECKS[id].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) });
const SABO = deckDe('META-SABO-2026-10');
const PRIVES = ['AddChatLineServerRpc', 'ConcedeServerRpc'];

test('session (O4.2) : approbation refusée par l’hôte (salle déjà prise) : échec silencieux en « connect »', async () => {
  const hote = fauxHote(SABO, { refuse: true });
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', account: 42, startMs: 5000, closeDelayMs: 0,
    connect: async () => hote.transport });
  const fin = await s.done;
  assert.equal(fin.kind, 'failed');
  assert.equal(fin.stage, 'connect');
  assert.equal(fin.winner, null);
  assert.equal(s.snapshot().status, 'stopped');
  assert.equal(s.initialState(), null, 'aucune partie');
  assert.ok(!hote.recues().some((r) => PRIVES.includes(r.name)), 'ni message ni abandon chez l’hôte');
  assert.ok(!hote.recues().some((r) => r.name === 'SetNameServerRpc'), 'rien envoyé au nom du joueur');
});

test('session (O4.2) : hôte qui ne lance pas la partie : départ propre au bout de startMs, en « setup »', async () => {
  const hote = fauxHote(SABO, { lanceApres: Infinity });
  const lignes: string[] = [];
  const t0 = Date.now();
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', account: 42, startMs: 150, closeDelayMs: 0,
    connect: async () => hote.transport, log: (l) => lignes.push(l) });
  const statuts = new Set<string>();
  s.onChange(() => statuts.add(s.snapshot().status));
  const fin = await s.done;
  assert.ok(Date.now() - t0 >= 140, 'pas avant le délai');
  assert.ok(statuts.has('setup'), 'connecté avant le départ');
  assert.equal(fin.kind, 'failed');
  assert.equal(fin.stage, 'setup');
  assert.equal(fin.winner, null);
  assert.match(fin.reason, /n’a pas lancé/);
  assert.ok(lignes.some((l) => /non lancée/.test(l)));
  assert.ok(!hote.recues().some((r) => PRIVES.includes(r.name)), 'ni message ni abandon : la partie n’avait pas commencé');
  assert.equal(hote.lancee(), false);
});

test('session (O4.2) : hôte qui lance avant le délai (bouton « Prêt ») : la partie se joue, startMs sans effet', async () => {
  const hote = fauxHote(SABO, { lanceApres: 40, tours: 2 });
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', account: 42, startMs: 400, closeDelayMs: 0,
    connect: async () => hote.transport, randomInt: tirage() });
  joueurIA(s);
  await new Promise((r) => setTimeout(r, 600)); // bien après startMs
  const fin = await s.done;
  assert.equal(fin.stage, 'playing');
  assert.notEqual(fin.kind, 'failed');
  assert.ok(s.initialState(), 'la partie a commencé');
});

test('session (O4.2) : présentation <pseudo>#NNNN (compte), sans message de chat ; pseudo seul sans compte', async () => {
  const nom = publicName('JoyBoy', 42);
  assert.match(nom, /^JoyBoy#\d{4}$/);
  assert.equal(publicName('JoyBoy', 42), nom, 'stable pour un compte');
  assert.equal(publicName('Autre', 42).slice(-5), nom.slice(-5), 'chiffres liés au compte, pas au pseudo');
  const tags = new Set(Array.from({ length: 50 }, (_, i) => publicName('x', i).slice(-4)));
  assert.ok(tags.size > 40, 'des chiffres différents d’un compte à l’autre');
  assert.equal(publicName('<b>Luffy</b>#1\u0007', 'abc').replace(/#\d{4}$/, ''), 'bLuffy/b1', 'ni balise, ni #, ni contrôle');
  assert.match(publicName('   ', 7), /^joy-boy#\d{4}$/);
  assert.ok(publicName('x'.repeat(40), 7).length <= 24);

  const hote = fauxHote(SABO, { lanceApres: Infinity });
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', account: 42, closeDelayMs: 0, connect: async () => hote.transport });
  await new Promise<void>((r) => { const off = s.onChange(() => { if (s.snapshot().status === 'setup') { off(); r(); } }); });
  await new Promise((r) => setTimeout(r, 20));
  const set = hote.recues().find((r) => r.name === 'SetNameServerRpc');
  const leader = hote.recues().find((r) => r.name === 'LoadLeaderServerRpc');
  assert.equal(set?.values.sName, nom);
  assert.equal(leader?.values.sPlayerName, nom);
  s.close();
  const fin = await s.done;
  assert.equal(fin.stage, 'setup');
  assert.ok(!hote.recues().some((r) => PRIVES.includes(r.name)), 'aucun message de chat, aucun abandon');

  const sans = fauxHote(SABO, { lanceApres: Infinity });
  const s2 = startSession({ code: 'P1A2B3C', deck: SABO, name: 'JoyBoy', closeDelayMs: 0, connect: async () => sans.transport });
  await new Promise<void>((r) => { const off = s2.onChange(() => { if (s2.snapshot().status === 'setup') { off(); r(); } }); });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sans.recues().find((r) => r.name === 'SetNameServerRpc')?.values.sName, 'JoyBoy', 'parties par code inchangées');
  s2.close();
  await s2.done;
});

test('session (O4.2) : arrêt ou délai pendant la connexion : connexion annulée, rien ne reste ouvert', async () => {
  let signal: AbortSignal | undefined;
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', account: 1, startMs: 50, closeDelayMs: 0,
    connect: (_c, opts) => new Promise((_res, rej) => { signal = opts.signal; opts.signal?.addEventListener('abort', () => rej(new Error('connexion annulée'))); }) });
  const fin = await s.done;
  assert.equal(fin.kind, 'failed');
  assert.equal(fin.stage, 'connect');
  assert.match(fin.reason, /ne répond pas/);
  assert.equal(signal?.aborted, true, 'la connexion en cours est annulée');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.snapshot().end?.reason, fin.reason, 'l’annulation ne change pas la fin');
});
