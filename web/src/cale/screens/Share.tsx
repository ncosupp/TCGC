// Échanges › Partager (maquette Partager-style) : échanges entre membres, puis le lien de partage public.
// Hors maquette (états non dessinés) : participer aux échanges (formulaire contact / région dans un panneau),
// détail d'un membre (panneau), création du lien quand il n'existe pas encore.
import { useEffect, useRef, useState } from 'react';
import { api, cardName, formatEur, shareUrl, type Share as ShareData, type ShareScope, type TradeCard, type TradeMatch, type TradeSettings } from '../../api';
import { getUiLang, t } from '../../i18n';
import { useApp } from '../../store';
import { tp } from '../i18n/share';
import { Caps, GuestNote, Icon, Row, Rows, Sheet, Switch, initials, Slot } from '../kit';
import { TradesHeader } from './trades/TradesHeader';
import './share.css';

export function Share() {
  const { version, toast, user } = useApp();
  const [share, setShare] = useState<ShareData | null | undefined>(undefined);
  const [settings, setSettings] = useState<TradeSettings | null>(null);
  const [matches, setMatches] = useState<TradeMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(false);
  const [member, setMember] = useState<TradeMatch | null>(null);
  const [contact, setContact] = useState('');
  const [region, setRegion] = useState('');

  const loadTrades = () => api.trades().then((r) => { setSettings(r.settings); setMatches(r.matches); setContact(r.settings.contact); setRegion(r.settings.region); });
  useEffect(() => {
    api.share().then((r) => setShare(r.share)).catch(() => setShare(null));
  }, []);
  useEffect(() => { loadTrades().catch(() => {}); }, [version]);

  const fail = (err: unknown) => toast((err as Error).message || tp('error'));

  const run = async (action: () => Promise<{ share: ShareData | null }>, message?: string) => {
    setBusy(true);
    try {
      setShare((await action()).share);
      if (message) toast(message);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const saveTrades = async (enabled: boolean) => {
    setBusy(true);
    try {
      await api.setTradeSettings({ enabled, contact, region });
      await loadTrades();
      setForm(false);
      toast(tp(enabled ? 'form.saved' : 'form.left'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pa">
      <TradesHeader active="share" />
      {user?.guest && <GuestNote text={t('guest.members')} />}

      <section className="sec pa-members">
        <div className="sec-h">
          <h2 className="h">{tp('members.title')}</h2>
          {settings?.enabled ? <button type="button" className="sig deal pa-sig" onClick={() => setForm(true)} aria-label={tp('members.edit')}>{tp('members.on')}</button> : null}
        </div>
        {settings?.enabled ? (
          <>
            {matches.length > 0 ? (
              <Rows>
                {matches.map((m) => (
                  <Row key={m.pseudo} onClick={() => setMember(m)}
                    lead={<span className="avatar pa-avatar">{initials(m.pseudo)}</span>}
                    title={<>{m.pseudo}{m.region && <span className="dim pa-city"> · {m.region}</span>}</>}
                    meta={tp('members.line', { have: m.theyHave.length, want: m.theyWant.length })} />
                ))}
              </Rows>
            ) : <p className="dim pa-text">{tp('members.none')}</p>}
            <p className="dim pa-note">{tp('members.privacy', { contact: settings.contact ? tp('members.privacy.contact', { contact: settings.contact }) : '' })}</p>
          </>
        ) : settings ? (
          <>
            <p className="dim pa-text">{tp('members.intro')}</p>
            <button type="button" className="btn line pa-join" disabled={user?.guest} onClick={() => setForm(true)}>{tp('members.join')}</button>
          </>
        ) : null}
      </section>

      {share !== undefined && (
        <section className="sec pa-link">
          <div className="sec-h">
            <h2 className="h">{tp('link.title')}</h2>
            {share && <span className="dim pa-since">{tp('link.since', { date: shortDate(share.createdAt) })}</span>}
          </div>
          <p className="dim pa-text">{tp('link.intro')}</p>
          {share ? <LinkBody share={share} busy={busy} run={run} /> : (
            <button type="button" className="btn main pa-send" disabled={busy || user?.guest} onClick={() => run(() => api.saveShare({}), tp('link.created'))}>{tp('link.create')}</button>
          )}
        </section>
      )}

      <Sheet open={form} onClose={() => setForm(false)} label={tp('form.title')}>
        <form className="pa-form" onSubmit={(e) => { e.preventDefault(); saveTrades(true); }}>
          <h2 className="h">{tp('form.title')}</h2>
          <p className="dim pa-text">{tp('members.privacy', { contact: '' })}</p>
          <label className="field pa-field"><input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100} placeholder={tp('form.contact')} aria-label={tp('form.contact')} /></label>
          <label className="field pa-field"><input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={60} placeholder={tp('form.region')} aria-label={tp('form.region')} /></label>
          <button type="submit" className="btn main" disabled={busy}>{tp('form.save')}</button>
          {settings?.enabled && <button type="button" className="link pa-leave" disabled={busy} onClick={() => saveTrades(false)}>{tp('form.leave')}</button>}
        </form>
      </Sheet>

      <Sheet open={member !== null} onClose={() => setMember(null)} label={member?.pseudo ?? ''}>
        {member && <MemberDetail member={member} onClose={() => setMember(null)} />}
      </Sheet>
    </div>
  );
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(getUiLang() === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short' });
}

function LinkBody({ share, busy, run }: { share: ShareData; busy: boolean; run: (a: () => Promise<{ share: ShareData | null }>, m?: string) => void }) {
  const { toast } = useApp();
  const url = shareUrl(share.token);
  const shown = url.replace(/^https?:\/\//, '');
  const lastCopy = useRef(0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      if (Date.now() - lastCopy.current > 300) toast(tp('link.copied'));
      lastCopy.current = Date.now();
    } catch { /* presse-papiers indisponible (http local) : le lien reste lisible à l'écran */ }
  };
  const send = async () => {
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ text: tp(`text.${share.scope}`), url }); } catch { /* annulé */ }
      return;
    }
    copy();
  };
  const setScope = (scope: ShareScope) => scope !== share.scope && run(() => api.saveShare({ scope }));

  return (
    <>
      <div className="pa-linkrow">
        <div className="field pa-url"><span className="num">{shown}</span></div>
        <button type="button" className="hit pa-copy" aria-label={tp('link.copy')} onClick={copy}><Icon name="copy" small /></button>
      </div>
      <button type="button" className="btn main pa-send" onClick={send}>{tp('link.send')}</button>
      <div className="pa-shows">
        <p className="over">{tp('link.shows')}</p>
        <Caps label={tp('link.shows')} value={share.scope} onChange={setScope}
          options={[{ value: 'doubles', label: tp('scope.doubles') }, { value: 'collection', label: tp('scope.collection') }]} />
      </div>
      <Rows className="pa-switches">
        <div className="row pa-switch"><span className="row-main"><span className="row-t">{tp('prices')}</span></span>
          <Switch on={share.showPrices} label={tp('prices.aria')} onChange={(v) => !busy && run(() => api.saveShare({ showPrices: v }))} /></div>
        <div className="row pa-switch"><span className="row-main"><span className="row-t">{tp('wishes')}</span><span className="row-m">{tp('wishes.hint')}</span></span>
          <Switch on={share.showWishlist} label={tp('wishes.aria')} onChange={(v) => !busy && run(() => api.saveShare({ showWishlist: v }))} /></div>
      </Rows>
      <p className="dim pa-note">{tp('privacy')}</p>
      <div className="pa-actions">
        <a className="link pa-view" href={url} target="_blank" rel="noreferrer">{tp('view')}</a>
        <button type="button" className="link" disabled={busy}
          onClick={() => window.confirm(tp('regenerate.confirm')) && run(() => api.regenerateShare(), tp('regenerated'))}>{tp('regenerate')}</button>
        <button type="button" className="link pa-off" disabled={busy}
          onClick={() => window.confirm(tp('disable.confirm')) && run(() => api.deleteShare(), tp('disabled'))}>{tp('disable')}</button>
      </div>
    </>
  );
}

function MemberDetail({ member, onClose }: { member: TradeMatch; onClose: () => void }) {
  const { openCard } = useApp();
  const list = (title: string, cards: TradeCard[]) => cards.length > 0 && (
    <>
      <p className="over pa-over">{title}</p>
      <Rows>
        {cards.map((c) => (
          <Row key={`${c.id}-${c.tradeLang}`} onClick={() => { onClose(); openCard(c.id, c.tradeLang); }}
            lead={<Slot card={c} lang={c.tradeLang} style={{ width: 36, flex: 'none' }} />}
            title={cardName(c, c.tradeLang)}
            meta={<><span className="num">{c.number}</span> · {c.tradeLang.toUpperCase()}{c.extra > 1 && ` · ×${c.extra}`} · {formatEur(c.price.eur)}</>} />
        ))}
      </Rows>
    </>
  );
  return (
    <div className="pa-member">
      <h2 className="h">{member.pseudo}{member.region && <span className="dim pa-city"> · {member.region}</span>}</h2>
      <p className="dim pa-text">{member.contact ? `${tp('member.contact')} : ${member.contact}` : tp('member.noContact')}</p>
      {list(tp('member.theyHave', { n: member.theyHave.length }), member.theyHave)}
      {list(tp('member.theyWant', { n: member.theyWant.length }), member.theyWant)}
    </div>
  );
}
