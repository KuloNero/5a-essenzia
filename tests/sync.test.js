import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGitHub } from './fake-github.js';
import { Store } from '../js/store.js';
import { GitHubBackend } from '../js/backends.js';

function device(gh, name) {
  const cfg = { mode: 'github', owner: name, repo: 'r', branch: 'main', dir: 'data', token: 't', user: name, device: name };
  return new Store(cfg, new GitHubBackend(cfg, gh.fetch));
}

test('repo vuoto: inizializzazione e primo commit', async () => {
  const gh = createFakeGitHub({ empty: true });
  const pc = device(gh, 'pc');
  await pc.init();
  assert.equal(pc.status, 'ok');
  await pc.dispatch('material.upsert', { material: { id: 'm1', name: 'Olio', inci: 'Olea Europaea Fruit Oil' } });
  const files = gh.headFiles();
  assert.ok(files['data/materials.json'].includes('Olea Europaea'));
  assert.ok(gh.log()[0].startsWith('Materia prima: Olio [pc@pc]'));
});

test('due dispositivi in contemporanea: scarichi concorrenti vengono fusi senza perdite', async () => {
  const gh = createFakeGitHub({ empty: false });
  const pc = device(gh, 'pc');
  const phone = device(gh, 'phone');
  await pc.init();
  await pc.dispatch('material.upsert', { material: { id: 'm1', name: 'Olio' } });
  await pc.dispatch('lot.receive', { lot: { id: 'l1', materialId: 'm1', qty: 1000 } });
  await phone.init();
  assert.equal(phone.db.lots[0].qty, 1000);

  // il PC scrive mentre il telefono ha ancora la versione vecchia
  await pc.dispatch('stock.withdraw', { lotId: 'l1', qty: 100 });
  await phone.dispatch('stock.withdraw', { lotId: 'l1', qty: 250 }); // conflitto → reload → riapplica
  await pc.sync();
  assert.equal(pc.db.lots[0].qty, 650);
  assert.equal(phone.db.lots[0].qty, 650);
  assert.equal(pc.db.movements.filter(m => m.type === 'scarico').length, 2);

  // scrittura davvero parallela (Promise.all)
  await Promise.all([
    pc.dispatch('stock.withdraw', { lotId: 'l1', qty: 50 }),
    phone.dispatch('stock.withdraw', { lotId: 'l1', qty: 50 }),
  ]);
  await pc.sync();
  assert.equal(pc.db.lots[0].qty, 550);

  // la regola di dominio viene ricontrollata sui dati aggiornati
  await assert.rejects(() => phone.dispatch('stock.withdraw', { lotId: 'l1', qty: 600 }), /giacenza/);
});

test('modalità offline: azione accodata e sincronizzata al ritorno della rete', async () => {
  const gh = createFakeGitHub({ empty: false });
  const phone = device(gh, 'phone2');
  await phone.init();
  await phone.dispatch('material.upsert', { material: { id: 'm1', name: 'Olio' } });
  await phone.dispatch('lot.receive', { lot: { id: 'l1', materialId: 'm1', qty: 1000 } });
  const realFetch = phone.backend.fetch;
  phone.backend.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r = await phone.dispatch('stock.withdraw', { lotId: 'l1', qty: 10 });
  assert.equal(r.queued, true);
  assert.equal(phone.db.lots[0].qty, 990); // vista ottimistica
  assert.equal(phone.pending.length, 1);
  phone.backend.fetch = realFetch;
  await phone.sync();
  assert.equal(phone.pending.length, 0);
  assert.ok(gh.headFiles()['data/lots.json'].includes('"qty":990'));
});

test('polling ETag: rileva i commit di altri dispositivi', async () => {
  const gh = createFakeGitHub({ empty: false });
  const a = device(gh, 'a'), b = device(gh, 'b');
  await a.init(); await b.init();
  let notified = 0;
  b.subscribe(r => { if (r === 'remote') notified++; });
  await b.poll();
  assert.equal(notified, 0);
  await a.dispatch('customer.upsert', { customer: { id: 'c1', name: 'Negozio Verde', type: 'B2B' } });
  await b.poll();
  assert.equal(notified, 1);
  assert.equal(b.db.customers[0].name, 'Negozio Verde');
});
