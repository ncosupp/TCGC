// Tâche O3.2 : le cas Sanji OP17-082 (essais du site, 18 nov.) de bout en bout côté serveur : le joueur joy-boy suit la
// partie par le flux temps réel (GET /api/game/crossplay/:id/events) et répond par POST /api/game/crossplay/:id/act,
// comme le navigateur ; l'hôte est le faux hôte interactif (faux-hote.ts, aucun accès réseau). Base temporaire.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DECKS } from '../../engine/decks.ts';
import { fauxHote } from './faux-hote.ts';
import { tirage } from './faux-jeu.ts';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-croisee-sanji-'));
process.env.TCGC_DB = join(dir, 'essai.db');
// journal complet des parties (hors du dépôt : ici le dossier temporaire)
process.env.TCGC_CROSSPLAY_JOURNAL = join(dir, 'journaux-site');
const paths = { db: '../../../server/db.js', crossplay: '../../../server/game-crossplay.js' };
const { db } = await import(paths.db);
const cp = await import(paths.crossplay);
after(() => {
  cp.closeAllCrossplay();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const A = { id: 1, pseudo: 'Robin' };
db.prepare('INSERT INTO users (id, pseudo, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(A.id, A.pseudo, 'joueur1@example.invalid', 'scrypt$essai', '2026-10-19T10:00:00Z');

/** Application factice : garde les routes déclarées par crossplayRoutes pour les appeler comme Express. */
function fausseAppli() {
  const routes = new Map<string, (req: unknown, res: unknown) => void>();
  const add = (verbe: string) => (chemin: string, ...h: ((req: unknown, res: unknown) => void)[]) => { routes.set(`${verbe} ${chemin}`, h[h.length - 1]); };
  return { get: add('GET'), post: add('POST'), routes };
}

const SANJI = 'OP17-082';
const ID = 'META-SABO-2026-10';
const SABO = { leader: DECKS[ID].leader, cards: Object.entries(DECKS[ID].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) };

test('serveur, Sanji OP17-082 : la défausse arrive par le flux temps réel et la réponse passe par /act', { timeout: 20_000 }, async () => {
  const appli = fausseAppli();
  cp.crossplayRoutes(appli, { log: () => {} });
  const hote = fauxHote(SABO, { tours: 3 });
  const lignes: string[] = [];
  const e = cp.joinCrossplay(A, { code: 'w1a2b3c', deck: ID }, { log: (...l: unknown[]) => lignes.push(l.join(' ')), connect: async () => hote.transport, randomInt: tirage(7) });

  // le flux temps réel, comme le navigateur
  const vues: any[] = [];
  const flux = {
    writeHead() {}, end() {},
    write(t: string) { for (const m of t.matchAll(/^data: (.*)$/gm)) vues.push(JSON.parse(m[1])); },
  };
  const req = { user: A, params: { id: e.id }, on() {} };
  appli.routes.get('GET /api/game/crossplay/:id/events')!(req, flux);

  // le joueur : garde sa main, pose Sanji, répond aux défausses (après un temps de réflexion), finit son tour
  let defausses = 0, sanji = 0, occupe = false;
  const joues = new Set<number>();
  const act = appli.routes.get('POST /api/game/crossplay/:id/act')!;
  const repondre = (v: any, choice: string) => {
    const res = { json(x: unknown) { return x; } };
    try { act({ user: A, params: { id: e.id }, body: { seq: v.seq, choice } }, res); } catch (err) {
      if (!['stale', 'not_your_turn'].includes((err as { code?: string }).code ?? '')) throw err;
    }
  };
  const fini = new Promise<void>((resolve, reject) => {
    const tic = setInterval(() => {
      try {
        const v = vues[vues.length - 1];
        if (!v || occupe) return;
        if (v.end) { clearInterval(tic); resolve(); return; }
        const d = v.state?.decision;
        if (!d || d.player !== 1) return;
        if (d.kind === 'mulligan') return repondre(v, 'keep');
        if (d.tag === 'discard') {
          occupe = true;
          setTimeout(() => { occupe = false; defausses++; repondre(v, d.options[0].id); }, 30);
          return;
        }
        if (d.kind === 'main') {
          const o = d.options.find((x: { id: string }) => x.id.startsWith('play:') && v.state.players[1].hand.find((c: { uid: number }) => `play:${c.uid}` === x.id)?.num === SANJI);
          if (o && !joues.has(v.state.turn)) { joues.add(v.state.turn); sanji++; return repondre(v, o.id); }
          return repondre(v, 'end');
        }
        repondre(v, (d.options.find((x: { id: string }) => x.id !== 'none') ?? d.options[0]).id);
      } catch (err) { clearInterval(tic); reject(err); }
    }, 2);
  });
  await fini;
  const fin = await e.s.done;
  assert.ok(sanji >= 1, 'Sanji posé depuis le site');
  assert.equal(defausses, 2 * sanji, 'chaque défausse a été proposée dans le flux');
  assert.equal(hote.recues().filter((r) => r.name === 'MoveHandCardToDiscardServerRpc').length, 2 * sanji);
  assert.equal(fin.kind, 'left');
  const texte = lignes.join('\n');
  assert.ok(!/fin de tour forcée|retenue par la session|écart [(]/.test(texte), texte);
  assert.match(texte, /journal : site-[\w-]+\.log/);

  // journal complet de la partie, au format du banc : relu par l'anonymiseur, lots entiers des deux sens
  await new Promise((r) => setTimeout(r, 2700));
  const [nom] = readdirSync(join(dir, 'journaux-site'));
  const journal = readFileSync(join(dir, 'journaux-site', nom), 'utf8');
  assert.match(journal, /ServerRpc objet \d+\/0 MoveHandCardToDiscardServerRpc/);
  assert.match(journal, />>> table partagée prête/);
  assert.match(journal, /BILAN \{"issue":"left/);
  const anon = await import(new URL('../../../scripts/optcgsim/anonymiser.mjs', import.meta.url).href);
  const lu = anon.lireJournal(journal);
  assert.ok(lu.lots.some((l: { sens: string }) => l.sens === 'sortant') && lu.lots.some((l: { sens: string }) => l.sens === 'entrant'));
  assert.equal(cp.journalDir(), join(dir, 'journaux-site'));
  const avant = process.env.TCGC_CROSSPLAY_JOURNAL;
  process.env.TCGC_CROSSPLAY_JOURNAL = join(process.cwd(), 'data', 'journaux');
  assert.equal(cp.journalDir(), null, 'jamais dans le dépôt');
  process.env.TCGC_CROSSPLAY_JOURNAL = avant;
});
