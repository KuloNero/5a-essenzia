// Logica di dominio pura: calcoli di formula, INCI, allergeni, FEFO, costi, tracciabilità.
import { round, normKey, parseISO, daysBetween, addMonths, isoDate, sortBy } from './util.js';
import { LEAVE_ON_THRESHOLD, RINSE_OFF_THRESHOLD } from './allergens.js';

export const COLLECTIONS = ['settings', 'suppliers', 'materials', 'lots', 'movements', 'recipes', 'batches', 'customers', 'orders', 'documents'];

export const DEFAULT_SETTINGS = {
  companyName: 'Il mio laboratorio',
  companyAddress: '',
  responsiblePerson: '',
  vatRate: 22,
  mpLotPrefix: 'MP',
  pkLotPrefix: 'PK',
  pfLotPrefix: 'L',
  expiryWarningDays: 60,
  labelSmall: { w: 50, h: 30 },
  labelLarge: { w: 100, h: 70 },
  sheet: { cols: 3, rows: 8, w: 70, h: 37, marginTop: 0, marginLeft: 0 },
  allergenDb: 'base+2023',
};

export function emptyDb() {
  const db = {};
  for (const c of COLLECTIONS) db[c] = c === 'settings' ? { ...DEFAULT_SETTINGS } : [];
  return db;
}

export function normalizeDb(db) {
  const out = emptyDb();
  for (const c of COLLECTIONS) {
    if (db && db[c] !== undefined) out[c] = db[c];
  }
  out.settings = { ...DEFAULT_SETTINGS, ...(out.settings || {}) };
  return out;
}

export class DomainError extends Error {
  constructor(msg, code = 'domain') { super(msg); this.code = code; this.domain = true; }
}

export const byId = (arr, id) => (arr || []).find(x => x.id === id);

// ---------------- Materie prime & lotti ----------------

export function materialKind(m) { return m?.category === 'packaging' ? 'PK' : 'MP'; }

export function costPerBaseUnit(m) {
  // cost: €/kg (g), €/L (ml), €/pz (pz)
  if (!m) return 0;
  const c = Number(m.cost || 0);
  return m.unit === 'pz' ? c : c / 1000;
}

export function lotCostPerBaseUnit(lot, m) {
  if (lot && lot.cost !== undefined && lot.cost !== null && lot.cost !== '') {
    const c = Number(lot.cost);
    return (m?.unit === 'pz') ? c : c / 1000;
  }
  return costPerBaseUnit(m);
}

export function isExpired(lot, onDate) {
  if (!lot?.expiry) return false;
  return lot.expiry < onDate;
}

export function lotState(lot, onDate, warnDays = 60) {
  if (lot.status === 'blocked') return 'blocked';
  if (lot.status === 'quarantine') return 'quarantine';
  if (isExpired(lot, onDate)) return 'expired';
  if (Number(lot.qty) <= 0) return 'empty';
  if (lot.expiry) {
    const d = daysBetween(onDate, lot.expiry);
    if (d !== null && d <= warnDays) return 'expiring';
  }
  return 'ok';
}

export function isUsable(lot, onDate) {
  return lot.status !== 'blocked' && lot.status !== 'quarantine' && !isExpired(lot, onDate) && Number(lot.qty) > 0;
}

/** Lotti utilizzabili di una materia, ordinati FEFO (scadenza più prossima prima, poi data di carico). */
export function fefoLots(db, materialId, onDate) {
  const lots = db.lots.filter(l => l.materialId === materialId && isUsable(l, onDate));
  return lots.sort((a, b) => {
    const ea = a.expiry || '9999-12-31', eb = b.expiry || '9999-12-31';
    if (ea !== eb) return ea < eb ? -1 : 1;
    return (a.receivedAt || '') < (b.receivedAt || '') ? -1 : 1;
  });
}

/** Verifica un prelievo: errori bloccanti e avvisi (FEFO). */
export function checkWithdraw(db, lotId, qty, onDate) {
  const lot = byId(db.lots, lotId);
  const errors = [], warnings = [];
  if (!lot) { errors.push('Lotto non trovato'); return { errors, warnings }; }
  if (lot.status === 'blocked') errors.push('Lotto BLOCCATO: prelievo non consentito');
  if (lot.status === 'quarantine') errors.push('Lotto in QUARANTENA: attendere il rilascio QC');
  if (isExpired(lot, onDate)) errors.push(`Lotto SCADUTO il ${lot.expiry}: prelievo bloccato`);
  if (!(Number(qty) > 0)) errors.push('Quantità non valida');
  if (Number(qty) > Number(lot.qty) + 1e-9) errors.push(`Quantità superiore alla giacenza (${round(lot.qty, 2)} ${lot.unit})`);
  const fefo = fefoLots(db, lot.materialId, onDate);
  const first = fefo[0];
  if (first && first.id !== lot.id && (first.expiry || '9999') < (lot.expiry || '9999')) {
    warnings.push({ code: 'fefo', lotId: first.id, message: `FEFO: il lotto ${first.lotCode} scade prima (${first.expiry})` });
  }
  return { errors, warnings, lot };
}

export function materialStock(db, materialId) {
  let qty = 0, usable = 0, value = 0;
  const m = byId(db.materials, materialId);
  const d = isoDate();
  for (const l of db.lots) {
    if (l.materialId !== materialId) continue;
    const q = Number(l.qty) || 0;
    qty += q;
    if (isUsable(l, d)) usable += q;
    value += q * lotCostPerBaseUnit(l, m);
  }
  return { qty: round(qty, 3), usable: round(usable, 3), value: round(value, 2) };
}

export function lowStock(db) {
  return db.materials
    .filter(m => !m.archived && Number(m.minStock) > 0)
    .map(m => ({ material: m, stock: materialStock(db, m.id) }))
    .filter(x => x.stock.usable < Number(x.material.minStock));
}

export function expiringLots(db, onDate, days) {
  return db.lots.filter(l => Number(l.qty) > 0 && l.expiry && l.status !== 'blocked')
    .map(l => ({ lot: l, days: daysBetween(onDate, l.expiry) }))
    .filter(x => x.days !== null && x.days <= days)
    .sort((a, b) => a.days - b.days);
}

export function nextLotCode(existingCodes, prefix, onDate) {
  const d = parseISO(onDate) || new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const base = `${prefix}${stamp}`;
  const set = new Set(existingCodes);
  for (let i = 1; i < 1000; i++) {
    const code = `${base}-${String(i).padStart(2, '0')}`;
    if (!set.has(code)) return code;
  }
  return `${base}-${Date.now() % 100000}`;
}

// ---------------- Formulazione ----------------

export function recipeItems(recipe) {
  const out = [];
  for (const ph of recipe?.phases || []) for (const it of ph.items || []) out.push({ ...it, phaseId: ph.id, phaseName: ph.name });
  return out;
}

export function recipeTotalPct(recipe) {
  return round(recipeItems(recipe).reduce((s, it) => s + Number(it.pct || 0), 0), 4);
}

/** Ricalcolo dei grammi per un peso target. */
export function scaleRecipe(recipe, targetWeight, decimals = 2) {
  const total = Number(targetWeight) || 0;
  const phases = (recipe?.phases || []).map(ph => ({
    ...ph,
    items: (ph.items || []).map(it => ({ ...it, grams: round(Number(it.pct || 0) / 100 * total, decimals) })),
  }));
  const sumGrams = round(phases.reduce((s, ph) => s + ph.items.reduce((a, it) => a + it.grams, 0), 0), decimals);
  const units = recipe?.unitSize > 0 ? Math.floor(total / Number(recipe.unitSize) + 1e-9) : 0;
  return { phases, totalPct: recipeTotalPct(recipe), sumGrams, targetWeight: total, units };
}

function compositionOf(m) {
  if (Array.isArray(m?.composition) && m.composition.length) {
    return m.composition.filter(c => c.inci).map(c => ({ inci: c.inci.trim(), pct: Number(c.pct || 0) }));
  }
  return m?.inci ? [{ inci: m.inci.trim(), pct: 100 }] : [];
}

/**
 * Genera la lista INCI del prodotto finito.
 * - ingredienti ≥ 1% in ordine decrescente, poi quelli < 1% (anch'essi decrescenti)
 * - allergeni dichiarati se superano la soglia (leave-on 0,001% / rinse-off 0,01%)
 */
export function inciList(recipe, materials) {
  const ingredients = new Map(); // key -> {inci, pct}
  const allergens = new Map();
  const warnings = [];
  for (const it of recipeItems(recipe)) {
    const m = materials.find(x => x.id === it.materialId);
    if (!m) { warnings.push(`Materia prima mancante nella formula`); continue; }
    const p = Number(it.pct || 0);
    const comp = compositionOf(m);
    if (!comp.length) warnings.push(`${m.name}: INCI non definito`);
    const compSum = comp.reduce((s, c) => s + c.pct, 0);
    if (comp.length && Math.abs(compSum - 100) > 0.5) warnings.push(`${m.name}: la composizione INCI somma ${round(compSum, 2)}%`);
    for (const c of comp) {
      const k = normKey(c.inci);
      const cur = ingredients.get(k) || { inci: c.inci, pct: 0 };
      cur.pct += p * c.pct / 100;
      ingredients.set(k, cur);
    }
    for (const a of m.allergens || []) {
      if (!a.name) continue;
      const k = normKey(a.name);
      const cur = allergens.get(k) || { name: a.name.trim(), pct: 0, sources: [] };
      cur.pct += p * Number(a.pct || 0) / 100;
      cur.sources.push(m.name);
      allergens.set(k, cur);
    }
  }
  const type = recipe?.productType === 'rinse-off' ? 'rinse-off' : 'leave-on';
  const threshold = type === 'rinse-off' ? RINSE_OFF_THRESHOLD : LEAVE_ON_THRESHOLD;
  const allergenRows = [...allergens.values()].map(a => ({ ...a, pct: round(a.pct, 6), declare: a.pct > threshold - 1e-12 }))
    .sort((a, b) => b.pct - a.pct);
  const entries = new Map();
  for (const [k, v] of ingredients) entries.set(k, { inci: v.inci, pct: v.pct, allergen: false });
  for (const a of allergenRows) {
    if (!a.declare) continue;
    const k = normKey(a.name);
    if (entries.has(k)) { const e = entries.get(k); e.pct += a.pct; e.allergen = true; }
    else entries.set(k, { inci: a.name, pct: a.pct, allergen: true });
  }
  const all = [...entries.values()].map(e => ({ ...e, pct: round(e.pct, 6) }));
  const above = all.filter(e => e.pct >= 1).sort((a, b) => b.pct - a.pct);
  const below = all.filter(e => e.pct < 1).sort((a, b) => b.pct - a.pct);
  const list = [...above, ...below];
  const total = recipeTotalPct(recipe);
  if (Math.abs(total - 100) > 0.001) warnings.push(`La formula somma ${total}% (deve essere 100%)`);
  return {
    list,
    text: list.map(e => e.inci).join(', '),
    allergens: allergenRows,
    threshold,
    type,
    warnings,
  };
}

// ---------------- Costificazione ----------------

export function recipeCost(recipe, db) {
  const unitSize = Number(recipe?.unitSize || 0);
  const lines = [];
  let raw = 0;
  for (const it of recipeItems(recipe)) {
    const m = byId(db.materials, it.materialId);
    const grams = Number(it.pct || 0) / 100 * unitSize;
    const c = grams * costPerBaseUnit(m);
    raw += c;
    lines.push({ kind: 'MP', material: m, qty: grams, cost: c });
  }
  const lossPct = Number(recipe?.lossPct || 0);
  const rawWithLoss = raw * (1 + lossPct / 100);
  let pack = 0;
  for (const p of recipe?.packaging || []) {
    const m = byId(db.materials, p.materialId);
    const c = Number(p.qty || 0) * costPerBaseUnit(m);
    pack += c;
    lines.push({ kind: 'PK', material: m, qty: Number(p.qty || 0), cost: c });
  }
  const labor = Number(recipe?.laborCost || 0);
  const extra = Number(recipe?.extraCost || 0);
  const total = rawWithLoss + pack + labor + extra;
  const perKg = unitSize > 0 ? raw / unitSize * 1000 : 0;
  return {
    lines,
    raw: round(raw, 4), rawWithLoss: round(rawWithLoss, 4), pack: round(pack, 4),
    labor: round(labor, 4), extra: round(extra, 4), total: round(total, 4), bulkPerKg: round(perKg, 2),
  };
}

export function priceAnalysis(cost, priceGross, vatRate, isGross = true) {
  const net = isGross ? Number(priceGross || 0) / (1 + Number(vatRate || 0) / 100) : Number(priceGross || 0);
  const margin = net - cost;
  return {
    net: round(net, 4),
    margin: round(margin, 4),
    marginPct: net > 0 ? round(margin / net * 100, 2) : 0,
    markup: cost > 0 ? round(net / cost, 2) : 0,
  };
}

export function priceForMargin(cost, marginPct, vatRate, gross = true) {
  const mp = Number(marginPct || 0) / 100;
  if (mp >= 1) return 0;
  const net = cost / (1 - mp);
  return round(gross ? net * (1 + Number(vatRate || 0) / 100) : net, 2);
}

// ---------------- Produzione ----------------

/** Piano di produzione con allocazione FEFO dei lotti (eventualmente su più lotti). */
export function planBatch(db, recipe, targetWeight, onDate) {
  const scaled = scaleRecipe(recipe, targetWeight);
  const plan = [];
  for (const ph of scaled.phases) {
    for (const it of ph.items) {
      const alloc = allocateFefo(db, it.materialId, it.grams, onDate);
      plan.push({ phaseId: ph.id, phaseName: ph.name, materialId: it.materialId, pct: Number(it.pct), qty: it.grams, alloc: alloc.alloc, shortage: alloc.shortage });
    }
  }
  return { ...scaled, plan };
}

export function allocateFefo(db, materialId, qty, onDate) {
  let remaining = Number(qty) || 0;
  const alloc = [];
  for (const l of fefoLots(db, materialId, onDate)) {
    if (remaining <= 1e-9) break;
    const take = Math.min(Number(l.qty), remaining);
    alloc.push({ lotId: l.id, lotCode: l.lotCode, expiry: l.expiry, qty: round(take, 3) });
    remaining -= take;
  }
  return { alloc, shortage: round(Math.max(0, remaining), 3) };
}

/** Quantità prelevate per materia in un lotto di produzione. */
export function batchPickedByMaterial(batch) {
  const out = {};
  for (const p of batch?.picks || []) out[p.materialId] = round((out[p.materialId] || 0) + Number(p.qty || 0), 3);
  return out;
}

// ---------------- Tracciabilità ----------------

/** Avanti: da un lotto di materia prima/packaging → lotti di prodotto → ordini → clienti. */
export function traceForward(db, lotId) {
  const batchIds = new Set();
  for (const b of db.batches) {
    if ((b.picks || []).some(p => p.lotId === lotId) || (b.packagingUsed || []).some(p => p.lotId === lotId)) batchIds.add(b.id);
  }
  const batches = db.batches.filter(b => batchIds.has(b.id)).map(b => ({ batch: b, ...traceBatchForward(db, b.id) }));
  return { lot: byId(db.lots, lotId), batches };
}

export function traceBatchForward(db, batchId) {
  const orders = [];
  for (const o of db.orders) {
    if (o.status === 'annullato') continue;
    const lines = (o.lines || []).filter(l => (l.allocations || []).some(a => a.batchId === batchId));
    if (!lines.length) continue;
    const units = lines.reduce((s, l) => s + (l.allocations || []).filter(a => a.batchId === batchId).reduce((x, a) => x + Number(a.qty), 0), 0);
    orders.push({ order: o, customer: byId(db.customers, o.customerId), units });
  }
  return { orders };
}

/** Indietro: da un lotto di prodotto finito → lotti MP e packaging → fornitori. */
export function traceBackward(db, batchId) {
  const b = byId(db.batches, batchId);
  if (!b) return null;
  const rows = [];
  const add = (p, kind) => {
    const lot = byId(db.lots, p.lotId);
    const m = byId(db.materials, p.materialId || lot?.materialId);
    const s = byId(db.suppliers, lot?.supplierId || m?.supplierId);
    const ex = rows.find(r => r.lotId === p.lotId);
    if (ex) ex.qty = round(ex.qty + Number(p.qty), 3);
    else rows.push({ kind, lotId: p.lotId, lot, material: m, supplier: s, qty: Number(p.qty) });
  };
  for (const p of b.picks || []) add(p, 'MP');
  for (const p of b.packagingUsed || []) add(p, 'PK');
  return { batch: b, recipe: byId(db.recipes, b.recipeId), rows };
}

export function findByCode(db, code) {
  const c = normKey(code);
  if (!c) return [];
  const res = [];
  for (const l of db.lots) if (normKey(l.lotCode) === c || normKey(l.supplierLot) === c || l.id === code) res.push({ type: 'lot', item: l });
  for (const b of db.batches) if (normKey(b.lotCode) === c || b.id === code) res.push({ type: 'batch', item: b });
  return res;
}

export function shelfLifeExpiry(producedAt, months) {
  return months ? addMonths(producedAt, months) : '';
}

export function sortedMaterials(db) {
  return sortBy(db.materials.filter(m => !m.archived), m => normKey(m.name));
}
