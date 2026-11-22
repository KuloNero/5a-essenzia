import { html, raw, table, field, input, select, $, toast, confirmDialog, downloadBlob, pickFile, openModal } from '../ui.js';
import { IMPORT_SCHEMAS, validateImport, readTable, templateRows, writeXLSX, toCSV, inventoryRows, stockSummaryRows, movementRows, consumptionRows, makeBackup, readBackup } from '../io.js';
import { COLLECTIONS } from '../domain.js';
import { uid, today, addDays, fmtDateTime } from '../util.js';
import { pageHead } from './common.js';

export function dataView(el, { app, query }) {
  const db = app.db;
  const imp = query.get('imp') || 'materials';
  el.innerHTML = String(html`${pageHead('Import / Export / Backup')}
    <div class="grid-2">
      <div class="card"><h2>📥 Import massivo (CSV / XLSX)</h2>
        <p class="muted small">Prima del salvataggio viene mostrata un'anteprima con errori e duplicati. Le righe esistenti (stesso codice o nome) vengono aggiornate.</p>
        <div class="form">
          ${field('Cosa importare', select('kind', Object.entries(IMPORT_SCHEMAS).map(([k, v]) => [k, v.label]), imp, 'id="kind"'))}
          <div class="toolbar"><button class="btn btn-primary" id="imp">Scegli file…</button><button class="btn" id="tplx">Modello XLSX</button><button class="btn" id="tplc">Modello CSV</button></div>
          <p class="muted small" id="cols"></p>
        </div>
      </div>
      <div class="card"><h2>📊 Report</h2>
        <div class="form-grid">${field('Dal', input('from', addDays(today(), -30), 'type="date" id="from"'))}${field('Al', input('to', today(), 'type="date" id="to"'))}</div>
        <div class="toolbar">
          <button class="btn" data-rep="inventory">Inventario lotti</button>
          <button class="btn" data-rep="stock">Giacenze per articolo</button>
          <button class="btn" data-rep="moves">Movimenti</button>
          <button class="btn" data-rep="consumption">Consumi</button>
          <button class="btn" data-rep="all">Tutto (XLSX multi-foglio)</button>
        </div>
        <label class="field check"><input type="checkbox" id="csv"> <span>Formato CSV invece di XLSX</span></label>
      </div>
    </div>
    <div class="card"><h2>💾 Backup e ripristino</h2>
      <p>Ogni operazione è già un commit nel repository GitHub (storico completo e ripristinabile). Il backup scarica uno <b>snapshot compresso (.zip)</b> da conservare su server locale o cloud.</p>
      <div class="toolbar">
        <button class="btn btn-primary" id="bk">Scarica backup (solo dati)</button>
        <button class="btn" id="bkd">Backup completo con documenti</button>
        <button class="btn btn-danger" id="rs">Ripristina da backup…</button>
      </div>
      <p class="muted small">Archivio: ${app.store.backend.kind === 'github' ? `${app.store.config.owner}/${app.store.config.repo} · branch ${app.store.config.branch} · cartella ${app.store.config.dir}/` : 'locale (solo questo browser): esegui backup frequenti!'}</p>
      <table class="tbl compact" style="max-width:420px">${COLLECTIONS.filter(c => c !== 'settings').map(c => html`<tr><td>${c}</td><td class="num">${db[c].length}</td></tr>`)}</table>
    </div>`);

  const kindSel = $('#kind', el);
  const showCols = () => { $('#cols', el).textContent = 'Colonne: ' + IMPORT_SCHEMAS[kindSel.value].columns.map(c => c[1] + (c[3] ? ' *' : '')).join(' · '); };
  kindSel.onchange = showCols; showCols();
  $('#tplx', el).onclick = async () => { const t = templateRows(kindSel.value); downloadBlob(await writeXLSX([{ name: 'Import', rows: t.rows, headers: t.headers }]), `modello-${kindSel.value}.xlsx`); };
  $('#tplc', el).onclick = () => { const t = templateRows(kindSel.value); downloadBlob(new Blob([toCSV(t.rows, t.headers)], { type: 'text/csv' }), `modello-${kindSel.value}.csv`); };
  $('#imp', el).onclick = async () => {
    const file = await pickFile('.csv,.xlsx,.txt');
    if (!file) return;
    let rows;
    try { rows = await readTable(file); } catch (e) { return toast('Lettura file non riuscita: ' + e.message, 'error'); }
    if (!rows.length) return toast('Il file non contiene righe', 'warn');
    const kind = kindSel.value;
    const res = validateImport(kind, rows, app.db);
    const schema = IMPORT_SCHEMAS[kind];
    const preview = res.valid.slice(0, 50);
    const shownCols = schema.columns.filter(c => res.map[c[0]]).slice(0, 6);
    openModal({
      title: `Anteprima import · ${file.name}`, wide: true,
      body: String(html`
        <p><b>${rows.length}</b> righe lette · <span class="badge ok">${res.stats.created || 0} nuove</span> <span class="badge info">${res.stats.updated || 0} aggiornate</span> ${res.errors.length ? html`<span class="badge danger">${res.errors.length} errori</span>` : ''} ${res.warnings.length ? html`<span class="badge warn">${res.warnings.length} avvisi</span>` : ''}</p>
        ${res.errors.length ? html`<div class="alert danger"><b>Righe scartate:</b><ul>${res.errors.slice(0, 30).map(e => html`<li>${e.row ? `Riga ${e.row}: ` : ''}${e.msg}</li>`)}</ul></div>` : ''}
        ${res.warnings.length ? html`<div class="alert warn"><ul>${res.warnings.slice(0, 30).map(e => html`<li>Riga ${e.row}: ${e.msg}</li>`)}</ul></div>` : ''}
        ${preview.length ? table(shownCols.map(c => c[1]), preview.map(r => html`<tr>${shownCols.map(c => html`<td>${Array.isArray(r[c[0]]) ? r[c[0]].map(x => `${x.name || x.inci}:${x.pct}`).join('; ') : r[c[0]]}</td>`)}</tr>`), { cls: 'compact' }) : ''}
        ${res.valid.length > 50 ? html`<p class="muted small">…e altre ${res.valid.length - 50}</p>` : ''}`),
      actions: [{ label: 'Annulla' }, ...(res.valid.length ? [{
        label: `Importa ${res.valid.length} righe`, primary: true, onClick: async () => {
          const suppliers = [];
          let rowsOut = res.valid;
          if (kind === 'materials') {
            const byName = {};
            rowsOut = res.valid.map(r => {
              const o = { ...r };
              if (o._supplierName) {
                const k = o._supplierName.toLowerCase();
                if (!byName[k]) { byName[k] = { id: uid(), name: o._supplierName }; suppliers.push(byName[k]); }
                o.supplierId = byName[k].id;
              }
              delete o._supplierName;
              return o;
            });
          }
          const target = schema.target || kind;
          const r = await app.run(() => app.dispatch('import.bulk', { collection: target, rows: rowsOut, suppliers }), `Import completato: ${rowsOut.length} righe`);
          if (!r) return false;
        },
      }] : [])],
    });
  };

  const reportSheets = kind => {
    const from = $('#from', el).value, to = $('#to', el).value;
    const d = app.db;
    const all = {
      inventory: { name: 'Inventario lotti', rows: inventoryRows(d) },
      stock: { name: 'Giacenze', rows: stockSummaryRows(d) },
      moves: { name: 'Movimenti', rows: movementRows(d, from, to) },
      consumption: { name: 'Consumi', rows: consumptionRows(d, from, to) },
    };
    return kind === 'all' ? Object.values(all) : [all[kind]];
  };
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-rep]');
    if (!b) return;
    const sheets = reportSheets(b.dataset.rep);
    if (!sheets.some(s => s.rows.length)) return toast('Nessun dato nel periodo', 'warn');
    const stamp = today();
    if ($('#csv', el).checked) for (const s of sheets) downloadBlob(new Blob([toCSV(s.rows)], { type: 'text/csv' }), `${s.name.replace(/\s+/g, '-').toLowerCase()}-${stamp}.csv`);
    else downloadBlob(await writeXLSX(sheets), `report-${b.dataset.rep}-${stamp}.xlsx`);
  });

  const backup = async includeDocs => {
    toast('Preparazione backup…');
    const { blob, missing } = await makeBackup(app.db, { includeDocs, readFile: async p => new Uint8Array(await (await app.store.readFile(p)).arrayBuffer()) });
    downloadBlob(blob, `backup-5a-essenzia-${today()}.zip`);
    if (missing.length) toast(`${missing.length} documenti non scaricati`, 'warn');
  };
  $('#bk', el).onclick = () => app.run(() => backup(false));
  $('#bkd', el).onclick = () => app.run(() => backup(true));
  $('#rs', el).onclick = async () => {
    const file = await pickFile('.zip,.json');
    if (!file) return;
    let bk;
    try { bk = await readBackup(file); } catch (e) { return toast('Backup non valido: ' + e.message, 'error'); }
    const counts = COLLECTIONS.filter(c => c !== 'settings').map(c => `${c}: ${bk.data[c].length}`).join(', ');
    if (!await confirmDialog(`Il ripristino SOSTITUISCE tutti i dati attuali con quelli del backup${bk.meta ? ` del ${fmtDateTime(bk.meta.createdAt)}` : ''} (${counts}). Lo stato attuale resta recuperabile dallo storico Git. Procedere?`, { danger: true, okLabel: 'Ripristina' })) return;
    await app.run(() => app.dispatch('db.restore', { data: bk.data }, { files: bk.docs }), 'Backup ripristinato');
  };
}
