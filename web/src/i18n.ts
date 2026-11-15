// Traductions de l'interface (français / anglais).
// Une entrée est un texte, ou une paire [singulier, pluriel] choisie selon la variable `n`.
// Les variables s'écrivent {nom} dans le texte : t('scan.noMatch', { q: 'OP14' }).

export type UiLang = 'fr' | 'en';
type Entry = string | readonly [string, string];

const fr = {
  'app.name': 'Ma Collection',
  'tab.collection': 'Collection',
  'tab.scan': 'Scanner',
  'tab.catalog': 'Catalogue',
  'tab.stats': 'Stats',
  'tab.play': 'Jouer',
  'tab.profile': 'Profil',
  'play.frenchOnly': 'Le jeu n’existe pour l’instant qu’en français.',

  'auth.tagline': 'Scanne tes cartes One Piece, suis ta collection et sa valeur.',
  'auth.login': 'Connexion',
  'auth.signup': 'Inscription',
  'auth.identifier': 'E-mail ou pseudo',
  'auth.pseudo': 'Pseudo',
  'auth.pseudoHint': '3 à 24 caractères : lettres, chiffres, . _ -',
  'auth.email': 'Adresse e-mail',
  'auth.password': 'Mot de passe',
  'auth.passwordHint': '8 caractères minimum',
  'auth.show': 'Afficher',
  'auth.hide': 'Masquer',
  'auth.submitLogin': 'Se connecter',
  'auth.submitSignup': 'Créer mon compte',
  'auth.welcome': 'Bienvenue {pseudo} !',
  'auth.tryGuest': 'Essayer sans compte',
  'auth.tryGuestHint': 'Rien à remplir. Tu crées ton compte quand tu veux, tes cartes sont gardées.',
  'auth.haveAccount': 'Déjà un compte ? Ou envie de le créer tout de suite :',
  'auth.upgradeTitle': 'Crée ton compte',
  'auth.upgradeText': 'Ta collection, tes recherches et ta progression dans le jeu sont gardées.',
  'auth.upgradeLater': 'Plus tard',
  'guest.create': 'Créer mon compte',
  'guest.home': 'Tu es en mode essai. Crée ton compte pour garder ta collection et la retrouver sur tous tes appareils.',
  'guest.members': 'Crée ton compte pour partager ta collection et échanger avec les autres membres.',

  'error.unauthorized': 'Connecte-toi pour continuer',
  'error.members_only': 'Crée ton compte pour utiliser cette fonction',
  'error.not_guest': 'Ton compte est déjà créé',
  'error.invalid_credentials': 'E-mail, pseudo ou mot de passe incorrect',
  'error.pseudo_taken': 'Ce pseudo est déjà pris',
  'error.email_taken': 'Un compte existe déjà avec cette adresse e-mail',
  'error.email_check': 'Cette adresse e-mail ne peut pas servir pour un nouveau compte. Si elle est à toi, un e-mail vient d’y être envoyé pour t’aider à retrouver ton compte.',
  'error.invalid_pseudo': 'Pseudo invalide : 3 à 24 caractères (lettres, chiffres, . _ -)',
  'error.invalid_email': 'Adresse e-mail invalide',
  'error.weak_password': 'Le mot de passe doit faire au moins 8 caractères',
  'error.too_many_attempts': 'Trop de tentatives, réessaie dans quelques minutes',
  'error.wrong_password': 'Mot de passe incorrect',
  'error.account_disabled': 'Ce compte est suspendu. Contacte l’équipe du site.',
  'error.admin_only': 'Réservé aux administrateurs',
  'error.forbidden_origin': 'Requête refusée',

  'common.close': 'Fermer',
  'count.cards': ['{n} carte', '{n} cartes'],

  'lang.label': 'Langue',
  'lang.fr': 'Français',
  'lang.en': 'Anglais',
  'lang.all': 'Toutes langues',

  'error.http': 'Erreur {n}',
  'error.network': 'Pas de connexion au serveur. Vérifie ton réseau et réessaie.',
  'error.unavailable': 'Le serveur ne répond pas pour le moment. Réessaie dans un instant.',
  'error.load': 'Impossible de charger cette page.',
  'error.screen': 'Cet écran n’a pas pu s’afficher. Une nouvelle version du site vient peut-être d’être mise en ligne : recharge la page.',
  'error.retry': 'Réessayer',
  'error.reload': 'Recharger',
  'update.ready': 'Nouvelle version disponible',
  'update.reload': 'Recharger',
  'error.unknown_card': 'Carte inconnue',
  'error.invalid_quantity': 'Quantité invalide',
  'error.invalid_lang': 'Langue invalide',
  'error.no_image': 'Aucune image reçue',
  'error.index_building': 'La reconnaissance est en cours de préparation ({indexed}/{total})',
  'error.server': 'Erreur interne du serveur',

  'color.Red': 'Rouge',
  'color.Green': 'Vert',
  'color.Blue': 'Bleu',
  'color.Purple': 'Violet',
  'color.Black': 'Noir',
  'color.Yellow': 'Jaune',

  'sort.number': 'Par numéro',
  'sort.code': 'Par code',
  'sort.price': 'Plus chères',
  'sort.priceAsc': 'Moins chères',
  'sort.set': 'Par set',
  'sort.color': 'Par couleur',
  'sort.rarity': 'Par rareté',
  'sort.name': 'Par nom',
  'sort.added': 'Derniers ajouts',
  'sort.recent': 'Plus récentes',

  'chart.aria': 'Évolution de la valeur',

  'stat.cost': 'Coût',

  'stats.uiLang': "Langue de l'interface",
  'error.invalid_csv': "Fichier non reconnu : utilise un export CSV de TCGC",

  'cam.title': 'Caméra en direct sur Android',
  'cam.intro': "Chrome n'autorise la caméra en direct (et l'installation comme appli) que sur une adresse sécurisée. Comme l'appli tourne sur ton PC en http://, il faut déclarer cette adresse comme sûre, une seule fois :",
  'cam.step1': 'Dans Chrome sur le téléphone, ouvre',
  'cam.step2a': 'Mets le réglage sur',
  'cam.step2b': 'et écris dans le champ :',
  'cam.step3a': 'Appuie sur',
  'cam.step3b': "en bas de l'écran",
  'cam.step4a': "Reviens ici : l'onglet Scanner affiche la caméra. Menu ⋮ ▸",
  'cam.install': "Installer l'application",
  'cam.step4b': "pour l'avoir sur l'écran d'accueil.",
  'cam.note': "Sans ça, le scan marche quand même : il passe par l'appareil photo du téléphone.",

  'scan.lessAria': 'Un exemplaire de moins',
  'scan.moreAria': 'Un exemplaire de plus',

  'insight.label.upcoming': 'Pas encore sortie',
  'insight.label.new': 'Nouveauté',
  'insight.label.new-falling': 'Patiente',
  'insight.label.rising': 'En hausse',
  'insight.label.falling': 'En baisse',
  'insight.label.good': 'Bon prix',
  'insight.label.stable': 'Prix stable',
  'insight.label.cheap': 'Petit prix',

  'wish.add': 'Je la cherche',
  'wish.added': 'Ajoutée à tes recherches',
  'wish.removed': 'Retirée de tes recherches',
  'wish.title': 'Dans mes recherches',
  'wish.remove': 'Retirer',
  'wish.lang': 'Langue recherchée',
  'wish.target': 'Mon prix cible',
  'wish.targetAria': 'Prix cible en euros',
  'wish.save': 'Enregistrer',
  'wish.saved': 'Prix cible enregistré',
  'wish.suggested': 'Proposé : {price}',
  'wish.useSuggested': 'Utiliser',
  'wish.help': "Reporte ce prix dans ta liste de souhaits Cardmarket et n'achète pas plus cher. Proposition : environ 10 % sous ses prix récents, 20 % quand le prix baisse ou que le set est récent.",
  'wish.reached': 'Sous ton prix cible !',
  'wish.gap': '{pct} au-dessus de ta cible',
  'wish.noTarget': 'Pas de prix cible',
  'wish.target.short': 'cible {price}',

  'set.rarity.leader': 'Leader',
  'hunts.deleteConfirm': "Supprimer la chasse « {name} » ? Ta collection n'est pas touchée.",
  'hunts.deleted': 'Chasse supprimée',
  'hunts.kind.any': 'Toutes',
  'hunts.kind.normal': 'Normales',
  'hunts.kind.special': 'Spéciales',
  'hunts.kind.alt': 'Alternatives',
  'hunts.kind.sp': 'SP',
  'hunts.kind.manga': 'Manga',
  'hunts.kind.fullart': 'Full Art',
  'hunts.kind.foil': 'Foil',
  'hunts.kindHint.special': 'Toutes les versions qui ne sont pas normales : alternatives, SP, Manga, Full Art, foils, promos…',
  'hunts.kindHint.alt': 'Illustrations alternatives (Alternate Art, Parallel)',
  'hunts.title.any': '{r}, toutes versions',
  'hunts.title.any.none': 'Toutes les cartes',
  'hunts.title.normal': '{r} normales',
  'hunts.title.normal.none': 'Cartes normales',
  'hunts.title.special': '{r} spéciales',
  'hunts.title.special.none': 'Versions spéciales',
  'hunts.title.alt': '{r} alt.',
  'hunts.title.alt.none': 'Alternatives',
  'hunts.title.sp': '{r} SP',
  'hunts.title.sp.none': 'SP',
  'hunts.title.manga': '{r} Manga',
  'hunts.title.manga.none': 'Manga',
  'hunts.title.fullart': '{r} Full Art',
  'hunts.title.fullart.none': 'Full Art',
  'hunts.title.foil': '{r} Foil',
  'hunts.title.foil.none': 'Foil',
  'set.wishedMissing': ['{n} carte ajoutée à tes recherches', '{n} cartes ajoutées à tes recherches'],
  'error.invalid_target': 'Prix cible invalide',

  'error.invalid_keep': "Nombre d'exemplaires invalide",
  'error.invalid_share': 'Réglage de partage invalide',
  'error.share_not_found': 'Lien de partage introuvable',

  'notify.title': 'Notifications',
  'notify.intro': 'Reçois une alerte sur ce téléphone quand une carte de tes recherches passe sous ton prix cible, et un résumé de ta collection chaque semaine.',
  'notify.enable': 'Activer sur cet appareil',
  'notify.enabled': 'Activées sur cet appareil',
  'notify.enabledToast': 'Notifications activées',
  'notify.disable': 'Désactiver sur cet appareil',
  'notify.disabledToast': 'Notifications désactivées sur cet appareil',
  'notify.targets': 'Prix cible atteint (recherches)',
  'notify.weekly': 'Résumé de la semaine',
  'notify.when': 'Les alertes partent après la mise à jour quotidienne des prix.',
  'notify.test': 'Envoyer un test',
  'notify.testSent': 'Notification de test envoyée',
  'notify.testNone': "Aucun appareil abonné : réactive les notifications",
  'notify.unsupported': "Notifications indisponibles ici : il faut l'appli en ligne (https) dans Chrome, idéalement installée sur l'écran d'accueil.",
  'notify.denied': 'Notifications bloquées pour ce site : autorise-les dans les réglages du navigateur (cadenas ▸ Autorisations).',
  'error.invalid_subscription': 'Abonnement aux notifications invalide',

  'notify.trades': 'Échanges possibles avec des membres',
  'error.invalid_trade': 'Texte trop long',

  'insight.label.banned': 'Bannissement',
  'notify.bans': 'Bannissements en tournoi (cartes que tu as ou cherches)',

  'auth.forgot': 'Mot de passe oublié ?',
  'auth.forgotTitle': 'Mot de passe oublié',
  'auth.forgotText': "Indique l'adresse e-mail de ton compte : tu recevras un lien pour choisir un nouveau mot de passe.",
  'auth.forgotSubmit': 'Envoyer le lien',
  'auth.forgotSent': "Si un compte existe avec cette adresse, un e-mail vient de partir. Le lien est valable 1 heure (pense à regarder dans les spams).",
  'auth.backToLogin': 'Retour à la connexion',
  'reset.title': 'Nouveau mot de passe',
  'reset.text': 'Choisis un nouveau mot de passe pour ton compte.',
  'reset.submit': 'Changer mon mot de passe',
  'reset.done': 'Mot de passe changé, tu es connecté',
  'error.invalid_reset': 'Lien invalide ou expiré : refais une demande de mot de passe oublié.',
  'error.mail_unavailable': "L'envoi d'e-mails n'est pas configuré sur ce site.",

  'legal.link': 'Mentions légales et confidentialité',
  'auth.privacy': 'Tes données servent uniquement à faire fonctionner ton compte :',

  'deck.title': 'Ajouter un deck préconstruit',
  'deck.pick': 'Choisis le deck pour débutant que tu as acheté :',
  'deck.fullList': 'liste complète',
  'deck.knownList': 'Liste du deck pré-remplie : vérifie avec tes cartes et ajuste si besoin. Les cartes du booster offert sont à scanner à part.',
  'deck.unknownList': "Bandai ne publie pas les quantités de ce deck : 1 exemplaire par carte est proposé. Ajuste avec tes cartes (51 cartes avec le Leader).",
  'deck.lang': 'Langue des cartes',
  'deck.back': 'Autres decks',
  'deck.submit': ['Ajouter {n} carte', 'Ajouter {n} cartes'],
  'deck.added': ['{code} : {n} carte ajoutée à ta collection', '{code} : {n} cartes ajoutées à ta collection'],
  'error.unknown_deck': 'Deck inconnu',
  'cardtype.Leader': 'Leader',
  'cardtype.Character': 'Personnage',
  'cardtype.Event': 'Événement',
  'cardtype.Stage': 'Lieu',
} as const satisfies Record<string, Entry>;

export type MessageKey = keyof typeof fr;

const en: { [K in MessageKey]: Entry } = {
  'app.name': 'My Collection',
  'tab.collection': 'Collection',
  'tab.scan': 'Scan',
  'tab.catalog': 'Catalog',
  'tab.stats': 'Stats',
  'tab.play': 'Play',
  'tab.profile': 'Profile',
  'play.frenchOnly': 'The card game is only available in French for now (French card texts).',

  'auth.tagline': 'Scan your One Piece cards, track your collection and its value.',
  'auth.login': 'Log in',
  'auth.signup': 'Sign up',
  'auth.identifier': 'Email or username',
  'auth.pseudo': 'Username',
  'auth.pseudoHint': '3 to 24 characters: letters, digits, . _ -',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.passwordHint': 'At least 8 characters',
  'auth.show': 'Show',
  'auth.hide': 'Hide',
  'auth.submitLogin': 'Log in',
  'auth.submitSignup': 'Create my account',
  'auth.welcome': 'Welcome {pseudo}!',
  'auth.tryGuest': 'Try without an account',
  'auth.tryGuestHint': 'Nothing to fill in. Create your account whenever you like, your cards are kept.',
  'auth.haveAccount': 'Already have an account? Or want to create it right away:',
  'auth.upgradeTitle': 'Create your account',
  'auth.upgradeText': 'Your collection, your wants and your game progress are kept.',
  'auth.upgradeLater': 'Later',
  'guest.create': 'Create my account',
  'guest.home': 'You are trying the app. Create your account to keep your collection and find it on all your devices.',
  'guest.members': 'Create your account to share your collection and trade with other members.',

  'error.unauthorized': 'Please log in to continue',
  'error.members_only': 'Create your account to use this feature',
  'error.not_guest': 'Your account is already created',
  'error.invalid_credentials': 'Incorrect email, username or password',
  'error.pseudo_taken': 'This username is already taken',
  'error.email_taken': 'An account already exists with this email address',
  'error.email_check': 'This email address can’t be used for a new account. If it is yours, we just sent it a message to help you get your account back.',
  'error.invalid_pseudo': 'Invalid username: 3 to 24 characters (letters, digits, . _ -)',
  'error.invalid_email': 'Invalid email address',
  'error.weak_password': 'The password must be at least 8 characters long',
  'error.too_many_attempts': 'Too many attempts, try again in a few minutes',
  'error.wrong_password': 'Incorrect password',
  'error.account_disabled': 'This account is suspended. Contact the site team.',
  'error.admin_only': 'Administrators only',
  'error.forbidden_origin': 'Request refused',

  'common.close': 'Close',
  'count.cards': ['{n} card', '{n} cards'],

  'lang.label': 'Language',
  'lang.fr': 'French',
  'lang.en': 'English',
  'lang.all': 'All languages',

  'error.http': 'Error {n}',
  'error.network': 'Can’t reach the server. Check your connection and try again.',
  'error.unavailable': 'The server isn’t responding right now. Try again in a moment.',
  'error.load': 'This page couldn’t be loaded.',
  'error.screen': 'This screen couldn’t be displayed. A new version of the site may just have been released: reload the page.',
  'error.retry': 'Try again',
  'error.reload': 'Reload',
  'update.ready': 'New version available',
  'update.reload': 'Reload',
  'error.unknown_card': 'Unknown card',
  'error.invalid_quantity': 'Invalid quantity',
  'error.invalid_lang': 'Invalid language',
  'error.no_image': 'No image received',
  'error.index_building': 'Card recognition is still being prepared ({indexed}/{total})',
  'error.server': 'Internal server error',

  'color.Red': 'Red',
  'color.Green': 'Green',
  'color.Blue': 'Blue',
  'color.Purple': 'Purple',
  'color.Black': 'Black',
  'color.Yellow': 'Yellow',

  'sort.number': 'By number',
  'sort.code': 'By code',
  'sort.price': 'Most valuable',
  'sort.priceAsc': 'Least valuable',
  'sort.set': 'By set',
  'sort.color': 'By color',
  'sort.rarity': 'By rarity',
  'sort.name': 'By name',
  'sort.added': 'Recently added',
  'sort.recent': 'Newest',

  'chart.aria': 'Value over time',

  'stat.cost': 'Cost',

  'stats.uiLang': 'Interface language',
  'error.invalid_csv': 'File not recognized: use a CSV export from TCGC',

  'cam.title': 'Live camera on Android',
  'cam.intro': 'Chrome only allows the live camera (and installing the app) on a secure address. Since the app runs on your PC over http://, you need to mark this address as safe, once:',
  'cam.step1': 'In Chrome on your phone, open',
  'cam.step2a': 'Set it to',
  'cam.step2b': 'and enter in the field:',
  'cam.step3a': 'Tap',
  'cam.step3b': 'at the bottom of the screen',
  'cam.step4a': 'Come back here: the Scan tab now shows the camera. Menu ⋮ ▸',
  'cam.install': 'Install app',
  'cam.step4b': 'to add it to your home screen.',
  'cam.note': "Without it, scanning still works through your phone's camera app.",

  'scan.lessAria': 'One copy less',
  'scan.moreAria': 'One more copy',

  'insight.label.upcoming': 'Not out yet',
  'insight.label.new': 'New release',
  'insight.label.new-falling': 'Wait',
  'insight.label.rising': 'Rising',
  'insight.label.falling': 'Falling',
  'insight.label.good': 'Good price',
  'insight.label.stable': 'Stable price',
  'insight.label.cheap': 'Cheap',

  'wish.add': 'I want it',
  'wish.added': 'Added to your wishlist',
  'wish.removed': 'Removed from your wishlist',
  'wish.title': 'On my wishlist',
  'wish.remove': 'Remove',
  'wish.lang': 'Wanted language',
  'wish.target': 'My target price',
  'wish.targetAria': 'Target price in euros',
  'wish.save': 'Save',
  'wish.saved': 'Target price saved',
  'wish.suggested': 'Suggested: {price}',
  'wish.useSuggested': 'Use',
  'wish.help': "Put this price in your Cardmarket wants list and don't pay more. Suggestion: about 10% below its recent prices, 20% when the price is falling or the set is new.",
  'wish.reached': 'Below your target!',
  'wish.gap': '{pct} above your target',
  'wish.noTarget': 'No target price',
  'wish.target.short': 'target {price}',

  'set.rarity.leader': 'Leader',
  'hunts.deleteConfirm': 'Delete the "{name}" hunt? Your collection is not affected.',
  'hunts.deleted': 'Hunt deleted',
  'hunts.kind.any': 'All',
  'hunts.kind.normal': 'Regular',
  'hunts.kind.special': 'Special',
  'hunts.kind.alt': 'Alternate art',
  'hunts.kind.sp': 'SP',
  'hunts.kind.manga': 'Manga',
  'hunts.kind.fullart': 'Full Art',
  'hunts.kind.foil': 'Foil',
  'hunts.kindHint.special': 'Every version that is not regular: alternate arts, SP, Manga, Full Art, foils, promos…',
  'hunts.kindHint.alt': 'Alternate illustrations (Alternate Art, Parallel)',
  'hunts.title.any': '{r}, all versions',
  'hunts.title.any.none': 'All cards',
  'hunts.title.normal': 'Regular {r}',
  'hunts.title.normal.none': 'Regular cards',
  'hunts.title.special': 'Special {r}',
  'hunts.title.special.none': 'Special versions',
  'hunts.title.alt': '{r} alt.',
  'hunts.title.alt.none': 'Alternate arts',
  'hunts.title.sp': '{r} SP',
  'hunts.title.sp.none': 'SP',
  'hunts.title.manga': '{r} Manga',
  'hunts.title.manga.none': 'Manga',
  'hunts.title.fullart': '{r} Full Art',
  'hunts.title.fullart.none': 'Full Art',
  'hunts.title.foil': '{r} Foil',
  'hunts.title.foil.none': 'Foil',
  'set.wishedMissing': ['{n} card added to your wishlist', '{n} cards added to your wishlist'],
  'error.invalid_target': 'Invalid target price',

  'error.invalid_keep': 'Invalid number of copies',
  'error.invalid_share': 'Invalid share setting',
  'error.share_not_found': 'Share link not found',

  'notify.title': 'Notifications',
  'notify.intro': 'Get an alert on this phone when a card on your wishlist drops below your target price, and a weekly summary of your collection.',
  'notify.enable': 'Enable on this device',
  'notify.enabled': 'Enabled on this device',
  'notify.enabledToast': 'Notifications enabled',
  'notify.disable': 'Disable on this device',
  'notify.disabledToast': 'Notifications disabled on this device',
  'notify.targets': 'Target price reached (wishlist)',
  'notify.weekly': 'Weekly summary',
  'notify.when': 'Alerts are sent after the daily price update.',
  'notify.test': 'Send a test',
  'notify.testSent': 'Test notification sent',
  'notify.testNone': 'No subscribed device: enable notifications again',
  'notify.unsupported': 'Notifications are not available here: use the online app (https) in Chrome, ideally installed on your home screen.',
  'notify.denied': 'Notifications are blocked for this site: allow them in the browser settings (padlock ▸ Permissions).',
  'error.invalid_subscription': 'Invalid notification subscription',

  'notify.trades': 'Trades available with members',
  'error.invalid_trade': 'Text too long',

  'insight.label.banned': 'Ban',
  'notify.bans': 'Tournament bans (cards you own or want)',

  'auth.forgot': 'Forgot your password?',
  'auth.forgotTitle': 'Forgot your password',
  'auth.forgotText': "Enter your account's email address: you'll receive a link to choose a new password.",
  'auth.forgotSubmit': 'Send the link',
  'auth.forgotSent': 'If an account exists with this address, an email is on its way. The link is valid for 1 hour (check your spam folder).',
  'auth.backToLogin': 'Back to login',
  'reset.title': 'New password',
  'reset.text': 'Choose a new password for your account.',
  'reset.submit': 'Change my password',
  'reset.done': 'Password changed, you are logged in',
  'error.invalid_reset': 'Invalid or expired link: request a new password reset.',
  'error.mail_unavailable': 'Sending emails is not set up on this site.',

  'legal.link': 'Legal notice and privacy',
  'auth.privacy': 'Your data is only used to run your account:',

  'deck.title': 'Add a starter deck',
  'deck.pick': 'Pick the starter deck you bought:',
  'deck.fullList': 'full list',
  'deck.knownList': 'Deck list pre-filled: check it against your cards and adjust if needed. Scan the bonus booster cards separately.',
  'deck.unknownList': "Bandai doesn't publish the quantities for this deck: 1 copy per card is suggested. Adjust with your cards (51 cards including the Leader).",
  'deck.lang': 'Card language',
  'deck.back': 'Other decks',
  'deck.submit': ['Add {n} card', 'Add {n} cards'],
  'deck.added': ['{code}: {n} card added to your collection', '{code}: {n} cards added to your collection'],
  'error.unknown_deck': 'Unknown deck',
  'cardtype.Leader': 'Leader',
  'cardtype.Character': 'Character',
  'cardtype.Event': 'Event',
  'cardtype.Stage': 'Stage',
};

const MESSAGES: Record<UiLang, { [K in MessageKey]: Entry }> = { fr, en };
const STORAGE_KEY = 'tcgc.uiLang';

// Langue mémorisée, sinon celle du navigateur (français pour un téléphone en français, anglais sinon)
export function detectUiLang(): UiLang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch { /* stockage indisponible */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let current: UiLang = detectUiLang();
applyToDocument();

function applyToDocument() {
  document.documentElement.lang = current;
  document.title = current === 'fr' ? 'Ma Collection OP' : 'My OP Collection';
}

export function getUiLang() {
  return current;
}

export function setUiLang(lang: UiLang) {
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* stockage indisponible */ }
  applyToDocument();
}

// Locale des nombres, montants et dates
export function locale() {
  return current === 'fr' ? 'fr-FR' : 'en-GB';
}

export function hasMessage(key: string): key is MessageKey {
  return key in fr;
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}) {
  const entry = MESSAGES[current][key];
  let text: string;
  if (typeof entry === 'string') {
    text = entry;
  } else {
    const n = Number(vars.n ?? 0);
    // français : 0 et 1 au singulier ; anglais : seulement 1
    const singular = current === 'fr' ? n <= 1 : n === 1;
    text = singular ? entry[0] : entry[1];
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
