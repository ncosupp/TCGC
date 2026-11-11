// Erreurs grossières de l'IA simple sur des decks tirés au hasard dans tout le catalogue (tâche CF.1) : IA contre IA,
// chaque décision relue. Compte ce qu'un joueur ne ferait jamais : effet activé qui ne peut rien faire, Événement joué
// pour rien, attaque vouée à l'échec, coût payé pour rien, [Déclenchement] activé qui ne fait rien, [Contre] gardé en
// main jusqu'à perdre la partie, Événement [Contre] jamais utilisé, question « combien ? » toujours à 0. Les erreurs sont
// comptées à part pour les cartes des decks du registre (leurs décisions ne changent pas : empreinte) et pour les autres.
//   node --no-warnings scripts/game/ai-erreurs.ts [parties] [--graine N] [--detail]
import '../../game/data/load-local.ts';
import { heuristicChooser } from '../../game/ai/heuristic.ts';
import { useless } from '../../game/ai/prune.ts';
import { bestCostedNet, counterGain, legacyCard, netValue, recipeOf, timingValue } from '../../game/ai/recipeValue.ts';
import { CARDS, cardStatus, HIDDEN } from '../../game/engine/cards/index.ts';
import { DECK_SIZE, MAX_COPIES } from '../../game/engine/deckRules.ts';
import { CUSTOM_SERIES, type DeckList } from '../../game/engine/decks.ts';
import { newGame } from '../../game/engine/engine.ts';
import { counterValue, def, findField, power } from '../../game/engine/rules.ts';
import type { Decision, GameState } from '../../game/engine/types.ts';

const args = process.argv.slice(2);
const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const plain = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--graine');
const games = Number(plain[0] ?? 200);
let seed = Number(value('--graine') ?? 20261110);
const detail = args.includes('--detail');
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const playable = Object.keys(CARDS).filter((n) => n !== HIDDEN && cardStatus(n) !== 'todo');
const leaders = playable.filter((n) => CARDS[n].category === 'LEADER' && !n.startsWith('AV-'));
function randomDeck(leader: string, k: number): DeckList {
  const L = CARDS[leader];
  const pool = playable.filter((n) => {
    const d = CARDS[n];
    return d.category !== 'LEADER' && d.colors.length > 0 && d.colors.every((c) => L.colors.includes(c)) && !L.rules?.deckRestriction?.(d);
  });
  const cards: Record<string, number> = {};
  let total = 0;
  for (let guard = 0; total < DECK_SIZE && guard < 10000; guard++) {
    const n = pool[Math.floor(rand() * pool.length)];
    const add = Math.min(MAX_COPIES - (cards[n] ?? 0), 2 + Math.floor(rand() * 3), DECK_SIZE - total);
    if (add <= 0) continue;
    cards[n] = (cards[n] ?? 0) + add;
    total += add;
  }
  return { id: `PERSO-mesure${k}`, name: `Mesure ${k}`, series: CUSTOM_SERIES, leader, cards };
}

// Compteurs : [cartes des decks du registre, autres cartes]
type Kind = 'effetInutile' | 'evenementInutile' | 'attaqueVaine' | 'contreInutile' | 'coutPourRien' | 'declenchementInutile'
  | 'contreOublie' | 'combienZero' | 'effetPerdant' | 'evenementPerdant' | 'coutTropCher';
const LABELS: Record<Kind, string> = {
  effetInutile: '[Activation : Principale] qui ne peut rien faire',
  evenementInutile: 'Événement [Principale] qui ne peut rien faire',
  attaqueVaine: 'attaque vouée à l’échec (sans effet en attaquant)',
  contreInutile: '[Contre] sur une attaque déjà repoussée ou mal ciblé',
  coutPourRien: 'coût facultatif payé pour un effet qui ne fait rien',
  declenchementInutile: '[Déclenchement] activé qui ne fait rien (recettes)',
  contreOublie: 'défaite avec assez de [Contre] en main pour l’éviter',
  combienZero: 'question « combien ? » répondue 0 alors qu’un nombre suffisait à changer l’issue du combat (P-051, P-059)',
  effetPerdant: '[Activation : Principale] qui coûte plus qu’il ne rapporte (recettes)',
  evenementPerdant: 'Événement qui coûte plus qu’il ne rapporte (recettes ; EB01-059, EB01-060 avec 3 Vies ou plus)',
  coutTropCher: 'coût facultatif payé plus cher que l’effet (recettes)',
};
const counts = Object.fromEntries(Object.keys(LABELS).map((k) => [k, [0, 0]])) as Record<Kind, [number, number]>;
const byCard = new Map<string, number>();
const note = (k: Kind, num: string | undefined) => {
  const legacy = num ? legacyCard(num) : false;
  counts[k][legacy ? 0 : 1]++;
  if (num) byCard.set(`${k} ${num}`, (byCard.get(`${k} ${num}`) ?? 0) + 1);
};
// Événements [Contre] : occasions (attaque qui passerait, carte proposée qui donnerait de la puissance) et utilisations
const counterSeen = new Map<string, { chances: number; used: number }>();
let decisions = 0;
let counterDecisions = 0;
let counterUsed = 0;

const numOf = (s: GameState, uid: number | undefined) => {
  if (uid === undefined) return undefined;
  const f = findField(s, uid);
  if (f) return f.card.num;
  for (const P of s.players) for (const c of [...P.hand, ...P.trash, ...P.life]) if (c.uid === uid) return c.num;
  return undefined;
};

// Puissance qu'une option de Contre apporterait (même lecture pour tous les essais, avant comme après)
function counterPowerOf(s: GameState, d: Decision, id: string): number {
  const [kind, a] = id.split(':');
  const num = numOf(s, Number(a));
  if (!num || !s.battle) return 0;
  if (kind === 'counter') return counterValue(s, d.player, num);
  const own = def(num).counterPower;
  if (own) return own(s, d.player, s.battle.target);
  return counterGain(s, d.player, num, s.battle.target) ?? 0;
}

function inspect(s: GameState, d: Decision, ai: string) {
  decisions++;
  const o = d.options.find((x) => x.id === ai)!;
  const u = useless(s, d, o);
  const [kind, a] = ai.split(':');
  if (d.kind === 'main' && kind === 'act' && u?.kind === 'idleEffect') note('effetInutile', numOf(s, Number(a)));
  if (d.kind === 'main' && kind === 'event' && u) note('evenementInutile', numOf(s, Number(a)));
  if (d.kind === 'main' && kind === 'act' && !u) {
    const num = numOf(s, Number(a));
    const v = num && recipeOf(num) ? netValue(s, d.player, num, 'activateMain', Number(a)) : null;
    if (v !== null && v < 0) note('effetPerdant', num);
  }
  if (d.kind === 'main' && kind === 'event' && !u) {
    const num = numOf(s, Number(a))!;
    const v = recipeOf(num) ? timingValue(s, d.player, num, 'main') : null;
    if ((v !== null && v < 0) || ((num === 'EB01-059' || num === 'EB01-060') && s.players[d.player].life.length >= 3)) note('evenementPerdant', num);
  }
  if (d.tag === 'may' && ai === 'yes' && d.source !== undefined) {
    const num = numOf(s, d.source);
    const v = num && recipeOf(num) ? bestCostedNet(s, d.player, num, d.source) : null;
    if (v !== null && v < -0.5) note('coutTropCher', num);
  }
  if (d.kind === 'main' && kind === 'attack' && u?.kind === 'weakAttack') note('attaqueVaine', numOf(s, Number(a)));
  if (d.kind === 'counter' && (kind === 'counter' || kind === 'cevent') && u) note('contreInutile', numOf(s, Number(a)));
  if (d.tag === 'mayIdle' && ai !== 'no') note('coutPourRien', numOf(s, d.source));
  if (d.tag === 'mayCount' && ai === 'n:0' && s.battle) {
    // le nombre qui change l'issue : +1000 par carte défaussée en attaquant (P-051), +2000 par Personnage renvoyé en défendant (P-059)
    const atk = power(s, s.battle.attacker);
    const dp = power(s, s.battle.target);
    const max = Math.max(...d.options.map((x) => Number(x.id.split(':')[1]) || 0));
    const num = numOf(s, d.source);
    const need = num === 'P-051' ? (atk < dp ? Math.ceil((dp - atk) / 1000) : 0) : atk >= dp ? Math.ceil((atk - dp + 1000) / 2000) : 0;
    if (need > 0 && need <= Math.min(2, max)) note('combienZero', num);
  }
  if (d.tag === 'trigger' && ai === 'trigger') {
    const num = d.options.find((x) => x.id === 'trigger')?.num;
    if (num && recipeOf(num)) {
      const v = timingValue(s, d.player, num, 'trigger');
      if (v !== null && v <= 0) note('declenchementInutile', num);
    }
  }
  if (d.kind === 'counter' && s.battle) {
    const b = s.battle;
    const atk = power(s, b.attacker);
    const dp = power(s, b.target);
    if (atk >= dp) {
      counterDecisions++;
      if (ai !== 'pass') counterUsed++;
      for (const x of d.options) {
        if (!x.id.startsWith('cevent:') || useless(s, d, x) || counterPowerOf(s, d, x.id) <= 0) continue;
        const num = numOf(s, x.uid ?? Number(x.id.split(':')[1]));
        if (!num) continue;
        const e = counterSeen.get(num) ?? { chances: 0, used: 0 };
        e.chances++;
        if (x.id === ai) e.used++;
        counterSeen.set(num, e);
      }
      // la Vie est vide : ce coup sur le Leader fait perdre ; les Contres proposés auraient-ils suffi ?
      const P = s.players[d.player];
      if (ai === 'pass' && b.target === P.leader.uid && P.life.length === 0) {
        const need = atk - dp + 1000;
        const total = d.options.filter((x) => x.id !== 'pass' && !useless(s, d, x)).reduce((sum, x) => sum + counterPowerOf(s, d, x.id), 0);
        if (total >= need) note('contreOublie', undefined);
      }
    }
  }
}

const t0 = Date.now();
let turns = 0;
let failures = 0;
for (let g = 0; g < games; g++) {
  const decks = [randomDeck(leaders[Math.floor(rand() * leaders.length)], 2 * g), randomDeck(leaders[Math.floor(rand() * leaders.length)], 2 * g + 1)] as [DeckList, DeckList];
  const gameSeed = Math.floor(rand() * 2 ** 31);
  try {
    const end = newGame({ decks, names: ['A', 'B'], seed: gameSeed, first: g % 2 ? 1 : 0 }, (st, d) => {
      const ai = heuristicChooser(st, d);
      inspect(st, d, ai);
      return ai;
    });
    turns += end.turn;
  } catch (err) {
    failures++;
    console.log(`- partie ${g} (graine ${gameSeed}, ${decks[0].leader} contre ${decks[1].leader}) : ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
}

const never = [...counterSeen.entries()].filter(([, e]) => e.chances >= 4 && e.used === 0).map(([n]) => n).sort();
console.log(`${games} parties en ${Math.round((Date.now() - t0) / 1000)} s (${Math.round(turns / Math.max(1, games))} tours en moyenne), ${failures} erreur(s), ${decisions} décisions`);
console.log('Erreurs grossières (cartes des decks du registre / autres cartes) :');
for (const [k, label] of Object.entries(LABELS) as [Kind, string][]) console.log(`  ${label} : ${counts[k][0]} / ${counts[k][1]}`);
const seen = [...counterSeen.values()];
console.log(`[Contre] : ${counterUsed} défenses sur ${counterDecisions} attaques qui passaient ; Événements [Contre] : ${seen.reduce((x, e) => x + e.used, 0)} utilisés sur ${seen.reduce((x, e) => x + e.chances, 0)} occasions`);
console.log(`Événements [Contre] jamais utilisés (4 occasions ou plus) : ${never.length} (${never.filter((n) => !legacyCard(n)).length} hors decks du registre)${never.length ? ` : ${never.join(' ')}` : ''}`);
if (detail) {
  const top = [...byCard.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40);
  for (const [k, n] of top) console.log(`  ${k}${legacyCard(k.split(' ')[1] ?? '') ? ' (deck du registre)' : ''} : ${n}`);
}
