// Store centrale: stato dati, sincronizzazione con il backend, coda offline.
import { applyAction, makeAction, describeAction } from './actions.js';
import { normalizeDb, emptyDb, DomainError } from './domain.js';
import { GitHubBackend, LocalBackend } from './backends.js';
import { clone } from './util.js';
import { kv } from './idb.js';

const CFG_KEY = 'esz:config';

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; }
}
export function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  // copia in IndexedDB: il service worker (che non vede localStorage) la usa per la sincronizzazione in background
  return kv.set('config', cfg).catch(() => {});
}
export function clearConfig() {
  localStorage.removeItem(CFG_KEY);
  return kv.del('config').catch(() => {});
}

export function serializeCollection(name, value) {
  if (Array.isArray(value)) {
    return value.length ? '[\n' + value.map(v => JSON.stringify(v)).join(',\n') + '\n]\n' : '[]\n';
  }
  return JSON.stringify(value, null, 2) + '\n';
}

export class Store {
  constructor(config, backend) {
    this.config = config;
    this.backend = backend || (config.mode === 'github' ? new GitHubBackend(config) : new LocalBackend());
    this.base = emptyDb();
    this.db = emptyDb();
    this.head = null;
    this.blobs = {};
    this.pending = [];
    this.failed = [];
    this.status = 'init'; // init | syncing | ok | offline | error
    this.lastError = null;
    this.lastSync = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.cacheKey = `cache:${config.mode}:${config.owner || ''}/${config.repo || ''}@${config.branch || ''}/${config.dir || ''}`;
  }

  get ctx() { return { user: this.config.user || '', device: this.config.device || '' }; }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason) { for (const fn of this.listeners) { try { fn(reason); } catch (e) { console.error(e); } } }

  setStatus(s, err) { this.status = s; this.lastError = err || null; this.emit('status'); }

  recompute() {
    const db = normalizeDb(clone(this.base));
    for (const a of this.pending) {
      try { applyAction(db, a); } catch { /* verrà segnalato al flush */ }
    }
    this.db = db;
  }

  async init() {
    const cache = await kv.get(this.cacheKey);
    if (cache) {
      this.base = normalizeDb(cache.data);
      this.head = cache.head;
      this.blobs = cache.blobs || {};
      this.pending = cache.pending || [];
      this.failed = cache.failed || [];
      this.lastSync = cache.lastSync || null;
      this.recompute();
      this.emit('data');
    }
    await this.sync();
  }

  async saveCache() {
    await kv.set(this.cacheKey, { data: this.base, head: this.head, blobs: this.blobs, pending: this.pending, failed: this.failed, lastSync: this.lastSync });
  }

  /** Ricarica dal backend (solo le collezioni cambiate) e svuota la coda offline. */
  sync() { return this.enqueue(() => this._sync()); }

  async _sync() {
    this.setStatus('syncing');
    try {
      await this._reload();
      await this._flush();
      this.setStatus(this.pending.length ? 'offline' : 'ok');
    } catch (e) {
      this.setStatus(e.network ? 'offline' : 'error', e);
    }
  }

  async _reload() {
    const res = await this.backend.load({ blobs: this.blobs, data: this.base });
    const changed = res.head !== this.head;
    this.base = normalizeDb(res.data);
    this.head = res.head;
    this.blobs = res.blobs;
    this.lastSync = Date.now();
    this.recompute();
    await this.saveCache();
    if (changed) this.emit('remote');
  }

  async _flush() {
    while (this.pending.length) {
      const a = this.pending[0];
      try {
        await this._commitAction(a, []);
        this.pending.shift();
      } catch (e) {
        if (e.network) throw e;
        this.pending.shift();
        this.failed.push({ action: a, error: e.message, at: Date.now() });
      }
      this.recompute();
      await this.saveCache();
      this.emit('data');
    }
  }

  enqueue(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Applica l'azione su dati freschi e la committa; ri-tenta in caso di conflitto. */
  async _commitAction(action, extraFiles) {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await this._reload();
      const next = normalizeDb(clone(this.base));
      const changed = applyAction(next, action); // DomainError → propagata
      if (!changed.size && !extraFiles.length) return { noop: true };
      const files = [...changed].map(c => ({ path: `${c}.json`, text: serializeCollection(c, next[c]) }));
      files.push(...extraFiles);
      try {
        const res = await this.backend.commit(this.head, files, describeAction(action, next));
        this.base = next;
        this.head = res.head;
        this.blobs = { ...this.blobs, ...res.blobs };
        this.lastSync = Date.now();
        return { ok: true };
      } catch (e) {
        if (e.conflict) { await new Promise(r => setTimeout(r, 150 * (attempt + 1) + Math.random() * 300)); continue; }
        throw e;
      }
    }
    throw new Error('Troppi conflitti consecutivi: riprovare');
  }

  /**
   * Esegue un'azione. Online: commit immediato. Offline: valida localmente e accoda.
   * opts.files: file binari da salvare nello stesso commit (richiedono connessione).
   */
  dispatch(type, payload, opts = {}) {
    const action = makeAction(type, payload, this.ctx);
    return this.enqueue(async () => {
      // validazione preliminare sui dati attuali (errori immediati anche offline)
      const probe = normalizeDb(clone(this.db));
      applyAction(probe, action);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false && this.backend.kind === 'github';
      if (!offline && !this.pending.length) {
        try {
          this.setStatus('syncing');
          const r = await this._commitAction(action, opts.files || []);
          this.recompute();
          await this.saveCache();
          this.setStatus('ok');
          this.emit('data');
          return { ...r, action };
        } catch (e) {
          if (!e.network) { this.setStatus(this.pending.length ? 'offline' : 'ok'); throw e; }
        }
      }
      if (opts.files?.length) throw new DomainError('Il caricamento di documenti richiede la connessione');
      this.pending.push(action);
      this.recompute();
      await this.saveCache();
      if (this.onQueued) { try { this.onQueued(); } catch { /* */ } }
      this.setStatus('offline');
      this.emit('data');
      return { queued: true, action };
    });
  }

  dismissFailed(i) { this.failed.splice(i, 1); this.saveCache(); this.emit('data'); }

  /** Controllo leggero (ETag) se ci sono commit nuovi da altri dispositivi. */
  async poll() {
    if (this.backend.kind !== 'github' || this.status === 'syncing') return;
    try {
      const h = await this.backend.headSha({ useEtag: true });
      if (h.unchanged) { if (this.status === 'offline' && !this.pending.length) this.setStatus('ok'); return; }
      if (h.sha && h.sha !== this.head) await this.sync();
      else if (this.pending.length) await this.sync();
      else if (this.status !== 'ok') this.setStatus('ok');
    } catch (e) {
      if (e.network) this.setStatus('offline', e);
    }
  }

  readFile(path) { return this.backend.readFile(path); }
}
