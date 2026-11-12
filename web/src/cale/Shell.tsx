// Coquille de l'appli connectée : la page de l'adresse, le dock flottant, la fiche carte et le toast.
// Le jeu (onglet Jouer) n'est pas rangé sous .cale : ses styles (game/ui/styles, sous .opc) restent isolés ; seuls le
// dock et le toast, dans leurs propres conteneurs .cale, s'affichent par-dessus.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { refreshPushSubscription } from '../push';
import { useApp } from '../store';
import { t } from '../i18n';
import { Dock } from './Dock';
import { Spinner, Toast } from './kit';
import { dockTab, readRoute, type Route } from './routes';
import { CardSheet } from './screens/CardSheet';
import { Cards } from './screens/Cards';
import { Doubles } from './screens/Doubles';
import { Home } from './screens/Home';
import { HuntBinder } from './screens/HuntBinder';
import { HuntNew } from './screens/HuntNew';
import { Hunts } from './screens/Hunts';
import { Scan } from './screens/Scan';
import { Search } from './screens/Search';
import { SetBinder } from './screens/SetBinder';
import { Sets } from './screens/Sets';
import { Settings } from './screens/Settings';
import { Share } from './screens/Share';
import { Value } from './screens/Value';
import { Wishes } from './screens/Wishes';

// Le jeu (dossier game/) n'est chargé que quand on ouvre l'onglet Jouer
const GameApp = lazy(() => import('../../../game/ui/GameApp.tsx'));

function screen({ page, parts }: Route, openedCard: boolean): ReactNode {
  const id = Number(parts[1]);
  switch (page) {
    case 'home': return <Home />;
    case 'collection':
      if (parts[0] === 'set' && id) return <SetBinder key={id} setId={id} />;
      if (parts[0] === 'hunt' && parts[1] === 'new') return <HuntNew />;
      if (parts[0] === 'hunt' && id) return <HuntBinder key={id} huntId={id} />;
      if (parts[0] === 'hunts') return <Hunts />;
      if (parts[0] === 'cards') return <Cards />;
      return <Sets />;
    case 'scan': return <Scan active={!openedCard} />;
    case 'trades':
      if (parts[0] === 'doubles') return <Doubles />;
      if (parts[0] === 'share') return <Share />;
      return <Wishes />;
    case 'search': return <Search />;
    case 'value': return <Value />;
    case 'settings': return <Settings />;
    default: return null;
  }
}

export function Shell() {
  const [route, setRoute] = useState<Route>(readRoute);
  const { user, uiLang, openedCard, toastMessage } = useApp();
  // Partie en cours dans l'onglet Jouer : le jeu prend tout l'écran, sans dock
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    refreshPushSubscription();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Une page s'ouvre en haut (sauf le retour dans l'historique, que le navigateur gère)
  const key = `${route.page}/${route.parts.join('/')}`;
  useEffect(() => { window.scrollTo(0, 0); }, [key]);

  const play = route.page === 'play';
  const showDock = !(play && immersive) && route.page !== 'search';

  return (
    <>
      {play ? (
        user && (
          <Suspense fallback={<div className="cale cale-app"><Spinner /></div>}>
            <GameApp userId={user.id} notice={uiLang === 'en' ? t('play.frenchOnly') : undefined} onImmersive={setImmersive} />
          </Suspense>
        )
      ) : (
        <div className="cale cale-app">
          <main>{screen(route, openedCard !== null)}</main>
        </div>
      )}
      {showDock && <Dock active={dockTab(route.page)} />}
      <CardSheet />
      {toastMessage && <div className="cale toast-layer"><Toast action={toastMessage.action}>{toastMessage.text}</Toast></div>}
    </>
  );
}
