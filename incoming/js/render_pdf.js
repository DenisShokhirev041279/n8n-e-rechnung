// Readable PDF view of a parsed e-invoice (the XML stays the legal original).
// Pure JavaScript, no libraries: standard Helvetica fonts, WinAnsi encoding (umlauts, €), A4, page breaks.

const LABELS = {
  de: {
    380: 'Rechnung', 381: 'Gutschrift', 384: 'Rechnungskorrektur', 326: 'Teilrechnung', 389: 'Gutschrift (Selbstfakturierung)',
    from: 'Rechnungssteller', to: 'Rechnungsempfänger', number: 'Rechnungsnummer', date: 'Rechnungsdatum', due: 'Fällig am',
    buyerRef: 'Käuferreferenz / Leitweg-ID', order: 'Bestellnummer', vatId: 'USt-IdNr.', taxNo: 'Steuernummer',
    pos: 'Pos.', item: 'Bezeichnung', qty: 'Menge', price: 'Einzelpreis', vat: 'USt.', net: 'Netto',
    lineTotal: 'Summe Positionen', allowances: 'Nachlässe', charges: 'Zuschläge', taxBasis: 'Nettobetrag',
    taxTotal: 'Umsatzsteuer', grand: 'Gesamtbetrag', prepaid: 'Bereits gezahlt', payable: 'Zahlbetrag',
    vatOn: 'USt. {rate} % auf {basis}', payment: 'Zahlung', iban: 'IBAN', terms: 'Zahlungsbedingungen',
    footer: 'Lesbare Darstellung der E-Rechnung {file} ({format}). Rechtlich maßgeblich ist die XML-Datei.',
    page: 'Seite {n} von {total}', checks: 'Prüfhinweise',
  },
  en: {
    380: 'Invoice', 381: 'Credit note', 384: 'Corrected invoice', 326: 'Partial invoice', 389: 'Self-billed credit note',
    from: 'Seller', to: 'Buyer', number: 'Invoice number', date: 'Invoice date', due: 'Due date',
    buyerRef: 'Buyer reference', order: 'Order number', vatId: 'VAT ID', taxNo: 'Tax number',
    pos: 'Pos.', item: 'Description', qty: 'Qty', price: 'Unit price', vat: 'VAT', net: 'Net',
    lineTotal: 'Sum of lines', allowances: 'Allowances', charges: 'Charges', taxBasis: 'Net total',
    taxTotal: 'VAT total', grand: 'Gross total', prepaid: 'Prepaid', payable: 'Amount due',
    vatOn: 'VAT {rate} % on {basis}', payment: 'Payment', iban: 'IBAN', terms: 'Payment terms',
    footer: 'Readable view of the e-invoice {file} ({format}). The XML file is the legal original.',
    page: 'Page {n} of {total}', checks: 'Check results',
  },
};

// Helvetica widths (1/1000 em) for ASCII 32..126; other characters use 556.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const WIN = { '€': 128, '‚': 130, '„': 132, '…': 133, '–': 150, '—': 151, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '™': 153 };
const winByte = ch => {
  const c = ch.charCodeAt(0);
  if (WIN[ch]) return WIN[ch];
  if (c >= 32 && c <= 126) return c;
  if (c >= 160 && c <= 255) return c;
  return 63; // '?'
};
const textWidth = (s, size, bold) => {
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126 ? (bold ? HELVB : HELV)[c - 32] : 556); }
  return w * size / 1000;
};
const pdfStr = s => '(' + Array.from(s).map(ch => {
  const b = winByte(ch);
  if (b === 40 || b === 41 || b === 92) return '\\' + String.fromCharCode(b);
  return b > 126 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b);
}).join('') + ')';

function wrap(s, width, size, bold) {
  const words = String(s || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (textWidth(next, size, bold) <= width || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function renderInvoicePdf(inv, opts = {}) {
  const L = LABELS[opts.lang] || LABELS.de;
  const fmt = (v, cur) => v === null || v === undefined || v === '' ? '' :
    Number(v).toLocaleString(opts.lang === 'en' ? 'en-GB' : 'de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
  const qtyFmt = v => v === null || v === undefined ? '' : Number(v).toLocaleString(opts.lang === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: 4 });
  const cur = inv.currency || '';
  const W = 595, H = 842, M = 50, RIGHT = W - M;
  const pages = [];
  let ops = [], y = 0;

  const text = (s, x, yy, size = 9, bold = false, align = 'left') => {
    s = String(s ?? '');
    if (align === 'right') x -= textWidth(s, size, bold);
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td ${pdfStr(s)} Tj ET`);
  };
  const hline = (yy, x1 = M, x2 = RIGHT) => ops.push(`${x1} ${yy.toFixed(2)} m ${x2} ${yy.toFixed(2)} l S`);
  const newPage = () => { if (ops.length) pages.push(ops); ops = ['0.6 w 0.3 0.3 0.3 RG']; y = H - M; };
  const need = (h, inTable) => { if (y - h < M + 40) { newPage(); if (inTable) tableHeader(); } };

  const COLS = { pos: M, item: M + 28, qty: 370, price: 440, vat: 478, net: RIGHT };
  const tableHeader = () => {
    text(L.pos, COLS.pos, y, 8, true); text(L.item, COLS.item, y, 8, true);
    text(L.qty, COLS.qty, y, 8, true, 'right'); text(L.price, COLS.price, y, 8, true, 'right');
    text(L.vat, COLS.vat, y, 8, true, 'right'); text(L.net, COLS.net, y, 8, true, 'right');
    y -= 5; hline(y); y -= 12;
  };

  newPage();
  // Title and invoice meta
  text(L[inv.typeCode] || L[380], M, y, 18, true);
  text(inv.syntax ? inv.syntax : '', RIGHT, y + 4, 7, false, 'right');
  y -= 30;

  const party = (title, p, x) => {
    let yy = y;
    text(title, x, yy, 7, true); yy -= 12;
    if (!p) return yy;
    for (const l of wrap(p.name, 230, 10, true)) { text(l, x, yy, 10, true); yy -= 13; }
    for (const l of [p.street, [p.postcode, p.city].filter(Boolean).join(' '), p.country].filter(Boolean)) { text(l, x, yy); yy -= 11; }
    if (p.vatId) { text(`${L.vatId} ${p.vatId}`, x, yy); yy -= 11; }
    if (p.taxNumber) { text(`${L.taxNo} ${p.taxNumber}`, x, yy); yy -= 11; }
    return yy;
  };
  const yA = party(L.from, inv.seller, M), yB = party(L.to, inv.buyer, 310);
  y = Math.min(yA, yB) - 14;

  const meta = [[L.number, inv.invoiceNumber], [L.date, inv.issueDate], [L.due, inv.dueDate],
    [L.buyerRef, inv.buyerReference], [L.order, inv.orderReference]].filter(([, v]) => v);
  for (const [k, v] of meta) { text(k, M, y, 9, true); text(v, M + 150, y); y -= 12; }
  y -= 12;

  // Line items
  tableHeader();
  inv.lines.forEach((l, i) => {
    const nameLines = wrap(l.name || '', COLS.qty - COLS.item - 45, 9);
    need(nameLines.length * 11 + 4, true);
    text(String(i + 1), COLS.pos, y);
    nameLines.forEach((nl, k) => text(nl, COLS.item, y - k * 11));
    text(qtyFmt(l.quantity), COLS.qty, y, 9, false, 'right');
    text(fmt(l.unitPrice), COLS.price, y, 9, false, 'right');
    text(l.taxRate === null || l.taxRate === undefined ? '' : l.taxRate + ' %', COLS.vat, y, 9, false, 'right');
    text(fmt(l.net), COLS.net, y, 9, false, 'right');
    y -= nameLines.length * 11 + 4;
  });
  y += 4; hline(y); y -= 16;

  // Totals
  const t = inv.totals || {};
  const rows = [[L.lineTotal, t.lineTotal], [L.allowances, t.allowances || null], [L.charges, t.charges || null],
    [L.taxBasis, t.taxBasis],
    ...(inv.taxBreakdown || []).map(b => [L.vatOn.replace('{rate}', b.rate ?? '').replace('{basis}', fmt(b.basis)), b.amount]),
    [L.taxTotal, t.tax], [L.grand, t.grand, true], [L.prepaid, t.prepaid || null], [L.payable, t.due, true]];
  for (const [k, v, bold] of rows) {
    if (v === null || v === undefined) continue;
    need(14);
    text(k, 330, y, 9, !!bold); text(fmt(v, cur), RIGHT, y, 9, !!bold, 'right'); y -= 13;
  }
  y -= 10;

  // Payment and check results
  const block = (title, lines) => {
    lines = lines.filter(Boolean);
    if (!lines.length) return;
    need(16 + lines.length * 11);
    text(title, M, y, 9, true); y -= 12;
    for (const l of lines) for (const w of wrap(l, RIGHT - M, 9)) { need(11); text(w, M, y); y -= 11; }
    y -= 8;
  };
  block(L.payment, [inv.iban && `${L.iban} ${inv.iban}`, inv.paymentTerms && `${L.terms}: ${inv.paymentTerms}`]);

  pages.push(ops);

  // Assemble the PDF file
  const footer = L.footer.replace('{file}', opts.fileName || '').replace('{format}', [inv.syntax, inv.profile].filter(Boolean).join(', '));
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((p, i) => {
    const foot = [...wrap(footer, 400, 6.5).slice(0, 2).map((fl, k) => `BT /F1 6.5 Tf ${M} ${30 - k * 8} Td ${pdfStr(fl)} Tj ET`),
      `BT /F1 6.5 Tf ${(RIGHT - textWidth(L.page.replace('{n}', i + 1).replace('{total}', pages.length), 6.5)).toFixed(2)} 30 Td ${pdfStr(L.page.replace('{n}', i + 1).replace('{total}', pages.length))} Tj ET`];
    const content = [...p, ...foot].join('\n');
    const bytes = Buffer.from(Array.from(content).map(ch => ch.charCodeAt(0) & 255));
    const c = add({ stream: bytes });
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    let buf;
    if (o && o.stream) buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.stream.length} >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    else buf = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    chunks.push(buf); offset += buf.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

if (typeof module !== 'undefined') module.exports = { renderInvoicePdf };
