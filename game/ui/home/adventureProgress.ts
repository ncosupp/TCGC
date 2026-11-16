// Progression de l'aventure (arc en cours, chapitres gagnés, prochain chapitre) : calcul pur, sans le moteur du jeu,
// pour que l'accueil de la Collection et la bascule entre les espaces puissent l'afficher sans charger le jeu.
import { ARCS } from '../../adventure/arcs.ts';
import { arcFinished, currentChapter } from '../../adventure/progress.ts';
import type { Arc, Chapter } from '../../adventure/types.ts';

// Progression de l'aventure, d'après les chapitres gagnés (GET /api/game/adventure)
export interface AdventureProgress {
  arc: Arc;
  started: boolean;
  won: number;                 // chapitres de l'histoire gagnés (sans les défis)
  total: number;
  next?: Chapter;              // prochain chapitre de l'histoire (absent quand l'arc est fini)
  nextNumber?: number;         // son rang dans l'histoire (« Chapitre 3 »), sans compter les défis
  finished: boolean;
  challengesLeft: number;      // défis bonus pas encore relevés
  boosters: number;            // boosters gagnés, pas encore ouverts
}

export function adventureProgress(adv: {
  arcs: Record<string, { started: boolean }>;
  chapters: Record<string, { wins: number }>;
  boosters: unknown[];
}): AdventureProgress {
  const wins = new Set(Object.entries(adv.chapters).filter(([, c]) => c.wins > 0).map(([id]) => id));
  // l'arc où l'on en est : le premier pas fini parmi ceux commencés, sinon le dernier commencé, sinon le premier
  const started = ARCS.filter((a) => adv.arcs[a.id]?.started || a.chapters.some((c) => wins.has(c.id)));
  const arc = started.find((a) => !arcFinished(a, wins)) ?? started[started.length - 1] ?? ARCS[0];
  const story = arc.chapters.filter((c) => !c.optional).sort((a, b) => a.order - b.order);
  const next = currentChapter(arc, wins);
  const index = story.findIndex((c) => c.id === next);
  return {
    arc,
    started: started.includes(arc),
    won: story.filter((c) => wins.has(c.id)).length,
    total: story.length,
    next: index >= 0 ? story[index] : undefined,
    nextNumber: index >= 0 ? index + 1 : undefined,
    finished: arcFinished(arc, wins),
    challengesLeft: arc.chapters.filter((c) => c.optional && !wins.has(c.id)).length,
    boosters: adv.boosters.length,
  };
}
