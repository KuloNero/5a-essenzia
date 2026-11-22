// Payload QR strutturato e rendering.
// Formato (compatto, leggibile da qualunque lettore QR):
//   ESZ1|<tipo>|<idLotto>|<codiceArticolo>|<codiceLotto>|<produzione AAAAMMGG>|<scadenza AAAAMMGG>|<PAO mesi>|<quantità>|<UM>
// tipo: MP = materia prima, PK = packaging, PF = prodotto finito

const PREFIX = 'ESZ1';
const clean = v => String(v ?? '').replace(/[|\r\n]/g, '/').trim();
const d8 = iso => (iso ? String(iso).slice(0, 10).replace(/-/g, '') : '');
const iso = d => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '');

export function encodePayload(p) {
  return [PREFIX, clean(p.t), clean(p.id), clean(p.code), clean(p.lot), d8(p.prod), d8(p.exp), clean(p.pao), p.qty ?? '', clean(p.unit)].join('|');
}

export function decodePayload(text) {
  const s = String(text || '').trim();
  if (!s.startsWith(PREFIX + '|')) return { raw: s };
  const f = s.split('|');
  return {
    t: f[1] || '', id: f[2] || '', code: f[3] || '', lot: f[4] || '',
    prod: iso(f[5] || ''), exp: iso(f[6] || ''), pao: f[7] || '',
    qty: f[8] === '' || f[8] === undefined ? '' : Number(f[8]), unit: f[9] || '',
  };
}

export function lotPayload(lot, material) {
  return encodePayload({
    t: material?.category === 'packaging' ? 'PK' : 'MP', id: lot.id, code: material?.code || material?.name || '',
    lot: lot.lotCode, prod: lot.productionDate || lot.receivedAt, exp: lot.expiry, pao: '', qty: lot.qtyInitial, unit: lot.unit,
  });
}

export function batchPayload(batch, recipe) {
  return encodePayload({
    t: 'PF', id: batch.id, code: recipe?.code || recipe?.name || batch.recipeName || '', lot: batch.lotCode,
    prod: batch.producedAt, exp: batch.expiry, pao: batch.paoMonths ? `${batch.paoMonths}M` : '',
    qty: recipe?.unitSize || batch.unitSize || '', unit: recipe?.unitLabel || 'g',
  });
}

/** Matrice dei moduli QR (richiede vendor/qrcode.js). */
export function qrMatrix(text, ecc = 'M') {
  const qr = globalThis.qrcode(0, ecc);
  qr.addData(unescape(encodeURIComponent(text)), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(qr.isDark(r, c)); rows.push(row); }
  return rows;
}

export function qrSvg(text, size = 160, ecc = 'M') {
  const m = qrMatrix(text, ecc);
  const n = m.length, q = 2, tot = n + q * 2;
  let d = '';
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + q} ${r + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tot} ${tot}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${tot}" height="${tot}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Disegna il QR come vettoriale in un documento jsPDF (nitido in stampa). */
export function drawQrPdf(doc, text, x, y, size, ecc = 'M') {
  const m = qrMatrix(text, ecc);
  const n = m.length;
  const cell = size / n;
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m[r][c]) { c++; continue; }
      let e = c; while (e < n && m[r][e]) e++;
      doc.rect(x + c * cell, y + r * cell, (e - c) * cell + 0.01, cell + 0.01, 'F');
      c = e;
    }
  }
}
