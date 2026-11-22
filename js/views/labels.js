import { html, raw, table, select, $, $$, toast, bindSearch, openPdf } from '../ui.js';
import { byId } from '../domain.js';
import { fmtDate, sortBy } from '../util.js';
import { labelsPdf } from '../pdf.js';
import { pageHead, lotLabelItem, batchLabelItem, matName, lotBadge, batchBadge } from './common.js';

export function labels(el, { app, query }) {
  const db = app.db;
  const tab = query.get('tab') || 'mp';
  const s = db.settings;
  let rows;
  if (tab === 'pf') {
    rows = sortBy(db.batches.filter(b => ['completato', 'rilasciato'].includes(b.status)), b => b.producedAt || '', -1).map(b => html`<tr class="row" data-kind="b" data-id="${b.id}">
      <td><input type="checkbox" data-sel></td><td data-l="Prodotto"><b>${b.recipeName}</b></td><td class="mono" data-l="Lotto">${b.lotCode}</td><td data-l="Data">${fmtDate(b.producedAt)}</td><td data-l="Scad.">${fmtDate(b.expiry)}</td><td>${batchBadge(b)}</td>
      <td class="num"><input data-copies type="number" min="1" value="${b.unitsProduced || 1}" style="max-width:90px"></td></tr>`);
  } else {
    rows = sortBy(db.lots.filter(l => Number(l.qty) > 0), l => -new Date(l.receivedAt || 0)).map(l => html`<tr class="row" data-kind="l" data-id="${l.id}">
      <td><input type="checkbox" data-sel></td><td data-l="Materia"><b>${matName(db, l.materialId)}</b></td><td class="mono" data-l="Lotto">${l.lotCode}</td><td data-l="Carico">${fmtDate(l.receivedAt)}</td><td data-l="Scad.">${fmtDate(l.expiry)}</td><td>${lotBadge(l, db)}</td>
      <td class="num"><input data-copies type="number" min="1" value="1" style="max-width:90px"></td></tr>`);
  }
  el.innerHTML = String(html`${pageHead('Etichette QR', 'Stampa in serie su rotolo (una etichetta per pagina) o su fogli A4 adesivi')}
    <div class="tabs"><a href="#/labels" class="${tab === 'mp' ? 'active' : ''}">Materie prime & packaging</a><a href="#/labels?tab=pf" class="${tab === 'pf' ? 'active' : ''}">Prodotti finiti</a></div>
    <div class="toolbar"><input class="search" id="q" placeholder="Cerca…">
      ${raw(select('format', [['small', `Piccola ${s.labelSmall.w}×${s.labelSmall.h} mm`], ['large', `Grande ${s.labelLarge.w}×${s.labelLarge.h} mm`], ['sheet', `A4 ${s.sheet.cols}×${s.sheet.rows}`]], tab === 'pf' ? 'small' : 'large', 'id="fmt" style="max-width:220px"'))}
      <button class="btn btn-primary" id="go">Genera PDF</button></div>
    ${table([raw('<input type="checkbox" id="all">'), 'Articolo', 'Lotto', 'Data', 'Scadenza', 'Stato', ['Copie', 'num']], rows, { cls: 'cards' })}
    <p class="muted small">Dimensioni e griglia dei fogli si configurano in <a href="#/settings">Impostazioni</a>.</p>`);
  bindSearch(el, '#q', 'tr.row');
  $('#all', el).onchange = e => $$('tr.row:not([hidden]) [data-sel]', el).forEach(c => { c.checked = e.target.checked; });
  $('#go', el).onclick = async () => {
    const items = $$('tr.row', el).filter(tr => $('[data-sel]', tr).checked).map(tr => {
      const copies = Number($('[data-copies]', tr).value) || 1;
      return tr.dataset.kind === 'b' ? batchLabelItem(app.db, byId(app.db.batches, tr.dataset.id), copies) : lotLabelItem(app.db, byId(app.db.lots, tr.dataset.id), copies);
    });
    if (!items.length) return toast('Seleziona almeno un lotto', 'warn');
    const n = items.reduce((s2, i) => s2 + i.copies, 0);
    if (n > 3000) return toast('Troppe etichette in un solo PDF (max 3000)', 'error');
    await openPdf(labelsPdf(items, $('#fmt', el).value, app.db.settings), `etichette-${n}.pdf`);
  };
}
