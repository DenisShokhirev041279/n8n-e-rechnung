# E-Rechnung with n8n — XRechnung, ZUGFeRD, Factur-X

Open n8n workflows for European e-invoices (EN 16931). No external API, no OCR service, no community node: the invoice XML is read, checked and rendered inside n8n with plain JavaScript, so invoice data stays on your own instance.

*Deutsche Fassung weiter unten.*

| Workflow | Status |
|---|---|
| [Process incoming e-invoices](incoming/) — read, check, deduplicate, forward to bookkeeping | available |
| Create outgoing XRechnung | in progress |

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

---

## Deutsch: Eingangsrechnungen mit n8n verarbeiten

Seit Januar 2025 muss jedes Unternehmen in Deutschland E-Rechnungen empfangen können. Das Problem kennt jeder, der schon eine XRechnung bekommen hat: Die Datei ist XML, lesen kann sie niemand, und bei ZUGFeRD steckt das Eigentliche als Anhang im PDF.

Der Workflow holt die Rechnungen aus dem Postfach oder über ein Upload-Formular, liest XRechnung, ZUGFeRD und Factur-X direkt in n8n aus – ohne externe API, die Daten bleiben auf der eigenen Instanz – und prüft, ob die Summen, die Umsatzsteuer je Satz, die IBAN und die Pflichtangaben zusammenpassen. Doppelt eingegangene Rechnungen fallen auf, bevor jemand zweimal zahlt.

An die Buchhaltung geht nur, was wirklich hingeschaut werden muss, und zwar mit einer lesbaren PDF-Ansicht jeder XRechnung. Saubere Rechnungen lassen sich automatisch an DATEV Upload Mail oder Lexware Office weiterleiten (DATEV nimmt dort kein XML an, deshalb die PDF-Ansicht). Einmal im Monat gibt es eine CSV für die Steuerberatung.

PDFs ohne E-Rechnungsdaten liest auf Wunsch ein lokales Sprachmodell über Ollama – gekennzeichnet zur Prüfung, nie stillschweigend übernommen.

Eine vollständige Schematron-Validierung ersetzt das nicht, und die XML-Datei bleibt das maßgebliche Original.

---

MIT License. Built by **Denis Shokhirev** · [DennisCraft AI Studio](https://gerdennisai.com/de/), Freiburg im Breisgau — n8n automation and AI agents for small and mid-sized businesses ([n8n-Experte Freiburg](https://gerdennisai.com/de/n8n-experte-freiburg/)).
