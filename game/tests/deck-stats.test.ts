// Statistiques par deck (game/ui/deckStats.ts, étape J) : en ligne et contre l'IA séparés, détail par Leader adverse,
// parties d'entraînement et parties pas finies ignorées
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deckStats, statsText } from '../ui/deckStats.ts';

const g = (myDeck: string, aiDeck: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ status, config: { myDeck, aiDeck, level: 2, first: 'random' }, ...extra }) as never;
const leaders: Record<string, string> = { 'ST-01': 'ST01-001', 'ST-02': 'ST02-001' };

test('stats par deck : en ligne, contre l’IA, par Leader adverse', () => {
  const s = deckStats([
    g('PERSO-a', 'ST-01', 'won'),
    g('PERSO-a', 'ST-01', 'lost'),
    g('PERSO-a', 'ST-02', 'won', { mode: 'online' }),
    g('PERSO-a', 'ST-02', 'won', { practice: true }),
    g('PERSO-a', 'ST-02', 'playing'),
    g('PERSO-b', 'ST-02', 'abandoned'),
  ], (d) => leaders[d]);
  const a = s.get('PERSO-a')!;
  assert.deepEqual(a.ai, { wins: 1, losses: 1 });
  assert.deepEqual(a.online, { wins: 1, losses: 0 });
  assert.deepEqual(a.vs, { 'ST01-001': { wins: 1, losses: 1 }, 'ST02-001': { wins: 1, losses: 0 } });
  assert.equal(s.has('PERSO-b'), false);
  assert.equal(statsText(a), '1 V · 0 D en ligne · 1 V · 1 D contre l’IA');
  assert.equal(statsText(undefined), 'Pas encore joué');
});
