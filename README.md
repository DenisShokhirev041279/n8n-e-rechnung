# E-Rechnung with n8n — XRechnung, ZUGFeRD, Factur-X

Open n8n workflows for European e-invoices (EN 16931). No external API, no OCR service, no community node: the invoice XML is read, checked and rendered inside n8n with plain JavaScript, so invoice data stays on your own instance.

*Deutsche Fassung weiter unten.*

| Workflow | Status |
|---|---|
| [Process incoming e-invoices](incoming/) — read, check, catch changed bank details, approve by e-mail / WhatsApp / Telegram, forward to bookkeeping | available |
| [Create and send XRechnung](outgoing/) — from a form or JSON, validated with the official KoSIT validator | available |
| [Ask your invoices](ask/) — chat with the invoice archive in German or English, local AI model, numbers computed by code | available |

## Process incoming e-invoices

Since January 2025 every business in Germany has to be able to **receive** e-invoices; from 2027/2028 B2B e-invoicing becomes mandatory. France, Belgium and others use the same EN 16931 standard. In practice that means two annoying things: an XRechnung is an XML file nobody can read, and a ZUGFeRD / Factur-X PDF hides the actual data in an attachment.

The workflow is built for the day-to-day of a small business: nothing gets paid that a person has not seen, and nothing disappears quietly.

**What the workflow does**

1. Takes invoices from an IMAP mailbox or an upload form. PDF and XML are recognised by content (also without a file extension), **ZIP archives are unpacked**. A mail without any invoice file — usually a link to a supplier portal — is reported to accounting with the links found in it.
2. Extracts the embedded XML from ZUGFeRD / Factur-X PDFs (PDF/A-3, decompressed in pure JS — works on n8n Cloud too).
3. Reads CII (ZUGFeRD 2.x, Factur-X, XRechnung CII), ZUGFeRD 1.0 and UBL (XRechnung UBL, Peppol) into one structure.
4. Checks plausibility: line sums, net + VAT = gross, VAT per rate and category, amount due vs. gross, negative or implausible amounts, IBAN checksum, VAT ID format, mandatory fields, due date, credit notes.
5. Plain PDFs without XML go to a **local AI model (Ollama)** — or any chat model you allow — and are always marked for review. Scans without a text layer, broken PDFs and an unreachable model go straight to a person.
6. Detects duplicates (seller + invoice number, or the identical file — also inside one mail, e.g. XML and PDF of the same invoice) and stores every invoice in an n8n Data Table.
7. **Supplier check against earlier invoices:** an IBAN this supplier never used before stops the invoice — changed bank details are the classic invoice fraud. A different sender domain, a different VAT ID under the same name and the first invoice of a new supplier are noted.
8. **Approval before payment** by e-mail, **WhatsApp** or Telegram with *Freigeben / Ablehnen* buttons, from an amount you choose (invoices in another currency always ask). No answer within the wait time → accounting is told; nothing waits forever.
9. Approved invoices go to your bookkeeping inbox (DATEV Upload Mail, Lexware Office, …) as the readable PDF; everything that needs a look goes to accounting with the original and a readable PDF.
10. If a step fails for good (after 3 retries), an **error mail** names the step and the time window — IMAP has already marked those mails as read, so otherwise nobody would notice.
11. Exports last month's invoices as CSV for your tax advisor (semicolon, decimal comma).

All texts — problems, mails, the approval request — are in German or English (`invoiceViewLanguage`).

**Tested** against the official [ZUGFeRD / Factur-X corpus](https://github.com/ZUGFeRD/corpus) and the [KoSIT XRechnung test suite](https://github.com/itplr-kosit/xrechnung-testsuite) — 330 files, all 284 invoices read without parser errors — and end-to-end on n8n 2.43 with the failure cases that matter in real life: changed IBAN, fake invoice without VAT ID, ZIP, portal link, scan, model down, same file name from two suppliers, XML + PDF of one invoice, non-invoice XML, duplicate, approved / declined / no answer, amount threshold, a broken table step. The code was additionally reviewed by a second AI model; its findings and what was fixed are listed in the repository history.

**Limits, honestly:** this is a plausibility check, not a full Schematron validation. Scanned PDFs need OCR in front. The readable PDF is a view; the XML stays the legal original — keep it archived (GoBD). WhatsApp only delivers a free-text approval request if the approver wrote to your business number within the last 24 hours (Meta rule) — otherwise the request runs into the wait time and accounting is told.

**DATEV Upload Mail, where forwarding usually breaks:** it takes PDF and TIF only, up to 20 MB and 10 documents per mail, and only from a sender address you have confirmed in DATEV. A forwarding rule in your mail client often keeps the original sender and gets rejected. That is why the workflow sends each invoice as its own mail from the *sender* in **Settings** — put your confirmed DATEV address there. If you switch to the Gmail or Outlook node, send from that same address. (Thanks to Anton Brinckmann for the hint in the [n8n community](https://community.n8n.io/t/reading-xrechnung-and-zugferd-invoices-in-n8n-without-any-external-api-open-workflow/326217).)

**Set up** (about 15 minutes)

1. Import `incoming/process-incoming-e-invoices.json` into n8n (2.x; Data Tables required).
2. Run *Run once: create table* — it creates the `e_invoices` Data Table.
3. Add IMAP and SMTP credentials. Some hosts block outgoing SMTP (e.g. DigitalOcean) — then use the Gmail or Outlook node instead.
4. Fill in **Settings**: accounting address, sender, optional bookkeeping inbox, language (`de` / `en`), approval channel (`email`, `whatsapp`, `telegram` or `none`), approver, amount and wait time. For WhatsApp or Telegram, add those credentials to *Ask on WhatsApp* / *Ask on Telegram*.
5. Optional: point *Local AI model* to your Ollama server, or delete the AI section.
6. Test with the upload form, then **activate** — and only then open *Workflow settings → Error workflow* and select this same workflow (n8n only offers workflows that are already published). Set the addresses in *Failure settings*.

To accept a supplier's new bank account after you confirmed it by phone, set `ibanConfirmed` to `yes` on that row in the Data Table.

**Upgrading from the first version:** the table has new columns (`fileHash`, `previousIban`, `ibanConfirmed`, `approval`, `approvalAt`) — add them to `e_invoices` or create the table again.

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

An die Buchhaltung geht nur, was wirklich hingeschaut werden muss, und zwar mit einer lesbaren PDF-Ansicht jeder XRechnung. Saubere Rechnungen lassen sich automatisch an DATEV Upload Mail oder Lexware Office weiterleiten (DATEV nimmt dort kein XML an, deshalb die PDF-Ansicht). Jede Rechnung geht als eigene Mail vom Absender aus den Settings raus – das muss die in DATEV bestätigte Adresse sein, sonst lehnt Upload Mail ab. Einmal im Monat gibt es eine CSV für die Steuerberatung.

PDFs ohne E-Rechnungsdaten liest auf Wunsch ein lokales Sprachmodell über Ollama – gekennzeichnet zur Prüfung, nie stillschweigend übernommen.

Neu ist der Teil, der im Alltag am meisten Geld spart. Der Workflow vergleicht jede Rechnung mit den früheren desselben Lieferanten: Taucht eine IBAN auf, die dieser Lieferant noch nie benutzt hat, wird nichts bezahlt, bevor jemand beim Lieferanten angerufen hat – unter einer Nummer, die man schon kennt, nicht unter der aus der Mail. Auch eine gefälschte Rechnung, die einfach die USt-IdNr. weglässt, fällt so auf. Danach kommt die Freigabe per E-Mail, WhatsApp oder Telegram, mit zwei Knöpfen, ab einem Betrag, den Sie festlegen. Kommt keine Antwort, erfährt es die Buchhaltung.

Und es geht nichts mehr leise verloren: ZIP-Archive werden entpackt, Mails mit einem Portal-Link statt Anhang landen bei einem Menschen, Scans auch, und wenn ein Schritt endgültig scheitert, sagt eine Mail, welcher und ab wann – denn das Postfach hat die Mails da schon als gelesen markiert.

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
