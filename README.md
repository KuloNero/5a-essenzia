# 5a Essenzia — Gestionale per cosmetica naturale

Progressive Web App (PWA) per laboratori di cosmetica naturale: formulazione, lotti, magazzino con QR code, tracciabilità, costi e vendite. Si usa dal browser del **PC** (formulazione, documenti, etichette, report, backup) e si installa sullo **smartphone** (scansione QR, carico/scarico magazzino, pesate di produzione).

I dati vengono salvati come file JSON in un **repository GitHub** (consigliato privato). Ogni operazione è un commit: avete lo storico completo di chi ha fatto cosa e quando (audit trail GMP), e 2–3 dispositivi possono lavorare in contemporanea.

> Supporto alla conformità al Reg. (CE) 1223/2009 e alle GMP ISO 22716. Il software è uno strumento di lavoro: non sostituisce la valutazione della sicurezza né la verifica normativa (in particolare l'elenco allergeni aggiornato dal Reg. UE 2023/1545).

## Funzioni

**Ricettario e conformità (R&D / PIF)**
- Ricette multi-fase (A acquosa, B oleosa, C a freddo…) con temperature e note operative; ingrediente "q.b. a 100"; versionamento (i lotti prodotti conservano la formula usata).
- Ricalcolo dei grammi per peso target o numero di unità (con calo di lavorazione) e verifica disponibilità.
- Anagrafica materie prime: nome commerciale, INCI, CAS/EC, fornitore, funzione, composizione INCI per le miscele, allergeni contenuti (% nella materia), scorta minima, costo.
- Generatore lista INCI: ordine decrescente, ingredienti < 1% in coda, allergeni dichiarati sopra soglia (0,001% leave-on, 0,01% rinse-off) con tabella delle concentrazioni.
- Documenti allegati (TDS, SDS, CoA per lotto, certificati Bio/IFRA, documenti PIF), salvati nel repository.
- Batch Record in PDF: pesate teoriche, lotti FEFO proposti o usati, spazio per pesate reali, controlli qualità (pH, viscosità, aspetto…), firme.

**Etichette QR**
- Payload strutturato: `ESZ1|tipo|idLotto|codice|lotto|produzione|scadenza|PAO|quantità|UM` (tipo MP / PK / PF).
- PDF per stampanti a rotolo (formato piccolo per flaconi, grande per fusti/scaffali; una etichetta per pagina) o fogli A4 adesivi a griglia configurabile, con copie in serie.
- Etichetta prodotto con lista INCI, avvertenze, lotto, PAO.

**Magazzino e tracciabilità**
- FEFO: proposta automatica del lotto che scade prima; prelievo da un altro lotto solo con motivazione registrata. **Blocco** dei lotti scaduti, in quarantena o bloccati.
- Da smartphone: carico merce con stampa/condivisione immediata dell'etichetta; scansione QR → scheda lotto con giacenza, scadenza, storico; prelievo in grammi associato al lotto di produzione; rettifiche motivate; modalità "pesate con scansione" che guida l'operatore ingrediente per ingrediente.
- Completamento produzione con scarico automatico del packaging (FEFO), controlli qualità e rilascio del lotto.
- Tracciabilità bidirezionale: materia prima/packaging → lotti prodotto → ordini → clienti, e viceversa; export CSV dei clienti coinvolti per un eventuale richiamo.

**Costi e vendite**
- Costo industriale per unità: materie prime (+ calo), packaging, manodopera e altri costi.
- Listini B2C (IVA inclusa) e B2B (IVA esclusa), margini e ricarichi, prezzi suggeriti per margine obiettivo.
- Clienti, ordini con assegnazione automatica (FEFO) o manuale dei lotti di prodotto finito.

**Dati**
- Import CSV/XLSX di materie prime, fornitori, clienti e listini, con anteprima di errori e duplicati e modelli scaricabili.
- Report XLSX/CSV: inventario lotti, giacenze, movimenti, consumi.
- Backup compresso (.zip, con o senza documenti) e ripristino. Lo storico Git è un ulteriore backup.
- Funziona anche offline: ogni dispositivo tiene una **copia locale completa** (dati e documenti allegati, scaricati in background a ogni sincronizzazione); le operazioni, compresi gli allegati caricati, vengono accodate e sincronizzate al ritorno della rete.
- **Sincronizzazione in background** (Chrome/Edge su Android e desktop): quando torna la rete la coda viene caricata dal service worker anche se l'app è chiusa. Su iPhone/Safari e Firefox questa API non esiste: la coda parte alla successiva apertura dell'app.

## Come funziona la sincronizzazione

- Ogni dispositivo legge i file `data/*.json` del repository dati e scrive con un **commit atomico** per operazione (Git Data API).
- Se due dispositivi scrivono insieme, il secondo riceve un conflitto: l'app ricarica i dati aggiornati e **ri-applica l'operazione** ricontrollando le regole (es. giacenza sufficiente, lotto non scaduto). Nessuna modifica viene persa o sovrascritta.
- Ogni 20 secondi (e quando l'app torna in primo piano) viene controllato se ci sono modifiche da altri dispositivi.
- Il messaggio di commit riporta operazione, operatore e dispositivo.

## Installazione

### 1. Repository dati (privato)
1. Su GitHub crea un repository **privato**, ad esempio `essenzia-dati` (può essere vuoto).
2. Crea un [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - *Repository access* → *Only select repositories* → il repository dati;
   - *Permissions* → *Contents: Read and write*;
   - imposta una scadenza (andrà rinnovato).
   Meglio un token per dispositivo, così puoi revocarne uno singolarmente.

### 2. Pubblicare l'app
L'app è statica (HTML/JS, nessun server). Opzioni:
- **GitHub Pages** da questo repository: *Settings → Pages → Source: GitHub Actions*. Il workflow `.github/workflows/pages.yml` esegue i test e pubblica a ogni push su `main`. (Pages su repository privati richiede un piano GitHub a pagamento; il codice dell'app non contiene dati né segreti, quindi può restare pubblico.)
- In alternativa qualsiasi hosting statico HTTPS (Netlify, Cloudflare Pages…), oppure in locale con `npm run serve` (fotocamera disponibile solo su `localhost` o HTTPS).

### 3. Primo avvio su ogni dispositivo
Apri l'URL dell'app, inserisci proprietario, nome del repository dati, token, nome operatore e nome dispositivo → *Verifica e collega*.
Sul telefono: dal PC già configurato vai in *Impostazioni → Collega un altro dispositivo* e scansiona il QR dalla schermata iniziale del telefono (il QR contiene il token: non condividerlo). Poi dal menu del browser *Installa app / Aggiungi a schermata Home*.

Per provare senza GitHub: *Usa in modalità locale* e poi *Impostazioni → Carica dati di esempio*.

## Flusso tipico

1. **PC**: anagrafica fornitori e materie prime (anche via import), ricetta con fasi e packaging.
2. **Smartphone**: arriva la merce → *Carico* → stampa/condividi l'etichetta QR e applicala al contenitore; allega il CoA.
3. **PC**: *Produzione → Nuovo lotto* (peso o unità) → stampa il Batch Record.
4. **Smartphone in laboratorio**: *Pesate con scansione*: scansiona ogni contenitore, conferma i grammi pesati (FEFO e scadenze verificati automaticamente).
5. **PC/smartphone**: *Completa produzione* (scarico packaging), controlli qualità, *Rilascia lotto*, etichette del prodotto finito.
6. **Vendite**: ordine con assegnazione dei lotti → tracciabilità fino al cliente.

## Struttura

```
index.html, manifest.webmanifest          PWA
sw.js / sw-shell.js / sw-classic.js       service worker: cache offline + sync in background (js/bgsync.js)
css/app.css                               stile (chiaro/scuro, mobile-first)
js/domain.js                              logica pura: formule, INCI/allergeni, FEFO, costi, tracciabilità
js/actions.js                             tutte le modifiche ai dati (reducer di azioni serializzabili)
js/store.js, js/backends.js               sincronizzazione GitHub / locale, coda offline, conflitti
js/qr.js, js/scanner.js, js/pdf.js        QR, fotocamera, PDF
js/io.js                                  CSV/XLSX, report, backup
js/views/*                                schermate
vendor/                                   librerie di terze parti (vedi vendor/README.md)
tests/                                    test (node --test), incluso un finto server GitHub per la concorrenza
```

Dati nel repository dati: `data/{settings,suppliers,materials,lots,movements,recipes,batches,customers,orders,documents}.json` e `data/docs/…` per gli allegati.

## Sviluppo

```bash
npm test          # test di dominio, sincronizzazione e concorrenza
npm run serve     # http://localhost:8080
```

Nessuna dipendenza da installare né build. Quando modifichi i file dell'app, aggiorna `VERSION` in `sw-shell.js` (e la lista `SHELL` se aggiungi file).
