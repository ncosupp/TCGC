// Onglet « Album » de la Cale (étape J, lot 2) : par extension, l'avancement (base X / Y, par rareté, versions
// spéciales) et la grille de toutes ses cartes, les manquantes en silhouette numérotée. Une manquante dit où la trouver :
// dans les boosters de l'extension (le comptoir ne vend que les cartes déjà trouvées).
import { useMemo, useState } from 'react';
import { cardData } from '../../engine/cards/index.ts';
import { CardImage } from './CardImage.tsx';
import type { HoldCard } from './api.ts';
import { ALBUM_RARITIES, ALBUM_SETS, albumOf, missingText, type AlbumSet } from './album.ts';
import { ownedCounts } from './BoosterOpening.tsx';
import { RARITY_LABELS } from './hold.ts';

type Show = 'all' | 'missing' | 'owned';

export function AlbumView({ cards, onShop }: { cards: HoldCard[]; onShop?: () => void }) {
  const owned = useMemo(() => ownedCounts(cards), [cards]);
  const albums = useMemo(() => ALBUM_SETS().map((s) => albumOf(s, owned)).filter((a): a is AlbumSet => Boolean(a)), [owned]);
  const [set, setSet] = useState(albums[0]?.set ?? '');
  const [show, setShow] = useState<Show>('all');
  const album = albums.find((a) => a.set === set);
  if (!album) return null;
  const slots = album.slots.filter((s) => (show === 'all' ? true : show === 'owned' ? s.owned > 0 : s.owned === 0));
  const pct = Math.round((album.base.have / album.base.total) * 100);
  return (
    <section className="op-album" data-ui="hold.album">
      <div className="op-album-sets" role="tablist" aria-label="Extensions">
        {albums.map((a) => (
          <button key={a.set} type="button" role="tab" aria-selected={a.set === set} className={`op-album-set${a.set === set ? ' on' : ''}`}
            onClick={() => setSet(a.set)} data-ui={`album.set-${a.set}`}>
            <strong>{a.set}</strong>
            <span>{a.base.have} / {a.base.total}</span>
            <i style={{ width: `${Math.round((a.base.have / a.base.total) * 100)}%` }} aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="op-album-head">
        <div className="op-album-total">
          <span className="op-album-big">{album.base.have}<small> / {album.base.total}</small></span>
          <span className="op-muted op-small">cartes de base · {pct} %</span>
        </div>
        <ul className="op-album-rarities" aria-label="Par rareté">
          {ALBUM_RARITIES.map((r) => (
            <li key={r} className={album.byRarity[r].have === album.byRarity[r].total ? 'is-full' : undefined}>
              <b>{r}</b> {album.byRarity[r].have}/{album.byRarity[r].total}
            </li>
          ))}
          <li className={album.specials.have === album.specials.total ? 'is-full' : undefined} title="Parallèles, cartes SP, manga">
            <b>✦</b> {album.specials.have}/{album.specials.total}
          </li>
        </ul>
        <p className="op-small op-album-missing">
          {missingText(album)}.{album.missing.total > 0 && <> Elles se trouvent dans les boosters {album.set}
            {onShop && <> · <button type="button" className="op-link op-small" onClick={onShop} data-ui="album.shop">boutique</button></>}.</>}
        </p>
      </div>

      <div className="op-album-filter" role="radiogroup" aria-label="Afficher">
        {([['all', 'Toutes'], ['missing', 'Manquantes'], ['owned', 'Trouvées']] as [Show, string][]).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={show === k} className={`op-album-chip${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{label}</button>
        ))}
      </div>

      <div className="op-album-grid">
        {slots.map((s) => {
          const name = cardData()[s.number]?.name ?? s.number;
          return s.owned > 0 ? (
            <div key={s.number} className="op-album-card" title={`${name} · ${s.number} · ×${s.owned}`}>
              <CardImage entry={{ number: s.number, variant: 'base', name }} />
              <span className="op-album-num">{s.number.split('-')[1]}</span>
            </div>
          ) : (
            <div key={s.number} className={`op-album-card is-missing is-${s.rarity}`} title={`${s.number} · ${RARITY_LABELS[s.rarity] ?? s.rarity} : pas encore trouvée`}>
              <span className="op-album-ghost">
                <b>{s.number.split('-')[1]}</b>
                <span>{s.rarity}</span>
              </span>
            </div>
          );
        })}
      </div>
      {!slots.length && <p className="op-muted">{show === 'missing' ? 'Aucune carte ne manque : base complète !' : 'Aucune carte trouvée pour l’instant.'}</p>}
    </section>
  );
}
