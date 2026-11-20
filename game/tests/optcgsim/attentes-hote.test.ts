// Tâche O5.2 (audit O5.0, § 3 et § 5.1) : chaque type de point d'attente de l'inventaire joué par le faux hôte fidèle
// (faux-hote.ts : il tient son iPlayerAction et ses drapeaux comme le jeu 1.45b, refuse d'avancer tant que la main ne lui
// est pas rendue comme le ferait le vrai client, compte les désaccords sur qui agit et relève les impasses « les deux
// camps s'attendent »). Assertion commune : ni impasse, ni désaccord, et la pendule de joy-boy ne tourne jamais plus de
// 15 s (simulées) sans décision montrée.
//
// Les points que la session ne traite pas encore sont marqués `todo` avec leur numéro dans l'audit et la tâche qui doit
// les corriger : ils échouent aujourd'hui (c'est ce qu'ils démontrent) sans faire échouer `npm test`. Quand une tâche O5
// corrige un point, elle retire le `todo` du test correspondant.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionOptions } from '../../online/optcgsim/session.ts';
import {
  actionImposee, ancienneAction, ANCIENNES_ENVOYEES, annulation, attaqueHote, attaqueIgnoree, attaqueRetenue, avecActeur, BLOQUEURS, DECLENCHEURS,
  effetFinTour, hoteMuet, listeReactions, offreDeclenchement, partie, problemes, procV3, rembobinage, remplacementSoi, ST01, type Partie,
} from './faux-hote-attentes.ts';
import { buildBatch } from '../../online/optcgsim/netcode.ts';
import { rpcMessage } from '../../online/optcgsim/rpc.ts';
import { fauxHote, type Injection } from './faux-hote.ts';

const BR = String.fromCharCode(10);
/** Aucun déblocage du filet anti-impasse n'a été nécessaire (traitement propre, O5.4). */
const sansFilet = (p: Partie) => assert.equal(p.s.stats().unstuck, 0, (p.s.stats().unstuckLog ?? []).join(BR));
const T = { timeout: 30_000 };
/** La partie est allée au bout (l'hôte a quitté la salle après ses tours, ou fin de partie) sans aucun problème. */
function sain(p: Partie, attendues: string[] = []) {
  const pb = problemes(p);
  assert.deepEqual(pb, [], `${pb.join(BR)}${BR}${p.texte}`);
  for (const id of attendues) {
    assert.ok(p.hote.jouees().includes(id), `attente ${id} jouée${BR}${p.hote.jouees().join(', ')}${BR}${p.texte}`);
    assert.ok(p.hote.liberees().includes(id), `l'hôte a été libéré de ${id}${BR}${p.noms.slice(-30).join(' ')}${BR}${p.texte}`);
  }
  assert.ok(['left', 'game'].includes(p.fin.kind), `${JSON.stringify(p.fin)}${BR}${p.texte}`);
}

// ---------------------------------------------------------------------------------------------------- le faux hôte

test('faux hôte fidèle : partie de référence (pendule simulée), aucune impasse ni désaccord', T, async () => {
  const p = await partie();
  sain(p);
  assert.ok(p.hote.recues().some((r) => r.name === 'EndTurnServerRpc'), 'joy-boy a joué ses tours');
});

test('faux hôte fidèle : il relève l’impasse et quitte quand joy-boy ne lui rend jamais la main', T, async () => {
  // une action imposée dont l'hôte n'est jamais libéré (libération impossible) : le détecteur doit la relever
  const bloque: Injection = { id: 'jamais', quand: 'tourHote', jouer: (h) => { h.etat.action = 1; h.attendre('jamais', { libere: () => false }); } };
  const p = await partie({ injections: [bloque] });
  assert.equal(p.hote.impasses().length, 1, p.texte);
  assert.equal(p.hote.impasses()[0].attente, 'jamais');
  assert.equal(p.fin.winner, null, 'arrêt sans perdant');
});

test('faux hôte fidèle : un SwitchTurns de trop pendant le tour de joy-boy (remise de #39) est un désaccord, et l’hôte croit jouer', T, async () => {
  // joy-boy simulé à la main (sans session) : tirage, Vie, puis, à son tour, la remise de #39 (SwitchTurns, ResetActionPhase)
  const h = fauxHote(ST01(), { tours: 2 });
  const lot = (...r: [string, Record<string, unknown>][]) => buildBatch(r.map(([n, v]) => rpcMessage(`${n}ServerRpc`, v, { object: 2 })));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  h.transport.onData?.(() => {});
  h.transport.onClose?.(() => {});
  h.transport.send(lot(['VersionCheck', { sVersion: '1.45b' }]));
  await pause(10);
  h.transport.send(lot(['SetMyTurnRoll', { iRoll: 0 }]));
  h.transport.send(lot(['PopulateLifeDeck', { iLifeCount: 5 }]));
  await pause(30);
  assert.equal(h.miroir().turnPlayer, 1, 'tour de joy-boy');
  assert.equal(h.etat().action, 1);
  assert.equal(h.desaccords(), 0);
  h.transport.send(lot(['AllOnKOResolved', {}], ['SwitchTurns', {}], ['ResetActionPhase', {}], ['NoMorePendingActions', {}]));
  await pause(10);
  assert.equal(h.etat().action, 0, 'l’hôte croit avoir la main');
  assert.ok(h.desaccords() >= 1, h.listeDesaccords().join(BR));
  h.transport.send(lot(['MoveHandCardToDeploy', { iIdx: 0, bRested: false }]));
  await pause(10);
  assert.ok(h.listeDesaccords().some((d) => /joy-boy joue/.test(d)), h.listeDesaccords().join(BR));
  h.fermer();
});

// ---------------------------------------------------------------------------------------------------- combat (l'hôte attaque)

test('CD1 + CD7 bloqueur : l’hôte attaque, Chopper bloque et est mis KO, la main revient à l’hôte', T, async () => {
  const p = await partie({ joyboy: BLOQUEURS(), injections: [attaqueHote('CD1', { tour: 2 }), attaqueHote('CD1b', { tour: 3 })], prefs: { bloquer: true } });
  sain(p, ['CD1']);
  assert.ok(p.noms.includes('SetBlockerServerRpc'), p.noms.join(' '));
  assert.ok((p.vu.decisions.blocker ?? 0) >= 1);
});

test('CD1 sans bloqueur : NoBlocker, Leader touché, la main revient à l’hôte', T, async () => {
  const p = await partie({ injections: [attaqueHote('CD1', { tour: 2 })] });
  sain(p, ['CD1']);
  assert.ok(p.noms.includes('ResolveAttackServerRpc'));
});

test('CD3 contre : joy-boy contre, l’attaque est repoussée, l’hôte reprend', T, async () => {
  const p = await partie({ injections: [attaqueHote('CD3', { tour: 2 }), attaqueHote('CD3b', { tour: 3 })], prefs: { contrer: true } });
  sain(p, ['CD3']);
  assert.ok(p.noms.includes('AddCounterAmountServerRpc'), p.noms.join(' '));
});

test('CD5 [Déclenchement] : Leader touché, le [Déclenchement] est activé, la main revient à l’hôte', T, async () => {
  const p = await partie({ joyboy: DECLENCHEURS(), injections: [attaqueHote('CD5', { tour: 2 }), attaqueHote('CD5b', { tour: 3 })], prefs: { declencher: true } });
  sain(p, ['CD5']);
  assert.ok((p.vu.decisions.trigger ?? 0) >= 1, JSON.stringify(p.vu.decisions));
});

test('CD5 [Déclenchement] refusé : la carte va en main, la main revient à l’hôte', T, async () => {
  const p = await partie({ joyboy: DECLENCHEURS(), injections: [attaqueHote('CD5', { tour: 2 })] });
  sain(p, ['CD5']);
});

// Attaque sur une cible qui n'existe pas non plus dans le miroir (iDefenderIdx 4) : O5.3 joue le combat « à l'aveugle »
// (NoBlocker, ResolveNoAttack) et l'échelon 4 rend la main. Couvert par le filet seulement (cas artificiel).
test('CD2 bis attaque sur une cible inconnue du moteur et du miroir : l’hôte attend son bloqueur, libéré par le filet', T, async () => {
  const p = await partie({ injections: [attaqueIgnoree()] });
  sain(p, ['CD2']);
});

// Tâche O5.5 : un vrai CD2. L'hôte attaque le Leader de joy-boy, qui perd une Vie à [Déclenchement] ; pendant la question
// (le joueur joy-boy réfléchit 100 ms), l'hôte attaque avec un Personnage. joy-boy retient l'attaque, finit la question
// (AllOnKOResolved sans SwitchTurns), puis joue le combat retenu : sans aucun déblocage du filet.
test('CD2 (audit : certain) attaque pendant une question d’effet de joy-boy : retenue, jouée après la question, sans filet', T, async () => {
  const p = await partie({ joyboy: DECLENCHEURS(), injections: attaqueRetenue('CD2', { tour: 3 }), prefs: { pauseDeclenchement: 100 } });
  sain(p, ['CD2']);
  assert.ok(p.hote.jouees().includes('CD2 pose'), 'Personnage de l’hôte posé');
  assert.equal(p.s.stats().unstuck, 0, (p.s.stats().unstuckLog ?? []).join(BR));
  assert.match(p.texte, /attaque retenue jusqu’à la fin de l’effet/);
  assert.equal(p.noms.filter((n) => n === 'ResolveAttackServerRpc').length, 2, 'les deux attaques résolues par joy-boy');
});

// ---------------------------------------------------------------------------------------------------- [Déclenchement] offert

test('R5 offre de [Déclenchement] au tour de l’hôte : refusée sans blocage, main rendue', T, async () => {
  const p = await partie({ joyboy: DECLENCHEURS(), injections: [offreDeclenchement('R5', 'tourHote')] });
  sain(p, ['R5']);
});

test('CA5 offre de [Déclenchement] pendant le tour de joy-boy : AllOnKOResolved seul, joy-boy garde la main', T, async () => {
  const p = await partie({ joyboy: DECLENCHEURS(), injections: [offreDeclenchement('CA5', 'poseJoyboy')], prefs: { pauseFin: 300 } });  // 30 ms : course avec l'injection (5 ms) sous charge
  sain(p, ['CA5']);
});

// ---------------------------------------------------------------------------------------------------- actions imposées

const GENRES: [string, string, (p: Partie) => void][] = [
  ['défausse (OP05-082)', 'OP05-082', (p) => assert.ok(p.noms.includes('MoveHandCardToDiscardServerRpc'), p.noms.join(' '))],
  ['renvoi en main (OP06-051)', 'OP06-051', (p) => assert.ok(p.noms.some((n) => /ReturnCardToMyHand|DeployToHand|ToHand/.test(n)), p.noms.join(' '))],
  ['dessous du deck (P-055)', 'P-055', (p) => assert.ok(p.noms.some((n) => /DeckBottom|ToDeck/.test(n)), p.noms.join(' '))],
  ['genre inconnu (OP06-044)', 'OP06-044', (p) => assert.match(p.texte, /genre non reconnu, main rendue sans effet/)],
];
for (const [nom, code, verif] of GENRES) {
  test(`R4 action imposée au tour de l’hôte, ${nom} : jouée, main rendue, l’hôte reprend`, T, async () => {
    const p = await partie({ hote: avecActeur(code), injections: [actionImposee('R4', 'tourHote', (h) => h.toursHote() >= 2)] });
    sain(p, ['R4']);
    verif(p);
  });
}

test('R4 action imposée, renvoi de DON!! (OP02-085) : le genre est joué (DON!! renvoyées)', T, async () => {
  const p = await partie({ hote: avecActeur('OP02-085'), injections: [actionImposee('R4', 'tourHote', (h) => h.toursHote() >= 2)] });
  sain(p, ['R4']);
  assert.ok(p.noms.includes('ReturnDonServerRpc'), p.noms.join(' '));
  assert.ok((p.vu.decisions.forced ?? 0) >= 1, JSON.stringify(p.vu.decisions));
  sansFilet(p);
});

test('CA4 action imposée pendant le tour de joy-boy : AllOnKOResolved sans SwitchTurns, joy-boy garde la main', T, async () => {
  const p = await partie({ hote: avecActeur('OP05-082'), injections: [actionImposee('CA4', 'poseJoyboy')], prefs: { pauseFin: 300 } });
  sain(p, ['CA4']);
});

test('R4 en combat (audit : possible ; Q6) : le [Contre] de l’hôte impose une action quand joy-boy attaque ; pas d’impasse, l’étape des contres revient à l’hôte', T, async () => {
  const p = await partie({ hote: avecActeur('OP05-082'), injections: [actionImposee('R4c', 'contresHote')], prefs: { attaquer: true } });
  sain(p, ['R4c']);
});

// ---------------------------------------------------------------------------------------------------- réactions

// O5.4 : comme le jeu (BeginOpponentV3Action), iActor désigne un Personnage de joy-boy qui est sur son terrain (identifiant
// OPTCGSim de la carte de ce numéro chargée en premier ; la session prend la carte de ce numéro sur le terrain)
const remplacementSoiEnJeu = (id = 'R2', eRemoval = 1): Injection => ({
  ...remplacementSoi(id), si: (h) => h.miroir().players[1].zones.deploy.some((c) => c.code),
  jouer: (h) => {
    const code = h.miroir().players[1].zones.deploy.find((c) => c.code)!.code;
    procV3(h, { iActor: (ST01().cards.indexOf(code) + 1) * 10, eRemoval, iRemovalPlayer: 0 });
    h.attendre(id);
  },
});
test('R2 remplacement de la carte elle-même (eRemoval 1) : le retrait demandé est appliqué des deux côtés', T, async () => {
  const p = await partie({ injections: [remplacementSoiEnJeu()] });
  sain(p, ['R2']);
  assert.ok(p.noms.includes('DiscardFromSelfDeployServerRpc'), p.noms.join(' '));
  assert.doesNotMatch(p.texte, /^écart/m, p.texte);
  sansFilet(p);
});
test('R2 remplacement de soi, les autres retraits (Rest, Vie dessous/dessus, Défausse, main, dessous du deck) : appliqués des deux côtés', { timeout: 90_000 }, async () => {
  for (const eRemoval of [2, 3, 4, 5, 6, 7]) {
    const p = await partie({ injections: [remplacementSoiEnJeu('R2', eRemoval)] });
    sain(p, ['R2']);
    assert.doesNotMatch(p.texte, /^écart/m, `retrait ${eRemoval}${BR}${p.texte}`);
    if (eRemoval === 6) assert.ok(p.noms.some((n) => /ToHand|ReturnCardToMyHand/.test(n)), p.noms.join(' '));
    sansFilet(p);
  }
});

test('R6 (audit : certain) liste de réactions sans ProcOpponentV3Action : jouée, main rendue', T, async () => {
  const p = await partie({ injections: [listeReactions('R6', { avecHote: false })] });
  sain(p, ['R6']);
});

test('R6 (audit : certain) liste de réactions avec une action de l’hôte : renvoyée à l’hôte', T, async () => {
  const p = await partie({ injections: [listeReactions('R6h', { avecHote: true })] });
  sain(p, ['R6h']);
  assert.ok(p.hote.recues().some((r) => r.name === 'TriggerOpponentMultiActionsServerRpc' && Array.isArray(r.values.aTransfer) && r.values.aTransfer.length >= 1));
});

for (const nom of ANCIENNES_ENVOYEES) {
  test(`R7 (audit : certain) ancienne action ${nom} : jouée ou passée, main rendue`, T, async () => {
    const p = await partie({ injections: [ancienneAction(nom, 'R7')] });
    sain(p, ['R7']);
  });
}

// Intégration de la vague O5-1 (chef de projet) : R4 en combat, R6 et R7 passaient grâce au filet anti-impasse
// (échelons 1, 3 et 4 d'attente.ts), pas par un traitement propre. Ces versions strictes exigent qu'aucun déblocage ne
// soit nécessaire : traités par O5.4 (question imposée montrée pendant l'attaque de joy-boy, liste décodée,
// anciennes actions jouées ou passées).
test('R4 en combat, sans filet : la défausse imposée par le [Contre] de l’hôte est montrée au joueur joy-boy', T, async () => {
  const p = await partie({ hote: avecActeur('OP05-082'), injections: [actionImposee('R4c', 'contresHote')], prefs: { attaquer: true } });
  sain(p, ['R4c']);
  sansFilet(p);
  assert.ok((p.vu.decisions.forced ?? 0) >= 1, `question imposée montrée : ${JSON.stringify(p.vu.decisions)}`);
  assert.ok(p.noms.includes('MoveHandCardToDiscardServerRpc'), p.noms.join(' '));
});
test('R6, sans filet : liste de réactions jouée et actions de l’hôte renvoyées sans déblocage', T, async () => {
  for (const avecHote of [false, true]) {
    const p = await partie({ injections: [listeReactions('R6', { avecHote })] });
    sain(p, ['R6']);
    sansFilet(p);
  }
});
test('R7, sans filet : les 8 anciennes actions jouées ou passées sans déblocage', { timeout: 120_000 }, async () => {
  for (const nom of ANCIENNES_ENVOYEES) {
    const p = await partie({ injections: [ancienneAction(nom, 'R7')] });
    sain(p, ['R7']);
    sansFilet(p);
  }
});

// ---------------------------------------------------------------------------------------------------- mise en place, tours, fins

test('M2 (audit : certain) égalité au tirage : joy-boy choisit l’ordre (l’hôte commence)', { ...T, todo: 'O5.6 : M2' }, async () => {
  const p = await partie({ options: { egalite: true } });
  sain(p);
  assert.ok(p.noms.includes('ChooseTurnOrderServerRpc'));
});

test('T3 effet de l’hôte pendant la fin du tour de joy-boy : joy-boy attend sa main avant EndTurn', { ...T, todo: 'O5.6 : T3' }, async () => {
  const p = await partie({ injections: [effetFinTour()] });
  sain(p);
});

test('T5 rembobinage demandé par l’hôte : jamais accepté, la partie continue', T, async () => {
  const p = await partie({ injections: [rembobinage()] });
  sain(p);
  assert.ok(!p.noms.includes('AcceptRestartTurnServerRpc'));
});

test('T6 / F10 annulation demandée par l’hôte : acceptée, partie arrêtée sans perdant (décision 11)', T, async () => {
  const p = await partie({ injections: [annulation()] });
  assert.deepEqual(p.hote.impasses(), [], p.texte);
  assert.ok(p.noms.includes('AcceptCancelMatchServerRpc'), p.noms.join(' '));
  assert.equal(p.fin.winner, null, JSON.stringify(p.fin));
});

test('inactivité : hôte muet dans une salle sans minuteur, victoire de joy-boy (décision 11)', T, async () => {
  // délai de la session pour un hôte muet (attente.ts, O5.1 : hostIdleMs, 5 min par défaut) raccourci pour le test
  const delai: Partial<SessionOptions> = { attente: { hostIdleMs: 500 } };
  const p = await partie({ options: { minuteur: false }, injections: [hoteMuet()], session: delai, garde: 4000 });
  assert.equal(p.garde, false, 'la session a conclu d’elle-même');
  assert.equal(p.fin.winner, 1, JSON.stringify(p.fin));
});

test('F12 (audit : certain) une impasse est conclue proprement par la session (arrêt sans perdant) avant que l’hôte n’abandonne', T, async () => {
  // un hôte qui attend joy-boy et ne se laisse débloquer par rien (la liste de réactions R6 est levée par l'échelle
  // depuis O5.1 : elle ne fait plus une impasse sans issue)
  const sansIssue: Injection = {
    id: 'F12', quand: 'tourHote', si: (h) => h.toursHote() >= 2,
    jouer: (h) => {
      h.emettre([h.rpc('SwitchTurns'), h.rpc('TriggerOpponentMultiActions', { aTransfer: [], bDontStartAny: false })]);
      h.etat.pending = true;
      h.etat.etat = 'OpponentResolving';
      // il reste persuadé d'attendre joy-boy (sa pendule tourne pour joy-boy) quoi que joy-boy lui envoie
      h.attendre('F12', { libere: () => { h.etat.action = 1; return false; } });
    },
  };
  const p = await partie({ injections: [sansIssue], options: { impasseSecondes: 400 } });
  assert.deepEqual(p.hote.impasses(), [], `la session a conclu avant le faux hôte${BR}${p.texte}`);
  assert.equal(p.fin.kind, 'desync', JSON.stringify(p.fin));
  assert.equal(p.fin.winner, null);
  assert.ok(p.s.stats().unstuck >= 1);
});

// sans pendule (salle sans minuteur) : mêmes attentes, aucun SetTimer
test('salle sans minuteur : bloqueur et action imposée sans blocage', T, async () => {
  const p = await partie({ hote: avecActeur('OP05-082'), options: { minuteur: false }, injections: [attaqueHote('CD1', { tour: 2 }), actionImposee('R4', 'tourHote', (h) => h.toursHote() >= 3)] });
  sain(p, ['CD1', 'R4']);
  assert.ok(!p.hote.recues().some((r) => r.name === 'SetTimerServerRpc'));
});
