import { ts } from './i18n/shell';
import { Icon, type CaleIconName } from './kit';
import type { TabId } from './routes';

const TABS: { id: TabId; icon: CaleIconName }[] = [
  { id: 'home', icon: 'home' },
  { id: 'collection', icon: 'collection' },
  { id: 'scan', icon: 'scan' },
  { id: 'trades', icon: 'trades' },
  { id: 'play', icon: 'play' },
];

// Dock flottant à 5 onglets, le Scanner au centre (seul bouton doré). Posé dans son propre conteneur .cale pour
// pouvoir s'afficher au-dessus du jeu, qui n'est pas sous .cale.
export function Dock({ active }: { active: TabId | null }) {
  return (
    <div className="cale dock-host">
      <nav className="dock" aria-label={ts('dock.label')}>
        {TABS.map(({ id, icon }) => {
          const on = id === active;
          if (id === 'scan') {
            return <a key={id} href="#scan" className={on ? 'on' : undefined} aria-label={ts('dock.scan')} aria-current={on ? 'page' : undefined}><span className="scan"><Icon name="scan" /></span></a>;
          }
          return <a key={id} href={`#${id}`} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}><Icon name={icon} />{ts(`dock.${id}`)}</a>;
        })}
      </nav>
    </div>
  );
}
