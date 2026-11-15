#!/usr/bin/env bash
# Met à jour TCGC depuis GitHub et redémarre le service : sudo bash /opt/tcgc/app/deploy/update.sh
# - sauvegarde la base avant (et vérifie la sauvegarde) ;
# - refuse un commit dont la vérification GitHub (types, tests, build : .github/workflows/ci.yml) n'est pas réussie
#   (FORCE=1 pour passer outre : sudo FORCE=1 bash ...) ;
# - après le redémarrage, contrôle que l'appli répond (/api/sante) ; sinon revient au commit précédent.
# Retour arrière à la main : sudo bash /opt/tcgc/app/deploy/rollback.sh
set -euo pipefail
export PATH=/opt/tcgc/node/bin:$PATH
run() { sudo -H -u tcgc env PATH="$PATH" "$@"; }
REPO=ncosupp/TCGC
PORT=${PORT:-3001}
cd /opt/tcgc/app

previous=$(run git rev-parse HEAD)
run git fetch --quiet origin main
target=$(run git rev-parse origin/main)
if [ "$previous" = "$target" ]; then
  echo "Déjà à jour ($(run git log -1 --format='%h %s'))."
  exit 0
fi

# Vérification GitHub du commit visé (API publique, sans jeton)
if [ "${FORCE:-0}" != 1 ]; then
  verdict=$(curl -fsS --max-time 20 "https://api.github.com/repos/$REPO/commits/$target/check-runs?check_name=Types,%20tests%20et%20build" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).check_runs??[];const c=r[0];console.log(!c?"absente":c.status!=="completed"?"en cours":c.conclusion)})' \
    || echo "injoignable")
  if [ "$verdict" != success ]; then
    echo "Mise en ligne refusée : la vérification GitHub de ${target:0:7} est « $verdict »."
    echo "Attends qu'elle soit réussie (onglet Actions du dépôt), ou force : sudo FORCE=1 bash $0"
    exit 1
  fi
  echo "Vérification GitHub de ${target:0:7} : réussie."
fi

run npm run backup
run git merge --ff-only --quiet "$target"
echo "${previous}" | run tee data/commit-precedent >/dev/null
run npm ci --no-audit --no-fund
run npm run build
systemctl restart tcgc

# Contrôle de santé : jusqu'à 60 s pour démarrer (migrations comprises)
for _ in $(seq 1 30); do
  sleep 2
  if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/sante" >/dev/null 2>&1; then
    systemctl --no-pager status tcgc | head -3
    echo "En ligne : $(run git log -1 --format='%h %s')"
    exit 0
  fi
done

echo "ERREUR : l'appli ne répond pas après la mise à jour. Retour au commit précédent ${previous:0:7}..."
journalctl -u tcgc -n 30 --no-pager || true
run git reset --hard --quiet "$previous"
run npm ci --no-audit --no-fund
run npm run build
systemctl restart tcgc
echo "Revenu à ${previous:0:7}. Si le schéma de la base a changé entre-temps, la sauvegarde d'avant est la plus récente"
echo "de /opt/tcgc/app/data/backups (restauration : voir deploy/rollback.sh)."
exit 1
