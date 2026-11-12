// Résultat d'un scan ou d'une saisie (maquette Scan-resultat-style) : version, langue, quantité, rangement
import { useEffect, useState } from 'react';
import { cardName, formatEur, type Card, type Lang } from '../../../api';
import { getUiLang } from '../../../i18n';
import { Caps, Slot, Stepper } from '../../kit';
import { tsc } from '../../i18n/scan';
import { langLabel, locate, MAX_QTY, type Candidate } from './helpers';

export function Result({ versions, selected, onSelect, lang, setLang, quantity, setQuantity, onStore, onBack, manual, auto, error, busy }: {
  // Versions entre lesquelles trancher (la première est le meilleur résultat s'il n'y en a qu'une)
  versions: Candidate[]; selected: Candidate | undefined; onSelect: (card: Card) => void;
  lang: Lang; setLang: (lang: Lang) => void; quantity: number; setQuantity: (n: number) => void;
  onStore: (card: Card) => void; onBack: () => void;
  // Venu de la saisie : le bouton de gauche ramène à la liste, pas à la caméra
  manual: boolean; auto: boolean; error: string | null; busy: boolean;
}) {
  const ui = getUiLang();
  const card = selected?.card;
  const [page, setPage] = useState<number | null>(null);

  // Page du classeur où la carte sera rangée (calculée pour une carte normale, voir helpers.locate)
  useEffect(() => {
    setPage(null);
    if (!card) return;
    let stale = false;
    locate(card).then((where) => { if (!stale) setPage(where.page); });
    return () => { stale = true; };
  }, [card]);

  const label = card
    ? (quantity > 1
      ? (page ? tsc('res.storeNPage', { n: quantity, page }) : tsc('res.storeN', { n: quantity }))
      : (page ? tsc('res.storePage', { page }) : tsc('res.store')))
    : '';
  const have = card
    ? (['fr', 'en'] as const).filter((l) => card.ownedByLang[l] > 0).map((l) => `${card.ownedByLang[l]} ${langLabel(l, ui)}`).join(' · ')
    : '';

  return (
    <div className="sc-layer sc-result">
      <section className="sheet sc-sheet" role="dialog" aria-label={tsc('res.label')}>
        <div className="grip" />
        {!card ? (
          <div className="sc-none">
            <p className="dim">{error ?? tsc('res.notFound')}</p>
            <div className="sc-actions"><button type="button" className="btn line" onClick={onBack}>{manual ? tsc('res.back') : tsc('res.rescan')}</button></div>
          </div>
        ) : (
          <>
            <div className="sc-head">
              <Slot card={card} lang={lang} style={{ width: 84, flex: 'none' }} />
              <div className="sc-info">
                <p className="over">{[card.number, card.type].filter(Boolean).join(' · ')}</p>
                <h1 className="title sc-name">{cardName(card, lang)}</h1>
                {card.subtypes && <p className="dim sc-sub">{card.subtypes}</p>}
                <p className="sc-line"><span className="sc-big">{formatEur(card.price.eur)}</span> <span className="dim">· {have ? tsc('res.have', { list: have }) : tsc('res.none')}</span></p>
              </div>
            </div>

            {versions.length > 1 && (
              <div className="sc-block">
                <p className="dim sc-ask">{versions.length === 2 ? tsc('res.versions') : tsc('res.versionsMany', { n: versions.length })}</p>
                <div className="sc-pick">
                  {versions.map((v) => (
                    <button type="button" key={v.card.id} className="sc-opt" aria-pressed={v.card.id === card.id} onClick={() => onSelect(v.card)}>
                      <Slot card={v.card} lang={lang} />
                      <span><b>{v.card.variant ?? tsc('res.standard')}</b><span className="p">{formatEur(v.card.price.eur)}</span></span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="sc-tools">
              <Caps<Lang> label={tsc('res.cardLang')} value={lang} onChange={setLang}
                options={[{ value: 'fr', label: langLabel('fr', ui) }, { value: 'en', label: langLabel('en', ui) }]} />
              <Stepper value={quantity} min={1} onChange={(n) => setQuantity(Math.max(1, Math.min(MAX_QTY, n)))}
                labels={{ minus: tsc('res.less'), plus: tsc('res.more') }} />
            </div>

            <div className="sc-actions">
              <button type="button" className="btn line" onClick={onBack}>{manual ? tsc('res.back') : tsc('res.rescan')}</button>
              <button type="button" className="btn main sc-grow" disabled={busy} onClick={() => onStore(card)}>{label}</button>
            </div>
            {!manual && auto && <p className="dim sc-note">{tsc('res.note')}</p>}
          </>
        )}
      </section>
    </div>
  );
}
