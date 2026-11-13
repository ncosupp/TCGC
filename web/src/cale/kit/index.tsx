// Composants de base du style « classeur » (cale/style.css). Ils ne posent que des classes de style.css et de
// kit.css : un écran compose ces briques, et son CSS propre (screens/<écran>.css) ne garde que sa mise en page.
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cardImage, cardName, formatEur, type Card, type Lang, type SetSummary } from '../../api';
import { t } from '../../i18n';
import { Icon, type CaleIconName } from './Icon';

export { Icon, type CaleIconName } from './Icon';

// Nom de l'appli : « Cale » sur les maquettes n'est pas validé (HANDOFF) ; on garde le nom actuel (manifeste, onglet)
export const appName = () => t('app.name');

// Logo de l'appli (logo/logo-tcgc.png, détouré en 256 px dans web/public) : à côté du nom, dans un cadre de 28 px
export function Logo() {
  return <span className="mark"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="" /></span>;
}

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

// Version d'une carte en abrégé dans la légende d'une pochette (l'API n'a pas de genre de version : déduit du nom)
export function versionLabel(card: Pick<Card, 'variant'>) {
  const v = card.variant ?? '';
  if (/alternate/i.test(v)) return 'ALT';
  if (/^sp\b/i.test(v)) return 'SP';
  if (/manga/i.test(v)) return 'MANGA';
  return (v.split(/[\s·]+/)[0] || 'ALT').slice(0, 5).toUpperCase();
}

// Image d'un set : sa carte de couverture (la plus chère possédée, sinon la plus chère du set) dans une pochette
export function SetCover({ set, lang, className }: { set: SetSummary; lang: Lang; className?: string }) {
  const cover = set.cover;
  return (
    <span className={cx('set-cover', className)}>
      <Slot card={cover ? { color: null, image: cover.image, imageFr: cover.imageFr } as unknown as Card : null}
        lang={cover?.ownedLang ?? lang} />
    </span>
  );
}

// Pochette d'une page : pleine (carte + légende quantité / prix) ou vide (carte grisée + légende numéro / prix)
export function Pocket({ card, lang, number, version, qty, price, state, onClick, label }: {
  card: Card | null; lang?: Lang; number: string; version?: string; qty: number; price: number | null;
  state?: 'sel' | 'offer' | 'flash'; onClick?: () => void; label: string;
}) {
  const owned = qty > 0;
  // Pochette vide : la carte en grisé (son numéro et son prix restent dans la légende) ; sans carte connue, le numéro
  const ghost = !owned && card != null;
  const inner = (
    <>
      <Slot card={card} lang={lang}>
        {!owned && !card && (
          <span className="empty">
            <span className="no">{number}</span>
            {version && <span className="ver">{version}</span>}
            <span className="pr">{formatEur(price)}</span>
          </span>
        )}
      </Slot>
      <span className="cap">
        <span>{number}{version && (owned || ghost) && <> <em>{version}</em></>}{owned && <> <b>×{qty}</b></>}</span>
        <span>{owned || ghost ? formatEur(price) : ''}</span>
      </span>
    </>
  );
  const cls = cx('pk', state, version && 'alt', ghost && 'ghost');
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

/* ---------- Essai sans compte ---------- */

// Rappel pendant un essai, avec le lien vers la création du compte (les données de l'essai sont gardées)
export function GuestNote({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx('guest-note', className)}>
      <p>{text}</p>
      <a className="btn main guest-cta" href="#creer-compte">{t('guest.create')}</a>
    </div>
  );
}

/* ---------- Glisser vers le bas pour fermer ---------- */

// Un panneau à pastille (.grip) se ferme en le glissant vers le bas, quand son contenu est déjà tout en haut. Le geste
// est pris au navigateur (preventDefault) : sans ça, tirer vers le bas rechargeait la page (pull-to-refresh).
// page : le panneau est dans le flux de la page (pas un calque fixe), c'est alors la page qui doit être en haut.
// active : faux tant que le panneau n'est pas affiché (le crochet s'abonne quand il apparaît)
export function useSwipeClose(ref: RefObject<HTMLElement | null>, onClose: () => void, page = false, active = true) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0, startY = 0, startT = 0, dy = 0;
    let state: 'idle' | 'wait' | 'drag' = 'idle';
    const atTop = (target: EventTarget | null) => {
      if (page && (document.scrollingElement?.scrollTop ?? 0) > 0) return false;
      for (let n = target as HTMLElement | null; n && n !== el.parentElement; n = n.parentElement) {
        if (n.scrollTop > 0) return false;
      }
      return true;
    };
    const move = (y: number, animate: boolean) => {
      el.style.transition = animate ? 'transform 0.2s ease-out' : 'none';
      el.style.transform = y ? `translateY(${y}px)` : '';
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !atTop(e.target)) { state = 'idle'; return; }
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; startT = e.timeStamp; dy = 0;
      state = 'wait';
    };
    const drag = (e: TouchEvent) => {
      if (state === 'idle') return;
      const x = e.touches[0].clientX - startX;
      dy = e.touches[0].clientY - startY;
      if (state === 'wait') {
        if (Math.abs(x) > 8 && Math.abs(x) > Math.abs(dy)) { state = 'idle'; return; }
        if (dy < -4) { state = 'idle'; return; }
        if (dy < 8) return;
        state = 'drag';
      }
      e.preventDefault();
      move(Math.max(0, dy), false);
    };
    const end = (e: TouchEvent) => {
      if (state !== 'drag') { state = 'idle'; return; }
      state = 'idle';
      const fast = dy > 40 && dy / Math.max(1, e.timeStamp - startT) > 0.6;
      if (dy > Math.min(140, el.offsetHeight / 4) || fast) {
        el.style.transition = 'transform 0.18s ease-in';
        el.style.transform = `translateY(${el.offsetHeight}px)`;
        window.setTimeout(() => { close.current(); window.setTimeout(() => move(0, false), 120); }, 170);
      } else {
        move(0, true);
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', drag, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', drag);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref, page, active]);
}

/* ---------- Panneau du bas ---------- */

// Panneau du bas posé sur un voile : se ferme par le voile, Échap ou en le glissant vers le bas (le bouton retour du
// navigateur n'est pas géré ici)
export function Sheet({ open, onClose, label, children, bar, className }: {
  open: boolean; onClose: () => void; label: string; children: ReactNode; bar?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useSwipeClose(ref, onClose, false, open);
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
