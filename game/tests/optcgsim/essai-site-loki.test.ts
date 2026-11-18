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

/** Le joueur joy-boy : garde sa main, pose un Personnage par tour s'il peut, répond au reste, finit son tour. */
function joueur(s: CrossplaySession) {
  const poses = new Set<number>();
  s.onChange(() => {
    try {
      const v = s.snapshot(), d = v.state?.decision;
      if (!d || d.player !== 1 || v.end) return;
      let choix = (d.options.find((o) => o.id !== 'none') ?? d.options[0]).id;
      if (d.kind === 'mulligan') choix = 'keep';
      else if (d.kind === 'main') {
        const pose = d.options.find((o) => o.id.startsWith('play:'));
        if (pose && !poses.has(v.state!.turn)) { poses.add(v.state!.turn); choix = pose.id; } else choix = 'end';
      }
      s.answer(v.seq, choix);
    } catch (e) { if (!(e as { code?: string }).code) throw e; }
  });
}

test('site, Loki OP17-119 (faux hôte) : joy-boy résout la réaction, met ses Personnages KO et rend la main', { timeout: 20_000 }, async () => {
  const hote = fauxHote(SABO, { tours: 5, loki: true });
  const lignes: string[] = [];
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', connect: async () => hote.transport, closeDelayMs: 0, randomInt: tirage(7), log: (l) => lignes.push(l) });
  joueur(s);
  const fin = await s.done;
  const texte = lignes.join('\n');
  assert.equal(hote.lokiHote(), 1, `l'hôte a posé Loki\n${texte}`);
  const noms = hote.recues().map((r) => r.name).filter((n) => !n.startsWith('AddLogLine'));
  const k = noms.indexOf('DiscardFromSelfDeployServerRpc');
  assert.ok(k >= 0, noms.join(' '));
  assert.deepEqual(noms.slice(k, k + 6), ['DiscardFromSelfDeployServerRpc', 'DiscardFromSelfDeployServerRpc',
    'AllOnKOResolvedServerRpc', 'SwitchTurnsServerRpc', 'ResetActionPhaseServerRpc', 'NoMorePendingActionsServerRpc']);
  assert.match(texte, /réaction demandée par OPTCGSim : 2\/2/);
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
});
