// Essais réels du site (tâche O3.2, 18 nov. 2026, parties V1tUm_ et xO4s0d) : le joueur joy-boy, dans le navigateur, pose
// Sanji OP17-082 ([Jouée] pioche 2, défausse 2) ; il pioche, puis la défausse ne lui est jamais proposée et, 20 s plus
// tard, le garde-fou finit son tour (« session figée … décision 1/effect/discard, backlog 5 »). Cause : les échos de la
// pose et de la pioche arrivent pendant la question d'effet du moteur ; inbound les garde en attente jusqu'à la réponse
// (drain), et la session cachait la décision tant qu'il restait des mutations en attente : blocage.
// Rejoué ici sur un faux hôte interactif (faux-hote.ts, aucun accès réseau), en partie « miroir » : le même deck Sabo
// (META-SABO-2026-10, quatre Sanji) des deux côtés, l'hôte jouant aussi Sanji.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECKS } from '../../engine/decks.ts';
import { counts } from '../../online/optcgsim/mirror.ts';
import { startSession, type CrossplaySession } from '../../online/optcgsim/session.ts';
import { fauxHote } from './faux-hote.ts';
import { tirage } from './faux-jeu.ts';

const SANJI = 'OP17-082';
const deckDe = (id: string) => ({ leader: DECKS[id].leader, cards: Object.entries(DECKS[id].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) });
const SABO = deckDe('META-SABO-2026-10');

/**
 * Le joueur humain : garde sa main, pose Sanji dès qu'il peut (une fois par tour), répond aux défausses après
 * `lent` tics du chrono (le temps de choisir), finit son tour sinon. Rend ce qu'il a vu.
 */
function joueurSanji(s: CrossplaySession, { lent = 0 } = {}) {
  const vu = { defausses: 0, sanji: 0, tours: new Set<number>() };
  let attente: ReturnType<typeof setTimeout> | null = null;
  const jouer = () => {
    if (attente) return;
    const v = s.snapshot();
    const d = v.state?.decision;
    if (!d || d.player !== 1 || v.end) return;
    let choix: string;
    if (d.kind === 'mulligan') choix = 'keep';
    else if (d.tag === 'discard') {
      choix = d.options[0].id;
      if (lent) {
        attente = setTimeout(() => { attente = null; vu.defausses++; s.answer(v.seq, choix); }, lent);
        return;
      }
      vu.defausses++;
    } else if (d.kind === 'main') {
      const sanji = d.options.find((o) => o.id.startsWith('play:') && v.state!.players[1].hand.find((c) => `play:${c.uid}` === o.id)?.num === SANJI);
      if (sanji && !vu.tours.has(v.state!.turn)) { vu.tours.add(v.state!.turn); vu.sanji++; choix = sanji.id; } else choix = 'end';
    } else choix = (d.options.find((o) => o.id !== 'none') ?? d.options[0]).id;
    s.answer(v.seq, choix);
  };
  s.onChange(() => { try { jouer(); } catch (e) { if (!(e as { code?: string }).code) throw e; } });
  return vu;
}

/** Tirage des mélanges de joy-boy qui lui met Sanji en main au tour 2 (cherché une fois, fixe ensuite). */
const GRAINE = 7;

async function partie(lent: number) {
  const hote = fauxHote(SABO, { tours: 3 });
  const lignes: string[] = [];
  const s = startSession({
    code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', connect: async () => hote.transport, closeDelayMs: 0,
    randomInt: tirage(GRAINE), log: (l) => lignes.push(l),
  });
  const vu = joueurSanji(s, { lent });
  const fin = await s.done;
  return { s, hote, vu, fin, lignes };
}

test('site, Sanji OP17-082 : la défausse du joueur joy-boy lui est proposée, le tour n’est pas forcé (partie miroir)', { timeout: 20_000 }, async () => {
  const { s, hote, vu, fin, lignes } = await partie(40);
  assert.ok(vu.sanji >= 1, `joy-boy a posé Sanji (${vu.sanji})`);
  assert.equal(vu.defausses, 2 * vu.sanji, 'deux défausses proposées par Sanji posé');
  assert.ok(hote.sanjiHote() >= 1, 'l’hôte a aussi posé Sanji');
  const texte = lignes.join('\n');
  assert.ok(!/fin de tour forcée|retenue par la session/.test(texte), texte);
  assert.equal(s.stats().unstuck, 0);
  // les défausses partent dans le jeu
  const envoyees = hote.recues().map((r) => r.name);
  assert.equal(envoyees.filter((n) => n === 'MoveHandCardToDiscardServerRpc').length, 2 * vu.sanji, envoyees.join(' '));
  // l'hôte quitte la salle après ses tours : victoire de joy-boy, sans écart entre les deux tables
  assert.equal(fin.kind, 'left', JSON.stringify(fin));
  assert.equal(s.stats().notes, 0, texte);
  assert.equal(s.stats().mirrorErrors, 0);
  const vue = s.finalState()!;
  for (const seat of [0, 1] as const) {
    const c = counts(hote.miroir(), seat), P = vue.players[seat];
    assert.deepEqual([P.hand.length, P.trash.length, P.chars.length, P.deck.length, P.life.length],
      [c.hand, c.trash, c.deploy, c.deck, c.life], `siège ${seat} : moteur et jeu alignés`);
  }
});

test('site, Sanji OP17-082 : réponse immédiate, même issue', { timeout: 20_000 }, async () => {
  const { s, vu, fin } = await partie(0);
  assert.ok(vu.sanji >= 1);
  assert.equal(vu.defausses, 2 * vu.sanji);
  assert.equal(fin.kind, 'left');
  assert.equal(s.stats().notes, 0);
});
