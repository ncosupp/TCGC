import { useEffect, useState } from 'react';
import { Spinner, Toast } from './cale/kit';
import { Legacy } from './cale/kit/Legacy';
import { SharedPublic } from './cale/screens/SharedPublic';
import { Shell } from './cale/Shell';
import { AuthPage } from './pages/Auth';
import { LegalPage } from './pages/Legal';
import { ResetPage } from './pages/Reset';
import { AppProvider, useApp } from './store';

// Pages accessibles sans être connecté : lien de partage (#partage/<jeton>), lien de réinitialisation du mot de
// passe reçu par e-mail (#reset/<jeton>), mentions légales (#legal)
type SpecialRoute = { kind: 'share' | 'reset'; token: string } | { kind: 'legal' | 'upgrade' } | null;

function readRoute(): SpecialRoute {
  if (window.location.hash === '#legal') return { kind: 'legal' };
  if (window.location.hash === '#creer-compte') return { kind: 'upgrade' };
  const share = window.location.hash.match(/^#(?:partage|share)\/([A-Za-z0-9_-]+)/);
  if (share) return { kind: 'share', token: share[1] };
  const reset = window.location.hash.match(/^#reset\/([A-Za-z0-9_-]+)/);
  return reset ? { kind: 'reset', token: reset[1] } : null;
}

// Page publique d'un lien de partage (avec ou sans compte), sinon page d'accueil (connexion / inscription) tant qu'on
// n'est pas connecté, sinon l'appli. Changer de langue d'interface ou de compte redessine toute l'appli.
function Gate() {
  const { user, uiLang, toastMessage } = useApp();
  const [route, setRoute] = useState(readRoute);
  // page d'où l'on a ouvert les mentions légales (le jeu, le profil...) : leur bouton Retour y ramène
  const [legalFrom, setLegalFrom] = useState('#');

  useEffect(() => {
    const onHash = (e: HashChangeEvent) => {
      const from = new URL(e.oldURL).hash;
      if (window.location.hash === '#legal' && from !== '#legal') setLegalFrom(from || '#');
      setRoute(readRoute());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      {route?.kind === 'share' ? (
        <SharedPublic key={route.token} token={route.token} />
      ) : route?.kind === 'reset' ? (
        <Legacy><ResetPage key={`${uiLang}-${route.token}`} token={route.token} /></Legacy>
      ) : route?.kind === 'legal' ? (
        <Legacy><LegalPage back={legalFrom} /></Legacy>
      ) : user === undefined ? (
        <div className="cale cale-app"><Spinner /></div>
      ) : user === null ? (
        <Legacy><AuthPage key={uiLang} /></Legacy>
      ) : route?.kind === 'upgrade' && user.guest ? (
        <Legacy><AuthPage key={`${uiLang}-upgrade`} upgrade /></Legacy>
      ) : (
        <Shell key={`${uiLang}-${user.id}`} />
      )}
      {toastMessage && user == null && <div className="cale toast-layer"><Toast action={toastMessage.action}>{toastMessage.text}</Toast></div>}
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
