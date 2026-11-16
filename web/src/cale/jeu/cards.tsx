// Une carte du jeu dans une pochette du « classeur » (63 × 88) : la teinte de sa couleur, puis son visuel (réel, ou la
// version choisie pour le deck). virtual : carte de la Cale, avec le liseré et le coin lagon (.c-slot.v) ; une carte de
// la collection réelle n'a ni l'un ni l'autre.
import type { CSSProperties, ReactNode } from 'react';
import { CARDS } from '../../../../game/engine/cards/index.ts';
import type { Color } from '../../../../game/engine/types.ts';
import { artPath } from '../../../../game/ui/builder/versions.ts';
import { cardImage } from '../../../../game/ui/images.ts';
import { cx } from '../kit';

const TINT: Record<Color, string> = { Red: 'red', Green: 'green', Blue: 'blue', Purple: 'purple', Black: 'black', Yellow: 'yellow' };

export const colorTint = (color: Color | undefined): CSSProperties => ({ '--tint': `var(--card-${(color && TINT[color]) ?? 'black'})` } as CSSProperties);
export const cardTintOf = (num: string) => colorTint(CARDS[num]?.colors[0]);

export function cardSrc(num: string, variant?: string): string | null {
  const d = CARDS[num];
  if (!d) return null;
  const art = variant ? artPath(num, d, variant) : null;
  return art ? `${import.meta.env.BASE_URL}${art}` : cardImage(d);
}

export function GameSlot({ num, variant, virtual, className, children, style, eager }: {
  num: string; variant?: string; virtual?: boolean; className?: string; children?: ReactNode; style?: CSSProperties; eager?: boolean;
}) {
  const src = cardSrc(num, variant);
  return (
    <span className={cx('c-slot', virtual && 'v', className)} style={style}>
      <span className="c-card" style={cardTintOf(num)}>
        {src && <img src={src} alt="" loading={eager ? undefined : 'lazy'} decoding="async" draggable={false} />}
        {children}
      </span>
    </span>
  );
}
