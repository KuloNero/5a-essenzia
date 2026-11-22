// Import/Export tabellare (CSV, XLSX minimale via JSZip) e backup completo.
import { esc, num, uid, normKey, isoDate, fmtDate } from './util.js';
import { COLLECTIONS, normalizeDb, byId, materialStock, lotState } from './domain.js';

// ---------------- CSV ----------------
export function toCSV(rows, headers) {
  const cols = headers || Object.keys(rows[0] || {});
  const q = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => q(r[c])).join(';'))].join('\r\n');
}

export function parseCSV(text) {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c !== '')) rows.push(row);
  return rowsToObjects(rows);
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// ---------------- XLSX minimale ----------------
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const xmlEsc = s => esc(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** sheets: [{name, rows: [obj], headers?}] → Blob .xlsx */
export async function writeXLSX(sheets) {
  const zip = new window.JSZip();
  const names = sheets.map((s, i) => (s.name || `Foglio${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`);
  sheets.forEach((s, si) => {
    const headers = s.headers || Object.keys(s.rows[0] || {});
    const cell = (v, r, c, style = '') => {
      const ref = `${colName(c)}${r}`;
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      if (v === null || v === undefined || v === '') return '';
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    };
    const rowsXml = [`<row r="1">${headers.map((h, c) => cell(h, 1, c, ' s="1"')).join('')}</row>`,
      ...s.rows.map((row, ri) => `<row r="${ri + 2}">${headers.map((h, c) => cell(row[h], ri + 2, c)).join('')}</row>`)];
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${headers.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(50, Math.max(10, String(h).length + 4))}" customWidth="1"/>`).join('')}</cols><sheetData>${rowsXml.join('')}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}

/** Legge il primo foglio (o quello indicato) di un .xlsx → array di oggetti. */
export async function readXLSX(arrayBuffer, sheetIndex = 0) {
  const zip = await window.JSZip.loadAsync(arrayBuffer);
  const parser = new DOMParser();
  const xml = async p => { const f = zip.file(p); return f ? parser.parseFromString(await f.async('string'), 'application/xml') : null; };
  const wb = await xml('xl/workbook.xml');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  const sheets = [...wb.getElementsByTagName('sheet')];
  if (!sheets.length) throw new Error('Nessun foglio trovato');
  const rid = sheets[sheetIndex].getAttribute('r:id') || sheets[sheetIndex].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
  let target = rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheet = await xml('xl/' + target);
  const ssDoc = await xml('xl/sharedStrings.xml');
  const shared = ssDoc ? [...ssDoc.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const rows = [];
  for (const r of sheet.getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      const letters = ref.replace(/\d+/g, '');
      let idx = 0; for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64); idx--;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let val;
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
      else if (t === 'b') val = v === '1';
      else if (t === 'str' || t === 'e') val = v;
      else val = v === '' ? '' : Number(v);
      row[idx < 0 ? row.length : idx] = val;
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rowsToObjects(rows.filter(r => r.some(x => x !== '')));
}

export async function readTable(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return readXLSX(await file.arrayBuffer());
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCSV(await file.text());
  throw new Error('Formato non supportato: usare .csv o .xlsx');
}

// ---------------- Schemi di import ----------------
// Colonne riconosciute (intestazioni case-insensitive; accetta alias)
export const IMPORT_SCHEMAS = {
  materials: {
    label: 'Materie prime / packaging',
    key: 'code',
    columns: [
      ['code', 'Codice', ['codice', 'cod']],
      ['name', 'Nome commerciale', ['nome', 'nome commerciale', 'descrizione'], true],
      ['inci', 'INCI', ['inci', 'denominazione inci']],
      ['cas', 'CAS', ['cas', 'n. cas', 'numero cas']],
      ['category', 'Categoria (raw/packaging)', ['categoria', 'tipo']],
      ['unit', 'UM (g/ml/pz)', ['um', 'unità', 'unita', 'unit']],
      ['cost', 'Costo (€/kg o €/pz)', ['costo', 'prezzo', 'cost']],
      ['minStock', 'Scorta minima', ['scorta minima', 'scorta', 'min']],
      ['supplier', 'Fornitore', ['fornitore', 'supplier']],
      ['function', 'Funzione', ['funzione', 'function']],
      ['allergens', 'Allergeni (Nome:%; ...)', ['allergeni', 'allergens']],
      ['composition', 'Composizione INCI (INCI:%; ...)', ['composizione', 'composition']],
      ['bio', 'Bio (si/no)', ['bio', 'biologico']],
      ['notes', 'Note', ['note', 'notes']],
    ],
  },
  suppliers: {
    label: 'Fornitori', key: 'name',
    columns: [
      ['name', 'Ragione sociale', ['nome', 'ragione sociale', 'fornitore'], true],
      ['vat', 'P.IVA', ['piva', 'p.iva', 'partita iva', 'vat']],
      ['contact', 'Referente', ['referente', 'contatto']],
      ['email', 'Email', ['email', 'e-mail']],
      ['phone', 'Telefono', ['telefono', 'tel']],
      ['address', 'Indirizzo', ['indirizzo']],
      ['notes', 'Note', ['note']],
    ],
  },
  customers: {
    label: 'Clienti', key: 'name',
    columns: [
      ['name', 'Nome / Ragione sociale', ['nome', 'ragione sociale', 'cliente'], true],
      ['type', 'Tipo (B2C/B2B)', ['tipo', 'canale']],
      ['vat', 'P.IVA / CF', ['piva', 'p.iva', 'codice fiscale', 'cf']],
      ['email', 'Email', ['email']],
      ['phone', 'Telefono', ['telefono']],
      ['address', 'Indirizzo', ['indirizzo']],
      ['notes', 'Note', ['note']],
    ],
  },
  pricelist: {
    label: 'Listino prezzi (aggiorna ricette esistenti)', key: 'code', target: 'recipes',
    columns: [
      ['code', 'Codice prodotto', ['codice', 'cod'], true],
      ['priceB2C', 'Prezzo B2C (IVA incl.)', ['prezzo b2c', 'b2c', 'prezzo pubblico']],
      ['priceB2B', 'Prezzo B2B (IVA escl.)', ['prezzo b2b', 'b2b', 'prezzo rivenditore']],
    ],
  },
};

function mapHeaders(rows, schema) {
  const headers = Object.keys(rows[0] || {});
  const map = {};
  for (const [key, label, aliases] of schema.columns) {
    const h = headers.find(x => [key.toLowerCase(), label.toLowerCase(), ...aliases].includes(normKey(x)));
    if (h) map[key] = h;
  }
  return map;
}

const parsePairs = s => String(s || '').split(/[;\n]/).map(x => x.trim()).filter(Boolean).map(x => {
  const i = x.lastIndexOf(':');
  return i > 0 ? { name: x.slice(0, i).trim(), pct: num(x.slice(i + 1)) } : { name: x, pct: 0 };
});

/** Valida le righe: restituisce {valid:[obj], errors:[{row,msg}], warnings, stats} senza modificare nulla. */
export function validateImport(kind, rows, db) {
  const schema = IMPORT_SCHEMAS[kind];
  const map = mapHeaders(rows, schema);
  const errors = [], warnings = [], valid = [];
  for (const [key, label, , required] of schema.columns) if (required && !map[key]) errors.push({ row: 0, msg: `Colonna obbligatoria mancante: "${label}"` });
  if (errors.length) return { valid, errors, warnings, map, stats: {} };
  const seen = new Set();
  let created = 0, updated = 0;
  rows.forEach((r, i) => {
    const line = i + 2;
    const g = k => (map[k] ? String(r[map[k]] ?? '').trim() : undefined);
    for (const [key, label, , required] of schema.columns) if (required && !g(key)) { errors.push({ row: line, msg: `"${label}" vuoto` }); return; }
    const keyVal = normKey(g(schema.key) || g('name'));
    if (keyVal && seen.has(keyVal)) { errors.push({ row: line, msg: `Duplicato nel file: ${g(schema.key) || g('name')}` }); return; }
    seen.add(keyVal);
    if (kind === 'materials') {
      const existing = db.materials.find(m => (g('code') && normKey(m.code) === normKey(g('code'))) || (!g('code') && normKey(m.name) === normKey(g('name'))));
      const unit = (g('unit') || existing?.unit || 'g').toLowerCase();
      if (!['g', 'ml', 'pz'].includes(unit)) { errors.push({ row: line, msg: `UM non valida "${unit}" (usare g, ml, pz)` }); return; }
      const cat = normKey(g('category') || existing?.category || 'raw');
      const category = ['packaging', 'pack', 'imballo', 'pk'].includes(cat) ? 'packaging' : 'raw';
      const cost = g('cost');
      if (cost && isNaN(num(cost, NaN))) { errors.push({ row: line, msg: `Costo non numerico "${cost}"` }); return; }
      let supplierId = existing?.supplierId || '';
      if (g('supplier')) {
        const s = db.suppliers.find(x => normKey(x.name) === normKey(g('supplier')));
        if (s) supplierId = s.id; else warnings.push({ row: line, msg: `Fornitore "${g('supplier')}" non trovato: verrà creato` });
      }
      const allergens = g('allergens') !== undefined ? parsePairs(g('allergens')).map(a => ({ name: a.name, pct: a.pct })) : existing?.allergens || [];
      const composition = g('composition') !== undefined ? parsePairs(g('composition')).map(a => ({ inci: a.name, pct: a.pct })) : existing?.composition || [];
      if (category === 'raw' && !g('inci') && !composition.length && !existing?.inci) warnings.push({ row: line, msg: `${g('name')}: INCI mancante` });
      const obj = {
        ...(existing || {}), id: existing?.id || uid(), code: g('code') ?? existing?.code ?? '', name: g('name'),
        inci: g('inci') ?? existing?.inci ?? '', cas: g('cas') ?? existing?.cas ?? '', category, unit,
        cost: cost !== undefined && cost !== '' ? num(cost) : existing?.cost ?? '', minStock: g('minStock') ? num(g('minStock')) : existing?.minStock ?? '',
        supplierId, _supplierName: !supplierId && g('supplier') ? g('supplier') : undefined,
        function: g('function') ?? existing?.function ?? '', allergens, composition,
        bio: g('bio') !== undefined ? /^(s|si|sì|y|yes|true|1|x)$/i.test(g('bio')) : !!existing?.bio,
        notes: g('notes') ?? existing?.notes ?? '',
      };
      existing ? updated++ : created++;
      valid.push(obj);
    } else if (kind === 'pricelist') {
      const r0 = db.recipes.find(x => normKey(x.code) === normKey(g('code')));
      if (!r0) { errors.push({ row: line, msg: `Prodotto con codice "${g('code')}" non trovato` }); return; }
      const obj = { ...r0 };
      for (const k of ['priceB2C', 'priceB2B']) {
        const v = g(k);
        if (v !== undefined && v !== '') { if (isNaN(num(v, NaN))) { errors.push({ row: line, msg: `Prezzo non numerico "${v}"` }); return; } obj[k] = num(v); }
      }
      updated++;
      valid.push(obj);
    } else {
      const coll = db[kind];
      const existing = coll.find(x => normKey(x.name) === keyVal);
      const obj = { ...(existing || {}), id: existing?.id || uid() };
      for (const [key] of schema.columns) { const v = g(key); if (v !== undefined) obj[key] = v; }
      if (kind === 'customers') obj.type = /b2b|rivend|azienda/i.test(obj.type || '') ? 'B2B' : 'B2C';
      if (kind === 'customers' && obj.email && !/^\S+@\S+\.\S+$/.test(obj.email)) warnings.push({ row: line, msg: `Email non valida: ${obj.email}` });
      existing ? updated++ : created++;
      valid.push(obj);
    }
  });
  return { valid, errors, warnings, map, stats: { created, updated } };
}

export function templateRows(kind) {
  const s = IMPORT_SCHEMAS[kind];
  const ex = {
    materials: { code: 'MP-001', name: 'Olio di mandorle dolci bio', inci: 'Prunus Amygdalus Dulcis Oil', cas: '8007-69-0', category: 'raw', unit: 'g', cost: '12,50', minStock: 1000, supplier: 'Fornitore Srl', function: 'Emolliente', allergens: '', composition: '', bio: 'si', notes: '' },
    suppliers: { name: 'Fornitore Srl', vat: 'IT01234567890', contact: 'Mario', email: 'ordini@fornitore.it', phone: '', address: '', notes: '' },
    customers: { name: 'Erboristeria Verde', type: 'B2B', vat: '', email: 'info@esempio.it', phone: '', address: '', notes: '' },
    pricelist: { code: 'PF-001', priceB2C: '24,90', priceB2B: '11,50' },
  }[kind];
  return { headers: s.columns.map(c => c[1]), rows: [Object.fromEntries(s.columns.map(c => [c[1], ex[c[0]] ?? '']))] };
}

// ---------------- Report ----------------
export function inventoryRows(db) {
  const d = isoDate();
  return db.lots.filter(l => Number(l.qty) > 0).map(l => {
    const m = byId(db.materials, l.materialId) || {};
    return {
      Tipo: m.category === 'packaging' ? 'Packaging' : 'Materia prima', Codice: m.code || '', Materia: m.name || '', INCI: m.inci || '',
      Lotto: l.lotCode, 'Lotto fornitore': l.supplierLot || '', Fornitore: byId(db.suppliers, l.supplierId)?.name || '',
      'Data carico': fmtDate(l.receivedAt), Scadenza: fmtDate(l.expiry), Stato: lotState(l, d, db.settings.expiryWarningDays),
      Giacenza: Number(l.qty), UM: l.unit, 'Costo unitario': l.cost !== '' && l.cost !== undefined ? Number(l.cost) : Number(m.cost || 0),
      Valore: Math.round(Number(l.qty) * (m.unit === 'pz' ? 1 : 0.001) * Number(l.cost !== '' && l.cost !== undefined ? l.cost : m.cost || 0) * 100) / 100,
      Ubicazione: l.location || '',
    };
  });
}

export function stockSummaryRows(db) {
  return db.materials.filter(m => !m.archived).map(m => {
    const s = materialStock(db, m.id);
    return { Codice: m.code || '', Materia: m.name, Tipo: m.category === 'packaging' ? 'Packaging' : 'Materia prima', 'Giacenza totale': s.qty, 'Giacenza utilizzabile': s.usable, UM: m.unit, 'Scorta minima': m.minStock || '', 'Sotto scorta': Number(m.minStock) > 0 && s.usable < Number(m.minStock) ? 'SI' : '', Valore: s.value };
  });
}

export function movementRows(db, from, to) {
  return db.movements.filter(mv => (!from || new Date(mv.ts) >= new Date(from)) && (!to || new Date(mv.ts) <= new Date(to + 'T23:59:59'))).map(mv => {
    const lot = byId(db.lots, mv.lotId), m = byId(db.materials, mv.materialId), b = byId(db.batches, mv.batchId);
    return {
      Data: new Date(mv.ts).toLocaleString('it-IT'), Tipo: mv.type, Articolo: m?.name || b?.recipeName || byId(db.recipes, mv.recipeId)?.name || '',
      Lotto: lot?.lotCode || (mv.itemKind === 'PF' ? b?.lotCode : '') || '', Quantità: mv.qty, UM: mv.unit,
      'Lotto produzione': mv.itemKind !== 'PF' ? b?.lotCode || '' : '', Ordine: byId(db.orders, mv.orderId)?.number || '',
      Cliente: byId(db.customers, mv.customerId)?.name || '', Operatore: mv.user || '', Dispositivo: mv.device || '', Note: mv.note || '',
    };
  });
}

export function consumptionRows(db, from, to) {
  const agg = {};
  for (const mv of db.movements) {
    if (mv.type !== 'scarico') continue;
    if (from && new Date(mv.ts) < new Date(from)) continue;
    if (to && new Date(mv.ts) > new Date(to + 'T23:59:59')) continue;
    const m = byId(db.materials, mv.materialId);
    const k = mv.materialId;
    agg[k] = agg[k] || { Codice: m?.code || '', Materia: m?.name || '?', UM: mv.unit, Consumo: 0, Prelievi: 0 };
    agg[k].Consumo = Math.round((agg[k].Consumo - Number(mv.qty)) * 1000) / 1000;
    agg[k].Prelievi++;
  }
  return Object.values(agg).sort((a, b) => b.Consumo - a.Consumo);
}

// ---------------- Backup ----------------
export async function makeBackup(db, { includeDocs = false, readFile } = {}) {
  const zip = new window.JSZip();
  const meta = { app: '5a-essenzia', format: 1, createdAt: new Date().toISOString(), counts: Object.fromEntries(COLLECTIONS.map(c => [c, Array.isArray(db[c]) ? db[c].length : 1])) };
  zip.file('backup.json', JSON.stringify(meta, null, 2));
  for (const c of COLLECTIONS) zip.file(`data/${c}.json`, JSON.stringify(db[c], null, 1));
  const missing = [];
  if (includeDocs && readFile) {
    for (const d of db.documents) {
      try { zip.file(`data/${d.path}`, await readFile(d.path)); } catch { missing.push(d.name); }
    }
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { blob, missing };
}

export async function readBackup(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    const j = JSON.parse(await file.text());
    return { data: normalizeDb(j.data || j), docs: [] };
  }
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  if (!zip.file('backup.json')) throw new Error('File di backup non valido (manca backup.json)');
  const data = {};
  for (const c of COLLECTIONS) {
    const f = zip.file(`data/${c}.json`);
    if (f) data[c] = JSON.parse(await f.async('string'));
  }
  const docs = [];
  for (const d of data.documents || []) {
    const f = zip.file(`data/${d.path}`);
    if (f) docs.push({ path: d.path, base64: await f.async('base64') });
  }
  return { data: normalizeDb(data), docs, meta: JSON.parse(await zip.file('backup.json').async('string')) };
}
