// Fenêtre à l'ancienne mise en page (`div.modal` > `div.modal-box`, styles de modals.css et des écrans) avec le
// comportement de `Dialog` : `role="dialog"`, `aria-modal`, nom accessible, focus posé à l'ouverture (élément marqué
// `data-autofocus`, sinon le premier du contenu), piégé dans la fenêtre et rendu à la fermeture, Échap (seulement la
// fenêtre du dessus), clic sur le fond, Retour du navigateur (ou d'Android) qui la ferme (`routeHistory`, comme
// `Dialog`). Pour les fenêtres dont la mise en page propre ne suit pas celle de `Dialog` (zoom d'une carte de la Cale,
// taux de tirage, guide d'un deck, comptoir, doublons, fin d'un arc, « Quitter la partie ? »).
// Sans `onClose` (achat en cours…), la fenêtre ne se ferme pas d'elle-même.
import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { routeHistory, type DialogHistory } from './Dialog.tsx';
import { initialFocus, isTabbable, nextFocus, openLayers as layers, TABBABLE } from './logic.ts';

const tabbables = (root: HTMLElement | null) =>
  root ? [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(isTabbable) : [];

function focusFirst(panel: HTMLElement | null) {
  if (!panel) return;
  const marked = panel.querySelector<HTMLElement>('[data-autofocus]');
  const all = tabbables(panel);
  const target = initialFocus(marked && isTabbable(marked) ? marked : null, all, all) ?? panel;
  target.focus({ preventScroll: true });
}

export function ModalBox({ onClose, className, label, labelledBy, alert = false, history, style, children, ...rest }: {
  onClose?: () => void;
  /** classes de la boîte (`modal-box` est toujours posée) */
  className?: string;
  /** nom de la fenêtre, si aucun titre de son contenu ne le donne (`labelledBy`) */
  label?: string;
  labelledBy?: string;
  alert?: boolean;
  /** lien avec le Retour du navigateur ; par défaut la table de routes, `false` : aucun */
  history?: DialogHistory | false;
  style?: CSSProperties;
  children: ReactNode;
  'data-ui'?: string;
  'box-ui'?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const closable = Boolean(onClose);

  // Ouverture : au-dessus des autres fenêtres, avec le focus ; fermeture : le focus revient d'où il venait
  useLayoutEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    layers.push(id);
    focusFirst(panel.current);
    const node = panel.current;
    return () => {
      layers.remove(id);
      const active = document.activeElement;
      const lost = !active || active === document.body || Boolean(node?.contains(active));
      if (lost && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [id]);

  // Clavier : Échap ferme, Tab circule dans la fenêtre ; seulement pour la fenêtre du dessus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!layers.isTop(id) || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current?.();
      } else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const items = tabbables(panel.current);
        const active = document.activeElement as HTMLElement | null;
        const next = nextFocus(items, active && items.includes(active) ? active : null, e.shiftKey);
        (next ?? panel.current)?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id]);

  // Historique : une entrée tant que la fenêtre est ouverte ; le Retour la ferme
  const routed = useRef<DialogHistory | null>(null);
  const chosen = history === false ? undefined : history ?? (routed.current ??= routeHistory());
  const hist = useRef(chosen);
  hist.current = chosen;
  const linked = Boolean(chosen) && closable;
  useEffect(() => {
    const h = hist.current;
    if (!linked || !h) return;
    let backed = false;
    h.push(() => {
      backed = true;
      close.current?.();
    });
    return () => {
      if (!backed) h.pop();
    };
  }, [linked]);

  // Clic sur le fond : seulement si l'appui a commencé sur le fond
  const downOnBackdrop = useRef(false);
  const backdrop = closable ? {
    onPointerDown: (e: PointerEvent) => { downOnBackdrop.current = e.target === e.currentTarget; },
    onClick: (e: MouseEvent) => {
      if (downOnBackdrop.current && e.target === e.currentTarget) close.current?.();
      downOnBackdrop.current = false;
    },
  } : {};

  return (
    <div className="modal" data-ui={rest['data-ui']} {...backdrop}>
      <div ref={panel} className={`modal-box${className ? ` ${className}` : ''}`} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true"
        aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} tabIndex={-1} style={style} data-ui={rest['box-ui']}>
        {children}
      </div>
    </div>
  );
}
