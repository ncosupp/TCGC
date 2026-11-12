// Échanges › Doubles (maquettes Doubles-style, Doubles-EN-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { DoublesView } from '../../pages/Doubles';
import { Legacy } from '../kit/Legacy';

export function Doubles() {
  return <Legacy><DoublesView /></Legacy>;
}
