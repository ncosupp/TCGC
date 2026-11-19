// Écart n° 5 des essais du site (tâche O3.2, 19 nov. 2026, partie uWEiLY) : l'hôte pose Roronoa Zoro OP18-092, carte
// connue de joy-boy mais pas encore jouable (Décision 8 : relevée, la partie continue). Le navigateur ne reçoit au
// chargement que les cartes jouables : la vue d'une carte qu'il ne connaît pas faisait tomber toute la page, et
// « Recharger » retombait sur la même vue. Maintenant la session envoie les informations de ces cartes avec la vue, et
// la page montre de dos toute carte qu'elle ne connaîtrait toujours pas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardData } from '../../engine/cards/index.ts';
import { CARDS, HIDDEN } from '../../engine/cards/registry.ts';
import { startSession } from '../../online/optcgsim/session.ts';
import { prepareView, type SessionSnapshot } from '../../ui/online/crossplay.ts';
import { avecCartes, carteSansEffet, fauxJeu, st01, tirage } from './faux-jeu.ts';

test('vue croisée : les cartes OPTCGSim connues mais pas jouables arrivent avec la vue (Décision 8)', async (t) => {
  const code = await carteSansEffet();
  if (!code) { t.skip('aucune carte sans effet codé dans le catalogue'); return; }
  const jeu = fauxJeu(avecCartes([code, code]), { arret: 120 });
  const s = startSession({ code: 'P1A2B3C', deck: st01(), name: 'JoyBoy', connect: async () => jeu.transport, closeDelayMs: 0, randomInt: tirage() });
  await new Promise<void>((r) => { const off = s.onChange(() => { if (s.snapshot().status === 'playing') { off(); r(); } }); });
  const v = s.snapshot();
  assert.ok(v.cards?.[code], 'informations de la carte jointes à la vue');
  assert.equal(v.cards![code].name, cardData()[code].name);
  // vue sérialisée (flux temps réel) : elle passe telle quelle en JSON
  const relue = JSON.parse(JSON.stringify(v)) as SessionSnapshot;
  assert.equal(relue.cards?.[code]?.number ?? code, code);
  s.close();
  await s.done;
});

test('vue croisée côté page : carte inconnue de la page montrée de dos, puis connue dès que ses informations arrivent', async (t) => {
  const code = await carteSansEffet();
  if (!code) { t.skip('aucune carte sans effet codé dans le catalogue'); return; }
  // la page n'a pas reçu cette carte (comme le navigateur : seulement les cartes jouables)
  const saved = CARDS[code];
  delete CARDS[code];
  try {
    const carte = { uid: 501, num: code, rested: false, don: 0, playedTurn: 3, usedOpt: [] };
    const joueur = (chars: typeof carte[]) => ({
      leader: { uid: 1, num: 'ST01-001', rested: false, don: 0, playedTurn: 0, usedOpt: [] }, chars, stage: null,
      hand: [], deck: [], life: [], trash: [{ uid: 502, num: code }],
    });
    const vue = {
      status: 'playing', seq: 0, opponent: null, message: null, unknown: [], end: null,
      state: { players: [joueur([carte]), joueur([])], decision: null },
    } as unknown as SessionSnapshot;
    const sans = prepareView(vue);
    assert.equal(sans.state!.players[0].chars[0].num, HIDDEN, 'de dos plutôt qu’une page qui tombe');
    assert.equal(sans.state!.players[0].trash[0].num, HIDDEN);
    const avec = prepareView({ ...vue, cards: { [code]: cardData()[code] } });
    assert.ok(CARDS[code], 'informations chargées dans la page');
    assert.equal(avec.state!.players[0].chars[0].num, code);
    assert.equal(CARDS[code].name, cardData()[code].name);
  } finally {
    if (saved) CARDS[code] = saved;
  }
});
