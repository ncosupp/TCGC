// Listes de deck en texte (import et export de l'éditeur de decks), sans dépendance au navigateur
import type { DeckList } from '../engine/decks.ts';

// Texte d'un deck au format courant des sites de decks : une ligne par carte, « 4xOP13-008 » (Leader en premier)
export function deckText(d: Pick<DeckList, 'leader' | 'cards'>): string {
  return [`1x${d.leader}`, ...Object.entries(d.cards).map(([num, n]) => `${n}x${num}`)].join('\n');
}

// Lecture d'un texte de deck, dans les formats des sites et simulateurs : « 4xOP13-008 », « 4 OP13-008 »,
// « OP13-008 x4 », « 4 Nami OP01-016 » ou « 4 Nami (OP01-016) » (Limitless), versions parallèles « OP01-016_p1 »
// (la carte de base est comptée). Les intitulés de section (« Characters (36) », « Leader », « // … ») sont ignorés sans
// bruit ; les autres lignes sans numéro de carte sont rendues dans unknown. Le Leader est la carte d'un exemplaire
// marquée comme Leader dans le catalogue (isLeader).
const CODE = /(?<![A-Za-z0-9])([A-Za-z]{1,4}\d{0,2}-\d{3})(?:_[A-Za-z0-9]+)?(?![0-9])/;
const HEADING = /^(?:\/\/|#|-{2,}|={2,})|^(?:leaders?|characters?|personnages?|events?|événements?|evenements?|stages?|lieux?|deck|decklist|main deck|total|don!*)\b[^0-9]*\(?\d{0,3}\)?\s*:?\s*$/i;

export function parseDeckText(text: string, isLeader: (num: string) => boolean): { leader: string | null; cards: Record<string, number>; unknown: string[] } {
  let leader: string | null = null;
  const cards: Record<string, number> = {};
  const unknown: string[] = [];
  for (const raw of text.split(/\r?\n|,|;/)) {
    const line = raw.trim();
    if (!line || HEADING.test(line)) continue;
    // le nombre d'exemplaires en tête (« 4x », « 4 x », « 4 »), sinon « x4 » ailleurs dans la ligne, sinon 1
    const head = line.match(/^(\d{1,2})\s*[x×]?\s*(?=\S)/);
    const rest = head ? line.slice(head[0].length) : line;
    const code = rest.match(CODE);
    if (!code) {
      unknown.push(line);
      continue;
    }
    const tail = head ? null : rest.match(/(?:^|\s)[x×]\s*(\d{1,2})(?!\d)/i);
    const n = Number(head?.[1] ?? tail?.[1] ?? 1);
    const num = code[1].toUpperCase();
    if (!leader && isLeader(num)) leader = num;
    else cards[num] = (cards[num] ?? 0) + n;
  }
  return { leader, cards, unknown };
}
