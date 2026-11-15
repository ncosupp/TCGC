// Rechargement de la page après une mise en ligne. Le build efface les anciens morceaux (emptyOutDir) : un onglet resté
// ouvert sur l'ancienne version ne peut plus charger un écran qu'il n'avait pas encore visité. On recharge alors la
// page une fois pour prendre la nouvelle version ; la garde (sessionStorage) empêche une boucle si le morceau manque
// toujours après le rechargement (serveur en panne, réseau coupé) : la limite d'erreur affiche alors son message.
const KEY = 'tcgc.reloadedAt';
const GUARD_MS = 60_000;

// Recharge la page si elle ne l'a pas déjà été pour cette raison il y a moins d'une minute ; vrai si elle recharge
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // stockage indisponible (navigation privée stricte) : sans garde, on ne recharge pas tout seul
    return false;
  }
  window.location.reload();
  return true;
}

// Erreur de chargement d'un morceau de l'appli (import() à la demande), selon les navigateurs
export function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|Failed to fetch/i.test(message);
}
