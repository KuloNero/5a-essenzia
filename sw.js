// Service worker principale (module): app shell offline + sincronizzazione in background.
// Se il browser non supporta i service worker "module", l'app registra sw-classic.js (solo shell).
// build: __BUILD__
import './sw-shell.js';
import { backgroundSync } from './js/bgsync.js';

async function askOpenPage(clients) {
  // se l'app è aperta lasciamo sincronizzare la pagina (evita scritture concorrenti sulla coda)
  const acks = clients.map(c => new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = e => resolve(e.data);
    c.postMessage({ type: 'esz-sync' }, [ch.port2]);
  }));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 25000));
  return Promise.race([Promise.any(acks).catch(() => null), timeout]);
}

async function run() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  let res = clients.length ? await askOpenPage(clients) : null;
  // nessuna pagina aperta o pagina sospesa (app in background): sincronizza il service worker.
  // Le operazioni sono idempotenti, quindi un eventuale doppio invio non duplica nulla.
  if (!res) res = await backgroundSync();
  // lanciare un errore chiede al browser di riprovare più tardi
  if (res.pending > 0) throw new Error(`Ancora ${res.pending} operazioni in coda`);
}

self.addEventListener('sync', e => { if (e.tag === 'esz-sync') e.waitUntil(run()); });
self.addEventListener('periodicsync', e => { if (e.tag === 'esz-periodic') e.waitUntil(run().catch(() => {})); });
