// Écart n° 2 des essais du site (tâche O3.2, 18 nov. 2026, 16 h 30) : l'hôte OPTCGSim pose Loki OP17-119 ([Jouée] KO de
// Personnages adverses) et vise Zoro OP17-095 et Sanji OP17-082 du joueur joy-boy. Zoro peut empêcher un retrait
// (« à la place ») : le jeu ne met donc rien KO lui-même, il met les deux Personnages en file, passe la main à joy-boy et
// lui transmet la réaction (QueueOpponentPlayerSaveQueue ×2, SwitchTurns, ProcOpponentV3Action, TriggerOpponentMultiActions).
// La session ne répondait pas : les deux jeux s'attendaient (« session figée … tour 7 à l'hôte, décision 0/main »).
// Fixture : la partie du site, anonymisée (essais/site-2026-11-18-1630.json) ; et le faux hôte interactif (faux-hote.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DECKS } from '../../engine/decks.ts';
import { createTable, receive } from '../../online/optcgsim/inbound.ts';
import { counts } from '../../online/optcgsim/mirror.ts';
import { MESSAGE_TYPE, parseBatch } from '../../online/optcgsim/netcode.ts';
import { translateOutbound } from '../../online/optcgsim/outbound.ts';
import { queuedUid, reactionOf, resolveQueued } from '../../online/optcgsim/reaction.ts';
import { decode } from '../../online/optcgsim/rpc.ts';
import { startSession, type CrossplaySession } from '../../online/optcgsim/session.ts';
import type { Rpc, Seat } from '../../online/optcgsim/types.ts';
import { fauxHote } from './faux-hote.ts';
import { tirage } from './faux-jeu.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const FIXTURE = JSON.parse(fs.readFileSync(ici('./fixtures/essais/site-2026-11-18-1630.json'), 'utf8')) as { paquets: Paquet[] };
/** ClientRpc reçues, dans l'ordre ; l'objet 2 est celui de joy-boy (échos de ses actions). */
const recues = (): { rpc: Rpc; siege: Seat }[] => FIXTURE.paquets.filter((p) => p.sens === 'entrant')
  .flatMap((p) => parseBatch(Buffer.from(p.lot, 'hex'))).filter((m) => m.type === MESSAGE_TYPE.ClientRpc)
  .map((m) => { const rpc = decode(m.payload); return { rpc, siege: (rpc.object === 2 ? 1 : 0) as Seat }; });

test('site, Loki OP17-119 (fixture) : la réaction transmise met KO Zoro et Sanji, qui partent dans le jeu', () => {
  const sanitaire = Buffer.concat(FIXTURE.paquets.map((p) => Buffer.from(p.lot, 'hex')));
  for (const s of ['Hote#0001']) assert.ok(sanitaire.includes(Buffer.from(s, 'utf16le')), `${s} attendu (anonymisé)`);
  let t = createTable({ joyboy: 1 });
  const file: number[] = [];
  let reaction: ReturnType<typeof reactionOf> = null;
  for (const { rpc, siege } of recues()) {
    if (siege === 0) {
      const uid = queuedUid(t.mirror, rpc);
      if (uid !== undefined) file.push(uid);
      reaction ??= reactionOf(rpc);
    }
    t = receive(t, rpc, siege).table;
    if (reaction) break;
  }
  assert.deepEqual(t.mirror.errors, []);
  assert.deepEqual(reaction, { removal: 8, forced: false }, 'AllyKO transmis à joy-boy');
  const zones = t.mirror.players[1].zones;
  assert.deepEqual(file.map((u) => zones.deploy.find((c) => c.uid === u)?.code), ['OP17-095', 'OP17-082'], 'Zoro puis Sanji en file');
  // le blocage : le moteur attend l'hôte (sa phase principale), le jeu attend joy-boy
  assert.equal(t.game!.decision?.player, 0);
  assert.equal(t.mirror.actingPlayer, 1);
  // la réponse : les deux KO dans le moteur, puis les RPC du jeu (DiscardFromSelfDeploy, comme ResolvePendingKOs)
  const avant = t.game!.players[1].chars.length;
  const res = resolveQueued(t.game!, file, reaction!.removal);
  assert.equal(res.removed, 2);
  assert.equal(res.game.players[1].chars.length, avant - 2);
  assert.ok(file.every((u) => res.game.players[1].trash.some((c) => c.uid === u)));
  const out = translateOutbound(t.mirror, res.game, { seat: 1, scope: 'self' });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.rpcs.map((r) => r.name).filter((n) => !n.startsWith('AddLogLine')), ['DiscardFromSelfDeployServerRpc', 'DiscardFromSelfDeployServerRpc']);
  assert.equal(counts(out.mirror, 1).deploy, avant - 2);
});

const ID = 'META-SABO-2026-10';
const SABO = { leader: DECKS[ID].leader, cards: Object.entries(DECKS[ID].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) };

/**
 * Le joueur joy-boy : garde sa main, pose un Personnage par tour s'il peut (Sanji d'abord : ses défausses remplissent la
 * Défausse que Zoro utilise), répond au reste ; aux remplacements, `zoro` : les accepter ou les refuser.
 */
function joueur(s: CrossplaySession, zoro: boolean) {
  const poses = new Set<number>();
  const vu = { remplacements: 0 };
  s.onChange(() => {
    try {
      const v = s.snapshot(), d = v.state?.decision;
      if (!d || d.player !== 1 || v.end) return;
      let choix = (d.options.find((o) => o.id !== 'none') ?? d.options[0]).id;
      if (d.kind === 'mulligan') choix = 'keep';
      else if (d.tag === 'replace') { vu.remplacements++; choix = zoro ? d.options.find((o) => o.id.startsWith('replace:'))!.id : 'none'; }
      else if (d.kind === 'main') {
        const main = v.state!.players[1].hand;
        const poses_ = d.options.filter((o) => o.id.startsWith('play:'));
        const de = (num: string) => poses_.find((o) => main.find((c) => `play:${c.uid}` === o.id)?.num === num);
        const pleine = v.state!.players[1].trash.length >= 3;
        const pose = (pleine ? de('OP17-095') ?? de('OP17-082') : de('OP17-082') ?? de('OP17-095')) ?? poses_[0];
        if (pose && !poses.has(v.state!.turn)) { poses.add(v.state!.turn); choix = pose.id; } else choix = 'end';
      }
      s.answer(v.seq, choix);
    } catch (e) { if (!(e as { code?: string }).code) throw e; }
  });
  return vu;
}

/** Zoro et Sanji seulement (deck d'essai) : Zoro est sur le terrain avec 3 cartes en Défausse quand Loki arrive. */
const ZORO_SANJI = { leader: 'OP13-004', cards: [...Array<string>(25).fill('OP17-095'), ...Array<string>(25).fill('OP17-082')] };
const zoroPret = (m: import('../../online/optcgsim/mirror.ts').Mirror) =>
  m.players[1].zones.deploy.some((c) => c.code === 'OP17-095') && m.players[1].zones.trash.length >= 3;

async function partieLoki(deck: typeof SABO, zoro: boolean, lokiSi?: (m: import('../../online/optcgsim/mirror.ts').Mirror) => boolean) {
  const hote = fauxHote(SABO, { tours: 8, loki: true, ...(lokiSi ? { lokiSi } : {}) });
  const lignes: string[] = [];
  const s = startSession({ code: 'W1A2B3C', deck, name: 'JoyBoy', connect: async () => hote.transport, closeDelayMs: 0, randomInt: tirage(7), log: (l) => lignes.push(l) });
  const vu = joueur(s, zoro);
  const fin = await s.done;
  const texte = lignes.join('\n');
  assert.equal(hote.lokiHote(), 1, `l'hôte a posé Loki\n${texte}`);
  // nos RPC depuis la réaction transmise jusqu'à la main rendue
  const apres = hote.recues().slice(hote.lokiA()).map((r) => r.name).filter((n) => !n.startsWith('AddLogLine'));
  const noms = apres.slice(0, apres.indexOf('NoMorePendingActionsServerRpc') + 1);
  assert.ok(noms.length, apres.join(' '));
  assert.ok(!/figée|fin de tour forcée/.test(texte), texte);
  assert.equal(fin.kind, 'left', JSON.stringify(fin));
  assert.equal(s.stats().notes, 0, texte);
  const vue = s.finalState()!;
  for (const seat of [0, 1] as const) {
    const c = counts(hote.miroir(), seat), P = vue.players[seat];
    assert.deepEqual([P.hand.length, P.trash.length, P.chars.length, P.deck.length, P.life.length],
      [c.hand, c.trash, c.deploy, c.deck, c.life], `siège ${seat} : moteur et jeu alignés`);
  }
  assert.equal(hote.miroir().actingPlayer, hote.miroir().turnPlayer, 'la main est revenue au joueur du tour');
  return { noms, texte, vu };
}

test('site, Loki OP17-119 (faux hôte) : remplacement refusé, joy-boy met ses Personnages KO et rend la main', { timeout: 20_000 }, async () => {
  const { noms, texte } = await partieLoki(SABO, false);
  assert.deepEqual(noms, ['DiscardFromSelfDeployServerRpc', 'DiscardFromSelfDeployServerRpc',
    'AllOnKOResolvedServerRpc', 'SwitchTurnsServerRpc', 'ResetActionPhaseServerRpc', 'NoMorePendingActionsServerRpc']);
  assert.match(texte, /réaction demandée par OPTCGSim : 2 Personnage\(s\) retiré\(s\), 0 sauvé/);
});

test('site, Loki OP17-119 contre Zoro OP17-095 (faux hôte) : Zoro est proposé ; refusé, les deux sont mis KO', { timeout: 20_000 }, async () => {
  const { noms, texte, vu } = await partieLoki(ZORO_SANJI, false, zoroPret);
  assert.ok(vu.remplacements >= 1, 'le remplacement de Zoro a été proposé');
  assert.equal(noms.filter((n) => n === 'DiscardFromSelfDeployServerRpc').length, 2);
  assert.equal(noms.filter((n) => n === 'MoveTrashCardToDeckBottomServerRpc').length, 0);
  assert.match(texte, /2 Personnage\(s\) retiré\(s\), 0 sauvé/);
});

test('site, Loki OP17-119 contre Zoro OP17-095 (faux hôte) : Zoro accepté, 3 cartes de la Défausse sous le deck par Personnage sauvé', { timeout: 20_000 }, async () => {
  const { noms, texte, vu } = await partieLoki(ZORO_SANJI, true, zoroPret);
  const m = /(\d) Personnage\(s\) retiré\(s\), (\d) sauvé/.exec(texte);
  assert.ok(m, texte);
  const [retires, sauves] = [Number(m[1]), Number(m[2])];
  assert.ok(sauves >= 1, 'au moins un Personnage sauvé');
  assert.equal(retires + sauves, 2);
  assert.ok(vu.remplacements >= sauves);
  assert.equal(noms.filter((n) => n === 'MoveTrashCardToDeckBottomServerRpc').length, 3 * sauves);
  assert.equal(noms.filter((n) => n === 'DiscardFromSelfDeployServerRpc').length, retires);
  const fin = noms.lastIndexOf('NoMorePendingActionsServerRpc');
  assert.deepEqual(noms.slice(fin - 3, fin + 1), ['AllOnKOResolvedServerRpc', 'SwitchTurnsServerRpc', 'ResetActionPhaseServerRpc', 'NoMorePendingActionsServerRpc']);
});

test('site, action imposée par OPTCGSim (bForcedOpp) : repli sûr, refusée et liste rendue, la partie continue', { timeout: 20_000 }, async () => {
  const hote = fauxHote(SABO, { tours: 3, forcee: true });
  const lignes: string[] = [];
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', connect: async () => hote.transport, closeDelayMs: 0, randomInt: tirage(7), log: (l) => lignes.push(l) });
  joueur(s, false);
  const fin = await s.done;
  const texte = lignes.join('\n');
  assert.equal(fin.kind, 'left', texte);
  assert.ok(hote.recues().some((r) => r.name === 'TriggerOpponentMultiActionsServerRpc'));
  assert.match(texte, /action imposée par OPTCGSim \(retrait 0\) : refusée/);
  assert.ok(!/figée/.test(texte), texte);
});
