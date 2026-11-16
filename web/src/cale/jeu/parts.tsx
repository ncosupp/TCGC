// Briques de l'espace Jeu (Refonte-UI-jeu, étape 2), au style « classeur » : en-tête (bascule, bourse, avatar pirate),
// prime avec son propre signe (jamais ฿), dates relatives. Les écrans du Jeu sont posés dans le conteneur du jeu (.opc,
// fixe, au-dessus du dock) : JeuScreen les fait défiler à l'intérieur.
import type { ReactNode } from 'react';
import { useWallet } from '../../../../game/ui/economy/Wallet.tsx';
import { navigate } from '../../../../game/ui/routes.ts';
import { getUiLang } from '../../i18n';
import { tjh } from '../i18n/jeu-home';
import { Icon, cx } from '../kit';
import { SpaceButton, berryText } from '../kit/SpaceSwitch';
import './jeu.css';

const locale = () => (getUiLang() === 'en' ? 'en-US' : 'fr-FR');

// Un écran de l'espace Jeu : conteneur .cale.jeu qui défile, au-dessus du dock
export function JeuScreen({ className, children, ...rest }: { className?: string; children: ReactNode; 'data-ui'?: string }) {
  return <div className={cx('cale jeu jx-screen', className)} {...rest}>{children}</div>;
}

// En-tête de l'espace Jeu : la bascule à gauche, la bourse (→ Boutique) et l'avatar pirate (→ Profil pirate)
export function JeuTopBar() {
  const { wallet } = useWallet();
  const balance = wallet?.balance ?? null;
  return (
    <div className="topbar">
      <SpaceButton space="jeu" />
      <span className="sp" />
      <button type="button" className="purse" data-ui="home.shop" aria-label={tjh('top.purse', { n: balance ?? 0 })} onClick={() => navigate({ name: 'boutique' })}>
        {balance === null ? '…' : balance.toLocaleString(locale())} <span className="b">฿</span>
      </button>
      <button type="button" className="hit" data-ui="home.profile" aria-label={tjh('top.pirate')} onClick={() => navigate({ name: 'profil' })}>
        <span className="pirate"><Icon name="pirate" small /></span>
      </button>
    </div>
  );
}

// Prime en abrégé : « 3 M », « 12,5 M », « 1,2 Md » (le niveau du joueur, pas une monnaie : jamais ฿)
export function primeShort(amount: number): string {
  const fmt = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: n < 10 ? 1 : 0 });
  if (amount >= 1e9) return `${fmt(amount / 1e9)} ${getUiLang() === 'en' ? 'B' : 'Md'}`;
  if (amount >= 1e6) return `${fmt(amount / 1e6)} M`;
  if (amount >= 1e3) return `${fmt(amount / 1e3)} k`;
  return fmt(amount);
}

export function Prime({ amount, rank }: { amount: number; rank?: string }) {
  return (
    <span className="prime" aria-label={tjh('prime', { amount: primeShort(amount), rank: rank ?? '' })}>
      <Icon name="skull" className="ic-xs" />{primeShort(amount)}{rank ? ` · ${rank}` : ''}
    </span>
  );
}

export { berryText };

// « il y a 3 min », « hier », « 3 minutes ago »
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(getUiLang() === 'en' ? 'en' : 'fr', { numeric: 'auto', style: 'short' });
  if (Math.abs(minutes) < 60) return rtf.format(Math.min(0, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
