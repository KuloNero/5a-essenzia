import { Store, loadConfig, saveConfig } from './store.js';
import { $, $$, html, raw, toast, modalOpen, openModal } from './ui.js';
import { fmtDateTime } from './util.js';
import { describeAction } from './actions.js';
import { renderSetup } from './views/settings.js';
import { routes } from './views/index.js';

const NAV = [
  ['sep', 'Operatività'],
  ['#/', '🏠', 'Dashboard'],
  ['#/scan', '📷', 'Scansiona QR'],
  ['#/receive', '📥', 'Carico merce'],
  ['#/warehouse', '📦', 'Magazzino'],
  ['sep', 'Laboratorio'],
  ['#/recipes', '⚗️', 'Ricette & formule'],
  ['#/batches', '🏭', 'Produzione'],
  ['#/labels', '🏷️', 'Etichette QR'],
  ['#/trace', '🔗', 'Tracciabilità'],
  ['sep', 'Anagrafiche'],
  ['#/materials', '🧪', 'Materie prime'],
  ['#/suppliers', '🚚', 'Fornitori'],
  ['#/customers', '👥', 'Clienti'],
  ['sep', 'Vendite'],
  ['#/orders', '🧾', 'Ordini'],
  ['#/pricing', '💶', 'Costi & listini'],
  ['sep', 'Sistema'],
  ['#/data', '💾', 'Import / Export / Backup'],
  ['#/settings', '⚙️', 'Impostazioni'],
];
const BOTTOM = [['#/', '🏠', 'Home'], ['#/receive', '📥', 'Carico'], ['#/scan', '📷', 'Scansiona', 'scan'], ['#/warehouse', '📦', 'Magazzino'], ['#menu', '☰', 'Menu']];

export const app = {
  store: null,
  dirty: false,
  pendingRender: false,
  get db() { return this.store.db; },
  navigate(hash) { if (location.hash === hash) this.render(); else location.hash = hash; },
  setDirty(v = true) { this.dirty = v; },
  async run(fn, okMsg) {
    try {
      const r = await fn();
      if (r?.queued) toast('Salvato offline: verrà sincronizzato al ritorno della rete', 'warn', 5000);
      else if (okMsg) toast(okMsg, 'ok');
      return r || { ok: true };
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'error', 7000);
      return null;
    }
  },
  dispatch(type, payload, opts) { return this.store.dispatch(type, payload, opts); },
  render() {
    const view = $('#view');
    const hash = location.hash || '#/';
    const path = hash.slice(1).split('?')[0] || '/';
    const query = new URLSearchParams(hash.split('?')[1] || '');
    document.body.classList.remove('nav-open');
    for (const a of $$('#sidebar a, #bottombar a')) {
      const h = a.getAttribute('href');
      a.classList.toggle('active', h === '#' + path || (h !== '#/' && ('#' + path).startsWith(h + '/')));
    }
    if (this.cleanup) { try { this.cleanup(); } catch { /* */ } this.cleanup = null; }
    this.dirty = false;
    this.pendingRender = false;
    $('#banner').hidden = true;
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) {
        try {
          this.viewOnData = null;
          const r = fn(view, { params: m.slice(1).map(decodeURIComponent), query, app: this });
          if (typeof r === 'function') this.cleanup = r;
          else if (r && typeof r === 'object') { this.cleanup = r.cleanup || null; this.viewOnData = r.onData || null; }
        } catch (e) {
          console.error(e);
          view.innerHTML = String(html`<div class="alert danger">Errore nella vista: ${e.message}</div>`);
        }
        return;
      }
    }
    view.innerHTML = String(html`<div class="empty"><p>Pagina non trovata</p><a class="btn" href="#/">Torna alla dashboard</a></div>`);
  },
  onData(remote) {
    if (this.viewOnData) { try { this.viewOnData(remote); } catch (e) { console.error(e); } return; }
    if (modalOpen() || this.dirty) {
      this.pendingRender = true;
      if (remote && this.dirty && !modalOpen()) showBanner();
      return;
    }
    this.render();
  },
};

function showBanner() {
  const b = $('#banner');
  b.innerHTML = String(html`<span>Dati aggiornati da un altro dispositivo</span><button class="btn btn-sm btn-primary">Ricarica vista</button>`);
  b.hidden = false;
  b.querySelector('button').onclick = () => { b.hidden = true; app.render(); };
}

function renderNav() {
  $('#sidebar').innerHTML = NAV.map(n => n[0] === 'sep'
    ? `<div class="sep">${n[1]}</div>`
    : `<a href="${n[0]}"><span class="ico">${n[1]}</span><span>${n[2]}</span></a>`).join('');
  $('#bottombar').innerHTML = BOTTOM.map(([h, i, l, c]) => `<a href="${h}" class="${c || ''}"><span class="ico">${i}</span><span>${l}</span></a>`).join('');
  $('#bottombar a[href="#menu"]').addEventListener('click', e => { e.preventDefault(); document.body.classList.toggle('nav-open'); });
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
}

function renderSync() {
  const s = app.store;
  const btn = $('#syncBtn');
  btn.className = `sync ${s.status}`;
  const labels = { init: 'Avvio…', syncing: 'Sincronizzo…', ok: s.backend.kind === 'local' ? 'Locale' : 'Sincronizzato', offline: `Offline${s.pending.length ? ` (${s.pending.length})` : ''}`, error: 'Errore' };
  $('.sync-label', btn).textContent = labels[s.status] + (s.failed.length ? ` ⚠${s.failed.length}` : '');
  btn.title = s.lastError ? s.lastError.message : (s.lastSync ? `Ultima sincronizzazione: ${fmtDateTime(s.lastSync)}` : '');
}

function syncDetails() {
  const s = app.store;
  const m = openModal({
    title: 'Sincronizzazione',
    body: String(html`
      <dl class="kv">
        <dt>Archivio</dt><dd>${s.backend.kind === 'github' ? `GitHub ${s.config.owner}/${s.config.repo} (${s.config.branch})` : 'Solo questo dispositivo (locale)'}</dd>
        <dt>Stato</dt><dd>${s.status}${s.lastError ? ' — ' + s.lastError.message : ''}</dd>
        <dt>Ultima sync</dt><dd>${s.lastSync ? fmtDateTime(s.lastSync) : '—'}</dd>
        <dt>Commit</dt><dd class="mono">${(s.head || '').slice(0, 10)}</dd>
        <dt>In coda offline</dt><dd>${s.pending.length}</dd>
      </dl>
      ${s.pending.length ? html`<h3>Operazioni in attesa</h3><ul>${s.pending.map(a => html`<li>${describeAction(a, s.db)} — ${fmtDateTime(a.meta.ts)}</li>`)}</ul>` : ''}
      ${s.failed.length ? html`<h3>Operazioni NON applicate</h3><p class="muted small">Eseguite offline ma rifiutate alla sincronizzazione (es. giacenza nel frattempo insufficiente). Verificare e ripetere a mano.</p>
        <ul>${s.failed.map((f, i) => html`<li><b>${describeAction(f.action, s.db)}</b> — ${f.error} <button class="btn btn-sm" data-dismiss="${i}">Ignora</button></li>`)}</ul>` : ''}
    `),
    actions: [{ label: 'Chiudi' }, { label: 'Sincronizza ora', primary: true, onClick: async () => { await s.sync(); toast(s.status === 'ok' ? 'Sincronizzato' : 'Sincronizzazione non riuscita', s.status === 'ok' ? 'ok' : 'warn'); } }],
  });
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-dismiss]');
    if (b) { s.dismissFailed(Number(b.dataset.dismiss)); m.close(); syncDetails(); }
  });
}

async function boot() {
  renderNav();
  const cfg = loadConfig();
  if (!cfg) {
    $('#app').classList.add('setup-mode');
    renderSetup($('#view'), { onDone: () => location.reload() });
    $('#syncBtn').hidden = true;
    return;
  }
  app.store = new Store(cfg);
  saveConfig(cfg); // copia la configurazione in IndexedDB per il service worker (installazioni precedenti)
  app.store.onQueued = requestBackgroundSync;
  app.store.subscribe(reason => {
    if (reason === 'status') renderSync();
    if (reason === 'data' || reason === 'remote') { renderSync(); app.onData(reason === 'remote'); }
  });
  window.addEventListener('hashchange', () => app.render());
  document.addEventListener('modalclosed', () => { if (app.pendingRender && !modalOpen() && !app.dirty) app.render(); });
  $('#syncBtn').addEventListener('click', syncDetails);
  $('#view').addEventListener('click', e => {
    const tr = e.target.closest('[data-href]');
    if (tr && !e.target.closest('a,button,input,select,textarea')) location.hash = tr.dataset.href;
  });
  $('#view').addEventListener('input', e => { if (e.target.closest('[data-dirty]')) app.setDirty(true); });
  renderSync();
  app.render();
  await app.store.init();
  if (app.store.pending.length) requestBackgroundSync();
  if (cfg.mode === 'github') setupPeriodicSync();
  if (app.store.status === 'error') toast(app.store.lastError?.message || 'Errore di sincronizzazione', 'error', 8000);
  app.render();
  const poll = () => { if (document.visibilityState === 'visible') app.store.poll(); };
  setInterval(poll, 20000);
  document.addEventListener('visibilitychange', poll);
  window.addEventListener('online', () => app.store.sync());
  window.addEventListener('offline', () => app.store.setStatus('offline'));
}

// Service worker: "module" (con sync in background) e fallback classico per i browser che non lo supportano
const swReady = ('serviceWorker' in navigator && location.protocol !== 'file:')
  ? navigator.serviceWorker.register('sw.js', { type: 'module' })
    .catch(() => navigator.serviceWorker.register('sw-classic.js'))
    .catch(() => null)
  : Promise.resolve(null);

/** Chiede al browser di sincronizzare la coda appena torna la rete, anche ad app chiusa (Chrome/Android). */
async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.sync) await reg.sync.register('esz-sync');
  } catch { /* non supportato (es. iOS/Safari, Firefox): si sincronizza alla riapertura */ }
}

async function setupPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.periodicSync) return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state === 'granted') await reg.periodicSync.register('esz-periodic', { minInterval: 60 * 60 * 1000 });
  } catch { /* opzionale */ }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async e => {
    if (e.data?.type !== 'esz-sync' || !app.store) return;
    await app.store.sync();
    e.ports?.[0]?.postMessage({ pending: app.store.pending.length, failed: app.store.failed.length });
  });
}

window.__app = app;
boot();
