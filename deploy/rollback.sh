#!/usr/bin/env bash
# Retour arrière de TCGC au commit d'avant la dernière mise à jour (noté par update.sh dans data/commit-precedent),
# ou à un commit donné : sudo bash /opt/tcgc/app/deploy/rollback.sh [commit]
# Avec RESTAURER_BASE=1, remet aussi la base à la sauvegarde la plus récente (faite par update.sh juste avant la mise
# à jour) : ce qui a été fait par les joueurs depuis est perdu, à ne faire que si la base a été abîmée.
set -euo pipefail
export PATH=/opt/tcgc/node/bin:$PATH
run() { sudo -H -u tcgc env PATH="$PATH" "$@"; }
cd /opt/tcgc/app

target=${1:-$(cat data/commit-precedent 2>/dev/null || true)}
if [ -z "$target" ]; then echo "Aucun commit précédent noté : donne-le en argument (git log --oneline)."; exit 1; fi
echo "Retour à $(run git log -1 --format='%h %s' "$target")"

if [ "${RESTAURER_BASE:-0}" = 1 ]; then
  latest=$(ls -1t data/backups/tcgc-*.db | head -n 1)
  echo "Restauration de la base depuis $latest"
  systemctl stop tcgc
  run node --no-warnings=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite");
    const r = new DatabaseSync(process.argv[1], { readOnly: true }).prepare("PRAGMA integrity_check").get();
    if (Object.values(r)[0] !== "ok") { console.error("sauvegarde abîmée"); process.exit(1); }' "$latest"
  run cp data/tcgc.db "data/tcgc-avant-restauration-$(date +%Y%m%d-%H%M).db"
  run rm -f data/tcgc.db-wal data/tcgc.db-shm
  run cp "$latest" data/tcgc.db
fi

run git reset --hard --quiet "$target"
run npm ci --no-audit --no-fund
run npm run build
systemctl restart tcgc
sleep 5
systemctl --no-pager status tcgc | head -5
