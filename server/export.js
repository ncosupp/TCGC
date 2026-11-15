// Export de toutes les données d'un compte (RGPD, droit d'accès et portabilité ; audit du 14 nov. 2026, P2-9), en JSON :
// profil, collection, recherches, chasses, lien de partage, historique de valeur, notifications, et le jeu (decks,
// parties, aventure, Cale, boosters, Berry). Les secrets ne sortent pas : ni mot de passe haché, ni jetons de session,
// ni clés des abonnements aux notifications.
//   GET /api/export.json
import { db } from './db.js';

const json = (text, fallback = null) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const all = (sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));

export function exportAccount(userId, now = new Date()) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  return {
    format: 1,
    exportedAt: now.toISOString(),
    profil: {
      id: u.id, pseudo: u.guest ? null : u.pseudo, email: u.guest ? null : u.email, compteEssai: Boolean(u.guest),
      creeLe: u.created_at, adresseConfirmeeLe: u.email_verified_at ?? null, derniereVisite: u.last_seen_at ?? null,
      sourceDesPrix: u.price_source, exemplairesGardes: u.keep_copies, notifications: json(u.notify_prefs ?? '{}', {}),
      echanges: { participe: Boolean(u.trade_enabled), contact: u.trade_contact ?? null, region: u.trade_region ?? null },
    },
    collection: all(`SELECT c.product_id AS id, c.number AS numero, c.name AS nom, c.variant AS version, s.code AS extension,
      col.lang AS langue, col.quantity AS quantite, col.added_at AS ajouteeLe, col.updated_at AS modifieeLe
      FROM collection col JOIN cards c ON c.product_id = col.product_id LEFT JOIN sets s ON s.group_id = c.group_id
      WHERE col.user_id = ? ORDER BY c.number, c.product_id, col.lang`, userId),
    recherches: all(`SELECT c.product_id AS id, c.number AS numero, c.name AS nom, c.variant AS version, w.lang AS langue,
      w.target_eur AS prixCibleEur, w.added_at AS ajouteeLe
      FROM wishlist w JOIN cards c ON c.product_id = w.product_id WHERE w.user_id = ? ORDER BY c.number`, userId),
    chasses: all('SELECT id, rarity AS rarete, kind AS version, color AS couleur, created_at AS creeeLe FROM hunts WHERE user_id = ?', userId),
    partage: db.prepare(`SELECT token AS jeton, scope AS contenu, show_prices AS prix, show_wishlist AS recherches, created_at AS creeLe
      FROM shares WHERE user_id = ?`).get(userId) ?? null,
    historiqueDeValeur: all(`SELECT date, value_eur AS valeurTcgplayerEur, value_cm AS valeurCardmarketEur, value_tcg AS valeurTcg,
      cards AS cartes FROM value_history WHERE user_id = ? ORDER BY date`, userId),
    appareilsNotifies: all('SELECT lang AS langue, created_at AS abonneLe FROM push_subscriptions WHERE user_id = ?', userId),
    sessions: all('SELECT created_at AS ouverteLe, expires_at AS expireLe FROM sessions WHERE user_id = ? ORDER BY created_at', userId),
    jeu: {
      decks: all('SELECT id, name AS nom, leader, cards AS cartes, mode, looks AS visuels, created_at AS creeLe, updated_at AS modifieLe FROM game_decks WHERE user_id = ?', userId)
        .map((d) => ({ ...d, cartes: json(d.cartes, {}), visuels: json(d.visuels, {}) })),
      // résumé de chaque partie (decks, niveau, résultat, statistiques) ; la partie complète se télécharge depuis
      // « Mes parties »
      parties: all('SELECT summary FROM game_records WHERE user_id = ? ORDER BY started_at', userId).map((r) => json(r.summary)),
      partiesEnLigne: all(`SELECT id, status AS statut, created_at AS creeeLe, updated_at AS modifieeLe,
        CASE WHEN host_id = ? THEN 'hote' ELSE 'invite' END AS role FROM game_matches WHERE host_id = ? OR guest_id = ?`, userId, userId, userId),
      aventure: {
        arcs: all('SELECT arc, started_at AS commenceLe, deck_id AS deck FROM game_adventure WHERE user_id = ?', userId),
        chapitres: all('SELECT chapter AS chapitre, wins AS victoires, first_win_at AS premiereVictoire FROM game_progress WHERE user_id = ?', userId),
      },
      cale: all('SELECT number AS numero, variant AS version, count AS nombre FROM game_inventory WHERE user_id = ? ORDER BY number', userId),
      boosters: all('SELECT set_code AS extension, source, created_at AS gagneLe, opened_at AS ouvertLe, content AS contenu FROM game_boosters WHERE user_id = ?', userId)
        .map((b) => ({ ...b, contenu: json(b.contenu) })),
      berry: {
        porteMonnaie: db.prepare('SELECT balance AS solde, updated_at AS modifieLe FROM game_wallet WHERE user_id = ?').get(userId) ?? null,
        journal: all('SELECT amount AS montant, reason AS raison, ref AS reference, at AS le, detail FROM game_ledger WHERE user_id = ? ORDER BY id', userId)
          .map((l) => ({ ...l, detail: json(l.detail, {}) })),
      },
    },
  };
}
