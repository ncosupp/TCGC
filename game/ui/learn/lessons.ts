// « Apprendre à jouer » : une vraie partie contre l'IA Débutant, où chaque règle est expliquée au moment où elle sert
// (la main de départ, les DON!!, la première attaque, le premier Contre…). Fonctions pures, sans React ni DOM, testées
// par game/tests/lessons.test.ts ; la bulle est dans LessonBubble.tsx, la partie est lancée par App.tsx (learnConfig).
import { def } from '../../engine/rules.ts';
import type { GameState, PlayerId } from '../../engine/types.ts';
import type { Config } from '../setup/config.ts';

export type LessonId =
  | 'welcome' | 'don' | 'endTurn' | 'oppTurn' | 'attack' | 'giveDon'
  | 'counter' | 'blocker' | 'life' | 'trigger' | 'finish';

export interface Lesson {
  id: LessonId;
  title: string;
  text: string;
}

// La partie guidée : le deck pour débutant des Chapeaux de paille contre la Marine de Shells Town (le 1er adversaire de
// l'aventure, fait pour débuter : parties courtes, gagnables), IA Débutant, tu commences
export const LEARN_CONFIG: Config = { myDeck: 'ST-01', aiDeck: 'AV-EB-MORGAN', first: 'me', level: 1, learn: true };

// Ordre de lecture : sert à numéroter les leçons (« 3 / 11 »)
export const LESSON_ORDER: LessonId[] = ['welcome', 'don', 'endTurn', 'oppTurn', 'attack', 'giveDon', 'counter', 'blocker', 'life', 'trigger', 'finish'];

const has = (ids: string[], prefix: string) => ids.some((id) => id.startsWith(prefix));

// Le texte d'une leçon (touch : écran tactile ; les gestes sont dits autrement à la souris). Deux ou trois lignes au
// plus sur téléphone : la bulle ne doit pas cacher le panneau du combat.
export function lessonText(id: LessonId, touch: boolean): Lesson {
  const tap = touch ? 'Touche' : 'Clique sur';
  const t = (title: string, text: string): Lesson => ({ id, title, text });
  switch (id) {
    case 'welcome':
      return t('Bienvenue à bord !', 'Le but : faire perdre toutes ses Vies au Leader adverse, puis le toucher une dernière fois. '
        + 'Garde ta main si elle a des cartes de petit coût (le chiffre en haut à gauche), sinon repioche.');
    case 'don':
      return t('Les DON!!, ton énergie', `Tes DON!! (à droite de ton Leader) paient le coût des cartes, et tu en reçois 2 de plus à `
        + `chaque tour. ${tap} une carte entourée d’or pour la jouer. ★ : le conseil du coach.`);
    case 'endTurn':
      return t('Fin du tour', `Plus rien d’utile à faire ? ${tap} « Fin du tour ». Tes DON!! se redresseront au prochain tour, `
        + 'et tu en recevras 2 de plus.');
    case 'oppTurn':
      return t('Au tour de l’IA', 'Elle joue ses cartes et peut t’attaquer. Quand elle attaque, c’est à toi de choisir comment te '
        + 'défendre.');
    case 'attack':
      return t('À l’attaque !', `Ton Leader et tes Personnages redressés attaquent le Leader adverse ou un Personnage épuisé : `
        + `${touch ? 'glisse l’attaquant sur sa cible, ou touche-le' : 'glisse l’attaquant sur sa cible, ou clique dessus'}. `
        + 'Puissance égale ou plus forte : ça touche.');
    case 'giveDon':
      return t('Renforce tes attaques', 'Glisse une DON!! sur ton Leader ou un Personnage : +1000 de puissance pendant ton tour, '
        + 'de quoi passer les Contres de l’IA.');
    case 'counter':
      return t('Défends-toi : le Contre', 'Défausse une carte de ta main qui a un Contre (+1000 ou +2000, sur son côté gauche) '
        + 'pour renforcer la carte attaquée. Au début, laisser toucher ton Leader est souvent plus sage.');
    case 'blocker':
      return t('Le [Bloqueur]', 'Un [Bloqueur] peut s’épuiser pour prendre l’attaque à la place de la cible : il protège ton '
        + 'Leader, mais risque le KO.');
    case 'life':
      return t('Une Vie en moins, une carte en plus', 'Ton Leader touché, la carte du dessus de ta Vie va dans ta main. Touché '
        + 'sans Vie : c’est perdu. Pareil pour l’IA !');
    case 'trigger':
      return t('[Déclenchement]', 'Cette carte de Vie a un [Déclenchement] : active son effet gratuitement, ou prends-la en '
        + 'main.');
    case 'finish':
      return t('Le coup de grâce', 'L’IA n’a plus de Vie : encore une attaque qui touche son Leader, et c’est gagné !');
  }
}

// La leçon que la situation appelle, si elle n'a pas encore été vue (null : rien de nouveau à expliquer)
export function lessonFor(s: GameState, human: PlayerId, seen: ReadonlySet<LessonId>): LessonId | null {
  if (s.winner !== null) return null;
  const d = s.decision;
  const fresh = (id: LessonId) => (seen.has(id) ? null : id);
  if (!d) return null;
  if (d.player !== human) {
    // le tour de l'IA (après ta première fin de tour)
    return s.active !== human && seen.has('don') ? fresh('oppTurn') : null;
  }
  if (d.kind === 'mulligan') return fresh('welcome');
  if (d.tag === 'trigger') return fresh('trigger');
  if (d.kind === 'counter') return fresh('counter');
  if (d.kind === 'blocker') return fresh('blocker');
  const me = s.players[human];
  const startLife = def(me.leader.num).life ?? me.life.length;
  if (me.life.length < startLife && !seen.has('life')) return 'life';
  if (d.kind !== 'main') return null;
  const ids = d.options.map((o) => o.id);
  if (!seen.has('don')) return 'don';
  const opp = s.players[human === 0 ? 1 : 0];
  if (opp.life.length === 0 && has(ids, 'attack:')) return fresh('finish');
  if (has(ids, 'attack:')) return fresh('attack') ?? (has(ids, 'don:') ? fresh('giveDon') : null);
  // plus rien à jouer qu'un coup inutile ou la fin du tour
  if (!has(ids, 'play:') && !has(ids, 'event:') && !has(ids, 'act:')) return fresh('endTurn');
  return null;
}

// Une leçon affichée reste tant que sa situation dure (ou jusqu'à « Compris ») : la leçon du combat disparaît avec le
// combat, celle du tour de l'IA quand ton tour revient, celles de ta phase principale à la fin de ton tour
export function lessonStillFits(id: LessonId, s: GameState, human: PlayerId): boolean {
  if (s.winner !== null) return false;
  const d = s.decision;
  switch (id) {
    case 'welcome': return d?.kind === 'mulligan';
    case 'oppTurn': return s.active !== human;
    case 'counter': case 'blocker': return s.battle !== null;
    case 'trigger': return d?.tag === 'trigger' || s.battle !== null;
    case 'life': return true;
    default: return s.active === human;
  }
}

// Une leçon qui parle d'une décision urgente (main de départ, défense, [Déclenchement], tour de l'IA) passe devant
// celle qui est affichée ; les autres attendent qu'elle soit lue (« Compris ») ou qu'elle ne convienne plus
export function lessonPreempts(id: LessonId): boolean {
  return id === 'welcome' || id === 'counter' || id === 'blocker' || id === 'trigger' || id === 'oppTurn';
}

// La leçon à afficher après un nouvel état, à partir de celle qui est affichée (null : aucune) ; seen reçoit la leçon
// nouvellement montrée. La leçon affichée reste tant qu'elle convient ; une nouvelle attend son tour, sauf si elle
// est urgente.
export function nextShown(current: LessonId | null, s: GameState, human: PlayerId, seen: Set<LessonId>): LessonId | null {
  const fits = current !== null && lessonStillFits(current, s, human);
  const next = lessonFor(s, human, seen);
  if (next && (!fits || lessonPreempts(next))) {
    seen.add(next);
    return next;
  }
  return fits ? current : null;
}
