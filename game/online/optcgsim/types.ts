// Types partagés de l'étape O (parties croisées avec OPTCGSim). Contrat de la tâche O0 : on les complète seulement
// par des champs facultatifs. Voir Plan-aventure/etape-O-crossplay-optcgsim.md, § Contrats.

/** 0 = hôte OPTCGSim, 1 = joy-boy (toujours celui qui rejoint). */
export type Seat = 0 | 1;

/** Une RPC d'OPTCGSim décodée : nom, objet et comportement réseau, valeurs nommées d'après le catalogue. */
export interface Rpc { name: string; object: number; behaviour: number; values: Record<string, unknown> }

export type Zone = 'deck' | 'hand' | 'life' | 'deploy' | 'stage' | 'leader' | 'trash' | 'donDeck' | 'donCost';

export interface MirrorCard { code: string; uid?: number; rested?: boolean; attachedDon?: number; faceUp?: boolean }
export interface MirrorPlayer { name: string; leader: MirrorCard; zones: Record<Zone, MirrorCard[]> }
export interface MirrorState { players: [MirrorPlayer, MirrorPlayer]; turnPlayer: Seat; actingPlayer: Seat; turn: number }

/** Mutation externe : appliquée au moteur sans contrôle des règles (le jeu OPTCGSim fait foi). */
export type External =
  | { kind: 'move'; player: Seat; from: Zone; index: number; to: Zone; at?: number; rested?: boolean }
  | { kind: 'rest' | 'activate'; player: Seat; zone: Zone; index: number }
  | { kind: 'attachDon'; player: Seat; target: number /* -1 = leader */; donIndex: number; rested?: boolean }
  // retrait d'une DON attachée (DetachDonFromCard, ReturnDonFromCard…) : vers la zone de coût (épuisée par défaut) ou le
  // deck DON (ajout du chef de la vague O1, compatible)
  | { kind: 'detachDon'; player: Seat; target: number /* -1 = leader */; donIndex: number; to: 'donCost' | 'donDeck'; rested?: boolean }
  | { kind: 'power' | 'cost'; player: Seat; target: number; delta: number; until: 'turn' | 'battle' | 'ownersEnd' }
  | { kind: 'shuffle'; player: Seat; order: number[] }
  | { kind: 'turn'; to: Seat };

/**
 * Salle publique « normale » d'OPTCGSim, lue sur le service Lobby de Unity (tâche O4.1, `lobbies.ts`). Ni nom de salle
 * ni pseudo de l'hôte : texte libre, jamais affiché côté joy-boy.
 */
export interface PublicRoom {
  /** Identifiant de la fiche Lobby (sert aux exclusions et à la mesure de durée de vie, jamais montré au joueur). */
  lobbyId: string;
  /** Code à passer à `connect` : préfixe du format (`W` pour Western, `handshake.json`) + JoinCode de la fiche. */
  code: string;
  /** Format de la salle (`Western`, `Eastern`…), donnée `Mode` de la fiche. */
  style: string;
  version: string;
  cardData: string;
  /** Partie avec pendule (`IsTimerLobby`). */
  timed: boolean;
  /** Leader partagé par l'hôte (code de carte), sinon null. */
  leader: string | null;
  /** Dates ISO de la fiche (création, dernière mise à jour). */
  created: string;
  lastUpdated: string;
}
