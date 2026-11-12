// Composants de base du style « classeur » (cale/style.css). Ils ne posent que des classes de style.css et de
// kit.css : un écran compose ces briques, et son CSS propre (screens/<écran>.css) ne garde que sa mise en page.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cardImage, cardName, formatEur, type Card, type Lang } from '../../api';
import { Icon, type CaleIconName } from './Icon';

export { Icon, type CaleIconName } from './Icon';

// Nom de l'appli : « Cale » sur les maquettes, pas encore validé (HANDOFF, décisions ouvertes)
export const APP_NAME = 'Cale';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/* ---------- Mesures, choix ---------- */

// Filet de progression de 1 px (or)
export function Meter({ ratio, style }: { ratio: number; style?: CSSProperties }) {
  return <div className="meter" style={style}><i style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} /></div>;
}

export interface CapsOption<T extends string> { value: T; label: ReactNode; aria?: string }

// Choix en capsule (Full / Master, périodes, VF / VO)
export function Caps<T extends string>({ options, value, onChange, label }: {
  options: CapsOption<T>[]; value: T; onChange: (value: T) => void; label: string;
}) {
  return (
    <div className="caps" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} aria-label={o.aria}
          className={o.value === value ? 'on' : undefined} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// Interrupteur blanc quand il est actif
export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={cx('sw', on && 'on')} onClick={() => onChange(!on)}><i /></button>;
}

// Compteur − n +
export function Stepper({ value, onChange, min = 0, labels }: {
  value: number; onChange: (value: number) => void; min?: number; labels: { minus: string; plus: string };
}) {
  return (
    <span className="step">
      <button type="button" aria-label={labels.minus} disabled={value <= min} onClick={() => onChange(value - 1)}><Icon name="minus" small /></button>
      <b>{value}</b>
      <button type="button" aria-label={labels.plus} onClick={() => onChange(value + 1)}><Icon name="plus" small /></button>
    </span>
  );
}

/* ---------- Listes à filets ---------- */

export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rows', className)}>{children}</div>;
}

// Une ligne : vignette (glyph ou pochette) à gauche, titre + détail, puis ce qu'on veut à droite (chevron par défaut
// si la ligne est cliquable)
export function Row({ lead, title, meta, trail, onClick, href, chevron = true, className, label }: {
  lead?: ReactNode; title: ReactNode; meta?: ReactNode; trail?: ReactNode; onClick?: () => void; href?: string;
  chevron?: boolean; className?: string; label?: string;
}) {
  const body = (
    <>
      {lead}
      <span className="row-main"><span className="row-t">{title}</span>{meta != null && <span className="row-m">{meta}</span>}</span>
      {trail}
      {(onClick || href) && chevron && <Icon name="next" className="chev" />}
    </>
  );
  if (href) return <a className={cx('row', className)} href={href} aria-label={label}>{body}</a>;
  if (onClick) return <button type="button" className={cx('row', className)} onClick={onClick} aria-label={label}>{body}</button>;
  return <div className={cx('row', className)}>{body}</div>;
}

export function Glyph({ icon, gold }: { icon: CaleIconName; gold?: boolean }) {
  return <span className={cx('glyph', gold && 'gold')}><Icon name={icon} /></span>;
}

/* ---------- Cartes, pochettes, classeur ---------- */

const TINTS: Record<string, string> = { red: 'red', green: 'green', blue: 'blue', purple: 'purple', black: 'black', yellow: 'yellow' };

// Teinte d'emplacement d'une carte (--card-*), d'après sa première couleur
export function cardTint(card: Pick<Card, 'color'> | null | undefined): CSSProperties {
  const first = card?.color?.toLowerCase().split(/[\s/;,]+/)[0] ?? '';
  return { '--tint': `var(--card-${TINTS[first] ?? 'black'})` } as CSSProperties;
}

// Une carte dans sa pochette : la teinte, et le visuel par-dessus quand il est chargé (rien d'autre sur l'image)
export function Slot({ card, lang, showImage = true, children, style }: {
  card?: Card | null; lang?: Lang; showImage?: boolean; children?: ReactNode; style?: CSSProperties;
}) {
  return (
    <span className="c-slot" style={style}>
      {card && (
        <span className="c-card" style={cardTint(card)}>
          {showImage && <img src={cardImage(card, lang ?? 'en')} alt="" loading="lazy" decoding="async" />}
        </span>
      )}
      {children}
    </span>
  );
}

// Pochette d'une page : pleine (carte + légende quantité / prix) ou vide (numéro + prix au centre)
export function Pocket({ card, lang, number, version, qty, price, state, onClick, label }: {
  card: Card | null; lang?: Lang; number: string; version?: string; qty: number; price: number | null;
  state?: 'sel' | 'offer' | 'flash'; onClick?: () => void; label: string;
}) {
  const owned = qty > 0;
  const inner = (
    <>
      <Slot card={owned ? card : null} lang={lang}>
        {!owned && (
          <span className="empty">
            <span className="no">{number}</span>
            {version && <span className="ver">{version}</span>}
            <span className="pr">{formatEur(price)}</span>
          </span>
        )}
      </Slot>
      <span className="cap">
        <span>{number}{version && owned && <> <em>{version}</em></>}{owned && <> <b>×{qty}</b></>}</span>
        <span>{owned ? formatEur(price) : ''}</span>
      </span>
    </>
  );
  const cls = cx('pk', state, version && 'alt');
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-label={label}>{inner}</button>
    : <span className={cls} aria-label={label}>{inner}</span>;
}

export function Binder({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('binder', className)}><div className="pockets">{children}</div></div>;
}

// Mini-page 3 × 3 : 'own' plein, 'miss' vide, 'none' (pas de pochette) ; full : page complète (or)
export type MiniDot = 'own' | 'miss' | 'none';
export function Mini({ dots, full, className }: { dots: MiniDot[]; full?: boolean; className?: string }) {
  return (
    <span className={cx('mini', full && 'full', className)} aria-hidden="true">
      {dots.map((d, i) => <i key={i} className={d === 'miss' ? 'm' : d === 'none' ? 'x' : undefined} />)}
    </span>
  );
}

// Les 9 points d'une page à partir de cartes possédées ou non
export function miniDots(owned: boolean[]): MiniDot[] {
  return Array.from({ length: 9 }, (_, i) => (i >= owned.length ? 'none' : owned[i] ? 'own' : 'miss'));
}

/* ---------- Barre du haut ---------- */

export function initials(pseudo: string | undefined) {
  return (pseudo ?? '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
}

// Loupe (recherche globale) et avatar (réglages), en haut à droite de chaque onglet
export function TopActions({ pseudo, labels }: { pseudo: string | undefined; labels: { search: string; account: string } }) {
  return (
    <>
      <a className="hit" href="#search" aria-label={labels.search}><Icon name="search" /></a>
      <a className="hit" href="#settings" aria-label={labels.account}><span className="avatar">{initials(pseudo)}</span></a>
    </>
  );
}

/* ---------- Panneau du bas ---------- */

// Panneau du bas posé sur un voile : se ferme par le voile, Échap ou le bouton retour du navigateur n'est pas géré ici
export function Sheet({ open, onClose, label, children, bar, className }: {
  open: boolean; onClose: () => void; label: string; children: ReactNode; bar?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="cale sheet-layer">
      <div className="veil" onClick={onClose} />
      <section ref={ref} tabIndex={-1} className={cx('sheet', className)} role="dialog" aria-modal="true" aria-label={label}>
        <div className="grip" />
        <div className="sheet-body">{children}</div>
        {bar && <div className="sheet-bar">{bar}</div>}
      </section>
    </div>,
    document.body,
  );
}

/* ---------- Toast ---------- */

export function Toast({ children, action }: { children: ReactNode; action?: { label: string; run: () => void } }) {
  return (
    <div className="toast" role="status">
      <span>{children}</span>
      <span className="sp" />
      {action && <button type="button" onClick={action.run}>{action.label}</button>}
    </div>
  );
}

/* ---------- Divers ---------- */

export function Spinner() {
  return <div className="cale-spinner" role="progressbar" aria-busy="true" />;
}

export { cx, cardName };
