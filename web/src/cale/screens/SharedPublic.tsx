// Page publique d'un partage (maquette Partage-public-style)
// ÉBAUCHE : affiche encore l'ancienne page (sous .legacy) en attendant la réécriture d'après la maquette.
import { SharedPage } from '../../pages/Shared';
import { Legacy } from '../kit/Legacy';

export function SharedPublic({ token }: { token: string }) {
  return <Legacy><SharedPage token={token} /></Legacy>;
}
