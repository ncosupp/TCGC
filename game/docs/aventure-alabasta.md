# Aventure : l'arc Alabasta

Scénario, adversaires, decks et récompenses du deuxième arc du mode Aventure (tâche 5.5 du plan « Aventure »).
Données : `game/adventure/alabasta.ts` (chapitres, dialogues, récompenses), `game/adventure/decks-alabasta.ts` (decks
des adversaires, `AV-AL-<NOM>`) et `game/adventure/world.ts` (région Grand Line ouverte, route). Test :
`game/tests/adventure-alabasta.test.ts`. L'arc est ajouté à `ARCS` et affiché par la tâche 5.7 ; son équilibrage fin
est la tâche 5.8.

Tous les textes (dialogues, titres) sont **écrits par nous**, sans citation du manga ni de l'anime : on suit les
grandes étapes de l'histoire avec nos mots. Les noms des personnages et des lieux désignent les cartes et l'histoire.

## Synopsis

Après Loguetown, l'équipage entre dans Grand Line. Le joueur **garde son deck** (ST-01 et ce qu'il y a ajouté) : aucun
deck n'est offert.

1. **Reverse Mountain** (cap des Jumeaux) : Laboon, la baleine qui attend ses amis, et Crocus, son gardien. Deux
   chasseurs, Mr. 9 et Miss Wednesday, veulent la dépecer. Victoire : Luffy devient le rival de Laboon, Crocus donne
   le Log Pose.
2. **Whisky Peak** : la ville accueillante est un nid de chasseurs de primes de Baroque Works. Igaram révèle que Miss
   Wednesday est la princesse Vivi ; Mr. 5 et Miss Valentine viennent l'éliminer. Victoire : Vivi apprend à
   l'équipage que Crocodile dirige Baroque Works, et embarque.
3. **Little Garden** : deux géants, Dorry et Brogy, s'y battent depuis un siècle. Mr. 3 et Miss Goldenweek piègent
   l'équipage dans la cire. Victoire : la cire fond, Nami tombe malade.
4. **Royaume de Drum** : il faut un médecin pour Nami. Wapol, l'ancien roi, revient avec Chess et Kuromarimo
   reprendre son royaume. Victoire : **Chopper** rejoint l'équipage.
   - **Défi** (Nanohana) : Ace, le frère de Luffy, de passage à Alabasta.
5. **Yuba** : Vivi veut arrêter la guerre seule. Luffy l'affronte pour qu'elle accepte l'aide de ses amis.
6. **Rainbase** : au casino de Crocodile, Smoker et Tashigi barrent la route. Victoire : Smoker laisse passer, Miss
   All Sunday annonce que « Monsieur Zéro » les attend à Alubarna.
   - **Défi** (Alubarna) : les agents d'élite de Baroque Works (Mr. 1, Miss Doublefinger, Mr. 2, Mr. 4…).
7. **Alubarna** (final) : Crocodile, pendant que rebelles et soldats s'affrontent. Victoire : la pluie revient, Vivi
   reste dans son royaume mais reste « de l'équipage », et offre sa carte (**Vivi**).

## Chapitres

| Ordre | Identifiant | Titre | Lieu | Adversaire | Niveau | Deck | Récompenses |
|---|---|---|---|---|---|---|---|
| 1 | `al-1-reverse-mountain` | La baleine du cap des Jumeaux | Reverse Mountain | Mr. 9 et Miss Wednesday | 1 Débutant | `AV-AL-MR9` | 2 boosters, 200 ฿ |
| 2 | `al-2-whisky-peak` | Cent chasseurs de primes | Whisky Peak | Mr. 5 et Miss Valentine | 1 Débutant | `AV-AL-MR5` | 2 boosters, 200 ฿ |
| 3 | `al-3-little-garden` | L'île des géants | Little Garden | Mr. 3 et Miss Goldenweek | 1 Débutant | `AV-AL-MR3` | 2 boosters, 200 ฿ |
| 4 | `al-4-drum` | Le royaume sans médecins | Royaume de Drum | Wapol | 1 Débutant | `AV-AL-WAPOL` | 2 boosters, Chopper (EB01-006), 200 ฿ |
| 4.5 (défi) | `al-defi-ace` | Défi : les Poings ardents | Nanohana | Ace | 1 Débutant | `AV-AL-ACE` | 3 boosters, 300 ฿ |
| 5 | `al-5-yuba` | La princesse et le désert | Yuba | Vivi | 1 Débutant | `AV-AL-VIVI` | 2 boosters, 200 ฿ |
| 6 | `al-6-rainbase` | Le casino de Rainbase | Rainbase | Smoker | 1 Débutant | `AV-AL-SMOKER` | 3 boosters, 200 ฿ |
| 6.5 (défi) | `al-defi-agents` | Défi : les agents d'élite | Alubarna | Mr. 1 et les agents d'élite | 1 Débutant | `AV-AL-AGENTS` | 3 boosters, 300 ฿ |
| 7 | `al-7-alubarna` | Le roi des sables | Alubarna | Crocodile | 1 Débutant | `AV-AL-CROCODILE` | 4 boosters, Vivi (OP04-118), 400 ฿ |

- **Déblocage** : le premier chapitre exige le dernier chapitre d'East Blue (`requires: ['eb-6-loguetown']`, en plus
  de `requiresArc: 'east-blue'` sur l'arc, que la tâche 5.7 applique à l'écran). Ensuite, règle par défaut de
  `progress.ts` : chaque chapitre demande le chapitre obligatoire précédent ; le défi d'Ace s'ouvre après Drum, celui
  des agents après Rainbase, en même temps qu'Alubarna. Les défis ne bloquent jamais l'histoire.
- **Difficulté** : tout l'arc au niveau 1 (Débutant), comme East Blue ; la difficulté vient des listes, en hausse
  d'un chapitre à l'autre (tâche 5.8, mesures plus bas).
- **Règles spéciales** (`rules`) : aucune.

## Les decks des adversaires

Tous légaux (50 cartes, couleurs du Leader, 4 exemplaires au plus) et **jouables** (aucune carte à coder), à thème,
`series: 'AVENTURE'`. On a préféré les cartes d'OP04 (le set de l'arc, celui des boosters gagnés) quand elles
existaient.

| Deck | Leader | Thème et plan de jeu |
|---|---|---|
| `AV-AL-MR9` | Crocodile OP01-062 (bleu/violet) | Mr. 9, Miss Wednesday, Miss Monday et les petits agents de Baroque Works, Miss All Sunday et Mr. 4 en renfort. Petits coûts, peu de finisseurs. |
| `AV-AL-MR5` | Crocodile OP01-062 (bleu/violet) | Mr. 5 (et son Nez-Palm Cannon), Miss Valentine, les chasseurs de Whisky Peak (Mr. 9, Miss Wednesday, Miss Monday), Mr. 4 et Miss All Sunday. |
| `AV-AL-MR3` | Crocodile OP01-062 (bleu/violet) | Mr. 3 (deux versions), Miss Goldenweek, Mr. 5, Miss Valentine, Mr. 4 et Miss Merry Christmas en renfort, Miss All Sunday, Mr. 13 et Miss Friday. Presque que des Personnages. |
| `AV-AL-WAPOL` | Chopper OP08-001 (rouge/vert) | Le royaume de Drum : Wapol (deux versions), Chess, Kuromarimo, Chessmarimo, Robson, les Lapins, les vingt médecins, Musshuru, Dalton, Chopper (OP08-007), Munch-Munch Mutation. |
| `AV-AL-VIVI` | Vivi OP04-001 (rouge/bleu) | Le royaume d'Alabasta : Koza, Chaka, Pell (et les deux ensemble), Igaram, Cobra, Karoo, Nami, Vivi, les canards. Que des {Alabasta}. |
| `AV-AL-ACE` | Ace OP03-001 (rouge) | Ace et les Pirates de Barbe Blanche d'OP02 et d'OP03, ses Événements de feu et Striker, son bateau. |
| `AV-AL-SMOKER` | Smoker OP10-001 (rouge/vert) | La Marine de Smoker et de Tashigi (plusieurs versions), protégée pendant le tour adverse par le Leader ; sans le Smoker [Banish]. |
| `AV-AL-AGENTS` | Crocodile OP01-062 (bleu/violet) | Les agents d'élite : Mr. 1 et Miss Doublefinger, Mr. 2, Mr. 4 et Miss Merry Christmas, Miss All Sunday (versions bleues et violettes). |
| `AV-AL-CROCODILE` | Crocodile OP01-062 (bleu/violet) | Crocodile (quatre versions, dont OP01-067 [Banish] et OP04-060), Miss All Sunday et tous les agents, de Mr. 1 à Miss Merry Christmas. Le deck le plus fort de l'arc. |

Choix et limites :

- **Crocodile mène tous les decks de Baroque Works** : c'est le seul Leader {Baroque Works} (quatre versions), le
  « Mr. 0 » qui tire les ficelles. Tous ont la version bleu/violet OP01-062 depuis la tâche 5.8 : la version noire
  OP14-079 du final empêchait ses propres effets de faire quitter le terrain aux Personnages adverses (ST-01 gagnait
  55 % des parties, même avec une liste renforcée) et la version violet/jaune OP04-058 n'avait pas les agents bleus.
  Les dialogues ne le montrent qu'à Rainbase et Alubarna.
- **Wapol n'a pas de Leader** : le seul Leader {Drum Kingdom} est Chopper OP08-001, comme Kobby mène la Marine de
  Morgan à Shells Town. Depuis la tâche 5.8, Dalton et un Chopper (OP08-007) renforcent le deck, faute d'autres
  Personnages {Drum Kingdom} assez solides (Kureha et Hiriluk n'y sont pas).
- **Vivi en adversaire** (Yuba) : un combat d'amis, pour qu'elle accepte l'aide de l'équipage. Son deck n'a pas de
  Chapeaux de paille.
- **Ace** : un défi, plus fort que les chapitres voisins, avec des cartes d'OP02 et d'OP03.

## Récompenses

Données à la **première victoire** de chaque chapitre (contrat, § 5).

- **Boosters OP04** : 2 par chapitre, 3 pour Rainbase et pour chaque défi, 4 pour le final, soit **23 boosters** sur
  l'arc (17 sans les défis).
- **Berry** (`ECONOMY.adventure`) : 200 ฿ par chapitre, 400 pour le final, 300 par défi.
- **Recrues** : 1 carte rouge, jouable tout de suite dans le deck de départ (ST-01, rouge) :
  - Chopper, après Drum : **EB01-006** ([Bloqueur], −3000 à un Personnage adverse en attaquant avec 2 DON!!) ; ST-01
    a déjà quatre Chopper ST01-006, sans effet utile à ce stade ;
  - Vivi, à la fin de l'arc : **OP04-118** (les Personnages rouges de coût 3 ou plus ont [Initiative]), du set de
    l'arc ; ST-01 a déjà quatre Vivi ST01-009.
- **Pas de deck offert** : le joueur garde le sien.

## Carte du monde

- La région **Grand Line** (`world.ts`) est ouverte (`open: true`). Les chapitres y sont placés de droite à gauche,
  dans l'ordre du voyage, en zigzag dans la bande (60 unités de haut) ; les défis sont près de leur lieu (Nanohana au
  nord, entre Drum et Yuba ; les agents au nord d'Alubarna).
- **Route** : les points de passage de Grand Line sont remplacés par `{ region: 'grand-line' }` entre Reverse Mountain
  et Marie-Joie. Tant que l'arc n'est pas dans `ARCS` (tâche 5.7), la route va tout droit de Reverse Mountain à
  Marie-Joie.

## Équilibrage (tâche 5.8)

Mesure : `node --no-warnings scripts/game/adventure-balance.ts 1000 --arc alabasta --recrues` (comme la tâche 1.19 :
ST-01 joué par l'IA simple, liste secrète pour l'adversaire, graines fixes, chaque donne jouée des deux côtés). Avec
`--recrues`, le deck du joueur reçoit les quatre recrues d'East Blue, puis Chopper après Drum, chacune à la place d'un
Karoo puis d'un Vivi ; les boosters d'OP03 et d'OP04 gagnés en chemin ne sont pas comptés (le vrai joueur sera un peu
plus fort).

Courbe visée par le plan : premiers chapitres un peu plus durs que la fin d'East Blue (Smoker : 51 % avec les
recrues), puis en hausse, final nettement plus dur mais gagnable.

### Avant (mesures de la tâche 5.5, listes de départ)

ST-01 sans recrues, joué par l'IA simple, contre chaque deck : `node --no-warnings scripts/game/adventure-balance.ts
<n> --chapitres eb-1-shells-town --adversaire AV-AL-<NOM> --niveau <niveau>` (le chapitre ne servait qu'à porter le
deck). Victoires du joueur ; aucune erreur.

| Deck | Niveau 1 (40 parties) | Niveau du chapitre (20 parties) |
|---|---|---|
| `AV-AL-MR9` | 73 % | 20 % (Confirmé) |
| `AV-AL-MR5` | 68 % | 20 % (Confirmé) |
| `AV-AL-MR3` | 80 % | 15 % (Confirmé) |
| `AV-AL-WAPOL` | 38 % | 20 % (Confirmé) |
| `AV-AL-VIVI` | 70 % | 10 % (Confirmé) |
| `AV-AL-ACE` (défi) | 15 % | 0 % (Expert) |
| `AV-AL-SMOKER` | 20 % | 0 % (Expert) |
| `AV-AL-AGENTS` (défi) | 43 % | 5 % (Expert) |
| `AV-AL-CROCODILE` | 53 % | 0 % (Expert) |

Mesures de la tâche 5.8 sur ces mêmes listes, ST-01 avec les recrues : au niveau 1 (200 parties), 74 % contre Mr. 9,
72 % Mr. 5, 69 % Mr. 3, 56 % Wapol, 20 % Ace, 75 % Vivi, 21 % Smoker, 56 % les agents, 59 % Crocodile (courbe à
plat, Smoker plus dur que le final) ; aux niveaux de la tâche 5.5 (20 parties), 40 % contre Mr. 9 (niveau 2) et 0 %
contre Crocodile (niveau 3).

### Après (1000 parties par chapitre, niveau Débutant partout)

| Chapitre | ST-01 et les recrues | ST-01 seul |
|---|---|---|
| 1 Mr. 9 (Reverse Mountain) | 51 % (48 à 54) | 48 % |
| 2 Mr. 5 (Whisky Peak) | 48 % (45 à 51) | 40 % |
| 3 Mr. 3 (Little Garden) | 41 % (38 à 44) | 39 % |
| 4 Wapol (Drum) | 37 % (34 à 40) | 26 % |
| Défi Ace (Nanohana) | 20 % (18 à 22) | 17 % |
| 5 Vivi (Yuba) | 37 % (34 à 40) | 28 % |
| 6 Smoker (Rainbase) | 35 % (32 à 38) | 25 % |
| Défi des agents (Alubarna) | 27 % (25 à 30) | 24 % |
| 7 Crocodile (Alubarna, final) | 21 % (19 à 24) | 14 % |

(Entre parenthèses : intervalle de confiance à 95 %. Aucune partie en erreur.)

Choix :

- **Tout l'arc au niveau Débutant**, comme East Blue. Aux niveaux 2 et 3, même ST-01 avec ses recrues perd presque
  tout (0 % contre Crocodile au niveau Expert) ; le niveau Débutant joue aussi pareil sur tous les appareils (les
  niveaux 2 et 3 du navigateur sont limités en temps) et se mesure en secondes au lieu d'heures.
- **Listes** (détail dans `decks-alabasta.ts`) : l'IA simple joue mal les [Contre] « DON!! −1 » et les recherches de
  Baroque Works ; les decks durcis ont donc plus de Personnages solides (Miss All Sunday OP12-075, Mr. 4, Mr. 1 et
  Mr. 2 bleus) et moins d'Événements. Wapol reçoit Musshuru, Dalton et Chopper ; Vivi des {Alabasta} à 5 coûts, Chaka
  et Pell et sa propre carte OP04-118 ; Smoker est un peu allégé (sans son [Banish]). Le défi d'Ace est inchangé.
- **Leader du final** : Crocodile OP01-062 au lieu d'OP14-079 (voir plus haut) ; le défi des agents aussi.
- **Limites** : le chapitre 1 est aussi dur que la fin d'East Blue (51 %), pas plus ; Vivi et Wapol font un palier
  (37 %) ; le défi des agents est un peu plus facile que le final (27 % contre 21 %), ce qui laisse le final comme
  sommet de l'arc.

## Questions ouvertes

1. **Leaders** : Crocodile pour les cinq decks de Baroque Works (faute d'autre Leader), Chopper pour Wapol. À garder ?
2. **Vivi en adversaire à Yuba** : fidèle à l'histoire (Luffy et Vivi se battent dans le désert), mais c'est une
   amie. Autre choix : Koza et les rebelles, menés par le même Leader Vivi.
3. **Niveaux** : tout au niveau Débutant depuis la tâche 5.8 (la difficulté vient des listes), comme East Blue.
   Garder ?
