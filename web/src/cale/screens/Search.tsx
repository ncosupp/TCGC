// Recherche globale, sous la loupe (maquette Recherche-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { Catalog } from '../../pages/Catalog';
import { Legacy } from '../kit/Legacy';

export function Search() {
  return <Legacy><Catalog /></Legacy>;
}
