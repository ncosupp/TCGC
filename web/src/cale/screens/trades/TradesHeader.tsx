// Barre du haut de l'onglet Échanges : titre, loupe, avatar et sous-navigation Recherches · Doubles · Partager
import { useApp } from '../../../store';
import { tw } from '../../i18n/wishes';
import { PageHeader } from '../../kit/PageHeader';

export type TradesTab = 'wishes' | 'doubles' | 'share';

export function TradesHeader({ active }: { active: TradesTab }) {
  const { status } = useApp();
  const count = status?.wishlist.count;
  return (
    <PageHeader title={tw('title')} tabsLabel={tw('tabs.label')} tabs={[
      { href: '#trades', on: active === 'wishes', label: <>{tw('tab.wishes')}{count ? <small>{count}</small> : null}</> },
      { href: '#trades/doubles', on: active === 'doubles', label: tw('tab.doubles') },
      { href: '#trades/share', on: active === 'share', label: tw('tab.share') },
    ]} />
  );
}
