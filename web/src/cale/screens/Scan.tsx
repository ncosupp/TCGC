// Scanner (maquettes Scan-style, Scan-resultat-style, Scan-saisie-style, Scan-recap-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { Scanner } from '../../pages/Scanner';
import { Legacy } from '../kit/Legacy';

export function Scan({ active }: { active: boolean }) {
  return <Legacy><Scanner active={active} /></Legacy>;
}
