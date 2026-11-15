// Panneaux du bas ouverts (Sheet du kit) : une pile, pour le Retour du navigateur et le clavier.
// - Retour (ou bouton Retour d'Android) : un panneau ouvert ajoute une entrée d'historique à la même adresse
//   (pushState, sans changer le #) ; le Retour la retire et ferme le panneau, sans changer la page derrière. Fermé
//   autrement (bouton, voile, Échap, geste), le panneau retire lui-même son entrée (history.back), si elle est encore
//   celle du dessus : un lien suivi depuis le panneau a ajouté la sienne par-dessus, on la laisse alors.
// - Clavier : seul le panneau du dessus répond à Échap et garde le focus.
// La navigation par # (routes.ts) n'est pas touchée : un retour arrière qui ne change que l'état (même adresse) ne
// déclenche pas hashchange.

interface Layer { id: string; onBack: () => void }

const KEY = 'caleSheet';
let stack: Layer[] = [];
let seq = 0;
// retours en arrière demandés par un panneau qui se ferme : le popstate qui suit ne ferme rien
let ownBacks = 0;

const stateLayer = (): string | undefined => {
  const state = window.history.state as Record<string, unknown> | null;
  return typeof state?.[KEY] === 'string' ? (state[KEY] as string) : undefined;
};

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ownBacks > 0) {
      ownBacks--;
      return;
    }
    // l'entrée retrouvée est celle d'un panneau encore ouvert : on ferme ceux du dessus ; sinon (entrée d'une page, ou
    // d'un panneau d'avant un rechargement), tous
    const at = stack.findIndex((l) => l.id === stateLayer());
    const closed = stack.slice(at + 1).reverse();
    stack = stack.slice(0, at + 1);
    for (const l of closed) l.onBack();
  });
}

export function pushSheet(onBack: () => void): string {
  // identifiant unique même d'un chargement de page à l'autre (une entrée rechargée ne doit pas passer pour la nôtre)
  const id = `${Date.now().toString(36)}-${++seq}`;
  const state = (window.history.state as Record<string, unknown> | null) ?? {};
  window.history.pushState({ ...state, [KEY]: id }, '');
  stack.push({ id, onBack });
  return id;
}

export function popSheet(id: string) {
  const at = stack.findIndex((l) => l.id === id);
  if (at < 0) return;   // déjà fermé par le Retour
  stack.splice(at, 1);
  if (stateLayer() === id) {
    ownBacks++;
    window.history.back();
  }
}

// Lien suivi depuis le panneau (fiche carte › classeur du set...) : la nouvelle adresse remplace l'entrée du panneau,
// le Retour ramène alors à la page d'avant le panneau. Faux si l'entrée du panneau n'est plus celle du dessus.
export function leaveSheet(id: string, hash: string): boolean {
  const at = stack.findIndex((l) => l.id === id);
  if (at < 0 || stateLayer() !== id) return false;
  stack.splice(at, 1);
  window.location.replace(hash);
  return true;
}

export function isTopSheet(id: string) {
  return stack.length > 0 && stack[stack.length - 1].id === id;
}
