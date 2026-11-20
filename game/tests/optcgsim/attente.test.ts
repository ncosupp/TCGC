// Tâche O5.1 : le filet anti-impasse (game/online/optcgsim/attente.ts) et son branchement dans la session.
// 1. Le module pur : qui attend qui, échelle 8 s / 4 s, SwitchTurns correctif, silence, conclusion, plafond, hôte inactif.
// 2. La table des RPC qui passent la main à joy-boy (règle de code n° 1 de l'audit O5.0, § 4.5).
// 3. La session sur un mini faux hôte à pendule (le sien, distinct du faux hôte fidèle d'O5.2) : il tient son
//    `iPlayerAction` comme le jeu et fait tourner la pendule de celui qu'il attend ; scénarios d'impasse, annulation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAttente, HAND_TO_JOYBOY, SEUILS, tick, useful, type Situation } from '../../online/optcgsim/attente.ts';
import { buildBatch, MESSAGE_TYPE, parseBatch } from '../../online/optcgsim/netcode.ts';
import { decode, rpcEntry, rpcMessage } from '../../online/optcgsim/rpc.ts';
import { CANCEL_TEXT, HOST_IDLE_TEXT, IMPASSE_TEXT, startSession, type CrossplaySession, type SessionOptions } from '../../online/optcgsim/session.ts';
import { OLD_ACTIONS } from '../../online/optcgsim/reaction.ts';
import type { Channel, Transport } from '../../online/optcgsim/transport.ts';
import type { Rpc, Seat } from '../../online/optcgsim/types.ts';
import { ENTRANTS, fauxJeu, joueurIA, st01, tirage } from './faux-jeu.ts';

// ---------------------------------------------------------------------------------------------------- module pur

const sit = (x: Partial<Situation>): Situation => ({ now: 0, clock: 1, acting: 1, turnPlayer: 1, actionable: false, waitingHost: false, ...x });
const kinds = (d: { kind: string; rung?: number }[]) => d.map((x) => (x.kind === 'rung' ? `rung${x.rung}` : x.kind));

test('attente : cas J au tour de joy-boy, échelle 1 à 5 (8 s puis 4 s par échelon), puis une nouvelle échelle', () => {
  const a = createAttente();
  assert.deepEqual(tick(a, sit({ now: 0 })), []);
  assert.deepEqual(tick(a, sit({ now: 7_000 })), []);
  assert.deepEqual(kinds(tick(a, sit({ now: 8_000 }))), ['rung1']);
  assert.deepEqual(tick(a, sit({ now: 11_000 })), []);
  assert.deepEqual(kinds(tick(a, sit({ now: 12_000 }))), ['rung2']);
  assert.deepEqual(kinds(tick(a, sit({ now: 16_000 }))), ['rung3']);
  assert.deepEqual(kinds(tick(a, sit({ now: 20_000 }))), ['rung4']);
  assert.deepEqual(kinds(tick(a, sit({ now: 24_000 }))), ['rung5']);
  assert.deepEqual(kinds(tick(a, sit({ now: 28_000 }))), ['failed']);
  assert.deepEqual(tick(a, sit({ now: 35_000 })), []);
  const d = tick(a, sit({ now: 36_000 }));
  assert.deepEqual(kinds(d), ['rung1']);
  assert.equal((d[0] as { ladder: number }).ladder, 2);
  assert.equal(a.unstuck, 2);
});

test('attente : au tour de l’hôte, pas d’échelon 5 et l’échelon 4 rend la main par SwitchTurns', () => {
  const a = createAttente();
  const out: string[] = [];
  let switchTurns = false;
  for (let t = 0; t <= 30_000; t += 1_000) {
    for (const d of tick(a, sit({ now: t, turnPlayer: 0 }))) {
      out.push(d.kind === 'rung' ? `rung${d.rung}` : d.kind);
      if (d.kind === 'rung' && d.rung === 4) switchTurns = d.switchTurns;
    }
  }
  assert.deepEqual(out.slice(0, 5), ['rung1', 'rung2', 'rung3', 'rung4', 'failed']);
  assert.equal(switchTurns, true);
});

test('attente : succès dès que la pendule passe à l’hôte, qu’une décision est montrée ou que l’hôte rejoue', () => {
  const a = createAttente();
  tick(a, sit({ now: 0 }));
  assert.deepEqual(kinds(tick(a, sit({ now: 8_000 }))), ['rung1']);
  assert.deepEqual(kinds(tick(a, sit({ now: 9_000, clock: 0 }))), ['success']);
  assert.equal(a.rung, 0);
  // une décision montrée : un humain prend son temps, jamais d'échelon
  const b = createAttente();
  for (let t = 0; t <= 60_000; t += 1_000) assert.deepEqual(tick(b, sit({ now: t, actionable: true })), []);
  // l'hôte rejoue après l'échelon : impasse levée, un nouvel épisode recommence à zéro
  const c = createAttente();
  tick(c, sit({ now: 0 }));
  tick(c, sit({ now: 8_000 }));
  useful(c, 'host', 9_000);
  assert.deepEqual(kinds(tick(c, sit({ now: 9_500 }))), ['success']);
  assert.deepEqual(tick(c, sit({ now: 16_000 })), []);
  assert.deepEqual(kinds(tick(c, sit({ now: 17_500 }))), ['rung1']);
});

test('attente : une RPC utile repousse le premier échelon', () => {
  const a = createAttente();
  tick(a, sit({ now: 0 }));
  useful(a, 'joyboy', 6_000);
  assert.deepEqual(tick(a, sit({ now: 13_000 })), []);
  assert.deepEqual(kinds(tick(a, sit({ now: 14_000 }))), ['rung1']);
});

test('attente : cas H pendant le tour de joy-boy, un seul SwitchTurns correctif par remise de main', () => {
  const a = createAttente();
  assert.deepEqual(tick(a, sit({ now: 0, clock: 0, actionable: true })), []);
  assert.deepEqual(kinds(tick(a, sit({ now: 8_000, clock: 0, actionable: true }))), ['switchFix']);
  assert.deepEqual(tick(a, sit({ now: 30_000, clock: 0, actionable: true })), []);
  // la main revient à joy-boy, puis l'hôte la reprend à tort : nouveau correctif possible
  tick(a, sit({ now: 31_000, clock: 1, actionable: true }));
  tick(a, sit({ now: 32_000, clock: 0, actionable: true }));
  assert.deepEqual(kinds(tick(a, sit({ now: 40_000, clock: 0, actionable: true }))), ['switchFix']);
  // joy-boy attend l'hôte (son attaque) ou tour de l'hôte : rien
  const b = createAttente();
  for (let t = 0; t <= 30_000; t += 1_000) {
    assert.deepEqual(tick(b, sit({ now: t, clock: 0, waitingHost: true })), []);
    assert.deepEqual(tick(b, sit({ now: t, clock: 0, turnPlayer: 0 })), []);
  }
  // une RPC utile de l'hôte : il joue vraiment, le délai repart
  const c = createAttente();
  tick(c, sit({ now: 0, clock: 0 }));
  useful(c, 'host', 5_000);
  assert.deepEqual(tick(c, sit({ now: 12_000, clock: 0 })), []);
  assert.deepEqual(kinds(tick(c, sit({ now: 13_000, clock: 0 }))), ['switchFix']);
});

test('attente : sans pendule, le suivi d’iPlayerAction et 20 s de silence utile ; hôte inactif 5 min = victoire', () => {
  const a = createAttente();
  assert.deepEqual(tick(a, sit({ now: 0, clock: null, acting: 1 })), []);
  assert.deepEqual(tick(a, sit({ now: 19_000, clock: null, acting: 1 })), []);
  assert.deepEqual(kinds(tick(a, sit({ now: 20_000, clock: null, acting: 1 }))), ['rung1']);
  // l'hôte doit agir et ne joue plus : victoire de joy-boy au bout de 5 min (jamais en salle à minuteur)
  const b = createAttente();
  assert.deepEqual(tick(b, sit({ now: 299_000, clock: null, acting: 0 })), []);
  assert.deepEqual(kinds(tick(b, sit({ now: 300_000, clock: null, acting: 0 }))), ['hostIdle']);
  assert.deepEqual(tick(b, sit({ now: 400_000, clock: null, acting: 0 })), [], 'une seule fois');
  const c = createAttente();
  assert.deepEqual(tick(c, sit({ now: 600_000, clock: 0, turnPlayer: 0 })), []);
  // joy-boy attend l'hôte (réaction transmise) sans pendule : même délai
  const d = createAttente();
  assert.deepEqual(kinds(tick(d, sit({ now: 300_000, clock: null, acting: 1, waitingHost: true, actionable: true }))), []);
});

test('attente : conclusion sans perdant après 2 min sans rien d’utile, ou au-delà de 5 déblocages', () => {
  const a = createAttente();
  const vus: string[] = [];
  for (let t = 0; t <= 200_000 && !a.over; t += 1_000) vus.push(...kinds(tick(a, sit({ now: t }))));
  assert.equal(vus.at(-1), 'conclude');
  const n = vus.filter((x) => x === 'rung1').length;
  assert.ok(n >= 1 && n <= SEUILS.maxUnstuck, vus.join(','));
  // plafond : chaque échelle levée par l'hôte, mais la table se refige sans cesse
  const b = createAttente();
  let concl: string | null = null;
  for (let t = 0, k = 0; t <= 400_000 && !b.over; t += 1_000, k++) {
    for (const d of tick(b, sit({ now: t }))) {
      if (d.kind === 'rung') useful(b, 'host', t + 500);
      if (d.kind === 'conclude') concl = d.why;
    }
  }
  assert.equal(concl, 'plafond');
  assert.equal(b.unstuck, 5);
});

// ---------------------------------------------------------------------------------------------------- table des attentes

test('attente : toute RPC de l’hôte qui passe la main à joy-boy a un traitement nommé (audit § 4.5, règle 1)', () => {
  const catalogue = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../online/optcgsim/catalog.json', import.meta.url)), 'utf8')) as Record<string, { nom: string; sens: string }>;
  // (SelectBlockerNoProcs n'y figure qu'en ServerRpc : l'hôte, serveur NGO, l'exécute chez lui et chez joy-boy)
  const noms = new Set(Object.values(catalogue).map((e) => e.nom.replace(/(Client|Server)Rpc$/, '')));
  for (const n of Object.keys(HAND_TO_JOYBOY)) assert.ok(noms.has(n), `${n} : absente du catalogue`);
  // les attentes relevées par l'audit (§ 2 : « sans effet, mais l'hôte attend une réponse » ; § 3 : combat, réactions)
  const attentes = [
    'TriggerOpponentActionFromDeploy', 'TriggerOpponentActionFromDeployWithTarget', 'TriggerOpponentActionFromLeader',
    'TriggerOpponentActionFromLeaderWithSaveTarget', 'TriggerOpponentActionFromTrash', 'ForceOpponentActionFromDeploy',
    'ForceOpponentActionFromOppositeDeploy', 'ForceOpponentActionFromTrash', 'TriggerOpponentMultiActions', 'RequestCancelMatch',
    'RequestRestartTurn', 'SwitchTurns', 'SelectBlocker', 'SelectBlockerNoProcs', 'EnterTriggerPhase', 'CheckForKOdCharacterEffects',
    'ProcOpponentV3Action', 'QueueOpponentPlayerKOQueue', 'QueueOpponentPlayerSaveQueue', 'EndTurn', 'SetupAttack',
  ];
  for (const n of attentes) {
    const t = HAND_TO_JOYBOY[n];
    assert.ok(t && t.treatment, `${n} : aucun traitement nommé`);
    // jamais de refus muet : sans traitement propre, le filet est nommé
    if (/^aucun/.test(t.treatment)) assert.ok(t.filet, `${n} : ni traitement ni filet`);
  }
  // O5.4 : les réactions (R6, R7) ont un traitement propre ; plus aucun filet n'attend cette tâche
  for (const [n, t] of Object.entries(HAND_TO_JOYBOY)) assert.ok(!/O5\.4/.test(t.filet ?? ''), `${n} : filet encore attendu d’O5.4`);
  for (const n of OLD_ACTIONS) assert.ok(/startOld/.test(HAND_TO_JOYBOY[n]?.treatment ?? '') && !HAND_TO_JOYBOY[n].filet, `${n} : ancienne action sans traitement`);
});

// ---------------------------------------------------------------------------------------------------- mini faux hôte

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const PAQUETS = (JSON.parse(fs.readFileSync(ici('./fixtures/essais/banc-2026-11-18-1213.json'), 'utf8')) as { paquets: { sens: string; lot: string }[] }).paquets;
const LOTS = PAQUETS.filter((p) => p.sens === 'entrant').map((p) => Buffer.from(p.lot, 'hex') as Uint8Array);
const clientRpcs = (lot: Uint8Array) => parseBatch(lot).filter((m) => m.type === MESSAGE_TYPE.ClientRpc).map((m) => decode(m.payload));
const LOT_PLACE = LOTS.findIndex((l) => clientRpcs(l).some((r) => r.name === 'LoadLeaderClientRpc'));
const LOT_ORDRE = LOTS.findIndex((l) => clientRpcs(l).some((r) => r.name === 'ChooseTurnOrderClientRpc'));
const HOTE = 1;

function valeurs(nom: string, v: Record<string, unknown>): Record<string, unknown> | null {
  const e = rpcEntry(nom);
  if (!e) return null;
  const out: Record<string, unknown> = {};
  for (const w of e.ecritures) {
    if (w.param in v) out[w.param] = v[w.param];
    else if (w.param === 'clientId') out[w.param] = 3;
    else if (w.nullable) out[w.param] = null;
    else if (w.codage === 'chaine') out[w.param] = '';
    else if (w.codage === 'bool') out[w.param] = false;
    else out[w.param] = 0;
  }
  return out;
}

interface Mini {
  transport: Transport;
  /** ServerRpc reçues de la session (noms sans suffixe). */
  recues: () => string[];
  /** iPlayerAction de l'hôte (0 : lui, 1 : joy-boy), comme le jeu. */
  agit: () => Seat;
  /** Secondes de pendule de joy-boy perdues depuis le début. */
  perduJoyboy: () => number;
  envoyer: (rpcs: [string, Record<string, unknown>?][]) => void;
  finTour: () => void;
  forcerAgit: (s: Seat) => void;
}

/**
 * Mini faux hôte : mise en place de la partie de 12 h 13 (deck remplacé), l'hôte commence. Il tient son iPlayerAction
 * (SwitchTurns des deux côtés, EndTurn, action imposée) et, en salle à minuteur, envoie toutes les `pas` ms une seconde de
 * pendule à celui qu'il attend. `tourHote(n, h)` : ce que fait l'hôte au début de son tour n (par défaut : fin du tour).
 */
function miniHote({ minuteur = true, pas = 2, tourHote = (_n: number, h: Mini) => h.finTour() } = {}): Mini {
  const recues: string[] = [];
  let recevoir: (d: Uint8Array, c?: Channel) => void = () => {};
  let fermer: (r: string) => void = () => {};
  let ferme = false, connecte = false, agit: Seat = 0, tours = 0, horloge: ReturnType<typeof setInterval> | null = null;
  let tH = 1050, tJ = 1050, perdu = 0;
  const deck = st01();
  const emettre = (rpcs: Rpc[]) => {
    if (ferme || !rpcs.length) return;
    for (const r of rpcs) {
      if (r.object !== HOTE) continue;
      if (r.name === 'SwitchTurnsClientRpc') agit = agit === 0 ? 1 : 0;
      if (r.name === 'EndTurnClientRpc') agit = 1;
      if (r.name === 'ProcOpponentV3ActionClientRpc' && r.values.bForcedOpp === true) agit = 1;
    }
    const lot = buildBatch(rpcs.map((r) => rpcMessage(r.name, r.values, { object: r.object, behaviour: r.behaviour })));
    setTimeout(() => { if (!ferme) recevoir(lot, 'fiable' as Channel); }, 1);
  };
  const hote = (n: string, v: Record<string, unknown> = {}): Rpc => ({ name: `${n}ClientRpc`, object: HOTE, behaviour: 0, values: valeurs(`${n}ClientRpc`, { clientId: 0, ...v }) ?? v });
  const lotFixture = (k: number): Rpc[] => clientRpcs(LOTS[k]).filter((r) => r.object === HOTE).map((r) => {
    if (r.name === 'LoadLeaderClientRpc') return { ...r, values: { ...r.values, sCardID: deck.leader } };
    if (r.name === 'LoadDeckCardClientRpc') return { ...r, values: { ...r.values, sCardID: deck.cards[Number(r.values.iIdx)] } };
    if (r.name === 'GameStartClientRpc') return { ...r, values: { ...r.values, bTimerLobby: minuteur } };
    return r;
  });
  const finir = (raison: string) => { if (ferme) return; ferme = true; if (horloge) clearInterval(horloge); fermer(raison); };
  const h: Mini = {
    transport: null as unknown as Transport,
    recues: () => recues, agit: () => agit, perduJoyboy: () => perdu,
    envoyer: (rpcs) => emettre(rpcs.map(([n, v]) => hote(n, v ?? {}))),
    finTour: () => emettre([hote('AttemptingToEndTurn'), hote('EndTurn')]),
    forcerAgit: (s) => { agit = s; },
  };
  const debutTour = () => {
    tours++;
    agit = 0;
    emettre([...(tours > 1 ? [hote('DrawCard', { iCount: 1 })] : []), hote('DrawDon', { iCount: tours > 1 ? 2 : 1 })]);
    setTimeout(() => tourHote(tours, h), 3);
  };
  const demarrerPendule = () => {
    if (!minuteur || horloge) return;
    horloge = setInterval(() => {
      if (agit === 1) { tJ -= 1; perdu++; } else tH -= 1;
      emettre([{ name: 'SetTimerClientRpc', object: HOTE, behaviour: 0, values: { fServerTime: tH, fClientTime: tJ } }]);
    }, pas);
  };
  const surLot = (d: Uint8Array) => {
    const rpcs = parseBatch(d).filter((m) => m.type === MESSAGE_TYPE.ServerRpc).map((m) => decode(m.payload));
    if (!rpcs.length) return;
    const objet = rpcs[0].object;
    const echos: Rpc[] = [];
    for (const r of rpcs) {
      const base = r.name.replace(/ServerRpc$/, '');
      recues.push(base);
      if (base === 'VersionCheck') continue;
      if (base === 'SwitchTurns') agit = agit === 0 ? 1 : 0;
      const nom = base === 'AddLogLine' ? 'TranslateLogLineClientRpc' : `${base}ClientRpc`;
      const v = valeurs(nom, r.values);
      if (v) echos.push({ name: nom, object: objet, behaviour: 0, values: v });
    }
    emettre(echos);
    const noms = rpcs.map((r) => r.name);
    if (noms.includes('SetMyTurnRollServerRpc')) emettre(lotFixture(LOT_ORDRE));
    if (noms.includes('PopulateLifeDeckServerRpc')) { emettre([hote('PopulateLifeDeck', { iLifeCount: 5 })]); demarrerPendule(); debutTour(); }
    if (noms.includes('EndTurnServerRpc')) setTimeout(debutTour, 2);
    if (noms.includes('ConcedeServerRpc') || noms.includes('AcceptCancelMatchServerRpc')) setTimeout(() => finir('le jeu a quitté la salle'), 2);
  };
  h.transport = {
    userId: 'JOUEUR-TEST',
    send(d) {
      if (ferme) return;
      if (!connecte) {
        connecte = true;
        const autres = parseBatch(LOTS[LOT_PLACE]).filter((x) => x.type !== MESSAGE_TYPE.ClientRpc);
        const lot = buildBatch([...autres, ...lotFixture(LOT_PLACE).map((r) => rpcMessage(r.name, r.values, { object: r.object, behaviour: r.behaviour }))]);
        setTimeout(() => recevoir(lot, 'fiable' as Channel), 1);
        return;
      }
      surLot(d);
    },
    onData(f) { recevoir = f; },
    onClose(f) { fermer = f; },
    close() { finir('fermée par joy-boy'); },
  };
  return h;
}

/** Joueur joy-boy pressé : garde sa main, finit son tour dès qu'il le peut (sauf `pause`). */
function joueurPresse(s: CrossplaySession, pause: (kind: string) => boolean = () => false) {
  const jouer = () => {
    for (let g = 0; g < 20; g++) {
      const v = s.snapshot();
      const d = v.state?.decision;
      if (!d || d.player !== 1 || v.end || pause(d.kind)) return;
      const pick = ['keep', 'end', 'pass', 'noblock', 'none'].map((id) => d.options.find((x) => x.id === id)).find(Boolean) ?? d.options[0];
      try { s.answer(v.seq, pick.id); } catch { return; }
    }
  };
  s.onChange(() => setTimeout(jouer, 0));
}

function lancer(h: Mini, extra: Partial<SessionOptions> = {}) {
  const lignes: string[] = [];
  const s = startSession({
    code: 'P1A2B3C', deck: st01(), name: 'JoyBoy', connect: async () => h.transport, closeDelayMs: 0, randomInt: tirage(),
    log: (l) => lignes.push(l), ...extra,
  });
  return { s, lignes };
}
const attendre = (f: () => boolean, ms = 8000) => new Promise<void>((ok, ko) => {
  const t0 = Date.now();
  const i = setInterval(() => { if (f()) { clearInterval(i); ok(); } else if (Date.now() - t0 > ms) { clearInterval(i); ko(new Error('délai dépassé')); } }, 5);
});

test('session : l’hôte passe la main sans rien demander (liste vide, R6) à son tour : l’échelle rend la main, la partie continue', async () => {
  let bloque = false, p0 = 0, p1 = -1;
  const h = miniHote({
    tourHote: (n, x) => {
      if (n === 2 && !bloque) {
        bloque = true;
        p0 = x.perduJoyboy();
        // SwitchTurns + liste d'actions, sans ProcOpponentV3Action : l'hôte attend que joy-boy rende la main
        x.envoyer([['SwitchTurns'], ['TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false }]]);
        const reprise = setInterval(() => { if (x.agit() === 0) { clearInterval(reprise); p1 = x.perduJoyboy(); x.finTour(); } }, 2);
        return;
      }
      x.finTour();
    },
  });
  const { s, lignes } = lancer(h);
  joueurPresse(s);
  await attendre(() => bloque && h.agit() === 0 && h.recues().filter((n) => n === 'EndTurn').length >= 3);
  const recues = h.recues();
  const k = recues.lastIndexOf('TriggerOpponentMultiActions');
  assert.ok(k > 0, recues.join(','));
  // échelon 4 au tour de l'hôte : AllOnKOResolved, liste vide, SwitchTurns, ResetActionPhase, NoMorePendingActions
  assert.deepEqual(recues.slice(k - 1, k + 4), ['AllOnKOResolved', 'TriggerOpponentMultiActions', 'SwitchTurns', 'ResetActionPhase', 'NoMorePendingActions']);
  assert.equal(s.stats().unstuck, 1);
  assert.match(s.stats().unstuckLog?.[0] ?? '', /échelon 4/);
  assert.match(lignes.join('\n'), /impasse levée/);
  // joy-boy n'a pas perdu plus de 8 s + 4 échelons de 4 s de sa pendule pendant l'impasse
  assert.ok(p1 >= p0 && p1 - p0 <= 8 + 4 * 4 + 4, `pendule perdue : ${p1 - p0} s`);
  s.close();
  await s.done;
});

test('session : la pendule de l’hôte tourne pendant le tour de joy-boy (SwitchTurns de trop) : un SwitchTurns correctif', async () => {
  let pense = true, mauvais = false;
  const h = miniHote({
    tourHote: (_n, x) => {
      x.finTour();
      // l'hôte croit agir pendant le tour de joy-boy (CA4)
      if (!mauvais) { mauvais = true; setTimeout(() => x.forcerAgit(0), 6); }
    },
  });
  const { s } = lancer(h);
  joueurPresse(s, (kind) => pense && kind === 'main'); // le joueur joy-boy réfléchit : sa décision est montrée
  await attendre(() => mauvais && h.recues().includes('SwitchTurns') && h.agit() === 1);
  await new Promise((r) => setTimeout(r, 80)); // 40 s de pendule de plus : pas de second correctif
  assert.equal(h.recues().filter((n) => n === 'SwitchTurns').length, 1);
  assert.equal(s.stats().unstuck, 1);
  assert.match(s.stats().unstuckLog?.[0] ?? '', /SwitchTurns correctif/);
  assert.equal(s.snapshot().state?.decision?.player, 1, 'la décision reste au joueur');
  pense = false;
  s.close();
  await s.done;
});

test('session : impasse que rien ne lève : partie arrêtée sans perdant, message et Concede envoyés, journal daté', async () => {
  const h = miniHote({
    // l'hôte passe la main puis ne réagit plus à rien (il attend une réponse que joy-boy ne sait pas donner)
    tourHote: (n, x) => { if (n === 2) { x.envoyer([['SwitchTurns']]); x.forcerAgit(1); return; } x.finTour(); },
  });
  const { s, lignes } = lancer(h, { attente: { concludeMs: 60_000 } });
  // l'hôte ignore nos SwitchTurns : il reste à attendre joy-boy
  const forcer = setInterval(() => { if (h.recues().includes('SwitchTurns')) h.forcerAgit(1); }, 1);
  joueurPresse(s);
  const fin = await s.done;
  clearInterval(forcer);
  assert.equal(fin.kind, 'desync');
  assert.equal(fin.winner, null);
  assert.equal(fin.reason, IMPASSE_TEXT);
  assert.ok(h.recues().includes('Concede') && h.recues().includes('AddChatLine'));
  const st = s.stats();
  assert.ok(st.unstuck >= 1 && st.unstuck <= 5, String(st.unstuck));
  assert.ok((st.unstuckLog ?? []).every((l) => /^\d{4}-\d\d-\d\dT.* — tour \d+ à /.test(l)), (st.unstuckLog ?? []).join('\n'));
  assert.match(lignes.join('\n'), /arrêt sans perdant/);
});

test('session : salle sans minuteur, silence utile : même échelle ; hôte inactif : victoire de joy-boy', async () => {
  // l'hôte passe la main sans rien demander, puis reprend dès qu'on la lui rend
  let bloque = false;
  const h = miniHote({
    minuteur: false,
    tourHote: (n, x) => {
      if (n === 2 && !bloque) {
        bloque = true;
        x.envoyer([['SwitchTurns']]);
        const reprise = setInterval(() => { if (x.agit() === 0) { clearInterval(reprise); x.finTour(); } }, 2);
        return;
      }
      x.finTour();
    },
  });
  const { s } = lancer(h, { attente: { silenceMs: 150, settleMs: 30 }, tickMs: 10 });
  joueurPresse(s);
  await attendre(() => bloque && h.recues().filter((n) => n === 'EndTurn').length >= 3);
  assert.equal(s.stats().unstuck, 1);
  assert.ok(h.recues().includes('NoMorePendingActions'));
  s.close();
  await s.done;

  // l'hôte ne finit jamais son tour
  const muet = miniHote({ minuteur: false, tourHote: (n, x) => { if (n < 2) x.finTour(); } });
  const b = lancer(muet, { attente: { hostIdleMs: 300 }, tickMs: 10 });
  joueurPresse(b.s);
  const fin = await b.s.done;
  assert.equal(fin.kind, 'left');
  assert.equal(fin.winner, 1);
  assert.equal(fin.reason, HOST_IDLE_TEXT);
  assert.ok(!muet.recues().includes('Concede'), 'joy-boy gagne : pas d’abandon envoyé');
});

test('session : annulation demandée par l’hôte (partie du 17 nov., trois demandes avant son abandon) : acceptée, sans perdant', async () => {
  const jeu = fauxJeu(ENTRANTS);
  const s = startSession({ code: 'P1A2B3C', deck: st01(), name: 'JoyBoy', connect: async () => jeu.transport, closeDelayMs: 0, randomInt: tirage() });
  joueurIA(s);
  const fin = await s.done;
  assert.equal(fin.kind, 'cancel');
  assert.equal(fin.winner, null);
  assert.equal(fin.resigned, null);
  assert.equal(fin.reason, CANCEL_TEXT);
  const noms = jeu.rpcs().map((r) => r.name);
  assert.equal(noms.filter((n) => n === 'AcceptCancelMatchServerRpc').length, 1);
  assert.ok(!noms.includes('ConcedeServerRpc'), 'ni abandon ni défaite');
  assert.equal(s.snapshot().status, 'stopped');
});

test('session : la partie rejouée du 17 nov. ne déclenche aucun déblocage (pas de faux positif)', async () => {
  const jeu = fauxJeu();
  const s = startSession({ code: 'P1A2B3C', deck: st01(), name: 'JoyBoy', connect: async () => jeu.transport, closeDelayMs: 0, randomInt: tirage() });
  joueurIA(s);
  await s.done;
  assert.equal(s.stats().unstuck, 0);
});
