// Échanges › Recherches (maquette Recherches-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { Wishlist } from '../../pages/Wishlist';
import { Legacy } from '../kit/Legacy';

export function Wishes() {
  return <Legacy><Wishlist /></Legacy>;
}
