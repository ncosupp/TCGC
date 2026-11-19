// Salles publiques « normales » d'OPTCGSim (tâche O4.1 ; étude Plan-aventure/etudes/crossplay-partie-rapide.md, § 2 et 3).
//
// L'hôte d'une salle publique dépose une fiche sur le service Lobby de Unity (HostJoinScript.MakeALobby) : données
// `JoinCode` (code Relay sans préfixe), `Version` (S1), `Mode` (S2, le format), `CardData` (S3), `IsTimerLobby` (S4, si
// minuteur), `leader` (S5, facultatif). Le jeu les liste par `QueryLobbies` (30 fiches, `AvailableSlots > 0`) et les
// filtre lui-même (FindLobbies) ; rejoindre = `connect(<préfixe du format> + JoinCode)`, sans aucun autre appel Lobby.
// joy-boy fait pareil : il lit la liste, choisit, rejoint par le code. Il ne crée, ne modifie ni ne rejoint jamais une
// fiche (pas de JoinLobby, pas de signal de vie).
//
// - `queryLobbies(opts)` : la requête REST, rend les fiches brutes ;
// - `pickRooms(raw, opts)` : fonction pure, filtre et tri (testable sans réseau) ;
// - `listPublicRooms(opts)` : les deux ;
// - `LobbyScout` : l'éclaireur partagé du serveur (identité anonyme gardée, cache de 5 s, pause de 60 s sur 429).
//
// Le réseau est injectable (`fetch`) ; sous `node --test`, un vrai fetch est refusé (même garde-fou que transport.ts).

import { Buffer } from 'node:buffer';
import handshakeJson from './handshake.json' with { type: 'json' };
import { authenticate, UNITY, type FetchLike, type UnityConfig } from './transport.ts';
import type { PublicRoom } from './types.ts';

const HS = handshakeJson as { gameVersion: string; styles: Record<string, string>; unity: { lobbyUrl?: string } };

/** Adresse du service Lobby (handshake.json, `unity.lobbyUrl`). */
export const LOBBY_URL: string = HS.unity.lobbyUrl ?? 'https://lobby.services.api.unity.com/v1';
/** Version gelée du jeu (Décision 5) : seules ses salles sont jouables. */
export const FROZEN_VERSION: string = HS.gameVersion;
/** Valeur `CardData` des salles du jeu gelé (« 0 » en 1.45b ; plus grande = données de cartes que le client n'a pas). */
export const CARD_DATA = '0';
/** Formats retenus par défaut (décision de l'utilisateur du 19 nov. : Western seulement, sans minuteur). */
export const DEFAULT_STYLES = ['Western'];
/** Une fiche mise à jour depuis moins de ce délai passe devant les autres (3 signaux de vie de 15 s). */
export const FRESH_MS = 45000;

/** Format → préfixe du code de salle (`Western` → `W`), d'après `handshake.json`. */
export const STYLE_PREFIX: Record<string, string> = Object.fromEntries(Object.entries(HS.styles).map(([p, s]) => [s, p]));

const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT);
const NO_NETWORK = 'réseau réel interdit pendant les tests : injecte fetch (faux service Lobby)';

/** Une fiche telle que la renvoie le service Lobby (champs lus dans le SDK, Unity.Services.Lobbies.Models.Lobby). */
export interface RawLobby {
  id: string;
  name?: string;
  maxPlayers?: number;
  availableSlots?: number;
  isPrivate?: boolean;
  isLocked?: boolean;
  hasPassword?: boolean;
  data?: Record<string, { value?: string; visibility?: string; index?: string } | null> | null;
  hostId?: string;
  created?: string;
  lastUpdated?: string;
}

/** Erreur du service Lobby, avec son statut HTTP (429 = trop de requêtes). */
export class LobbyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = 'LobbyError'; this.status = status; }
}

export interface QueryOptions {
  fetch?: FetchLike;
  unity?: UnityConfig;
  lobbyUrl?: string;
  /** Jeton d'une identification anonyme ; sans lui, une nouvelle identité est créée pour cette lecture. */
  token?: string;
  /** Nombre de fiches demandées (30 comme le jeu ; 100 au plus chez Unity). */
  count?: number;
  /** Filtre `S1` (Version) côté Unity ; null = toutes les versions (l'outil de listage les compte). */
  version?: string | null;
  /** Filtre `S2` (Mode) côté Unity, pour un seul format ; null = tous les formats. */
  style?: string | null;
}

/** Le fetch à utiliser : celui donné, sinon le vrai ; sous `node --test`, refuse le vrai (garde-fou). */
export function network(f: FetchLike | undefined): FetchLike {
  if (underTest() && (!f || (f as unknown) === globalThis.fetch)) throw new Error(NO_NETWORK);
  return f ?? (globalThis.fetch as unknown as FetchLike);
}

/** Corps de la requête `POST /query` : `AvailableSlots > 0` comme le jeu, plus la version et le format si donnés. */
export function queryBody(o: Pick<QueryOptions, 'count' | 'version' | 'style'> = {}) {
  const filter: { field: string; op: string; value: string }[] = [{ field: 'AvailableSlots', op: 'GT', value: '0' }];
  const version = o.version === undefined ? FROZEN_VERSION : o.version;
  if (version) filter.push({ field: 'S1', op: 'EQ', value: version });
  if (o.style) filter.push({ field: 'S2', op: 'EQ', value: o.style });
  return { count: Math.max(1, Math.min(100, o.count ?? 30)), sampleResults: false, filter };
}

/** Lit la liste des fiches publiques (une requête, plus une identification anonyme si aucun jeton n'est donné). */
export async function queryLobbies(o: QueryOptions = {}): Promise<RawLobby[]> {
  const f = network(o.fetch);
  const token = o.token ?? (await authenticate(f, o.unity ?? UNITY)).idToken;
  const url = `${o.lobbyUrl ?? LOBBY_URL}/query`;
  const r = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(queryBody(o)),
  });
  const texte = await r.text();
  if (!r.ok) throw new LobbyError(r.status, `POST ${url} -> ${r.status} ${texte.slice(0, 300)}`);
  let json: { results?: RawLobby[] | null };
  try { json = JSON.parse(texte); } catch { throw new LobbyError(r.status, `réponse illisible du service Lobby : ${texte.slice(0, 100)}`); }
  return Array.isArray(json?.results) ? json.results : [];
}

export interface PickOptions {
  /** Formats permis (`Western` par défaut). */
  styles?: string[];
  /** Accepter les salles avec minuteur (non par défaut). */
  allowTimed?: boolean;
  /** Codes de salle ou identifiants de fiche à écarter (réservées par joy-boy, en quarantaine après un échec). */
  exclude?: Iterable<string>;
  /** Version exigée (la version gelée par défaut). */
  version?: string;
  /** Ne garder que les salles dont le nom contient ce texte (essais : sa propre salle ; jamais affiché). */
  only?: string;
  /** Maintenant (ms), pour savoir quelles fiches sont fraîches. */
  now?: number;
  /** Fraîcheur : `lastUpdated` plus récent que ce délai = la fiche passe devant (45 s). */
  freshMs?: number;
}

const value = (l: RawLobby, key: string): string | undefined => {
  const v = l.data?.[key]?.value;
  return typeof v === 'string' ? v : undefined;
};
const time = (iso: string | undefined) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; };

/** Lit une fiche en salle publique jouable, ou null (et la raison) si joy-boy ne peut pas la rejoindre. */
export function readRoom(l: RawLobby): { room: PublicRoom | null; reason?: string } {
  if (!l || typeof l.id !== 'string') return { room: null, reason: 'fiche sans identifiant' };
  if (l.isPrivate) return { room: null, reason: 'privée' };
  if (l.isLocked) return { room: null, reason: 'verrouillée' };
  if (l.hasPassword) return { room: null, reason: 'mot de passe' };
  if (typeof l.availableSlots === 'number' && l.availableSlots <= 0) return { room: null, reason: 'pleine' };
  const version = value(l, 'Version'), style = value(l, 'Mode'), cardData = value(l, 'CardData');
  const joinCode = value(l, 'JoinCode')?.trim().toUpperCase();
  if (!version) return { room: null, reason: 'sans version' };
  if (cardData === undefined) return { room: null, reason: 'sans CardData' };
  if (!style || !STYLE_PREFIX[style] || style === 'Private') return { room: null, reason: 'format inconnu' };
  if (!joinCode || !/^[A-Z0-9]{4,12}$/.test(joinCode)) return { room: null, reason: 'sans code Relay' };
  const leader = value(l, 'leader')?.trim() || null;
  return {
    room: {
      lobbyId: l.id, code: STYLE_PREFIX[style] + joinCode, style, version, cardData,
      timed: (value(l, 'IsTimerLobby') ?? '').toLowerCase() === 'true', leader,
      created: l.created ?? '', lastUpdated: l.lastUpdated ?? l.created ?? '',
    },
  };
}

/**
 * Filtre et trie les fiches (fonction pure, § 3 de l'étude) : version gelée, format permis, `CardData` du jeu gelé,
 * sans minuteur (sauf `allowTimed`), non privée ni verrouillée, avec un code Relay, hors exclusions ; les fiches
 * fraîches d'abord, puis la plus ancienne (l'hôte qui attend depuis le plus longtemps).
 */
export function pickRooms(raw: readonly RawLobby[], o: PickOptions = {}): PublicRoom[] {
  const styles = new Set(o.styles ?? DEFAULT_STYLES);
  const version = o.version ?? FROZEN_VERSION;
  const exclude = new Set(o.exclude ?? []);
  const only = o.only?.trim().toLowerCase();
  const now = o.now ?? Date.now(), fresh = o.freshMs ?? FRESH_MS;
  const seen = new Set<string>();
  const rooms: PublicRoom[] = [];
  for (const l of raw) {
    const { room } = readRoom(l);
    if (!room) continue;
    if (room.version !== version || room.cardData !== CARD_DATA || !styles.has(room.style)) continue;
    if (room.timed && !o.allowTimed) continue;
    if (exclude.has(room.code) || exclude.has(room.lobbyId) || seen.has(room.code)) continue;
    if (only && !(l.name ?? '').toLowerCase().includes(only)) continue;
    seen.add(room.code);
    rooms.push(room);
  }
  const isFresh = (r: PublicRoom) => now - time(r.lastUpdated) < fresh;
  return rooms.sort((a, b) => Number(isFresh(b)) - Number(isFresh(a)) || time(a.created) - time(b.created));
}

/** Lit la liste et rend les salles jouables, triées (une identité anonyme neuve si aucun jeton n'est donné). */
export async function listPublicRooms(o: QueryOptions & PickOptions = {}): Promise<PublicRoom[]> {
  const styles = o.styles ?? DEFAULT_STYLES;
  const raw = await queryLobbies({ ...o, version: o.version ?? FROZEN_VERSION, style: styles.length === 1 ? styles[0] : null });
  return pickRooms(raw, o);
}

/** Date d'expiration (ms) d'un jeton JWT, ou null s'il ne se lit pas. */
export function tokenExpiry(token: string): number | null {
  try {
    const exp = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch { return null; }
}

export interface ScoutOptions {
  fetch?: FetchLike;
  unity?: UnityConfig;
  lobbyUrl?: string;
  /** Horloge (ms), simulée dans les tests. */
  now?: () => number;
  /** Une seule lecture de la liste dans ce délai, pour tout le serveur (5 s). */
  cacheMs?: number;
  /** Pause après une erreur 429 (60 s). */
  pauseMs?: number;
  /** Durée de vie supposée du jeton s'il ne dit pas son expiration (50 min ; Unity : 1 h). */
  tokenMs?: number;
  count?: number;
  /** Formats lus (filtre `S2` côté Unity s'il n'y en a qu'un). */
  styles?: string[];
  log?: (line: string) => void;
}

/**
 * L'éclaireur du serveur : une identité anonyme gardée (renouvelée avant expiration ou sur 401), une seule lecture
 * toutes les 5 s quel que soit le nombre de demandes (les demandes simultanées partagent la même), et une pause de 60 s
 * après une erreur 429. `rooms()` ne lève jamais : en pause ou en panne, il rend une liste vide, et `state()` dit
 * pourquoi.
 */
export class LobbyScout {
  private readonly o: ScoutOptions;
  private readonly now: () => number;
  private token: { value: string; until: number } | null = null;
  private cache: { at: number; raw: RawLobby[] } | null = null;
  private inflight: Promise<RawLobby[]> | null = null;
  private pausedUntil = 0;
  private lastError: string | null = null;
  /** Compteurs (diagnostic, tests) : identifications, lectures, erreurs 429. */
  readonly stats = { auth: 0, queries: 0, tooMany: 0, errors: 0 };

  constructor(o: ScoutOptions = {}) {
    this.o = o;
    this.now = o.now ?? Date.now;
  }

  private async idToken(f: FetchLike): Promise<string> {
    if (this.token && this.now() < this.token.until) return this.token.value;
    const { idToken } = await authenticate(f, this.o.unity ?? UNITY);
    this.stats.auth++;
    // Renouvelé une minute avant son expiration (lue dans le jeton) ou au bout de `tokenMs`.
    const exp = tokenExpiry(idToken);
    const until = exp !== null ? exp - 60000 : this.now() + (this.o.tokenMs ?? 50 * 60000);
    this.token = { value: idToken, until };
    return idToken;
  }

  private async read(): Promise<RawLobby[]> {
    const f = network(this.o.fetch);
    const styles = this.o.styles ?? DEFAULT_STYLES;
    const q = (token: string) => {
      this.stats.queries++;
      return queryLobbies({ fetch: f, lobbyUrl: this.o.lobbyUrl, token, count: this.o.count, version: FROZEN_VERSION,
        style: styles.length === 1 ? styles[0] : null });
    };
    try {
      return await q(await this.idToken(f));
    } catch (e) {
      if (!(e instanceof LobbyError) || e.status !== 401) throw e;
      this.token = null; // jeton refusé : nouvelle identité, un seul nouvel essai
      return q(await this.idToken(f));
    }
  }

  /** Fiches brutes (lecture partagée, cache, pause sur 429). */
  async raw(): Promise<RawLobby[]> {
    const t = this.now();
    const cacheMs = this.o.cacheMs ?? 5000;
    if (this.cache && t - this.cache.at < cacheMs) return this.cache.raw;
    if (t < this.pausedUntil) return [];
    if (!this.inflight) {
      this.inflight = this.read().then((raw) => {
        this.cache = { at: this.now(), raw }; this.lastError = null; return raw;
      }, (e: unknown) => {
        const status = e instanceof LobbyError ? e.status : 0;
        this.lastError = e instanceof Error ? e.message : String(e);
        if (status === 429) {
          this.stats.tooMany++;
          this.pausedUntil = this.now() + (this.o.pauseMs ?? 60000);
          this.o.log?.(`Lobby : trop de requêtes (429), pause de ${Math.round((this.o.pauseMs ?? 60000) / 1000)} s`);
        } else {
          this.stats.errors++;
          this.o.log?.(`Lobby : lecture impossible (${this.lastError})`);
        }
        return [] as RawLobby[];
      }).finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  /** Salles jouables, triées (voir `pickRooms`). */
  async rooms(o: PickOptions = {}): Promise<PublicRoom[]> {
    const raw = await this.raw();
    return pickRooms(raw, { styles: this.o.styles, ...o, now: o.now ?? this.now() });
  }

  /** En pause (429) jusqu'à quand, dernière erreur. */
  state(): { pausedUntil: number | null; lastError: string | null } {
    return { pausedUntil: this.now() < this.pausedUntil ? this.pausedUntil : null, lastError: this.lastError };
  }
}
