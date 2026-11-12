// Page d'un set en classeur (maquette Classeur)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { Collection } from '../../pages/Collection';
import { Legacy } from '../kit/Legacy';

export function SetBinder(_props: { setId: number }) {
  return <Legacy><Collection onScan={() => { window.location.hash = 'scan'; }} onBrowse={() => { window.location.hash = 'search'; }} /></Legacy>;
}
