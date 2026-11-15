import { makeT } from './make';

// Réglages : adresse e-mail à confirmer, export de toutes les données (audit du 14 nov. 2026)
export const ta = makeT({
  'verify.text': 'Confirme ton adresse e-mail avec le lien reçu à l’inscription : sans elle, « Mot de passe oublié » ne peut pas t’aider.',
  'verify.resend': 'Renvoyer le lien',
  'verify.sent': 'Lien envoyé à {email}',
  'verify.done': 'Adresse e-mail confirmée',
  'export': 'Toutes mes données',
  'export.meta': 'fichier JSON : compte, collection, recherches, decks, parties, Berry',
}, {
  'verify.text': 'Confirm your email address with the link sent when you signed up: without it, "Forgot password" cannot help you.',
  'verify.resend': 'Resend the link',
  'verify.sent': 'Link sent to {email}',
  'verify.done': 'Email address confirmed',
  'export': 'All my data',
  'export.meta': 'JSON file: account, collection, wishlist, decks, games, Berry',
});
