// Saisie manuelle (maquette Scan-saisie-style) : on tape un code ou un nom, on range d'un geste
import { useEffect, useRef, useState } from 'react';
import { api, cardName, formatEur, type Card, type Lang } from '../../../api';
import { getUiLang } from '../../../i18n';
import { Caps, Icon, Rows, Slot } from '../../kit';
import { tsc } from '../../i18n/scan';
import { langLabel } from './helpers';

export function Manual({ lang, setLang, onBack, onChoose, onQuickAdd, onPhoto, photoReady, session }: {
  lang: Lang; setLang: (lang: Lang) => void;
  // Retour à la caméra : absent quand l'appareil n'a pas de caméra
  onBack?: () => void;
  onChoose: (cards: Card[], card: Card) => void;
  onQuickAdd: (card: Card) => void;
  onPhoto: () => void; photoReady: boolean;
  // Cartes rangées pendant la session : lien vers le récap (sans caméra, c'est le seul chemin)
  session?: { cards: number; open: () => void };
}) {
  const ui = getUiLang();
  const [q, setQ] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [none, setNone] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Recherche au fil de la frappe (la réponse la plus récente gagne)
  useEffect(() => {
    const text = q.trim();
    const mine = ++seq.current;
    if (text.length < 2) { setCards([]); setTotal(0); setNone(false); setError(null); return; }
    const timer = window.setTimeout(() => {
      api.cards({ q: text, limit: 40 }).then((r) => {
        if (seq.current !== mine) return;
        setCards(r.cards); setTotal(r.total); setNone(r.cards.length === 0); setError(null);
      }).catch((e: Error) => { if (seq.current === mine) setError(e.message); });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [q]);

  return (
    <div className="sc-manual">
      <div className="topbar">
        {onBack && <button type="button" className="hit" onClick={onBack} aria-label={tsc('man.back')}><Icon name="back" /></button>}
        <span className="sp" />
        <Caps<Lang> label={tsc('man.cardLang')} value={lang} onChange={setLang}
          options={[{ value: 'fr', label: langLabel('fr', ui) }, { value: 'en', label: langLabel('en', ui) }]} />
      </div>
      <section className="sc-intro">
        <h1 className="title">{tsc('man.title')}</h1>
        <p className="dim sc-lead">{onBack ? tsc('man.withCamera') : tsc('man.noCamera')}</p>
        <label className="field focus sc-field">
          <Icon name="search" small />
          <input className="num" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tsc('man.placeholder')}
            aria-label={tsc('man.field')} autoFocus={!onBack} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            enterKeyHint="search" />
          {total > 0 && <span className="dim num sc-total">{total}</span>}
        </label>
        {none && <p className="dim sc-lead">{tsc('man.none', { q: q.trim() })}</p>}
        {error && <p className="sc-error">{error}</p>}
        {session && session.cards > 0 && <button type="button" className="link sc-sessionlink" onClick={session.open}>{tsc('man.session', { n: session.cards })}</button>}
      </section>
      <section className="sec sc-list">
        {cards.length > 0 && (
          <Rows>
            {cards.map((card) => {
              const have = card.owned;
              const name = cardName(card, lang);
              return (
                <div className="row" key={card.id}>
                  <button type="button" className="sc-rowbtn" onClick={() => onChoose(cards, card)} aria-label={tsc('man.open', { name })}>
                    <Slot card={have > 0 ? card : null} lang={lang} style={{ width: 34, flex: 'none' }} />
                    <span className="row-main">
                      <span className="row-t">{name}</span>
                      <span className="row-m"><span className="num">{card.number}</span> · {[card.variant ?? card.rarity, have > 0 ? `×${have}` : tsc('man.empty')].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="sc-price">{formatEur(card.price.eur)}</span>
                  </button>
                  <button type="button" className="hit sc-plus" onClick={() => onQuickAdd(card)}
                    aria-label={tsc('man.store', { name, lang: langLabel(lang, ui) })}><Icon name="plus" /></button>
                </div>
              );
            })}
          </Rows>
        )}
        <button type="button" className="btn line sc-photo" onClick={onPhoto} disabled={!photoReady}>
          <Icon name="image" small />{tsc('man.photo')}
        </button>
      </section>
    </div>
  );
}
