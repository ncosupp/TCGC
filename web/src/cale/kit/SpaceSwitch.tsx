// Les deux espaces de l'appli (Refonte-UI-jeu, étape 2) : Collection (les vraies cartes, l'or) et Jeu (les cartes
// virtuelles, le lagon). Le nom de l'espace, en haut à gauche, est la bascule : il ouvre un panneau du bas qui mène à
// l'autre espace. Même place dans les deux espaces. L'appli rouvre le dernier espace utilisé (Shell.tsx, tcgc.lastTab).
import { useEffect, useState } from 'react';
import { formatEur } from '../../api';
import { getUiLang } from '../../i18n';
import { useApp } from '../../store';
import { tsp } from '../i18n/space';
import { Icon, Logo, Row, Rows, Sheet, cx } from './index';

export type Space = 'collection' | 'jeu';

const locale = () => (getUiLang() === 'en' ? 'en-US' : 'fr-FR');
export const berryText = (n: number) => `${n.toLocaleString(locale())} ฿`;

// Ce que la ligne du Jeu affiche (« Cartes virtuelles · Chapitre 1 · 120 ฿ ») : lu à l'ouverture du panneau, sans
// charger le jeu
async function jeuMeta(): Promise<string> {
  const [{ loadAdventure }, { adventureProgress }, { loadWallet }] = await Promise.all([
    import('../../../../game/ui/adventure/api.ts'),
    import('../../../../game/ui/home/adventureProgress.ts'),
    import('../../../../game/ui/economy/api.ts'),
  ]);
  const [adventure, wallet] = await Promise.all([loadAdventure().catch(() => null), loadWallet().catch(() => null)]);
  const p = adventure ? adventureProgress(adventure) : null;
  return [
    tsp('jeu.meta'),
    p?.started && p.nextNumber ? tsp('jeu.chapter', { n: p.nextNumber }) : null,
    wallet ? berryText(wallet.balance) : null,
  ].filter(Boolean).join(' · ');
}

export function SpaceSheet({ open, onClose, here }: { open: boolean; onClose: () => void; here: Space }) {
  const { totals } = useApp();
  const [meta, setMeta] = useState<string>(() => tsp('jeu.meta'));
  useEffect(() => {
    if (!open) return;
    let alive = true;
    jeuMeta().then((m) => { if (alive) setMeta(m); }, () => {});
    return () => { alive = false; };
  }, [open]);
  const collectionMeta = totals
    ? tsp('collection.meta', { cards: totals.cards.toLocaleString(locale()), value: formatEur(totals.valueEur ?? 0) })
    : tsp('collection.metaShort');
  const hereMark = (space: Space) => (space === here ? <span className={cx('sw-here', space === 'jeu' ? 'sea' : 'gold')}>{tsp('here')}</span> : undefined);
  const row = (space: Space) => ({
    href: space === here ? undefined : space === 'jeu' ? '#play' : '#home',
    onClick: space === here ? onClose : undefined,
    chevron: space !== here,
    trail: hereMark(space),
    title: tsp(`name.${space}`),
  });
  return (
    <Sheet open={open} onClose={onClose} label={tsp('sheet.label')} className="sw-sheet">
      <div className="sw-head">
        <p className="over">{tsp('sheet.over')}</p>
        <h2 className="h">{tsp('sheet.title')}</h2>
      </div>
      <Rows className="sw-rows">
        <Row {...row('collection')} lead={<span className="glyph gold"><Icon name="collection" /></span>} meta={collectionMeta} />
        <Row {...row('jeu')} lead={<span className="glyph sea"><Icon name="play" /></span>} meta={meta} />
      </Rows>
      <p className="sw-note dim">{tsp('note')}</p>
    </Sheet>
  );
}

// Le nom de l'espace avec le logo : touché, il ouvre le panneau des espaces
export function SpaceButton({ space }: { space: Space }) {
  const [open, setOpen] = useState(false);
  const name = tsp(`name.${space}`);
  return (
    <>
      <button type="button" className="space" aria-label={tsp('switch.label', { space: name })} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Logo />{name}<Icon name="swap" className={cx('swap', space === 'jeu' ? 'sea' : 'gold')} />
      </button>
      <SpaceSheet open={open} onClose={() => setOpen(false)} here={space} />
    </>
  );
}
