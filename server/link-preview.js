// Page d'accueil avec l'aperçu des liens partagés : les balises og:image et og:url doivent être des adresses absolues,
// que le build ne connaît pas. On les ajoute à index.html au moment de l'envoyer, depuis PUBLIC_URL, sinon depuis
// l'adresse demandée (hôte vérifié : il vient de la requête et finit dans le HTML).
import fs from 'node:fs';
import { publicUrl } from './mail.js';

const IMAGE = 'og-image.jpg';
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

export function siteUrl(req) {
  if (/^https?:\/\//.test(publicUrl)) return publicUrl;
  const host = req.get('host') ?? '';
  return HOST.test(host) ? `${req.protocol === 'https' ? 'https' : 'http'}://${host}/` : null;
}

export function previewTags(base) {
  if (!base) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const image = esc(base + IMAGE);
  return [
    `<meta property="og:url" content="${esc(base)}" />`,
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:type" content="image/jpeg" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Ma Collection, One Piece TCG" />',
    `<meta name="twitter:image" content="${image}" />`,
  ].map((tag) => `    ${tag}\n`).join('');
}

// index.html du build, relu s'il change (deploy sans redémarrage)
export function indexSender(file) {
  let cache = { mtime: 0, html: '' };
  return (req, res, next) => {
    let stat;
    try { stat = fs.statSync(file); } catch { return next(); }
    if (stat.mtimeMs !== cache.mtime) cache = { mtime: stat.mtimeMs, html: fs.readFileSync(file, 'utf8') };
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(cache.html.replace(/\n\s*<\/head>/, `\n${previewTags(siteUrl(req))}  </head>`));
  };
}
