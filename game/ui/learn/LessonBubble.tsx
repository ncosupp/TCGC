// La bulle des leçons de « Apprendre à jouer » (lessons.ts) : en haut du plateau, sous les fenêtres de décision (elle ne
// cache ni ta main ni la barre d'action). Une leçon s'affiche quand sa situation arrive pour la première fois, et reste
// tant que la situation dure, ou jusqu'à « Compris ». Rien ne se joue tout seul : la bulle explique, tu décides.
import { useEffect, useRef, useState } from 'react';
import type { GameState, PlayerId } from '../../engine/types.ts';
import { Button, Icon } from '../kit/index.ts';
import { LESSON_ORDER, lessonText, nextShown, type LessonId } from './lessons.ts';

// Ce qu'a appris le joueur, gardé dans le navigateur : « Apprendre à jouer » se fait une fois (l'accueil le propose
// tant qu'il n'est ni fini ni écarté)
export const LEARN_KEY = 'tcgc.game.learn';
export type LearnStatus = 'new' | 'done' | 'dismissed';

export function learnStatus(): LearnStatus {
  try {
    const v = localStorage.getItem(LEARN_KEY);
    return v === 'done' || v === 'dismissed' ? v : 'new';
  } catch {
    return 'new';
  }
}

export function setLearnStatus(v: Exclude<LearnStatus, 'new'>) {
  try {
    if (v === 'dismissed' && learnStatus() === 'done') return;
    localStorage.setItem(LEARN_KEY, v);
  } catch { /* stockage indisponible : l'accueil le reproposera */ }
}

// La leçon à montrer pour l'état de la partie (active : partie guidée). epoch : une nouvelle partie (son identifiant)
// remet tout à zéro.
export function useLessons(game: GameState | null, human: PlayerId, active: boolean, epoch: unknown) {
  const seen = useRef(new Set<LessonId>());
  const [current, setCurrent] = useState<LessonId | null>(null);
  useEffect(() => {
    seen.current = new Set();
    setCurrent(null);
  }, [epoch]);
  useEffect(() => {
    if (!active || !game) return;
    const shown = nextShown(current, game, human, seen.current);
    if (shown !== current) setCurrent(shown);
  }, [active, game, human, current]);
  // la partie finie compte comme leçon apprise
  useEffect(() => {
    if (active && game && game.winner !== null) setLearnStatus('done');
  }, [active, game]);
  return { current, dismiss: () => setCurrent(null) };
}

// leçons d'une décision prise dans une fenêtre (main de départ, [Déclenchement]) : la bulle passe au-dessus de la fenêtre
const OVER = new Set<LessonId>(['welcome', 'trigger']);

export function LessonBubble({ id, touch, onDismiss }: { id: LessonId; touch: boolean; onDismiss: () => void }) {
  const lesson = lessonText(id, touch);
  const n = LESSON_ORDER.indexOf(id) + 1;
  return (
    <aside className={OVER.has(id) ? 'op-lesson is-over' : 'op-lesson'} data-ui="lesson" data-lesson={id} aria-live="polite" aria-label={`Leçon : ${lesson.title}`}>
      <div className="op-lesson-head">
        <span className="op-lesson-badge" aria-hidden="true"><Icon name="anchor" /></span>
        <span className="op-lesson-who">
          <span className="op-lesson-narrator">Le Maître d’équipage</span>
          <strong className="op-lesson-title">{lesson.title}</strong>
        </span>
        <span className="op-lesson-step">{n} / {LESSON_ORDER.length}</span>
        <Button variant="secondary" data-ui="lesson.ok" onClick={onDismiss}>Compris</Button>
      </div>
      <p className="op-lesson-text">{lesson.text}</p>
    </aside>
  );
}
