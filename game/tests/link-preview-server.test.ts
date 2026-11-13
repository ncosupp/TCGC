// Aperçu des liens partagés (server/link-preview.js) : adresses absolues tirées de la requête, hôte douteux ignoré
import assert from 'node:assert/strict';
import { test } from 'node:test';

delete process.env.PUBLIC_URL;
const previewModule = '../../server/link-preview.js';
const { previewTags, siteUrl } = await import(previewModule);
const req = (host: string, protocol = 'https') => ({ protocol, get: (h: string) => (h === 'host' ? host : undefined) });

test('serveur : aperçu des liens avec image absolue, hôte vérifié', () => {
  assert.equal(siteUrl(req('joy-boy.fr')), 'https://joy-boy.fr/');
  assert.equal(siteUrl(req('localhost:3000', 'http')), 'http://localhost:3000/');
  assert.equal(siteUrl(req('evil.fr"><script>')), null, 'hôte refusé');
  const tags = previewTags('https://joy-boy.fr/');
  assert.match(tags, /<meta property="og:image" content="https:\/\/joy-boy\.fr\/og-image\.jpg" \/>/);
  assert.match(tags, /<meta property="og:url" content="https:\/\/joy-boy\.fr\/" \/>/);
  assert.match(tags, /twitter:image/);
  assert.equal(previewTags(null), '');
});
