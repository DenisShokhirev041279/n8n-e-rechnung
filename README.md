# E-Rechnung with n8n — XRechnung, ZUGFeRD, Factur-X

Open n8n workflows for European e-invoices (EN 16931). No external API, no OCR service, no community node: the invoice XML is read, checked and rendered inside n8n with plain JavaScript, so invoice data stays on your own instance.

*Deutsche Fassung weiter unten.*

| Workflow | Status |
|---|---|
| [Process incoming e-invoices](incoming/) — read, check, deduplicate, forward to bookkeeping | available |
| [Create and send XRechnung](outgoing/) — from a form or JSON, validated with the official KoSIT validator | available |
| [Ask your invoices](ask/) — chat with the invoice archive in German or English, local AI model, numbers computed by code | available |

## Process incoming e-invoices

Since January 2025 every business in Germany has to be able to **receive** e-invoices; from 2027/2028 B2B e-invoicing becomes mandatory. France, Belgium and others use the same EN 16931 standard. In practice that means two annoying things: an XRechnung is an XML file nobody can read, and a ZUGFeRD / Factur-X PDF hides the actual data in an attachment.

**What the workflow does**

1. Takes PDF and XML attachments from an IMAP mailbox or an upload form.
2. Extracts the embedded XML from ZUGFeRD / Factur-X PDFs (PDF/A-3, decompressed in pure JS — works on n8n Cloud too).
3. Reads CII (ZUGFeRD 2.x, Factur-X, XRechnung CII), ZUGFeRD 1.0 and UBL (XRechnung UBL, Peppol) into one structure.
4. Checks plausibility: sum of lines, net + VAT = gross, VAT per rate, VAT breakdown, amount due, IBAN checksum, VAT ID format, mandatory fields, overdue date, credit notes.
5. Plain PDFs without XML go to a **local AI model (Ollama)** — or any chat model you allow — and are always marked for review.
6. Detects duplicates (seller + invoice number) and stores every invoice in an n8n Data Table.
7. Emails accounting only when something needs attention — with a **readable PDF** of every XRechnung attached.
8. Optionally forwards clean invoices to your bookkeeping inbox. DATEV Upload Mail does not accept XML, so XRechnungen are sent as the readable PDF.
9. Exports last month's invoices as CSV for your tax advisor (semicolon, decimal comma).

**Tested** against the official [ZUGFeRD / Factur-X corpus](https://github.com/ZUGFeRD/corpus) and the [KoSIT XRechnung test suite](https://github.com/itplr-kosit/xrechnung-testsuite) — 222 files, no parser errors, all 72 KoSIT invoices accepted — and end-to-end on n8n 2.43 (IMAP trigger, Data Table, AI fallback).

**Limits, honestly:** this is a plausibility check, not a full Schematron validation. Scanned PDFs without a text layer need OCR in front. The readable PDF is a view; the XML stays the legal original — keep it archived (GoBD).

**Set up** (about 10 minutes)

1. Import `incoming/process-incoming-e-invoices.json` into n8n (2.x; Data Tables required).
2. Run *Run once: create table* — it creates the `e_invoices` Data Table.
3. Add IMAP and SMTP credentials. Some hosts block outgoing SMTP (e.g. DigitalOcean) — then use the Gmail or Outlook node instead.
4. Fill in **Settings**: accounting address, sender, optional bookkeeping inbox, PDF language (`de` / `en`).
5. Optional: point *Local AI model* to your Ollama server, or delete the AI section.
6. Test with the upload form, then activate.

The logic of the Code nodes is also in `incoming/js/` as plain files, if you want to read or test it outside n8n.

## Create and send XRechnung

From 2027 (turnover above €800k) and 2028 (everyone else) German businesses must **send** B2B invoices as e-invoices; public authorities already require XRechnung today.

**What the workflow does**

1. Takes the invoice from an **n8n form** — lines as plain text, `Description; Quantity; Unit; Price; VAT %`, German number formats welcome — or as **JSON** from your CRM or shop via webhook.
2. Continues a **gapless invoice number** sequence (`RE-2026-0001`, …) kept in an n8n Data Table.
3. Builds an **XRechnung 3.0** (UN/CEFACT CII) with EN 16931 rounding and all German BR-DE fields: seller contact, electronic addresses, buyer reference / Leitweg-ID, SEPA payment, due date, delivery date, VAT exemption reasons — standard rates, small business under § 19 UStG, reverse charge, intra-EU supply.
4. **Reads its own XML back** with the incoming parser and re-checks every total; renders a readable PDF.
5. Emails the customer (XML + PDF) and optionally your bookkeeping inbox. Incomplete input never reaches the customer — you get an email listing what is missing.

**Validated** with the official [KoSIT validator](https://github.com/itplr-kosit/validator) 1.6.3 and the XRechnung 3.0.2 configuration (2026-08-31): all generated test invoices accepted without a single rule violation — standard 19 % / 7 %, public authority with Leitweg-ID, § 19 small business (with tax number only and with register number), reverse charge to Austria, awkward rounding. The XML files are in [`outgoing/examples/`](outgoing/examples/), next to the PDF view of each.

**Set up:** import `outgoing/create-xrechnung.json`, run *Run once: create table*, fill in your company data in **Settings**, add SMTP (or Gmail / Outlook) credentials, send yourself a test invoice through the form.

**Limits:** XRechnung (pure XML, CII syntax) only — no ZUGFeRD hybrid PDF, which would need PDF/A-3 with embedded fonts. Credit notes and allowances / charges on document level are not covered yet. Submit invoices one after another so the numbering stays gapless.

## Ask your invoices

A chat on top of the `e_invoices` table: *„Was hat uns Hetzner im Oktober in Rechnung gestellt?“*, *"Which invoices are overdue?"*, *„Was ist in den nächsten 14 Tagen fällig?“*.

Small local models are bad at arithmetic, so the model never adds anything up. It only turns the question into a filter (supplier, period, due dates, status, amount) and writes one or two sentences; the matching and all sums are done in JavaScript. Every reply shows the filter that was applied and the exact figures as a table, so a misunderstood question is visible immediately. Runs with Ollama (Llama 3.1 8B, Qwen 3 8B) or any chat model. Tested on n8n 2.43 with questions in German and English.

Limit: the table knows invoices and due dates, not payments — *overdue* means the due date has passed.

---

## Deutsch: Eingangsrechnungen mit n8n verarbeiten

Seit Januar 2025 muss jedes Unternehmen in Deutschland E-Rechnungen empfangen können. Das Problem kennt jeder, der schon eine XRechnung bekommen hat: Die Datei ist XML, lesen kann sie niemand, und bei ZUGFeRD steckt das Eigentliche als Anhang im PDF.

Der Workflow holt die Rechnungen aus dem Postfach oder über ein Upload-Formular, liest XRechnung, ZUGFeRD und Factur-X direkt in n8n aus – ohne externe API, die Daten bleiben auf der eigenen Instanz – und prüft, ob die Summen, die Umsatzsteuer je Satz, die IBAN und die Pflichtangaben zusammenpassen. Doppelt eingegangene Rechnungen fallen auf, bevor jemand zweimal zahlt.

An die Buchhaltung geht nur, was wirklich hingeschaut werden muss, und zwar mit einer lesbaren PDF-Ansicht jeder XRechnung. Saubere Rechnungen lassen sich automatisch an DATEV Upload Mail oder Lexware Office weiterleiten (DATEV nimmt dort kein XML an, deshalb die PDF-Ansicht). Einmal im Monat gibt es eine CSV für die Steuerberatung.

PDFs ohne E-Rechnungsdaten liest auf Wunsch ein lokales Sprachmodell über Ollama – gekennzeichnet zur Prüfung, nie stillschweigend übernommen.

Eine vollständige Schematron-Validierung ersetzt das nicht, und die XML-Datei bleibt das maßgebliche Original.

## Deutsch: XRechnung erstellen und versenden

Ab 2027 müssen Unternehmen mit mehr als 800.000 Euro Umsatz ihre B2B-Rechnungen als E-Rechnung verschicken, ab 2028 alle anderen auch. Behörden verlangen die XRechnung schon heute.

Der zweite Workflow nimmt die Rechnung aus einem n8n-Formular entgegen – Positionen einfach als Text, „Beratung; 6; Std; 95; 19“, gern mit deutschen Zahlen wie 1.234,50 – oder als JSON aus CRM und Shop. Die Rechnungsnummer läuft lückenlos weiter, die XRechnung 3.0 entsteht direkt in n8n samt Leitweg-ID, Kontaktangaben, SEPA-Daten und Leistungsdatum. Kleinunternehmer nach § 19 UStG und Reverse Charge sind abgedeckt.

Bevor etwas rausgeht, liest der Workflow seine eigene XML wieder ein und rechnet alles nach. Erst dann bekommt der Kunde XML und PDF. Fehlt eine Angabe, geht keine halbe Rechnung raus, sondern eine Nachricht an Sie, was noch fehlt.

Geprüft mit dem offiziellen KoSIT-Validator (XRechnung 3.0.2): alle Testrechnungen angenommen, ohne einen einzigen Regelverstoß. ZUGFeRD-Hybrid-PDFs erzeugt der Workflow nicht – das wäre PDF/A-3 mit eingebetteten Schriften und ein eigenes Projekt.

## Deutsch: Fragen an die eigenen Rechnungen

Der dritte Workflow ist ein Chat über das Rechnungsarchiv: „Was hat uns Hetzner im Oktober in Rechnung gestellt?“ oder „Welche Rechnungen müssen noch geprüft werden?“. Das Sprachmodell läuft lokal über Ollama und versteht nur die Frage – gerechnet wird im Code. Unter jeder Antwort stehen der angewendete Filter und die genauen Beträge, damit niemand einer erfundenen Zahl hinterherläuft.

---

MIT License. Built by **Denis Shokhirev** · [DennisCraft AI Studio](https://gerdennisai.com/de/), Freiburg im Breisgau — n8n automation and AI agents for small and mid-sized businesses ([n8n-Experte Freiburg](https://gerdennisai.com/de/n8n-experte-freiburg/)).
