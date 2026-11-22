import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDb, scaleRecipe, inciList, recipeCost, priceAnalysis, priceForMargin, planBatch, traceBackward, traceForward, fefoLots } from '../js/domain.js';
import { applyAction, makeAction } from '../js/actions.js';
import { encodePayload, decodePayload } from '../js/qr.js';

const T0 = new Date('2026-11-10T10:00:00').getTime();
function act(db, type, payload, ts = T0) {
  const a = makeAction(type, payload, { user: 'test' });
  a.meta.ts = ts;
  return applyAction(db, a);
}

function seed() {
  const db = emptyDb();
  act(db, 'supplier.upsert', { supplier: { id: 's1', name: 'Fornitore Bio' } });
  act(db, 'material.upsert', { material: { id: 'aqua', name: 'Acqua demineralizzata', inci: 'Aqua', cost: 0.5 } });
  act(db, 'material.upsert', { material: { id: 'oil', name: 'Olio di mandorle', inci: 'Prunus Amygdalus Dulcis Oil', cost: 12, supplierId: 's1' } });
  act(db, 'material.upsert', { material: { id: 'emu', name: 'Olivem 1000', composition: [{ inci: 'Cetearyl Olivate', pct: 50 }, { inci: 'Sorbitan Olivate', pct: 50 }], cost: 40 } });
  act(db, 'material.upsert', { material: { id: 'lav', name: 'OE Lavanda', inci: 'Lavandula Angustifolia Oil', cost: 90, allergens: [{ name: 'Linalool', pct: 30 }, { name: 'Limonene', pct: 0.5 }, { name: 'Geraniol', pct: 0.002 }] } });
  act(db, 'material.upsert', { material: { id: 'jar', name: 'Vasetto 50ml', category: 'packaging', unit: 'pz', cost: 0.8 } });
  act(db, 'recipe.upsert', { recipe: { id: 'r1', name: 'Crema viso', productType: 'leave-on', unitSize: 50, shelfLifeMonths: 24, paoMonths: 6, laborCost: 1,
    packaging: [{ materialId: 'jar', qty: 1 }],
    phases: [
      { id: 'A', name: 'Fase A', items: [{ materialId: 'aqua', pct: 79.5 }] },
      { id: 'B', name: 'Fase B', items: [{ materialId: 'oil', pct: 15 }, { materialId: 'emu', pct: 5 }] },
      { id: 'C', name: 'Fase C', items: [{ materialId: 'lav', pct: 0.5 }] },
    ] } });
  return db;
}

test('scalatura formula', () => {
  const db = seed();
  const s = scaleRecipe(db.recipes[0], 1000);
  assert.equal(s.totalPct, 100);
  assert.equal(s.sumGrams, 1000);
  assert.equal(s.phases[1].items[0].grams, 150);
  assert.equal(s.units, 20);
});

test('INCI ordinato e allergeni sopra soglia', () => {
  const db = seed();
  const r = inciList(db.recipes[0], db.materials);
  assert.deepEqual(r.list.map(e => e.inci), ['Aqua', 'Prunus Amygdalus Dulcis Oil', 'Cetearyl Olivate', 'Sorbitan Olivate', 'Lavandula Angustifolia Oil', 'Linalool', 'Limonene']);
  const lin = r.allergens.find(a => a.name === 'Linalool');
  assert.equal(lin.pct, 0.15);
  assert.equal(r.allergens.find(a => a.name === 'Geraniol').declare, false); // 0.5*0.002/100 = 0.00001%
  // rinse-off: soglia 0,01% → limonene (0,0025%) non va dichiarato
  const r2 = inciList({ ...db.recipes[0], productType: 'rinse-off' }, db.materials);
  assert.ok(!r2.list.some(e => e.inci === 'Limonene'));
  assert.equal(r.warnings.length, 0);
});

test('costo industriale e margini', () => {
  const db = seed();
  const c = recipeCost(db.recipes[0], db);
  // aqua 39.75g*0.0005 + oil 7.5g*0.012 + emu 2.5g*0.04 + lav 0.25g*0.09 = 0.019875+0.09+0.1+0.0225
  assert.equal(c.raw, 0.2324);
  assert.equal(c.pack, 0.8);
  assert.equal(c.total, 2.0324);
  const p = priceAnalysis(c.total, 24.4, 22);
  assert.equal(p.net, 20);
  assert.equal(priceForMargin(10, 50, 22), 24.4);
});

test('carico, FEFO, blocco scaduti, produzione, vendita e tracciabilità', () => {
  const db = seed();
  act(db, 'lot.receive', { lot: { id: 'l1', materialId: 'oil', qty: 1000, expiry: '2027-06-30', supplierLot: 'S-A' } });
  act(db, 'lot.receive', { lot: { id: 'l2', materialId: 'oil', qty: 1000, expiry: '2027-01-31', supplierLot: 'S-B' } });
  act(db, 'lot.receive', { lot: { id: 'l3', materialId: 'oil', qty: 500, expiry: '2026-10-01' } }); // già scaduto
  for (const [id, mat] of [['a1', 'aqua'], ['e1', 'emu'], ['v1', 'lav']]) act(db, 'lot.receive', { lot: { id, materialId: mat, qty: 5000, expiry: '2028-01-01' } });
  act(db, 'lot.receive', { lot: { id: 'j1', materialId: 'jar', qty: 100 } });
  assert.equal(db.lots[0].lotCode, 'MP261110-01');
  assert.equal(db.lots[1].lotCode, 'MP261110-02');
  assert.deepEqual(fefoLots(db, 'oil', '2026-11-10').map(l => l.id), ['l2', 'l1']);

  assert.throws(() => act(db, 'stock.withdraw', { lotId: 'l3', qty: 10 }), /SCADUTO/);
  assert.throws(() => act(db, 'stock.withdraw', { lotId: 'l1', qty: 10 }), /FEFO/);
  assert.throws(() => act(db, 'stock.withdraw', { lotId: 'l2', qty: 5000 }), /giacenza/);

  act(db, 'batch.create', { batch: { id: 'b1', recipeId: 'r1', targetWeight: 1000 } });
  const b = db.batches[0];
  assert.equal(b.lotCode, 'L261110-01');
  assert.equal(b.expiry, '2028-11-10');
  const plan = planBatch(db, db.recipes[0], 1000, '2026-11-10');
  const oilPlan = plan.plan.find(p => p.materialId === 'oil');
  assert.deepEqual(oilPlan.alloc.map(a => [a.lotId, a.qty]), [['l2', 150]]);
  act(db, 'stock.withdrawMany', { batchId: 'b1', items: plan.plan.flatMap(p => p.alloc.map(a => ({ lotId: a.lotId, qty: a.qty }))) });
  assert.equal(db.lots.find(l => l.id === 'l2').qty, 850);
  assert.equal(b.status, 'in-lavorazione');
  act(db, 'stock.withdraw', { lotId: 'l1', qty: 5, batchId: 'b1', overrideFefo: true, reason: 'test' });
  assert.match(db.movements.at(-1).note, /Deroga FEFO/);

  act(db, 'batch.complete', { id: 'b1', unitsProduced: 20 });
  assert.equal(db.lots.find(l => l.id === 'j1').qty, 80);
  assert.throws(() => act(db, 'order.create', { order: { customerId: 'c1', lines: [{ recipeId: 'r1', qty: 2 }] } }), /Cliente/);
  act(db, 'customer.upsert', { customer: { id: 'c1', name: 'Mario Rossi' } });
  assert.throws(() => act(db, 'order.create', { order: { customerId: 'c1', lines: [{ recipeId: 'r1', qty: 2 }] } }), /insufficiente/); // non rilasciato
  act(db, 'batch.release', { id: 'b1', outcome: 'rilasciato' });
  act(db, 'order.create', { order: { id: 'o1', customerId: 'c1', lines: [{ recipeId: 'r1', qty: 3, price: 24.4 }] } });
  assert.equal(b.unitsAvailable, 17);
  assert.equal(db.orders[0].number, '2026-0001');

  const fw = traceForward(db, 'l2');
  assert.equal(fw.batches.length, 1);
  assert.equal(fw.batches[0].orders[0].customer.name, 'Mario Rossi');
  const fwJar = traceForward(db, 'j1');
  assert.equal(fwJar.batches[0].batch.id, 'b1');
  const bw = traceBackward(db, 'b1');
  assert.ok(bw.rows.some(r => r.lotId === 'l2' && r.supplier?.name === 'Fornitore Bio'));
  assert.ok(bw.rows.some(r => r.kind === 'PK' && r.qty === 20));

  act(db, 'order.status', { id: 'o1', status: 'annullato' });
  assert.equal(b.unitsAvailable, 20);
});

test('idempotenza: la stessa azione applicata due volte non duplica i movimenti', () => {
  const db = seed();
  act(db, 'lot.receive', { lot: { id: 'l1', materialId: 'oil', qty: 1000 } });
  const a = makeAction('stock.withdraw', { lotId: 'l1', qty: 100 });
  applyAction(db, a);
  applyAction(db, a);
  assert.equal(db.lots[0].qty, 900);
});

test('payload QR', () => {
  const p = { t: 'MP', id: 'abc123', code: 'MP-01', lot: 'MP261110-01', prod: '2026-11-10', exp: '2028-01-01', qty: 25000, unit: 'g' };
  const s = encodePayload(p);
  assert.match(s, /^ESZ1\|MP\|abc123\|/);
  const d = decodePayload(s);
  assert.deepEqual(d, { ...p, pao: '' });
  assert.deepEqual(decodePayload('XYZ-LOTTO-FORNITORE'), { raw: 'XYZ-LOTTO-FORNITORE' });
});
