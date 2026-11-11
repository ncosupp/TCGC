// Choix d'un deck, le même partout (tâche R3.4) : partie rapide, jouer avec un ami, copie d'un deck dans Mes decks,
// liste de Mes decks et deck d'aventure. Decks rangés par sorte (les miens, mes decks d'aventure, méta, pour débutant
// du plus récent au plus ancien), filtre par couleur du Leader quand il y a de quoi filtrer. Une seule tuile (DeckTile).
// L'ordre de DECKS ne change pas (il sert aux graines des parties de vérification). Les adversaires de l'aventure n'y
// sont pas.
// source : 'all' = mes decks jouables et les decks préconstruits (choisir un deck pour jouer) ; 'mine' = tous mes decks,
// même incomplets (Mes decks) ; 'adventure' = tous mes decks d'aventure (l'écran du deck d'aventure).
import { useState, type ReactNode } from 'react';
import { CARDS } from '../../engine/cards/index.ts';
import { DECKS, freeDeckIds } from '../../engine/decks.ts';
import { def } from '../../engine/rules.ts';
import { deckInfo, isAdventureDeck, playable, useMyDecks } from '../myDecks.ts';
import { RANDOM_DECK } from './config.ts';
import { COLOR, DeckTile } from './DeckTile.tsx';

type Group = { label: string; ids: string[] };

// decks de démarrage (ST) du plus récent au plus ancien, puis le méta
const PRESET_GROUPS = (): Group[] => [
  {
    label: 'Decks de démarrage ST',
    ids: freeDeckIds().filter((id) => DECKS[id].series !== 'META').sort((a, b) => b.localeCompare(a, 'fr', { numeric: true })),
  },
  { label: 'Decks du méta', ids: freeDeckIds().filter((id) => DECKS[id].series === 'META') },
];
// un groupe de decks préconstruits plus long que ça est replié (au téléphone) : « Voir les N decks »
const FOLD_FROM = 8;
const FOLDED_SHOWS = 6;
// recherche sans accents ni majuscules, sur le nom du deck, son numéro et son Leader
const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const COLOR_FILTERS: [string, string][] = [['', 'Toutes'], ['Red', 'Rouge'], ['Green', 'Vert'], ['Blue', 'Bleu'], ['Purple', 'Violet'], ['Black', 'Noir'], ['Yellow', 'Jaune']];
// en dessous, le filtre par couleur n'aide pas
const FILTER_FROM = 7;

export function DeckPicker({ selected, onPick, onGuide, note, onBuilder, onRandom, source = 'all', chosen, actions, label, empty }: {
  selected?: string;       // absent : rien n'est choisi (Mes decks)
  onPick: (id: string) => void;
  onGuide?: (id: string) => void;
  note?: (id: string) => string | undefined;
  onBuilder?: () => void;  // ouvrir l'éditeur de decks
  onRandom?: () => void;   // proposer « Aléatoire » (deck tiré au sort au lancement)
  source?: 'all' | 'mine' | 'adventure';
  chosen?: string | null;  // deck choisi pour l'aventure (repère sur sa tuile)
  actions?: (id: string) => ReactNode;  // boutons sous chaque tuile
  label?: string;          // ce que fait un appui sur une tuile (« Modifier »), pour les lecteurs d'écran
  empty?: ReactNode;       // aucun deck à montrer
}) {
  const [color, setColor] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const { decks } = useMyDecks();
  const usable = decks.filter((d) => d.leader in CARDS);
  // pour jouer : mes decks jouables (les decks incomplets restent dans l'éditeur)
  const mine = source === 'all' ? usable.filter((d) => playable(d)) : usable;
  const unfinished = decks.length - usable.filter((d) => playable(d)).length;
  const groups: Group[] = [
    ...(source !== 'adventure' ? [{ label: 'Mes decks', ids: mine.filter((d) => !isAdventureDeck(d)).map((d) => d.id) }] : []),
    { label: 'Mes decks d’aventure', ids: mine.filter((d) => isAdventureDeck(d)).map((d) => d.id) },
    ...(source === 'all' ? PRESET_GROUPS() : []),
  ];
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  const filtering = total >= FILTER_FROM;
  const q = plain(query.trim());
  const shown = (id: string) => {
    if (!filtering) return true;
    const info = deckInfo(id)!;
    const leader = def(info.leader);
    if (color && !leader.colors.includes(color as never)) return false;
    return !q || plain(`${info.name} ${id} ${leader.name}`).includes(q);
  };
  const narrowed = !!color || !!q;
  const visible = groups.map((g) => ({ ...g, ids: g.ids.filter(shown) })).filter((g) => g.ids.length);
  // groupes de decks préconstruits repliés, sauf recherche ou filtre en cours ; le deck choisi reste toujours visible
  const fold = (g: Group) => source === 'all' && filtering && !narrowed && g.ids.length >= FOLD_FROM && !open.includes(g.label)
    && PRESET_GROUPS().some((p) => p.label === g.label);
  const listed = (g: Group) => {
    if (!fold(g)) return g.ids;
    const head = g.ids.slice(0, FOLDED_SHOWS);
    return selected && g.ids.includes(selected) && !head.includes(selected) ? [...head, selected] : head;
  };
  return (
    <div className="op-deck-picker">
      {filtering && (
        <input className="deck-search" type="search" data-ui="deck.search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher un deck ou un Leader" aria-label="Chercher un deck par nom ou par Leader" enterKeyHint="search" autoComplete="off" />
      )}
      {filtering && (
        <div className="deck-filter" role="group" aria-label="Couleur du Leader">
          {COLOR_FILTERS.map(([c, name]) => (
            <button key={c} className={`deck-chip ${color === c ? 'on' : ''}`} aria-pressed={color === c} style={c ? { ['--c1' as string]: COLOR[c] } : undefined} onClick={() => setColor(c)}>{name}</button>
          ))}
        </div>
      )}
      {onBuilder && (
        <p className="op-small op-muted deck-mine-note">
          <button className="op-link" onClick={onBuilder}>🃏 Mes decks : créer ou modifier un deck</button>
          {unfinished > 0 ? ` · ${unfinished} deck${unfinished > 1 ? 's' : ''} à terminer dans l’éditeur` : ''}
        </p>
      )}
      {onRandom && (
        <div className="deck-group">
          <h3>Au hasard</h3>
          <div className="deck-grid">
            <button className={`deck-tile deck-random ${selected === RANDOM_DECK ? 'on' : ''}`} data-ui="deck.random" aria-pressed={selected === RANDOM_DECK} onClick={onRandom}>
              <span className="deck-random-dice" aria-hidden="true">🎲</span>
              <span className="deck-name">Aléatoire</span>
              <span className="deck-id">Un deck au hasard parmi tous les decks (démarrage ou méta), tiré au sort à chaque partie</span>
            </button>
          </div>
        </div>
      )}
      {visible.map((g) => (
        <div key={g.label} className="deck-group">
          {(groups.filter((x) => x.ids.length).length > 1 || source === 'all') && <h3>{g.label}</h3>}
          <div className="deck-grid">
            {listed(g).map((id) => (
              <DeckTile key={id} id={id} selected={selected === undefined ? undefined : selected === id} chosen={chosen === id}
                note={note?.(id)} onClick={() => onPick(id)} onGuide={onGuide} actions={actions?.(id)} label={label} />
            ))}
          </div>
          {fold(g) && (
            <button className="op-link deck-more" data-ui="deck.group-more" onClick={() => setOpen([...open, g.label])}>Voir les {g.ids.length} decks</button>
          )}
        </div>
      ))}
      {!total && empty}
      {total > 0 && !visible.length && <p className="op-muted op-small">{q ? 'Aucun deck ne correspond à ta recherche.' : 'Aucun deck de cette couleur.'}</p>}
    </div>
  );
}
