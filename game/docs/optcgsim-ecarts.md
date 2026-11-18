# Parties croisées : écarts relevés aux essais réels (tâche O3.2)

Chaque écart vu pendant une vraie partie depuis le site (ou au banc) : ce qui s'est passé, la cause, la correction et
le test qui le rejoue sur faux transport (aucun accès réseau). Les cas où OPTCGSim et joy-boy appliquent une règle
différemment sont des **interprétations** (`interpretations.md`, plage 4500–4599), pas des écarts.

## Pour diagnostiquer une partie du site

Lancer le serveur d'essai avec `TCGC_CROSSPLAY_JOURNAL` (dossier **hors du dépôt**, refusé sinon) :

```powershell
$env:TCGC_CROSSPLAY_JOURNAL='C:\Users\nicol\Desktop\optcgsim\journaux-site'
```

Chaque partie y écrit `site-<date>-<n° court>.log` : tous les lots échangés (octets complets, RPC décodées), les lignes
de la session (`>>>`) et un `BILAN`, au format du banc. Le nom du fichier apparaît dans la sortie du serveur
(« … rejoint une salle OPTCGSim (journal : site-….log) »). Le journal contient des pseudos : pour en faire une fixture,
`node scripts/optcgsim/anonymiser.mjs "<journal>"`. Sans la variable, rien n'est écrit (comme avant).

## Écarts

| N° | Date, partie | Ce qui s'est passé | Cause | Correction | Test |
|---|---|---|---|---|---|
| 1 | 18 nov., V1tUm_ et xO4s0d (site, Sabo contre Sabo) | Le joueur joy-boy pose Sanji OP17-082 ([Jouée] pioche 2, défausse 2) : il pioche, puis la défausse ne lui est jamais proposée ; 20 s plus tard le garde-fou finit son tour (« session figée … décision 1/effect/discard, backlog 5 »), puis la partie se dérègle (SetupAttack de l'hôte ignoré, nouvelles mutations en attente). | Les échos de ses propres actions (pose, pioche, DON!!) arrivent pendant la question d'effet du moteur ; inbound les garde en attente jusqu'à la réponse (`drain` : rien ne s'applique au milieu d'un effet) et la session cachait toute décision tant que des mutations attendaient : chacun attendait l'autre. Le banc ne le voyait pas (l'IA répond avant le retour des échos). | `session.ts` (`actionable`) : une question d'effet du joueur joy-boy est montrée même avec des mutations en attente (elles ne peuvent s'appliquer qu'après sa réponse). Garde-fou : une décision montrée au joueur n'est jamais « figée » (un humain prend son temps, le chrono d'absence de 10 min s'en charge) ; une question d'effet retenue est relevée comme écart, sans fin de tour forcée au milieu de l'effet. Même règle dans le pilote du banc. | `essai-site-sanji.test.ts` (partie miroir, deck META-SABO-2026-10 des deux côtés, l'hôte joue aussi Sanji, réponse après réflexion et réponse immédiate) ; `essai-site-sanji-serveur.test.ts` (flux temps réel et `/act`, journal du site). |
| 2 | 18 nov., 16 h 30 (site, journal `site-…-xVUnQX`) | L'hôte pose Loki OP17-119 et vise Zoro OP17-095 et Sanji OP17-082 du joueur joy-boy : la partie s'arrête (« session figée … tour 7 à l'hôte, décision 0/main »). | Zoro peut empêcher un retrait (« à la place ») : le jeu ne met rien KO lui-même, il met les deux Personnages en file (`QueueOpponentPlayerSaveQueue`), passe la main (`SwitchTurns`) et transmet la réaction (`ProcOpponentV3Action`, `TriggerOpponentMultiActions`) ; c'est le client de joy-boy qui doit retirer les Personnages restés en file et rendre la main. La session ignorait ces RPC : chacun attendait l'autre. | `reaction.ts` + `session.ts` : la réaction est déclinée (interprétation 4500), les Personnages en file sont mis KO dans le moteur (leurs [En cas de KO] compris), `DiscardFromSelfDeploy` part pour chacun, puis `AllOnKOResolved`, `SwitchTurns`, `ResetActionPhase`, `NoMorePendingActions`. **Limite** : le remplacement de Zoro n'est pas proposé au joueur ; les actions forcées par OPTCGSim (`bForcedOpp`) sont seulement notées. | `essai-site-loki.test.ts` (fixture anonymisée `essais/site-2026-11-18-1630.json` ; faux hôte qui pose Loki et attend la main). |
