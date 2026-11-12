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
const Cards = lazy(() => import('./screens/Cards').then((m) => ({ default: m.Cards })));
const Doubles = lazy(() => import('./screens/Doubles').then((m) => ({ default: m.Doubles })));
const Home = lazy(() => import('./screens/Home').then((m) => ({ default: m.Home })));
const HuntBinder = lazy(() => import('./screens/HuntBinder').then((m) => ({ default: m.HuntBinder })));
const HuntNew = lazy(() => import('./screens/HuntNew').then((m) => ({ default: m.HuntNew })));
const Hunts = lazy(() => import('./screens/Hunts').then((m) => ({ default: m.Hunts })));
const Scan = lazy(() => import('./screens/Scan').then((m) => ({ default: m.Scan })));
const Search = lazy(() => import('./screens/Search').then((m) => ({ default: m.Search })));
const SetBinder = lazy(() => import('./screens/SetBinder').then((m) => ({ default: m.SetBinder })));
const Sets = lazy(() => import('./screens/Sets').then((m) => ({ default: m.Sets })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const Share = lazy(() => import('./screens/Share').then((m) => ({ default: m.Share })));
const Value = lazy(() => import('./screens/Value').then((m) => ({ default: m.Value })));
const Wishes = lazy(() => import('./screens/Wishes').then((m) => ({ default: m.Wishes })));

// Écrans chargés à la demande : un écran en erreur ne bloque pas les autres
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
          <main><Suspense fallback={<Spinner />}>{screen(route, openedCard !== null)}</Suspense></main>
        </div>
      )}
      {showDock && <Dock active={dockTab(route.page)} />}
      <CardSheet />
      {toastMessage && <div className="cale toast-layer"><Toast action={toastMessage.action}>{toastMessage.text}</Toast></div>}
    </>
  );
}
