import { html, raw, table, field, input, select, $, toast, bindSearch, openModal, formDialog } from '../ui.js';
import { byId, lotState, materialStock, findByCode, fefoLots, batchPickedByMaterial, scaleRecipe } from '../domain.js';
import { today, fmtDate, fmtQty, fmtDateTime, fmtEur, uid, round, num, sortBy } from '../util.js';
import { decodePayload, qrSvg, lotPayload } from '../qr.js';
import { startScanner } from '../scanner.js';
import { pageHead, lotBadge, withdrawDialog, adjustDialog, lotStatusDialog, labelDialog, lotLabelItem, docsSection, bindDocs, matName, materialOptions, batchBadge } from './common.js';

// ---------------- Magazzino ----------------
export function warehouse(el, { app, query }) {
  const db = app.db;
  const tab = query.get('tab') || 'lots';
  const f = query.get('f') || '';
  const d = today();
  const tabs = html`<div class="tabs">
    <a href="#/warehouse" class="${tab === 'lots' ? 'active' : ''}">Lotti</a>
    <a href="#/warehouse?tab=stock" class="${tab === 'stock' ? 'active' : ''}">Giacenze per articolo</a>
    <a href="#/warehouse?tab=finished" class="${tab === 'finished' ? 'active' : ''}">Prodotti finiti</a>
    <a href="#/warehouse?tab=moves" class="${tab === 'moves' ? 'active' : ''}">Movimenti</a></div>`;
  let content = '';
  if (tab === 'lots') {
    let lots = db.lots.map(l => ({ l, st: lotState(l, d, db.settings.expiryWarningDays), m: byId(db.materials, l.materialId) || {} }));
    if (f) lots = lots.filter(x => f === 'all' ? true : x.st === f || (f === 'pk' && x.m.category === 'packaging') || (f === 'mp' && x.m.category !== 'packaging' && x.st !== 'empty'));
    else lots = lots.filter(x => x.st !== 'empty');
    lots = sortBy(lots, x => `${x.m.name}|${x.l.expiry || '9999'}`);
    content = html`<div class="toolbar"><input class="search" placeholder="Cerca materia, lotto, fornitore…" id="q">
      ${select('f', [['', 'Con giacenza'], ['mp', 'Solo materie prime'], ['pk', 'Solo packaging'], ['expiring', 'In scadenza'], ['expired', 'Scaduti'], ['quarantine', 'In quarantena'], ['blocked', 'Bloccati'], ['empty', 'Esauriti'], ['all', 'Tutti']], f, 'id="flt" style="max-width:220px"')}</div>
      ${table(['Materia', 'Lotto', 'Lotto forn.', 'Scadenza', ['Giacenza', 'num'], 'Stato', ''], lots.map(({ l, m }) => html`<tr class="clickable row" data-href="#/lot/${l.id}">
        <td data-l="Materia"><b>${m.name}</b> ${m.category === 'packaging' ? html`<span class="badge">PK</span>` : ''}</td>
        <td data-l="Lotto" class="mono">${l.lotCode}</td><td data-l="Lotto forn." class="mono">${l.supplierLot}</td>
        <td data-l="Scadenza" class="nowrap">${fmtDate(l.expiry)}</td><td data-l="Giacenza" class="num nowrap">${fmtQty(l.qty, l.unit)}</td>
        <td>${lotBadge(l, db)}</td><td class="row-actions"><button class="btn btn-sm" data-wd="${l.id}">Preleva</button></td></tr>`), { cls: 'cards' })}`;
  } else if (tab === 'stock') {
    let rows = db.materials.filter(m => !m.archived).map(m => ({ m, s: materialStock(db, m.id) }));
    if (f === 'low') rows = rows.filter(x => Number(x.m.minStock) > 0 && x.s.usable < Number(x.m.minStock));
    rows = sortBy(rows, x => x.m.name.toLowerCase());
    const tot = rows.reduce((s, x) => s + x.s.value, 0);
    content = html`<div class="toolbar"><input class="search" placeholder="Cerca…" id="q">
      ${select('f', [['', 'Tutti gli articoli'], ['low', 'Sotto scorta minima']], f, 'id="flt2" style="max-width:220px"')}</div>
      ${table(['Articolo', 'Tipo', ['Utilizzabile', 'num'], ['Totale', 'num'], ['Scorta min.', 'num'], ['Valore', 'num'], 'Prossimo FEFO'], rows.map(({ m, s }) => {
        const next = fefoLots(db, m.id, d)[0];
        const low = Number(m.minStock) > 0 && s.usable < Number(m.minStock);
        return html`<tr class="clickable row" data-href="#/material/${m.id}"><td data-l="Articolo"><b>${m.name}</b> <span class="muted small">${m.code}</span></td>
          <td data-l="Tipo">${m.category === 'packaging' ? 'Packaging' : 'MP'}</td>
          <td data-l="Utilizzabile" class="num nowrap">${low ? html`<span class="badge warn">${fmtQty(s.usable, m.unit)}</span>` : fmtQty(s.usable, m.unit)}</td>
          <td data-l="Totale" class="num nowrap">${fmtQty(s.qty, m.unit)}</td><td data-l="Scorta min." class="num">${m.minStock ? fmtQty(m.minStock, m.unit) : ''}</td>
          <td data-l="Valore" class="num">${fmtEur(s.value)}</td><td data-l="FEFO" class="mono">${next ? `${next.lotCode} (${fmtDate(next.expiry) || 'n.d.'})` : '—'}</td></tr>`;
      }), { cls: 'cards' })}<p class="right"><b>Valore totale: ${fmtEur(tot)}</b></p>`;
  } else if (tab === 'finished') {
    const bs = sortBy(db.batches.filter(b => ['rilasciato', 'completato'].includes(b.status) && b.unitsAvailable > 0), b => b.expiry || '9999');
    content = table(['Prodotto', 'Lotto', 'Produzione', 'Scadenza', ['Disponibili', 'num'], 'Stato'], bs.map(b => html`<tr class="clickable" data-href="#/batch/${b.id}">
      <td data-l="Prodotto"><b>${b.recipeName}</b></td><td data-l="Lotto" class="mono">${b.lotCode}</td><td data-l="Prod.">${fmtDate(b.producedAt)}</td>
      <td data-l="Scad.">${fmtDate(b.expiry)}</td><td data-l="Disp." class="num">${b.unitsAvailable} / ${b.unitsProduced} pz</td><td>${batchBadge(b)}</td></tr>`), { cls: 'cards' });
  } else {
    const mv = [...db.movements].sort((a, b) => b.ts - a.ts).slice(0, 500);
    content = html`<div class="toolbar"><input class="search" placeholder="Cerca…" id="q"><a class="btn" href="#/data">Esporta report</a></div>
      ${table(['Data', 'Tipo', 'Articolo', 'Lotto', ['Q.tà', 'num'], 'Rif.', 'Operatore', 'Note'], mv.map(m => {
        const lot = byId(db.lots, m.lotId), b = byId(db.batches, m.batchId);
        return html`<tr class="row ${lot || b ? 'clickable' : ''}" data-href="${lot ? `#/lot/${lot.id}` : b ? `#/batch/${b.id}` : ''}"><td data-l="Data" class="nowrap">${fmtDateTime(m.ts)}</td><td data-l="Tipo">${m.type}</td>
        <td data-l="Articolo">${m.itemKind === 'PF' ? b?.recipeName : matName(db, m.materialId)}</td><td data-l="Lotto" class="mono">${lot?.lotCode || (m.itemKind === 'PF' ? b?.lotCode : '')}</td>
        <td data-l="Q.tà" class="num nowrap">${m.qty > 0 ? '+' : ''}${fmtQty(m.qty, m.unit)}</td><td data-l="Rif." class="mono">${m.itemKind !== 'PF' && b ? b.lotCode : ''}${m.orderId ? byId(db.orders, m.orderId)?.number : ''}</td>
        <td data-l="Operatore">${m.user}${m.device ? ` · ${m.device}` : ''}</td><td data-l="Note" class="small">${m.note}</td></tr>`;
      }), { cls: 'cards compact' })}`;
  }
  el.innerHTML = String(html`${pageHead('Magazzino', 'Lotti, giacenze e movimenti', '<a class="btn" href="#/scan">📷 Scansiona</a><a class="btn btn-primary" href="#/receive">📥 Carico</a>')}${tabs}${content}`);
  bindSearch(el, '#q', 'tr.row');
  $('#flt', el)?.addEventListener('change', e => app.navigate(`#/warehouse?f=${e.target.value}`));
  $('#flt2', el)?.addEventListener('change', e => app.navigate(`#/warehouse?tab=stock&f=${e.target.value}`));
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-wd]');
    if (b) withdrawDialog(app, byId(app.db.lots, b.dataset.wd));
  });
}

// ---------------- Carico ----------------
export function receive(el, { app, query }) {
  const db = app.db;
  const preMat = query.get('material') || '';
  const m0 = byId(db.materials, preMat);
  const mats = materialOptions(db);
  const draft = { receivedAt: today(), status: 'ok', containers: 1, supplierLot: query.get('supplierLot') || '' };
  el.innerHTML = String(html`${pageHead('Carico / accettazione merce', 'Registra un nuovo lotto in ingresso e stampa subito l\'etichetta QR')}
    ${!mats.length ? html`<div class="alert warn">Nessuna materia prima in anagrafica. <a href="#/material/new">Creane una</a> prima del carico.</div>` : ''}
    <form class="card form" id="recv" data-dirty autocomplete="off">
      <div class="form-grid">
        ${field('Materia prima / packaging *', select('materialId', [['', '— seleziona —'], ...mats], preMat, 'required'))}
        ${field('Fornitore', select('supplierId', [['', '— dall\'anagrafica materia —'], ...db.suppliers.map(s => [s.id, s.name])], m0?.supplierId || ''))}
      </div>
      <div class="form-grid">
        ${field('Lotto fornitore', input('supplierLot', draft.supplierLot, 'placeholder="come da etichetta/CoA"'))}
        ${field('Documento di trasporto (DDT)', input('ddt', ''))}
        ${field('Data carico', input('receivedAt', draft.receivedAt, 'type="date"'))}
        ${field('Data di produzione (fornitore)', input('productionDate', '', 'type="date"'))}
        ${field('Scadenza / retest *', input('expiry', '', 'type="date"'), 'Obbligatoria per la logica FEFO')}
      </div>
      <div class="form-grid">
        ${field(raw(`Quantità ricevuta <span id="um">${m0?.unit || 'g'}</span> *`), input('qty', '', 'inputmode="decimal" data-type="number" required class="big"'))}
        ${field('N. contenitori (copie etichetta)', input('containers', 1, 'type="number" min="1" inputmode="numeric"'))}
        ${field(raw(`Costo <span id="cu">${m0?.unit === 'pz' ? '€/pz' : '€/kg'}</span>`), input('cost', m0?.cost ?? '', 'inputmode="decimal" data-type="number"'))}
        ${field('Stato all\'accettazione', select('status', [['ok', 'Disponibile'], ['quarantine', 'Quarantena (attesa CoA/QC)']], 'ok'))}
      </div>
      <div class="form-grid">
        ${field('Ubicazione', input('location', '', 'placeholder="es. Scaffale A3"'))}
        ${field('Note', input('note', ''))}
      </div>
      <label class="field check"><input type="checkbox" name="updateMaterialCost" checked> <span>Aggiorna il costo standard della materia con questo prezzo</span></label>
      <div class="toolbar"><button class="btn btn-primary btn-lg" type="submit">Registra carico e genera etichetta</button><a class="btn" href="#/material/new">+ Nuova materia</a></div>
    </form>`);
  const form = $('#recv', el);
  form.materialId.addEventListener('change', () => {
    const m = byId(app.db.materials, form.materialId.value);
    $('#um', el).textContent = m?.unit || 'g';
    $('#cu', el).textContent = m?.unit === 'pz' ? '€/pz' : '€/kg';
    if (m) { form.supplierId.value = m.supplierId || ''; form.cost.value = m.cost ?? ''; }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    fd.updateMaterialCost = form.updateMaterialCost.checked;
    if (!fd.materialId) return toast('Seleziona la materia prima', 'error');
    if (!(num(fd.qty) > 0)) return toast('Inserisci la quantità', 'error');
    const m = byId(app.db.materials, fd.materialId);
    if (!fd.expiry && m.category !== 'packaging' && !confirm('Scadenza non indicata: il lotto non sarà gestito in FEFO. Continuare?')) return;
    if (fd.expiry && fd.expiry < fd.receivedAt) return toast('La scadenza è precedente alla data di carico', 'error');
    const id = uid();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    const r = await app.run(() => app.dispatch('lot.receive', { lot: { ...fd, id, qty: num(fd.qty), cost: fd.cost === '' ? '' : num(fd.cost) } }));
    btn.disabled = false;
    if (!r) return;
    app.setDirty(false);
    const lot = byId(app.db.lots, id);
    toast(`Carico registrato: lotto ${lot.lotCode}`, r.queued ? 'warn' : 'ok');
    app.navigate(`#/lot/${id}?new=${Math.max(1, Number(fd.containers) || 1)}`);
  });
}

// ---------------- Scheda lotto ----------------
export function lotView(el, { app, params, query }) {
  const db = app.db;
  const lot = byId(db.lots, params[0]);
  if (!lot) { el.innerHTML = String(html`<div class="empty"><p>Lotto non trovato (forse non ancora sincronizzato).</p><button class="btn" id="rs">Sincronizza</button></div>`); $('#rs', el).onclick = () => app.store.sync(); return; }
  const m = byId(db.materials, lot.materialId) || {};
  const sup = byId(db.suppliers, lot.supplierId);
  const st = lotState(lot, today(), db.settings.expiryWarningDays);
  const moves = db.movements.filter(x => x.lotId === lot.id).sort((a, b) => b.ts - a.ts);
  const fefo = fefoLots(db, lot.materialId, today());
  const better = fefo[0] && fefo[0].id !== lot.id && (fefo[0].expiry || '9') < (lot.expiry || '9') ? fefo[0] : null;
  const batches = [...new Set(moves.map(x => x.batchId).filter(Boolean))].map(id => byId(db.batches, id)).filter(Boolean);
  el.innerHTML = String(html`
    ${pageHead(m.name || 'Lotto', html`${m.category === 'packaging' ? 'Packaging' : 'Materia prima'} · ${m.inci || ''}`, `<a class="btn" href="#/material/${m.id}">Anagrafica</a><a class="btn" href="#/trace?lot=${lot.id}">🔗 Tracciabilità</a>`)}
    ${st === 'expired' ? html`<div class="blocked-banner">⛔ LOTTO SCADUTO il ${fmtDate(lot.expiry)} — prelievo bloccato</div>` : ''}
    ${st === 'blocked' ? html`<div class="blocked-banner">⛔ LOTTO BLOCCATO — non utilizzare</div>` : ''}
    ${st === 'quarantine' ? html`<div class="alert warn">Lotto in quarantena: in attesa di rilascio (CoA / controllo in accettazione).</div>` : ''}
    ${better ? html`<div class="alert warn">FEFO: esiste un lotto che scade prima → <a href="#/lot/${better.id}">${better.lotCode}</a> (${fmtDate(better.expiry)})</div>` : ''}
    <div class="card lot-hero">
      <div class="qrbox">${raw(qrSvg(lotPayload(lot, m), 150))}</div>
      <div>
        <div class="big-qty">${fmtQty(lot.qty, lot.unit)}</div>
        <div class="muted">su ${fmtQty(lot.qtyInitial, lot.unit)} ricevuti · ${lotBadge(lot, db)}</div>
        <dl class="kv" style="margin-top:.6rem">
          <dt>Lotto interno</dt><dd class="mono">${lot.lotCode}</dd>
          <dt>Lotto fornitore</dt><dd class="mono">${lot.supplierLot || '—'}</dd>
          <dt>Fornitore</dt><dd>${sup?.name || '—'}</dd>
          <dt>Carico</dt><dd>${fmtDate(lot.receivedAt)}${lot.ddt ? ` · DDT ${lot.ddt}` : ''}</dd>
          <dt>Scadenza</dt><dd>${fmtDate(lot.expiry) || '—'}</dd>
          ${lot.location ? html`<dt>Ubicazione</dt><dd>${lot.location}</dd>` : ''}
          ${lot.cost !== '' && lot.cost !== undefined ? html`<dt>Costo</dt><dd>${fmtEur(lot.cost)} ${m.unit === 'pz' ? '/pz' : '/kg'}</dd>` : ''}
        </dl>
      </div>
    </div>
    <div class="toolbar">
      <button class="btn btn-primary btn-lg" id="wd" ${['expired', 'blocked', 'quarantine', 'empty'].includes(st) ? 'disabled' : ''}>➖ Prelievo</button>
      <button class="btn btn-lg" id="adj">✏️ Rettifica</button>
      <button class="btn btn-lg" id="stt">🔒 Stato / scadenza</button>
      <button class="btn btn-lg" id="lbl">🏷️ Etichetta</button>
    </div>
    ${batches.length ? html`<div class="card"><h2>Usato nei lotti di produzione</h2><ul class="timeline">${batches.map(b => html`<li><a href="#/batch/${b.id}">${b.lotCode} · ${b.recipeName}</a>${batchBadge(b)}</li>`)}</ul></div>` : ''}
    <div class="card"><h2>Storico movimenti</h2>
      <ul class="timeline">${moves.map(mv => html`<li><span><b>${mv.type}</b> ${mv.batchId ? html`→ <a href="#/batch/${mv.batchId}">${byId(db.batches, mv.batchId)?.lotCode || ''}</a>` : ''}<br><span class="muted small">${fmtDateTime(mv.ts)} · ${mv.user}${mv.device ? ' · ' + mv.device : ''} ${mv.note ? ' · ' + mv.note : ''}</span></span><span class="nowrap"><b>${mv.qty > 0 ? '+' : ''}${fmtQty(mv.qty, mv.unit)}</b></span></li>`)}</ul>
    </div>
    ${raw(docsSection(app, 'material', m.id, { lotId: lot.id, title: 'Certificati del lotto (CoA)' }))}`);
  $('#wd', el).onclick = () => withdrawDialog(app, lot);
  $('#adj', el).onclick = () => adjustDialog(app, lot);
  $('#stt', el).onclick = () => lotStatusDialog(app, lot);
  $('#lbl', el).onclick = () => labelDialog(app, [lotLabelItem(db, lot, Number(query.get('new')) || 1)], { format: m.category === 'packaging' || lot.qtyInitial >= 5000 ? 'large' : 'small' });
  bindDocs(el, app);
  if (query.get('new')) {
    history.replaceState(null, '', `#/lot/${lot.id}`);
    labelDialog(app, [lotLabelItem(db, lot, Number(query.get('new')) || 1)], { format: lot.qtyInitial >= 5000 ? 'large' : 'small', title: 'Carico registrato · stampa etichette' });
  }
}

// ---------------- Scansione ----------------
export function scan(el, { app, query }) {
  const batchId = query.get('batch') || '';
  const batch = byId(app.db.batches, batchId);
  el.innerHTML = String(html`${pageHead(batch ? `Prelievi per ${batch.lotCode}` : 'Scansiona QR', batch ? batch.recipeName : 'Inquadra l\'etichetta di un lotto (materia prima, packaging o prodotto finito)')}
    ${batch ? html`<div class="card" id="pickinfo"></div>` : ''}
    <div id="cam"></div>
    <div class="card" style="margin-top:1rem"><form id="manual" class="toolbar" style="margin:0"><input class="search" name="code" placeholder="…oppure digita il codice lotto" autocomplete="off"><button class="btn">Cerca</button></form></div>`);
  if (batch) renderPickInfo($('#pickinfo', el), app, batch);
  let scanner = null;
  let busy = false;
  const handle = async (text) => {
    if (busy) return true;
    busy = true;
    try { return await handleCode(app, text, { batch, restart: () => {} }); }
    finally { setTimeout(() => { busy = false; }, 600); }
  };
  startScanner($('#cam', el), handle, { onError: e => { $('#cam', el).innerHTML = String(html`<div class="alert warn">${e.message}</div>`); } }).then(s => { scanner = s; });
  $('#manual', el).addEventListener('submit', e => { e.preventDefault(); handle(e.target.code.value.trim()); });
  return {
    cleanup: () => scanner?.stop(),
    onData: () => { if (batch) renderPickInfo($('#pickinfo', el), app, byId(app.db.batches, batchId)); },
  };
}

function renderPickInfo(box, app, batch) {
  if (!box || !batch) return;
  const db = app.db;
  const snap = batch.recipeSnapshot || byId(db.recipes, batch.recipeId);
  const scaled = scaleRecipe(snap, batch.targetWeight);
  const picked = batchPickedByMaterial(batch);
  const rows = scaled.phases.flatMap(ph => ph.items.map(it => ({ ph, it, done: picked[it.materialId] || 0 })));
  box.innerHTML = String(html`<h3 style="margin-top:0">Pesate da registrare</h3><ul class="timeline">${rows.map(({ ph, it, done }) => {
    const left = round(it.grams - done, 2);
    return html`<li><span>${ph.name} · <b>${matName(db, it.materialId)}</b></span><span class="nowrap">${left <= 0.005 ? html`<span class="badge ok">✓ ${fmtQty(done, 'g')}</span>` : html`<span class="badge warn">${fmtQty(done, 'g')} / ${fmtQty(it.grams, 'g')}</span>`}</span></li>`;
  })}</ul>`);
}

/** Gestisce un codice letto. Restituisce true per continuare a scansionare. */
export async function handleCode(app, text, { batch } = {}) {
  let db = app.db;
  const p = decodePayload(text);
  if (/^ESZCFG1\|/.test(text)) { toast('QR di configurazione: usalo dalla schermata Impostazioni → Collega dispositivo', 'warn'); return true; }
  const findLot = () => byId(app.db.lots, p.id) || app.db.lots.find(l => l.lotCode === p.lot);
  const findBatch = () => byId(app.db.batches, p.id) || app.db.batches.find(b => b.lotCode === p.lot);
  if (p.t === 'MP' || p.t === 'PK') {
    let lot = findLot();
    if (!lot) { await app.store.sync(); lot = findLot(); }
    if (!lot) { toast(`Lotto ${p.lot} non trovato nell'archivio`, 'error'); return true; }
    if (batch) {
      const snap = batch.recipeSnapshot || {};
      const scaled = scaleRecipe(snap, batch.targetWeight);
      const it = scaled.phases.flatMap(ph => ph.items).find(i => i.materialId === lot.materialId);
      const done = batchPickedByMaterial(byId(app.db.batches, batch.id))[lot.materialId] || 0;
      if (!it) toast('Attenzione: questa materia non è nella formula del lotto', 'warn', 5000);
      const left = it ? Math.max(0, round(it.grams - done, 2)) : '';
      withdrawDialog(app, lot, { batchId: batch.id, qty: left || '' });
      return true;
    }
    app.navigate(`#/lot/${lot.id}`);
    return false;
  }
  if (p.t === 'PF') {
    let b = findBatch();
    if (!b) { await app.store.sync(); b = findBatch(); }
    if (!b) { toast(`Lotto prodotto ${p.lot} non trovato`, 'error'); return true; }
    app.navigate(`#/batch/${b.id}`);
    return false;
  }
  // codice libero: lotto interno o lotto fornitore
  const found = findByCode(db, p.raw);
  if (found.length === 1) { app.navigate(found[0].type === 'lot' ? `#/lot/${found[0].item.id}` : `#/batch/${found[0].item.id}`); return false; }
  if (found.length > 1) {
    openModal({ title: 'Più risultati', body: String(html`<ul class="timeline">${found.map(f => html`<li><a href="${f.type === 'lot' ? `#/lot/${f.item.id}` : `#/batch/${f.item.id}`}">${f.type === 'lot' ? matName(db, f.item.materialId) : f.item.recipeName} · ${f.item.lotCode}</a></li>`)}</ul>`), actions: [{ label: 'Chiudi' }] });
    return true;
  }
  const go = await formDialog('Codice non riconosciuto', html`<p>Il codice <b class="mono">${p.raw}</b> non corrisponde a nessun lotto.</p><p>Se è il lotto di un fornitore puoi registrare il carico.</p>`, { okLabel: 'Registra carico' });
  if (go) app.navigate(`#/receive?supplierLot=${encodeURIComponent(p.raw)}`);
  return !go;
}
