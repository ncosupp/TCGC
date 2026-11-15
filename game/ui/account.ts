// Le compte qui joue, tel que l'appli le passe au jeu (GameApp) : un essai sans compte (invité) voit l'invitation à
// garder sa progression (accueil, fin de partie), jamais une fenêtre qui bloque.
let guest = false;

export function setGuestAccount(on: boolean) {
  guest = on;
}

export const isGuestAccount = () => guest;

// L'invitation se ferme d'un appui et revient au plus une fois par jour
const KEY = 'tcgc.game.account-nudge';

export function nudgeDismissedToday(now = new Date()): boolean {
  try {
    return localStorage.getItem(KEY) === now.toDateString();
  } catch {
    return false;
  }
}

export function dismissNudge(now = new Date()) {
  try {
    localStorage.setItem(KEY, now.toDateString());
  } catch {
    // stockage indisponible : l'invitation revient au prochain affichage
  }
}
