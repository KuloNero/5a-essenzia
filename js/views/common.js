import { html, raw, openModal, formDialog, toast, $, field, input, select, LOT_STATE, BATCH_STATE, badge, openPdf, confirmDialog, pickFile, readFileAs } from '../ui.js';
import { byId, lotState, checkWithdraw, fefoLots } from '../domain.js';
import { fmtDate, fmtQty, today, fmtNum, uid, safeFileName, bytesToB64, fmtDateTime } from '../util.js';
import { lotPayload, batchPayload, qrSvg } from '../qr.js';
import { labelsPdf } from '../pdf.js';

export const matName = (db, id) => byId(db.materials, id)?.name || '—';

export function lotBadge(lot, db) {
  const [l, k] = LOT_STATE[lotState(lot, today(), db.settings.expiryWarningDays)] || ['?', ''];
  return badge(l, k);
}
export function batchBadge(b) {
  const [l, k] = BATCH_STATE[b.status] || [b.status, ''];
  return badge(l, k);
}

export function pageHead(title, sub = '', actions = '') {
  return html`<div class="page-head"><div class="title"><h1>${title}</h1>${sub ? html`<div class="muted">${sub}</div>` : ''}</div><div class="actions">${raw(actions)}</div></div>`;
}

export function activeBatches(db) {
  return db.batches.filter(b => b.status === 'pianificato' || b.status === 'in-lavorazione');
}

// ---------- Prelievo ----------
export function withdrawDialog(app, lot, { batchId = '', qty = '', onDone } = {}) {
  const db = app.db;
  const m = byId(db.materials, lot.materialId) || {};
  const chk = checkWithdraw(db, lot.id, 1e-9, today());
  const blocking = chk.errors.filter(e => !/Quantità/.test(e));
  const fefo = chk.warnings.find(w => w.code === 'fefo');
  if (blocking.length) {
    openModal({
      title: 'Prelievo bloccato',
      body: String(html`<div class="blocked-banner">⛔ ${blocking.join(' — ')}</div>
        <dl class="kv"><dt>Materia</dt><dd>${m.name}</dd><dt>Lotto</dt><dd>${lot.lotCode}</dd><dt>Scadenza</dt><dd>${fmtDate(lot.expiry)}</dd></dl>
        ${fefoAlt(db, lot)}`),
      actions: [{ label: 'Chiudi' }],
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    return;
  }
  const batches = [...db.batches.filter(b => b.status === 'in-lavorazione' || b.status === 'pianificato')];
  const body = html`
    <dl class="kv"><dt>Materia</dt><dd>${m.name}</dd><dt>Lotto</dt><dd>${lot.lotCode}${lot.supplierLot ? ` (forn. ${lot.supplierLot})` : ''}</dd>
    <dt>Giacenza</dt><dd>${fmtQty(lot.qty, lot.unit)}</dd><dt>Scadenza</dt><dd>${fmtDate(lot.expiry) || '—'}</dd></dl>
    ${fefo ? html`<div class="alert warn">⚠️ ${fefo.message}. <a href="#/lot/${fefo.lotId}" data-goto>Usa quel lotto</a> oppure indica il motivo della deroga.</div>` : ''}
    <div class="form" style="margin-top:.75rem">
      ${field(`Quantità prelevata (${lot.unit})`, input('qty', qty, `class="big" inputmode="decimal" data-type="number" required autocomplete="off"`))}
      ${field('Lotto di produzione', select('batchId', [['', '— nessuno (prelievo generico) —'], ...batches.map(b => [b.id, `${b.lotCode} · ${b.recipeName}`])], batchId))}
      ${fefo ? field('Motivo deroga FEFO', input('reason', '', 'required placeholder="es. lotto aperto da terminare"')) : ''}
      ${field('Note', input('note', ''))}
    </div>`;
  const mdl = openModal({
    title: `Prelievo · ${m.name}`, body: String(body),
    actions: [{ label: 'Annulla' }, {
      label: 'Conferma prelievo', primary: true, onClick: async (wrap) => {
        const q = Number(String($('[name=qty]', wrap).value).replace(',', '.'));
        const reason = $('[name=reason]', wrap)?.value.trim();
        if (fefo && !reason) throw new Error('Indicare il motivo della deroga FEFO');
        const r = await app.run(() => app.dispatch('stock.withdraw', {
          lotId: lot.id, qty: q, batchId: $('[name=batchId]', wrap).value || null, note: $('[name=note]', wrap).value.trim(), overrideFefo: !!fefo, reason,
        }), `Prelevati ${fmtQty(q, lot.unit)} da ${lot.lotCode}`);
        if (!r) return false;
        onDone && onDone();
      },
    }],
  });
  mdl.el.addEventListener('click', e => { if (e.target.closest('[data-goto]')) mdl.close(); });
  $('[name=qty]', mdl.el).focus();
}

function fefoAlt(db, lot) {
  const alt = fefoLots(db, lot.materialId, today())[0];
  return alt ? html`<p>Lotto utilizzabile suggerito (FEFO): <a href="#/lot/${alt.id}">${alt.lotCode}</a> — scad. ${fmtDate(alt.expiry) || 'n.d.'}, giacenza ${fmtQty(alt.qty, alt.unit)}</p>` : html`<p class="muted">Nessun altro lotto utilizzabile per questa materia.</p>`;
}

export async function adjustDialog(app, lot) {
  const d = await formDialog(`Rettifica giacenza · ${lot.lotCode}`, html`
    <p class="muted">Giacenza attuale: <b>${fmtQty(lot.qty, lot.unit)}</b>. Inserire la giacenza reale rilevata (inventario, cali, rotture…).</p>
    ${field(`Nuova giacenza (${lot.unit})`, input('newQty', lot.qty, 'class="big" inputmode="decimal" data-type="number"'))}
    ${field('Motivo', select('reasonKind', ['Inventario', 'Calo / evaporazione', 'Rottura / perdita', 'Campionatura', 'Errore di registrazione', 'Altro']))}
    ${field('Dettaglio', input('detail', ''))}`, { okLabel: 'Registra rettifica' });
  if (!d) return;
  await app.run(() => app.dispatch('stock.adjust', { lotId: lot.id, newQty: d.newQty, reason: [d.reasonKind, d.detail].filter(Boolean).join(': ') }), 'Rettifica registrata');
}

export async function lotStatusDialog(app, lot) {
  const d = await formDialog(`Stato lotto · ${lot.lotCode}`, html`
    ${field('Stato', select('status', [['ok', 'Disponibile (rilasciato)'], ['quarantine', 'Quarantena (in attesa QC/CoA)'], ['blocked', 'Bloccato (non conforme)']], lot.status || 'ok'))}
    ${field('Scadenza', input('expiry', lot.expiry, 'type="date"'))}
    ${field('Ubicazione', input('location', lot.location || '', 'placeholder="es. Scaffale B2"'))}
    ${field('Motivo / note', input('reason', ''))}`);
  if (!d) return;
  await app.run(() => app.dispatch('lot.update', { id: lot.id, patch: d }), 'Lotto aggiornato');
}

// ---------- Etichette ----------
export function lotLabelItem(db, lot, copies = 1) {
  const m = byId(db.materials, lot.materialId) || {};
  const sup = byId(db.suppliers, lot.supplierId);
  return {
    payload: lotPayload(lot, m), copies,
    title: m.name || '',
    lines: [
      `Lotto: ${lot.lotCode}`,
      m.inci ? `INCI: ${m.inci}` : (m.code ? `Cod: ${m.code}` : ''),
      `Carico: ${fmtDate(lot.receivedAt)}  Scad: ${fmtDate(lot.expiry) || 'n.d.'}`,
      `Q.tà: ${fmtQty(lot.qtyInitial, lot.unit)}${sup ? '  ' + sup.name : ''}`,
      lot.supplierLot ? `Lotto forn.: ${lot.supplierLot}` : '',
    ].filter(Boolean),
  };
}

export function batchLabelItem(db, b, copies = 1) {
  const r = byId(db.recipes, b.recipeId) || {};
  return {
    payload: batchPayload(b, r), copies,
    title: r.name || b.recipeName,
    lines: [
      `Lotto: ${b.lotCode}`,
      `Prod: ${fmtDate(b.producedAt)}  Scad: ${fmtDate(b.expiry) || 'n.d.'}`,
      `${r.nominalContent || (b.unitSize ? fmtNum(b.unitSize, 0) + ' g' : '')}${b.paoMonths ? `  PAO ${b.paoMonths}M` : ''}`,
      r.code ? `Cod: ${r.code}` : '',
    ].filter(Boolean),
  };
}

export function labelDialog(app, items, { format = 'small', title = 'Stampa etichette' } = {}) {
  const s = app.db.settings;
  const body = html`
    <div class="lot-hero"><div class="qrbox">${raw(qrSvg(items[0].payload, 120))}</div>
      <div><b>${items[0].title}</b>${items[0].lines.map(l => html`<div class="small">${l}</div>`)}
      ${items.length > 1 ? html`<p class="muted small">+ altre ${items.length - 1} etichette</p>` : ''}</div></div>
    <div class="form" style="margin-top:1rem">
      ${field('Formato', select('format', [
        ['small', `Piccola ${s.labelSmall.w}×${s.labelSmall.h} mm (flaconi/vasetti, stampante a rotolo)`],
        ['large', `Grande ${s.labelLarge.w}×${s.labelLarge.h} mm (fusti/scaffali, stampante a rotolo)`],
        ['sheet', `Foglio A4 ${s.sheet.cols}×${s.sheet.rows} (${s.sheet.w}×${s.sheet.h} mm)`],
      ], format))}
      ${items.length === 1 ? field('Numero di copie', input('copies', items[0].copies || 1, 'type="number" min="1" max="2000" inputmode="numeric"')) : ''}
      ${field('Posizioni da saltare (solo foglio A4, etichette già usate)', input('skip', 0, 'type="number" min="0" inputmode="numeric"'))}
      <label class="field check"><input type="checkbox" name="border"> <span>Bordo di taglio (foglio A4)</span></label>
    </div>`;
  openModal({
    title, body: String(body),
    actions: [{ label: 'Chiudi' }, {
      label: 'Genera PDF', primary: true, keepOpen: true, onClick: async (wrap) => {
        const fmt = $('[name=format]', wrap).value;
        const copies = $('[name=copies]', wrap)?.value;
        const list = items.map(it => ({ ...it, copies: copies ? Number(copies) : it.copies }));
        const settings = { ...s, sheet: { ...s.sheet, skip: Number($('[name=skip]', wrap).value || 0), border: $('[name=border]', wrap).checked } };
        const doc = labelsPdf(list, fmt, settings);
        await openPdf(doc, `etichette-${Date.now()}.pdf`);
      },
    }],
  });
}

// ---------- Documenti ----------
export const DOC_TYPES = [['TDS', 'Scheda tecnica (TDS)'], ['MSDS', 'Scheda di sicurezza (SDS/MSDS)'], ['CoA', 'Certificato di analisi (CoA)'], ['BIO', 'Certificazione Bio/Ecocert/COSMOS'], ['IFRA', 'Certificato IFRA / allergeni'], ['PIF', 'Documento PIF'], ['ALTRO', 'Altro']];

export function docsSection(app, ownerType, ownerId, { lotId = null, title = 'Documenti' } = {}) {
  const db = app.db;
  const docs = db.documents.filter(d => d.ownerType === ownerType && d.ownerId === ownerId && (!lotId || d.lotId === lotId));
  return html`<div class="card" data-docs="${ownerType}|${ownerId}|${lotId || ''}">
    <div class="page-head" style="margin:0 0 .5rem"><h2 class="title" style="margin:0">${title}</h2><div class="actions"><button class="btn btn-sm" data-doc-upload>📎 Allega</button></div></div>
    ${docs.length ? html`<ul class="timeline">${docs.map(d => html`<li><span>${badge(d.docType)} <a href="#" data-doc-open="${d.id}">${d.name}</a> ${d.lotId && !lotId ? html`<span class="muted small">lotto ${byId(db.lots, d.lotId)?.lotCode || ''}</span>` : ''}
      ${d.validUntil ? html`<span class="small ${d.validUntil < today() ? 'badge danger' : 'muted'}">valido fino al ${fmtDate(d.validUntil)}</span>` : ''}</span>
      <span class="row-actions"><span class="muted small hide-mobile">${fmtDateTime(d.uploadedAt)}</span><button class="btn btn-sm" data-doc-del="${d.id}" title="Rimuovi">🗑</button></span></li>`)}</ul>`
      : html`<p class="muted small">Nessun documento allegato.</p>`}
  </div>`;
}

export function bindDocs(root, app) {
  root.addEventListener('click', async e => {
    const up = e.target.closest('[data-doc-upload]');
    const op = e.target.closest('[data-doc-open]');
    const del = e.target.closest('[data-doc-del]');
    if (up) {
      const [ownerType, ownerId, lotId] = up.closest('[data-docs]').dataset.docs.split('|');
      const file = await pickFile('.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,.txt');
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) return toast('File troppo grande (max 25 MB)', 'error');
      const d = await formDialog('Allega documento', html`<p><b>${file.name}</b> (${fmtNum(file.size / 1024, 0)} KB)</p>
        ${field('Tipo documento', select('docType', DOC_TYPES, lotId ? 'CoA' : 'TDS'))}
        ${field('Valido fino al (opzionale)', input('validUntil', '', 'type="date"'))}
        ${field('Note', input('note', ''))}`, { okLabel: 'Carica' });
      if (!d) return;
      const id = uid();
      const path = `docs/${ownerType}/${ownerId}/${id}-${safeFileName(file.name)}`;
      const b64 = bytesToB64(new Uint8Array(await readFileAs(file)));
      await app.run(() => app.dispatch('doc.add', { doc: { id, ownerType, ownerId, lotId: lotId || null, docType: d.docType, validUntil: d.validUntil, note: d.note, name: file.name, mime: file.type, size: file.size, path } }, { files: [{ path, base64: b64 }] }), 'Documento caricato');
    } else if (op) {
      e.preventDefault();
      const d = byId(app.db.documents, op.dataset.docOpen);
      try {
        toast('Apertura documento…');
        const blob = await app.store.readFile(d.path);
        const url = URL.createObjectURL(new Blob([blob], { type: d.mime || 'application/octet-stream' }));
        const w = window.open(url, '_blank');
        if (!w) { const a = document.createElement('a'); a.href = url; a.download = d.name; a.click(); }
      } catch (err) { toast(err.message, 'error'); }
    } else if (del) {
      const d = byId(app.db.documents, del.dataset.docDel);
      if (!await confirmDialog(`Rimuovere "${d.name}"? Il file resta nello storico Git.`, { danger: true, okLabel: 'Rimuovi' })) return;
      await app.run(() => app.dispatch('doc.delete', { id: d.id }, { files: [{ path: d.path, delete: true }] }), 'Documento rimosso');
    }
  });
}

export function materialOptions(db, category) {
  return db.materials.filter(m => !m.archived && (!category || (category === 'packaging' ? m.category === 'packaging' : m.category !== 'packaging')))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
    .map(m => [m.id, `${m.name}${m.code ? ` (${m.code})` : ''}`]);
}

