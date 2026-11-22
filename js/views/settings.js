import { html, raw, field, input, $, toast, confirmDialog, openModal, readForm } from '../ui.js';
import { loadConfig, saveConfig, clearConfig } from '../store.js';
import { GitHubBackend } from '../backends.js';
import { qrSvg } from '../qr.js';
import { startScanner } from '../scanner.js';
import { utf8ToB64, b64ToUtf8, num } from '../util.js';
import { kv } from '../idb.js';
import { pageHead } from './common.js';
import { loadDemo } from '../demo.js';
import { versionLabel } from '../version.js';

const CFG_PREFIX = 'ESZCFG1|';
const guessDevice = () => /iphone|android|mobile/i.test(navigator.userAgent) ? 'smartphone' : 'pc';

function connectionFields(c = {}) {
  return html`<div class="form-grid">
      ${field('Proprietario (utente o organizzazione GitHub)', input('owner', c.owner, 'required autocapitalize="off" placeholder="es. mario-rossi"'))}
      ${field('Repository dati', input('repo', c.repo, 'required autocapitalize="off" placeholder="es. essenzia-dati"'), 'Consigliato un repository PRIVATO dedicato ai dati')}
      ${field('Branch', input('branch', c.branch || 'main', 'autocapitalize="off"'))}
      ${field('Cartella', input('dir', c.dir || 'data', 'autocapitalize="off"'))}
    </div>
    ${field('Token di accesso (fine-grained personal access token)', input('token', c.token, 'type="password" required autocomplete="off" placeholder="github_pat_…"'), 'GitHub → Settings → Developer settings → Fine-grained tokens: accesso al solo repository dati, permesso "Contents: Read and write". Resta salvato solo su questo dispositivo.')}
    <div class="form-grid">
      ${field('Nome operatore', input('user', c.user, 'placeholder="es. Giulia"'), 'Registrato su ogni movimento (GMP)')}
      ${field('Nome dispositivo', input('device', c.device || guessDevice()))}
    </div>`;
}

export function renderSetup(el, { onDone }) {
  el.innerHTML = String(html`<div class="setup">
    <h1>Benvenuto in 5a Essenzia</h1>
    <p>Gestionale per laboratorio di cosmetica naturale. I dati vengono salvati come file nel <b>tuo repository GitHub</b>: ogni operazione è un commit (storico completo e audit trail), e PC e smartphone lavorano sugli stessi dati in contemporanea.</p>
    <div class="card"><h2>1 · Collega il repository dati</h2>
      <form class="form" id="cf">${connectionFields({})}
        <div class="toolbar"><button class="btn btn-primary btn-lg" type="submit">Verifica e collega</button><button type="button" class="btn btn-lg" id="scanCfg">📷 Scansiona QR da un altro dispositivo</button></div>
        <div id="cam"></div>
      </form>
    </div>
    <div class="card"><h2>…oppure prova senza GitHub</h2>
      <p class="muted">Modalità locale: i dati restano solo in questo browser (nessuna condivisione tra dispositivi). Potrai caricare dati di esempio.</p>
      <button class="btn" id="local">Usa in modalità locale</button>
    </div>
    <details class="card"><summary><b>Come preparare GitHub (5 minuti)</b></summary><ol class="steps">
      <li>Crea un nuovo repository <b>privato</b> (es. <span class="mono">essenzia-dati</span>), anche vuoto.</li>
      <li>Vai su <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token</a>: "Only select repositories" → il repository dati; permessi "Contents: Read and write" (Metadata: read viene aggiunto da solo). Imposta una scadenza.</li>
      <li>Copia il token e incollalo qui. Ripeti su ogni dispositivo, oppure usa "Collega un altro dispositivo" dalle Impostazioni e scansiona il QR.</li>
    </ol></details></div>`);
  const form = $('#cf', el);
  let scanner = null;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const c = readForm(form);
    if (!c.owner || !c.repo || !c.token) return toast('Compila proprietario, repository e token', 'error');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const be = new GitHubBackend(c);
      const info = await be.testAccess();
      if (!info.private && !await confirmDialog('Il repository è PUBBLICO: formule, costi e clienti sarebbero visibili a chiunque. Continuare comunque?', { danger: true, okLabel: 'Continua' })) return;
      await saveConfig({ mode: 'github', ...c });
      toast('Collegato a ' + info.fullName, 'ok');
      onDone();
    } catch (err) { toast(err.message, 'error', 8000); }
    finally { btn.disabled = false; }
  });
  $('#local', el).onclick = async () => { await saveConfig({ mode: 'local', user: form.user.value, device: form.device.value || guessDevice() }); onDone(); };
  $('#scanCfg', el).onclick = async () => {
    scanner?.stop();
    scanner = await startScanner($('#cam', el), text => {
      if (!text.startsWith(CFG_PREFIX)) { toast('Non è un QR di configurazione', 'warn'); return true; }
      try {
        const c = JSON.parse(b64ToUtf8(text.slice(CFG_PREFIX.length)));
        for (const k of ['owner', 'repo', 'branch', 'dir', 'token']) if (c[k]) form[k].value = c[k];
        $('#cam', el).innerHTML = '';
        toast('Configurazione letta: inserisci il tuo nome e premi "Verifica e collega"', 'ok', 6000);
        form.user.focus();
      } catch { toast('QR non valido', 'error'); return true; }
      return false;
    }, { onError: e2 => toast(e2.message, 'error') });
  };
}

export function settings(el, { app }) {
  const db = app.db;
  const s = db.settings;
  const cfg = app.store.config;
  el.innerHTML = String(html`${pageHead('Impostazioni')}
    <div class="card"><h2>Questo dispositivo</h2>
      <form class="form" id="dev"><div class="form-grid">${field('Nome operatore', input('user', cfg.user))}${field('Nome dispositivo', input('device', cfg.device))}</div>
      <div class="toolbar"><button class="btn btn-primary">Salva</button></div></form>
    </div>
    <div class="card"><h2>Archivio dati</h2>
      ${cfg.mode === 'github' ? html`<p>GitHub: <b class="mono">${cfg.owner}/${cfg.repo}</b> · branch <span class="mono">${cfg.branch}</span> · cartella <span class="mono">${cfg.dir}/</span></p>
        <p><a href="https://github.com/${cfg.owner}/${cfg.repo}/commits/${cfg.branch}" target="_blank" rel="noopener">Apri lo storico delle modifiche (commit) su GitHub ↗</a></p>`
        : html`<div class="alert warn">Modalità locale: i dati sono solo in questo browser. Esegui backup regolari o collega GitHub.</div>`}
      <div class="toolbar">
        ${cfg.mode === 'github' ? raw('<button class="btn" id="link">📱 Collega un altro dispositivo</button>') : raw('<button class="btn" id="demo">Carica dati di esempio</button>')}
        <button class="btn" id="reconf">Cambia archivio / token</button>
        <button class="btn btn-danger" id="logout">Disconnetti questo dispositivo</button>
      </div>
    </div>
    <form class="card form" id="co" data-dirty><h2>Azienda e regole</h2>
      <div class="form-grid">
        ${field('Ragione sociale', input('companyName', s.companyName))}
        ${field('Indirizzo (persona responsabile in etichetta)', input('companyAddress', s.companyAddress))}
        ${field('Persona responsabile (Reg. 1223/2009 art. 4)', input('responsiblePerson', s.responsiblePerson))}
        ${field('Aliquota IVA %', input('vatRate', s.vatRate, 'inputmode="decimal" data-type="number"'))}
      </div>
      <div class="form-grid">
        ${field('Prefisso lotti materie prime', input('mpLotPrefix', s.mpLotPrefix))}
        ${field('Prefisso lotti packaging', input('pkLotPrefix', s.pkLotPrefix))}
        ${field('Prefisso lotti prodotto finito', input('pfLotPrefix', s.pfLotPrefix))}
        ${field('Avviso scadenza (giorni)', input('expiryWarningDays', s.expiryWarningDays, 'type="number" min="1"'))}
      </div>
      <h3>Etichette</h3>
      <div class="form-grid">
        ${field('Piccola: larghezza × altezza (mm)', html`<div style="display:flex;gap:.4rem">${raw(input('ls_w', s.labelSmall.w, 'inputmode="decimal"'))}${raw(input('ls_h', s.labelSmall.h, 'inputmode="decimal"'))}</div>`)}
        ${field('Grande: larghezza × altezza (mm)', html`<div style="display:flex;gap:.4rem">${raw(input('ll_w', s.labelLarge.w, 'inputmode="decimal"'))}${raw(input('ll_h', s.labelLarge.h, 'inputmode="decimal"'))}</div>`)}
        ${field('Foglio A4: colonne × righe', html`<div style="display:flex;gap:.4rem">${raw(input('sh_cols', s.sheet.cols, 'type="number"'))}${raw(input('sh_rows', s.sheet.rows, 'type="number"'))}</div>`)}
        ${field('Foglio A4: etichetta L × H (mm)', html`<div style="display:flex;gap:.4rem">${raw(input('sh_w', s.sheet.w, 'inputmode="decimal"'))}${raw(input('sh_h', s.sheet.h, 'inputmode="decimal"'))}</div>`)}
        ${field('Foglio A4: margine sup. / sin. (mm, 0 = centrato)', html`<div style="display:flex;gap:.4rem">${raw(input('sh_mt', s.sheet.marginTop, 'inputmode="decimal"'))}${raw(input('sh_ml', s.sheet.marginLeft, 'inputmode="decimal"'))}</div>`)}
      </div>
      <div class="toolbar"><button class="btn btn-primary">Salva impostazioni</button></div>
    </form>
    <div class="card"><h2>Informazioni</h2><p><b>5a Essenzia ${versionLabel({ long: true })}</b> <button class="btn btn-sm" id="upd">Cerca aggiornamenti</button></p><p class="muted small"> PWA installabile (menu del browser → "Installa app" / "Aggiungi a schermata Home"). La fotocamera richiede HTTPS. Supporto conformità: Reg. (CE) 1223/2009, GMP ISO 22716 — il software è uno strumento di supporto e non sostituisce la valutazione della sicurezza.</p></div>`);

  $('#upd', el).onclick = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return toast('Aggiornamento automatico non disponibile in questo browser', 'warn');
    await reg.update().catch(() => {});
    toast(reg.installing || reg.waiting ? 'Nuova versione in arrivo…' : 'Stai usando la versione più recente', 'ok');
  };
  $('#dev', el).addEventListener('submit', e => {
    e.preventDefault();
    const d = readForm(e.target);
    const c = { ...loadConfig(), ...d };
    saveConfig(c); app.store.config = c;
    toast('Salvato', 'ok');
  });
  $('#co', el).addEventListener('submit', async e => {
    e.preventDefault();
    const d = readForm(e.target);
    const patch = {
      companyName: d.companyName, companyAddress: d.companyAddress, responsiblePerson: d.responsiblePerson, vatRate: num(d.vatRate, 22),
      mpLotPrefix: d.mpLotPrefix, pkLotPrefix: d.pkLotPrefix, pfLotPrefix: d.pfLotPrefix, expiryWarningDays: num(d.expiryWarningDays, 60),
      labelSmall: { w: num(d.ls_w, 50), h: num(d.ls_h, 30) }, labelLarge: { w: num(d.ll_w, 100), h: num(d.ll_h, 70) },
      sheet: { cols: num(d.sh_cols, 3), rows: num(d.sh_rows, 8), w: num(d.sh_w, 70), h: num(d.sh_h, 37), marginTop: num(d.sh_mt, 0), marginLeft: num(d.sh_ml, 0) },
    };
    if (await app.run(() => app.dispatch('settings.update', { patch }), 'Impostazioni salvate')) { app.setDirty(false); app.render(); }
  });
  $('#link', el)?.addEventListener('click', () => {
    const payload = CFG_PREFIX + utf8ToB64(JSON.stringify({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, dir: cfg.dir, token: cfg.token }));
    openModal({
      title: 'Collega un altro dispositivo',
      body: String(html`<div class="alert warn">Il QR contiene il token di accesso: mostralo solo ai dispositivi del laboratorio e non fotografarlo/condividerlo.</div>
        <div class="center"><div class="qrbox">${raw(qrSvg(payload, 260, 'L'))}</div></div>
        <p class="small">Sul nuovo dispositivo apri l'app → "Scansiona QR da un altro dispositivo". In alternativa crea un token separato per ogni dispositivo (consigliato: puoi revocarlo singolarmente).</p>`),
      actions: [{ label: 'Chiudi' }],
    });
  });
  $('#demo', el)?.addEventListener('click', async () => {
    if (db.materials.length && !await confirmDialog('Aggiungere i dati di esempio a quelli esistenti?')) return;
    await app.run(() => loadDemo(app), 'Dati di esempio caricati');
  });
  $('#reconf', el).onclick = () => {
    const m = openModal({
      title: 'Archivio dati', body: String(html`<form class="form" id="rc">${connectionFields(cfg)}</form>`),
      actions: [{ label: 'Annulla' }, {
        label: 'Verifica e salva', primary: true, onClick: async (wrap) => {
          const c = readForm($('#rc', wrap));
          await new GitHubBackend(c).testAccess();
          await saveConfig({ mode: 'github', ...c });
          location.reload();
        },
      }],
    });
    return m;
  };
  $('#logout', el).onclick = async () => {
    if (app.store.pending.length && !await confirmDialog(`Ci sono ${app.store.pending.length} operazioni non ancora sincronizzate che andranno perse.`, { danger: true, okLabel: 'Disconnetti comunque' })) return;
    if (!await confirmDialog('Rimuovere configurazione e token da questo dispositivo? I dati su GitHub non vengono toccati.', { danger: true, okLabel: 'Disconnetti' })) return;
    await clearConfig();
    await kv.del(app.store.cacheKey);
    location.hash = '#/';
    location.reload();
  };
}
