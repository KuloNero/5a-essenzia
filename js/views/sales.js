import { html, raw, table, field, input, select, $, $$, toast, bindSearch, confirmDialog, formDialog } from '../ui.js';
import { byId, recipeCost, priceAnalysis, priceForMargin } from '../domain.js';
import { today, fmtDate, fmtEur, fmtNum, num, round, uid, sortBy, esc } from '../util.js';
import { pageHead } from './common.js';

// ---------------- Clienti ----------------
export function customers(el, { app }) {
  const db = app.db;
  const list = sortBy(db.customers, c => c.name.toLowerCase());
  el.innerHTML = String(html`${pageHead('Clienti', `${list.length} clienti`, '<a class="btn" href="#/data?imp=customers">⬆️ Importa</a><button class="btn btn-primary" id="add">+ Nuovo</button>')}
    <div class="toolbar"><input class="search" id="q" placeholder="Cerca…"></div>
    ${table(['Nome', 'Tipo', 'Email', 'Telefono', ['Ordini', 'num'], ['Fatturato', 'num'], ''], list.map(c => {
      const orders = db.orders.filter(o => o.customerId === c.id && o.status !== 'annullato');
      return html`<tr class="row"><td data-l="Nome"><b>${c.name}</b><div class="muted small">${c.address || ''}</div></td><td data-l="Tipo">${badge2(c.type)}</td>
      <td data-l="Email">${c.email}</td><td data-l="Tel.">${c.phone}</td><td class="num" data-l="Ordini">${orders.length}</td><td class="num" data-l="Fatturato">${fmtEur(orders.reduce((s, o) => s + orderTotals(o).net, 0))}</td>
      <td class="row-actions"><a class="btn btn-sm" href="#/order-new?customer=${c.id}">+ Ordine</a><button class="btn btn-sm" data-edit="${c.id}">Modifica</button></td></tr>`;
    }), { cls: 'cards' })}`);
  bindSearch(el, '#q', 'tr.row');
  $('#add', el).onclick = () => customerDialog(app);
  el.addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) customerDialog(app, byId(app.db.customers, b.dataset.edit)); });
}
const badge2 = t => raw(`<span class="badge ${t === 'B2B' ? 'info' : ''}">${t || 'B2C'}</span>`);

async function customerDialog(app, c = {}) {
  const d = await formDialog(c.id ? 'Modifica cliente' : 'Nuovo cliente', html`
    ${field('Nome / Ragione sociale *', input('name', c.name, 'required'))}
    <div class="form-grid">${field('Tipo', select('type', [['B2C', 'B2C · privato / e-commerce'], ['B2B', 'B2B · rivenditore']], c.type || 'B2C'))}${field('P.IVA / CF', input('vat', c.vat))}</div>
    <div class="form-grid">${field('Email', input('email', c.email, 'type="email"'))}${field('Telefono', input('phone', c.phone, 'type="tel"'))}</div>
    ${field('Indirizzo', input('address', c.address))}
    ${field('Sconto abituale (%)', input('discountPct', c.discountPct, 'inputmode="decimal"'))}
    ${field('Note', input('notes', c.notes))}`, { validate: d => { if (!d.name) throw new Error('Nome obbligatorio'); } });
  if (!d) return null;
  const customer = { ...c, ...d, id: c.id || uid() };
  const r = await app.run(() => app.dispatch('customer.upsert', { customer }), 'Cliente salvato');
  return r ? customer : null;
}

// ---------------- Ordini ----------------
export function orderTotals(o) {
  const vat = Number(o.vatRate ?? 22) / 100;
  let gross = 0;
  for (const l of o.lines || []) gross += Number(l.qty) * Number(l.price || 0) * (1 - Number(l.discountPct || 0) / 100);
  const net = o.pricesIncludeVat ? gross / (1 + vat) : gross;
  return { net: round(net, 2), vat: round(net * vat, 2), total: round(net * (1 + vat), 2) };
}

export function orders(el, { app }) {
  const db = app.db;
  const list = sortBy(db.orders, o => o.date + o.number, -1);
  el.innerHTML = String(html`${pageHead('Ordini', 'Storico vendite con lotti assegnati (tracciabilità verso il cliente)', '<a class="btn btn-primary" href="#/order-new">+ Nuovo ordine</a>')}
    <div class="toolbar"><input class="search" id="q" placeholder="Cerca numero, cliente, prodotto…"></div>
    ${table(['Numero', 'Data', 'Cliente', 'Canale', 'Prodotti', ['Imponibile', 'num'], 'Stato'], list.map(o => html`<tr class="clickable row" data-href="#/order/${o.id}">
      <td class="mono" data-l="N.">${o.number}</td><td data-l="Data">${fmtDate(o.date)}</td><td data-l="Cliente"><b>${byId(db.customers, o.customerId)?.name || '?'}</b></td><td data-l="Canale">${badge2(o.channel)}</td>
      <td data-l="Prodotti" class="small">${o.lines.map(l => `${l.qty}× ${l.name}`).join(', ')}</td><td class="num" data-l="Imponibile">${fmtEur(orderTotals(o).net)}</td>
      <td data-l="Stato"><span class="badge ${o.status === 'annullato' ? 'danger' : o.status === 'spedito' || o.status === 'consegnato' ? 'ok' : 'info'}">${o.status}</span></td></tr>`), { cls: 'cards' })}`);
  bindSearch(el, '#q', 'tr.row');
}

export function orderNew(el, { app, query }) {
  const db = app.db;
  const recipes = sortBy(db.recipes.filter(r => !r.archived), r => r.name.toLowerCase());
  const avail = id => db.batches.filter(b => b.recipeId === id && b.status === 'rilasciato').reduce((s, b) => s + Number(b.unitsAvailable || 0), 0);
  const state = { customerId: query.get('customer') || '', lines: [{ recipeId: '', qty: 1, price: '', discountPct: 0, batchId: '' }] };
  el.innerHTML = String(html`${pageHead('Nuovo ordine', 'I lotti vengono assegnati in automatico (FEFO) o manualmente, e scalati dal magazzino prodotti finiti')}
    <form class="card form" id="of" data-dirty>
      <div class="form-grid">
        <div class="field"><span>Cliente *</span><div style="display:flex;gap:.4rem">${raw(select('customerId', [['', '— seleziona —'], ...sortBy(db.customers, c => c.name.toLowerCase()).map(c => [c.id, `${c.name} (${c.type || 'B2C'})`])], state.customerId))}<button type="button" class="btn" id="newc">+</button></div></div>
        ${field('Data', input('date', today(), 'type="date"'))}
        ${field('Canale / listino', select('channel', [['B2C', 'B2C (prezzi IVA inclusa)'], ['B2B', 'B2B (prezzi IVA esclusa)']], 'B2C'))}
        ${field('IVA %', input('vatRate', db.settings.vatRate, 'inputmode="decimal"'))}
      </div>
      <h3>Righe</h3><div id="lines"></div>
      <button type="button" class="btn btn-sm" id="addl">+ Riga</button>
      ${field('Note', input('note', ''))}
      <div class="total-bar" id="tot"></div>
      <div class="toolbar"><button class="btn btn-primary btn-lg" type="submit">Conferma ordine</button></div>
    </form>`);
  const form = $('#of', el);
  const priceFor = r => (form.channel.value === 'B2B' ? r?.priceB2B : r?.priceB2C) || '';
  const renderLines = () => {
    $('#lines', el).innerHTML = state.lines.map((l, i) => {
      const bs = db.batches.filter(b => b.recipeId === l.recipeId && b.status === 'rilasciato' && b.unitsAvailable > 0);
      return `<div class="card" style="padding:.6rem;margin-bottom:.5rem" data-line="${i}"><div class="form-grid">
        <label class="field"><span>Prodotto</span><select data-f="recipeId"><option value="">—</option>${recipes.map(r => `<option value="${r.id}" ${r.id === l.recipeId ? 'selected' : ''}>${esc(r.name)} · disp. ${avail(r.id)}</option>`).join('')}</select></label>
        <label class="field"><span>Lotto</span><select data-f="batchId"><option value="">Automatico (FEFO)</option>${bs.map(b => `<option value="${b.id}" ${b.id === l.batchId ? 'selected' : ''}>${esc(b.lotCode)} · scad. ${fmtDate(b.expiry)} · ${b.unitsAvailable} pz</option>`).join('')}</select></label>
        <label class="field"><span>Q.tà</span><input data-f="qty" value="${l.qty}" type="number" min="1" inputmode="numeric"></label>
        <label class="field"><span>Prezzo unit.</span><input data-f="price" value="${l.price}" inputmode="decimal"></label>
        <label class="field"><span>Sconto %</span><input data-f="discountPct" value="${l.discountPct}" inputmode="decimal"></label>
        <div class="field"><span>&nbsp;</span><button type="button" class="btn" data-del="${i}">Rimuovi</button></div></div></div>`;
    }).join('');
  };
  const readLines = () => $$('[data-line]', el).forEach(d => {
    const l = state.lines[d.dataset.line];
    for (const f of ['recipeId', 'batchId', 'qty', 'price', 'discountPct']) l[f] = $(`[data-f=${f}]`, d).value;
  });
  const total = () => {
    const o = { lines: state.lines.map(l => ({ qty: num(l.qty), price: num(l.price), discountPct: num(l.discountPct) })), vatRate: num(form.vatRate.value), pricesIncludeVat: form.channel.value === 'B2C' };
    const t = orderTotals(o);
    $('#tot', el).innerHTML = `<span>Imponibile <b>${fmtEur(t.net)}</b></span><span>IVA ${fmtEur(t.vat)}</span><span>Totale <b>${fmtEur(t.total)}</b></span>`;
  };
  renderLines(); total();
  form.addEventListener('change', e => {
    readLines();
    const line = e.target.closest('[data-line]');
    if (e.target.dataset.f === 'recipeId') { const l = state.lines[line.dataset.line]; l.price = priceFor(byId(db.recipes, l.recipeId)); l.batchId = ''; renderLines(); }
    if (e.target.name === 'channel') { state.lines.forEach(l => { l.price = priceFor(byId(db.recipes, l.recipeId)); }); renderLines(); }
    if (e.target.name === 'customerId') {
      const c = byId(app.db.customers, form.customerId.value);
      if (c) { form.channel.value = c.type || 'B2C'; state.lines.forEach(l => { l.price = priceFor(byId(db.recipes, l.recipeId)); l.discountPct = c.discountPct || 0; }); renderLines(); }
    }
    total();
  });
  form.addEventListener('input', () => { readLines(); total(); });
  form.addEventListener('click', async e => {
    if (e.target.id === 'addl') { readLines(); state.lines.push({ recipeId: '', qty: 1, price: '', discountPct: byId(app.db.customers, form.customerId.value)?.discountPct || 0, batchId: '' }); renderLines(); }
    const d = e.target.closest('[data-del]'); if (d) { readLines(); state.lines.splice(Number(d.dataset.del), 1); renderLines(); total(); }
    if (e.target.id === 'newc') {
      const c = await customerDialog(app);
      if (c) { form.customerId.insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(c.name)}</option>`); form.customerId.value = c.id; form.channel.value = c.type || 'B2C'; }
    }
  });
  if (state.customerId) form.customerId.dispatchEvent(new Event('change', { bubbles: true }));
  form.addEventListener('submit', async e => {
    e.preventDefault(); readLines();
    const lines = state.lines.filter(l => l.recipeId && num(l.qty) > 0).map(l => ({ recipeId: l.recipeId, batchId: l.batchId || null, qty: num(l.qty), price: num(l.price), discountPct: num(l.discountPct) }));
    if (!form.customerId.value) return toast('Seleziona il cliente', 'error');
    if (!lines.length) return toast('Aggiungi almeno una riga', 'error');
    const id = uid();
    const r = await app.run(() => app.dispatch('order.create', { order: { id, customerId: form.customerId.value, date: form.date.value, channel: form.channel.value, vatRate: num(form.vatRate.value), pricesIncludeVat: form.channel.value === 'B2C', lines, note: form.note.value } }), 'Ordine registrato');
    if (r) { app.setDirty(false); app.navigate(`#/order/${id}`); }
  });
}

export function orderView(el, { app, params }) {
  const db = app.db;
  const o = byId(db.orders, params[0]);
  if (!o) { el.innerHTML = '<div class="empty">Ordine non trovato</div>'; return; }
  const c = byId(db.customers, o.customerId) || {};
  const t = orderTotals(o);
  el.innerHTML = String(html`${pageHead(`Ordine ${o.number}`, html`${fmtDate(o.date)} · ${c.name} · ${o.channel}`)}
    <div class="card">${table(['Prodotto', ['Q.tà', 'num'], ['Prezzo', 'num'], ['Sconto', 'num'], 'Lotti assegnati'], o.lines.map(l => html`<tr><td data-l="Prodotto"><b>${l.name}</b></td><td class="num" data-l="Q.tà">${l.qty}</td><td class="num" data-l="Prezzo">${fmtEur(l.price)}</td><td class="num" data-l="Sconto">${l.discountPct ? l.discountPct + '%' : ''}</td>
      <td data-l="Lotti">${(l.allocations || []).map(a => html`<a class="mono" href="#/batch/${a.batchId}">${a.lotCode}</a> ×${a.qty} `)}</td></tr>`), { cls: 'cards' })}
      <p class="right">Imponibile <b>${fmtEur(t.net)}</b> · IVA ${fmtEur(t.vat)} · Totale <b>${fmtEur(t.total)}</b></p>
      ${o.note ? html`<p class="muted">${o.note}</p>` : ''}</div>
    <div class="toolbar">${o.status !== 'annullato' ? raw(`${select('status', [['confermato', 'Confermato'], ['spedito', 'Spedito'], ['consegnato', 'Consegnato'], ['fatturato', 'Fatturato']], o.status, 'id="st" style="max-width:200px"')}<button class="btn btn-danger" id="cancel">Annulla ordine (reso a magazzino)</button>`) : html`<span class="badge danger">Annullato</span>`}</div>`);
  $('#st', el)?.addEventListener('change', e => app.run(() => app.dispatch('order.status', { id: o.id, status: e.target.value }), 'Stato aggiornato'));
  $('#cancel', el)?.addEventListener('click', async () => {
    if (await confirmDialog('Annullare l\'ordine? Le unità tornano disponibili nei rispettivi lotti.', { danger: true, okLabel: 'Annulla ordine' })) await app.run(() => app.dispatch('order.status', { id: o.id, status: 'annullato' }), 'Ordine annullato');
  });
}

// ---------------- Costi & listini ----------------
export function pricing(el, { app }) {
  const db = app.db;
  const vat = db.settings.vatRate;
  const list = sortBy(db.recipes.filter(r => !r.archived), r => r.name.toLowerCase());
  el.innerHTML = String(html`${pageHead('Costi & listini', `Costo industriale e margini per canale · IVA ${vat}%`, '<a class="btn" href="#/data?imp=pricelist">⬆️ Importa listino</a>')}
    <div class="card form"><div class="form-grid">
      ${field('Margine obiettivo B2C (%)', input('tB2C', 70, 'id="tB2C" inputmode="decimal"'))}
      ${field('Margine obiettivo B2B (%)', input('tB2B', 45, 'id="tB2B" inputmode="decimal"'))}
      ${field('Arrotonda prezzi B2C a', select('round', [['0.9', 'x,90'], ['0.5', 'x,50 / x,00'], ['0', 'centesimi']], '0.9', 'id="rnd"'))}
    </div><p class="muted small">Modifica i prezzi direttamente in tabella, poi salva. "Suggerito" = prezzo per ottenere il margine obiettivo.</p></div>
    ${table(['Prodotto', ['Costo', 'num'], ['B2C (IVA inc.)', 'num'], ['Margine B2C', 'num'], ['Sugg. B2C', 'num'], ['B2B (IVA esc.)', 'num'], ['Margine B2B', 'num'], ['Sugg. B2B', 'num']], list.map(r => {
      const c = recipeCost(r, db).total;
      return html`<tr data-r="${r.id}" data-cost="${c}"><td data-l="Prodotto"><a href="#/recipe/${r.id}"><b>${r.name}</b></a> <span class="muted small">${r.nominalContent || ''}</span></td><td class="num" data-l="Costo">${fmtEur(c)}</td>
        <td class="num" data-l="B2C"><input data-p="priceB2C" value="${r.priceB2C ?? ''}" inputmode="decimal" style="max-width:100px"></td><td class="num" data-l="Margine B2C" data-m="B2C"></td><td class="num" data-l="Sugg. B2C" data-s="B2C"></td>
        <td class="num" data-l="B2B"><input data-p="priceB2B" value="${r.priceB2B ?? ''}" inputmode="decimal" style="max-width:100px"></td><td class="num" data-l="Margine B2B" data-m="B2B"></td><td class="num" data-l="Sugg. B2B" data-s="B2B"></td></tr>`;
    }), { cls: 'cards' })}
    <div class="toolbar" style="margin-top:1rem"><button class="btn btn-primary" id="save">Salva prezzi</button><button class="btn" id="apply">Applica prezzi suggeriti</button></div>`);
  const rnd = v => {
    const mode = $('#rnd', el).value;
    if (mode === '0.9') return Math.max(0.9, Math.ceil(v - 0.9) + 0.9);
    if (mode === '0.5') return Math.ceil(v * 2) / 2;
    return round(v, 2);
  };
  const calc = () => {
    for (const tr of $$('tr[data-r]', el)) {
      const c = Number(tr.dataset.cost);
      const p1 = num($('[data-p=priceB2C]', tr).value), p2 = num($('[data-p=priceB2B]', tr).value);
      const a1 = priceAnalysis(c, p1, vat, true), a2 = priceAnalysis(c, p2, vat, false);
      const cls = m => m < 0 ? 'badge danger' : m < 30 ? 'badge warn' : 'badge ok';
      $('[data-m=B2C]', tr).innerHTML = p1 ? `<span class="${cls(a1.marginPct)}">${fmtNum(a1.marginPct, 1)}%</span> <span class="small muted">${fmtEur(a1.margin)}</span>` : '';
      $('[data-m=B2B]', tr).innerHTML = p2 ? `<span class="${cls(a2.marginPct)}">${fmtNum(a2.marginPct, 1)}%</span> <span class="small muted">${fmtEur(a2.margin)}</span>` : '';
      $('[data-s=B2C]', tr).textContent = fmtEur(rnd(priceForMargin(c, num($('#tB2C', el).value), vat, true)));
      $('[data-s=B2B]', tr).textContent = fmtEur(priceForMargin(c, num($('#tB2B', el).value), vat, false));
    }
  };
  calc();
  el.addEventListener('input', calc);
  el.addEventListener('change', calc);
  $('#apply', el).onclick = () => {
    for (const tr of $$('tr[data-r]', el)) {
      const c = Number(tr.dataset.cost);
      $('[data-p=priceB2C]', tr).value = rnd(priceForMargin(c, num($('#tB2C', el).value), vat, true));
      $('[data-p=priceB2B]', tr).value = priceForMargin(c, num($('#tB2B', el).value), vat, false);
    }
    calc(); app.setDirty();
  };
  $('#save', el).onclick = async () => {
    const rows = $$('tr[data-r]', el).map(tr => {
      const r = byId(app.db.recipes, tr.dataset.r);
      const p1 = $('[data-p=priceB2C]', tr).value, p2 = $('[data-p=priceB2B]', tr).value;
      return { ...r, priceB2C: p1 === '' ? '' : num(p1), priceB2B: p2 === '' ? '' : num(p2) };
    }).filter(r => { const o = byId(app.db.recipes, r.id); return o.priceB2C !== r.priceB2C || o.priceB2B !== r.priceB2B; });
    if (!rows.length) return toast('Nessuna modifica');
    if (await app.run(() => app.dispatch('import.bulk', { collection: 'recipes', rows }), `${rows.length} prezzi aggiornati`)) { app.setDirty(false); app.render(); }
  };
  el.querySelector('table').setAttribute('data-dirty', '');
}
