// Dati di esempio (valori illustrativi, non usare per formulazioni reali).
import { uid, today, addMonths, addDays } from './util.js';

export async function loadDemo(app) {
  const S = { bio: uid(), pack: uid() };
  const suppliers = [
    { id: S.bio, name: 'Materie Prime Bio Srl (esempio)', email: 'ordini@esempio.it', qualified: true },
    { id: S.pack, name: 'Packaging Italia (esempio)', email: 'info@esempio.it' },
  ];
  const M = {};
  const mat = (key, o) => { M[key] = uid(); return { id: M[key], unit: 'g', category: 'raw', allergens: [], composition: [], supplierId: S.bio, ...o }; };
  const materials = [
    mat('aqua', { code: 'MP-001', name: 'Acqua demineralizzata', inci: 'Aqua', cost: 0.5, minStock: 10000, function: 'Solvente' }),
    mat('gly', { code: 'MP-002', name: 'Glicerina vegetale', inci: 'Glycerin', cas: '56-81-5', cost: 4.2, minStock: 2000, function: 'Umettante', bio: true }),
    mat('xan', { code: 'MP-003', name: 'Gomma xantana', inci: 'Xanthan Gum', cas: '11138-66-2', cost: 28, minStock: 200, function: 'Addensante' }),
    mat('alm', { code: 'MP-010', name: 'Olio di mandorle dolci bio', inci: 'Prunus Amygdalus Dulcis Oil', cas: '8007-69-0', cost: 12.5, minStock: 2000, function: 'Emolliente', bio: true }),
    mat('shea', { code: 'MP-011', name: 'Burro di karité', inci: 'Butyrospermum Parkii Butter', cas: '194043-92-0', cost: 15, minStock: 1000, function: 'Emolliente', bio: true }),
    mat('emu', { code: 'MP-020', name: 'Olivem 1000', composition: [{ inci: 'Cetearyl Olivate', pct: 50 }, { inci: 'Sorbitan Olivate', pct: 50 }], cost: 42, minStock: 500, function: 'Emulsionante' }),
    mat('vite', { code: 'MP-030', name: 'Vitamina E', inci: 'Tocopherol', cas: '59-02-9', cost: 60, minStock: 100, function: 'Antiossidante' }),
    mat('cons', { code: 'MP-031', name: 'Conservante DHA/BA', composition: [{ inci: 'Benzyl Alcohol', pct: 92 }, { inci: 'Dehydroacetic Acid', pct: 8 }], cost: 35, minStock: 200, function: 'Conservante', maxUse: '0,6–1%' }),
    mat('lav', { code: 'MP-040', name: 'Olio essenziale di lavanda', inci: 'Lavandula Angustifolia Oil', cas: '8000-28-0', cost: 95, minStock: 100, function: 'Profumo', bio: true,
      allergens: [{ name: 'Linalool', pct: 35 }, { name: 'Limonene', pct: 1 }, { name: 'Geraniol', pct: 0.5 }, { name: 'Coumarin', pct: 0.1 }] }),
    mat('jar', { code: 'PK-001', name: 'Vasetto vetro 50 ml', category: 'packaging', unit: 'pz', cost: 0.85, minStock: 100, supplierId: S.pack }),
    mat('cap', { code: 'PK-002', name: 'Tappo alluminio 50 ml', category: 'packaging', unit: 'pz', cost: 0.25, minStock: 100, supplierId: S.pack }),
    mat('box', { code: 'PK-003', name: 'Astuccio cartoncino', category: 'packaging', unit: 'pz', cost: 0.4, minStock: 100, supplierId: S.pack }),
  ];
  await app.dispatch('import.bulk', { collection: 'materials', rows: materials, suppliers });
  const recipe = {
    id: uid(), code: 'PF-001', name: 'Crema viso lavanda (esempio)', category: 'Crema viso', productType: 'leave-on', unitSize: 50, nominalContent: '50 ml',
    shelfLifeMonths: 24, paoMonths: 6, lossPct: 3, laborCost: 1.2, extraCost: 0.3, priceB2C: 24.9, priceB2B: 11.5,
    qcSpec: { ph: '5,0 – 5,8', viscosity: '8.000 – 15.000 cP', aspect: 'Emulsione bianca omogenea', color: 'Bianco', odor: 'Lavanda' },
    processNotes: 'Scaldare A e B separatamente a 75 °C. Versare B in A sotto agitazione (turbo 2 min). Raffreddare sotto agitazione lenta; sotto 40 °C aggiungere C. Controllare pH.',
    labelWarnings: 'Solo per uso esterno. Evitare il contatto con gli occhi.',
    phases: [
      { id: 'A', name: 'Fase A – acquosa', temp: '75 °C', items: [{ materialId: M.aqua, pct: 72.9, qs: true }, { materialId: M.gly, pct: 4 }, { materialId: M.xan, pct: 0.3 }] },
      { id: 'B', name: 'Fase B – oleosa', temp: '75 °C', items: [{ materialId: M.alm, pct: 12 }, { materialId: M.shea, pct: 4 }, { materialId: M.emu, pct: 5 }] },
      { id: 'C', name: 'Fase C – a freddo', temp: '< 40 °C', items: [{ materialId: M.vite, pct: 0.5 }, { materialId: M.cons, pct: 0.8 }, { materialId: M.lav, pct: 0.5 }] },
    ],
    packaging: [{ materialId: M.jar, qty: 1 }, { materialId: M.cap, qty: 1 }, { materialId: M.box, qty: 1 }],
  };
  await app.dispatch('recipe.upsert', { recipe });
  await app.dispatch('import.bulk', { collection: 'customers', rows: [
    { id: uid(), name: 'Cliente privato (esempio)', type: 'B2C', email: 'cliente@esempio.it' },
    { id: uid(), name: 'Erboristeria Verde (esempio)', type: 'B2B', discountPct: 0 },
  ] });
  const d = today();
  const lots = [
    ['aqua', 20000, addMonths(d, 12)], ['gly', 5000, addMonths(d, 24)], ['xan', 500, addMonths(d, 30)],
    ['alm', 3000, addMonths(d, 4)], ['alm', 3000, addMonths(d, 14)], ['shea', 2000, addMonths(d, 18)],
    ['emu', 1000, addMonths(d, 24)], ['vite', 250, addMonths(d, 12)], ['cons', 500, addMonths(d, 20)],
    ['lav', 200, addMonths(d, 36)], ['lav', 50, addDays(d, -10)],
    ['jar', 200, ''], ['cap', 200, ''], ['box', 250, ''],
  ];
  for (const [k, qty, expiry] of lots) {
    await app.dispatch('lot.receive', { lot: { id: uid(), materialId: M[k], qty, expiry, supplierLot: 'F' + Math.floor(Math.random() * 90000 + 10000), receivedAt: d } });
  }
}
