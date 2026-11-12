// Fiche carte en panneau du bas (maquettes Carte-style, Carte-EN-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { CardDetailSheet } from '../../components/CardDetail';
import { Legacy } from '../kit/Legacy';

export function CardSheet() {
  return <Legacy><CardDetailSheet /></Legacy>;
}
