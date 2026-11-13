// Panneau d'administration : appels au serveur (server/admin.js)
import { json, request } from '../../api';

export interface AdminOverview {
  members: number; guests: number; admins: number; disabled: number;
  newMembers7: number; newMembers30: number; active1: number; active7: number;
  copies: number; games: number; games7: number; online: number;
  berry: number; boostersWaiting: number; boostersOpened: number;
  mail: boolean;
  sets: { set: string; boostersPerDisplay: number }[];
}

export interface AdminUserRow {
  id: number; pseudo: string; email: string; guest: boolean; admin: boolean;
  disabledAt: string | null; createdAt: string; lastSeenAt: string | null;
  balance: number; copies: number; games: number;
}

export interface AdminLogEntry {
  id: number; at: string; action: string; admin: string; adminId: number;
  target: string | null; targetId: number | null; detail: Record<string, unknown>;
  // journal général : le compte visé existe encore (lien vers sa fiche)
  live?: boolean;
}

export interface AdminUser {
  id: number; pseudo: string; email: string; guest: boolean; admin: boolean;
  disabledAt: string | null; createdAt: string; lastSeenAt: string | null;
  sessions: number; lastLogin: string | null;
  collection: { cards: number; copies: number; wishes: number; hunts: number; shared: boolean; trades: boolean; devices: number };
  game: { games: number; won: number; lost: number; online: number; decks: number; chapters: number; hold: number };
  balance: number;
  boosters: { set: string; waiting: number; opened: number }[];
  ledger: { id: number; amount: number; reason: string; at: string; label: string; boosters?: number }[];
  log: AdminLogEntry[];
}

export type UserFilter = 'members' | 'guests' | 'admins' | 'disabled' | 'all';
export type UserSort = 'recent' | 'seen' | 'pseudo' | 'berry' | 'cards';

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

// identifiant d'opération : un double envoi (double clic, réseau) ne donne qu'une fois
export const opId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');

export const adminApi = {
  overview: () => request<AdminOverview>('api/admin/overview'),
  users: (p: { q?: string; filter?: UserFilter; sort?: UserSort; page?: number }) =>
    request<{ total: number; page: number; pageSize: number; users: AdminUserRow[] }>(`api/admin/users?${qs(p)}`),
  user: (id: number) => request<AdminUser>(`api/admin/users/${id}`),
  edit: (id: number, changes: { pseudo?: string; email?: string }) => request<AdminUser>(`api/admin/users/${id}`, json('PATCH', changes)),
  tempPassword: (id: number) => request<{ password: string }>(`api/admin/users/${id}/password`, json('POST', { mode: 'temp' })),
  mailReset: (id: number) => request<{ email: string }>(`api/admin/users/${id}/password`, json('POST', { mode: 'mail' })),
  logout: (id: number) => request<{ sessions: number }>(`api/admin/users/${id}/logout`, json('POST', {})),
  berry: (id: number, amount: number, note: string, op: string) =>
    request<AdminUser>(`api/admin/users/${id}/berry`, json('POST', { amount, note, opId: op })),
  boosters: (id: number, set: string, kind: 'booster' | 'display', count: number, note: string, op: string) =>
    request<AdminUser>(`api/admin/users/${id}/boosters`, json('POST', { set, kind, count, note, opId: op })),
  removeBoosters: (id: number, set: string, count: number) =>
    request<AdminUser & { removed: number }>(`api/admin/users/${id}/boosters/remove`, json('POST', { set, count })),
  disable: (id: number, disabled: boolean) => request<AdminUser>(`api/admin/users/${id}/disable`, json('POST', { disabled })),
  setAdmin: (id: number, admin: boolean) => request<AdminUser>(`api/admin/users/${id}/admin`, json('POST', { admin })),
  remove: (id: number, confirm: string) => request<{ ok: boolean }>(`api/admin/users/${id}`, json('DELETE', { confirm })),
  log: (before?: number) => request<{ entries: AdminLogEntry[]; next?: number }>(`api/admin/log${before ? `?before=${before}` : ''}`),
};
