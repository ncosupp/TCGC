// Page d'une chasse (maquette Chasse-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { HuntDetail } from '../../pages/Hunts';
import { Legacy } from '../kit/Legacy';

export function HuntBinder({ huntId }: { huntId: number }) {
  return <Legacy><HuntDetail huntId={huntId} onBack={() => { window.location.hash = 'collection/hunts'; }} /></Legacy>;
}
