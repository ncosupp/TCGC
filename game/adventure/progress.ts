// Progression dans un arc : quels chapitres sont verrouillés, ouverts ou gagnés, d'après les chapitres déjà gagnés.
// Logique pure, la même pour le serveur (qui refuse un chapitre verrouillé) et pour l'interface (carte du monde).
import { ARCS } from './arcs.ts';
import type { Arc, Chapter, ChapterStatus } from './types.ts';

const byOrder = (arc: Arc) => [...arc.chapters].sort((a, b) => a.order - b.order);

// Chapitres à gagner avant celui-ci : ceux de `requires`, sinon le chapitre obligatoire qui le précède (aucun pour le
// premier). Un défi bonus n'est jamais exigé par défaut : il ne bloque pas la suite de l'histoire.
export function requiredChapters(arc: Arc, chapter: Chapter): string[] {
  if (chapter.requires) return chapter.requires;
  const before = byOrder(arc).filter((c) => !c.optional && c.order < chapter.order);
  return before.length ? [before[before.length - 1].id] : [];
}

// Arc terminé : tous les chapitres obligatoires gagnés (les défis bonus ne comptent pas)
export const arcFinished = (arc: Arc, wins: Set<string>) => arc.chapters.every((c) => c.optional || wins.has(c.id));

// Arc ouvert : celui qui n'exige rien, ou dont l'arc exigé (`requiresArc`) est terminé. Un arc inconnu ne s'ouvre pas.
export function arcOpen(arc: Arc, wins: Set<string>, arcs: Arc[] = ARCS): boolean {
  if (!arc.requiresArc) return true;
  const before = arcs.find((a) => a.id === arc.requiresArc);
  return Boolean(before) && arcFinished(before!, wins) && arcOpen(before!, wins, arcs);
}

export function chapterStatuses(arc: Arc, wins: Set<string>, arcs: Arc[] = ARCS): Record<string, ChapterStatus> {
  const statuses: Record<string, ChapterStatus> = {};
  const open = arcOpen(arc, wins, arcs);
  for (const chapter of arc.chapters) {
    statuses[chapter.id] = wins.has(chapter.id) ? 'won'
      : !open ? 'locked'
      : requiredChapters(arc, chapter).every((id) => wins.has(id)) ? 'open'
      : 'locked';
  }
  return statuses;
}

// L'état de tous les chapitres de tous les arcs
export const allStatuses = (wins: Set<string>, arcs: Arc[] = ARCS): Record<string, ChapterStatus> =>
  Object.assign({}, ...arcs.map((arc) => chapterStatuses(arc, wins, arcs)));

// L'arc où l'on en est : le premier arc ouvert pas encore fini, sinon le dernier ouvert
export function activeArc(wins: Set<string>, arcs: Arc[] = ARCS): Arc {
  const open = arcs.filter((a) => arcOpen(a, wins, arcs));
  return open.find((a) => !arcFinished(a, wins)) ?? open[open.length - 1] ?? arcs[0];
}

// Prochaine étape de l'histoire : le premier chapitre obligatoire ouvert (undefined quand l'arc est fini)
export function currentChapter(arc: Arc, wins: Set<string>): string | undefined {
  const statuses = chapterStatuses(arc, wins);
  return byOrder(arc).find((c) => !c.optional && statuses[c.id] === 'open')?.id;
}
