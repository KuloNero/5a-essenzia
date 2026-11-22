import { html, table } from '../ui.js';
import { lowStock, expiringLots, byId, materialStock } from '../domain.js';
import { today, fmtDate, fmtQty, fmtDateTime, fmtEur } from '../util.js';
import { activeBatches, batchBadge, matName, pageHead } from './common.js';

export function dashboard(el, { app }) {
  const db = app.db;
  const d = today();
  const low = lowStock(db);
  const exp = expiringLots(db, d, db.settings.expiryWarningDays);
  const expired = exp.filter(x => x.days < 0);
  const expiring = exp.filter(x => x.days >= 0);
  const active = activeBatches(db);
  const toRelease = db.batches.filter(b => b.status === 'completato');
  const stockValue = db.materials.reduce((s, m) => s + materialStock(db, m.id).value, 0);
  const recent = [...db.movements].sort((a, b) => b.ts - a.ts).slice(0, 12);
  const empty = !db.materials.length;

  el.innerHTML = String(html`
    ${pageHead(db.settings.companyName || 'Dashboard', `Oggi ${fmtDate(d)}${app.store.config.user ? ' · operatore ' + app.store.config.user : ''}`)}
    <div class="quick">
      <a href="#/scan"><span class="ico">📷</span>Scansiona QR</a>
      <a href="#/receive"><span class="ico">📥</span>Carico merce</a>
      <a href="#/batch-new" class="alt"><span class="ico">🏭</span>Nuova produzione</a>
      <a href="#/order-new" class="alt"><span class="ico">🧾</span>Nuovo ordine</a>
    </div>
    ${empty ? html`<div class="card"><h2>Benvenuto 👋</h2><p>Per iniziare: inserisci i <a href="#/suppliers">fornitori</a> e le <a href="#/materials">materie prime</a> (anche da <a href="#/data">import CSV/XLSX</a>), crea una <a href="#/recipes">ricetta</a>, poi registra il <a href="#/receive">carico</a> dei lotti e stampa le etichette QR.</p></div>` : ''}
    <div class="kpis">
      <a class="kpi ${expired.length ? 'danger' : ''}" href="#/warehouse?f=expired"><div class="v">${expired.length}</div><div class="l">Lotti scaduti con giacenza</div></a>
      <a class="kpi ${expiring.length ? 'warn' : ''}" href="#/warehouse?f=expiring"><div class="v">${expiring.length}</div><div class="l">In scadenza (${db.settings.expiryWarningDays} gg)</div></a>
      <a class="kpi ${low.length ? 'warn' : ''}" href="#/warehouse?tab=stock&f=low"><div class="v">${low.length}</div><div class="l">Sotto scorta minima</div></a>
      <a class="kpi" href="#/batches"><div class="v">${active.length}</div><div class="l">Produzioni in corso</div></a>
      <a class="kpi ${toRelease.length ? 'warn' : ''}" href="#/batches?f=completato"><div class="v">${toRelease.length}</div><div class="l">Lotti da rilasciare (QC)</div></a>
      <a class="kpi" href="#/warehouse?tab=stock"><div class="v">${fmtEur(stockValue)}</div><div class="l">Valore magazzino MP/PK</div></a>
    </div>
    <div class="grid-2">
      <div class="card"><h2>Attenzione</h2>
        ${!expired.length && !expiring.length && !low.length ? html`<p class="muted">Nessuna criticità 🎉</p>` : ''}
        <ul class="timeline">
          ${expired.slice(0, 8).map(x => html`<li><a href="#/lot/${x.lot.id}">⛔ ${matName(db, x.lot.materialId)} · ${x.lot.lotCode}</a><span class="badge danger">scaduto ${fmtDate(x.lot.expiry)}</span></li>`)}
          ${expiring.slice(0, 8).map(x => html`<li><a href="#/lot/${x.lot.id}">⏳ ${matName(db, x.lot.materialId)} · ${x.lot.lotCode}</a><span class="badge warn">${x.days} gg</span></li>`)}
          ${low.slice(0, 8).map(x => html`<li><a href="#/material/${x.material.id}">📉 ${x.material.name}</a><span class="badge warn">${fmtQty(x.stock.usable, x.material.unit)} / min ${fmtQty(x.material.minStock, x.material.unit)}</span></li>`)}
        </ul>
      </div>
      <div class="card"><h2>Produzione</h2>
        ${[...active, ...toRelease].length ? html`<ul class="timeline">${[...active, ...toRelease].map(b => html`<li><a href="#/batch/${b.id}">${b.lotCode} · ${b.recipeName}</a>${batchBadge(b)}</li>`)}</ul>` : html`<p class="muted">Nessuna produzione aperta. <a href="#/batch-new">Pianifica un lotto</a></p>`}
      </div>
    </div>
    <div class="card"><h2>Ultimi movimenti</h2>
      ${table(['Data', 'Tipo', 'Articolo', 'Lotto', ['Quantità', 'num'], 'Operatore'], recent.map(mv => {
        const lot = byId(db.lots, mv.lotId), b = byId(db.batches, mv.batchId);
        const art = mv.itemKind === 'PF' ? (b?.recipeName || '') : matName(db, mv.materialId);
        const link = lot ? `#/lot/${lot.id}` : b ? `#/batch/${b.id}` : '#/';
        return html`<tr class="clickable" data-href="${link}"><td data-l="Data" class="nowrap">${fmtDateTime(mv.ts)}</td><td data-l="Tipo">${mv.type}</td><td data-l="Articolo">${art}</td><td data-l="Lotto" class="mono">${lot?.lotCode || b?.lotCode || ''}</td><td data-l="Q.tà" class="num nowrap">${mv.qty > 0 ? '+' : ''}${fmtQty(mv.qty, mv.unit)}</td><td data-l="Operatore">${[mv.user, mv.device].filter(Boolean).join(' · ')}</td></tr>`;
      }), { cls: 'cards' })}
    </div>`);
}
