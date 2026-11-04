// German texts for every problem / warning line. The checks write English; localize() translates line by line,
// so the stored row, the mails and the approval request use one language (Settings → invoiceViewLanguage).

const DE = [
  [/^Missing invoice number$/, 'Rechnungsnummer fehlt'],
  [/^Missing issue date$/, 'Rechnungsdatum fehlt'],
  [/^Missing currency$/, 'Währung fehlt'],
  [/^Missing seller name$/, 'Name des Lieferanten fehlt'],
  [/^Missing buyer name$/, 'Name des Rechnungsempfängers fehlt'],
  [/^Missing invoice total$/, 'Rechnungsbetrag fehlt'],
  [/^Sum of line amounts (\S+) ≠ line total (\S+)$/, 'Summe der Positionen $1 ≠ Positionssumme $2'],
  [/^Net total (\S+) ≠ lines − allowances \+ charges$/, 'Nettosumme $1 ≠ Positionen − Nachlässe + Zuschläge'],
  [/^Gross (\S+) ≠ net (\S+) \+ VAT (\S+)$/, 'Brutto $1 ≠ Netto $2 + USt $3'],
  [/^Amount due (\S+) ≠ gross (\S+) − prepaid (\S+)$/, 'Zahlbetrag $1 ≠ Brutto $2 − Anzahlung $3'],
  [/^Amount due (\S+) differs from gross (\S+) without a stated prepayment — e\.g\. undeclared prepayment, third-party amounts or a correction; check before paying$/, 'Zahlbetrag $1 weicht von Brutto $2 ab, ohne angegebene Anzahlung – z. B. nicht ausgewiesene Anzahlung, Fremdleistungen oder Korrektur; vor der Zahlung prüfen'],
  [/^VAT (\S+)% on (\S+) should be (\S+), invoice says (\S+)$/, 'USt $1 % auf $2 müsste $3 sein, Rechnung nennt $4'],
  [/^VAT breakdown (\S+) ≠ VAT total (\S+)$/, 'USt-Aufschlüsselung $1 ≠ USt gesamt $2'],
  [/^Seller has neither VAT ID nor tax number \(required unless VAT-exempt\)$/, 'Lieferant ohne USt-IdNr. und Steuernummer (Pflicht, außer bei Steuerbefreiung)'],
  [/^Seller VAT ID looks malformed: (.*)$/, 'USt-IdNr. des Lieferanten sieht fehlerhaft aus: $1'],
  [/^German VAT ID must be DE \+ 9 digits: (.*)$/, 'Deutsche USt-IdNr. muss DE + 9 Ziffern haben: $1'],
  [/^IBAN checksum invalid: (.*)$/, 'IBAN-Prüfsumme ungültig: $1'],
  [/^Credit note \(type 381\)$/, 'Gutschrift (Typ 381)'],
  [/^Due date (\S+) has passed$/, 'Fälligkeit $1 ist überschritten'],
  [/^Allowances, charges and prepaid amounts must not be negative$/, 'Nachlässe, Zuschläge und Anzahlungen dürfen nicht negativ sein'],
  [/^Implausible rounding amount (\S+)$/, 'Unplausibler Rundungsbetrag $1'],
  [/^VAT category (\S+) must have 0\.00 VAT, invoice says (\S+)$/, 'USt-Kategorie $1 muss 0,00 USt haben, Rechnung nennt $2'],
  [/^First IBAN from this supplier — check the bank details once before paying$/, 'Erste IBAN dieses Lieferanten – Bankverbindung vor der Zahlung einmal prüfen'],
  [/^VAT ID \/ tax number (.+) differs from earlier invoices of this supplier \((.+)\)$/, 'USt-IdNr./Steuernummer $1 weicht von früheren Rechnungen dieses Lieferanten ab ($2)'],
  [/^Same invoice also attached as (.+)$/, 'Dieselbe Rechnung ist auch als $1 angehängt'],
  [/^Could not read the e-invoice XML: (.*)$/, 'E-Rechnungs-XML nicht lesbar: $1'],
  [/^This XML file is not an invoice \((.*)\) — please look at it$/, 'Diese XML-Datei ist keine Rechnung ($1) – bitte ansehen'],
  [/^No e-invoice data in this PDF: fields were read by the AI model, please verify$/, 'Keine E-Rechnungsdaten im PDF: Die Felder hat das KI-Modell gelesen – bitte prüfen'],
  [/^Scanned PDF without a text layer: needs OCR or manual entry$/, 'Gescanntes PDF ohne Textebene: OCR oder manuelle Erfassung nötig'],
  [/^Could not read this PDF automatically \((.*)\) — please enter it by hand$/, 'PDF konnte nicht automatisch gelesen werden ($1) – bitte manuell erfassen'],
  [/^Unpacked from (.*)$/, 'Entpackt aus $1'],
  [/^Also in this mail, not processed: (.*)$/, 'Ebenfalls in dieser Mail, nicht verarbeitet: $1'],
  [/^Readable PDF could not be created: (.*)$/, 'Lesbare PDF-Ansicht nicht erstellt: $1'],
  [/^First invoice from this supplier — check the bank details once before paying$/, 'Erste Rechnung dieses Lieferanten – Bankverbindung vor der Zahlung einmal prüfen'],
  [/^Bank details changed: IBAN (.+) was never used by this supplier before \(last: (.+) on invoice (.+)\)\. Confirm by phone on a number you already know — not one from this invoice or email\.$/,
    'Bankverbindung geändert: IBAN $1 wurde von diesem Lieferanten noch nie verwendet (zuletzt: $2 auf Rechnung $3). Telefonisch unter einer Ihnen bekannten Nummer bestätigen – nicht unter einer aus dieser Rechnung oder Mail.'],
  [/^Sent from (\S+), earlier invoices of this supplier came from (.+)$/, 'Gesendet von $1, frühere Rechnungen dieses Lieferanten kamen von $2'],
];
// fragments inside the "not processed" list
const DE_INLINE = [
  [/\(not a PDF, XML or ZIP\)/g, '(kein PDF, XML oder ZIP)'],
  [/\(encrypted\)/g, '(verschlüsselt)'],
  [/\(ZIP could not be opened: /g, '(ZIP nicht lesbar: '],
  [/\(compression method /g, '(Kompressionsverfahren '],
];

function localize(text, lang) {
  if (lang !== 'de' || !text) return text;
  return String(text).split('\n').map(line => {
    for (const [re, rep] of DE) {
      if (!re.test(line)) continue;
      line = line.replace(re, rep);
      // German decimal comma, only in the amount checks (not in file names or VAT IDs)
      if (/^(Summe|Nettosumme|Brutto|Zahlbetrag|USt|Unplausibler)/.test(line)) line = line.replace(/(\d)\.(\d{2})(?!\d)/g, '$1,$2');
      break;
    }
    for (const [re, rep] of DE_INLINE) line = line.replace(re, rep);
    return line;
  }).join('\n');
}

if (typeof module !== 'undefined') module.exports = { localize, DE };
