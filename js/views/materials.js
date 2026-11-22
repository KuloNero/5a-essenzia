import { html, raw, table, field, input, select, $, $$, toast, bindSearch, formDialog, confirmDialog, readForm } from '../ui.js';
import { byId, materialStock, fefoLots, recipeItems } from '../domain.js';
import { ALLERGENS } from '../allergens.js';
import { today, fmtDate, fmtQty, fmtEur, num, sortBy, esc, uid } from '../util.js';
import { pageHead, lotBadge, docsSection, bindDocs } from './common.js';

export function materials(el, { app, query }) {
  const db = app.db;
  const cat = query.get('cat') || '';
  const showArch = query.get('arch') === '1';
  let list = db.materials.filter(m => (showArch || !m.archived) && (!cat || (cat === 'packaging' ? m.category === 'packaging' : m.category !== 'packaging')));
  list = sortBy(list, m => m.name.toLowerCase());
  el.innerHTML = String(html`${pageHead('Materie prime & packaging', `${list.length} articoli`, '<a class="btn" href="#/data?imp=materials">⬆️ Importa</a><a class="btn btn-primary" href="#/material/new">+ Nuova</a>')}
    <div class="toolbar"><input class="search" id="q" placeholder="Cerca nome, INCI, CAS, codice…">
      ${select('cat', [['', 'Tutte le categorie'], ['raw', 'Materie prime'], ['packaging', 'Packaging']], cat, 'id="cat" style="max-width:200px"')}
      <label class="field check"><input type="checkbox" id="arch" ${showArch ? 'checked' : ''}> <span>Mostra archiviati</span></label></div>
    ${table(['Codice', 'Nome commerciale', 'INCI', 'CAS', 'Fornitore', ['Giacenza', 'num'], ['Costo', 'num']], list.map(m => {
      const s = materialStock(db, m.id);
      const low = Number(m.minStock) > 0 && s.usable < Number(m.minStock);
      return html`<tr class="clickable row" data-href="#/material/${m.id}"><td data-l="Codice" class="mono">${m.code}</td>
        <td data-l="Nome"><b>${m.name}</b> ${m.category === 'packaging' ? html`<span class="badge">PK</span>` : ''} ${m.bio ? html`<span class="badge ok">BIO</span>` : ''} ${m.archived ? html`<span class="badge">archiviato</span>` : ''} ${(m.allergens || []).length ? html`<span class="badge warn" title="Contiene allergeni">⚠ ${m.allergens.length}</span>` : ''}</td>
        <td data-l="INCI" class="small">${m.inci || (m.composition || []).map(c => c.inci).join(', ')}</td><td data-l="CAS" class="mono small">${m.cas}</td>
        <td data-l="Fornitore">${byId(db.suppliers, m.supplierId)?.name || ''}</td>
        <td data-l="Giacenza" class="num nowrap">${low ? html`<span class="badge warn">${fmtQty(s.usable, m.unit)}</span>` : fmtQty(s.usable, m.unit)}</td>
        <td data-l="Costo" class="num nowrap">${m.cost !== '' && m.cost !== undefined ? `${fmtEur(m.cost)}${m.unit === 'pz' ? '/pz' : m.unit === 'ml' ? '/L' : '/kg'}` : ''}</td></tr>`;
    }), { cls: 'cards' })}`);
  bindSearch(el, '#q', 'tr.row');
  const nav = () => app.navigate(`#/materials?cat=${$('#cat', el).value}&arch=${$('#arch', el).checked ? 1 : 0}`);
  $('#cat', el).onchange = nav; $('#arch', el).onchange = nav;
}

function pairRows(list, kind) {
  return (list || []).map(x => pairRow(kind, kind === 'allergen' ? x.name : x.inci, x.pct)).join('');
}
function pairRow(kind, name = '', pct = '') {
  return `<div class="item" data-pair="${kind}"><input name="_n" value="${esc(name)}" placeholder="${kind === 'allergen' ? 'Allergene (es. Linalool)' : 'INCI componente'}" ${kind === 'allergen' ? 'list="allergen-list"' : ''}>
    <input name="_p" value="${esc(pct)}" inputmode="decimal" placeholder="%"><span class="muted small grams">% nella materia</span><button type="button" class="icon-btn" data-delpair>✕</button></div>`;
}

export function materialEdit(el, { app, params }) {
  const db = app.db;
  const isNew = params[0] === 'new';
  const m = isNew ? { unit: 'g', category: 'raw', allergens: [], composition: [] } : byId(db.materials, params[0]);
  if (!m) { el.innerHTML = '<div class="empty">Materia non trovata</div>'; return; }
  const stock = !isNew ? materialStock(db, m.id) : null;
  const lots = !isNew ? sortBy(db.lots.filter(l => l.materialId === m.id), l => l.expiry || '9999') : [];
  const usedIn = !isNew ? db.recipes.filter(r => recipeItems(r).some(i => i.materialId === m.id) || (r.packaging || []).some(p => p.materialId === m.id)) : [];
  el.innerHTML = String(html`
    ${pageHead(isNew ? 'Nuova materia prima' : m.name, isNew ? '' : html`${m.code || ''} ${m.inci ? '· ' + m.inci : ''}`,
      isNew ? '' : `<a class="btn" href="#/receive?material=${m.id}">📥 Carico</a>`)}
    <datalist id="allergen-list">${ALLERGENS.map(a => html`<option value="${a.name}">`)}</datalist>
    <form class="card form" id="mf" data-dirty>
      <div class="form-grid">
        ${field('Nome commerciale *', input('name', m.name, 'required'))}
        ${field('Codice interno', input('code', m.code, 'placeholder="es. MP-001"'))}
        ${field('Categoria', select('category', [['raw', 'Materia prima'], ['packaging', 'Packaging (flaconi, pompe, astucci…)']], m.category))}
        ${field('Unità di misura', select('unit', [['g', 'grammi (g)'], ['ml', 'millilitri (ml)'], ['pz', 'pezzi (pz)']], m.unit))}
      </div>
      <div class="form-grid raw-only">
        ${field('Denominazione INCI', input('inci', m.inci, 'placeholder="es. Prunus Amygdalus Dulcis Oil"'), 'Per miscele usa la composizione qui sotto')}
        ${field('N. CAS', input('cas', m.cas))}
        ${field('N. EINECS/CE', input('ec', m.ec))}
        ${field('Funzione', input('function', m.function, 'placeholder="emolliente, conservante…"'))}
      </div>
      <div class="form-grid">
        ${field('Fornitore abituale', select('supplierId', [['', '—'], ...db.suppliers.map(s => [s.id, s.name])], m.supplierId))}
        ${field(raw(`Costo standard (<span id="cu">${m.unit === 'pz' ? '€/pz' : m.unit === 'ml' ? '€/L' : '€/kg'}</span>)`), input('cost', m.cost, 'inputmode="decimal" data-type="number"'))}
        ${field(`Scorta minima (${m.unit})`, input('minStock', m.minStock, 'inputmode="decimal" data-type="number"'))}
        ${field('Max % d\'uso / restrizioni', input('maxUse', m.maxUse, 'placeholder="es. 1% leave-on (IFRA)"'))}
      </div>
      <div class="form-grid">
        <label class="field check"><input type="checkbox" name="bio" ${m.bio ? 'checked' : ''}> <span>Certificata Bio / COSMOS</span></label>
        <label class="field check"><input type="checkbox" name="vegan" ${m.vegan ? 'checked' : ''}> <span>Vegan</span></label>
        <label class="field check"><input type="checkbox" name="archived" ${m.archived ? 'checked' : ''}> <span>Archiviata (non più in uso)</span></label>
      </div>
      <div class="raw-only">
        <h3>Composizione INCI (solo per miscele)</h3>
        <p class="muted small">Es. un estratto glicerico: Glycerin 50%, Aqua 45%, Calendula Officinalis Flower Extract 5%. Se vuoto si usa l'INCI singolo al 100%.</p>
        <div class="items" id="comp">${raw(pairRows(m.composition, 'comp'))}</div>
        <button type="button" class="btn btn-sm" data-addpair="comp">+ Componente</button>
        <h3>Allergeni contenuti</h3>
        <p class="muted small">Percentuale dell'allergene nella materia prima (da IFRA/certificato allergeni del fornitore). Servono per il calcolo delle soglie di etichetta.</p>
        <div class="items" id="allerg">${raw(pairRows(m.allergens, 'allergen'))}</div>
        <button type="button" class="btn btn-sm" data-addpair="allergen">+ Allergene</button>
      </div>
      ${field('Note', `<textarea name="notes">${esc(m.notes || '')}</textarea>`)}
      <div class="toolbar"><button class="btn btn-primary" type="submit">Salva</button>
        ${!isNew ? raw('<button type="button" class="btn btn-danger" id="del">Elimina</button>') : ''}</div>
    </form>
    ${!isNew ? html`
      <div class="card"><h2>Lotti (${lots.length})</h2><p>Utilizzabile: <b>${fmtQty(stock.usable, m.unit)}</b> · Totale: ${fmtQty(stock.qty, m.unit)} · Valore: ${fmtEur(stock.value)}</p>
        ${table(['Lotto', 'Lotto forn.', 'Carico', 'Scadenza', ['Giacenza', 'num'], 'Stato'], lots.map(l => html`<tr class="clickable" data-href="#/lot/${l.id}"><td class="mono" data-l="Lotto">${l.lotCode}</td><td class="mono" data-l="Forn.">${l.supplierLot}</td><td data-l="Carico">${fmtDate(l.receivedAt)}</td><td data-l="Scad.">${fmtDate(l.expiry)}</td><td class="num" data-l="Giac.">${fmtQty(l.qty, l.unit)}</td><td>${lotBadge(l, db)}</td></tr>`), { cls: 'cards' })}
      </div>
      ${usedIn.length ? html`<div class="card"><h2>Usata nelle ricette</h2><div class="pill-list">${usedIn.map(r => html`<a class="badge info" href="#/recipe/${r.id}">${r.name}</a>`)}</div></div>` : ''}
      ${raw(docsSection(app, 'material', m.id, { title: 'Documenti (TDS, SDS, certificazioni)' }))}` : ''}`);
  const form = $('#mf', el);
  const toggleRaw = () => $$('.raw-only', el).forEach(x => { x.hidden = form.category.value === 'packaging'; });
  toggleRaw();
  form.category.onchange = () => { toggleRaw(); if (form.category.value === 'packaging') form.unit.value = 'pz'; form.unit.onchange(); };
  form.unit.onchange = () => { $('#cu', el).textContent = form.unit.value === 'pz' ? '€/pz' : form.unit.value === 'ml' ? '€/L' : '€/kg'; };
  el.addEventListener('click', e => {
    const add = e.target.closest('[data-addpair]');
    if (add) { const box = $(add.dataset.addpair === 'comp' ? '#comp' : '#allerg', el); box.insertAdjacentHTML('beforeend', pairRow(add.dataset.addpair)); box.lastElementChild.querySelector('input').focus(); app.setDirty(); }
    if (e.target.closest('[data-delpair]')) { e.target.closest('.item').remove(); app.setDirty(); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = readForm(form);
    delete d._n; delete d._p;
    const pairs = sel => $$(sel + ' .item', el).map(r => ({ n: $('[name=_n]', r).value.trim(), p: num($('[name=_p]', r).value) })).filter(x => x.n);
    const composition = pairs('#comp').map(x => ({ inci: x.n, pct: x.p }));
    const allergens = pairs('#allerg').map(x => ({ name: x.n, pct: x.p }));
    const cs = composition.reduce((s, c) => s + c.pct, 0);
    if (composition.length && Math.abs(cs - 100) > 0.5 && !confirm(`La composizione somma ${cs}% invece di 100%. Salvare comunque?`)) return;
    if (d.category === 'packaging') { composition.length = 0; allergens.length = 0; }
    const material = { ...m, ...d, composition, allergens, id: m.id || uid() };
    const r = await app.run(() => app.dispatch('material.upsert', { material }), 'Materia salvata');
    if (r) {
      app.setDirty(false);
      if (isNew) app.navigate(`#/material/${material.id}`);
      else app.render();
    }
  });
  $('#del', el)?.addEventListener('click', async () => {
    if (!await confirmDialog(`Eliminare definitivamente "${m.name}"?`, { danger: true, okLabel: 'Elimina' })) return;
    if (await app.run(() => app.dispatch('material.delete', { id: m.id }), 'Eliminata')) { app.setDirty(false); app.navigate('#/materials'); }
  });
  bindDocs(el, app);
}

// ---------------- Fornitori ----------------
export function suppliers(el, { app }) {
  const db = app.db;
  const list = sortBy(db.suppliers, s => s.name.toLowerCase());
  el.innerHTML = String(html`${pageHead('Fornitori', `${list.length} fornitori`, '<a class="btn" href="#/data?imp=suppliers">⬆️ Importa</a><button class="btn btn-primary" id="add">+ Nuovo</button>')}
    <div class="toolbar"><input class="search" id="q" placeholder="Cerca…"></div>
    ${table(['Ragione sociale', 'Referente', 'Email', 'Telefono', ['Materie', 'num'], ''], list.map(s => html`<tr class="row"><td data-l="Nome"><b>${s.name}</b>${s.qualified ? html` <span class="badge ok">qualificato</span>` : ''}</td><td data-l="Referente">${s.contact}</td>
      <td data-l="Email">${s.email ? html`<a href="mailto:${s.email}">${s.email}</a>` : ''}</td><td data-l="Tel.">${s.phone}</td>
      <td data-l="Materie" class="num">${db.materials.filter(m => m.supplierId === s.id).length}</td>
      <td class="row-actions"><button class="btn btn-sm" data-edit="${s.id}">Modifica</button><button class="btn btn-sm" data-del="${s.id}">🗑</button></td></tr>`), { cls: 'cards' })}`);
  bindSearch(el, '#q', 'tr.row');
  const edit = async s => {
    s = s || {};
    const d = await formDialog(s.id ? 'Modifica fornitore' : 'Nuovo fornitore', html`
      ${field('Ragione sociale *', input('name', s.name, 'required'))}
      <div class="form-grid">${field('P.IVA', input('vat', s.vat))}${field('Referente', input('contact', s.contact))}</div>
      <div class="form-grid">${field('Email', input('email', s.email, 'type="email"'))}${field('Telefono', input('phone', s.phone, 'type="tel"'))}</div>
      ${field('Indirizzo', input('address', s.address))}
      <label class="field check"><input type="checkbox" name="qualified" ${s.qualified ? 'checked' : ''}> <span>Fornitore qualificato (GMP)</span></label>
      ${field('Note', input('notes', s.notes))}`, { validate: d => { if (!d.name) throw new Error('Nome obbligatorio'); } });
    if (d) await app.run(() => app.dispatch('supplier.upsert', { supplier: { ...s, ...d } }), 'Fornitore salvato');
  };
  $('#add', el).onclick = () => edit();
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-edit]'); if (b) edit(byId(app.db.suppliers, b.dataset.edit));
    const dl = e.target.closest('[data-del]');
    if (dl && await confirmDialog('Eliminare il fornitore?', { danger: true, okLabel: 'Elimina' })) await app.run(() => app.dispatch('supplier.delete', { id: dl.dataset.del }), 'Eliminato');
  });
}
