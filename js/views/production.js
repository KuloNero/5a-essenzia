import { html, raw, table, field, input, select, $, $$, toast, bindSearch, confirmDialog, formDialog, openModal, openPdf } from '../ui.js';
import { byId, planBatch, scaleRecipe, batchPickedByMaterial, allocateFefo, traceBatchForward } from '../domain.js';
import { today, fmtDate, fmtQty, fmtNum, fmtDateTime, num, round, uid, sortBy, addMonths } from '../util.js';
import { qrSvg, batchPayload } from '../qr.js';
import { batchRecordPdf, productLabelPdf } from '../pdf.js';
import { pageHead, batchBadge, matName, labelDialog, batchLabelItem } from './common.js';

export function batches(el, { app, query }) {
  const db = app.db;
  const f = query.get('f') || 'open';
  let list = db.batches;
  if (f === 'open') list = list.filter(b => ['pianificato', 'in-lavorazione', 'completato'].includes(b.status));
  else if (f !== 'all') list = list.filter(b => b.status === f);
  list = sortBy(list, b => b.producedAt || '', -1);
  el.innerHTML = String(html`${pageHead('Produzione', 'Lotti di prodotto finito', '<a class="btn btn-primary" href="#/batch-new">+ Nuovo lotto</a>')}
    <div class="toolbar"><input class="search" id="q" placeholder="Cerca lotto o prodotto…">
      ${select('f', [['open', 'Aperti / da rilasciare'], ['pianificato', 'Pianificati'], ['in-lavorazione', 'In lavorazione'], ['completato', 'Da rilasciare'], ['rilasciato', 'Rilasciati'], ['respinto', 'Respinti'], ['annullato', 'Annullati'], ['all', 'Tutti']], f, 'id="flt" style="max-width:220px"')}</div>
    ${table(['Lotto', 'Prodotto', 'Data', 'Scadenza', ['Peso', 'num'], ['Unità', 'num'], 'Stato'], list.map(b => html`<tr class="clickable row" data-href="#/batch/${b.id}">
      <td class="mono" data-l="Lotto"><b>${b.lotCode}</b></td><td data-l="Prodotto">${b.recipeName} <span class="muted small">v${b.recipeVersion}</span></td>
      <td data-l="Data">${fmtDate(b.producedAt)}</td><td data-l="Scad.">${fmtDate(b.expiry)}</td><td class="num" data-l="Peso">${fmtQty(b.targetWeight, 'g')}</td>
      <td class="num" data-l="Unità">${b.unitsProduced ? `${b.unitsAvailable}/${b.unitsProduced}` : (b.unitsPlanned || '')}</td><td>${batchBadge(b)}</td></tr>`), { cls: 'cards' })}`);
  bindSearch(el, '#q', 'tr.row');
  $('#flt', el).onchange = e => app.navigate(`#/batches?f=${e.target.value}`);
}

export function batchNew(el, { app, query }) {
  const db = app.db;
  const recipes = sortBy(db.recipes.filter(r => !r.archived), r => r.name.toLowerCase());
  el.innerHTML = String(html`${pageHead('Nuovo lotto di produzione', 'Calcolo automatico delle pesate e proposta lotti FEFO')}
    ${!recipes.length ? html`<div class="alert warn">Nessuna ricetta. <a href="#/recipe/new">Creane una</a>.</div>` : ''}
    <form class="card form" id="bf">
      <div class="form-grid">
        ${field('Ricetta *', select('recipeId', [['', '— seleziona —'], ...recipes.map(r => [r.id, `${r.name}${r.code ? ` (${r.code})` : ''} · v${r.version || 1}`])], query.get('recipe') || ''))}
        ${field('Peso target (g)', input('targetWeight', query.get('w') || '', 'inputmode="decimal" data-type="number"'))}
        ${field('…oppure n. unità', input('units', '', 'inputmode="numeric"'), 'calcola il peso includendo il calo')}
      </div>
      <div class="form-grid">
        ${field('Data produzione', input('producedAt', today(), 'type="date"'))}
        ${field('Codice lotto', input('lotCode', '', 'placeholder="automatico"'))}
        ${field('Scadenza', input('expiry', '', 'type="date"'), 'automatica da shelf-life')}
        ${field('Operatore', input('operator', app.store.config.user || ''))}
      </div>
      ${field('Note', input('notes', ''))}
      <div id="preview"></div>
      <div class="toolbar"><button class="btn btn-primary btn-lg" type="submit">Crea lotto</button></div>
    </form>`);
  const form = $('#bf', el);
  const upd = (e) => {
    const r = byId(app.db.recipes, form.recipeId.value);
    if (!r) { $('#preview', el).innerHTML = ''; return; }
    if (e?.target === form.units && num(form.units.value) > 0 && r.unitSize) form.targetWeight.value = round(num(form.units.value) * r.unitSize * (1 + (Number(r.lossPct) || 0) / 100), 2);
    if (e?.target === form.recipeId || e?.target === form.producedAt || !form.expiry.value) form.expiry.value = r.shelfLifeMonths ? addMonths(form.producedAt.value, r.shelfLifeMonths) : '';
    const w = num(form.targetWeight.value);
    if (!(w > 0)) { $('#preview', el).innerHTML = '<p class="muted">Indica il peso target o il numero di unità.</p>'; return; }
    const p = planBatch(app.db, r, w, today());
    const short = p.plan.filter(x => x.shortage > 0);
    $('#preview', el).innerHTML = String(html`<h3>Piano pesate · ${p.units} unità da ${r.unitSize} g</h3>
      ${short.length ? html`<div class="alert danger">Giacenza insufficiente per: ${short.map(s => `${matName(app.db, s.materialId)} (mancano ${fmtQty(s.shortage, 'g')})`).join(', ')}</div>` : ''}
      ${table(['Fase', 'Materia', ['%', 'num'], ['g', 'num'], 'Lotti proposti (FEFO)'], p.plan.map(x => html`<tr><td data-l="Fase">${x.phaseName}</td><td data-l="Materia"><b>${matName(app.db, x.materialId)}</b></td><td class="num" data-l="%">${fmtNum(x.pct, 3)}</td><td class="num" data-l="g"><b>${fmtNum(x.qty, 2)}</b></td>
        <td data-l="Lotti" class="small">${x.alloc.map(a => `${a.lotCode} (${fmtNum(a.qty, 2)} g, scad. ${fmtDate(a.expiry) || 'n.d.'})`).join(' + ')}${x.shortage > 0 ? html` <span class="badge danger">mancano ${fmtNum(x.shortage, 2)} g</span>` : ''}</td></tr>`), { cls: 'cards compact' })}
      <p><b>Totale ${fmtNum(p.sumGrams, 2)} g</b> · Σ ${fmtNum(p.totalPct, 3)}%</p>`);
  };
  form.addEventListener('input', upd);
  form.addEventListener('change', upd);
  upd({ target: form.recipeId });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (!d.recipeId) return toast('Seleziona la ricetta', 'error');
    const r = byId(app.db.recipes, d.recipeId);
    const id = uid();
    const w = num(d.targetWeight);
    const res = await app.run(() => app.dispatch('batch.create', { batch: { id, recipeId: d.recipeId, targetWeight: w, producedAt: d.producedAt, lotCode: d.lotCode, expiry: d.expiry, notes: d.notes, operator: d.operator, unitsPlanned: r.unitSize ? Math.floor(w / r.unitSize) : 0 } }), 'Lotto creato');
    if (!res) return;
    app.navigate(`#/batch/${id}`);
  });
}

export function batchView(el, { app, params }) {
  const db = app.db;
  const b = byId(db.batches, params[0]);
  if (!b) { el.innerHTML = '<div class="empty">Lotto non trovato</div>'; return; }
  const r = byId(db.recipes, b.recipeId) || {};
  const snap = b.recipeSnapshot || r;
  const scaled = scaleRecipe(snap, b.targetWeight);
  const picked = batchPickedByMaterial(b);
  const open = ['pianificato', 'in-lavorazione'].includes(b.status);
  const rows = scaled.phases.flatMap(ph => ph.items.map(it => ({ ph, it, done: picked[it.materialId] || 0 })));
  const allDone = rows.every(x => x.done >= x.it.grams - 0.01);
  const fw = traceBatchForward(db, b.id);
  el.innerHTML = String(html`
    ${pageHead(`${b.recipeName} · ${b.lotCode}`, html`Formula v${b.recipeVersion} · ${batchBadge(b)}`, `<a class="btn" href="#/trace?batch=${b.id}">🔗 Tracciabilità</a><button class="btn" id="br">📄 Batch record PDF</button>`)}
    <div class="card lot-hero">
      <div class="qrbox">${raw(qrSvg(batchPayload(b, r), 130))}</div>
      <dl class="kv">
        <dt>Peso target</dt><dd>${fmtQty(b.targetWeight, 'g')}${b.actualWeight ? ` · reale ${fmtQty(b.actualWeight, 'g')}` : ''}</dd>
        <dt>Produzione</dt><dd>${fmtDate(b.producedAt)}${b.operator ? ' · ' + b.operator : ''}</dd>
        <dt>Scadenza</dt><dd>${fmtDate(b.expiry) || '—'}${b.paoMonths ? ` · PAO ${b.paoMonths}M` : ''}</dd>
        <dt>Unità</dt><dd>${b.unitsProduced ? `${b.unitsProduced} prodotte · ${b.unitsAvailable} disponibili` : `${b.unitsPlanned || scaled.units} previste`}</dd>
        ${b.notes ? html`<dt>Note</dt><dd>${b.notes}</dd>` : ''}
      </dl>
    </div>
    <div class="toolbar">
      ${open ? raw(`<a class="btn btn-primary btn-lg" href="#/scan?batch=${b.id}">📷 Pesate con scansione</a><button class="btn btn-lg" id="pickall">⚖️ Registra pesate (FEFO)</button><button class="btn btn-lg" id="complete">✅ Completa produzione</button>`) : ''}
      ${b.status === 'completato' ? raw('<button class="btn btn-lg" id="qcbtn">🧪 Controlli qualità</button><button class="btn btn-primary btn-lg" id="release">✅ Rilascia lotto</button><button class="btn btn-lg btn-danger" id="reject">Respingi</button>') : ''}
      ${['completato', 'rilasciato'].includes(b.status) ? raw('<button class="btn btn-lg" id="labels">🏷️ Etichette QR</button><button class="btn btn-lg" id="plabel">🏷️ Etichetta prodotto</button>') : ''}
      ${b.status === 'rilasciato' ? raw('<button class="btn btn-lg" id="qcbtn">🧪 QC</button><button class="btn btn-lg" id="adjpf">✏️ Rettifica unità</button>') : ''}
      ${b.status === 'pianificato' && !(b.picks || []).length ? raw('<button class="btn btn-lg" id="cancel">Annulla lotto</button>') : ''}
    </div>
    ${open && allDone ? html`<div class="alert ok">Tutte le pesate sono registrate: puoi completare la produzione.</div>` : ''}
    <div class="card"><h2>Pesate</h2>
      ${table(['Fase', 'Materia', ['Teorico', 'num'], ['Prelevato', 'num'], ['Diff.', 'num'], 'Lotti usati'], rows.map(({ ph, it, done }) => {
        const diff = round(done - it.grams, 2);
        const lots = (b.picks || []).filter(p => p.materialId === it.materialId).map(p => byId(db.lots, p.lotId)).filter(Boolean);
        return html`<tr><td data-l="Fase">${ph.name}</td><td data-l="Materia"><b>${matName(db, it.materialId)}</b></td><td class="num" data-l="Teorico">${fmtNum(it.grams, 2)} g</td>
          <td class="num" data-l="Prelevato">${done ? `${fmtNum(done, 2)} g` : ''}</td>
          <td class="num" data-l="Diff.">${done ? html`<span class="${Math.abs(diff) > Math.max(0.05, it.grams * 0.02) ? 'badge warn' : ''}">${diff > 0 ? '+' : ''}${fmtNum(diff, 2)}</span>` : ''}</td>
          <td data-l="Lotti" class="mono small">${lots.map((l, i) => html`${i ? ', ' : ''}<a href="#/lot/${l.id}">${l.lotCode}</a>`)}</td></tr>`;
      }), { cls: 'cards compact' })}
    </div>
    ${(b.packagingUsed || []).length ? html`<div class="card"><h2>Packaging utilizzato</h2><ul class="timeline">${b.packagingUsed.map(p => html`<li><span>${matName(db, p.materialId)} · <a class="mono" href="#/lot/${p.lotId}">${byId(db.lots, p.lotId)?.lotCode}</a></span><b>${fmtNum(p.qty, 0)} pz</b></li>`)}</ul></div>` : ''}
    ${Object.keys(b.qc || {}).length ? html`<div class="card"><h2>Controllo qualità</h2><dl class="kv">
      ${['ph', 'viscosity', 'aspect', 'color', 'odor', 'micro', 'notes', 'operator'].filter(k => b.qc[k]).map(k => html`<dt>${{ ph: 'pH', viscosity: 'Viscosità', aspect: 'Aspetto', color: 'Colore', odor: 'Odore', micro: 'Microbiologia', notes: 'Note', operator: 'Operatore QC' }[k]}</dt><dd>${b.qc[k]}</dd>`)}
      ${b.qc.outcome ? html`<dt>Esito</dt><dd>${b.qc.outcome} · ${b.qc.releasedBy} ${fmtDateTime(b.qc.releasedAt)}</dd>` : ''}</dl></div>` : ''}
    ${fw.orders.length ? html`<div class="card"><h2>Venduto a</h2><ul class="timeline">${fw.orders.map(o => html`<li><a href="#/order/${o.order.id}">${o.order.number} · ${o.customer?.name}</a><b>${o.units} pz</b></li>`)}</ul></div>` : ''}`);

  $('#br', el).onclick = () => openPdf(batchRecordPdf(app.db, byId(app.db.batches, b.id)), `batch-record-${b.lotCode}.pdf`);
  $('#pickall', el)?.addEventListener('click', () => pickAllDialog(app, b));
  $('#complete', el)?.addEventListener('click', async () => {
    if (!allDone && !await confirmDialog('Non tutte le pesate risultano registrate. Completare comunque?')) return;
    const d = await formDialog('Completa produzione', html`
      ${field('Unità confezionate *', input('unitsProduced', b.unitsPlanned || scaled.units, 'type="number" min="0" inputmode="numeric" class="big"'))}
      ${field('Peso finale ottenuto (g)', input('actualWeight', '', 'inputmode="decimal" data-type="number"'))}
      <label class="field check"><input type="checkbox" name="consumePackaging" checked> <span>Scarica automaticamente il packaging (FEFO)</span></label>
      ${(snap.packaging || []).length ? html`<p class="muted small">Packaging per unità: ${snap.packaging.map(p => `${matName(app.db, p.materialId)} × ${p.qty}`).join(', ')}</p>` : ''}`, { okLabel: 'Completa' });
    if (d) await app.run(() => app.dispatch('batch.complete', { id: b.id, unitsProduced: Number(d.unitsProduced), actualWeight: d.actualWeight, consumePackaging: d.consumePackaging }), 'Produzione completata: eseguire i controlli qualità');
  });
  const qcDialog = async () => {
    const qc = b.qc || {}; const spec = r.qcSpec || {};
    const d = await formDialog('Controlli qualità', html`<div class="form-grid">
      ${field(`pH ${spec.ph ? '(atteso ' + spec.ph + ')' : ''}`, input('ph', qc.ph, 'inputmode="decimal"'))}
      ${field(`Viscosità ${spec.viscosity ? '(' + spec.viscosity + ')' : ''}`, input('viscosity', qc.viscosity))}
      ${field(`Aspetto ${spec.aspect ? '(' + spec.aspect + ')' : ''}`, input('aspect', qc.aspect))}
      ${field(`Colore ${spec.color ? '(' + spec.color + ')' : ''}`, input('color', qc.color))}
      ${field(`Odore ${spec.odor ? '(' + spec.odor + ')' : ''}`, input('odor', qc.odor))}
      ${field('Microbiologia', input('micro', qc.micro, 'placeholder="se eseguita"'))}</div>
      ${field('Note', input('notes', qc.notes))}${field('Operatore QC', input('operator', qc.operator || app.store.config.user || ''))}`);
    if (d) await app.run(() => app.dispatch('batch.update', { id: b.id, patch: { qc: { ...qc, ...d, date: today() } } }), 'Controlli registrati');
  };
  $('#qcbtn', el)?.addEventListener('click', qcDialog);
  $('#release', el)?.addEventListener('click', async () => {
    if (!b.qc?.ph && !b.qc?.aspect && !await confirmDialog('Nessun controllo qualità registrato. Rilasciare comunque il lotto?')) return;
    await app.run(() => app.dispatch('batch.release', { id: b.id, outcome: 'rilasciato' }), 'Lotto rilasciato: disponibile per la vendita');
  });
  $('#reject', el)?.addEventListener('click', async () => {
    const d = await formDialog('Respingi lotto', field('Motivo', input('note', '', 'required')), { okLabel: 'Respingi' });
    if (d) await app.run(() => app.dispatch('batch.release', { id: b.id, outcome: 'respinto', note: d.note }), 'Lotto respinto');
  });
  $('#labels', el)?.addEventListener('click', () => labelDialog(app, [batchLabelItem(app.db, b, b.unitsProduced || 1)], { format: 'small' }));
  $('#plabel', el)?.addEventListener('click', () => openPdf(productLabelPdf(app.db, r, b, app.db.settings.labelLarge), `etichetta-${b.lotCode}.pdf`));
  $('#cancel', el)?.addEventListener('click', async () => {
    const d = await formDialog('Annulla lotto', field('Motivo', input('reason', '')), { okLabel: 'Annulla lotto' });
    if (d) await app.run(() => app.dispatch('batch.cancel', { id: b.id, reason: d.reason }), 'Lotto annullato');
  });
  $('#adjpf', el)?.addEventListener('click', async () => {
    const d = await formDialog('Rettifica unità disponibili', html`${field('Unità disponibili', input('n', b.unitsAvailable, 'type="number" min="0"'))}${field('Motivo', input('reason', '', 'placeholder="campionatura, omaggi, rotture…"'))}`);
    if (d) await app.run(() => app.dispatch('batch.adjustUnits', { id: b.id, newAvailable: d.n, reason: d.reason }), 'Rettifica registrata');
  });
}

function pickAllDialog(app, b) {
  const db = app.db;
  const snap = b.recipeSnapshot;
  const scaled = scaleRecipe(snap, b.targetWeight);
  const picked = batchPickedByMaterial(b);
  const lines = [];
  for (const ph of scaled.phases) for (const it of ph.items) {
    const left = round(it.grams - (picked[it.materialId] || 0), 2);
    if (left <= 0.005) continue;
    const { alloc, shortage } = allocateFefo(db, it.materialId, left, today());
    alloc.forEach(a => lines.push({ ph: ph.name, materialId: it.materialId, ...a }));
    if (shortage > 0) lines.push({ ph: ph.name, materialId: it.materialId, lotId: '', qty: shortage, shortage: true });
  }
  if (!lines.length) return toast('Tutte le pesate sono già registrate', 'ok');
  const body = html`<p class="muted small">Lotti proposti in ordine FEFO. Correggi i grammi con le pesate reali; azzera una riga per escluderla.</p>
    ${table(['Fase', 'Materia', 'Lotto', ['g reali', 'num']], lines.map((l, i) => html`<tr><td data-l="Fase">${l.ph}</td><td data-l="Materia">${matName(db, l.materialId)}</td>
      <td data-l="Lotto" class="mono">${l.shortage ? html`<span class="badge danger">giacenza insufficiente</span>` : html`${l.lotCode} <span class="muted small">${fmtDate(l.expiry)}</span>`}</td>
      <td class="num">${l.shortage ? fmtNum(l.qty, 2) : raw(`<input data-line="${i}" value="${l.qty}" inputmode="decimal" style="max-width:110px">`)}</td></tr>`), { cls: 'cards compact' })}`;
  openModal({
    title: `Registra pesate · ${b.lotCode}`, wide: true, body: String(body),
    actions: [{ label: 'Annulla' }, {
      label: 'Registra scarichi', primary: true, onClick: async (wrap) => {
        const items = $$('[data-line]', wrap).map(inp => ({ lotId: lines[inp.dataset.line].lotId, qty: num(inp.value), fefoPlanned: true })).filter(x => x.qty > 0);
        if (!items.length) throw new Error('Nessuna quantità da registrare');
        const r = await app.run(() => app.dispatch('stock.withdrawMany', { batchId: b.id, items }), `${items.length} scarichi registrati`);
        if (!r) return false;
      },
    }],
  });
}
