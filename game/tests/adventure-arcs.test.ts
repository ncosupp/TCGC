// Passage d'un arc à l'autre (tâche 5.7) : Alabasta s'ouvre quand East Blue est fini (logique pure et serveur), la
// progression d'East Blue ne bouge pas, un compte neuf ne voit pas Alabasta. Base temporaire.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ALABASTA } from '../adventure/alabasta.ts';
import { ARCS } from '../adventure/arcs.ts';
import { EAST_BLUE } from '../adventure/east-blue.ts';
import { activeArc, allStatuses, arcOpen, chapterStatuses, currentChapter } from '../adventure/progress.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-arcs-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const paths = { db: '../../server/db.js', adventure: '../../server/game-adventure.js' };
const { db } = await import(paths.db);
const adv = await import(paths.adventure);
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const story = (arc: typeof EAST_BLUE) => arc.chapters.filter((c) => !c.optional).map((c) => c.id);
const eastBlueDone = new Set(story(EAST_BLUE));

test('ARCS contient East Blue puis Alabasta', () => {
  assert.deepEqual(ARCS.map((a) => a.id), ['east-blue', 'alabasta']);
});

test('Alabasta est fermé tant qu’East Blue n’est pas fini, ouvert ensuite', () => {
  assert.equal(arcOpen(ALABASTA, new Set()), false);
  const almost = new Set(story(EAST_BLUE).slice(0, -1));
  assert.equal(arcOpen(ALABASTA, almost), false);
  assert.ok(Object.values(chapterStatuses(ALABASTA, almost)).every((s) => s === 'locked'));
  assert.equal(arcOpen(ALABASTA, eastBlueDone), true);
  const first = [...ALABASTA.chapters].sort((a, b) => a.order - b.order)[0];
  assert.equal(chapterStatuses(ALABASTA, eastBlueDone)[first.id], 'open');
  assert.equal(currentChapter(ALABASTA, eastBlueDone), first.id);
  assert.equal(activeArc(new Set()).id, 'east-blue');
  assert.equal(activeArc(eastBlueDone).id, 'alabasta');
  assert.equal(activeArc(new Set([...eastBlueDone, ...story(ALABASTA)])).id, 'alabasta');
});

test('les chapitres d’East Blue gardent leur état', () => {
  const wins = new Set(story(EAST_BLUE).slice(0, 2));
  const all = allStatuses(wins);
  assert.deepEqual(Object.fromEntries(EAST_BLUE.chapters.map((c) => [c.id, all[c.id]])), chapterStatuses(EAST_BLUE, wins));
});

test('serveur : un compte qui a fini East Blue voit Alabasta, un compte neuf non', () => {
  for (const id of [1, 2]) {
    db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, `joueur${id}`, `joueur${id}@example.invalid`, 'scrypt$essai', '2026-11-11T10:00:00Z');
  }
  const at = '2026-11-11T10:00:00Z';
  db.prepare('INSERT INTO game_adventure (user_id, arc, started_at, deck_id) VALUES (1, ?, ?, NULL)').run('east-blue', at);
  db.prepare('INSERT INTO game_adventure (user_id, arc, started_at, deck_id) VALUES (2, ?, ?, NULL)').run('east-blue', at);
  for (const chapter of eastBlueDone) db.prepare('INSERT INTO game_progress (user_id, chapter, wins, first_win_at) VALUES (1, ?, 1, ?)').run(chapter, at);
  const done = adv.adventureState(1);
  assert.equal(done.arcs.alabasta.started, true);
  assert.equal(done.arcs['east-blue'].started, true);
  assert.equal(Object.keys(done.chapters).length, EAST_BLUE.chapters.length + ALABASTA.chapters.length);
  const fresh = adv.adventureState(2);
  assert.equal(fresh.arcs.alabasta.started, false);
  assert.equal(fresh.chapters['al-1-reverse-mountain'].wins, 0);
});

test('serveur : un chapitre d’Alabasta est refusé à un compte neuf, accepté (jusqu’au contrôle de la partie) à l’autre', () => {
  assert.throws(() => adv.chapterResult(2, 'al-1-reverse-mountain', 'abcdefghijklmnop'), (e: { code?: string }) => e.code === 'not_started');
  assert.throws(() => adv.startArc(2, 'alabasta'), (e: { code?: string }) => e.code === 'arc_locked');
  // le premier chapitre passe les contrôles d'accès (arrêt ensuite : cartes non chargées ou partie introuvable)
  assert.throws(() => adv.chapterResult(1, 'al-1-reverse-mountain', 'zzz'), (e: { code?: string }) => e.code === 'cards_loading' || e.code === 'unknown_record');
  // le deuxième reste verrouillé tant que le premier n'est pas gagné
  assert.throws(() => adv.chapterResult(1, 'al-2-whisky-peak', 'zzz'), (e: { code?: string }) => e.code === 'chapter_locked');
});
