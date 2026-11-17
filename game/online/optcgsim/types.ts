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
  | { kind: 'power' | 'cost'; player: Seat; target: number; delta: number; until: 'turn' | 'battle' | 'ownersEnd' }
  | { kind: 'shuffle'; player: Seat; order: number[] }
  | { kind: 'turn'; to: Seat };
