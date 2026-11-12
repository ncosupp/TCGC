// Création d'une chasse (maquette Chasse-creation-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { HuntsView } from '../../pages/Hunts';
import { Legacy } from '../kit/Legacy';

export function HuntNew() {
  return <Legacy><HuntsView onOpen={(id) => { window.location.hash = `collection/hunt/${id}`; }} /></Legacy>;
}
