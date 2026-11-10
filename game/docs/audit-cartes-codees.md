# Audit des cartes codées avant l'étape C (tâche CF.2)

> État au 10 novembre 2026, sur `cartes/etape-C` (7d6ba0a) plus les deux PR de CF.2. Aucune phrase de carte ici : des
> numéros, des moments et des valeurs. Interprétations : `interpretations.md`, n° 4100 à 4113.

## But et méthode

Les **811 cartes codées à la main avant l'étape C** (fichiers `fam-*`, `meta-*`, `op03-*`, `st01`, `st21`, `st22`, `st30`
à `st36`, `aventure-*` de `game/engine/cards/`, tels qu'ils étaient au départ de l'étape C, b7eb7f3) doivent avoir la même
confiance que les cartes traduites en recettes. Trois outils :

1. **Comparaison « code à la main ↔ recette compilée »** (`crosscheck.ts`, tâche C1.3), lancée par
   `node --no-warnings scripts/game/cards-audit.ts [--detail] [--json f] [--cartes N1,N2]` : le texte de chaque carte est
   traduit (fichier de set s'il y a une recette, sinon le traducteur), compilé, puis le code et la recette sont joués dans
   les mêmes situations tirées au hasard (20 par moment, mêmes graines), l'IA heuristique répondant aux questions ; l'état
   après l'effet est comparé. Une carte différente est rejouée avec des **réponses fixes** (tout accepter ; tout refuser ;
   tout refuser et « aucune » DON!!) : identique ainsi, la différence ne vient que de la façon dont la question est posée
   (étiquette, ordre des options), pas des règles. `--detail` montre les champs de l'état qui diffèrent.
2. **Parties au hasard** pour les cartes que la comparaison ne couvre pas (texte non traduit, recette non compilée, aucun
   moment que le banc sait déclencher) : `cards-audit.ts --hasard [parties par lot]`, 4 exemplaires forcés par deck, lots
   de 4 cartes d'une même couleur, IA contre IA, contrôles de cohérence à chaque décision.
3. **Balayage du texte anglais** pour les lectures corrigées pendant l'étape C (cas connus (a) à (o) du plan) et relecture
   du code de chaque carte trouvée.

Limites : le banc ne déclenche que [Jouée], [Principale], [Activation : Principale], [En attaquant], [En cas de KO], [Fin de
votre tour], [Contre] et [Déclenchement] ; les effets permanents, les réactions (« quand ... ») et [Attaque adverse] ne sont
pas comparés (ils passent aux parties au hasard et à la relecture).

## Chiffres

Comparaison sur les 811 cartes (après les corrections des deux PR, `cards-audit.ts`) :

| Résultat | Cartes |
|---|---|
| Texte traduit et recette compilée, comparées | 532 |
| — identiques | 502 (avant corrections : 469) |
| — différentes, mêmes règles (identiques à réponses fixes : question posée autrement) | 17 |
| — différentes, à expliquer | 9 (détail plus bas ; avant corrections : 18) |
| — sans moment déclenché par le banc (effets permanents, réactions) | 56 |
| Recette non compilée | 4 |
| Texte non traduit (code à la main seulement) | 223 |

Avant les corrections, 60 cartes étaient différentes (42 à réponses fixes près, 18 à expliquer).

Classement des différences trouvées par la comparaison :

| Classe | Cartes |
|---|---|
| **Erreur du code** (corrigée) | règle « Puis » (n° 1983) : EB03-017, OP07-109, OP12-078, OP12-118, OP17-060 (et ST22-015, deck, PR 2) ; « jusqu'à N » DON!! (n° 1994) : OP03-073, OP08-060, OP09-077 (PR 2), OP12-117, OP13-076 (PR 2)... ; Teach OP13-053 (lui-même compte, n° 4105) ; P-090 (n° 1000, 1986 ; PR 2) |
| **Erreur du traducteur** (corrigée) | OP12-028, OP12-034, ST12-003 (attribut relié par « or », n° 4102) ; OP06-043, OP04-055 (coût « 1 Personnage » des deux camps, n° 4103) |
| **Erreur du compilateur** (corrigée) | OP15-020 : « vous pouvez défausser 2 cartes. Si vous le faites » avec 1 carte en main (n° 4104) |
| **Erreur de la brique des recettes** (corrigée) | `handToDeck` « au-dessus ou au-dessous » carte par carte (n° 4106, OP11-054) |
| **Même jeu, écrit autrement** | OP06-055 (« ne peut pas activer [Bloqueur] » : `noBlocker` ↔ mot-clé [Imblocable] pour le combat, n° 1588) |
| **Même règles, question posée autrement** | OP10-103, P-105 (le code propose « dessus / dessous / non », la recette « oui / non » puis le côté) ; les 17 identiques à réponses fixes : OP03-050, OP03-054, OP03-055, OP07-036, OP08-069, OP10-107, OP10-113, OP12-090, OP13-019, OP13-031, OP13-053, OP13-076, OP15-020, OP15-088, OP17-049, OP17-068, ST21-017 |
| **Doute nouveau** | aucun |

Écarts du code sans effet sur le jeu, gardés : OP11-038, OP11-114 (« jusqu'à 1 de votre Leader » +3000 en [Contre] : le code
ne propose pas « aucun ») ; OP12-028 (l'activation demande le Leader [Roronoa Zoro] : sans lui, payer ne ferait rien) ;
Iceburg OP03-058 et Galley-La Company OP03-075 (activation gardée par l'utilité, n° 4108).

Recettes non compilées (code à la main, relu, juste) : EB03-048, OP07-033, OP17-018, ST21-011. Recettes identiques au code
avec un écart d'aller-retour (rédaction) : OP17-003, ST01-005, ST29-016.

## Cas connus du plan (a) à (o)

| Cas | Cartes | Où |
|---|---|---|
| Règle « Puis » (n° 1983), 17 cartes | hors decks : OP07-109, OP10-087, OP12-078, OP12-118, OP13-118, OP17-060, EB03-017, EB04-030 ; decks : OP09-078, OP11-066, OP14-020, OP15-074, OP15-075, OP15-076, EB02-011, ST22-015, ST34-002 | PR 1 / PR 2 |
| (a) au-dessus ou au-dessous, toutes ensemble (n° 1660) | hors decks : OP05-055, OP06-059, OP08-053, OP17-050, P-074 ; deck : OP15-066 | PR 1 / PR 2 |
| (b) « jusqu'à 1 » du deck vers la Vie (n° 3104) | hors decks : OP17-106... (voir la PR), EB03-054, EB03-055, OP15-109, OP15-113, OP15-116, OP09-105, OP08-069, OP08-119, OP03-114, OP03-077, OP03-102, OP03-109 ; decks : OP17-061, OP17-106, OP17-112, OP17-114, EB04-058, OP03-118, ST36-001, ST36-002, ST34-004 | PR 1 / PR 2 |
| (c) coût gardé par l'utilité (n° 1000) | `mayPay` local d'OP03 noires (PR 1, n° 4109) ; `withCost` → `mayPay` (question `mayIdle` quand l'effet ne peut rien faire) : 140 cartes hors decks (PR 1), le reste dans la PR 2 ; `payFor` d'OP03 vertes, `withCostIfUseful`, Alvida OP01-064, P-090 : PR 2 | PR 1 / PR 2 |
| (d) « seuls Personnages » à vide (n° 1902) | OP17-118 (META-XEBEC) | PR 2 |
| (e) coût à payer des cartes jouées de la main (n° 1986) | hors decks : 20 cartes (`playFromHandAtCost`) et OP08-059, OP08-062, OP15-073, ST12-003 (code propre) ; decks : OP07-064, ST33-004 et les autres | PR 1 / PR 2 |
| (f) « If you have [Nom] » et le Leader (n° 1992) | ST30-016 dit « Characters » (rien à changer) ; OP02-052, OP03-027 : aucun Leader ne porte ces noms (même jeu) | rien |
| (g) coût qui retire un Personnage sans `leave` (n° 1991) | seul cas trouvé : l'[Arche Noah] de `meta-mihawk.ts` (coût de Jinbe) | PR 2 |
| (h) « peut être activé » (n° 1980) | PRB02-004 (PR 1) ; OP16-041, OP16-048 (decks de l'aventure) | PR 1 / PR 2 |
| (i) n° 1741 pour ses propres DON!! | les règles 8-3-1-6 et 10-2-10-1 disent que le joueur choisit : n° 4107, **pas corrigé** (moteur commun) | plus tard |
| (j) « jusqu'à N » DON!! (n° 1994), 127 cartes au balayage | hors decks : 74 (briques `addDonUpTo`, `readyDonUpTo`, `giveDonUpTo`) ; decks : le reste ; « à la fin de ce tour » (OP13-038, OP14-031, EB02-015) : pas corrigé (action différée du moteur) | PR 1 / PR 2 / plus tard |
| (k) Alvida OP01-064, `payFor` d'OP03 vertes | decks de l'aventure | PR 2 |
| (l) P-074, P-103 | P-074 : n° 1660 ; P-103 (et OP07-053, OP08-050, Moby Dick OP08-056) : toutes ensemble (n° 4106) | PR 1 |
| (m) P-090 Smoothie | ST-34 | PR 2 |
| (n) KO de tous avec Rosinante (n° 1995) | seul cas : Kaido & Linlin OP08-119 (`replacersLast`) | PR 1 |
| (o) OP13-064 Gol D. Roger | lecture 1 de l'utilisateur, aura `negateAura` lue par `isNegated` (n° 4110) ; carte de l'étape C, dans aucun deck | PR 1 |
| `koTotalPower` (§ 15.9) | OP05-007 : une puissance négative compte (n° 4111) | PR 1 |

Réponses de l'utilisateur appliquées : **OP01-099** (lecture 2, champ `koShieldBoth`, n° 4100) et **P-008** (lecture 1,
`verified`, n° 4101). Toutes les cartes du catalogue sont jouables sauf les 4 que le moteur ne sait pas dire (EB05-052,
OP15-025, OP15-092, OP15-093).

## Parties au hasard (cartes non comparées)

Voir la PR 1 (résultat de `cards-audit.ts --hasard`).

## Reste à faire (CF.3 ou plus tard)

- **n° 4107** : DON!! −N et « renvoyez N DON!! » : le joueur choisit lesquelles (règles 8-3-1-6, 10-2-10-1) ; aujourd'hui
  l'ordre fixe du n° 1741. Change le moteur pour toutes les cartes : tâche à part.
- « Redressez jusqu'à N DON!! **à la fin de ce tour** » (OP13-038, OP14-031, EB02-015) : l'action différée du moteur redresse
  le maximum sans question.
- Les 223 cartes que le traducteur ne lit pas restent vérifiées par leurs tests, la relecture et les parties au hasard ; les
  56 sans moment déclenché par le banc (effets permanents, réactions) aussi.
- Après la PR 2 : **réentraîner l'IA entraînée** (le jeu des decks du registre change).
