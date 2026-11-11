// Audit des cartes codées à la main avant l'étape C (tâche CF.2, rapport : game/docs/audit-cartes-codees.md).
//   node --no-warnings scripts/game/cards-audit.ts [--situations N] [--json fichier] [--cartes N1,N2...] [--detail]
//   node --no-warnings scripts/game/cards-audit.ts --hasard [parties par lot] : les cartes non comparées (texte non traduit,
//       recette non compilée, aucun moment déclenché) jouées dans des parties au hasard, 4 exemplaires forcés par deck, par lots
// Pour chaque carte des fichiers de cartes d'avant l'étape C (fam-*, meta-*, op03-*, st01, st21, st22, st30 à st36,
// aventure-*) : traduire son texte en recette (fichier de set s'il y en a une, sinon le traducteur), compiler, puis
// jouer le code à la main et la recette compilée dans les mêmes situations tirées au hasard (crosscheck.ts, C1.3).
// Classement : identique, différente (à expliquer : erreur du code, du traducteur, ou doute), non comparée (texte non
// traduit, recette non compilée, aucun moment que le banc sait déclencher) : celles-là passent aux parties au hasard.
// Aucune phrase de carte n'est écrite : numéros, moments, graines et états du banc seulement.
import '../../game/data/load-local.ts';
import { writeFileSync } from 'node:fs';
import { CARDS, recipeEntry } from '../../game/engine/cards/index.ts';
import { FAM_KAIDO } from '../../game/engine/cards/fam-kaido.ts';
import { FAM_KATAKURI } from '../../game/engine/cards/fam-katakuri.ts';
import { FAM_KUZAN } from '../../game/engine/cards/fam-kuzan.ts';
import { FAM_LUFFY_ACE } from '../../game/engine/cards/fam-luffy-ace.ts';
import { FAM_ROBIN_PURPLE } from '../../game/engine/cards/fam-robin-purple.ts';
import { FAM_ROBIN_YELLOW } from '../../game/engine/cards/fam-robin-yellow.ts';
import { FAM_SH_RED } from '../../game/engine/cards/fam-sh-red.ts';
import { FAM_SN_GREEN } from '../../game/engine/cards/fam-sn-green.ts';
import { FAM_WB } from '../../game/engine/cards/fam-wb.ts';
import { FAM_ZORO } from '../../game/engine/cards/fam-zoro.ts';
import { FAM_KIDD } from '../../game/engine/cards/fam-kidd.ts';
import { FAM_META } from '../../game/engine/cards/fam-meta.ts';
import { FAM_SABO } from '../../game/engine/cards/fam-sabo.ts';
import { META_ENEL } from '../../game/engine/cards/meta-enel.ts';
import { META_KAIDO } from '../../game/engine/cards/meta-kaido.ts';
import { META_MIHAWK } from '../../game/engine/cards/meta-mihawk.ts';
import { META_ROBIN } from '../../game/engine/cards/meta-robin.ts';
import { META_SABO } from '../../game/engine/cards/meta-sabo.ts';
import { META_XEBEC } from '../../game/engine/cards/meta-xebec.ts';
import { OP03_ROUGE } from '../../game/engine/cards/op03-rouge.ts';
import { OP03_NOIRE } from '../../game/engine/cards/op03-noire.ts';
import { OP03_VERTE } from '../../game/engine/cards/op03-verte.ts';
import { OP03_BLEUE } from '../../game/engine/cards/op03-bleue.ts';
import { OP03_VIOLETTE } from '../../game/engine/cards/op03-violette.ts';
import { OP03_JAUNE } from '../../game/engine/cards/op03-jaune.ts';
import { ST01 } from '../../game/engine/cards/st01.ts';
import { ST21 } from '../../game/engine/cards/st21.ts';
import { ST22 } from '../../game/engine/cards/st22.ts';
import { ST30 } from '../../game/engine/cards/st30.ts';
import { ST31 } from '../../game/engine/cards/st31.ts';
import { ST32 } from '../../game/engine/cards/st32.ts';
import { ST33 } from '../../game/engine/cards/st33.ts';
import { ST34 } from '../../game/engine/cards/st34.ts';
import { ST35 } from '../../game/engine/cards/st35.ts';
import { ST36 } from '../../game/engine/cards/st36.ts';
import { AVENTURE_A } from '../../game/engine/cards/aventure-a.ts';
import { AVENTURE_B } from '../../game/engine/cards/aventure-b.ts';
import { DECKS } from '../../game/engine/decks.ts';
import { currentBehavior, maxChooser, type Chooser } from '../../game/engine/recipes/bench.ts';
import { blocking, compare } from '../../game/engine/recipes/compare.ts';
import { compileRecipe } from '../../game/engine/recipes/compile.ts';
import { compareBehaviors } from '../../game/engine/recipes/crosscheck.ts';
import { fuzz } from '../../game/engine/recipes/fuzz.ts';
import { parseCard } from '../../game/engine/recipes/parse/index.ts';
import type { Recipe } from '../../game/engine/recipes/types.ts';
import type { CardBehavior } from '../../game/engine/types.ts';

// Fichiers de cartes d'avant l'étape C (b7eb7f3, base de cartes/etape-C), dans l'ordre de BEHAVIORS
export const LEGACY_FILES: Record<string, Record<string, CardBehavior>> = {
  'st31': ST31, 'st32': ST32, 'st33': ST33, 'st34': ST34, 'st35': ST35, 'st36': ST36, 'meta-sabo': META_SABO,
  'meta-mihawk': META_MIHAWK, 'meta-robin': META_ROBIN, 'meta-xebec': META_XEBEC, 'meta-enel': META_ENEL,
  'meta-kaido': META_KAIDO, 'st21': ST21, 'st22': ST22, 'st30': ST30, 'fam-sabo': FAM_SABO, 'fam-meta': FAM_META,
  'fam-kidd': FAM_KIDD, 'fam-kaido': FAM_KAIDO, 'fam-katakuri': FAM_KATAKURI, 'fam-kuzan': FAM_KUZAN, 'fam-wb': FAM_WB,
  'fam-sh-red': FAM_SH_RED, 'fam-zoro': FAM_ZORO, 'fam-sn-green': FAM_SN_GREEN, 'fam-robin-purple': FAM_ROBIN_PURPLE,
  'fam-robin-yellow': FAM_ROBIN_YELLOW, 'fam-luffy-ace': FAM_LUFFY_ACE, 'op03-rouge': OP03_ROUGE,
  'op03-verte': OP03_VERTE, 'op03-bleue': OP03_BLEUE, 'op03-violette': OP03_VIOLETTE, 'op03-noire': OP03_NOIRE,
  'op03-jaune': OP03_JAUNE, 'st01': ST01, 'aventure-a': AVENTURE_A, 'aventure-b': AVENTURE_B,
};

// Numéro → dernier fichier qui le définit (comme le `...` de BEHAVIORS)
export function legacyCards(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [file, cards] of Object.entries(LEGACY_FILES)) for (const num of Object.keys(cards)) out.set(num, file);
  return out;
}

export type AuditStatus = 'identique' | 'différente' | 'non traduite' | 'non compilée' | 'non comparée';
export interface AuditLine {
  num: string; file: string; decks: string[]; status: AuditStatus; source?: 'set' | 'traducteur';
  compared?: number; differ?: string[]; sameWithFixedAnswers?: boolean; gaps?: number; missing?: string[]; first?: { situation: string; a: string; b: string };
}

// Champs de l'état du banc qui diffèrent (code → recette)
export function snapshotDiff(a: string, b: string): string {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    } else out.push(`${path} ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
  };
  walk(JSON.parse(a), JSON.parse(b), '');
  return out.join(' ; ');
}

export function auditCard(num: string, file: string, situations: number): AuditLine {
  const decks = Object.entries(DECKS).filter(([, d]) => d.leader === num || d.cards[num]).map(([id]) => id);
  const line: AuditLine = { num, file, decks, status: 'non traduite' };
  const d = CARDS[num];
  let recipe: Recipe | undefined = recipeEntry(num)?.recipe;
  if (recipe) line.source = 'set';
  else {
    const p = parseCard({ num, effectEn: d.effectEn ?? '', triggerEn: d.triggerEn });
    if (p.ok) { recipe = p.recipe; line.source = 'traducteur'; }
  }
  if (!recipe) return line;
  line.gaps = blocking(compare(num, recipe)).length;
  const c = compileRecipe(recipe);
  if (!c.ok) { line.status = 'non compilée'; line.missing = c.missing; return line; }
  const res = compareBehaviors(num, currentBehavior(num), c.behavior, { situations });
  line.compared = res.compared;
  if (!res.compared) { line.status = 'non comparée'; return line; }
  line.status = res.differ.length ? 'différente' : 'identique';
  if (res.differ.length) {
    line.differ = res.differ; line.first = res.first;
    // Mêmes règles, réponses de l'IA différentes ? Rejoué avec des réponses fixes (tout accepter, puis tout refuser)
    // (« combien de DON!! » : le maximum, puis aucune ; n° 1994)
    const refuse = maxChooser({ refuse: true, none: true });
    const noDon: Chooser = (s, d) => (d.player === 0 && d.tag === 'donUpTo' ? 'none' : refuse(s, d));
    line.sameWithFixedAnswers = [maxChooser(), refuse, noDon]
      .every((chooser) => compareBehaviors(num, currentBehavior(num), c.behavior, { situations, chooser }).differ.length === 0);
  }
  return line;
}

if (/cards-audit\.ts$/.test(process.argv[1] ?? '')) {   // lancé comme script (importable par les tests)
  const args = process.argv.slice(2);
  const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const situations = Number(value('--situations') ?? 20);
  if (args.includes('--hasard')) {
    // les cartes que la comparaison ne couvre pas, par lots de 4 de la même couleur (decks légaux), IA contre IA
    const per = Number(args[args.indexOf('--hasard') + 1]) || 6;
    const rest = [...legacyCards()].filter(([num, file]) => CARDS[num] && CARDS[num].category !== 'LEADER' && auditCard(num, file, 4).status !== 'identique'
      && auditCard(num, file, 4).status !== 'différente').map(([num]) => num);
    const byColor = new Map<string, string[]>();
    for (const n of rest) { const k = [...CARDS[n].colors].sort().join('/'); byColor.set(k, [...(byColor.get(k) ?? []), n]); }
    const stats = new Map<string, { games: number; triggered: number; errors: number }>();
    const failures: string[] = [];
    let games = 0;
    for (const list of byColor.values()) {
      for (let i = 0; i < list.length; i += 4) {
        const force = list.slice(i, i + 4);
        const rep = fuzz({ games: per, force, seed: 4100 + games, random: games % 2 === 1 });
        games += rep.games;
        for (const n of force) {
          const c = rep.cards[n] ?? { games: 0, triggered: 0, errors: 0 };
          const st = stats.get(n) ?? { games: 0, triggered: 0, errors: 0 };
          stats.set(n, { games: st.games + c.games, triggered: st.triggered + c.triggered, errors: st.errors + c.errors });
        }
        for (const f of rep.failures) failures.push(`${f.decks.join(' contre ')} : ${f.message} [${f.suspects.join(', ')}]`);
      }
    }
    const never = [...stats].filter(([, c]) => !c.games).map(([n]) => n);
    const silent = [...stats].filter(([, c]) => c.games && !c.triggered).map(([n]) => n);
    const bad = [...stats].filter(([, c]) => c.errors).map(([n, c]) => `${n} (${c.errors})`);
    console.log(`${rest.length} cartes non comparées (hors Leaders), ${games} parties : ${failures.length} problème(s)`);
    for (const f of failures) console.log(`- ${f}`);
    console.log(`jamais en jeu : ${never.join(' ') || 'aucune'}`);
    console.log(`jouées sans effet déclenché (effets permanents, conditions...) : ${silent.length}`);
    console.log(`soupçonnées : ${bad.join(' ') || 'aucune'}`);
    const json = value('--json');
    if (json) writeFileSync(json, `${JSON.stringify(Object.fromEntries(stats), null, 1)}
`);
    process.exit(failures.length ? 1 : 0);
  }
  const only = value('--cartes')?.split(',');
  const t0 = Date.now();
  const legacy = legacyCards();
  const lines: AuditLine[] = [];
  for (const [num, file] of [...legacy].sort(([a], [b]) => a.localeCompare(b))) {
    if (only && !only.includes(num)) continue;
    if (!CARDS[num]) continue;
    const l = auditCard(num, file, situations);
    lines.push(l);
    if (l.status === 'différente') {
      console.log(`- ${num} (${file}${l.decks.length ? `, ${l.decks.join(' ')}` : ''}) : ${l.differ!.length}/${l.compared} différentes, recette ${l.source}${l.sameWithFixedAnswers ? ', identiques à réponses fixes' : ''}${l.gaps ? `, ${l.gaps} écart(s) d'aller-retour` : ''}`);
      if (args.includes('--detail') && l.first) console.log(`  ${l.first.situation} : ${snapshotDiff(l.first.a, l.first.b)}`);
    }
  }
  const count = (s: AuditStatus) => lines.filter((l) => l.status === s).length;
  console.log(`${legacy.size} cartes codées avant l'étape C, ${lines.length} auditées en ${Math.round((Date.now() - t0) / 1000)} s : `
    + `${count('identique')} identiques, ${count('différente')} différentes, ${count('non comparée')} non comparées (aucun moment déclenché), `
    + `${count('non compilée')} non compilées, ${count('non traduite')} non traduites`);
  const json = value('--json');
  if (json) writeFileSync(json, `${JSON.stringify(lines, null, 1)}\n`);
}
