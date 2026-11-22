// Sincronizzazione in background (eseguita dal service worker, anche ad app chiusa).
// Usa lo stesso Store della pagina: carica la coda offline salvata in IndexedDB,
// ricarica i dati da GitHub e applica le operazioni in attesa (con controllo conflitti).
import { Store } from './store.js';
import { kv } from './idb.js';

export async function backgroundSync({ backend } = {}) {
  const cfg = await kv.get('config');
  if (!cfg || cfg.mode !== 'github') return { skipped: true, pending: 0, failed: 0 };
  const store = new Store(cfg, backend);
  await store.init();
  return { pending: store.pending.length, failed: store.failed.length, status: store.status, error: store.lastError?.message };
}
