import type { ReactNode } from 'react';
import { useApp } from '../../store';
import { ts } from '../i18n/shell';
import { appName, Logo, TopActions } from './index';

export interface HeaderTab { href: string; label: ReactNode; on: boolean }

// Barre du haut d'un onglet : titre (ou la marque sur l'accueil), loupe et avatar, puis la sous-navigation en texte
// (Sets · Chasses · Cartes, Recherches · Doubles · Partage)
export function PageHeader({ title, brand, tabs, tabsLabel, actions = true }: {
  title?: ReactNode; brand?: boolean; tabs?: HeaderTab[]; tabsLabel?: string; actions?: boolean;
}) {
  const { user } = useApp();
  return (
    <>
      <div className="topbar">
        {brand
          ? <span className="brand"><Logo />{appName()}</span>
          : <h1 className="tb-title">{title}</h1>}
        <span className="sp" />
        {actions && <TopActions pseudo={user?.pseudo} labels={{ search: ts('top.search'), account: ts('top.account') }} />}
      </div>
      {tabs && (
        <nav className="c-tabs" aria-label={tabsLabel} style={{ marginTop: 6 }}>
          {tabs.map((tab) => (
            <a key={tab.href} className={tab.on ? 'tab on' : 'tab'} href={tab.href} aria-current={tab.on ? 'page' : undefined}>{tab.label}</a>
          ))}
        </nav>
      )}
    </>
  );
}
