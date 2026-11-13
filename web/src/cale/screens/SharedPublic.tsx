// Page publique d'un partage (maquette Partage-public-style), visible sans compte : le visiteur feuillette un
// classeur de pochettes, touche ce qu'il veut « prendre » (liseré blanc) ou « proposer » (liseré bleu), puis
// envoie sa sélection par le menu de partage du téléphone. La sélection reste dans la page, rien ne passe par
// le serveur.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, cardImage, cardName, formatEur, type SharedCard, type SharedView } from '../../api';
import { useApp } from '../../store';
import { tp } from '../i18n/share';
import { appName, Binder, Icon, Rows, Row, Sheet, Spinner, Toast } from '../kit';
import './share.css';

type Section = 'offer' | 'wanted';
const PER_PAGE = 9;
const keyOf = (section: Section, card: SharedCard) => `${section}:${card.id}:${card.lang}`;
const byNumber = (a: SharedCard, b: SharedCard) => a.number.localeCompare(b.number, 'en', { numeric: true }) || a.id - b.id;
const bySet = (a: SharedCard, b: SharedCard) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || (a.setCode ?? '').localeCompare(b.setCode ?? '') || byNumber(a, b);

// Une carte dans le message envoyé : "OP14-018 Roronoa Zoro · Alternate Art (FR)"
function describe(card: SharedCard) {
  return `${card.number} ${cardName(card, card.lang)}${card.variant ? ` · ${card.variant}` : ''} (${card.lang.toUpperCase()})`;
}

export function SharedPublic({ token }: { token: string }) {
  const { uiLang, setUiLang } = useApp();
  // closed : pages publiques fermées par l'interrupteur de retrait du serveur
  const [view, setView] = useState<SharedView | 'missing' | 'closed' | null>(null);
  const [tab, setTab] = useState<Section>('offer');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [manual, setManual] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number>(undefined);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    api.shared(token).then((v) => { if (!cancelled) setView(v); })
      .catch((e: { code?: string }) => { if (!cancelled) setView(e.code === 'public_closed' ? 'closed' : 'missing'); });
    return () => { cancelled = true; };
  }, [token]);

  const offers = useMemo(() => (typeof view === 'object' && view ? [...view.cards].sort(bySet) : []), [view]);
  const wanted = useMemo(() => (typeof view === 'object' && view ? [...view.wanted].sort(bySet) : []), [view]);

  const shell = (children: ReactNode) => (
    <div className="cale cale-app pa-public">
      <div className="topbar">
        <span className="brand"><span className="mark"><Icon name="skull" /></span>{appName()}</span>
        <span className="sp" />
        <button type="button" className="link pa-lang" aria-label={tp('pub.lang')} onClick={() => setUiLang(uiLang === 'fr' ? 'en' : 'fr')}>
          <Icon name="globe" small />{uiLang.toUpperCase()}
        </button>
      </div>
      {children}
      {notice && <div className="cale toast-layer"><Toast>{notice}</Toast></div>}
    </div>
  );

  if (view === null) return shell(<Spinner />);
  if (view === 'missing' || view === 'closed') {
    return shell(
      <section className="pa-pub-head">
        <h1 className="title">{tp(view === 'closed' ? 'pub.closed.title' : 'pub.missing.title')}</h1>
        <p className="dim pa-pub-help">{tp(view === 'closed' ? 'pub.closed.text' : 'pub.missing.text')}</p>
        <Cta />
      </section>,
    );
  }

  const { pseudo } = view;
  const hasWanted = wanted.length > 0;
  const section: Section = tab === 'wanted' && hasWanted ? 'wanted' : 'offer';
  const cards = section === 'offer' ? offers : wanted;
  const pages = Math.max(1, Math.ceil(cards.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = cards.slice(current * PER_PAGE, (current + 1) * PER_PAGE);
  const take = offers.filter((c) => selected.has(keyOf('offer', c)));
  const propose = wanted.filter((c) => selected.has(keyOf('wanted', c)));
  const offerCount = offers.reduce((sum, c) => sum + c.quantity, 0);

  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const say = (text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  };

  // Message prêt à envoyer, dans la langue du visiteur
  const send = async () => {
    const lines: string[] = [];
    if (take.length) lines.push(tp('msg.intro', { pseudo }), ...take.map((c) => `- ${describe(c)}`));
    if (propose.length) {
      if (lines.length) lines.push('');
      lines.push(tp(take.length ? 'msg.have' : 'msg.haveOnly', { pseudo }), ...propose.map((c) => `- ${describe(c)}`));
    }
    const text = lines.join('\n');
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ text }); return; } catch (err) { if ((err as Error).name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      say(tp('msg.copied', { pseudo }));
    } catch {
      setManual(text);
    }
  };

  const setCode = shown[0]?.setCode;
  const total = selected.size;

  return shell(
    <>
      <section className="pa-pub-head">
        <p className="over">{tp('pub.over')}</p>
        <h1 className="title">{tp(`pub.title.${view.scope}`, { pseudo })}</h1>
        <p className="dim pa-pub-help">{tp('pub.help')}</p>
        <div className="caps pa-pub-tabs" role="tablist" aria-label={tp('pub.tabs')}>
          <button type="button" role="tab" aria-selected={section === 'offer'} className={section === 'offer' ? 'on' : undefined}
            onClick={() => { setTab('offer'); setPage(0); }}>{tp(view.scope === 'doubles' ? 'pub.offer' : 'pub.offer.collection', { n: offerCount })}</button>
          {hasWanted && (
            <button type="button" role="tab" aria-selected={section === 'wanted'} className={section === 'wanted' ? 'on' : undefined}
              onClick={() => { setTab('wanted'); setPage(0); }}>{tp('pub.wanted', { n: wanted.length })}</button>
          )}
        </div>
      </section>

      {cards.length === 0 ? <p className="dim pa-pub-empty">{tp('pub.empty')}</p> : (
        <>
          <div className="pa-pager">
            <p><b>{tp('pub.page', { n: current + 1 })}</b> <span className="dim">{tp('pub.pageOf', { total: pages })}{setCode && ` · ${setCode}`}</span></p>
            <span className="pa-pager-btns">
              {current > 0 && <button type="button" className="hit" aria-label={tp('pub.prev')} onClick={() => setPage(current - 1)}><Icon name="back" /></button>}
              {current < pages - 1 && <button type="button" className="hit" aria-label={tp('pub.next')} onClick={() => setPage(current + 1)}><Icon name="next" /></button>}
            </span>
          </div>
          <Binder className="pa-binder">
            {shown.map((c) => {
              const key = keyOf(section, c);
              const on = selected.has(key);
              const price = view.showPrices ? formatEur(c.price) : '';
              return (
                <button key={key} type="button" className={`pk${on ? (section === 'offer' ? ' sel' : ' offer') : ''}`} aria-pressed={on}
                  aria-label={tp('label.card', { name: cardName(c, c.lang), no: c.number, price: price ? `, ${price}` : '', chosen: on ? `, ${tp('pub.chosen')}` : '' })}
                  onClick={() => toggle(key)}>
                  <span className="c-slot">
                    <span className="c-card" style={{ '--tint': 'var(--card-black)' } as React.CSSProperties}>
                      <img src={cardImage(c, c.lang)} alt="" loading="lazy" decoding="async" />
                    </span>
                    {on && <span className="c-tick"><Icon name="check" small /></span>}
                  </span>
                  <span className="cap"><span>{c.number.slice(-3)} <b>×{c.quantity}</b></span><span>{price}</span></span>
                </button>
              );
            })}
          </Binder>
        </>
      )}

      <section className="pa-pub-foot"><Cta /></section>

      {total > 0 && (
        <div className="pa-bar">
          <span className="pa-bar-text">
            {take.length > 0 ? tp('pub.take', { n: take.length }) : tp('pub.propose', { n: propose.length })}
            {take.length > 0 && propose.length > 0 && <><br /><span className="dim">{tp('pub.propose', { n: propose.length })}</span></>}
          </span>
          <button type="button" className="btn quiet pa-bar-clear" onClick={() => setSelected(new Set())}>{tp('pub.clear')}</button>
          <button type="button" className="btn main" onClick={send}>{tp('pub.send')}</button>
        </div>
      )}

      <Sheet open={manual !== null} onClose={() => setManual(null)} label={tp('msg.manual', { pseudo })}>
        <h2 className="h">{tp('msg.manual', { pseudo })}</h2>
        <textarea className="pa-manual" readOnly value={manual ?? ''} rows={Math.min(12, (manual ?? '').split('\n').length + 1)} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn line pa-manual-close" onClick={() => setManual(null)}>{tp('close')}</button>
      </Sheet>
    </>,
  );
}

// Invitation à découvrir l'appli (retour à l'accueil) et mentions légales
function Cta() {
  return (
    <>
      <Rows><Row href="#" title={tp('pub.cta.title')} meta={tp('pub.cta.text')} /></Rows>
      <a className="link pa-legal" href="#legal">{tp('pub.legal')}</a>
    </>
  );
}
