// Arc 2 de l'aventure : Alabasta, de Reverse Mountain à Alubarna, 7 chapitres et 2 défis bonus (tâche 5.5). Squelette
// posé par la tâche 5.1 ; la tâche 5.7 ajoute l'arc à ARCS (game/adventure/arcs.ts) et l'affiche.
// Textes écrits par nous, jamais de citation du manga ou de l'anime ; scénario, choix des decks et récompenses :
// game/docs/aventure-alabasta.md. Les adversaires jouent les decks AV-AL-<NOM> (decks-alabasta.ts) ; le joueur garde son
// deck (aucun deck offert). Les identifiants des chapitres servent de clé en base : ne pas les changer.
// Niveaux (tâche 5.8) : tout l'arc au niveau Débutant, comme East Blue ; la difficulté vient des listes (mesures dans
// game/docs/aventure-alabasta.md, scripts/game/adventure-balance.ts --arc alabasta).
import { ECONOMY } from '../economy/config.ts';
import type { Arc, Reward } from './types.ts';

const boosters = (count: number): Reward[] => [{ kind: 'booster', set: 'OP04', count }];
// Berry de la première victoire (barème de game/economy/config.ts) : chapitre, dernier chapitre, défi bonus
const berry = (amount: number): Reward => ({ kind: 'berry', amount });
const { firstWin, firstWinFinal, firstWinBonus } = ECONOMY.adventure;
// Un membre d'équipage qui rejoint Luffy : une carte rouge, jouable dans le deck de départ (ST-01, rouge)
const recruit = (number: string): Reward => ({ kind: 'card', number, count: 1 });

// Portraits des personnages (illustration d'une carte jouable)
const LUFFY = 'ST01-001';
const ZORO = 'ST01-013';
const NAMI = 'ST01-007';
const USOPP = 'OP03-041';
const SANJI = 'ST01-004';
const CHOPPER = 'EB01-006';
const VIVI = 'OP04-118';
const WEDNESDAY = 'EB01-034';   // Vivi tant qu'elle se cache dans Baroque Works
const IGARAM = 'OP04-002';
const CROCODILE = 'OP14-120';
const ALL_SUNDAY = 'OP14-084';
const SMOKER = 'OP10-030';
const TASHIGI = 'OP10-032';

export const ALABASTA: Arc = {
  id: 'alabasta',
  title: 'Alabasta',
  region: 'grand-line',
  boosterSet: 'OP04',
  requiresArc: 'east-blue',
  chapters: [
    {
      id: 'al-1-reverse-mountain',
      order: 1,
      title: 'La baleine du cap des Jumeaux',
      place: 'Reverse Mountain',
      map: { x: 0.94, y: 0.3 },
      opponent: { name: 'Mr. 9 et Miss Wednesday', deck: 'AV-AL-MR9', level: 1 },
      requires: ['eb-6-loguetown'],
      intro: [
        { who: '', text: 'Le navire a remonté le courant de Reverse Mountain et dévalé l’autre versant. Au pied de la montagne, une baleine géante cogne la Red Line depuis des dizaines d’années.' },
        { who: 'Crocus', card: 'OP12-003', text: 'Laboon attend un équipage qui avait promis de revenir. Je veille sur lui… et sur sa tête.' },
        { who: 'Mr. 9', card: 'EB01-037', text: 'Une baleine pareille, c’est de la viande pour toute une ville ! Miss Wednesday, en position !' },
        { who: 'Miss Wednesday', card: WEDNESDAY, text: 'Ces pirates ont l’air bien naïfs. Ils ne nous gêneront pas longtemps.' },
        { who: 'Luffy', card: LUFFY, text: 'Personne ne touche à Laboon ! Vous deux, vous allez nager jusqu’au large.' },
      ],
      victory: [
        { who: 'Mr. 9', card: 'EB01-037', text: 'Retraite ! On se retrouvera à Whisky Peak, chapeau de paille !' },
        { who: 'Luffy', card: LUFFY, text: 'Laboon, on fera un vrai combat quand je reviendrai. Promis : je suis ton rival, maintenant !' },
        { who: 'Crocus', card: 'OP12-003', text: 'Prenez ce Log Pose. Sur Grand Line, une boussole ne vous servirait à rien.' },
        { who: 'Nami', card: NAMI, text: 'Il faut suivre l’aiguille d’île en île… Cap sur Whisky Peak.' },
      ],
      defeat: [
        { who: 'Miss Wednesday', card: WEDNESDAY, text: 'Trop facile. Mr. 9, la baleine est à nous.' },
        { who: 'Crocus', card: 'OP12-003', text: 'Grand Line ne pardonne pas l’hésitation, gamin. Relève-toi.' },
        { who: 'Luffy', card: LUFFY, text: 'Je ne les laisserai pas faire de mal à Laboon. On y retourne !' },
      ],
      rewards: [...boosters(2), berry(firstWin)],
    },
    {
      id: 'al-2-whisky-peak',
      order: 2,
      title: 'Cent chasseurs de primes',
      place: 'Whisky Peak',
      map: { x: 0.83, y: 0.8 },
      opponent: { name: 'Mr. 5 et Miss Valentine', deck: 'AV-AL-MR5', level: 1 },
      intro: [
        { who: '', text: 'À Whisky Peak, toute la ville fête l’arrivée des pirates. Le soir venu, les sourires tombent : ce sont tous des chasseurs de primes.' },
        { who: 'Zoro', card: ZORO, text: 'Une fête, des cadeaux, et cent sabres derrière les rideaux. Je m’en doutais.' },
        { who: 'Igaram', card: IGARAM, text: 'Miss Wednesday est en réalité la princesse Vivi d’Alabasta. Je vous en prie, protégez-la !' },
        { who: 'Mr. 5', card: 'OP04-072', text: 'La princesse connaît le visage de notre patron. Ordre de Mr. 0 : elle ne quitte pas cette île.' },
        { who: 'Miss Valentine', card: 'OP04-066', text: 'Légère comme une plume, lourde comme dix tonnes ! Kya ha ha !' },
      ],
      victory: [
        { who: 'Mr. 5', card: 'OP04-072', text: 'Battus par des pirates de l’East Blue… Mr. 0 ne nous le pardonnera pas.' },
        { who: 'Vivi', card: VIVI, text: 'Le chef de Baroque Works est Crocodile, l’un des grands corsaires. Il veut s’emparer de mon royaume.' },
        { who: 'Luffy', card: LUFFY, text: 'Alors on t’emmène chez toi. Montez tous, cap sur Alabasta !' },
        { who: '', text: 'Vivi et son canard Karoo embarquent sur le Vogue Merry.' },
      ],
      defeat: [
        { who: 'Miss Valentine', card: 'OP04-066', text: 'Écrasés ! Allez, la princesse maintenant.' },
        { who: 'Vivi', card: WEDNESDAY, text: 'Fuyez, ce n’est pas votre combat !' },
        { who: 'Luffy', card: LUFFY, text: 'Si, c’est le mien. On recommence !' },
      ],
      rewards: [...boosters(2), berry(firstWin)],
    },
    {
      id: 'al-3-little-garden',
      order: 3,
      title: 'L’île des géants',
      place: 'Little Garden',
      map: { x: 0.71, y: 0.2 },
      opponent: { name: 'Mr. 3 et Miss Goldenweek', deck: 'AV-AL-MR3', level: 1 },
      intro: [
        { who: '', text: 'Little Garden, une île restée au temps des dinosaures. Deux géants s’y battent en duel depuis un siècle, sans vainqueur.' },
        { who: 'Dorry', card: 'OP17-085', text: 'Gyagya ! Des petits humains ! Venez, buvons à l’honneur des guerriers.' },
        { who: 'Brogy', card: 'OP17-092', text: 'Notre duel n’a pas besoin de spectateurs. Mais vous avez l’air d’avoir du cœur.' },
        { who: 'Mr. 3', card: 'OP04-070', text: 'Un piège de cire, un peu de patience, et l’équipage entier finira en statues. Quel génie je fais.' },
        { who: 'Miss Goldenweek', card: 'OP04-065', text: 'Une couleur sur vous, et vous n’aurez plus envie de bouger. Je prends un thé en attendant.' },
      ],
      victory: [
        { who: 'Mr. 3', card: 'OP04-070', text: 'Ma cire… fondue ? Mais qui a eu l’idée d’allumer un feu ?' },
        { who: 'Usopp', card: USOPP, text: 'C’était moi ! Enfin… surtout Luffy. Mais l’idée était de moi.' },
        { who: 'Brogy', card: 'OP17-092', text: 'Vous avez défendu l’honneur de notre duel. Partez, et que la mer vous soit douce !' },
        { who: 'Nami', card: NAMI, text: 'Luffy… je ne me sens pas très bien. J’ai de la fièvre.' },
      ],
      defeat: [
        { who: 'Mr. 3', card: 'OP04-070', text: 'Restez sages dans votre cire. Mr. 0 sera ravi de la collection.' },
        { who: 'Zoro', card: ZORO, text: 'Je ne sens plus mes pieds. Luffy, trouve quelque chose, vite.' },
        { who: 'Luffy', card: LUFFY, text: 'Je vais faire fondre tout ça. Encore une fois !' },
      ],
      rewards: [...boosters(2), berry(firstWin)],
    },
    {
      id: 'al-4-drum',
      order: 4,
      title: 'Le royaume sans médecins',
      place: 'Royaume de Drum',
      map: { x: 0.59, y: 0.75 },
      opponent: { name: 'Wapol', deck: 'AV-AL-WAPOL', level: 1 },
      intro: [
        { who: '', text: 'Nami brûle de fièvre. Sur l’île enneigée de Drum, il ne reste qu’une seule doctoresse, tout en haut de la montagne.' },
        { who: 'Dr. Kureha', card: 'OP08-015', text: 'Je soigne qui je veux, quand je veux. Et j’ai un renne qui parle pour assistant.' },
        { who: 'Chopper', card: CHOPPER, text: 'Je ne suis pas un monstre ! Je suis un médecin… enfin, je vais le devenir.' },
        { who: 'Wapol', card: 'OP08-014', text: 'Je suis revenu reprendre MON royaume ! Chess, Kuromarimo, croquez-moi tout ça !' },
        { who: 'Dalton', card: 'OP08-008', text: 'Ce roi a fui quand son peuple avait besoin de lui. Il ne remontera pas sur le trône.' },
      ],
      victory: [
        { who: 'Wapol', card: 'OP08-014', text: 'Mon château… mon royaume… Je vais tout manger de rage !' },
        { who: 'Dalton', card: 'OP08-008', text: 'Drum va renaître. Merci, chapeau de paille.' },
        { who: 'Luffy', card: LUFFY, text: 'Chopper, tu viens avec nous ! Tu seras notre médecin.' },
        { who: 'Chopper', card: CHOPPER, text: 'Moi ? Un renne au nez bleu ? … D’accord ! Je monte à bord !' },
        { who: '', text: 'Tony Tony Chopper rejoint l’équipage.' },
      ],
      defeat: [
        { who: 'Wapol', card: 'OP08-014', text: 'Ha ha ! Personne ne résiste au grand Wapol et à sa bouche de fer !' },
        { who: 'Sanji', card: SANJI, text: 'Nami a besoin d’un médecin. On ne redescend pas cette montagne sans elle.' },
        { who: 'Luffy', card: LUFFY, text: 'Je grimpe encore. Ce roi-là ne gagnera pas deux fois.' },
      ],
      rewards: [...boosters(2), recruit('EB01-006'), berry(firstWin)],
    },
    {
      id: 'al-defi-ace',
      order: 4.5,
      title: 'Défi : les Poings ardents',
      place: 'Nanohana',
      map: { x: 0.48, y: 0.1 },
      opponent: { name: 'Ace', deck: 'AV-AL-ACE', level: 1 },
      optional: true,
      intro: [
        { who: '', text: 'Nanohana, port d’Alabasta. Dans une gargote, un homme s’endort au milieu de son repas, puis se réveille comme si de rien n’était.' },
        { who: 'Ace', card: 'OP02-013', text: 'Alors c’est toi, l’équipage de mon petit frère ? Merci de veiller sur lui.' },
        { who: 'Luffy', card: LUFFY, text: 'Ace ! Viens, on se fait un combat comme quand on était petits !' },
        { who: 'Ace', card: 'OP02-013', text: 'Comme tu veux. Mais je ne retiendrai pas mes flammes.' },
      ],
      victory: [
        { who: 'Ace', card: 'OP02-013', text: 'Tu as bien grandi, Luffy. La prochaine fois, ce sera au sommet.' },
        { who: 'Luffy', card: LUFFY, text: 'Je deviendrai le roi des pirates, Ace. Tu verras !' },
        { who: 'Ace', card: 'OP02-013', text: 'J’ai une piste à suivre. Prends soin de tes amis, petit frère.' },
      ],
      defeat: [
        { who: 'Ace', card: 'OP02-013', text: 'Tu fonces toujours tête baissée. Ça, ça n’a pas changé.' },
        { who: 'Luffy', card: LUFFY, text: 'Je n’ai jamais gagné contre toi… mais ça va changer !' },
        { who: 'Ace', card: 'OP02-013', text: 'Je t’attends. Prends ton temps.' },
      ],
      rewards: [...boosters(3), berry(firstWinBonus)],
    },
    {
      id: 'al-5-yuba',
      order: 5,
      title: 'La princesse et le désert',
      place: 'Yuba',
      map: { x: 0.4, y: 0.85 },
      opponent: { name: 'Vivi', deck: 'AV-AL-VIVI', level: 1 },
      intro: [
        { who: '', text: 'Yuba n’est plus qu’une oasis ensevelie. Les rebelles sont partis, et la guerre est pour demain.' },
        { who: 'Vivi', card: VIVI, text: 'Je dois arrêter cette guerre sans que personne ne meure. Seule, s’il le faut.' },
        { who: 'Luffy', card: LUFFY, text: 'Tu ne peux pas sauver tout le monde sans risquer ta vie. Et nous, on est là pour quoi ?' },
        { who: 'Koza', card: 'OP04-006', text: 'Le roi a trahi son peuple. L’armée rebelle ne reculera plus.' },
        { who: 'Pell', card: 'OP04-013', text: 'Princesse, je vous suivrai jusqu’au bout. Mais écoutez-le : il a raison.' },
      ],
      victory: [
        { who: 'Vivi', card: VIVI, text: 'Pardon. Vous êtes mes amis, et je voulais tout porter seule.' },
        { who: 'Luffy', card: LUFFY, text: 'Alors on y va ensemble. On commence par Crocodile.' },
        { who: 'Chopper', card: CHOPPER, text: 'Il est où, ce Crocodile ? Je vais lui apprendre, moi !' },
        { who: 'Nami', card: NAMI, text: 'À Rainbase, dans son casino. Et je parie que la Marine est déjà là.' },
      ],
      defeat: [
        { who: 'Vivi', card: VIVI, text: 'Laissez-moi partir. Je n’ai pas le droit de vous entraîner là-dedans.' },
        { who: 'Usopp', card: USOPP, text: 'Elle est plus têtue que Luffy… Ça promet.' },
        { who: 'Luffy', card: LUFFY, text: 'Je ne te laisserai pas partir seule. On recommence.' },
      ],
      rewards: [...boosters(2), berry(firstWin)],
    },
    {
      id: 'al-6-rainbase',
      order: 6,
      title: 'Le casino de Rainbase',
      place: 'Rainbase',
      map: { x: 0.28, y: 0.2 },
      opponent: { name: 'Smoker', deck: 'AV-AL-SMOKER', level: 1 },
      intro: [
        { who: '', text: 'Rainbase, ville de jeu au milieu du désert. Le casino de Crocodile brille de mille feux, et la Marine encercle la ville.' },
        { who: 'Smoker', card: SMOKER, text: 'Je t’avais dit que je te retrouverais sur Grand Line, chapeau de paille.' },
        { who: 'Tashigi', card: TASHIGI, text: 'Capitaine, ils cherchent Crocodile. Et si c’était vrai, ce qu’ils racontent sur lui ?' },
        { who: 'Smoker', card: SMOKER, text: 'Un corsaire reste un pirate. Mais d’abord, celui-là.' },
        { who: 'Luffy', card: LUFFY, text: 'Je n’ai pas le temps pour toi, monsieur Fumée. Pousse-toi !' },
      ],
      victory: [
        { who: 'Smoker', card: SMOKER, text: 'Va. Cette fois, je ferme les yeux. Ne t’y habitue pas.' },
        { who: 'Ms. All Sunday', card: ALL_SUNDAY, text: 'Monsieur Zéro vous attend. Le spectacle va bientôt commencer.' },
        { who: 'Vivi', card: VIVI, text: 'Crocodile part pour Alubarna. La rébellion y sera demain matin !' },
        { who: 'Luffy', card: LUFFY, text: 'Alors on court. Tout le monde à Alubarna !' },
      ],
      defeat: [
        { who: 'Smoker', card: SMOKER, text: 'Fin de la route. Les menottes sont en granit marin.' },
        { who: 'Zoro', card: ZORO, text: 'Ce type nous tombe dessus à chaque escale. On s’en débarrasse pour de bon.' },
        { who: 'Luffy', card: LUFFY, text: 'Encore une fois. Vivi n’a pas le temps d’attendre.' },
      ],
      rewards: [...boosters(3), berry(firstWin)],
    },
    {
      id: 'al-defi-agents',
      order: 6.5,
      title: 'Défi : les agents d’élite',
      place: 'Alubarna',
      map: { x: 0.07, y: 0.15 },
      opponent: { name: 'Mr. 1 et les agents d’élite', deck: 'AV-AL-AGENTS', level: 1 },
      optional: true,
      intro: [
        { who: '', text: 'Aux portes d’Alubarna, les agents d’élite de Baroque Works barrent la route, chacun à un carrefour.' },
        { who: 'Mr. 1', card: 'OP05-075', text: 'Mon corps tout entier est une lame. Choisissez qui passe en premier.' },
        { who: 'Miss Doublefinger', card: 'OP05-073', text: 'Des pirates d’East Blue jusqu’ici ? Voilà qui m’amuse.' },
        { who: 'Mr. 2', card: 'OP04-069', text: 'Un ami, un ennemi, quelle différence quand on a tous les visages ? Pirouette !' },
        { who: 'Zoro', card: ZORO, text: 'Celui qui coupe tout, c’est pour moi. Les autres, partagez-vous le reste.' },
      ],
      victory: [
        { who: 'Mr. 1', card: 'OP05-075', text: 'Couper l’acier… Tu es devenu plus fort en plein combat.' },
        { who: 'Mr. 2', card: 'OP04-069', text: 'Vous êtes de drôles de pirates. Si on se revoit, je serai de votre côté !' },
        { who: 'Luffy', card: LUFFY, text: 'Plus personne entre Crocodile et nous !' },
      ],
      defeat: [
        { who: 'Miss Doublefinger', card: 'OP05-073', text: 'Trop lents. Baroque Works ne recrute que les meilleurs.' },
        { who: 'Sanji', card: SANJI, text: 'Chacun son adversaire, et cette fois sans traîner.' },
        { who: 'Luffy', card: LUFFY, text: 'On revient. On ne laissera personne sur le bord de la route.' },
      ],
      rewards: [...boosters(3), berry(firstWinBonus)],
    },
    {
      id: 'al-7-alubarna',
      order: 7,
      title: 'Le roi des sables',
      place: 'Alubarna',
      map: { x: 0.155, y: 0.7 },
      opponent: { name: 'Crocodile', deck: 'AV-AL-CROCODILE', level: 1 },
      intro: [
        { who: '', text: 'Alubarna, la capitale. Rebelles et soldats du roi se jettent les uns sur les autres sur la grand-place.' },
        { who: 'Crocodile', card: CROCODILE, text: 'Un royaume qui s’entretue, une arme cachée sous le palais. Tout se déroule comme prévu.' },
        { who: 'Vivi', card: VIVI, text: 'Tu as volé la pluie de mon pays et la confiance de mon peuple. Rends-les !' },
        { who: 'Crocodile', card: CROCODILE, text: 'Les idéaux ne servent à rien dans le désert, princesse. Seule la force compte.' },
        { who: 'Luffy', card: LUFFY, text: 'Je vais te battre, Crocodile. Et la pluie reviendra.' },
      ],
      victory: [
        { who: 'Crocodile', card: CROCODILE, text: 'Battu… par un gamin qui ne sait même pas ce qu’il cherche.' },
        { who: '', text: 'Pour la première fois depuis des années, la pluie tombe sur Alabasta. Les armes se taisent.' },
        { who: 'Vivi', card: VIVI, text: 'Je reste ici : mon peuple a besoin de moi. Mais où que vous soyez, je serai de votre équipage.' },
        { who: 'Luffy', card: LUFFY, text: 'Tu restes notre amie, Vivi. Pour toujours !' },
        { who: '', text: 'Vivi offre sa carte à l’équipage en souvenir.' },
      ],
      defeat: [
        { who: 'Crocodile', card: CROCODILE, text: 'Tu n’es qu’un grain de sable de plus dans mon désert.' },
        { who: 'Vivi', card: VIVI, text: 'Luffy ! Relève-toi, je t’en prie…' },
        { who: 'Luffy', card: LUFFY, text: 'Je ne suis pas encore sec. On recommence !' },
      ],
      rewards: [...boosters(4), recruit('OP04-118'), berry(firstWinFinal)],
    },
  ],
};
