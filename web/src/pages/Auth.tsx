import { useEffect, useState } from 'react';
import { api } from '../api';
import { LangSwitch } from '../components/LangSwitch';
import { LegalLink } from './Legal';
import { t } from '../i18n';
import { useApp } from '../store';

type Mode = 'login' | 'signup' | 'forgot';

// Page d'accueil pour les visiteurs non connectés : essai sans compte, connexion ou création de compte.
// upgrade : un essai en cours devient un vrai compte (même formulaire d'inscription, données gardées).
export function AuthPage({ upgrade = false }: { upgrade?: boolean }) {
  const { setUser, toast, uiLang, setUiLang } = useApp();
  const [mode, setMode] = useState<Mode>(upgrade ? 'signup' : 'login');
  const [identifier, setIdentifier] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Mot de passe oublié : proposé seulement si le site sait envoyer des e-mails
  const [canReset, setCanReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => { api.authConfig().then((c) => setCanReset(c.passwordReset)).catch(() => {}); }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setResetSent(false);
  };

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email, uiLang);
      setResetSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = upgrade ? await api.upgrade(pseudo, email, password)
        : mode === 'login' ? await api.login(identifier, password) : await api.signup(pseudo, email, password);
      if (mode === 'signup') toast(t('auth.welcome', { pseudo: user.pseudo }));
      if (upgrade) window.location.hash = '';
      setUser(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Essai sans compte : un compte d'essai est créé côté serveur, l'appli s'ouvre aussitôt
  const tryGuest = async () => {
    setBusy(true);
    setError(null);
    try {
      setUser((await api.guest()).user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-lang">
        <LangSwitch value={uiLang} onChange={setUiLang} compact label={t('stats.uiLang')} />
      </div>

      <div className="auth-hero">
        <img className="auth-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
        <h1>{upgrade ? t('auth.upgradeTitle') : t('app.name')}</h1>
        <p className="muted">{upgrade ? t('auth.upgradeText') : t('auth.tagline')}</p>
      </div>

      {!upgrade && mode !== 'forgot' && (
        <div className="auth-guest">
          <button className="btn btn-primary btn-block btn-lg" type="button" onClick={tryGuest} disabled={busy}>{t('auth.tryGuest')}</button>
          <p className="muted small">{t('auth.tryGuestHint')}</p>
        </div>
      )}

      {mode === 'forgot' ? (
        <div className="auth-card">
          <h3 className="flush">{t('auth.forgotTitle')}</h3>
          {resetSent ? (
            <p className="flush">{t('auth.forgotSent')}</p>
          ) : (
            <form className="auth-form" onSubmit={forgot}>
              <p className="muted small flush">{t('auth.forgotText')}</p>
              <label className="field">
                <span>{t('auth.email')}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                  autoCapitalize="off" spellCheck={false} required autoFocus />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? '…' : t('auth.forgotSubmit')}</button>
            </form>
          )}
          <button className="link center-link" onClick={() => switchMode('login')}>{t('auth.backToLogin')}</button>
        </div>
      ) : (
      <div className="auth-card">
        {!upgrade && <p className="muted small flush">{t('auth.haveAccount')}</p>}
        {!upgrade && <div className="segmented" role="tablist">
          {(['login', 'signup'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m}
              className={mode === m ? 'segment segment-on' : 'segment'} onClick={() => switchMode(m)}>
              {t(m === 'login' ? 'auth.login' : 'auth.signup')}
            </button>
          ))}
        </div>}

        <form className="auth-form" onSubmit={submit}>
          {mode === 'login' ? (
            <label className="field">
              <span>{t('auth.identifier')}</span>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username"
                autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
            </label>
          ) : (
            <>
              <label className="field">
                <span>{t('auth.pseudo')}</span>
                <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} autoComplete="nickname"
                  autoCapitalize="off" autoCorrect="off" spellCheck={false} minLength={3} maxLength={24} required />
                <small className="muted">{t('auth.pseudoHint')}</small>
              </label>
              <label className="field">
                <span>{t('auth.email')}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                  autoCapitalize="off" spellCheck={false} required />
              </label>
            </>
          )}

          <label className="field">
            <span>{t('auth.password')}</span>
            <div className="password-row">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'signup' ? 8 : undefined} required />
              <button type="button" className="link" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? t('auth.hide') : t('auth.show')}
              </button>
            </div>
            {mode === 'signup' && <small className="muted">{t('auth.passwordHint')}</small>}
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          {mode === 'signup' && <p className="muted small flush">{t('auth.privacy')} <a className="link" href="#legal">{t('legal.link')}</a></p>}

          <button className={upgrade ? 'btn btn-primary btn-block' : 'btn btn-ghost btn-block'} type="submit" disabled={busy}>
            {busy ? '…' : t(mode === 'login' ? 'auth.submitLogin' : 'auth.submitSignup')}
          </button>
        </form>
        {upgrade && <button className="link center-link" type="button" onClick={() => { window.location.hash = 'settings'; }}>{t('auth.upgradeLater')}</button>}
        {mode === 'login' && canReset && (
          <button className="link center-link" onClick={() => switchMode('forgot')}>{t('auth.forgot')}</button>
        )}
      </div>
      )}
      <LegalLink />
    </div>
  );
}
