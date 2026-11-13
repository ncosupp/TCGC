// Réglages, sous l'avatar (maquettes Reglages-style, Reglages-EN-style)
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, formatDate, type Lang, type NotifyPrefs, type PriceSource } from '../../api';
import { getUiLang, locale, t, type UiLang } from '../../i18n';
import { readPref, writePref } from '../../prefs';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../../push';
import { useApp } from '../../store';
import { tr } from '../i18n/settings';
import { Caps, Glyph, Icon, Row, Rows, Sheet, Switch, initials } from '../kit';
import './settings.css';

const MODES = ['full', 'master'] as const;
type Mode = (typeof MODES)[number];

// Retour = page précédente, ou l'accueil s'il n'y en a pas
function back() {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = 'home';
}

interface Choice<T extends string> { value: T; label: string; meta?: string }

// Choix d'une valeur parmi quelques-unes, dans un panneau du bas
function Picker<T extends string>({ open, onClose, title, choices, value, onPick }: {
  open: boolean; onClose: () => void; title: string; choices: Choice<T>[]; value: T; onPick: (value: T) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <h2 className="rg-sheet-t">{title}</h2>
      <Rows>
        {choices.map((c) => (
          <Row key={c.value} title={c.label} meta={c.meta} chevron={false} label={c.label}
            trail={c.value === value ? <Icon name="check" small /> : undefined}
            onClick={() => { onPick(c.value); onClose(); }} />
        ))}
      </Rows>
    </Sheet>
  );
}

export function Settings() {
  const { user, setUser, status, toast, uiLang, setUiLang, lang, setLang, refreshStatus, cardChanged, wishChanged } = useApp();
  const [picker, setPicker] = useState<'ui' | 'card' | 'mode' | 'source' | null>(null);
  const [mode, setMode] = useState<Mode>(() => readPref('tcgc.setMode', MODES, 'full'));
  const [keep, setKeep] = useState<number>(user?.keepCopies ?? 1);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [cameraHelp, setCameraHelp] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Notifications de cet appareil (même logique que l'ancien panneau du profil)
  const supported = pushSupported();
  const denied = supported && Notification.permission === 'denied';
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);

  useEffect(() => {
    api.doubles().then((d) => setKeep(d.keep)).catch(() => {});
    if (!supported) return;
    currentSubscription().then((sub) => setSubscribed(Boolean(sub))).catch(() => setSubscribed(false));
    api.push().then((res) => { setPrefs(res.prefs); setPublicKey(res.publicKey); }).catch(() => {});
  }, [supported]);

  if (!user) return null;

  const notifyRun = async (action: () => Promise<void>) => {
    setNotifyBusy(true);
    try { await action(); } catch (err) { toast((err as Error).message); } finally { setNotifyBusy(false); }
  };
  const enable = () => notifyRun(async () => {
    if (!publicKey) return;
    if (await enablePush(publicKey)) { setSubscribed(true); toast(tr('notify.enabledToast')); } else toast(t('notify.denied'));
  });
  const disable = () => notifyRun(async () => { await disablePush(); setSubscribed(false); toast(tr('notify.disabledToast')); });
  const changePref = (type: keyof NotifyPrefs, value: boolean) => notifyRun(async () => {
    setPrefs((await api.setNotifyPrefs({ [type]: value })).notify);
  });

  const changeKeep = async (value: number) => {
    const previous = keep;
    setKeep(value);
    try {
      await api.setKeepCopies(value);
      wishChanged(); // les listes (doubles) se rechargent
    } catch (err) {
      setKeep(previous);
      toast((err as Error).message);
    }
  };

  // Mise à jour manuelle des prix (le serveur refuse si elle est déjà fraîche ou en cours)
  const sync = async () => {
    try {
      const { started } = await api.sync();
      toast(tr(started ? 'sync.started' : 'sync.fresh'));
    } catch (err) {
      toast((err as Error).message);
    }
    window.setTimeout(refreshStatus, 1500);
  };

  const changeMode = (next: Mode) => { setMode(next); writePref('tcgc.setMode', next); };

  const changeSource = async (source: PriceSource) => {
    const res = await api.setPriceSource(source);
    refreshStatus();
    cardChanged(null, res.totals); // recharge toutes les listes avec la nouvelle estimation
  };

  // Import d'un export CSV (ex. collection d'une autre installation de TCGC)
  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const res = await api.importCollection(await file.text());
      const skipped = res.skipped ? ` · ${tr('importSkipped', { n: res.skipped })}` : '';
      toast(`${tr('imported', { cards: res.cards, copies: res.copies })}${skipped}`);
      cardChanged(null, res.totals);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    toast(tr('loggedOut'));
  };

  // Suppression définitive du compte et de toutes ses données, après confirmation par mot de passe
  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      setUser(null);
      toast(tr('deleted'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closeDelete = () => { setDeleting(false); setPassword(''); setError(null); };

  const source = status?.priceSource ?? user.priceSource;
  const money = (digits: number, currency: string) => new Intl.NumberFormat(locale(), { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits });
  const rate = status?.usdPerEur ? `${money(0, 'EUR').format(1)} = ${money(4, 'USD').format(status.usdPerEur)}` : '—';
  const num = (n: number) => new Intl.NumberFormat(locale(), { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).format(n);
  const val = (text: ReactNode) => <span className="rg-val">{text}</span>;
  const notifyRow = (key: keyof NotifyPrefs) => (
    <Row key={key} title={tr(`notify.${key}`)} meta={tr(`notify.${key}.meta` as 'notify.targets.meta')}
      trail={<Switch on={Boolean(prefs?.[key])} onChange={(v) => changePref(key, v)} label={tr(`notify.${key}`)} />} />
  );
  const lines = [
    [tr('kv.cm'), formatDate(status?.cmPriceDate)],
    [tr('kv.tcg'), formatDate(status?.priceDate)],
    [tr('kv.rate'), rate],
    [tr('kv.scan'), status ? `${num(status.scan.indexed)} / ${num(status.scan.total)}${status.scan.building ? ' …' : ''}` : '—'],
  ];

  return (
    <div className="rg">
      <div className="topbar">
        <button type="button" className="hit" onClick={back} aria-label={tr('back')}><Icon name="back" /></button>
      </div>
      <section className="rg-head">
        <h1 className="title">{tr('title')}</h1>
        <div className="rg-who">
          <span className="avatar">{initials(user.pseudo)}</span>
          <span className="rg-who-t">
            <span className="rg-name">{user.pseudo}</span>
            <span className="rg-mail">{user.email} · {tr('since', { date: formatDate(user.createdAt) })}</span>
          </span>
        </div>
      </section>

      <section className="sec rg-sec">
        <p className="over">{tr('sec.lang')}</p>
        <Rows>
          <Row lead={<Glyph icon="globe" />} title={tr('uiLang')} meta={tr('uiLang.meta')} trail={val(tr(`uiLang.${uiLang}`))} onClick={() => setPicker('ui')} />
          <Row lead={<Glyph icon="collection" />} title={tr('cardLang')} meta={tr('cardLang.meta')} trail={val(tr(`cardLang.${lang}`))} onClick={() => setPicker('card')} />
        </Rows>
      </section>

      <section className="sec rg-sec">
        <p className="over">{tr('sec.binder')}</p>
        <Rows>
          <div className="row rg-keep">
            <span className="row-main"><span className="row-t">{tr('keep')}</span><span className="row-m rg-wrap">{tr('keep.meta')}</span></span>
            <Caps label={tr('keep')} value={String(keep)} onChange={(v) => changeKeep(Number(v))}
              options={['1', '2', '3', '4'].map((v) => ({ value: v, label: v }))} />
          </div>
          <Row title={tr('mode')} meta={tr('mode.meta')} trail={val(tr(`mode.${mode}`))} onClick={() => setPicker('mode')} />
          <Row title={tr('source')} meta={tr('source.meta')} trail={val(source === 'tcgplayer' ? tr('source.tcg') : tr('source.cm'))} onClick={() => setPicker('source')} />
        </Rows>
      </section>

      <section className="sec rg-sec">
        <p className="over rg-loose">{tr('sec.notify')}</p>
        <div className="rg-notif">
          <span>{!supported ? tr('notify.unsupported') : denied ? tr('notify.denied') : subscribed ? tr('notify.on') : tr('notify.off')}</span>
          {supported && !denied && subscribed === false && (
            <button type="button" className="btn main" onClick={enable} disabled={notifyBusy || !publicKey}>{tr('notify.enable')}</button>
          )}
          {supported && !denied && subscribed && (
            <button type="button" className="btn line" onClick={disable} disabled={notifyBusy}>{tr('notify.disable')}</button>
          )}
        </div>
        {subscribed && prefs && (
          <Rows className="rg-list rg-plain">{notifyRow('targets')}{notifyRow('trades')}{notifyRow('weekly')}{notifyRow('bans')}</Rows>
        )}
      </section>

      <section className="sec rg-sec">
        <p className="over">{tr('sec.data')}</p>
        <Rows className="rg-plain">
          <a className="row" href={`api/export.csv?lang=${getUiLang()}`} download>
            <span className="row-main"><span className="row-t">{tr('export')}</span><span className="row-m">{tr('export.meta')}</span></span>
            <Icon name="download" small />
          </a>
          <Row title={tr('import')} meta={<span className="rg-wrap">{tr('import.meta')}</span>} chevron={false}
            trail={<Icon name="upload" small />} onClick={() => importRef.current?.click()} className={importing ? 'rg-busy' : undefined} />
          <Row title={tr('sync')} chevron={false} onClick={status?.syncing ? undefined : sync}
            meta={status?.syncing ? tr('sync.running') : tr('sync.meta', { date: formatDate(status?.lastSync) })} />
        </Rows>
        <input ref={importRef} type="file" accept=".csv,text/csv" hidden onChange={importCsv} />
        {status?.error && <p className="rg-err" role="status">{tr('sync.error', { error: status.error })}</p>}
        <dl className="kv rg-kv">
          {lines.map(([k, v]) => <FragmentRow key={k} term={k} value={v} />)}
        </dl>
      </section>

      <section className="sec rg-sec">
        <p className="over">{tr('sec.help')}</p>
        <Rows className="rg-plain">
          {window.location.protocol !== 'https:' && <Row title={tr('camera')} className="rg-link" onClick={() => setCameraHelp(true)} />}
          <Row title={tr('legal')} className="rg-link" href="#legal" />
          <Row title={tr('about')} meta={tr('about.meta')} className="rg-link" chevron={false} />
        </Rows>
      </section>

      <section className="sec rg-sec rg-last">
        <Rows className="rg-plain"><Row title={tr('logout')} className="rg-link" onClick={logout} chevron={false} /></Rows>
        <p className="rg-warn">{tr('delete.text')}</p>
        <button type="button" className="btn c-danger rg-delete" onClick={() => setDeleting(true)}>{tr('delete')}</button>
      </section>

      <Picker open={picker === 'ui'} onClose={() => setPicker(null)} title={tr('uiLang')} value={uiLang}
        choices={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }] as Choice<UiLang>[]} onPick={setUiLang} />
      <Picker open={picker === 'card'} onClose={() => setPicker(null)} title={tr('cardLang')} value={lang}
        choices={[{ value: 'fr', label: tr('cardLang.frLong') }, { value: 'en', label: tr('cardLang.enLong') }] as Choice<Lang>[]} onPick={setLang} />
      <Picker open={picker === 'mode'} onClose={() => setPicker(null)} title={tr('mode')} value={mode}
        choices={[{ value: 'full', label: tr('mode.full'), meta: tr('mode.fullMeta') }, { value: 'master', label: tr('mode.master'), meta: tr('mode.masterMeta') }]} onPick={changeMode} />
      <Picker open={picker === 'source'} onClose={() => setPicker(null)} title={tr('source')} value={source}
        choices={[{ value: 'cardmarket', label: tr('source.cm'), meta: tr('source.cmMeta') }, { value: 'tcgplayer', label: tr('source.tcg'), meta: tr('source.tcgMeta') }] as Choice<PriceSource>[]} onPick={changeSource} />

      <Sheet open={cameraHelp} onClose={() => setCameraHelp(false)} label={tr('cam.sheet')}>
        <h2 className="rg-sheet-t">{t('cam.title')}</h2>
        <div className="rg-help">
          <p>{t('cam.intro')}</p>
          <ol>
            <li>{t('cam.step1')} <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code></li>
            <li>{t('cam.step2a')} <b>Enabled</b> {t('cam.step2b')} <code>{window.location.origin}</code></li>
            <li>{t('cam.step3a')} <b>Relaunch</b> {t('cam.step3b')}</li>
            <li>{t('cam.step4a')} <b>{t('cam.install')}</b> {t('cam.step4b')}</li>
          </ol>
          <p>{t('cam.note')}</p>
        </div>
      </Sheet>

      <Sheet open={deleting} onClose={closeDelete} label={tr('delete')}>
        <form onSubmit={deleteAccount}>
          <h2 className="rg-sheet-t">{tr('delete')}</h2>
          <p className="rg-help">{tr('delete.text')}</p>
          <label className="field rg-field rg-field-box">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr('delete.password')}
              aria-label={tr('delete.confirm')} autoComplete="current-password" required autoFocus />
          </label>
          {error && <p className="rg-err" role="alert">{error}</p>}
          <div className="sheet-bar-inline" style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="button" className="btn line rg-bar-btn" onClick={closeDelete}>{tr('delete.cancel')}</button>
            <button type="submit" className="btn c-danger rg-bar-btn" disabled={busy || !password}>{busy ? '…' : tr('delete.go')}</button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

function FragmentRow({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd className="num">{value}</dd>
    </>
  );
}
