// Abonnements aux notifications (server/notify.js, audit du 14 novembre 2026, P2-11), sur une base temporaire : seuls
// les services de notification des navigateurs sont acceptés (pas de requête vers une adresse choisie par un client),
// 10 appareils au plus par compte
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'tcgc-audit-push-'));
process.env.TCGC_DB = join(dir, 'essai.db');
const dbModule = '../../server/db.js';
const notifyModule = '../../server/notify.js';
const { db } = await import(dbModule);
const notify = await import(notifyModule);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'cle-publique', auth: 'secret' } });

test('notifications : services des navigateurs acceptés, autres adresses refusées', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) {
    assert.equal(notify.pushEndpointAllowed(ok), true, ok);
  }
  for (const bad of ['https://127.0.0.1/x', 'https://localhost/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com.exemple.fr/x', 'https://evilfcm.googleapis.com.invalid/x', 'https://user:pw@fcm.googleapis.com/x', 'https://169.254.169.254/latest']) {
    assert.equal(notify.pushEndpointAllowed(bad), false, bad);
    assert.throws(() => notify.subscribe(1, sub(bad), 'fr'), /Abonnement invalide/);
  }
});

test('notifications : 10 appareils au plus par compte, le plus ancien remplacé', () => {
  for (let i = 0; i < 12; i++) notify.subscribe(2, sub(`https://fcm.googleapis.com/fcm/send/appareil-${i}`), 'fr');
  const kept = db.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = 2').all().map((r: { endpoint: string }) => r.endpoint);
  assert.equal(kept.length, notify.MAX_SUBSCRIPTIONS);
  assert.ok(kept.includes('https://fcm.googleapis.com/fcm/send/appareil-11'));
  assert.ok(!kept.includes('https://fcm.googleapis.com/fcm/send/appareil-0'));
  // un autre compte n'est pas touché
  notify.subscribe(3, sub('https://fcm.googleapis.com/fcm/send/autre'), 'fr');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 2').get().n, 10);
});
