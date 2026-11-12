// Valeur de la collection (maquette Valeur-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { StatsPage } from '../../pages/Stats';
import { Legacy } from '../kit/Legacy';

export function Value() {
  return <Legacy><StatsPage /></Legacy>;
}
