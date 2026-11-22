import { html, table, $, downloadBlob } from '../ui.js';
import { byId, traceForward, traceBackward, traceBatchForward, findByCode } from '../domain.js';
import { fmtDate, fmtQty, normKey } from '../util.js';
import { toCSV } from '../io.js';
import { pageHead, batchBadge, matName } from './common.js';

export function trace(el, { app, query }) {
  const db = app.db;
  const lotId = query.get('lot'), batchId = query.get('batch'), q = query.get('q') || '';
  let body = '';
  let recall = [];
  if (lotId) {
    const fw = traceForward(db, lotId);
    const lot = fw.lot;
    if (lot) {
      const m = byId(db.materials, lot.materialId) || {};
      const sup = byId(db.suppliers, lot.supplierId);
      body = html`<div class="card"><h2>⬆️ Origine</h2><dl class="kv"><dt>Materia</dt><dd>${m.name} <span class="muted">${m.inci || ''}</span></dd><dt>Lotto interno</dt><dd><a href="#/lot/${lot.id}" class="mono">${lot.lotCode}</a></dd>
        <dt>Lotto fornitore</dt><dd class="mono">${lot.supplierLot || '—'}</dd><dt>Fornitore</dt><dd>${sup?.name || '—'}</dd><dt>Carico</dt><dd>${fmtDate(lot.receivedAt)} ${lot.ddt ? '· DDT ' + lot.ddt : ''}</dd></dl></div>
        <div class="card"><h2>⬇️ Utilizzo e distribuzione</h2>
        ${fw.batches.length ? html`<ul class="tree">${fw.batches.map(x => {
          const used = [...(x.batch.picks || []), ...(x.batch.packagingUsed || [])].filter(p => p.lotId === lot.id).reduce((s, p) => s + p.qty, 0);
          x.orders.forEach(o => recall.push({ Cliente: o.customer?.name, Email: o.customer?.email || '', Telefono: o.customer?.phone || '', Ordine: o.order.number, Data: fmtDate(o.order.date), 'Lotto prodotto': x.batch.lotCode, Prodotto: x.batch.recipeName, Unità: o.units }));
          return html`<li>🏭 <a href="#/batch/${x.batch.id}"><b>${x.batch.lotCode}</b> · ${x.batch.recipeName}</a> ${batchBadge(x.batch)} <span class="muted small">usati ${fmtQty(used, lot.unit)} · ${x.batch.unitsAvailable ?? 0} pz ancora a magazzino</span>
            ${x.orders.length ? html`<ul class="tree">${x.orders.map(o => html`<li>👤 <b>${o.customer?.name || '?'}</b> · <a href="#/order/${o.order.id}">ordine ${o.order.number}</a> del ${fmtDate(o.order.date)} · ${o.units} pz</li>`)}</ul>` : html`<div class="muted small">nessuna vendita registrata</div>`}</li>`;
        })}</ul>` : html`<p class="muted">Lotto non ancora utilizzato in produzione.</p>`}</div>`;
    }
  } else if (batchId) {
    const bw = traceBackward(db, batchId);
    if (bw) {
      const fw = traceBatchForward(db, batchId);
      fw.orders.forEach(o => recall.push({ Cliente: o.customer?.name, Email: o.customer?.email || '', Telefono: o.customer?.phone || '', Ordine: o.order.number, Data: fmtDate(o.order.date), 'Lotto prodotto': bw.batch.lotCode, Prodotto: bw.batch.recipeName, Unità: o.units }));
      body = html`<div class="card"><h2>🏭 ${bw.batch.recipeName} · <span class="mono">${bw.batch.lotCode}</span></h2><p>${batchBadge(bw.batch)} prodotto il ${fmtDate(bw.batch.producedAt)} · scad. ${fmtDate(bw.batch.expiry)} · formula v${bw.batch.recipeVersion}</p></div>
        <div class="card"><h2>⬆️ Materie prime e packaging impiegati</h2>
          ${table(['Tipo', 'Materia', 'Lotto interno', 'Lotto fornitore', 'Fornitore', ['Quantità', 'num']], bw.rows.map(r => html`<tr><td data-l="Tipo">${r.kind}</td><td data-l="Materia">${r.material?.name}</td>
            <td data-l="Lotto"><a class="mono" href="#/lot/${r.lotId}">${r.lot?.lotCode}</a></td><td class="mono" data-l="Lotto forn.">${r.lot?.supplierLot}</td><td data-l="Fornitore">${r.supplier?.name || ''}</td><td class="num" data-l="Q.tà">${fmtQty(r.qty, r.lot?.unit)}</td></tr>`), { cls: 'cards' })}</div>
        <div class="card"><h2>⬇️ Clienti</h2>${fw.orders.length ? html`<ul class="tree">${fw.orders.map(o => html`<li>👤 <b>${o.customer?.name}</b> · <a href="#/order/${o.order.id}">${o.order.number}</a> del ${fmtDate(o.order.date)} · ${o.units} pz</li>`)}</ul>` : html`<p class="muted">Nessuna vendita registrata.</p>`}</div>`;
    }
  } else if (q) {
    const found = findByCode(db, q);
    const orders = db.orders.filter(o => normKey(o.number) === normKey(q));
    const cust = db.customers.filter(c => normKey(c.name).includes(normKey(q)));
    body = html`<div class="card"><h2>Risultati</h2><ul class="timeline">
      ${found.map(f => html`<li><a href="#/trace?${f.type}=${f.item.id}">${f.type === 'lot' ? '📦 ' + matName(db, f.item.materialId) : '🏭 ' + f.item.recipeName} · ${f.item.lotCode}</a></li>`)}
      ${orders.map(o => html`<li>🧾 <a href="#/order/${o.id}">Ordine ${o.number}</a> → ${o.lines.flatMap(l => l.allocations || []).map(a => html`<a class="mono" href="#/trace?batch=${a.batchId}">${a.lotCode}</a> `)}</li>`)}
      ${cust.map(c => html`<li>👤 ${c.name}: ${db.orders.filter(o => o.customerId === c.id && o.status !== 'annullato').flatMap(o => o.lines.flatMap(l => l.allocations || [])).map(a => html`<a class="mono" href="#/trace?batch=${a.batchId}">${a.lotCode}</a> `)}</li>`)}
      ${!found.length && !orders.length && !cust.length ? html`<li class="muted">Nessun risultato</li>` : ''}</ul></div>`;
  }
  el.innerHTML = String(html`${pageHead('Tracciabilità', 'Dall\'ingrediente al cliente finale e viceversa')}
    <form class="card toolbar" id="tf"><input class="search" name="q" value="${q}" placeholder="Lotto interno, lotto fornitore, n. ordine o cliente"><button class="btn btn-primary">Cerca</button><a class="btn" href="#/scan">📷</a></form>
    ${body || html`<div class="card"><p class="muted">Cerca un codice, oppure apri la tracciabilità dalla scheda di un lotto.</p>
      <h3>Ultimi lotti di produzione</h3><ul class="timeline">${[...db.batches].sort((a, b) => (b.producedAt || '').localeCompare(a.producedAt || '')).slice(0, 10).map(b => html`<li><a href="#/trace?batch=${b.id}">${b.lotCode} · ${b.recipeName}</a>${batchBadge(b)}</li>`)}</ul></div>`}
    ${recall.length ? html`<div class="toolbar"><button class="btn btn-danger" id="recall">📣 Esporta elenco clienti per richiamo (CSV)</button></div>` : ''}`);
  $('#tf', el).addEventListener('submit', e => { e.preventDefault(); app.navigate(`#/trace?q=${encodeURIComponent(e.target.q.value.trim())}`); });
  $('#recall', el)?.addEventListener('click', () => downloadBlob(new Blob([toCSV(recall)], { type: 'text/csv' }), `richiamo-${Date.now()}.csv`));
}
