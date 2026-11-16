import { useState } from 'react';
import { useRoute, type Route as GameRoute } from '../../../game/ui/routes';
import { ts } from './i18n/shell';
import { tsp } from './i18n/space';
import { Icon, Row, Rows, Sheet, type CaleIconName } from './kit';
import type { TabId } from './routes';

// Dock de la Collection : Scanner au centre (seul bouton doré) ; le 5ᵉ emplacement est le raccourci vers le Jeu, à sa
// teinte (lagon)
const TABS: { id: TabId; icon: CaleIconName }[] = [
  { id: 'home', icon: 'home' },
  { id: 'collection', icon: 'collection' },
  { id: 'scan', icon: 'scan' },
  { id: 'trades', icon: 'trades' },
];

// Dock flottant à 5 onglets. Posé dans son propre conteneur .cale pour pouvoir s'afficher au-dessus du jeu, qui n'est
// pas sous .cale.
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
        <a href="#play" className="to-jeu"><Icon name="play" />{tsp('dock.toJeu')}</a>
      </nav>
    </div>
  );
}

/* ---------- Espace Jeu ---------- */

export type JeuTab = 'home' | 'adventure' | 'play' | 'decks' | 'hold';

// Onglet du Jeu allumé pour un écran du jeu (aucun pour le profil, la boutique, Mes parties)
export function jeuTab(route: GameRoute): JeuTab | null {
  switch (route.name) {
    case 'home': return 'home';
    case 'aventure': return route.screen?.kind === 'hold' ? 'hold' : route.screen?.kind === 'shop' ? null : 'adventure';
    case 'rapide': case 'chercher': case 'ami': case 'salle': return 'play';
    case 'decks': return 'decks';
    default: return null;
  }
}

const JEU_TABS: { id: Exclude<JeuTab, 'play'>; icon: CaleIconName; href: string; ui: string }[] = [
  { id: 'home', icon: 'home', href: '#play', ui: 'dock.home' },
  { id: 'adventure', icon: 'map', href: '#play/aventure', ui: 'dock.adventure' },
  { id: 'decks', icon: 'decks', href: '#play/decks', ui: 'home.decks' },
  { id: 'hold', icon: 'hold', href: '#play/aventure/cale', ui: 'home.hold' },
];

// Les 3 façons de lancer une partie, ouvertes par le bouton central du dock du Jeu
export function PlaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} label={tsp('play.title')} className="jd-play">
      <h2 className="h">{tsp('play.title')}</h2>
      <Rows className="jd-play-rows">
        <Row href="#play/chercher" lead={<span className="glyph sea"><Icon name="globe" /></span>} title={tsp('play.queue')} meta={tsp('play.queueMeta')} />
        <Row href="#play/rapide" lead={<span className="glyph sea"><Icon name="bolt" /></span>} title={tsp('play.quick')} meta={tsp('play.quickMeta')} />
        <Row href="#play/ami" lead={<span className="glyph sea"><Icon name="friend" /></span>} title={tsp('play.friend')} meta={tsp('play.friendMeta')} />
      </Rows>
    </Sheet>
  );
}

// Dock du Jeu : Accueil · Aventure · Jouer (lagon, au centre, ouvre les 3 modes) · Decks · Cale
// L'écran du jeu suit son propre historique (game/ui/routes.ts, pushState sans hashchange) : le dock le suit aussi
export function JeuDock() {
  const active = jeuTab(useRoute());
  const [play, setPlay] = useState(false);
  const link = (i: number) => {
    const { id, icon, href, ui } = JEU_TABS[i];
    const on = id === active;
    return <a key={id} href={href} data-ui={ui} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}><Icon name={icon} />{tsp(`dock.jeu.${id}`)}</a>;
  };
  return (
    <div className="cale jeu dock-host">
      <nav className="dock" aria-label={tsp('dock.jeu.label')}>
        {link(0)}{link(1)}
        <button type="button" data-ui="dock.play" className={active === 'play' ? 'on' : undefined} aria-label={tsp('dock.jeu.play')} aria-haspopup="dialog" onClick={() => setPlay(true)}>
          <span className="play"><Icon name="play" /></span>
        </button>
        {link(2)}{link(3)}
      </nav>
      <PlaySheet open={play} onClose={() => setPlay(false)} />
    </div>
  );
}
