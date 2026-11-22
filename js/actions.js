// Reducer delle azioni. Ogni modifica ai dati passa da qui come azione serializzabile
// {type, payload, meta}: così può essere ri-applicata su dati più recenti in caso di
// modifica concorrente da un altro dispositivo (merge automatico) o accodata offline.
import {
  DomainError, byId, checkWithdraw, fefoLots, nextLotCode, materialKind, normalizeDb,
  shelfLifeExpiry, allocateFefo, COLLECTIONS,
} from './domain.js';
import { round, isoDate, uid, clone } from './util.js';

const upsert = (arr, obj) => {
  const i = arr.findIndex(x => x.id === obj.id);
  if (i >= 0) arr[i] = { ...arr[i], ...obj };
  else arr.push(obj);
  return arr[i >= 0 ? i : arr.length - 1];
};

function need(v, msg) { if (v === undefined || v === null || v === '') throw new DomainError(msg); return v; }

function movement(db, meta, m) {
  const mv = {
    id: m.id || `${meta.id}-${db.movements.length}`,
    ts: meta.ts,
    user: meta.user || '',
    device: meta.device || '',
    ...m,
  };
  db.movements.push(mv);
  return mv;
}

function actionDate(meta) { return isoDate(new Date(meta.ts)); }

function doWithdraw(db, meta, { lotId, qty, batchId, note, overrideFefo, reason, kind = 'scarico', fefoPlanned }) {
  const onDate = actionDate(meta);
  const { errors, warnings, lot } = checkWithdraw(db, lotId, qty, onDate);
  if (errors.length) throw new DomainError(errors.join(' — '), 'withdraw');
  const fefo = fefoPlanned ? null : warnings.find(w => w.code === 'fefo');
  if (fefo && !overrideFefo) throw new DomainError(fefo.message + '. Confermare la deroga FEFO.', 'fefo');
  const q = round(Number(qty), 3);
  lot.qty = round(Number(lot.qty) - q, 3);
  const m = byId(db.materials, lot.materialId);
  let batch = null;
  if (batchId) {
    batch = byId(db.batches, batchId);
    if (!batch) throw new DomainError('Lotto di produzione non trovato');
    if (['completato', 'rilasciato', 'annullato'].includes(batch.status) && kind !== 'packaging') {
      throw new DomainError(`Il lotto di produzione ${batch.lotCode} è già ${batch.status}`);
    }
    if (batch.status === 'pianificato') batch.status = 'in-lavorazione';
  }
  const mv = movement(db, meta, {
    id: `${meta.id}-${lot.id}`,
    type: kind === 'packaging' ? 'scarico' : 'scarico',
    itemKind: materialKind(m),
    materialId: lot.materialId,
    lotId: lot.id,
    qty: -q,
    unit: lot.unit,
    batchId: batchId || null,
    note: [note, fefo ? `Deroga FEFO: ${reason || 'n.d.'}` : ''].filter(Boolean).join(' — '),
  });
  if (batch) {
    const entry = { movementId: mv.id, materialId: lot.materialId, lotId: lot.id, qty: q, ts: meta.ts, user: meta.user || '' };
    if (kind === 'packaging') (batch.packagingUsed = batch.packagingUsed || []).push(entry);
    else (batch.picks = batch.picks || []).push(entry);
  }
  return mv;
}

export const handlers = {
  'settings.update'(db, { patch }) {
    db.settings = { ...db.settings, ...patch };
    return ['settings'];
  },

  'supplier.upsert'(db, { supplier }) {
    need(supplier?.name, 'Nome fornitore obbligatorio');
    upsert(db.suppliers, { ...supplier, id: supplier.id || uid() });
    return ['suppliers'];
  },
  'supplier.delete'(db, { id }) {
    if (db.materials.some(m => m.supplierId === id) || db.lots.some(l => l.supplierId === id)) {
      throw new DomainError('Fornitore collegato a materie prime o lotti: impossibile eliminarlo');
    }
    db.suppliers = db.suppliers.filter(x => x.id !== id);
    return ['suppliers'];
  },

  'material.upsert'(db, { material }) {
    need(material?.name, 'Nome commerciale obbligatorio');
    const id = material.id || uid();
    if (material.code && db.materials.some(m => m.id !== id && m.code && m.code.toLowerCase() === material.code.toLowerCase())) {
      throw new DomainError(`Codice ${material.code} già usato da un'altra materia`);
    }
    upsert(db.materials, { unit: 'g', category: 'raw', allergens: [], composition: [], ...material, id });
    return ['materials'];
  },
  'material.delete'(db, { id }) {
    if (db.lots.some(l => l.materialId === id)) throw new DomainError('Esistono lotti di questa materia: archiviarla invece di eliminarla');
    if (db.recipes.some(r => (r.phases || []).some(p => (p.items || []).some(i => i.materialId === id)) || (r.packaging || []).some(p => p.materialId === id))) {
      throw new DomainError('Materia usata in una ricetta: impossibile eliminarla');
    }
    db.materials = db.materials.filter(x => x.id !== id);
    return ['materials'];
  },

  'customer.upsert'(db, { customer }) {
    need(customer?.name, 'Nome cliente obbligatorio');
    upsert(db.customers, { type: 'B2C', ...customer, id: customer.id || uid() });
    return ['customers'];
  },
  'customer.delete'(db, { id }) {
    if (db.orders.some(o => o.customerId === id)) throw new DomainError('Cliente con ordini: impossibile eliminarlo');
    db.customers = db.customers.filter(x => x.id !== id);
    return ['customers'];
  },

  'recipe.upsert'(db, { recipe }, meta) {
    need(recipe?.name, 'Nome prodotto obbligatorio');
    const id = recipe.id || uid();
    const prev = byId(db.recipes, id);
    const version = prev && recipe.bumpVersion ? Number(prev.version || 1) + 1 : Number(recipe.version || prev?.version || 1);
    const r = { ...recipe, id, version, updatedAt: meta.ts };
    delete r.bumpVersion;
    if (prev && recipe.bumpVersion) {
      r.history = [...(prev.history || []), { version: prev.version || 1, updatedAt: prev.updatedAt, phases: prev.phases, packaging: prev.packaging }].slice(-20);
    }
    upsert(db.recipes, r);
    return ['recipes'];
  },
  'recipe.delete'(db, { id }) {
    if (db.batches.some(b => b.recipeId === id)) throw new DomainError('Ricetta con lotti prodotti: archiviarla invece di eliminarla');
    db.recipes = db.recipes.filter(x => x.id !== id);
    return ['recipes'];
  },

  // --- Magazzino ---
  'lot.receive'(db, { lot }, meta) {
    const m = byId(db.materials, need(lot?.materialId, 'Materia prima obbligatoria'));
    if (!m) throw new DomainError('Materia prima non trovata');
    const qty = round(Number(lot.qty), 3);
    if (!(qty > 0)) throw new DomainError('Quantità ricevuta non valida');
    const id = lot.id || uid();
    if (byId(db.lots, id)) return []; // idempotente
    const onDate = actionDate(meta);
    const prefix = m.category === 'packaging' ? db.settings.pkLotPrefix : db.settings.mpLotPrefix;
    let lotCode = (lot.lotCode || '').trim();
    if (!lotCode || db.lots.some(l => l.lotCode === lotCode)) lotCode = nextLotCode(db.lots.map(l => l.lotCode), prefix, lot.receivedAt || onDate);
    const rec = {
      id, lotCode, materialId: m.id, unit: m.unit || 'g',
      supplierId: lot.supplierId || m.supplierId || '',
      supplierLot: lot.supplierLot || '',
      receivedAt: lot.receivedAt || onDate,
      productionDate: lot.productionDate || '',
      expiry: lot.expiry || '',
      qtyInitial: qty, qty,
      cost: lot.cost === '' || lot.cost === undefined ? '' : Number(lot.cost),
      status: lot.status || 'ok',
      ddt: lot.ddt || '',
      location: lot.location || '',
      note: lot.note || '',
      createdBy: meta.user || '',
    };
    db.lots.push(rec);
    movement(db, meta, { id: `${meta.id}-in`, type: 'carico', itemKind: materialKind(m), materialId: m.id, lotId: id, qty, unit: rec.unit, note: lot.note || '' });
    if (lot.updateMaterialCost && rec.cost !== '') { m.cost = rec.cost; return ['lots', 'movements', 'materials']; }
    return ['lots', 'movements'];
  },
  'lot.update'(db, { id, patch }, meta) {
    const lot = byId(db.lots, id);
    if (!lot) throw new DomainError('Lotto non trovato');
    const allowed = ['status', 'expiry', 'supplierLot', 'location', 'note', 'cost', 'ddt', 'productionDate', 'supplierId'];
    const changes = [];
    for (const k of allowed) if (k in patch && patch[k] !== lot[k]) { changes.push(`${k}: ${lot[k] ?? ''} → ${patch[k]}`); lot[k] = patch[k]; }
    if (!changes.length) return [];
    movement(db, meta, { id: `${meta.id}-upd`, type: 'modifica', itemKind: materialKind(byId(db.materials, lot.materialId)), materialId: lot.materialId, lotId: id, qty: 0, unit: lot.unit, note: changes.join('; ') + (patch.reason ? ` — ${patch.reason}` : '') });
    return ['lots', 'movements'];
  },
  'stock.withdraw'(db, p, meta) {
    doWithdraw(db, meta, p);
    return p.batchId ? ['lots', 'movements', 'batches'] : ['lots', 'movements'];
  },
  'stock.withdrawMany'(db, { items, batchId, note }, meta) {
    if (!items?.length) throw new DomainError('Nessun prelievo indicato');
    items.forEach((it, i) => doWithdraw(db, { ...meta, id: `${meta.id}-${i}` }, { ...it, batchId: it.batchId ?? batchId, note: it.note ?? note }));
    return ['lots', 'movements', 'batches'];
  },
  'stock.adjust'(db, { lotId, newQty, reason }, meta) {
    const lot = byId(db.lots, lotId);
    if (!lot) throw new DomainError('Lotto non trovato');
    need(reason, 'Motivo della rettifica obbligatorio');
    const nq = round(Number(newQty), 3);
    if (!(nq >= 0)) throw new DomainError('Giacenza non valida');
    const delta = round(nq - Number(lot.qty), 3);
    if (delta === 0) return [];
    lot.qty = nq;
    movement(db, meta, { id: `${meta.id}-adj`, type: 'rettifica', itemKind: materialKind(byId(db.materials, lot.materialId)), materialId: lot.materialId, lotId, qty: delta, unit: lot.unit, note: reason });
    return ['lots', 'movements'];
  },

  // --- Produzione ---
  'batch.create'(db, { batch }, meta) {
    const r = byId(db.recipes, need(batch?.recipeId, 'Ricetta obbligatoria'));
    if (!r) throw new DomainError('Ricetta non trovata');
    const id = batch.id || uid();
    if (byId(db.batches, id)) return [];
    const onDate = actionDate(meta);
    const producedAt = batch.producedAt || onDate;
    let lotCode = (batch.lotCode || '').trim();
    if (!lotCode || db.batches.some(b => b.lotCode === lotCode)) lotCode = nextLotCode(db.batches.map(b => b.lotCode), db.settings.pfLotPrefix, producedAt);
    const target = Number(batch.targetWeight);
    if (!(target > 0)) throw new DomainError('Peso target non valido');
    db.batches.push({
      id, lotCode, recipeId: r.id, recipeName: r.name, recipeVersion: r.version || 1,
      recipeSnapshot: clone({ phases: r.phases, packaging: r.packaging, unitSize: r.unitSize, productType: r.productType }),
      targetWeight: target, unitSize: Number(r.unitSize || 0),
      unitsPlanned: Number(batch.unitsPlanned || 0),
      unitsProduced: 0, unitsAvailable: 0,
      producedAt, expiry: batch.expiry || shelfLifeExpiry(producedAt, r.shelfLifeMonths),
      paoMonths: r.paoMonths || '',
      status: 'pianificato', picks: [], packagingUsed: [], qc: {},
      notes: batch.notes || '', operator: batch.operator || '', createdBy: meta.user || '', createdAt: meta.ts,
    });
    return ['batches'];
  },
  'batch.update'(db, { id, patch }) {
    const b = byId(db.batches, id);
    if (!b) throw new DomainError('Lotto di produzione non trovato');
    const allowed = ['notes', 'qc', 'expiry', 'producedAt', 'unitsPlanned', 'operator', 'processNotes', 'actualWeight'];
    for (const k of allowed) if (k in patch) b[k] = patch[k];
    return ['batches'];
  },
  'batch.complete'(db, { id, unitsProduced, actualWeight, consumePackaging = true }, meta) {
    const b = byId(db.batches, id);
    if (!b) throw new DomainError('Lotto di produzione non trovato');
    if (['completato', 'rilasciato', 'annullato'].includes(b.status)) throw new DomainError(`Lotto già ${b.status}`);
    const units = Math.floor(Number(unitsProduced));
    if (!(units >= 0)) throw new DomainError('Unità prodotte non valide');
    const onDate = actionDate(meta);
    const changed = new Set(['batches']);
    if (consumePackaging) {
      const items = [];
      for (const p of b.recipeSnapshot?.packaging || []) {
        const need = round(Number(p.qty || 0) * units, 3);
        if (need <= 0) continue;
        const { alloc, shortage } = allocateFefo(db, p.materialId, need, onDate);
        if (shortage > 0) {
          const m = byId(db.materials, p.materialId);
          throw new DomainError(`Packaging insufficiente: ${m?.name || p.materialId} (mancano ${shortage} ${m?.unit || 'pz'})`, 'shortage');
        }
        for (const a of alloc) items.push({ lotId: a.lotId, qty: a.qty });
      }
      items.forEach((it, i) => doWithdraw(db, { ...meta, id: `${meta.id}-pk${i}` }, { ...it, batchId: id, kind: 'packaging', fefoPlanned: true, note: 'Packaging da completamento lotto' }));
      if (items.length) { changed.add('lots'); changed.add('movements'); }
    }
    b.status = 'completato';
    b.unitsProduced = units;
    b.unitsAvailable = units;
    if (actualWeight) b.actualWeight = Number(actualWeight);
    b.completedAt = meta.ts;
    b.completedBy = meta.user || '';
    movement(db, meta, { id: `${meta.id}-pf`, type: 'produzione', itemKind: 'PF', recipeId: b.recipeId, batchId: id, qty: units, unit: 'pz', note: `Prodotte ${units} unità` });
    changed.add('movements');
    return [...changed];
  },
  'batch.release'(db, { id, outcome, note }, meta) {
    const b = byId(db.batches, id);
    if (!b) throw new DomainError('Lotto di produzione non trovato');
    if (b.status !== 'completato' && b.status !== 'rilasciato' && b.status !== 'respinto') throw new DomainError('Il lotto deve essere completato prima del rilascio');
    b.status = outcome === 'respinto' ? 'respinto' : 'rilasciato';
    b.qc = { ...(b.qc || {}), outcome: b.status, releasedBy: meta.user || '', releasedAt: meta.ts, releaseNote: note || '' };
    return ['batches'];
  },
  'batch.cancel'(db, { id, reason }, meta) {
    const b = byId(db.batches, id);
    if (!b) throw new DomainError('Lotto di produzione non trovato');
    if ((b.picks || []).length) throw new DomainError('Il lotto ha già prelievi registrati: non può essere annullato (usare rettifiche)');
    b.status = 'annullato';
    b.notes = [b.notes, `Annullato: ${reason || ''}`].filter(Boolean).join('\n');
    return ['batches'];
  },
  'batch.adjustUnits'(db, { id, newAvailable, reason }, meta) {
    const b = byId(db.batches, id);
    if (!b) throw new DomainError('Lotto di produzione non trovato');
    need(reason, 'Motivo obbligatorio');
    const n = Math.floor(Number(newAvailable));
    if (!(n >= 0)) throw new DomainError('Quantità non valida');
    const delta = n - Number(b.unitsAvailable || 0);
    if (!delta) return [];
    b.unitsAvailable = n;
    movement(db, meta, { id: `${meta.id}-pfadj`, type: 'rettifica', itemKind: 'PF', recipeId: b.recipeId, batchId: id, qty: delta, unit: 'pz', note: reason });
    return ['batches', 'movements'];
  },

  // --- Vendite ---
  'order.create'(db, { order }, meta) {
    const c = byId(db.customers, need(order?.customerId, 'Cliente obbligatorio'));
    if (!c) throw new DomainError('Cliente non trovato');
    if (!order.lines?.length) throw new DomainError("L'ordine non ha righe");
    const id = order.id || uid();
    if (byId(db.orders, id)) return [];
    const year = String(order.date || actionDate(meta)).slice(0, 4);
    const seq = db.orders.filter(o => String(o.number || '').startsWith(year)).length + 1;
    const number = `${year}-${String(seq).padStart(4, '0')}`;
    const lines = [];
    for (const [i, ln] of order.lines.entries()) {
      const r = byId(db.recipes, ln.recipeId);
      if (!r) throw new DomainError(`Riga ${i + 1}: prodotto non trovato`);
      let qty = Math.floor(Number(ln.qty));
      if (!(qty > 0)) throw new DomainError(`Riga ${i + 1}: quantità non valida`);
      const allocations = [];
      const candidates = ln.batchId ? [byId(db.batches, ln.batchId)].filter(Boolean)
        : db.batches.filter(b => b.recipeId === r.id && b.status === 'rilasciato' && b.unitsAvailable > 0)
          .sort((a, b) => (a.expiry || '9999') < (b.expiry || '9999') ? -1 : 1);
      for (const b of candidates) {
        if (qty <= 0) break;
        if (b.status !== 'rilasciato') throw new DomainError(`Lotto ${b.lotCode} non rilasciato dal controllo qualità`);
        const take = Math.min(qty, Number(b.unitsAvailable || 0));
        if (take <= 0) continue;
        b.unitsAvailable -= take;
        qty -= take;
        allocations.push({ batchId: b.id, lotCode: b.lotCode, qty: take });
        movement(db, meta, { id: `${meta.id}-${i}-${b.id}`, type: 'vendita', itemKind: 'PF', recipeId: r.id, batchId: b.id, qty: -take, unit: 'pz', orderId: id, customerId: c.id, note: `Ordine ${number}` });
      }
      if (qty > 0) throw new DomainError(`Riga ${i + 1} (${r.name}): disponibilità insufficiente, mancano ${qty} pz`, 'shortage');
      lines.push({ recipeId: r.id, name: r.name, qty: Number(ln.qty), price: Number(ln.price || 0), discountPct: Number(ln.discountPct || 0), allocations });
    }
    db.orders.push({
      id, number, customerId: c.id, channel: order.channel || c.type || 'B2C', date: order.date || actionDate(meta),
      status: 'confermato', lines, note: order.note || '', vatRate: Number(order.vatRate ?? db.settings.vatRate),
      pricesIncludeVat: !!order.pricesIncludeVat, createdBy: meta.user || '', createdAt: meta.ts,
    });
    return ['orders', 'batches', 'movements'];
  },
  'order.status'(db, { id, status }, meta) {
    const o = byId(db.orders, id);
    if (!o) throw new DomainError('Ordine non trovato');
    if (o.status === 'annullato') throw new DomainError('Ordine già annullato');
    if (status === 'annullato') {
      for (const [i, ln] of (o.lines || []).entries()) {
        for (const a of ln.allocations || []) {
          const b = byId(db.batches, a.batchId);
          if (b) b.unitsAvailable = Number(b.unitsAvailable || 0) + Number(a.qty);
          movement(db, meta, { id: `${meta.id}-${i}-${a.batchId}`, type: 'reso', itemKind: 'PF', recipeId: ln.recipeId, batchId: a.batchId, qty: Number(a.qty), unit: 'pz', orderId: id, customerId: o.customerId, note: `Annullo ordine ${o.number}` });
        }
      }
      o.status = 'annullato';
      return ['orders', 'batches', 'movements'];
    }
    o.status = status;
    return ['orders'];
  },

  // --- Documenti ---
  'doc.add'(db, { doc }, meta) {
    need(doc?.path, 'Percorso documento mancante');
    db.documents.push({ ...doc, id: doc.id || uid(), uploadedAt: meta.ts, uploadedBy: meta.user || '' });
    return ['documents'];
  },
  'doc.delete'(db, { id }) {
    const d = byId(db.documents, id);
    if (!d) return [];
    db.documents = db.documents.filter(x => x.id !== id);
    return ['documents'];
  },

  // --- Massivo ---
  'import.bulk'(db, { collection, rows, suppliers = [] }) {
    if (!['materials', 'suppliers', 'customers', 'recipes'].includes(collection)) throw new DomainError('Collezione non importabile');
    for (const s of suppliers) if (!byId(db.suppliers, s.id)) db.suppliers.push(s);
    for (const r of rows) upsert(db[collection], { ...r, id: r.id || uid() });
    return suppliers.length ? [collection, 'suppliers'] : [collection];
  },
  'db.restore'(db, { data }) {
    const n = normalizeDb(data);
    for (const c of COLLECTIONS) db[c] = n[c];
    return [...COLLECTIONS];
  },
};

export function applyAction(db, action) {
  const h = handlers[action.type];
  if (!h) throw new DomainError(`Azione sconosciuta: ${action.type}`);
  // idempotenza: se i movimenti di questa azione sono già presenti, l'azione è già stata applicata
  const mid = action.meta?.id;
  if (mid && db.movements.some(m => typeof m.id === 'string' && m.id.startsWith(mid + '-'))) return new Set();
  const changed = h(db, action.payload || {}, action.meta || { ts: Date.now(), id: uid() }) || [];
  return new Set(changed);
}

export function makeAction(type, payload, ctx = {}) {
  return { type, payload, meta: { id: uid(8), ts: Date.now(), user: ctx.user || '', device: ctx.device || '' } };
}

const LABELS = {
  'settings.update': 'Impostazioni', 'supplier.upsert': 'Fornitore', 'supplier.delete': 'Elimina fornitore',
  'material.upsert': 'Materia prima', 'material.delete': 'Elimina materia', 'customer.upsert': 'Cliente',
  'customer.delete': 'Elimina cliente', 'recipe.upsert': 'Ricetta', 'recipe.delete': 'Elimina ricetta',
  'lot.receive': 'Carico', 'lot.update': 'Modifica lotto', 'stock.withdraw': 'Scarico', 'stock.withdrawMany': 'Scarico multiplo',
  'stock.adjust': 'Rettifica', 'batch.create': 'Nuovo lotto produzione', 'batch.update': 'Aggiorna lotto produzione',
  'batch.complete': 'Completa lotto', 'batch.release': 'Rilascio QC', 'batch.cancel': 'Annulla lotto', 'batch.adjustUnits': 'Rettifica PF',
  'order.create': 'Ordine', 'order.status': 'Stato ordine', 'doc.add': 'Documento', 'doc.delete': 'Elimina documento',
  'import.bulk': 'Import', 'db.restore': 'Ripristino backup',
};

export function describeAction(action, db) {
  const p = action.payload || {};
  let detail = '';
  try {
    if (action.type === 'lot.receive') detail = byId(db.materials, p.lot?.materialId)?.name + ` ${p.lot?.qty}`;
    else if (action.type === 'stock.withdraw' || action.type === 'stock.adjust') { const l = byId(db.lots, p.lotId); detail = l?.lotCode + (p.qty ? ` -${p.qty}` : ` =${p.newQty}`); }
    else if (action.type === 'material.upsert') detail = p.material?.name;
    else if (action.type === 'recipe.upsert') detail = p.recipe?.name;
    else if (action.type.startsWith('batch.')) detail = byId(db.batches, p.id || p.batch?.id)?.lotCode || p.batch?.recipeId || '';
    else if (action.type === 'import.bulk') detail = `${p.collection} (${p.rows?.length})`;
  } catch { /* ignore */ }
  const who = [action.meta?.user, action.meta?.device].filter(Boolean).join('@');
  return `${LABELS[action.type] || action.type}${detail ? ': ' + detail : ''}${who ? ` [${who}]` : ''}`;
}

export { fefoLots };
