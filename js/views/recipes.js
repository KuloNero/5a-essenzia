import { html, raw, table, field, input, select, $, $$, toast, bindSearch, confirmDialog, readForm } from '../ui.js';
import { byId, recipeTotalPct, inciList, recipeCost, priceAnalysis, scaleRecipe, recipeItems, materialStock } from '../domain.js';
import { fmtQty, fmtEur, fmtNum, num, round, uid, clone, sortBy, esc, fmtDate } from '../util.js';
import { pageHead, materialOptions, docsSection, bindDocs } from './common.js';
import { productLabelPdf } from '../pdf.js';
import { openPdf } from '../ui.js';

export function recipes(el, { app }) {
  const db = app.db;
  const list = sortBy(db.recipes.filter(r => !r.archived), r => r.name.toLowerCase());
  el.innerHTML = String(html`${pageHead('Ricette & formule', `${list.length} prodotti`, '<a class="btn btn-primary" href="#/recipe/new">+ Nuova ricetta</a>')}
    <div class="toolbar"><input class="search" id="q" placeholder="Cerca…"></div>
    ${table(['Codice', 'Prodotto', 'Tipo', 'Formato', ['Σ %', 'num'], ['Costo/unità', 'num'], ['B2C', 'num'], 'Versione', ''], list.map(r => {
      const tot = recipeTotalPct(r);
      const c = recipeCost(r, db);
      return html`<tr class="clickable row" data-href="#/recipe/${r.id}"><td class="mono" data-l="Codice">${r.code}</td><td data-l="Prodotto"><b>${r.name}</b> <span class="muted small">${r.category || ''}</span></td>
        <td data-l="Tipo">${r.productType === 'rinse-off' ? 'Rinse-off' : 'Leave-on'}</td><td data-l="Formato">${r.nominalContent || (r.unitSize ? r.unitSize + ' g' : '')}</td>
        <td data-l="Σ %" class="num">${Math.abs(tot - 100) > 0.001 ? html`<span class="badge danger">${fmtNum(tot, 3)}</span>` : '100'}</td>
        <td data-l="Costo" class="num">${fmtEur(c.total)}</td><td data-l="B2C" class="num">${r.priceB2C ? fmtEur(r.priceB2C) : ''}</td><td data-l="Vers.">v${r.version || 1}</td>
        <td class="row-actions"><a class="btn btn-sm" href="#/batch-new?recipe=${r.id}">🏭 Produci</a></td></tr>`;
    }), { cls: 'cards' })}`);
  bindSearch(el, '#q', 'tr.row');
}

const newPhase = (name) => ({ id: uid(6), name, temp: '', notes: '', items: [] });

export function recipeEdit(el, { app, params, query }) {
  const db = app.db;
  const isNew = params[0] === 'new';
  const src = isNew ? null : byId(db.recipes, params[0]);
  if (!isNew && !src) { el.innerHTML = '<div class="empty">Ricetta non trovata</div>'; return; }
  const r = src ? clone(src) : {
    id: uid(), name: '', code: '', productType: 'leave-on', unitSize: 50, shelfLifeMonths: 24, paoMonths: 6, lossPct: 3, laborCost: 0, extraCost: 0, packaging: [], qcSpec: {},
    phases: [newPhase('Fase A – acquosa'), newPhase('Fase B – oleosa'), newPhase('Fase C – attivi a freddo')],
  };
  const hasBatches = !isNew && db.batches.some(b => b.recipeId === r.id);
  const rawOpts = materialOptions(db, 'raw');
  const pkOpts = materialOptions(db, 'packaging');
  const optHtml = (opts, v) => `<option value="">— materia —</option>` + opts.map(([id, l]) => `<option value="${esc(id)}" ${id === v ? 'selected' : ''}>${esc(l)}</option>`).join('');

  el.innerHTML = String(html`
    ${pageHead(isNew ? 'Nuova ricetta' : r.name, isNew ? 'Formula, INCI, costi' : `v${r.version || 1}${r.updatedAt ? ' · aggiornata ' + fmtDate(new Date(r.updatedAt).toISOString()) : ''}`,
      isNew ? '' : `<a class="btn" href="#/batch-new?recipe=${r.id}">🏭 Produci lotto</a>`)}
    <form id="rf" data-dirty>
      <div class="card form">
        <div class="form-grid">
          ${field('Nome prodotto *', input('name', r.name, 'required'))}
          ${field('Codice', input('code', r.code, 'placeholder="es. PF-001"'))}
          ${field('Categoria', input('category', r.category, 'placeholder="crema viso, shampoo…"'))}
          ${field('Tipo (per soglie allergeni)', select('productType', [['leave-on', 'Leave-on (non risciacquo) · 0,001%'], ['rinse-off', 'Rinse-off (risciacquo) · 0,01%']], r.productType))}
        </div>
        <div class="form-grid">
          ${field('Peso per unità (g)', input('unitSize', r.unitSize, 'inputmode="decimal" data-type="number"'))}
          ${field('Contenuto nominale in etichetta', input('nominalContent', r.nominalContent, 'placeholder="50 ml"'))}
          ${field('Shelf-life (mesi)', input('shelfLifeMonths', r.shelfLifeMonths, 'type="number" min="0"'))}
          ${field('PAO (mesi)', input('paoMonths', r.paoMonths, 'type="number" min="0"'))}
        </div>
      </div>
      <h2>Formula</h2>
      <div id="phases"></div>
      <button type="button" class="btn" id="addPhase">+ Aggiungi fase</button>
      <div class="total-bar" id="totals"></div>

      <div class="grid-2" style="margin-top:1rem">
        <div class="card"><h2>Etichetta INCI</h2><div id="inci"></div></div>
        <div class="card"><h2>Allergeni</h2><div id="allergens"></div></div>
      </div>

      <div class="card form"><h2>Packaging per unità</h2>
        <div id="pack" class="items"></div>
        <button type="button" class="btn btn-sm" id="addPack">+ Packaging</button>
      </div>

      <div class="grid-2">
        <div class="card form"><h2>Costi e prezzi</h2>
          <div class="form-grid">
            ${field('Calo di lavorazione (%)', input('lossPct', r.lossPct, 'inputmode="decimal" data-type="number"'))}
            ${field('Manodopera / unità (€)', input('laborCost', r.laborCost, 'inputmode="decimal" data-type="number"'))}
            ${field('Altri costi / unità (€)', input('extraCost', r.extraCost, 'inputmode="decimal" data-type="number"'), 'energia, etichette, quota PIF…')}
          </div>
          <div class="form-grid">
            ${field('Prezzo B2C (IVA incl.)', input('priceB2C', r.priceB2C, 'inputmode="decimal" data-type="number"'))}
            ${field('Prezzo B2B (IVA escl.)', input('priceB2B', r.priceB2B, 'inputmode="decimal" data-type="number"'))}
          </div>
          <div id="cost"></div>
        </div>
        <div class="card"><h2>Calcolo lotto</h2>
          <div class="toolbar"><label class="field" style="flex:1"><span>Peso target (g)</span><input id="target" inputmode="decimal" value="${query.get('w') || 1000}"></label>
          <label class="field" style="flex:1"><span>…oppure n. unità</span><input id="targetUnits" inputmode="numeric" placeholder="es. 40"></label></div>
          <div id="scale"></div>
        </div>
      </div>

      <div class="card form"><h2>Processo e controllo qualità</h2>
        ${field('Istruzioni operative', `<textarea name="processNotes" rows="4">${esc(r.processNotes || '')}</textarea>`)}
        <div class="form-grid">
          ${field('pH atteso', input('qc_ph', r.qcSpec?.ph, 'placeholder="5,0 – 5,5"'))}
          ${field('Viscosità', input('qc_viscosity', r.qcSpec?.viscosity, 'placeholder="es. 8.000–12.000 cP"'))}
          ${field('Aspetto', input('qc_aspect', r.qcSpec?.aspect, 'placeholder="emulsione omogenea"'))}
          ${field('Colore', input('qc_color', r.qcSpec?.color))}
          ${field('Odore', input('qc_odor', r.qcSpec?.odor))}
        </div>
        ${field('Descrizione/claim in etichetta', input('labelDescription', r.labelDescription))}
        ${field('Avvertenze in etichetta', input('labelWarnings', r.labelWarnings, 'placeholder="Evitare il contatto con gli occhi…"'))}
        <div class="form-grid">
          ${field('Valutatore sicurezza (PIF)', input('safetyAssessor', r.safetyAssessor))}
          ${field('Notifica CPNP n.', input('cpnp', r.cpnp))}
        </div>
        <label class="field check"><input type="checkbox" name="archived" ${r.archived ? 'checked' : ''}> <span>Archiviata</span></label>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary btn-lg" type="submit">Salva</button>
        ${hasBatches ? raw('<label class="field check"><input type="checkbox" name="bumpVersion" checked> <span>Salva come nuova versione (i lotti già prodotti mantengono la loro formula)</span></label>') : ''}
        ${!isNew ? raw('<button class="btn" type="button" id="dup">Duplica</button><button class="btn" type="button" id="lblpdf">Etichetta prodotto PDF</button><button class="btn btn-danger" type="button" id="del">Elimina</button>') : ''}
      </div>
    </form>
    ${!isNew ? docsSection(app, 'recipe', r.id, { title: 'Documenti PIF (relazione sicurezza, stabilità, challenge test…)' }) : ''}`);

  const form = $('#rf', el);

  function sync() {
    const d = readForm(form);
    for (const k of ['name', 'code', 'category', 'productType', 'nominalContent', 'processNotes', 'labelDescription', 'labelWarnings', 'safetyAssessor', 'cpnp']) r[k] = d[k];
    for (const k of ['unitSize', 'shelfLifeMonths', 'paoMonths', 'lossPct', 'laborCost', 'extraCost', 'priceB2C', 'priceB2B']) r[k] = d[k] === '' ? '' : num(d[k]);
    r.archived = !!d.archived;
    r.qcSpec = { ph: d.qc_ph, viscosity: d.qc_viscosity, aspect: d.qc_aspect, color: d.qc_color, odor: d.qc_odor };
    // fasi
    $$('.phase', el).forEach((pe, pi) => {
      const ph = r.phases[pi];
      ph.name = $('[data-f=phname]', pe).value;
      ph.temp = $('[data-f=phtemp]', pe).value;
      ph.notes = $('[data-f=phnotes]', pe).value;
      $$('.item', pe).forEach((ie, ii) => {
        const it = ph.items[ii];
        it.materialId = $('[data-f=mat]', ie).value;
        it.qs = $('[data-f=qs]', ie).checked;
        if (!it.qs) it.pct = num($('[data-f=pct]', ie).value);
      });
    });
    // q.b. a 100
    const qs = recipeItems(r).filter(i => i.qs);
    if (qs.length) {
      const others = recipeItems(r).filter(i => !i.qs).reduce((s, i) => s + Number(i.pct || 0), 0);
      const val = round((100 - others) / qs.length, 4);
      for (const ph of r.phases) for (const it of ph.items) if (it.qs) it.pct = val;
      $$('[data-f=qs]:checked', el).forEach(cb => { cb.closest('.item').querySelector('[data-f=pct]').value = val; });
    }
    r.packaging = $$('#pack .item', el).map(ie => ({ materialId: $('[data-f=pkmat]', ie).value, qty: num($('[data-f=pkqty]', ie).value) })).filter(p => p.materialId);
  }

  function renderPhases() {
    $('#phases', el).innerHTML = r.phases.map((ph, pi) => `<div class="phase" data-pi="${pi}">
      <div class="phase-head"><input data-f="phname" value="${esc(ph.name)}" placeholder="Nome fase">
        <input data-f="phtemp" value="${esc(ph.temp || '')}" placeholder="Temperatura / condizioni (es. 75 °C)" style="flex:1 1 200px">
        <button type="button" class="btn btn-sm" data-up="${pi}" title="Sposta su">↑</button>
        <button type="button" class="icon-btn" data-delphase="${pi}" title="Elimina fase">🗑</button></div>
      <div class="phase-body"><div class="items">${ph.items.map((it, ii) => `<div class="item">
        <select data-f="mat">${optHtml(rawOpts, it.materialId)}</select>
        <input data-f="pct" value="${esc(it.pct ?? '')}" inputmode="decimal" placeholder="%" ${it.qs ? 'readonly' : ''}>
        <label class="grams small" title="Quanto basta a 100%"><input type="checkbox" data-f="qs" ${it.qs ? 'checked' : ''}> q.b. a 100</label>
        <button type="button" class="icon-btn" data-delitem="${pi}.${ii}">✕</button></div>`).join('')}</div>
        <button type="button" class="btn btn-sm" data-additem="${pi}">+ Ingrediente</button>
        <input data-f="phnotes" value="${esc(ph.notes || '')}" placeholder="Note operative di fase (miscelazione, tempi…)" style="margin-top:.5rem"></div></div>`).join('');
  }
  function renderPack() {
    $('#pack', el).innerHTML = (r.packaging || []).map((p, i) => `<div class="item"><select data-f="pkmat">${optHtml(pkOpts, p.materialId)}</select>
      <input data-f="pkqty" value="${esc(p.qty ?? 1)}" inputmode="decimal" placeholder="q.tà"><span class="muted small grams">per unità</span><button type="button" class="icon-btn" data-delpack="${i}">✕</button></div>`).join('')
      || '<p class="muted small">Nessun packaging. Aggiungi flacone, tappo, pompa, astuccio, etichetta… (categoria Packaging)</p>';
  }
  function renderCalc() {
    const db2 = app.db;
    const tot = recipeTotalPct(r);
    const ok = Math.abs(tot - 100) <= 0.001;
    $('#totals', el).innerHTML = `<span>Totale formula: <span class="${ok ? 'good' : 'bad'}">${fmtNum(tot, 4)} %</span></span>${ok ? '' : `<span class="bad">${tot > 100 ? 'eccedenza' : 'mancano'} ${fmtNum(Math.abs(100 - tot), 4)} %</span>`}<span class="muted">${recipeItems(r).length} ingredienti</span>`;
    const inci = inciList(r, db2.materials);
    $('#inci', el).innerHTML = String(html`
      ${inci.warnings.map(w => html`<div class="alert warn small">${w}</div>`)}
      <div class="inci-box" id="incitext">${inci.list.map((e, i) => html`${i ? ', ' : ''}${e.pct >= 1 ? e.inci : html`<span title="< 1%">${e.inci}</span>`}`)}</div>
      <div class="toolbar" style="margin-top:.5rem"><button type="button" class="btn btn-sm" id="copyInci">📋 Copia</button><span class="muted small">Ordine decrescente; ingredienti &lt;1% in coda. Allergeni oltre soglia inclusi.</span></div>
      <details><summary class="small">Dettaglio concentrazioni</summary>${table(['INCI', ['%', 'num']], inci.list.map(e => html`<tr><td>${e.inci}${e.allergen ? html` <span class="badge warn">allergene</span>` : ''}</td><td class="num">${fmtNum(e.pct, 5)}</td></tr>`), { cls: 'compact' })}</details>`);
    $('#allergens', el).innerHTML = String(html`<p class="muted small">Soglia ${inci.type}: <b>${String(inci.threshold).replace('.', ',')}%</b></p>
      ${inci.allergens.length ? table(['Allergene', ['% nel prodotto', 'num'], ['ppm', 'num'], 'Etichetta'], inci.allergens.map(a => html`<tr><td>${a.name}<div class="muted small">${a.sources.join(', ')}</div></td><td class="num">${fmtNum(a.pct, 5)}</td><td class="num">${fmtNum(a.pct * 10000, 1)}</td><td>${a.declare ? html`<span class="badge warn">DICHIARARE</span>` : html`<span class="badge">sotto soglia</span>`}</td></tr>`), { cls: 'compact' }) : html`<p class="muted">Nessun allergene registrato nelle materie prime usate.</p>`}`);
    const c = recipeCost(r, db2);
    const vat = db2.settings.vatRate;
    const b2c = priceAnalysis(c.total, r.priceB2C, vat, true);
    const b2b = priceAnalysis(c.total, r.priceB2B, vat, false);
    $('#cost', el).innerHTML = String(html`${table(['Voce', ['€ / unità', 'num']], [
      html`<tr><td>Materie prime (bulk ${fmtEur(c.bulkPerKg)}/kg)</td><td class="num">${fmtEur(c.raw)}</td></tr>`,
      html`<tr><td>+ calo ${fmtNum(r.lossPct || 0)}%</td><td class="num">${fmtEur(c.rawWithLoss - c.raw)}</td></tr>`,
      html`<tr><td>Packaging</td><td class="num">${fmtEur(c.pack)}</td></tr>`,
      html`<tr><td>Manodopera + altri</td><td class="num">${fmtEur(c.labor + c.extra)}</td></tr>`,
      html`<tr><td><b>Costo industriale</b></td><td class="num"><b>${fmtEur(c.total)}</b></td></tr>`,
      r.priceB2C ? html`<tr><td>B2C: netto IVA ${fmtEur(b2c.net)} · margine</td><td class="num">${fmtEur(b2c.margin)} (${fmtNum(b2c.marginPct, 1)}%) ×${fmtNum(b2c.markup, 2)}</td></tr>` : '',
      r.priceB2B ? html`<tr><td>B2B: margine</td><td class="num">${fmtEur(b2b.margin)} (${fmtNum(b2b.marginPct, 1)}%) ×${fmtNum(b2b.markup, 2)}</td></tr>` : '',
    ], { cls: 'compact' })}
    ${c.lines.some(l => !l.material?.cost) ? html`<p class="alert warn small">Alcune materie non hanno costo: il calcolo è incompleto.</p>` : ''}`);
    renderScale();
  }
  function renderScale() {
    const tu = num($('#targetUnits', el).value);
    let target = num($('#target', el).value);
    if (tu > 0 && r.unitSize > 0) { target = round(tu * r.unitSize * (1 + (Number(r.lossPct) || 0) / 100), 2); }
    const s = scaleRecipe(r, target);
    const db2 = app.db;
    $('#scale', el).innerHTML = String(html`<p class="small muted">${fmtQty(target, 'g')} → ${s.units} unità da ${r.unitSize || '?'} g</p>
      ${table(['Fase / materia', ['%', 'num'], ['g', 'num'], ['Disponibile', 'num']], s.phases.flatMap(ph => [
        html`<tr><td colspan="4"><b>${ph.name}</b> <span class="muted small">${ph.temp || ''}</span></td></tr>`,
        ...ph.items.map(it => {
          const m = byId(db2.materials, it.materialId);
          const st = m ? materialStock(db2, m.id).usable : 0;
          return html`<tr><td>${m?.name || '—'}</td><td class="num">${fmtNum(it.pct, 3)}</td><td class="num"><b>${fmtNum(it.grams, 2)}</b></td><td class="num">${st < it.grams ? html`<span class="badge danger">${fmtQty(st, 'g')}</span>` : fmtQty(st, 'g')}</td></tr>`;
        })]), { cls: 'compact' })}
      ${!isNew ? html`<a class="btn btn-primary" style="margin-top:.5rem" href="#/batch-new?recipe=${r.id}&w=${target}">🏭 Crea lotto da ${fmtQty(target, 'g')}</a>` : ''}`);
  }
  renderPhases(); renderPack(); renderCalc();

  form.addEventListener('input', e => {
    if (e.target.id === 'target') $('#targetUnits', el).value = '';
    sync(); renderCalc();
  });
  form.addEventListener('change', e => {
    if (e.target.dataset.f === 'qs') { if (!e.target.checked) e.target.closest('.item').querySelector('[data-f=pct]').readOnly = false; else e.target.closest('.item').querySelector('[data-f=pct]').readOnly = true; }
    sync(); renderCalc();
  });
  form.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'copyInci') { navigator.clipboard?.writeText($('#incitext', el).textContent).then(() => toast('INCI copiato', 'ok')); return; }
    if (t.id === 'addPhase') { sync(); r.phases.push(newPhase(`Fase ${String.fromCharCode(65 + r.phases.length)}`)); renderPhases(); }
    else if (t.id === 'addPack') { sync(); r.packaging.push({ materialId: '', qty: 1 }); renderPack(); }
    else if (t.dataset.additem) { sync(); r.phases[t.dataset.additem].items.push({ materialId: '', pct: '' }); renderPhases(); $$(`.phase[data-pi="${t.dataset.additem}"] [data-f=mat]`, el).at(-1)?.focus(); }
    else if (t.dataset.delitem) { sync(); const [pi, ii] = t.dataset.delitem.split('.').map(Number); r.phases[pi].items.splice(ii, 1); renderPhases(); }
    else if (t.dataset.delphase) { sync(); if (r.phases[t.dataset.delphase].items.length && !confirm('Eliminare la fase e i suoi ingredienti?')) return; r.phases.splice(Number(t.dataset.delphase), 1); renderPhases(); }
    else if (t.dataset.up) { sync(); const i = Number(t.dataset.up); if (i > 0) { [r.phases[i - 1], r.phases[i]] = [r.phases[i], r.phases[i - 1]]; renderPhases(); } }
    else if (t.dataset.delpack !== undefined) { sync(); r.packaging.splice(Number(t.dataset.delpack), 1); renderPack(); }
    else return;
    app.setDirty(); renderCalc();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    sync();
    if (!r.name) return toast('Nome obbligatorio', 'error');
    for (const ph of r.phases) ph.items = ph.items.filter(i => i.materialId);
    const tot = recipeTotalPct(r);
    if (Math.abs(tot - 100) > 0.001 && !await confirmDialog(`La formula somma ${fmtNum(tot, 4)}% invece di 100%. Salvare comunque come bozza?`)) return;
    const bump = form.bumpVersion?.checked;
    const res = await app.run(() => app.dispatch('recipe.upsert', { recipe: { ...r, bumpVersion: !!bump } }), 'Ricetta salvata');
    if (res) { app.setDirty(false); if (isNew) app.navigate(`#/recipe/${r.id}`); else app.render(); }
  });
  $('#dup', el)?.addEventListener('click', async () => {
    const copy = { ...clone(src), id: uid(), name: src.name + ' (copia)', code: '', version: 1, history: [] };
    if (await app.run(() => app.dispatch('recipe.upsert', { recipe: copy }), 'Ricetta duplicata')) app.navigate(`#/recipe/${copy.id}`);
  });
  $('#del', el)?.addEventListener('click', async () => {
    if (!await confirmDialog(`Eliminare la ricetta "${src.name}"?`, { danger: true, okLabel: 'Elimina' })) return;
    if (await app.run(() => app.dispatch('recipe.delete', { id: src.id }), 'Ricetta eliminata')) { app.setDirty(false); app.navigate('#/recipes'); }
  });
  $('#lblpdf', el)?.addEventListener('click', () => { sync(); openPdf(productLabelPdf(app.db, r, null, app.db.settings.labelLarge), `etichetta-${r.code || r.name}.pdf`); });
  bindDocs(el, app);
}
