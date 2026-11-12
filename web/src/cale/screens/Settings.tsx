// Réglages, sous l'avatar (maquettes Reglages-style, Reglages-EN-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { ProfilePage } from '../../pages/Profile';
import { Legacy } from '../kit/Legacy';

export function Settings() {
  return <Legacy><ProfilePage /></Legacy>;
}
