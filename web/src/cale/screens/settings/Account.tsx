// Réglages : adresse e-mail à confirmer (bandeau avec « Renvoyer le lien ») et export de toutes les données du compte
// (audit du 14 nov. 2026, P1-12 et P2-9)
import { useEffect, useState } from 'react';
import { json, request, type User } from '../../../api';
import { useApp } from '../../../store';
import { ta } from '../../i18n/account';
import { Icon } from '../../kit';

// Adresse pas encore confirmée : le bandeau ; retour du lien de confirmation (?email=ok) : un message
export function EmailVerifyNote({ user }: { user: User }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('email')) return;
    if (params.get('email') === 'ok') toast(ta('verify.done'));
    params.delete('email');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [toast]);
  if (user.guest || user.emailVerified !== false) return null;
  const resend = async () => {
    setBusy(true);
    try {
      await request<{ sent: boolean }>('api/auth/verify/resend', json('POST', {}));
      toast(ta('verify.sent', { email: user.email }));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rg-notif rg-guest" role="status">
      <span>{ta('verify.text')}</span>
      <button type="button" className="btn line" onClick={resend} disabled={busy}>{ta('verify.resend')}</button>
    </div>
  );
}

// Lien de téléchargement de toutes les données (JSON)
export function ExportAllRow() {
  return (
    <a className="row" href="api/export.json" download>
      <span className="row-main"><span className="row-t">{ta('export')}</span><span className="row-m">{ta('export.meta')}</span></span>
      <Icon name="download" small />
    </a>
  );
}
