// Mini key-value store su IndexedDB (con fallback in memoria se non disponibile).
const DB_NAME = '5a-essenzia';
const STORE = 'kv';
let dbp = null;
const mem = new Map();

function open() {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const req = fn(st);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export const kv = {
  async get(k) { const db = await open(); if (!db) return mem.get(k); return tx('readonly', st => st.get(k)); },
  async set(k, v) { const db = await open(); if (!db) { mem.set(k, v); return; } return tx('readwrite', st => st.put(v, k)); },
  async del(k) { const db = await open(); if (!db) { mem.delete(k); return; } return tx('readwrite', st => st.delete(k)); },
};
