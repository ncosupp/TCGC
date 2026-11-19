#!/usr/bin/env node
// Outil de listage des salles publiques d'OPTCGSim (tâche O4.1) : lit la liste du service Lobby de Unity, comme l'écran
// des salles publiques du jeu, et affiche ce qu'il faut pour régler le repli de « Trouver un adversaire » (étude
// Plan-aventure/etudes/crossplay-partie-rapide.md, points « à mesurer »).
//
//   node --no-warnings scripts/optcgsim/lister-salles.mjs                  une lecture
//   node --no-warnings scripts/optcgsim/lister-salles.mjs --suivre 120     une lecture toutes les 5 s pendant 120 s
//   node --no-warnings scripts/optcgsim/lister-salles.mjs --json <fichier> fiches anonymisées (hors du dépôt)
//
// Affiché, SANS pseudo, nom de salle ni code : nombre de fiches par version et par format, puis pour la version gelée
// (handshake.json) : format, minuteur, Leader, âge, dernière mise à jour, et avec --suivre la durée de vie observée et
// si `lastUpdated` suit le signal de vie de l'hôte (toutes les 15 s).
//
// PARLE AUX SERVEURS UNITY (une identification anonyme, puis une lecture toutes les 5 s au plus) : c'est l'utilisateur
// qui le lance. Ne rejoint aucune salle, n'écrit rien chez Unity. Les tests injectent un faux fetch (salles.test.ts).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_DATA, FROZEN_VERSION, LobbyError, network, queryLobbies, readRoom } from '../../game/online/optcgsim/lobbies.ts';
import { authenticate } from '../../game/online/optcgsim/transport.ts';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..', '..');
export const INTERVALLE = 5000;

const duree = (ms) => {
  if (!Number.isFinite(ms)) return '?';
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};
const t = (iso) => { const v = Date.parse(iso ?? ''); return Number.isFinite(v) ? v : NaN; };
const val = (l, k) => (typeof l.data?.[k]?.value === 'string' ? l.data[k].value : undefined);

/**
 * Suivi des fiches d'une lecture à l'autre. Chaque fiche reçoit un numéro (« salle 1 »…) : ni identifiant Unity, ni
 * nom, ni code ne sortent d'ici.
 */
export function creerSuivi() {
  const fiches = new Map(); // id -> { n, premiere, derniere, created, maj: Set<lastUpdated>, disparue }
  let n = 0, lectures = 0;
  return {
    lire(raw, maintenant) {
      lectures++;
      const vues = new Set();
      for (const l of raw) {
        if (!l?.id) continue;
        vues.add(l.id);
        let f = fiches.get(l.id);
        if (!f) { f = { n: ++n, premiere: maintenant, created: l.created, maj: new Set(), disparue: null }; fiches.set(l.id, f); }
        f.derniere = maintenant; f.disparue = null;
        if (l.lastUpdated) f.maj.add(l.lastUpdated);
      }
      for (const [id, f] of fiches) if (!vues.has(id) && f.disparue === null) f.disparue = maintenant;
    },
    numero: (id) => fiches.get(id)?.n ?? 0,
    get lectures() { return lectures; },
    /** Fiches disparues pendant le suivi : durée de vie observée (de la création à la dernière lecture qui l'a vue). */
    disparues() {
      return [...fiches.values()].filter((f) => f.disparue !== null)
        .map((f) => ({ n: f.n, vie: f.derniere - t(f.created), vueDepuis: f.derniere - f.premiere }));
    },
    /** Pour chaque fiche vue au moins deux fois : `lastUpdated` a-t-il changé (signal de vie) ? */
    majs() { return [...fiches.values()].filter((f) => f.derniere > f.premiere).map((f) => ({ n: f.n, valeurs: f.maj.size })); },
  };
}

/** Comptes par version (fiches plus récentes que la version gelée comprises) et par format, pour toutes les fiches. */
export function compter(raw) {
  const versions = {}, formats = {};
  let plusRecentes = 0;
  for (const l of raw) {
    const v = val(l, 'Version') ?? '(sans version)', m = val(l, 'Mode') ?? '(sans format)';
    versions[v] = (versions[v] ?? 0) + 1;
    if (v === FROZEN_VERSION) formats[m] = (formats[m] ?? 0) + 1;
    if (val(l, 'Version') && v > FROZEN_VERSION) plusRecentes++; // comparaison ordinale, comme le jeu
  }
  return { total: raw.length, versions, formats, plusRecentes };
}

/** Lignes du rapport d'une lecture (aucun pseudo, nom de salle ni code). */
export function rapport(raw, maintenant, suivi) {
  const c = compter(raw), lignes = [];
  lignes.push(`${new Date(maintenant).toLocaleTimeString('fr-FR')} : ${c.total} fiche(s) publique(s) avec une place libre`);
  lignes.push(`  par version : ${Object.entries(c.versions).sort().map(([v, k]) => `${v} ${k}`).join(', ') || 'aucune'}`);
  if (c.plusRecentes) lignes.push(`  ATTENTION : ${c.plusRecentes} fiche(s) d'une version plus récente que ${FROZEN_VERSION} (OPTCGSim mis à jour ? Décision 5)`);
  lignes.push(`  ${FROZEN_VERSION} par format : ${Object.entries(c.formats).sort().map(([m, k]) => `${m} ${k}`).join(', ') || 'aucune'}`);
  const gelees = raw.filter((l) => val(l, 'Version') === FROZEN_VERSION)
    .sort((a, b) => (val(a, 'Mode') ?? '').localeCompare(val(b, 'Mode') ?? '') || t(a.created) - t(b.created));
  for (const l of gelees) {
    const { room, reason } = readRoom(l);
    const mode = val(l, 'Mode') ?? '?';
    const minuteur = (val(l, 'IsTimerLobby') ?? '').toLowerCase() === 'true';
    const cardData = val(l, 'CardData');
    const jouable = room && room.style === 'Western' && !minuteur && cardData === CARD_DATA;
    const etat = !room ? `écartée (${reason})` : cardData !== CARD_DATA ? `écartée (CardData ${cardData})` : jouable ? 'visée par joy-boy' : 'hors décision (format ou minuteur)';
    lignes.push(`    salle ${suivi.numero(l.id)} : ${mode}${minuteur ? ', minuteur' : ''}, Leader ${val(l, 'leader') || '—'}, `
      + `âge ${duree(maintenant - t(l.created))}, mise à jour il y a ${duree(maintenant - t(l.lastUpdated))} — ${etat}`);
  }
  return lignes;
}

/**
 * Données de fiche gardées par --json : celles qu'écrit HostJoinScript.MakeALobby en 1.45b, sauf `JoinCode`. Liste
 * fermée : une donnée ajoutée par une version future (texte libre, pseudo…) ne sort pas.
 */
export const DONNEES_GARDEES = ['Version', 'Mode', 'CardData', 'IsTimerLobby', 'leader'];

/** Fiches anonymisées pour --json : données de jeu seulement (ni nom, ni hôte, ni joueurs, ni code, ni identifiant). */
export function anonymiser(raw, suivi) {
  return raw.map((l) => ({
    salle: suivi.numero(l.id), maxPlayers: l.maxPlayers, availableSlots: l.availableSlots, isPrivate: l.isPrivate,
    isLocked: l.isLocked, hasPassword: l.hasPassword, created: l.created, lastUpdated: l.lastUpdated,
    data: Object.fromEntries(Object.entries(l.data ?? {}).filter(([k]) => DONNEES_GARDEES.includes(k))
      .map(([k, v]) => [k, { value: v?.value, visibility: v?.visibility, index: v?.index }])),
    codePresent: Boolean(val(l, 'JoinCode')),
  }));
}

/**
 * Le listage, réseau et horloge injectables : `fetch`, `maintenant()`, `attendre(ms)`, `ecrire(ligne)`. Une seule
 * identité anonyme pour tout le suivi (nouvelle seulement sur 401) ; sur 429, une pause de 60 s.
 * Rend { lectures, fiches: dernière liste brute, suivi, erreurs }.
 */
export async function lister(o) {
  const ecrire = o.ecrire ?? ((l) => console.log(l));
  const maintenant = o.maintenant ?? Date.now;
  const attendre = o.attendre ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const suivi = creerSuivi();
  const fin = maintenant() + (o.secondes ?? 0) * 1000;
  let jeton = null, derniere = [], erreurs = 0;
  const lire = async () => {
    const f = network(o.fetch);
    if (!jeton) jeton = (await authenticate(f)).idToken;
    try { return await queryLobbies({ fetch: f, token: jeton, count: 100, version: null, style: null }); }
    catch (e) {
      if (e instanceof LobbyError && e.status === 401) { jeton = (await authenticate(f)).idToken; return queryLobbies({ fetch: f, token: jeton, count: 100, version: null, style: null }); }
      throw e;
    }
  };
  for (;;) {
    let pause = INTERVALLE;
    try {
      derniere = await lire();
      const m = maintenant();
      suivi.lire(derniere, m);
      for (const l of rapport(derniere, m, suivi)) ecrire(l);
    } catch (e) {
      erreurs++;
      if (e instanceof LobbyError && e.status === 429) { pause = 60000; ecrire('Trop de requêtes (429) : pause de 60 s.'); }
      else ecrire(`Lecture impossible : ${e.message}`);
      if (!o.secondes) break;
    }
    if (maintenant() + pause > fin) break;
    await attendre(pause);
  }
  if (o.secondes) {
    const disp = suivi.disparues(), majs = suivi.majs();
    ecrire(`Bilan du suivi (${suivi.lectures} lecture(s)) :`);
    ecrire(disp.length ? `  fiches disparues : ${disp.map((d) => `salle ${d.n} (vie ${duree(d.vie)}, vue ${duree(d.vueDepuis)})`).join(', ')}` : '  aucune fiche disparue pendant le suivi');
    if (majs.length) {
      const suit = majs.filter((x) => x.valeurs > 1).length;
      ecrire(`  lastUpdated a changé pour ${suit} fiche(s) sur ${majs.length} vues plusieurs fois`
        + (suit ? ' : il suit le signal de vie' : ' : il ne suit pas le signal de vie (ou suivi trop court)'));
    }
  }
  return { lectures: suivi.lectures, fiches: derniere, suivi, erreurs };
}

function usage() {
  console.error('Usage : node --no-warnings scripts/optcgsim/lister-salles.mjs [--suivre <secondes>] [--json <fichier hors du dépôt>]');
  process.exit(2);
}
async function main() {
  const args = process.argv.slice(2);
  const o = { secondes: 0, json: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], v = () => args[++i] ?? usage();
    if (a === '--suivre') { o.secondes = Number(v()); if (!(o.secondes > 0)) usage(); }
    else if (a === '--json') o.json = path.resolve(v());
    else usage();
  }
  if (o.json && o.json.toLowerCase().startsWith(RACINE.toLowerCase())) {
    console.error('Les fiches viennent de joueurs inconnus : écris le fichier hors du dépôt.'); process.exit(2);
  }
  console.log(`Salles publiques d'OPTCGSim (version gelée ${FROZEN_VERSION}) — lecture seule, aucune salle rejointe.`);
  const r = await lister({ ...o, fetch: globalThis.fetch });
  if (o.json) {
    fs.mkdirSync(path.dirname(o.json), { recursive: true });
    fs.writeFileSync(o.json, JSON.stringify({ lecture: new Date().toISOString(), version: FROZEN_VERSION, fiches: anonymiser(r.fiches, r.suivi) }, null, 1));
    console.log(`Fiches anonymisées : ${o.json}`);
  }
  process.exit(r.erreurs && !r.lectures ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
