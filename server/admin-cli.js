// Donner ou retirer le rôle d'administrateur (panneau Réglages › Administration), en ligne de commande, sur la machine
// qui héberge la base. Ensuite, un administrateur peut nommer les autres depuis le panneau.
//   npm run admin -- <pseudo ou e-mail>            donner le rôle
//   npm run admin -- --retirer <pseudo ou e-mail>  retirer le rôle
//   npm run admin -- --liste                       lister les administrateurs
// (TCGC_DB=<chemin> pour viser une autre base, comme le serveur)
import { db } from './db.js';

const args = process.argv.slice(2);
const list = () => db.prepare('SELECT id, pseudo FROM users WHERE admin = 1 ORDER BY id').all();

if (args[0] === '--liste' || !args.length) {
  const admins = list();
  console.log(admins.length ? `Administrateurs : ${admins.map((a) => `${a.pseudo} (n° ${a.id})`).join(', ')}` : 'Aucun administrateur.');
  if (!args.length) console.log('Usage : npm run admin -- <pseudo ou e-mail>   |   --retirer <pseudo ou e-mail>   |   --liste');
  process.exit(0);
}

const revoke = args[0] === '--retirer';
const who = (revoke ? args[1] : args[0])?.trim();
if (!who) {
  console.error('Indique le pseudo ou l’e-mail du compte.');
  process.exit(1);
}
const user = db.prepare('SELECT * FROM users WHERE pseudo = ? OR email = ?').get(who, who.toLowerCase());
if (!user) {
  console.error(`Aucun compte « ${who} ».`);
  process.exit(1);
}
if (!revoke && user.guest) {
  console.error('C’est un compte d’essai : crée d’abord un vrai compte.');
  process.exit(1);
}
db.prepare('UPDATE users SET admin = ? WHERE id = ?').run(revoke ? 0 : 1, user.id);
db.prepare(`INSERT INTO admin_log (admin_id, admin_pseudo, target_id, target_pseudo, action, detail, at)
  VALUES (0, '(ligne de commande)', ?, ?, ?, '{}', ?)`).run(user.id, user.pseudo, revoke ? 'admin-revoke' : 'admin-grant', new Date().toISOString());
console.log(`${user.pseudo} (n° ${user.id}) ${revoke ? 'n’est plus' : 'est maintenant'} administrateur.`);
console.log(`Administrateurs : ${list().map((a) => a.pseudo).join(', ') || 'aucun'}`);
