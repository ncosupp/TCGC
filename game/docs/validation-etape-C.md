# Parcours complet et bilan de l'étape C (tâche CF.3)

Bilan de l'étape C du plan « Aventure » (toutes les cartes jouables), fait le 11 novembre 2026 sur `cartes/etape-C`,
tête `f11d74c` (vagues C1, C2, S-1 à S-4, CF.1, CF.2 audit et CF.2 corrections fusionnées). Point de comparaison
« avant » : `b7eb7f3`, le départ de l'étape C. Aucune phrase de carte ici : des numéros et des valeurs.

## En bref

- **2 846 cartes jouables sur 2 850 (99,9 %)**, contre 1 158 au départ de l'étape. Les **143 Leaders** sont jouables,
  les **23 decks** du registre et de l'aventure sont complets, aucune carte en doute. Le critère « 100 % » de l'étape
  n'est pas atteint : il reste 4 cartes que le moteur ne sait pas dire (plus bas).
- **Aucune erreur** sur 150 000 parties au hasard sur tout le catalogue (IA contre IA et choix au hasard, 6 graines),
  ni dans `game:validate`, `game:custom-smoke` et les 1 750 tests.
- **Un défaut trouvé** : le [Déclenchement] de Carrot **OP01-009** ne peut jamais être activé (catalogue officiel mal
  rangé, voir « Défaut trouvé »). Pas corrigé ici (fichier hors de la tâche) : petite tâche à part.
- **Interface** : `ui:tour` complet dans les 3 formats (138 écrans, parties jouées jusqu'au bout, en ligne, aventure,
  boosters, éditeur, clavier, retour d'Android) : 0 erreur, 0 défilement horizontal, 0 échec.
- **Vitesse** : rien de sensible pour le joueur (l'IA « Débutant » met 0,012 à 0,025 ms par décision, la « Confirmé »
  ~110 ms), mais les parties entre IA sont **25 à 30 % plus lentes** qu'au départ de l'étape, ce qui allonge d'autant
  les mesures et l'entraînement de l'IA entraînée. Le moteur construit pèse 2,5 fois plus (navigateur : +40 ms
  d'évaluation, +100 ko compressés ; onglet « Jouer » ouvert en ~0,6 s au lieu de ~0,57 s).

## Ce qui a été lancé

| Vérification | Résultat |
|---|---|
| `npm run typecheck` | propre |
| `npm test` | **1 750 tests**, 1 750 verts |
| `npm run game:coverage` | 2 850 cartes : 2 846 jouables (1 202 codées à la main, 347 d'office, 1 297 recettes vérifiées), 0 générée, 0 doute, 4 à faire ; 143 Leaders jouables ; 23 decks complets |
| parties au hasard longues, tout le catalogue, IA contre IA (`fuzz`, graines 11 à 14) | **100 000 parties**, 1 178 s, 13 tours en moyenne, **0 problème** ; 2 846 cartes en jeu, 2 224 dont un effet s'est déclenché |
| même chose, choix au hasard (graines 21 et 22) | **50 000 parties**, 564 s, 14 tours en moyenne, **0 problème** ; 2 294 cartes dont un effet s'est déclenché |
| cartes forcées (4 exemplaires par deck), les 13 cartes à effet jamais déclenchées par l'IA | 200 parties par carte, 0 problème (détail plus bas) |
| `npm run game:validate` | 148 120 parties, 22,5 millions de décisions, **0 problème** ; 8 points à examiner (7 voulus), déjà connus (plus bas) |
| `npm run game:custom-smoke -- 10 25` | 35 750 parties (143 Leaders), **0 problème** |
| `npm run game:custom-smoke -- 50 25 --hasard` | 178 750 parties (choix au hasard, 143 Leaders × 50 decks × 25 parties), **0 problème** |
| `npm run game:fingerprint -- 200` | 105 800 parties, empreinte globale **3956dab246dc10d7**, celle annoncée pour #99 (décision de l'utilisateur) : la tête de l'étape joue bien ce qui a été validé |
| `npm run ui:tour` (parcours de la référence), avant (`b7eb7f3`) et après, `--compare` | 66 captures × 2 ; 0 erreur, aucun défilement horizontal, pas plus de petites cibles ni de petits textes ; différences seulement sur le choix du Leader (plus de Leaders), l'éditeur (plus de cartes) et la salle (code tiré au hasard) |
| `npm run ui:tour -- --only tout` (3 formats) | **138 écrans** (48 ordinateur, 45 portrait, 45 paysage), **0 erreur de console ou réseau, 0 défilement horizontal, 0 parcours en échec** ; parties rapides jouées jusqu'au bout, chapitre 1 gagné, boosters, éditeur (versions, DON!!, visuels), partie en ligne à deux comptes, clavier, mouvements réduits, retour d'Android |
| essai à la main (navigateur intégré, serveur d'essai sur la copie de la base, port 3693) | compte d'essai, import d'une liste avec Leader Roger OP13-003 et Roger OP13-064 (jouable, 50/50), partie rapide contre l'IA jusqu'à la fin (malus et DON!! du Leader Roger vus), éditeur au format téléphone (931 cartes proposées pour ce Leader) ; aucune erreur du jeu ni du serveur (seul message : l'enregistrement du service worker refusé par le navigateur intégré, attrapé par l'appli) |

`game:validate` réécrit `game/docs/validation.md` : il n'est pas committé. Les scripts des parties longues et des mesures
sont hors dépôt (dossier temporaire de la tâche) : ils appellent `fuzz` (`game/engine/recipes/fuzz.ts`) avec une graine,
`aiChoose` et `newGame` comme `scripts/game/bench.ts`.

## Cartes jamais déclenchées

Sur les 100 000 parties IA contre IA, **622 cartes** n'ont jamais déclenché d'effet : **347 d'office** (mots-clés
seulement, rien à déclencher), **262 à effet permanent ou de réaction** (non comptés par le banc) et **13 à effet à un
moment donné**. Avec les choix au hasard, il n'en reste qu'une à effet à un moment donné : **OP01-009**.

Les 13, forcées en 4 exemplaires dans chaque deck (200 parties chacune, 0 problème) :

| Cartes | Constat |
|---|---|
| OP01-009 | jamais déclenchée, même au hasard : défaut du [Déclenchement] (plus bas) |
| EB01-009, OP01-059, OP10-078, P-060, ST08-014 | l'IA ne les joue pas ; au hasard, l'effet se déclenche 92 à 222 fois sur 200 parties, sans erreur : faiblesse de l'IA (évènements [Contre] et [Principale] jugés inutiles) |
| OP04-100 | [Déclenchement] seul : l'IA le refuse, au hasard 50 fois |
| EB02-039, OP01-087, OP04-036, OP06-096, OP12-080, OP14-099 | condition rarement réunie dans un deck tiré au hasard (type, nom du Leader, nombre de DON!!) ; OP14-099 vue une fois |

## Défaut trouvé : OP01-009

Dans le catalogue officiel anglais (la carte n'a pas de VF), le [Déclenchement] de Carrot OP01-009 est rangé dans le
texte de l'effet et non dans le champ du [Déclenchement]. Le moteur ne propose un [Déclenchement] que si ce champ est
rempli (`engine.ts`, perte d'une Vie) ; la correction de `frTrigger` (`cards/index.ts`) ne traite que les cartes
françaises dont le [Déclenchement] n'est pas en tête du texte. Résultat : la recette (vérifiée, `playSelf`) est juste,
mais en partie la carte part toujours dans la main (aucun test ne joue cette carte depuis la Vie). Balayage du catalogue : c'est **la seule carte** dans ce cas
(les quatre cartes françaises de la même forme, OP06-059, OP07-114, OP09-096, OP13-039, sont déjà corrigées par
`frTrigger`). Correction proposée (tâche à part, une ligne dans `cards/index.ts` et un test) : sortir un
`[Trigger]` / `[Déclenchement]` placé en tête du texte, quelle que soit la langue. OP01-009 n'est dans aucun deck du
registre : l'empreinte ne bougera pas.

## Points à examiner de `game:validate` (déjà connus)

Jango OP15-026 (AV-EB-KURO) et Stussy OP17-054 (META-XEBEC) : activation proposée, jamais choisie par l'IA ; Baggy
OP16-041 et OP16-048 (AV-EB-BAGGY, AV-EB-BAGGY-ALVIDA) : effet « quand ... » jamais déclenché. Stussy est apparue avec
les corrections de CF.2 (effet de seuil de l'IA) : à reprendre avec l'IA (suite plus bas).

## Vitesse de l'IA

IA « Débutant » contre elle-même, 1 000 parties par confrontation, mesuré deux fois en alternant avant et après, PC
sans autre calcul en cours (les deux mesures concordent à 2 % près) :

| Confrontation | Parties par seconde (avant → après) | ms par décision | Décisions par partie |
|---|---|---|---|
| ST-01 contre ST-32 | 322 → 247 | 0,012 → 0,015 | 105 → 106 |
| META-ENEL contre META-KAIDO | 203 → 149 | 0,010 → 0,012 | 200 → 220 |
| META-MIHAWK contre META-ROBIN | 142 → 97 | 0,014 → 0,019 | 193 → 207 |
| META-XEBEC contre META-SABO | 163 → 129 | 0,017 → 0,021 | 154 → 155 |
| ST-34 contre ST-21 | 272 → 209 | 0,010 → 0,012 | 140 → 148 |
| ST-35 contre ST-30 | 162 → 112 | 0,017 → 0,025 | 149 → 151 |

IA « Confirmé » (16 tirages, 500 ms au plus), 6 parties : ST-01 contre ST-32 **91 → 107 ms** par décision,
META-ENEL contre META-KAIDO **98 → 114 ms** : +17 %, loin du plafond de 500 ms ; le joueur ne le voit pas.

D'où vient le ralentissement (ms par décision, ST-35 contre ST-30 / META-MIHAWK contre META-ROBIN) :

| Point de l'étape | ST-35 / ST-30 | MIHAWK / ROBIN |
|---|---|---|
| départ (`b7eb7f3`) | 0,0168 | 0,0140 |
| après C2 (`87bfb42`) | 0,0170 | 0,0142 |
| après S-1 (`ebcc5f0`) | 0,0172 | 0,0153 |
| après S-4 (`7d6ba0a`) | 0,0206 | 0,0190 |
| après CF.1 (`215bc53`) | 0,0208 | 0,0197 |
| après CF.2 corrections (`f11d74c`) | 0,0247 | 0,0197 |

Le moteur ralentit au fil des vagues « set » (évènements et auras ajoutés au moteur, lus à chaque décision), et les
corrections de CF.2 ajoutent des questions (« jusqu'à N » DON!!, coûts facultatifs proposés) : plus de décisions par
partie. Pas de ralentissement sensible pour le joueur ; pour l'entraînement de l'IA entraînée, compter environ 30 % de
temps en plus à nombre de parties égal. Piste si besoin : profiler `emit` et les auras (`isNegated`, `listens`) sur une
partie META-MIHAWK.

## Temps de chargement des cartes

| Mesure | Avant (`b7eb7f3`) | Après (`f11d74c`) |
|---|---|---|
| Node : catalogue local et module des cartes (recettes compilées comprises), 5 mesures | ~190 ms | ~430 ms |
| moteur construit pour le navigateur (`GameGain`) | 424 ko (120 ko compressés) | 1 074 ko (224 ko compressés) |
| fil de calcul de l'IA (`worker`) | 305 ko (78 ko compressés) | 954 ko (180 ko compressés) |
| évaluation du fil de calcul construit (moteur, cartes, IA), 3 mesures | 28 ms | 69 ms |
| ouverture de l'onglet « Jouer » (`ui:tour --only accueil`, cache vidé, 3 lancements alternés), ordinateur / portrait / paysage | 520 / 597 / 590 ms | 653 / 633 / 606 ms |

Dans Node, le temps vient surtout de la lecture des fichiers TypeScript du traducteur et du compilateur (~400 ms au
premier chargement, une fois au démarrage du serveur). Dans le navigateur, le code est déjà construit : +40 ms
d'évaluation et ~100 ko de plus à télécharger (une fois, puis en cache) ; l'onglet « Jouer » s'ouvre en 0,6 s, 15 à
130 ms de plus qu'au départ (mesuré pendant un autre calcul, le même pour les deux). Pas de ralentissement sensible.

## Bilan de l'étape

| | Départ (5 nov.) | Fin (11 nov.) |
|---|---|---|
| Cartes au catalogue | 2 850 (EB05 compris) | 2 850 |
| Jouables | 1 158 | **2 846** |
| codées à la main / d'office / recettes vérifiées | 811 / 347 / 0 | 1 202 / 347 / 1 297 |
| Doutes ouverts | — | **0** |
| Tests | 908 | 1 750 |
| Interprétations (`interpretations.md`) | 169 numéros (jusqu'à 472) | 568 numéros (399 de l'étape C, n° 1000 à 4113) |

Les **4 cartes non jouables** attendent une brique du moteur (une tâche moteur à part) : **EB05-052** (remplacement
des dégâts), **OP15-025** (effet différé avec choix ; `trashTypeChar` peut servir), **OP15-092** (puissance de base
permanente), **OP15-093** (attribut donné).

### Doutes levés par l'utilisateur

| Question | Cartes | Réponse | Où |
|---|---|---|---|
| 1 | EB05-061, OP15-098 (« à cause de votre adversaire » couvre le combat) | lecture 1 | n° 1996, jouables |
| 3 | EB03-021 (deuxième cible adverse seulement) | lecture 1 | n° 1996, jouable |
| 5 | OP13-064 (le Leader toujours annulé) | lecture 1 | n° 4110, aura `negateAura`, jouable (CF.2) |
| 7 | OP09-093 (annulation jusqu'à la fin du prochain tour adverse) | lecture 1 | n° 1996, jouable |
| 10 | OP01-099 (les {Kurozumi Clan} des deux joueurs) | lecture 2 | n° 4100, champ `koShieldBoth`, jouable (CF.2) |
| 11 | P-008 (activation facultative, cible imposée s'il y en a une) | lecture 1 de la recette | n° 4101, jouable (CF.2) |
| — | règle « Si C, A. Puis, B » dans le code d'avant l'étape C (17 cartes, 6 decks) et corrections de lecture (a) à (o) | corriger, PR à part | #99, empreinte changée (3956dab246dc10d7) |

Questions 2, 4, 6, 8 et 9 : tranchées par les sources (Q&A officielles), sans réponse à demander (n° 1902, 1992, 1660,
1991).

### Suites (laissées pour plus tard, rien de codé ici)

- **OP01-009** : [Déclenchement] jamais proposé (défaut trouvé par cette tâche, plus haut).
- **n° 4107** : DON!! −N et « renvoyez N DON!! » : le joueur devrait choisir lesquelles (règles 8-3-1-6 et 10-2-10-1) ;
  le moteur garde l'ordre fixe du n° 1741 (moteur commun, toutes les parties changeraient : tâche à part).
- **« Redressez jusqu'à N DON!! à la fin de ce tour »** (OP13-038, OP14-031, EB02-015, ST24-005) : l'action différée du
  moteur redresse toujours le maximum, sans question.
- **Interprétations à faire valider** par l'utilisateur : n° 4106 (cartes de la main placées toutes ensemble au-dessus ou
  au-dessous) puis n° 4104 (défausse de N cartes « si vous le faites » pas proposée avec moins de N cartes), et les
  plages listées dans `AVANCEMENT.md` (choix faits sans validation par les vagues).
- **IA** : Stussy OP17-054 (META-XEBEC) jamais activée ; évènements EB01-009, OP01-059, OP10-078, P-060, ST08-014 et
  [Déclenchement] d'OP04-100 jamais joués par l'IA heuristique ; Jango OP15-026 jamais activé.
- **IA entraînée** : à réentraîner après la mise en ligne (le jeu des decks du registre a changé avec #99) ; commandes
  dans la description de la PR #96 (l'utilisateur les lance).
- **Interface** : le texte de l'éditeur « seules les cartes que le jeu sait déjà jouer sont proposées ; il y en aura de
  plus en plus » peut être revu (il n'en manque plus que 4).
- **4 cartes non jouables** (plus haut) : tâche moteur.
- **Vitesse** : 25 à 30 % de parties en moins par seconde entre IA ; à profiler si l'entraînement devient trop long.
