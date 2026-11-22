# Librerie di terze parti (incluse per funzionamento offline, senza CDN)

| File | Libreria | Versione | Licenza |
|---|---|---|---|
| jspdf.umd.min.js | jsPDF | 4.2.1 | MIT |
| jspdf.plugin.autotable.min.js | jspdf-autotable | 5.0.9 | MIT |
| qrcode.js | qrcode-generator (Kazuhiko Arase) | 1.4.4 | MIT |
| jsQR.js | jsQR | 1.4.0 | Apache-2.0 |
| jszip.min.js | JSZip | 3.10.1 | MIT (dual MIT/GPLv3) |

La lettura/scrittura XLSX è implementata in `js/io.js` (su JSZip) per evitare la libreria SheetJS 0.18.x di npm, che ha vulnerabilità note senza correzione.
