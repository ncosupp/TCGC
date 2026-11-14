// Sauvegarde de la base (comptes et collections) : `npm run backup`, à lancer chaque jour (cron).
// Copie cohérente même pendant que l'appli tourne ; garde les KEEP dernières sauvegardes.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { DatabaseSync } from 'node:sqlite';
import { db } from './db.js';

const KEEP = Number(process.env.BACKUP_KEEP ?? 14);
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });

const file = path.join(dir, `tcgc-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.db`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

// La copie doit être lisible et intacte : sinon on s'arrête (code de sortie 1, update.sh ne met pas en ligne)
const copy = new DatabaseSync(file, { readOnly: true });
const check = Object.values(copy.prepare('PRAGMA integrity_check').get())[0];
const users = copy.prepare('SELECT COUNT(*) AS n FROM users').get().n;
copy.close();
if (check !== 'ok') {
  fs.renameSync(file, `${file}.abimee`);
  console.error(`Sauvegarde ABÎMÉE (${check}) : ${file}.abimee`);
  process.exit(1);
}
console.log(`Sauvegarde : ${file} (intacte, ${users} compte(s))`);

const old = fs.readdirSync(dir).filter((f) => /^tcgc-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) fs.rmSync(path.join(dir, f));
if (old.length) console.log(`${old.length} ancienne(s) sauvegarde(s) supprimée(s)`);
