// Helper UI minimali (nessun framework).
import { esc } from './util.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));

function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

/** Template HTML con escape automatico dei valori (usare raw() per HTML fidato). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? val(vals[i]) : ''); });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, fn) {
  root.addEventListener(event, e => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

export function toast(msg, type = 'info', ms = 3500) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add('hide'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

let modalDepth = 0;
export const modalOpen = () => modalDepth > 0;

export function openModal({ title, body, actions = [], wide = false, onClose }) {
  const root = $('#modals');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title || '')}</h2><button class="icon-btn" data-close aria-label="Chiudi">✕</button></div>
    <div class="modal-body">${String(body || '')}</div>
    <div class="modal-foot"></div></div>`;
  const foot = $('.modal-foot', wrap);
  let closed = false;
  const close = (v) => {
    if (closed) return; closed = true;
    wrap.remove(); modalDepth--;
    document.removeEventListener('keydown', onKey);
    onClose && onClose(v);
    document.dispatchEvent(new CustomEvent('modalclosed'));
  };
  const onKey = e => { if (e.key === 'Escape') close(null); };
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`;
    b.textContent = a.label;
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (!a.onClick) return close(a.value ?? null);
      b.disabled = true;
      try { const r = await a.onClick(wrap, close); if (r !== false && !a.keepOpen) close(r); }
      catch (e) { toast(e.message, 'error', 6000); }
      finally { b.disabled = false; }
    });
    foot.appendChild(b);
  }
  if (!actions.length) foot.remove();
  $('[data-close]', wrap).addEventListener('click', () => close(null));
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
  document.addEventListener('keydown', onKey);
  root.appendChild(wrap);
  modalDepth++;
  const first = $('input:not([type=hidden]),select,textarea', wrap);
  if (first && window.matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 30);
  return { el: wrap, close };
}

export function confirmDialog(message, { title = 'Conferma', okLabel = 'Conferma', danger = false } = {}) {
  return new Promise(resolve => {
    openModal({
      title, body: `<p>${esc(message)}</p>`,
      actions: [{ label: 'Annulla', value: false }, { label: okLabel, primary: !danger, danger, value: true }],
      onClose: v => resolve(!!v),
    });
  });
}

/** Form in modale; risolve con i dati (oggetto) oppure null. validate(data) può lanciare. */
export function formDialog(title, fieldsHtml, { okLabel = 'Salva', validate, wide } = {}) {
  return new Promise(resolve => {
    let result = null;
    const m = openModal({
      title, wide, body: `<form class="form" novalidate>${String(fieldsHtml)}<button type="submit" hidden></button></form>`,
      actions: [
        { label: 'Annulla' },
        { label: okLabel, primary: true, onClick: (wrap) => { const d = readForm($('form', wrap)); if (validate) validate(d); result = d; return d; } },
      ],
      onClose: () => resolve(result),
    });
    $('form', m.el).addEventListener('submit', e => { e.preventDefault(); $('.modal-foot .btn-primary', m.el).click(); });
  });
}

export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.dataset.type === 'number' || el.type === 'number') out[el.name] = el.value === '' ? '' : Number(String(el.value).replace(',', '.'));
    else out[el.name] = el.value.trim();
  }
  return out;
}

export function field(label, input, hint = '') {
  return html`<label class="field"><span>${label}</span>${raw(input)}${hint ? html`<small>${hint}</small>` : ''}</label>`;
}

export function input(name, value = '', attrs = '') {
  return raw(`<input name="${esc(name)}" value="${esc(value ?? '')}" ${attrs}>`);
}

export function select(name, options, value, attrs = '') {
  return raw(`<select name="${esc(name)}" ${attrs}>${options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('')}</select>`);
}

export function badge(text, kind = '') { return html`<span class="badge ${kind}">${text}</span>`; }

export const LOT_STATE = {
  ok: ['Disponibile', 'ok'], expiring: ['In scadenza', 'warn'], expired: ['Scaduto', 'danger'],
  blocked: ['Bloccato', 'danger'], quarantine: ['Quarantena', 'warn'], empty: ['Esaurito', 'muted'],
};

export const BATCH_STATE = {
  'pianificato': ['Pianificato', 'muted'], 'in-lavorazione': ['In lavorazione', 'info'], 'completato': ['Da rilasciare (QC)', 'warn'],
  'rilasciato': ['Rilasciato', 'ok'], 'respinto': ['Respinto', 'danger'], 'annullato': ['Annullato', 'muted'],
};

export function emptyState(msg, action = '') {
  return html`<div class="empty"><p>${msg}</p>${raw(action)}</div>`;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/** Apre un PDF: su mobile usa la condivisione nativa se disponibile, altrimenti nuova scheda/download. */
export async function openPdf(doc, filename) {
  const blob = doc.output('blob');
  const file = typeof File !== 'undefined' ? new File([blob], filename, { type: 'application/pdf' }) : null;
  const mobile = window.matchMedia('(pointer:coarse)').matches;
  if (mobile && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) downloadBlob(blob, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function readFileAs(file, how = 'arrayBuffer') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (how === 'text') r.readAsText(file);
    else if (how === 'dataURL') r.readAsDataURL(file);
    else r.readAsArrayBuffer(file);
  });
}

export function pickFile(accept = '') {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

/** Tabella con ricerca testuale semplice. rows: array di Raw/stringhe <tr>. */
export function table(headers, rowsHtml, { cls = '' } = {}) {
  return html`<div class="table-wrap"><table class="tbl ${cls}"><thead><tr>${headers.map(h => {
    const [label, c] = Array.isArray(h) ? h : [h, ''];
    return html`<th class="${c}">${label}</th>`;
  })}</tr></thead><tbody>${rowsHtml.length ? rowsHtml : raw(`<tr><td colspan="${headers.length}" class="muted center">Nessun elemento</td></tr>`)}</tbody></table></div>`;
}

export function bindSearch(root, inputSel, rowSel) {
  const inp = $(inputSel, root);
  if (!inp) return;
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    for (const r of $$(rowSel, root)) r.hidden = q && !r.textContent.toLowerCase().includes(q);
  });
}

// Spiegazione degli acronimi al passaggio del mouse (<abbr title>), applicata a tutto ciò che viene mostrato.
const ACRONYMS = {
  INCI: 'International Nomenclature of Cosmetic Ingredients – denominazione internazionale degli ingredienti cosmetici',
  CAS: 'Chemical Abstracts Service – numero di registro della sostanza chimica',
  EINECS: 'European Inventory of Existing Commercial Chemical Substances – inventario europeo delle sostanze',
  CE: 'Comunità Europea (nel numero CE: identificativo europeo della sostanza)',
  FEFO: 'First Expired, First Out – si usa per primo il lotto che scade prima',
  PAO: 'Period After Opening – mesi di utilizzo dopo l\'apertura',
  QC: 'Quality Control – controllo qualità',
  TDS: 'Technical Data Sheet – scheda tecnica',
  SDS: 'Safety Data Sheet – scheda di sicurezza',
  MSDS: 'Material Safety Data Sheet – scheda di sicurezza',
  CoA: 'Certificate of Analysis – certificato di analisi del lotto',
  PIF: 'Product Information File – fascicolo informativo del prodotto (Reg. 1223/2009, art. 11)',
  GMP: 'Good Manufacturing Practice – norme di buona fabbricazione (ISO 22716)',
  IFRA: 'International Fragrance Association – standard di sicurezza per le fragranze',
  COSMOS: 'Standard europeo per la certificazione dei cosmetici biologici e naturali',
  CPNP: 'Cosmetic Products Notification Portal – portale UE di notifica dei cosmetici',
  B2B: 'Business to Business – vendita a rivenditori e aziende (prezzi IVA esclusa)',
  B2C: 'Business to Consumer – vendita al consumatore finale (prezzi IVA inclusa)',
  IVA: 'Imposta sul Valore Aggiunto',
  CF: 'Codice Fiscale',
  DDT: 'Documento di Trasporto',
  MP: 'Materia Prima',
  PK: 'Packaging – materiale di confezionamento',
  PF: 'Prodotto Finito',
  UM: 'Unità di Misura',
  QR: 'Quick Response – codice a barre bidimensionale',
  CSV: 'Comma-Separated Values – tabella in testo semplice, apribile con Excel',
  XLSX: 'File Excel',
  PWA: 'Progressive Web App – sito installabile come un\'app',
};
const ACR_SRC = `\\b(${Object.keys(ACRONYMS).join('|')})\\b`;
const ACR_RE = new RegExp(ACR_SRC, 'g');
const ACR_TEST = new RegExp(ACR_SRC); // senza 'g': test() non deve ricordare lastIndex tra un nodo e l'altro
const SKIP = new Set(['ABBR', 'SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION', 'SELECT', 'INPUT', 'TITLE']);

export function abbreviate(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // niente tooltip dentro codici (lotti, articoli) e campi di inserimento
    acceptNode: n => (SKIP.has(n.parentNode.nodeName) || n.parentNode.closest('.mono, abbr, [contenteditable]') || !ACR_TEST.test(n.data))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0;
    n.data.replace(ACR_RE, (m, _k, i) => {
      frag.append(n.data.slice(last, i));
      const a = document.createElement('abbr');
      a.title = ACRONYMS[m];
      a.textContent = m;
      frag.append(a);
      last = i + m.length;
    });
    frag.append(n.data.slice(last));
    n.replaceWith(frag);
  }
}

export function autoAbbreviate(...roots) {
  const obs = new MutationObserver(() => roots.forEach(abbreviate));
  for (const r of roots) { abbreviate(r); obs.observe(r, { childList: true, subtree: true }); }
}
