// Puissance passive lue dans le texte des cartes sans effet codé (crossplay OPTCGSim : « [DON!! x1] +1000 »).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CARDS } from '../engine/cards/index.ts';
import { power } from '../engine/rules.ts';
import { genericSelfPower } from '../engine/cards/generic-power.ts';
import { scenario, setChars } from './helpers.ts';

test('lecture générique : DON!! x1, tour, mélange avec un autre effet', () => {
  const f = genericSelfPower({ effectEn: '[DON!! x1] This Character gains +1000 power. [On Play] Draw 1 card.' })!;
  const s = { active: 0 } as never;
  assert.equal(f(s, 0, { don: 0 } as never), 0);
  assert.equal(f(s, 0, { don: 1 } as never), 1000);
  const t = genericSelfPower({ effectEn: "[DON!! x2] [Opponent's Turn] This Leader gains +2000 power." })!;
  assert.equal(t(s, 0, { don: 2 } as never), 0);
  assert.equal(t(s, 1, { don: 2 } as never), 2000);
  assert.equal(genericSelfPower({ effectEn: 'This Character gains +1000 power for every 5 Events in your trash.' }), undefined);
  assert.equal(genericSelfPower({ effectEn: '[DON!! x1] [When Attacking] This Character gains +1000 power.' }), undefined);
});

test('puissance du moteur : base + DON!! + texte lu (texte d’OP18-051)', () => {
  const code = 'OP12-093';   // 5000, sans effet
  const saved = CARDS[code];
  try {
    CARDS[code] = { ...saved, selfPower: genericSelfPower({ effectEn: '[DON!! x1] This Character gains +1000 power.' }) };
    const s = scenario(['ST-35', 'ST-35'], (g) => { setChars(g, 0, [{ num: code, extra: { don: 1 } }]); });
    assert.equal(power(s, s.players[0].chars[0].uid), 5000 + 1000 + 1000);
  } finally { CARDS[code] = saved; }
});
