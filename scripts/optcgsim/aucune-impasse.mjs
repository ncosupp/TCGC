#!/usr/bin/env node
// Test « aucune impasse », version longue (tâche O5.5, audit O5.0 § 5.3) : parties au hasard (graines fixes) contre le
// faux hôte fidèle, avec des attentes injectées de chaque type (sauf M2 et T3, laissés à O5.6). Voir
// game/tests/optcgsim/aucune-impasse-parties.ts pour le tirage et le verdict ; le sous-ensemble court est dans
// game/tests/optcgsim/aucune-impasse.test.ts (compris dans `npm test`).
//
//   node --no-warnings --import ./game/data/load-local.ts scripts/optcgsim/aucune-impasse.mjs [nombre=500] [--depuis <graine>=1] [--parallele <k>=4] [--ms <ms par seconde simulée>=10] [--graine <g>]... [--type <attente>]... [--detail] [--impasse <s>=30]
//
// Affiche chaque partie qui échoue (impasse : les deux camps s'attendent plus de 30 s simulées ; désaccord sur qui
// agit) ou qui n'a tenu que grâce au filet anti-impasse (traitement manquant), puis le bilan par type d'attente.
// Code de sortie 1 s'il y a au moins une impasse ou un désaccord.
import { decrire, echec, jouerGraines, parFilet } from '../../game/tests/optcgsim/aucune-impasse-parties.ts';

const args = process.argv.slice(2);
const opt = (nom, def) => { const i = args.indexOf(nom); return i >= 0 ? Number(args[i + 1]) : def; };
const graines = [];
const types = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--graine') graines.push(Number(args[i + 1]));
  if (args[i] === '--type') types.push(args[i + 1]);
}
const detail = args.includes('--detail');
const nombre = Number(args.find((a, i) => /^\d+$/.test(a) && (i === 0 || !args[i - 1].startsWith('--'))) ?? 500);
const depuis = opt('--depuis', 1);
if (!graines.length) for (let g = depuis; g < depuis + nombre; g++) graines.push(g);

const debut = Date.now();
let n = 0;
const res = await jouerGraines(graines, {
  parallele: opt('--parallele', 4), msParSeconde: opt('--ms', 10), garde: 30_000, impasse: opt('--impasse', 30), ...(types.length ? { types } : {}),
  chaque: (x) => {
    n++;
    if (echec(x) || parFilet(x)) console.log(decrire(x));
    if (parFilet(x)) for (const l of x.unstuckLog.slice(0, 4)) console.log(`    filet : ${l}`);
    if (detail) {
      console.log(`  attentes jouées : ${x.jouees.join(', ')} ; libérées : ${x.liberees.join(', ')}`);
      console.log(`  joy-boy envoie : ${x.noms.filter((r) => !/LoadDeckCard|SetTimer/.test(r)).join(' ')}`);
      for (const l of x.texte.split('\n')) console.log(`  | ${l}`);
    }
    if (n % 50 === 0) console.error(`… ${n}/${graines.length} parties (${Math.round((Date.now() - debut) / 1000)} s)`);
  },
});

const echecs = res.filter(echec), filet = res.filter(parFilet);
const parType = new Map();
for (const x of res) for (const t of x.types) {
  const e = parType.get(t) ?? { parties: 0, echecs: 0, filet: 0 };
  e.parties++; if (echec(x)) e.echecs++; if (parFilet(x)) e.filet++;
  parType.set(t, e);
}
const fins = {};
for (const x of res) fins[x.fin.kind] = (fins[x.fin.kind] ?? 0) + 1;
console.log('');
console.log(`${res.length} parties en ${Math.round((Date.now() - debut) / 1000)} s : ${echecs.length} en échec (impasse ou désaccord), ${filet.length} sauvées par le filet, ${res.length - echecs.length - filet.length} saines`);
console.log(`fins : ${Object.entries(fins).map(([k, v]) => `${k} ${v}`).join(', ')} ; plus long silence de joy-boy attendu : ${Math.max(...res.map((x) => x.silenceMax))} s simulées ; RPC reçues au plus : ${Math.max(...res.map((x) => x.recues))}`);
console.log('par type d’attente (parties / échecs / sauvées par le filet) :');
for (const [t, e] of [...parType].sort()) console.log(`  ${t.padEnd(8)} ${String(e.parties).padStart(4)} ${String(e.echecs).padStart(4)} ${String(e.filet).padStart(4)}`);
if (echecs.length) console.log(`graines en échec : ${echecs.map((x) => x.graine).join(' ')}`);
if (filet.length) console.log(`graines sauvées par le filet : ${filet.map((x) => x.graine).join(' ')}`);
process.exit(echecs.length ? 1 : 0);
