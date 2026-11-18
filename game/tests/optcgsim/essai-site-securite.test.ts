// Décision 9 de l'étape O (18 nov. 2026) : « quand ça ne se passe pas comme prévu mais qu'OPTCGSim reprend la main et
// continue à jouer, joy-boy doit s'adapter, noter l'erreur, mais ne pas bloquer le jeu ». Faux hôte « impatient » : le
// joueur joy-boy pose Sanji OP17-082 et ne répond pas à la défausse ; l'hôte joue son tour quand même. La session relève
// l'écart, termine la défausse par défaut, suit l'hôte, réaligne au besoin, prévient le joueur, et la partie continue.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECKS } from '../../engine/decks.ts';
import { startSession } from '../../online/optcgsim/session.ts';
import { fauxHote } from './faux-hote.ts';
import { tirage } from './faux-jeu.ts';

const ID = 'META-SABO-2026-10';
const SABO = { leader: DECKS[ID].leader, cards: Object.entries(DECKS[ID].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) };

test('sécurité (Décision 9) : l’hôte continue pendant une décision joy-boy en suspens, la session suit sans bloquer', { timeout: 20_000 }, async () => {
  const hote = fauxHote(SABO, { tours: 4, impatient: true });
  const lignes: string[] = [];
  const messages = new Set<string>();
  const s = startSession({ code: 'W1A2B3C', deck: SABO, name: 'JoyBoy', connect: async () => hote.transport, closeDelayMs: 0, randomInt: tirage(7), log: (l) => lignes.push(l) });
  let pose = false;
  s.onChange(() => {
    try {
      const v = s.snapshot();
      if (v.message) messages.add(v.message);
      const d = v.state?.decision;
      if (!d || d.player !== 1 || v.end) return;
      if (d.tag === 'discard') return; // le joueur ne répond pas (onglet fermé, réflexion trop longue…)
      let choix = (d.options.find((o) => o.id !== 'none') ?? d.options[0]).id;
      if (d.kind === 'mulligan') choix = 'keep';
      else if (d.kind === 'main') {
        const sanji = d.options.find((o) => o.id.startsWith('play:') && v.state!.players[1].hand.find((c) => `play:${c.uid}` === o.id)?.num === 'OP17-082');
        choix = sanji && !pose ? (pose = true, sanji.id) : 'end';
      }
      s.answer(v.seq, choix);
    } catch (e) { if (!(e as { code?: string }).code) throw e; }
  });
  const fin = await s.done;
  const texte = lignes.join('\n');
  assert.ok(pose, 'Sanji posé');
  assert.match(texte, /écart \(désynchronisation\) : .*question d'effet attendait \(joueur 1, discard\) : effet terminé par défaut/);
  assert.ok([...messages].some((m) => /Désynchronisation corrigée/.test(m)), 'le joueur est prévenu');
  assert.equal(fin.kind, 'left', `la partie va à son terme\n${texte}`);
  assert.ok(s.stats().notes <= 25);
  assert.ok(hote.recues().some((r) => r.name === 'MoveHandCardToDiscardServerRpc'), 'les défausses par défaut partent dans le jeu');
});
