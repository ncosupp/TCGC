# Banc d'essai réel joy-boy ↔ OPTCGSim

Le banc (`scripts/optcgsim/banc.mjs`) rejoint une salle de **ton** jeu OPTCGSim 1.45a avec un deck joy-boy, joue à la
place du joueur et écrit un journal complet. Il sert aux essais réels (tâche O3.2) et à chaque correction du pont.
Il parle aux serveurs Unity (identification anonyme et Relay), comme le jeu : c'est toi qui le lances, jamais les tests.

## Lancer une partie

1. Dans OPTCGSim : crée une salle **privée** et note son code (il commence par `P`).
2. Dans un terminal, depuis le dossier du dépôt (un worktree ou `TCGC` une fois fusionné) :

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
| `--pilote auto` | `ia` : l'IA de joy-boy joue (moteur + modules O2.1 à O2.3) ; `minimal` : garde sa main, pioche, prend ses DON, finit son tour, ne bloque pas, ne contre pas, refuse les déclencheurs ; `auto` (défaut) : `ia` dès que les modules sont livrés, sinon `minimal` |
| `--journal <dossier>` | où écrire le journal (refusé dans le dépôt) |
| `--minutes 60` | durée maximale |

## Le journal

Écrit dans `Bureau\optcgsim\journaux-banc\banc-<date>.log` (le chemin est affiché au début et à la fin). Il contient :
chaque lot échangé (octets complets et RPC décodées, au format du prototype), les décisions du pilote (lignes `>>>`),
l'état du miroir à chaque fin de tour, et une ligne `BILAN` : issue, pilote, lots, écarts du miroir, RPC non gérées,
cartes inconnues de joy-boy.

Il contient aussi des pseudos et des identifiants Unity : **ne le mets jamais dans le dépôt tel quel**. Pour en faire une
fixture de test anonyme :

```
node scripts/optcgsim/anonymiser.mjs "<chemin du journal>"
```

En cas de problème, envoie le journal à Claude : il indique à quelle couche ça s'arrête.
