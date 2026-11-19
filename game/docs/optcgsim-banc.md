# Banc d'essai réel joy-boy ↔ OPTCGSim

Le banc (`scripts/optcgsim/banc.mjs`) rejoint une salle de **ton** jeu OPTCGSim 1.45b (version gelée : `handshake.json`) avec un deck joy-boy, joue à la
place du joueur et écrit un journal complet. Il sert aux essais réels (tâche O3.2) et à chaque correction du pont.
Il parle aux serveurs Unity (identification anonyme et Relay), comme le jeu : c'est toi qui le lances, jamais les tests.

## Lancer une partie

1. Dans OPTCGSim : crée une salle **privée** et note son code (il commence par `P`).
2. Dans un terminal, depuis un worktree de l'étape O (par exemple `ProjectTCGC\wt\O-0`, après
   `git pull --ff-only` sur `crossplay/etape-O`) ; `TCGC` seulement quand l'étape sera fusionnée dans `main` :

   ```
   node --no-warnings scripts/optcgsim/banc.mjs P<code>
   ```

3. Joue ta partie dans OPTCGSim. Le banc s'arrête seul à la fin de la partie (abandon, victoire, défaite), si le jeu
   quitte la salle, ou au bout de 60 minutes. **Ctrl+C** l'arrête plus tôt : il abandonne d'abord la partie pour ne
   pas te laisser bloqué.

Options :

| Option | Effet |
|---|---|
| `--deck ST-01` | deck joué : identifiant d'un deck joy-boy (par défaut `ST-01`), fichier `.deck` d'OPTCGSim ou `.json` joy-boy (`{ leader, cards }`) |
| `--nom JoyBoy-banc` | pseudo affiché dans OPTCGSim |
| `--pilote auto` | `ia` : l'IA de joy-boy joue (moteur + modules O2.1 à O2.3) ; `minimal` : garde sa main, pioche, prend ses DON, finit son tour, ne bloque pas, ne contre pas, refuse les déclencheurs ; `auto` (défaut) : `ia` (les modules sont livrés depuis la vague O2), et `minimal` prend la suite si l'IA rencontre une erreur ou des cartes que joy-boy ne connaît pas (c'est noté dans le bilan) |
| `--journal <dossier>` | où écrire le journal (refusé dans le dépôt) |
| `--minutes 60` | durée maximale |
| `--blocage 20` | pilote `ia` : si le chrono de joy-boy baisse de ce nombre de secondes sans que le banc envoie rien, il note la décision en attente dans le journal (ligne `>>> IA figée`) et, si c'est son tour, le finit |

## Lister les salles publiques (tâche O4.1)

Le repli de « Trouver un adversaire » (étape O4) rejoint une salle **publique Western** d'OPTCGSim (avec ou sans minuteur : décision du 19 nov., toutes les salles
publiques mesurées en avaient un ; le site affiche le chrono d'OPTCGSim). L'outil
`scripts/optcgsim/lister-salles.mjs` lit la liste de ces salles sur le service Lobby de Unity, comme l'écran des salles
publiques du jeu : **lecture seule**, il ne rejoint aucune salle et n'écrit rien chez Unity (une identification
anonyme, puis une lecture toutes les 5 s au plus). C'est toi qui le lances :

```
node --no-warnings scripts/optcgsim/lister-salles.mjs
node --no-warnings scripts/optcgsim/lister-salles.mjs --suivre 120
```

Il affiche, **sans pseudo, nom de salle ni code** : le nombre de fiches par version (et une alerte s'il en voit d'une
version plus récente que la version gelée : OPTCGSim a été mis à jour), le nombre par format pour la version gelée, puis
chaque salle de cette version (« salle 1 »…) : format, minuteur, Leader partagé, âge, dernière mise à jour, et si
joy-boy la viserait. Avec `--suivre <secondes>`, il relit la liste toutes les 5 s et donne en fin de suivi la durée de
vie des fiches disparues et si `lastUpdated` suit le signal de vie de l'hôte (toutes les 15 s). `--json <fichier>`
écrit les fiches anonymisées (ni nom, ni hôte, ni code, ni identifiant), hors du dépôt seulement.

Pour essayer de rejoindre **ta propre** salle publique avec le banc : crée dans OPTCGSim une salle publique Western
(avec ou sans minuteur), puis

```
node --no-warnings scripts/optcgsim/banc.mjs --publique Western --seulement "<ton pseudo OPTCGSim>"
```

`--publique <format>` remplace le code ; `--seulement` est obligatoire avec : seule une salle dont le nom contient ce
texte est visée, jamais celle d'un inconnu. Les autres options du banc restent valables.

## Le journal

Écrit dans `Bureau\optcgsim\journaux-banc\banc-<date>.log` (le chemin est affiché au début et à la fin). Il contient :
chaque lot échangé (octets complets et RPC décodées, au format du prototype), les décisions du pilote (lignes `>>>`),
l'état du miroir à chaque fin de tour, et une ligne `BILAN` : issue, pilote, lots, écarts du miroir, RPC non gérées,
cartes inconnues de joy-boy, et pour le pilote `ia` le nombre de décisions et de RPC envoyées. Les lignes `combat :`,
`inbound :` et `outbound :` des écarts disent quel module de la vague O2 n'a pas su traduire un coup.

Il contient aussi des pseudos et des identifiants Unity : **ne le mets jamais dans le dépôt tel quel**. Pour en faire une
fixture de test anonyme :

```
node scripts/optcgsim/anonymiser.mjs "<chemin du journal>"
```

En cas de problème, envoie le journal à Claude : il indique à quelle couche ça s'arrête.
