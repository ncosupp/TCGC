#!/usr/bin/env node
// Classe les RPC du catalogue d'OPTCGSim (catalog.json) comme l'inventaire (a) de l'audit O5.0 (§ 2, tâche O5.2) :
// chaque nom (sans suffixe), son sens, sa famille dans le miroir, les modules qui le citent, et sa classe (miroir,
// combat, réactions, session, sans effet, sans effet mais l'hôte attend une réponse, effet perdu, inconnue du miroir).
//
//   node --no-warnings scripts/optcgsim/classer-catalogue.mjs [--md] [--attentes]
//
// --md : tableau Markdown (sinon une ligne par nom, séparée par des tabulations) ; --attentes : seulement les RPC dont
// l'hôte attend une réponse (celles que le filet d'O5.1 doit traiter). Lit seulement le dépôt, aucun accès réseau.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPT = path.join(RACINE, 'game', 'online', 'optcgsim');
const catalogue = JSON.parse(fs.readFileSync(path.join(OPT, 'catalog.json'), 'utf8'));
const { knownRpcs } = await import(pathToFileURL(path.join(OPT, 'mirror.ts')).href);
const familles = knownRpcs();
const MODULES = ['inbound', 'outbound', 'combat', 'reaction', 'session'];
const textes = Object.fromEntries(MODULES.map((m) => [m, fs.readFileSync(path.join(OPT, `${m}.ts`), 'utf8')]));

// Classes fixées par l'audit (§ 2 et § 3) : ce que fait le jeu quand il envoie ces RPC.
const ATTENTE = new Set(['TriggerOpponentActionFromDeploy', 'TriggerOpponentActionFromDeployWithTarget', 'TriggerOpponentActionFromLeader',
  'TriggerOpponentActionFromLeaderWithSaveTarget', 'TriggerOpponentActionFromTrash', 'ForceOpponentActionFromDeploy',
  'ForceOpponentActionFromOppositeDeploy', 'ForceOpponentActionFromTrash', 'TriggerOpponentMultiActions', 'RequestCancelMatch', 'RequestRestartTurn']);
const PERDU = new Set(['ForceMainPhaseAction', 'QueueCurrentPlayerKOQueue', 'QueueCurrentPlayerSaveQueue', 'CheckForKOdCharacterEffects',
  'StartOnKOActions', 'SetOpponentLostLifeFlag']);
const REACTIONS = new Set(['ProcOpponentV3Action', 'QueueOpponentPlayerKOQueue', 'QueueOpponentPlayerSaveQueue']);
const SESSION = new Set(['SetTimer', 'GameStart', 'TranslateLogLine', 'AddLogLine', 'AddChatLine', 'SetMyTurnRoll', 'ChooseTurnOrder', 'Concede', 'VersionCheck']);
const COMBAT = /COMBAT_RPCS: ReadonlySet<string> = new Set\(\[([^\]]*)\]/s.exec(textes.combat)?.[1].match(/'([A-Za-z]+)'/g)?.map((x) => x.slice(1, -1)) ?? [];

const noms = new Map();
for (const e of Object.values(catalogue)) {
  const base = e.nom.replace(/(Server|Client)Rpc$/, '');
  const x = noms.get(base) ?? { base, sens: new Set() };
  x.sens.add(e.sens === 'hote->clients' ? 'C' : 'S');
  noms.set(base, x);
}
const lignes = [...noms.values()].sort((a, b) => a.base.localeCompare(b.base)).map((x) => {
  const famille = familles[x.base] ?? '';
  const cites = MODULES.filter((m) => new RegExp(`'${x.base}(?:ServerRpc|ClientRpc)?'`).test(textes[m]));
  const classe = ATTENTE.has(x.base) ? 'sans effet, l’hôte attend une réponse'
    : PERDU.has(x.base) ? 'sans effet, effet perdu'
      : COMBAT.includes(x.base) ? 'combat'
        : REACTIONS.has(x.base) ? 'réactions'
          : SESSION.has(x.base) ? 'session'
            : !famille ? 'inconnue du miroir'
              : famille === 'sans effet' ? 'sans effet' : 'miroir';
  return { ...x, sens: [...x.sens].sort().join('+'), famille, cites, classe };
});
const choisies = process.argv.includes('--attentes') ? lignes.filter((l) => l.classe.includes('attend')) : lignes;
if (process.argv.includes('--md')) {
  console.log('| RPC | sens | famille du miroir | modules | classe |\n|---|---|---|---|---|');
  for (const l of choisies) console.log(`| ${l.base} | ${l.sens} | ${l.famille} | ${l.cites.join(', ')} | ${l.classe} |`);
} else for (const l of choisies) console.log([l.base, l.sens, l.famille, l.cites.join(','), l.classe].join('\t'));
const parClasse = {};
for (const l of lignes) parClasse[l.classe] = (parClasse[l.classe] ?? 0) + 1;
console.error(`${Object.keys(catalogue).length} RPC, ${lignes.length} noms : ${Object.entries(parClasse).map(([k, n]) => `${k} ${n}`).join(' ; ')}`);
