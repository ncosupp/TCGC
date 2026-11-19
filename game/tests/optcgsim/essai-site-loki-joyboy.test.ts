// Écart n° 3 des essais du site (tâche O3.2, 18 nov. 2026, 18 h 18) : cette fois c'est le joueur joy-boy qui pose Loki
// OP17-119 ([Jouée] KO de Personnages adverses) et l'hôte a Zoro OP17-095 avec 3 cartes en Défausse. Dans le moteur, le
// KO par effet propose son remplacement au propriétaire, le joueur OPTCGSim (« 0/effect/replace ») : personne ne pouvait
// répondre, la session restait figée et le garde-fou finissait le tour au milieu de l'effet.
// Fixture : la partie du site, anonymisée (essais/site-2026-11-18-1818.json), rejouée par inbound jusqu'au coup de Loki.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { heuristicChooser } from '../../ai/heuristic.ts';
import { answerExternal } from '../../online/optcgsim/external.ts';
import { compareTables, createTable, realign, receive, withGame } from '../../online/optcgsim/inbound.ts';
import { MESSAGE_TYPE, parseBatch } from '../../online/optcgsim/netcode.ts';
import { translateOutbound } from '../../online/optcgsim/outbound.ts';
import { answerForOpponent, settlePending } from '../../online/optcgsim/reaction.ts';
import { decode } from '../../online/optcgsim/rpc.ts';
import { applyRpc, counts } from '../../online/optcgsim/mirror.ts';
import { startSession, type CrossplaySession } from '../../online/optcgsim/session.ts';
import { fauxHote } from './faux-hote.ts';
import { tirage } from './faux-jeu.ts';

const ici = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
interface Paquet { t: number; sens: 'entrant' | 'sortant'; canal: string; lot: string }
const FIXTURE = JSON.parse(fs.readFileSync(ici('./fixtures/essais/site-2026-11-18-1818.json'), 'utf8')) as { paquets: Paquet[] };

test('site, Loki de joy-boy contre Zoro de l’hôte (fixture) : la question de remplacement au joueur OPTCGSim ne bloque plus', () => {
  // la table telle qu'elle était juste avant que joy-boy pose Loki (tour 8)
  let t = createTable({ joyboy: 1 });
  for (const p of FIXTURE.paquets.filter((x) => x.sens === 'entrant')) {
    const rpcs = parseBatch(Buffer.from(p.lot, 'hex')).filter((m) => m.type === MESSAGE_TYPE.ClientRpc).map((m) => decode(m.payload));
    if (rpcs.some((r) => r.object === 2 && r.name === 'TapDonClientRpc' && r.values.iCount === 6)) break;
    for (const r of rpcs) t = receive(t, r, r.object === 2 ? 1 : 0).table;
  }
  assert.deepEqual(t.errors, []);
  let g = t.game!;
  assert.equal(g.turn, 8);
  assert.equal(g.decision?.player, 1);
  const loki = g.players[1].hand.find((c) => c.num === 'OP17-119')!;
  const zoro = g.players[0].chars.find((c) => c.num === 'OP17-095')!;
  assert.ok(loki && zoro && g.players[0].trash.length >= 3, 'Loki en main, Zoro de l’hôte avec 3 cartes en Défausse');
  const avant = g;
  // joy-boy pose Loki et choisit ses cibles (comme dans la partie : jusqu'à la question au joueur OPTCGSim)
  g = answerExternal(g, `play:${loki.uid}`, { joyboy: 1 });
  while (g.decision?.player === 1 && g.decision.inEffect) g = answerExternal(g, heuristicChooser(g, g.decision), { joyboy: 1 });
  assert.equal(g.decision?.player, 0, 'le moteur demande au joueur OPTCGSim');
  assert.equal(g.decision?.tag, 'replace');
  assert.ok(g.decision?.inEffect);
  // repli (interprétation 4503) : remplacement refusé, l'effet de joy-boy va au bout
  const res = answerForOpponent(g);
  assert.ok(res.answered.includes('replace'));
  const d = res.game.decision;
  assert.ok(!(d?.player === 0 && d.inEffect), 'plus de question en attente côté OPTCGSim');
  const partis = avant.players[0].chars.filter((c) => !res.game.players[0].chars.some((x) => x.uid === c.uid));
  assert.ok(partis.length >= 1, 'les Personnages visés sont mis KO');
  assert.ok(partis.every((c) => res.game.players[0].trash.some((x) => x.uid === c.uid)));
  // et partent dans le jeu (DiscardFromDeploy, pour l'adversaire)
  const out = translateOutbound(t.mirror, res.game, { seat: 1, before: avant, choice: `play:${loki.uid}`, scope: 'all' });
  assert.deepEqual(out.problems, []);
  assert.equal(out.rpcs.filter((r) => r.name === 'DiscardFromDeployServerRpc').length, partis.length);
  assert.ok(out.rpcs.some((r) => r.name === 'MoveHandCardToDeployServerRpc'), 'Loki posé');
});

// ---------------------------------------------------------------------------------------------------- faux hôte
// joy-boy pose Loki ; l'hôte a Zoro et 3 cartes en Défausse : le remplacement lui est transmis (QueueOpponentPlayerSaveQueue,
// SwitchTurns, AllOnKOResolved, ProcOpponentV3Action, TriggerOpponentMultiActions), il l'utilise ou non, rend la main,
// et joy-boy reporte sa réponse dans le moteur.
const LOKI_SANJI = { leader: 'OP13-004', cards: [...Array<string>(20).fill('OP17-119'), ...Array<string>(30).fill('OP17-082')] };
const ZORO_SANJI = { leader: 'OP13-004', cards: [...Array<string>(25).fill('OP17-095'), ...Array<string>(25).fill('OP17-082')] };

function joueurLoki(s: CrossplaySession) {
  const poses = new Set<number>();
  s.onChange(() => {
    try {
      const v = s.snapshot(), d = v.state?.decision;
      if (!d || d.player !== 1 || v.end) return;
      const st = v.state!, hote = st.players[0];
      let choix = (d.options.find((o) => o.id !== 'none') ?? d.options[0]).id;
      if (d.kind === 'mulligan') choix = 'keep';
      else if (d.tag === 'oppKo') {
        // viser d'abord ce qui n'est pas Zoro (Zoro peut le sauver)
        const autre = d.options.find((o) => o.uid !== undefined && hote.chars.find((c) => c.uid === o.uid)?.num !== 'OP17-095');
        choix = (autre ?? d.options[0]).id;
      } else if (d.kind === 'main') {
        const de = (num: string) => d.options.find((o) => o.id.startsWith('play:') && st.players[1].hand.find((c) => `play:${c.uid}` === o.id)?.num === num);
        const pret = hote.chars.some((c) => c.num === 'OP17-095') && hote.chars.length >= 2 && hote.trash.length >= 3;
        const pose = pret ? de('OP17-119') : de('OP17-082');
        choix = pose && !poses.has(st.turn * 10 + (pret ? 1 : 0)) ? (poses.add(st.turn * 10 + (pret ? 1 : 0)), pose.id) : 'end';
      }
      s.answer(v.seq, choix);
    } catch (e) { if (!(e as { code?: string }).code) throw e; }
  });
}

async function partie(zoroHote: 'accepte' | 'refuse') {
  const hote = fauxHote(ZORO_SANJI, { tours: 9, zoroHote });
  const lignes: string[] = [];
  const s = startSession({ code: 'W1A2B3C', deck: LOKI_SANJI, name: 'JoyBoy', connect: async () => hote.transport, closeDelayMs: 0, randomInt: tirage(7), log: (l) => lignes.push(l) });
  joueurLoki(s);
  const fin = await s.done;
  const texte = lignes.join('\n');
  assert.ok(hote.reactionsHote() >= 1, `remplacement transmis à l'hôte\n${texte}`);
  const proc = hote.recues().find((r) => r.name === 'ProcOpponentV3ActionServerRpc')!;
  assert.equal(proc.values.iAction, 1);
  assert.equal(proc.values.eRemoval, 8);
  assert.ok(Number(proc.values.iActor) < 0 && Number(proc.values.iActor) % 10 === 0, 'identifiant de la carte de l’hôte, négatif vu de joy-boy');
  const noms = hote.recues().map((r) => r.name);
  const k = noms.indexOf('ProcOpponentV3ActionServerRpc');
  assert.deepEqual(noms.slice(k - 3, k + 2), ['QueueOpponentPlayerSaveQueueServerRpc', 'SwitchTurnsServerRpc', 'AllOnKOResolvedServerRpc',
    'ProcOpponentV3ActionServerRpc', 'TriggerOpponentMultiActionsServerRpc']);
  assert.ok(!/figée|fin de tour forcée/.test(texte), texte);
  assert.equal(fin.kind, 'left', JSON.stringify(fin));
  assert.equal(s.stats().notes, 0, texte);
  const vue = s.finalState()!;
  for (const seat of [0, 1] as const) {
    const c = counts(hote.miroir(), seat), P = vue.players[seat];
    assert.deepEqual([P.hand.length, P.trash.length, P.chars.length, P.deck.length, P.life.length],
      [c.hand, c.trash, c.deploy, c.deck, c.life], `siège ${seat} : moteur et jeu alignés\n${texte}`);
  }
  return { hote, texte };
}

test('site, Loki de joy-boy contre Zoro de l’hôte (faux hôte) : remplacement transmis, l’hôte l’utilise', { timeout: 30_000 }, async () => {
  const { hote, texte } = await partie('accepte');
  assert.ok(hote.sauvesHote() >= 1);
  assert.match(texte, /réponse du joueur OPTCGSim : remplacement utilisé \(3 carte/);
});

test('site, Loki de joy-boy contre Zoro de l’hôte (faux hôte) : remplacement transmis, l’hôte le refuse', { timeout: 30_000 }, async () => {
  const { texte } = await partie('refuse');
  assert.match(texte, /réponse du joueur OPTCGSim : pas de remplacement, Personnage retiré/);
});

test('site, écart n° 3 (fixture) : sécurité de la Décision 9, la suite de la vraie partie est suivie sans blocage', () => {
  // même point de départ que le premier test : joy-boy pose Loki, le moteur attend le joueur OPTCGSim (« replace »)
  let t = createTable({ joyboy: 1 });
  const entrants = FIXTURE.paquets.filter((x) => x.sens === 'entrant').map((p) => parseBatch(Buffer.from(p.lot, 'hex'))
    .filter((m) => m.type === MESSAGE_TYPE.ClientRpc).map((m) => decode(m.payload)));
  const k = entrants.findIndex((rpcs) => rpcs.some((r) => r.object === 2 && r.name === 'TapDonClientRpc' && r.values.iCount === 6));
  for (const rpcs of entrants.slice(0, k)) for (const r of rpcs) t = receive(t, r, r.object === 2 ? 1 : 0).table;
  let g = t.game!;
  const loki = g.players[1].hand.find((c) => c.num === 'OP17-119')!;
  g = answerExternal(g, `play:${loki.uid}`, { joyboy: 1 });
  while (g.decision?.player === 1 && g.decision.inEffect) g = answerExternal(g, heuristicChooser(g, g.decision), { joyboy: 1 });
  t = withGame(t, g).table;
  assert.equal(t.game!.decision?.tag, 'replace');
  // la suite réelle (écho de Loki, fin de tour forcée, tours de l'hôte…) : sans la sécurité, tout reste en attente
  let sansSecurite = t;
  for (const rpcs of entrants.slice(k)) for (const r of rpcs) sansSecurite = receive(sansSecurite, r, r.object === 2 ? 1 : 0).table;
  assert.ok(sansSecurite.backlog.length > 10, `blocage reproduit (${sansSecurite.backlog.length} mutations en attente)`);
  // avec la sécurité (comme la session) : à la première action de l'hôte, la question en suspens est passée par défaut
  let fermees = 0;
  for (const rpcs of entrants.slice(k)) {
    for (const r of rpcs) {
      const siege = r.object === 2 ? 1 : 0;
      if (siege === 0 && t.game!.decision?.inEffect && applyRpc(t.mirror, r, 0).externals.length) {
        const res = settlePending(t.game!);
        fermees++;
        t = withGame(t, res.game).table;
      }
      t = receive(t, r, siege).table;
    }
  }
  assert.equal(fermees, 1, 'une seule question passée par défaut');
  assert.equal(t.backlog.length, 0, 'plus rien en attente');
  const res = realign(t, [0]);
  assert.deepEqual(compareTables(res.table).filter((x) => x.startsWith('joueur 0')), [], 'le moteur suit le jeu pour l’hôte');
});
