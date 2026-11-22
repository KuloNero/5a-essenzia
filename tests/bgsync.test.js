import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { Store } from '../js/store.js';
import { GitHubBackend } from '../js/backends.js';
import { backgroundSync } from '../js/bgsync.js';
import { kv } from '../js/idb.js';

test('sync in background: la coda offline salvata dalla pagina viene caricata dal service worker', async () => {
  const gh = createFakeGitHub({ empty: false });
  const cfg = { mode: 'github', owner: 'bg', repo: 'r', branch: 'main', dir: 'data', token: 't', user: 'Giulia', device: 'smartphone' };
  await kv.set('config', cfg);
  const page = new Store(cfg, new GitHubBackend(cfg, gh.fetch));
  await page.init();
  await page.dispatch('material.upsert', { material: { id: 'm1', name: 'Olio' } });
  await page.dispatch('lot.receive', { lot: { id: 'l1', materialId: 'm1', qty: 1000 } });

  // vendita/prelievo senza rete: finisce in coda (salvata in IndexedDB), poi l'app viene chiusa
  const real = page.backend.fetch;
  page.backend.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const q = await page.dispatch('stock.withdraw', { lotId: 'l1', qty: 30 });
  assert.equal(q.queued, true);

  // torna la rete: il service worker sincronizza senza pagina aperta
  const r = await backgroundSync({ backend: new GitHubBackend(cfg, gh.fetch) });
  assert.equal(r.pending, 0);
  assert.ok(gh.headFiles()['data/lots.json'].includes('"qty":970'));
  assert.match(gh.log()[0], /Scarico.*Giulia@smartphone/);

  // la pagina, riaperta con la sua coda ormai obsoleta, non duplica il prelievo
  page.backend.fetch = real;
  await page.sync();
  assert.equal(page.pending.length, 0);
  assert.equal(page.db.lots[0].qty, 970);
  assert.equal(page.db.movements.filter(m => m.type === 'scarico').length, 1);
});

test('sync in background: nessuna configurazione GitHub → nessuna azione', async () => {
  await kv.set('config', { mode: 'local' });
  assert.deepEqual(await backgroundSync(), { skipped: true, pending: 0, failed: 0 });
});
