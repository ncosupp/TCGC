// Parties au hasard contre le faux hôte fidèle (tâche O5.5, audit O5.0 § 5.3) : partagé par le test « aucune impasse »
// (aucune-impasse.test.ts, sous-ensemble court dans `npm test`) et par sa version longue
// (scripts/optcgsim/aucune-impasse.mjs).
//
// Une graine fixe tire : le deck de joy-boy, celui de l'hôte (et la carte dont l'hôte « joue » les actions imposées),
// la salle (avec ou sans minuteur), les préférences du joueur joy-boy automatique (poser, attaquer, bloquer, contrer,
// déclencher) et 1 à 3 attentes injectées parmi celles de faux-hote-attentes.ts déjà traitées par la session ou
// couvertes par le filet anti-impasse (attente.ts), dont, depuis O5.6, M2 (égalité au tirage, option `egalite` du faux
// hôte), T3 (effet de l'hôte pendant la fin du tour de joy-boy, `effetFinTour`) et R9 (file « joueur courant » hors
// combat, `fileJoueurCourant`).
//
// Verdict d'une partie :
// - **impasse** : le faux hôte a attendu joy-boy plus de 30 s simulées sans décision montrée au joueur joy-boy (les deux
//   camps s'attendent ; le faux hôte quitte alors la partie), ou la garde du test a dû l'arrêter ;
// - **désaccord** : l'hôte et joy-boy ne sont pas d'accord sur qui agit (iPlayerAction du faux hôte) ;
// - **sauvée par le filet** : partie saine, mais le filet anti-impasse a dû débloquer (`stats().unstuck > 0`) ou conclure
//   (fin `desync`) : elle signale un traitement manquant (à lister, pas un échec tant qu'O5.4 n'est pas fusionnée).
import { DECKS } from '../../engine/decks.ts';
import type { SessionEnd, SessionOptions } from '../../online/optcgsim/session.ts';
import {
  actionImposee, ancienneAction, ANCIENNES_ENVOYEES, annulation, attaqueHote, attaqueIgnoree, attaqueRetenue, BLOQUEURS, DECLENCHEURS,
  effetFinTour, fileJoueurCourant, hoteMuet, listeReactions, offreDeclenchement, partie, rembobinage, remplacementSoi, type Preferences,
} from './faux-hote-attentes.ts';
import type { Injection, OptionsHote } from './faux-hote.ts';

// ---------------------------------------------------------------------------------------------------- hasard

/** Générateur pseudo-aléatoire à graine (mulberry32) : mêmes parties à chaque lancement. */
export function hasard(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const entier = (r: () => number, n: number) => Math.floor(r() * n);
const un = <T>(r: () => number, l: readonly T[]): T => l[entier(r, l.length)];
const pile = (r: () => number, p = 0.5) => r() < p;

// ---------------------------------------------------------------------------------------------------- decks

type Deck = { leader: string; cards: string[] };
const deckDe = (id: string): Deck => ({ leader: DECKS[id].leader, cards: Object.entries(DECKS[id].cards).flatMap(([c, n]) => Array<string>(n).fill(c)) });

/** Decks de joy-boy : decks de démarrage de l'éditeur et les deux decks spécialisés des scénarios d'attente. */
export const DECKS_JOYBOY: Record<string, () => Deck> = {
  'ST-01': () => deckDe('ST-01'), 'ST-02': () => deckDe('ST-02'), 'ST-03': () => deckDe('ST-03'), 'ST-04': () => deckDe('ST-04'),
  'ST-07': () => deckDe('ST-07'), 'bloqueurs': BLOQUEURS, 'déclencheurs': DECLENCHEURS,
};
/** Decks de l'hôte (OPTCGSim) : il ne joue que pioche, DON!!, Sanji s'il l'a, et les attentes injectées. */
export const DECKS_HOTE = ['ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-07'] as const;
/** Cartes de l'hôte dont les actions imposées sont jouées par joy-boy (genres : défausse, main, dessous du deck, inconnu, DON!!). */
export const ACTEURS = ['OP05-082', 'OP06-051', 'P-055', 'OP06-044', 'OP02-085'] as const;

// ---------------------------------------------------------------------------------------------------- attentes

interface Besoins { prefs?: Preferences; sansMinuteur?: boolean; session?: Partial<SessionOptions>; joyboy?: string; hote?: OptionsHote }
interface Type { nom: string; poids: number; faire: (r: () => number) => { injections: Injection[]; besoins?: Besoins } }

/**
 * Types d'attente tirés au hasard (faux-hote-attentes.ts). `poids` : fréquence relative.
 * Les ids sont uniques dans une partie (le faux hôte compte les injections par id).
 */
export const TYPES: Type[] = [
  { nom: 'CD1', poids: 4, faire: (r) => { const t = 2 + entier(r, 2); return { injections: [attaqueHote(`CD1@${t}`, { tour: t })] }; } },
  { nom: 'CD2', poids: 2, faire: () => ({ injections: attaqueRetenue('CD2', { tour: 3 }), besoins: { prefs: { pauseDeclenchement: 100 }, joyboy: 'déclencheurs' } }) },
  { nom: 'CD2 bis', poids: 1, faire: () => ({ injections: [attaqueIgnoree('CD2 bis')] }) },
  { nom: 'R5', poids: 2, faire: () => ({ injections: [offreDeclenchement('R5', 'tourHote')] }) },
  { nom: 'CA5', poids: 1, faire: () => ({ injections: [offreDeclenchement('CA5', 'poseJoyboy')], besoins: { prefs: { pauseFin: 300 } } }) },
  { nom: 'R4', poids: 3, faire: (r) => { const t = 2 + entier(r, 2); return { injections: [actionImposee('R4', 'tourHote', (h) => h.toursHote() >= t)] }; } },
  { nom: 'CA4', poids: 1, faire: () => ({ injections: [actionImposee('CA4', 'poseJoyboy')], besoins: { prefs: { pauseFin: 300 } } }) },
  { nom: 'R4c', poids: 1, faire: () => ({ injections: [actionImposee('R4c', 'contresHote')], besoins: { prefs: { attaquer: true } } }) },
  { nom: 'R2', poids: 1, faire: () => ({ injections: [remplacementSoi('R2')] }) },
  { nom: 'R6', poids: 1, faire: () => ({ injections: [listeReactions('R6', { avecHote: false })] }) },
  { nom: 'R6h', poids: 1, faire: () => ({ injections: [listeReactions('R6h', { avecHote: true })] }) },
  { nom: 'R7', poids: 2, faire: (r) => { const n = un(r, ANCIENNES_ENVOYEES); return { injections: [ancienneAction(n, `R7 ${n}`)] }; } },
  { nom: 'T5', poids: 1, faire: () => ({ injections: [rembobinage('T5')] }) },
  { nom: 'T6', poids: 0.5, faire: () => ({ injections: [annulation('T6')] }) },
  // hôte muet : seulement dans une salle sans minuteur (décision 11 : victoire de joy-boy après 5 min de jeu, à l'échelle)
  { nom: 'muet', poids: 0.5, faire: () => ({ injections: [hoteMuet('muet')], besoins: { sansMinuteur: true } }) },
  // O5.6 : égalité au tirage (aucune injection : option du faux hôte), effet de l'hôte en fin de tour de joy-boy, file
  // « joueur courant » hors combat pendant le tour de joy-boy
  { nom: 'M2', poids: 1, faire: () => ({ injections: [], besoins: { hote: { egalite: true } } }) },
  { nom: 'T3', poids: 2, faire: () => ({ injections: [effetFinTour('T3')] }) },
  { nom: 'R9', poids: 1, faire: () => ({ injections: [fileJoueurCourant('R9')], besoins: { prefs: { pauseFin: 300 } } }) },
];

// ---------------------------------------------------------------------------------------------------- une partie tirée

export interface Tirage {
  graine: number;
  joyboy: string;
  hote: string;
  acteur: string;
  minuteur: boolean;
  types: string[];
  prefs: Preferences;
}

/** Ce que tire une graine (sans jouer). `types` : n'injecter que ces types d'attente (tous, dans cet ordre). */
export function tirer(graine: number, types?: string[]): Tirage & { injections: Injection[]; session: Partial<SessionOptions>; optionsHote: OptionsHote } {
  const r = hasard(graine);
  const n = 1 + entier(r, 3);
  const total = TYPES.reduce((s, t) => s + t.poids, 0);
  const choisis: Type[] = types ? types.map((x) => { const t = TYPES.find((y) => y.nom === x); if (!t) throw new Error(`type d’attente inconnu : ${x}`); return t; }) : [];
  for (let k = 0; !types && k < 12 && choisis.length < n; k++) {
    let x = r() * total;
    const t = TYPES.find((y) => (x -= y.poids) < 0) ?? TYPES[0];
    if (!choisis.includes(t)) choisis.push(t);
  }
  const faits = choisis.map((t) => t.faire(r));
  const besoins = faits.map((f) => f.besoins ?? {});
  let joyboy = un(r, Object.keys(DECKS_JOYBOY));
  const impose = besoins.find((b) => b.joyboy)?.joyboy;
  if (impose) joyboy = impose;
  const hote = un(r, DECKS_HOTE), acteur = un(r, ACTEURS);
  const minuteur = besoins.some((b) => b.sansMinuteur) ? false : pile(r, 0.85);
  const prefs: Preferences = {
    poser: pile(r, 0.85), attaquer: pile(r, 0.5), bloquer: pile(r, 0.5), contrer: pile(r, 0.5), declencher: pile(r, 0.5),
    ...Object.assign({}, ...besoins.map((b) => b.prefs ?? {})),
  };
  if (prefs.pauseDeclenchement) { prefs.bloquer = false; prefs.contrer = false; }
  const session: Partial<SessionOptions> = Object.assign({}, ...besoins.map((b) => b.session ?? {}));
  const optionsHote: OptionsHote = Object.assign({}, ...besoins.map((b) => b.hote ?? {}));
  return { graine, joyboy, hote, acteur, minuteur, types: choisis.map((t) => t.nom), prefs, injections: faits.flatMap((f) => f.injections), session, optionsHote };
}

export interface Resultat extends Tirage {
  fin: SessionEnd;
  /** Les deux camps se sont attendus (impasse relevée par le faux hôte) ou la garde a arrêté la partie. */
  impasses: string[];
  desaccords: string[];
  garde: boolean;
  /** Déblocages du filet (attente.ts) et leur journal. */
  unstuck: number;
  unstuckLog: string[];
  /** Attentes jouées / dont l'hôte a été libéré. */
  jouees: string[];
  liberees: string[];
  /** RPC reçues par joy-boy (SetTimer compris) et plus long silence de joy-boy pendant que l'hôte l'attendait (s simulées). */
  recues: number;
  silenceMax: number;
  /** Journal de la session et RPC envoyées par joy-boy (noms), pour le détail d'une graine. */
  texte: string;
  noms: string[];
}

/** La partie a-t-elle échoué (impasse ou désaccord) ? Sauvée par le filet : saine, mais avec déblocage ou conclusion. */
/** N de l'audit (§ 5.3) : les deux camps ne s'attendent jamais plus de 30 s simulées. */
export const IMPASSE = 30;

export const echec = (x: Resultat) => x.impasses.length > 0 || x.desaccords.length > 0 || x.garde;
export const parFilet = (x: Resultat) => !echec(x) && (x.unstuck > 0 || x.fin.kind === 'desync');

/**
 * Joue la partie d'une graine. `msParSeconde` : durée réelle d'une seconde simulée. En salle à minuteur, le filet de la
 * session suit la pendule simulée du faux hôte ; sans minuteur, il suit l'horloge murale : ses seuils (et sa période de
 * contrôle) sont alors ramenés à la même échelle (une seconde de jeu = `msParSeconde` ms).
 */
export async function jouerGraine(graine: number, { msParSeconde = 3, garde = 20_000, types, impasse = IMPASSE }: { msParSeconde?: number; garde?: number; types?: string[]; impasse?: number } = {}): Promise<Resultat> {
  const t = tirer(graine, types);
  const echelle = t.minuteur ? {} : {
    tickMs: msParSeconde,
    attente: { stuckMs: 8 * msParSeconde, settleMs: 4 * msParSeconde, silenceMs: 20 * msParSeconde, concludeMs: 120 * msParSeconde, hostIdleMs: 300 * msParSeconde },
  };
  const deckHote = deckDe(t.hote);
  const hote = { leader: deckHote.leader, cards: [t.acteur, ...deckHote.cards.slice(1)] };
  const options: OptionsHote = { tours: 4, minuteur: t.minuteur, msParSeconde, impasseSecondes: impasse, ...t.optionsHote };
  const p = await partie({
    hote, joyboy: DECKS_JOYBOY[t.joyboy](), injections: t.injections, prefs: t.prefs, options, garde,
    session: { randomInt: tirageSession(graine), ...echelle, ...t.session },
  });
  const st = p.s.stats();
  const { injections: _i, session: _s, optionsHote: _o, ...tirage } = t;
  return {
    ...tirage, fin: p.fin, garde: p.garde,
    impasses: p.hote.impasses().map((i) => `impasse au tour ${i.tour} (${i.attente}), ${i.silence} s de silence, hôte ${JSON.stringify(i.etat)}`),
    desaccords: p.hote.listeDesaccords(), unstuck: st.unstuck, unstuckLog: st.unstuckLog ?? [],
    jouees: p.hote.jouees(), liberees: p.hote.liberees(), recues: st.received, silenceMax: p.hote.silenceMax(), texte: p.texte, noms: p.noms,
  };
}

/** Mélange de joy-boy propre à la graine. */
function tirageSession(graine: number): (max: number) => number {
  const r = hasard(graine ^ 0x5eed);
  return (max) => entier(r, max);
}

/** Une ligne lisible (graine, decks, attentes, verdict). */
export function decrire(x: Resultat): string {
  const verdict = x.impasses.length ? `IMPASSE : ${x.impasses.join(' ; ')}` : x.garde ? 'IMPASSE : arrêtée par la garde'
    : x.desaccords.length ? `DÉSACCORD : ${x.desaccords.slice(0, 3).join(' ; ')}` : parFilet(x) ? `sauvée par le filet (${x.unstuck} déblocage(s), fin ${x.fin.kind})` : 'saine';
  return `graine ${x.graine} [joy-boy ${x.joyboy}, hôte ${x.hote}+${x.acteur}, ${x.minuteur ? 'minuteur' : 'sans minuteur'}, ${x.types.join(' + ')}] fin ${x.fin.kind} : ${verdict}`;
}

/** Joue des graines par lots de `parallele` parties simultanées. */
export async function jouerGraines(graines: number[], o: { msParSeconde?: number; garde?: number; parallele?: number; types?: string[]; impasse?: number; chaque?: (x: Resultat) => void } = {}): Promise<Resultat[]> {
  const out: Resultat[] = [];
  const k = Math.max(1, o.parallele ?? 1);
  for (let i = 0; i < graines.length; i += k) {
    const lot = await Promise.all(graines.slice(i, i + k).map((g) => jouerGraine(g, o)));
    for (const x of lot) { out.push(x); o.chaque?.(x); }
  }
  return out;
}
