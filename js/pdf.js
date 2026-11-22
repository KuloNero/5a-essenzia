// Generazione PDF: etichette QR (rotolo o foglio A4) e Batch Record.
import { drawQrPdf, batchPayload } from './qr.js';
import { fmtDate, fmtNum, fmtQty, isoDate } from './util.js';
import { byId, planBatch, inciList } from './domain.js';

function jsPDF() {
  if (!window.jspdf) throw new Error('Libreria PDF non caricata');
  return window.jspdf.jsPDF;
}

// jsPDF standard font = WinAnsi: sostituisce i caratteri non supportati
const safe = s => String(s ?? '').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/[^\x20-\x7E\xA0-\xFF€\n]/g, '');

/**
 * items: [{payload, title, lines: [string], copies}]
 * format: 'small' | 'large' | 'sheet'
 */
export function labelsPdf(items, format, settings) {
  const J = jsPDF();
  const s = settings || {};
  const dims = format === 'large' ? (s.labelLarge || { w: 100, h: 70 }) : (s.labelSmall || { w: 50, h: 30 });
  if (format === 'sheet') return sheetPdf(J, items, s.sheet || { cols: 3, rows: 8, w: 70, h: 37 });
  const w = Number(dims.w), h = Number(dims.h);
  const doc = new J({ unit: 'mm', format: [w, h], orientation: w >= h ? 'landscape' : 'portrait', compress: true });
  let first = true;
  for (const it of items) {
    for (let c = 0; c < Math.max(1, Number(it.copies || 1)); c++) {
      if (!first) doc.addPage([w, h], w >= h ? 'landscape' : 'portrait');
      first = false;
      drawLabel(doc, it, 0, 0, w, h);
    }
  }
  return doc;
}

function sheetPdf(J, items, sh) {
  const doc = new J({ unit: 'mm', format: 'a4', compress: true });
  const cols = Number(sh.cols || 3), rows = Number(sh.rows || 8), w = Number(sh.w || 70), h = Number(sh.h || 37);
  const ml = Number(sh.marginLeft) || Math.max(0, (210 - cols * w) / 2);
  const mt = Number(sh.marginTop) || Math.max(0, (297 - rows * h) / 2);
  let i = Number(sh.skip || 0);
  for (const it of items) {
    for (let c = 0; c < Math.max(1, Number(it.copies || 1)); c++) {
      if (i > 0 && i % (cols * rows) === 0) doc.addPage();
      const k = i % (cols * rows);
      const x = ml + (k % cols) * w, y = mt + Math.floor(k / cols) * h;
      drawLabel(doc, it, x, y, w, h, sh.border);
      i++;
    }
  }
  return doc;
}

function drawLabel(doc, it, x, y, w, h, border) {
  const pad = Math.max(1.5, Math.min(w, h) * 0.06);
  const qr = Math.min(h - pad * 2, w * 0.45);
  if (border) { doc.setDrawColor(200); doc.rect(x + 0.3, y + 0.3, w - 0.6, h - 0.6); }
  drawQrPdf(doc, it.payload, x + pad, y + (h - qr) / 2, qr);
  const tx = x + pad * 2 + qr, tw = w - qr - pad * 3;
  let fs = Math.max(6, Math.min(12, h / 4.2));
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fs);
  let ty = y + pad + fs * 0.35;
  const titleLines = doc.splitTextToSize(safe(it.title), tw).slice(0, 2);
  doc.text(titleLines, tx, ty);
  ty += titleLines.length * fs * 0.4 + 0.6;
  doc.setFont('helvetica', 'normal');
  const small = Math.max(5, fs * 0.72);
  doc.setFontSize(small);
  const maxY = y + h - pad;
  for (const line of it.lines || []) {
    const parts = doc.splitTextToSize(safe(line), tw);
    for (const p of parts) {
      if (ty + small * 0.35 > maxY) return;
      doc.text(p, tx, ty);
      ty += small * 0.42;
    }
  }
}

// ---------------- Batch record ----------------

export function batchRecordPdf(db, batch) {
  const J = jsPDF();
  const doc = new J({ unit: 'mm', format: 'a4', compress: true });
  const st = db.settings;
  const recipe = byId(db.recipes, batch.recipeId) || {};
  const snap = { ...recipe, ...(batch.recipeSnapshot || {}) };
  const W = 210, M = 12;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(safe(st.companyName || ''), M, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(safe(st.companyAddress || ''), M, 19.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('SCHEDA DI LAVORAZIONE - BATCH RECORD', M, 28);
  drawQrPdf(doc, batchPayload(batch, recipe), W - M - 26, 8, 26);

  doc.autoTable({
    startY: 32, margin: { left: M, right: M + 30 }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 }, 2: { fontStyle: 'bold', cellWidth: 30 } },
    body: [
      ['Prodotto', safe(`${recipe.name || batch.recipeName} (${recipe.code || ''})`), 'Lotto', safe(batch.lotCode)],
      ['Versione formula', `v${batch.recipeVersion || 1}`, 'Tipo', snap.productType === 'rinse-off' ? 'Rinse-off' : 'Leave-on'],
      ['Data produzione', fmtDate(batch.producedAt), 'Scadenza', fmtDate(batch.expiry) + (batch.paoMonths ? `  PAO ${batch.paoMonths}M` : '')],
      ['Peso target', `${fmtNum(batch.targetWeight, 2)} g`, 'Unita previste', `${batch.unitsPlanned || Math.floor(batch.targetWeight / (batch.unitSize || 1))} x ${fmtNum(batch.unitSize, 2)} g`],
      ['Operatore', safe(batch.operator || ''), 'Stato', safe(batch.status)],
    ],
  });

  const plan = planBatch(db, snap, batch.targetWeight, isoDate());
  const picksBy = {};
  for (const p of batch.picks || []) (picksBy[p.materialId] = picksBy[p.materialId] || []).push(p);
  let y = doc.lastAutoTable.finalY + 4;
  for (const ph of plan.phases) {
    const body = ph.items.map(it => {
      const m = byId(db.materials, it.materialId) || {};
      const picks = picksBy[it.materialId] || [];
      const pl = plan.plan.find(p => p.phaseId === ph.id && p.materialId === it.materialId);
      const lots = picks.length
        ? picks.map(p => byId(db.lots, p.lotId)?.lotCode).join(', ')
        : (pl?.alloc || []).map(a => `(${a.lotCode})`).join(', ');
      const real = picks.length ? fmtNum(picks.reduce((s, p) => s + p.qty, 0), 2) : '';
      return [safe(m.name || '?'), safe(m.inci || (m.composition || []).map(c => c.inci).join(', ')), fmtNum(it.pct, 3), fmtNum(it.grams, 2), safe(lots), real, ''];
    });
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: [[{ content: safe(`${ph.name}${ph.temp ? ` - ${ph.temp}` : ''}`), colSpan: 7, styles: { fillColor: [47, 107, 79], halign: 'left' } }],
        ['Materia prima', 'INCI', '%', 'g teorici', 'Lotto MP', 'g reali', 'Visto']],
      body,
      styles: { fontSize: 8, cellPadding: 1.3, overflow: 'linebreak' },
      headStyles: { fillColor: [220, 226, 216], textColor: 20, fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 46 }, 2: { halign: 'right', cellWidth: 14 }, 3: { halign: 'right', cellWidth: 18 }, 4: { cellWidth: 30 }, 5: { cellWidth: 18 }, 6: { cellWidth: 12 } },
    });
    y = doc.lastAutoTable.finalY;
    if (ph.notes) {
      doc.setFontSize(8); doc.setFont('helvetica', 'italic');
      const t = doc.splitTextToSize(safe('Note: ' + ph.notes), W - 2 * M);
      if (y + t.length * 3.5 > 285) { doc.addPage(); y = 15; }
      doc.text(t, M, y + 4); y += t.length * 3.4 + 2;
      doc.setFont('helvetica', 'normal');
    }
    y += 3;
  }
  const totalG = plan.sumGrams;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text(`Totale: ${fmtNum(plan.totalPct, 3)} %  -  ${fmtNum(totalG, 2)} g`, M, y + 2);
  y += 6;

  if ((snap.packaging || []).length) {
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.3 },
      head: [['Packaging', 'q.ta / unita', 'Totale previsto', 'Lotto', 'Visto']],
      headStyles: { fillColor: [220, 226, 216], textColor: 20 },
      body: snap.packaging.map(p => {
        const m = byId(db.materials, p.materialId) || {};
        const used = (batch.packagingUsed || []).filter(u => u.materialId === p.materialId).map(u => byId(db.lots, u.lotId)?.lotCode).join(', ');
        const units = batch.unitsProduced || batch.unitsPlanned || Math.floor(batch.targetWeight / (batch.unitSize || 1));
        return [safe(m.name), fmtNum(p.qty, 2), fmtNum(p.qty * units, 0), safe(used), ''];
      }),
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  if (snap.processNotes || recipe.processNotes) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.text('Istruzioni operative', M, y + 2);
    doc.setFont('helvetica', 'normal');
    const t = doc.splitTextToSize(safe(snap.processNotes || recipe.processNotes), W - 2 * M);
    doc.text(t, M, y + 6); y += t.length * 3.6 + 8;
  }

  const qc = batch.qc || {};
  const spec = recipe.qcSpec || {};
  if (y > 225) { doc.addPage(); y = 15; }
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.8 },
    head: [['Controllo qualita', 'Specifica', 'Risultato', 'Conforme']],
    headStyles: { fillColor: [47, 107, 79] },
    body: [
      ['pH', safe(spec.ph || ''), safe(qc.ph ?? ''), ''],
      ['Viscosita', safe(spec.viscosity || ''), safe(qc.viscosity ?? ''), ''],
      ['Aspetto', safe(spec.aspect || ''), safe(qc.aspect ?? ''), ''],
      ['Colore', safe(spec.color || ''), safe(qc.color ?? ''), ''],
      ['Odore', safe(spec.odor || ''), safe(qc.odor ?? ''), ''],
      ['Peso finale (g)', '', safe(batch.actualWeight ?? ''), ''],
      ['Unita confezionate', '', safe(batch.unitsProduced || ''), ''],
      ['Note', { content: safe(qc.notes || ''), colSpan: 3 }],
    ],
  });
  y = doc.lastAutoTable.finalY + 10;
  if (y > 270) { doc.addPage(); y = 20; }
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
  const sig = ['Operatore produzione', 'Responsabile QC', 'Rilascio lotto (data / firma)'];
  sig.forEach((s, i) => {
    const x = M + i * ((W - 2 * M) / 3);
    doc.line(x, y + 8, x + 55, y + 8);
    doc.text(s, x, y + 12);
  });
  pageFooter(doc, `Batch record ${batch.lotCode} - generato il ${fmtDate(isoDate())} - Reg. (CE) 1223/2009, GMP ISO 22716`);
  return doc;
}

function pageFooter(doc, text) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(110);
    doc.text(safe(text), 12, 290);
    doc.text(`Pag. ${i}/${n}`, 198, 290, { align: 'right' });
    doc.setTextColor(0);
  }
}

// ---------------- Etichetta prodotto (testo legale) ----------------

export function productLabelPdf(db, recipe, batch, size = { w: 100, h: 70 }) {
  const J = jsPDF();
  const w = Number(size.w), h = Number(size.h);
  const doc = new J({ unit: 'mm', format: [w, h], orientation: w >= h ? 'landscape' : 'portrait' });
  const inci = inciList(recipe, db.materials);
  const pad = 3;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(doc.splitTextToSize(safe(recipe.name), w - 2 * pad - 18), pad, pad + 4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  let y = pad + 10;
  const block = (label, txt) => {
    const t = doc.splitTextToSize(safe(`${label}${txt}`), w - 2 * pad);
    doc.text(t, pad, y); y += t.length * 2.7 + 0.8;
  };
  if (recipe.labelDescription) block('', recipe.labelDescription);
  block('Ingredients: ', inci.text);
  if (recipe.labelWarnings) block('', recipe.labelWarnings);
  block('', `${recipe.nominalContent || (recipe.unitSize ? fmtNum(recipe.unitSize, 0) + ' g' : '')}   Lotto: ${batch?.lotCode || '________'}   ${batch?.expiry && !recipe.paoMonths ? 'Da usarsi preferibilmente entro: ' + fmtDate(batch.expiry) : ''}`);
  block('', `${db.settings.companyName || ''} ${db.settings.companyAddress || ''}`);
  if (recipe.paoMonths) {
    // simbolo PAO stilizzato
    const cx = w - pad - (batch ? 25 : 7), cy = h - pad - 6;
    doc.setDrawColor(0); doc.roundedRect(cx - 6, cy - 4, 12, 9, 1.5, 1.5);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold');
    doc.text(`${recipe.paoMonths}M`, cx, cy + 2, { align: 'center' });
  }
  if (batch) drawQrPdf(doc, batchPayload(batch, recipe), w - pad - 14, h - pad - 14, 14);
  return doc;
}

export function qtyLine(q, u) { return fmtQty(q, u); }
