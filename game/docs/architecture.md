# Architecture du moteur de jeu (`game/`)

> Écrit le 15 novembre 2026 (audit du 14 novembre, P2-14). Ce fichier décrit comment le moteur est construit ; les
> règles interprétées sont dans `interpretations.md`, les cartes nouvelles dans `cartes-nouveau-set.md`, l'IA entraînée
> dans `ia-rl.md`. Le code est du TypeScript « effaçable » (`erasableSyntaxOnly`) : Node 24 l'exécute tel quel côté
> serveur, Vite le compile pour le navigateur.

## 1. L'état d'une partie

Une partie est **un seul objet JSON** (`GameState`, `engine/types.ts`), sans classe ni fonction : on le copie
(`structuredClone`, `JSON.parse(JSON.stringify())`), on l'enregistre, on l'envoie à un fil de calcul.

| Champ | Rôle |
|---|---|
| `players[0..1]` | Leader, main, deck, Vie, Défausse, Personnages, Lieu, DON!! (actives, épuisées, deck DON!!), liste du deck (`list`), `deckId` |
| `turn`, `active`, `first`, `flow` | où en est le tour : `flow.stage` vaut `mulligan`, `setup`, `refresh`, `draw`, `don`, `main`, `battle`, `end` ou `over` |
| `battle` | combat en cours (attaquant, cible, étape) |
| `mods`, `delayed` | modifications temporaires (puissance, coût, mots-clés, « ne peut pas »…) et effets différés |
| `pending` | effets en attente de résolution (voir § 3), le premier en tête |
| `decision` | la question posée à un joueur (options avec un identifiant : `play:12`, `attack:3:51`, `end`…), ou `null` |
| `history` | chaque décision prise (joueur, type, choix) : une partie se rejoue à partir de l'état de départ et de `history` |
| `log` | le journal (texte), avec des lignes réservées à un joueur (`only`) |
| `known`, `peek`, `lifeSeen` | ce que chaque joueur sait des zones cachées (cartes révélées, regardées) |
| `rng`, `rng128` | l'état du générateur de hasard (voir § 2) |
| `rules` | version des règles à la création (`RULES_VERSION`) : une partie enregistrée se rejoue avec les siennes |

Les cartes en jeu n'ont qu'un `uid` (attribué dans l'ordre de la liste du deck, **avant** le mélange) et un `num`
(numéro de carte) ; tout le reste se lit dans le registre `CARDS` (`engine/cards/registry.ts`, rempli par
`loadCardData`) avec `def(num)`.

## 2. Le hasard

`engine/rng.ts` : le générateur fait partie de l'état, le moteur est donc **déterministe** (même état + même choix =
même résultat). C'est ce qui permet le rejeu des parties, la vérification côté serveur (`server/game-verify.js`),
l'empreinte (`npm run game:fingerprint`) et les simulations.

- `rng` (mulberry32, 31 bits utiles) : parties contre l'IA, simulations de l'IA et du coach, parties en ligne d'avant
  le 14 novembre 2026. **Ne pas le changer** : l'empreinte et les parties enregistrées en dépendent.
- `rng128` (sfc32, 128 bits) : parties en ligne, état tiré par `crypto` côté serveur (`server/game-online.js`). Présent,
  il remplace `rng`. La graine de 31 bits se retrouvait par force brute à partir d'une main de départ.

## 3. Le déroulement : `act`, `advance`, les effets

- `newGame(options)` prépare la partie (decks, mélange, qui commence) et avance jusqu'à la première décision.
- `act(state, choix)` applique la décision d'un joueur et renvoie **un nouvel état** (l'ancien n'est pas modifié) ;
  `actInPlace` fait de même sans copie, pour l'apprentissage (`game/rl/`).
- `advance(state, chooser?)` fait avancer la partie : vérification des défaites, effets en attente, étapes du tour.
  Sans `chooser`, il s'arrête à la prochaine décision ; avec un `chooser` (IA, simulations), il répond lui-même jusqu'à
  la fin.
- Les effets des cartes sont des fonctions `(ctx) => void` (`EffectCtx` : l'état, le joueur, la carte, `ask`). Quand un
  effet a besoin d'une réponse, `ctx.ask(...)` lève `NeedDecision` : l'effet s'interrompt, `state.decision` porte la
  question (`inEffect: true`).
- **Instantané et rejeu d'un effet (`replayEffect`)** : avant de résoudre un effet en interactif, le moteur garde
  l'état complet en JSON dans `pending[0].snapshot`. La réponse s'ajoute à `pending[0].answers`, et l'effet est
  **rejoué depuis l'instantané** avec toutes les réponses déjà données (`ask` les rend dans l'ordre, et vérifie que
  chaque réponse est encore une option : sinon « Réponse rejouée invalide »). Conséquences : un effet ne doit dépendre
  que de l'état et de ses réponses (pas d'état caché ailleurs) ; l'instantané contient tout l'état, y compris les cartes
  cachées (la vue en ligne le retire, § 5) ; une simulation qui redistribue les cartes cachées doit redistribuer aussi
  l'instantané (`determinize`, `ai/search.ts`).
- Événements (`emit`) et effets « quand ... » (`when`) : voir `30-jeu-dans-tcgc.md` § 8 dans la passation.
- `invariants.ts` : contrôles de cohérence (nombre de cartes, zones) utilisés par les tests et la validation.

## 4. Les cartes : code à la main et recettes

- **Registre** : `engine/cards/registry.ts` (module feuille : `CARDS`, `HIDDEN`). `engine/cards/index.ts` réunit les
  comportements (`BEHAVIORS`, un fichier par deck ou famille : `st31.ts`, `fam-sabo.ts`, `op07.ts`…), les recettes et le
  code à la main appelé par les recettes (`MANUAL`), et remplit le registre (`loadCardData`). Le code à la main
  l'emporte sur une recette.
- **Briques** (`engine/cards/bricks*.ts`) : cibles, actions, conditions et coûts décrits comme sur la carte ; toute
  nouvelle carte codée à la main les utilise.
- **Chaîne des recettes** (étape C, `engine/recipes/`) :
  1. `parse/` lit le texte VO d'une carte et en tire une **recette** (`types.ts` : capacités, étapes, actions,
     conditions, coûts) ; `normalize.ts` prépare le texte.
  2. Les recettes relues sont rangées par extension dans `sets/` (`RecipeEntry` : recette, niveau `verified` ou
     `generated`, doute éventuel) ; `sets/ORDER.ts` donne l'ordre.
  3. `compile.ts` traduit une recette en comportement (`CardBehavior`) avec les briques ; la compilation se fait au
     chargement des données (`loadCardData`), pas au chargement des modules.
  4. Contrôles : `describe.ts` redit la recette en français et en anglais, `compare.ts` compare la phrase redite au
     texte (« aller-retour », `recipes-cards.test.ts`), `testgen.ts` génère des situations de test, `crosscheck.ts` et
     `fuzz.ts` comparent et éprouvent, `bench.ts` mesure.
  5. `confidence.ts` donne le niveau de confiance (`coded`, `verified`, `auto`, `generated`, `doubt`, `todo`) ;
     `cardStatus` en tire `coded` / `auto` / `todo`. Seules les cartes `coded` et `auto` sont jouables.
- Imports : `rules.ts`, les briques et le compilateur lisent `CARDS` dans `registry.ts`, jamais dans `cards/index.ts`
  (sinon un cycle d'imports de 78 fichiers, et l'ordre de chargement des modules compte à nouveau).

## 5. La vue en ligne

`engine/view.ts`, `viewFor(state, siège)` : la seule chose qu'un joueur reçoit d'une partie en ligne. Les cartes
cachées deviennent des cartes « ? » à identifiant opaque (qui dépend de leur place, pas de la carte), le générateur
(`rng`, `rng128`), le compteur d'identifiants, les instantanés d'effets, les lignes secrètes et les choix de
l'adversaire sont retirés (`historyFor`). `game/online/match.ts` (logique pure) arbitre : salle, choix vérifiés,
abandon, erreur du moteur (statut `error`, sans perdant), partie arrêtée après 7 jours sans coup (`abandoned`), partie
rangée réduite à ce que le joueur a vu (`recordFor`). `server/game-online.js` s'occupe de la base et du flux SSE.
**Test d'étanchéité** : `tests/view.test.ts`, à relancer après tout ajout de carte qui révèle ou fait regarder des
cartes (`reveal`).

## 6. L'IA

- **IA simple** (`ai/heuristic.ts`, `heuristicChooser`) : règles écrites à la main, réglées par un **style** par deck
  (`ai/style.ts`, `styles.json` appris par `npm run game:train`). Elle est déterministe et sert de **référence** :
  à l'IA entraînée de l'utilisateur (`rl/`, `game/rl/`), à l'empreinte, à la vérification des parties par le serveur.
  Ne pas la modifier sans accord (l'empreinte changerait).
- **IA par simulation** (`ai/search.ts`, niveaux 2 et 3, `mcChoose`) : pour chaque option, des suites de partie jouées
  par l'IA simple sur des redistributions des cartes cachées (`determinize`) ; nombre de tirages fixe ou limite de
  temps (`LEVELS`).
- **IA entraînée** (niveau 4, `ai/rl.ts`, modèle ONNX dans `web/public/rl-model/`) : voir `ia-rl.md`.
- `ai/worker.ts`, `ai/client.ts` : calculs dans un fil séparé du navigateur.

## 7. Le coach

- `coachAnalyze` (`ai/search.ts`) analyse une décision du joueur en trois temps : toutes les options utiles, puis les
  3 meilleures et le choix du joueur avec de nouveaux tirages, puis, si le choix du joueur perd au moins 10 points
  (erreur candidate), 96 tirages des deux seules options (`verifySamples`). Toutes ses suites sont jouées par l'IA
  simple avec un **style tiré au hasard à chaque décision**, autour du style du deck (chaque réglage bouge d'au plus la
  moitié de son intervalle, `STYLE_SPREAD` ; `variedRollout`, réservé au coach) : sans cela, l'IA simple
  étant déterministe, les tirages rejouaient presque la même partie et les chances sortaient à 0 ou 100 %. Le style
  imposé (`playerStyle`) est toujours remis comme avant. Les tirages écartés (suite qui diverge) sont comptés
  (`failures`, `failure`).
- Réglages : `coach/review.ts` (`REVIEW` pour l'analyse en arrière-plan, `HINT` pour le conseil). Les deux premiers
  temps ont une limite de temps avec un plancher de tirages (un nombre fixe serait trop lent sur téléphone) ; la
  vérification se fait toujours en entier.
- Affichage : `coherentReviews` (`coach/review.ts`) écarte les analyses de moins de `MIN_SAMPLES` tirages et corrige
  une décision d'après la décision suivante du même tour (ses meilleures chances disent ce que valait le choix
  précédent) ; le récap (`buildRecap` : erreurs, bons choix, courbe, tournants) et la progression (`coach/progress.ts`)
  le lisent ainsi, parties anciennes comprises.
- `coach/archive.ts` : la partie enregistrée (`GameRecord`) et son rejeu (`replayRecord`) ; `coach/logText.ts` : le
  journal à la deuxième personne, à l'affichage.

## 8. Vérifier un changement du moteur

1. `npm run typecheck`, les tests concernés, puis `npm test` (≈ 18 min).
2. `npm run game:fingerprint -- 3 <avant.json>` sur le commit de départ, puis `npm run game:fingerprint -- 3 ""
   <avant.json>` après : 0 partie différente attendue (decks du registre, IA simple).
3. Si des cartes changent : `tests/view.test.ts` (étanchéité), `npm run game:validate`, `npm run game:custom-smoke`.
