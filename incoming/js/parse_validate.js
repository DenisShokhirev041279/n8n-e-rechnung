// Parse an EN 16931 e-invoice (CII: ZUGFeRD 2.x / Factur-X / XRechnung-CII, ZUGFeRD 1.0, UBL: XRechnung-UBL / Peppol)
// into one flat structure and run plausibility checks. Pure JavaScript, no external services.

// --- Tiny XML reader: namespace prefixes are dropped, attributes kept ---
function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()]);
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += ent(m[6]);
    else if (m[3]) {
      const name = m[3].replace(/^[\w.-]+:/, '');
      if (m[2]) { stack.pop(); continue; }
      const attrs = {};
      m[4].replace(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k.replace(/^[\w.-]+:/, '')] = ent(a ?? b); });
      const node = { name, attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root.children[0];
}

// Path lookup: 'A/B|C/D' — '|' gives alternatives for one step (ZUGFeRD 1.0 vs 2.x names).
const all = (node, path) => path.split('/').reduce((nodes, step) => {
  const names = step.split('|');
  return nodes.flatMap(n => n.children.filter(c => names.includes(c.name)));
}, node ? [node] : []);
const one = (node, path) => all(node, path)[0];
const txt = (node, path) => { const n = path ? one(node, path) : node; return n ? n.text.trim() : ''; };
const num = (node, path) => { const t = txt(node, path); return t === '' ? null : Number(t); };
const cdate = s => /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;

function normalizeCII(doc) {
  const v1 = doc.name === 'CrossIndustryDocument' || !!one(doc, 'HeaderExchangedDocument'); // incl. 2014 ZUGFeRD drafts with <Invoice> root
  const hdr = one(doc, v1 ? 'HeaderExchangedDocument' : 'ExchangedDocument');
  const tx = one(doc, 'SupplyChainTradeTransaction|SpecifiedSupplyChainTradeTransaction');
  const agr = one(tx, 'ApplicableHeaderTradeAgreement|ApplicableSupplyChainTradeAgreement');
  const set = one(tx, 'ApplicableHeaderTradeSettlement|ApplicableSupplyChainTradeSettlement');
  const sum = one(set, 'SpecifiedTradeSettlementHeaderMonetarySummation|SpecifiedTradeSettlementMonetarySummation');
  const party = p => p && {
    name: txt(p, 'Name'),
    vatId: (all(p, 'SpecifiedTaxRegistration/ID').find(n => n.attrs.schemeID === 'VA') || {}).text?.trim() || '',
    taxNumber: (all(p, 'SpecifiedTaxRegistration/ID').find(n => n.attrs.schemeID === 'FC') || {}).text?.trim() || '',
    street: txt(p, 'PostalTradeAddress/LineOne'),
    postcode: txt(p, 'PostalTradeAddress/PostcodeCode'),
    city: txt(p, 'PostalTradeAddress/CityName'),
    country: txt(p, 'PostalTradeAddress/CountryID'),
  };
  // TaxTotalAmount can appear twice (invoice currency + accounting currency)
  const currency = txt(set, 'InvoiceCurrencyCode') || (one(sum, 'GrandTotalAmount') || { attrs: {} }).attrs.currencyID || '';
  const taxTotals = all(sum, 'TaxTotalAmount');
  const taxTotal = taxTotals.find(n => !n.attrs.currencyID || n.attrs.currencyID === currency) || taxTotals[0];
  return {
    syntax: v1 ? 'ZUGFeRD 1.0 (CII)' : 'CII',
    profile: txt(doc, (v1 ? 'SpecifiedExchangedDocumentContext' : 'ExchangedDocumentContext') + '/GuidelineSpecifiedDocumentContextParameter/ID'),
    invoiceNumber: txt(hdr, 'ID'),
    typeCode: txt(hdr, 'TypeCode'),
    issueDate: cdate(txt(hdr, 'IssueDateTime/DateTimeString') || txt(hdr, 'IssueDateTime')),
    dueDate: cdate(txt(set, 'SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString')),
    paymentTerms: txt(set, 'SpecifiedTradePaymentTerms/Description'),
    currency,
    buyerReference: txt(agr, 'BuyerReference'),
    orderReference: txt(agr, 'BuyerOrderReferencedDocument/IssuerAssignedID'),
    seller: party(one(agr, 'SellerTradeParty')),
    buyer: party(one(agr, 'BuyerTradeParty')),
    iban: txt(set, 'SpecifiedTradeSettlementPaymentMeans/PayeePartyCreditorFinancialAccount/IBANID'),
    totals: {
      lineTotal: num(sum, 'LineTotalAmount'),
      allowances: num(sum, 'AllowanceTotalAmount') || 0,
      charges: num(sum, 'ChargeTotalAmount') || 0,
      taxBasis: num(sum, 'TaxBasisTotalAmount'),
      tax: taxTotal ? Number(taxTotal.text.trim()) : null,
      grand: num(sum, 'GrandTotalAmount'),
      prepaid: num(sum, 'TotalPrepaidAmount') || 0,
      rounding: num(sum, 'RoundingAmount') || 0,
      due: num(sum, 'DuePayableAmount'),
    },
    taxBreakdown: all(set, 'ApplicableTradeTax').map(t => ({
      category: txt(t, 'CategoryCode'),
      rate: num(t, 'RateApplicablePercent|ApplicablePercent'),
      basis: num(t, 'BasisAmount'),
      amount: num(t, 'CalculatedAmount'),
    })),
    lines: all(tx, 'IncludedSupplyChainTradeLineItem').map(l => ({
      name: txt(l, 'SpecifiedTradeProduct/Name'),
      quantity: num(l, 'SpecifiedLineTradeDelivery|SpecifiedSupplyChainTradeDelivery/BilledQuantity'),
      unitPrice: num(l, 'SpecifiedLineTradeAgreement|SpecifiedSupplyChainTradeAgreement/NetPriceProductTradePrice/ChargeAmount'),
      net: num(l, 'SpecifiedLineTradeSettlement|SpecifiedSupplyChainTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation|SpecifiedTradeSettlementMonetarySummation/LineTotalAmount'),
      taxRate: num(l, 'SpecifiedLineTradeSettlement|SpecifiedSupplyChainTradeSettlement/ApplicableTradeTax/RateApplicablePercent|ApplicablePercent'),
    })),
  };
}

function normalizeUBL(doc) {
  const credit = doc.name === 'CreditNote';
  const party = p => p && {
    name: txt(p, 'PartyLegalEntity/RegistrationName') || txt(p, 'PartyName/Name'),
    vatId: (all(p, 'PartyTaxScheme').find(s => txt(s, 'TaxScheme/ID') === 'VAT') && txt(all(p, 'PartyTaxScheme').find(s => txt(s, 'TaxScheme/ID') === 'VAT'), 'CompanyID')) || '',
    taxNumber: (all(p, 'PartyTaxScheme').find(s => txt(s, 'TaxScheme/ID') !== 'VAT') && txt(all(p, 'PartyTaxScheme').find(s => txt(s, 'TaxScheme/ID') !== 'VAT'), 'CompanyID')) || '',
    street: txt(p, 'PostalAddress/StreetName'),
    postcode: txt(p, 'PostalAddress/PostalZone'),
    city: txt(p, 'PostalAddress/CityName'),
    country: txt(p, 'PostalAddress/Country/IdentificationCode'),
  };
  const currency = txt(doc, 'DocumentCurrencyCode');
  const taxTotals = all(doc, 'TaxTotal');
  const mainTax = taxTotals.find(t => all(t, 'TaxSubtotal').length) || taxTotals[0];
  const sum = one(doc, 'LegalMonetaryTotal');
  return {
    syntax: 'UBL',
    profile: txt(doc, 'CustomizationID'),
    invoiceNumber: txt(doc, 'ID'),
    typeCode: txt(doc, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'),
    issueDate: txt(doc, 'IssueDate'),
    dueDate: txt(doc, 'DueDate') || txt(doc, 'PaymentMeans/PaymentDueDate'),
    paymentTerms: txt(doc, 'PaymentTerms/Note'),
    currency,
    buyerReference: txt(doc, 'BuyerReference'),
    orderReference: txt(doc, 'OrderReference/ID'),
    seller: party(one(doc, 'AccountingSupplierParty/Party')),
    buyer: party(one(doc, 'AccountingCustomerParty/Party')),
    iban: txt(doc, 'PaymentMeans/PayeeFinancialAccount/ID'),
    totals: {
      lineTotal: num(sum, 'LineExtensionAmount'),
      allowances: num(sum, 'AllowanceTotalAmount') || 0,
      charges: num(sum, 'ChargeTotalAmount') || 0,
      taxBasis: num(sum, 'TaxExclusiveAmount'),
      tax: mainTax ? num(mainTax, 'TaxAmount') : null,
      grand: num(sum, 'TaxInclusiveAmount'),
      prepaid: num(sum, 'PrepaidAmount') || 0,
      rounding: num(sum, 'PayableRoundingAmount') || 0,
      due: num(sum, 'PayableAmount'),
    },
    taxBreakdown: mainTax ? all(mainTax, 'TaxSubtotal').map(t => ({
      category: txt(t, 'TaxCategory/ID'),
      rate: num(t, 'TaxCategory/Percent'),
      basis: num(t, 'TaxableAmount'),
      amount: num(t, 'TaxAmount'),
    })) : [],
    lines: all(doc, credit ? 'CreditNoteLine' : 'InvoiceLine').map(l => ({
      name: txt(l, 'Item/Name'),
      quantity: num(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity'),
      unitPrice: num(l, 'Price/PriceAmount'),
      net: num(l, 'LineExtensionAmount'),
      taxRate: num(l, 'Item/ClassifiedTaxCategory/Percent'),
    })),
  };
}

function parseInvoice(xml) {
  const doc = parseXml(xml);
  if (!doc) throw new Error('empty XML');
  if (doc.name === 'CrossIndustryInvoice' || doc.name === 'CrossIndustryDocument') return normalizeCII(doc);
  if (one(doc, 'HeaderExchangedDocument')) return normalizeCII(doc);
  if (doc.name === 'Invoice' || doc.name === 'CreditNote') return normalizeUBL(doc);
  throw new Error('not an EN 16931 invoice: <' + doc.name + '>');
}

// --- Plausibility checks (a subset of the EN 16931 business rules, not a full Schematron validation) ---
function ibanValid(iban) {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const ch of r) mod = (mod * 10 + Number(ch)) % 97;
  return mod === 1;
}

function checkInvoice(inv, today = new Date().toISOString().slice(0, 10)) {
  const problems = [], warnings = [];
  const t = inv.totals;
  const near = (a, b, tol = 0.02) => a !== null && b !== null && Math.abs(a - b) <= tol + 1e-9;
  const money = x => x === null ? '—' : x.toFixed(2);

  for (const [key, label] of [['invoiceNumber', 'invoice number'], ['issueDate', 'issue date'], ['currency', 'currency']])
    if (!inv[key]) problems.push(`Missing ${label}`);
  if (!inv.seller?.name) problems.push('Missing seller name');
  if (!inv.buyer?.name) problems.push('Missing buyer name');
  if (t.grand === null) problems.push('Missing invoice total');
  if (t.due === null && t.grand !== null) t.due = Math.round((t.grand - t.prepaid + t.rounding) * 100) / 100; // optional in ZUGFeRD 1.0 BASIC

  if (inv.lines.length && inv.lines.every(l => l.net !== null) && t.lineTotal !== null) {
    const s = inv.lines.reduce((a, l) => a + (l.net || 0), 0);
    if (!near(s, t.lineTotal)) problems.push(`Sum of line amounts ${money(s)} ≠ line total ${money(t.lineTotal)}`);
  }
  if (t.lineTotal !== null && t.taxBasis !== null && !near(t.lineTotal - t.allowances + t.charges, t.taxBasis))
    problems.push(`Net total ${money(t.taxBasis)} ≠ lines − allowances + charges`);
  if (t.taxBasis !== null && t.tax !== null && t.grand !== null && !near(t.taxBasis + t.tax, t.grand))
    problems.push(`Gross ${money(t.grand)} ≠ net ${money(t.taxBasis)} + VAT ${money(t.tax)}`);
  if (t.grand !== null && t.due !== null && !near(t.grand - t.prepaid + t.rounding, t.due)) {
    if (t.prepaid) problems.push(`Amount due ${money(t.due)} ≠ gross ${money(t.grand)} − prepaid ${money(t.prepaid)}`);
    else warnings.push(`Amount due ${money(t.due)} differs from gross ${money(t.grand)} without a stated prepayment`);
  }
  for (const b of inv.taxBreakdown) {
    if (b.rate !== null && b.basis !== null && b.amount !== null && !near(b.basis * b.rate / 100, b.amount, 0.01 + Math.abs(b.basis) * 0.0005))
      problems.push(`VAT ${b.rate}% on ${money(b.basis)} should be ${money(b.basis * b.rate / 100)}, invoice says ${money(b.amount)}`);
  }
  if (inv.taxBreakdown.length && t.tax !== null) {
    const s = inv.taxBreakdown.reduce((a, b) => a + (b.amount || 0), 0);
    if (!near(s, t.tax)) problems.push(`VAT breakdown ${money(s)} ≠ VAT total ${money(t.tax)}`);
  }

  if (inv.seller && !inv.seller.vatId && !inv.seller.taxNumber) warnings.push('Seller has neither VAT ID nor tax number (required unless VAT-exempt)');
  if (inv.seller?.vatId && !/^[A-Z]{2}[0-9A-Z+*.]{2,13}$/.test(inv.seller.vatId.replace(/\s+/g, '')))
    warnings.push(`Seller VAT ID looks malformed: ${inv.seller.vatId}`);
  if (inv.seller?.vatId?.startsWith('DE') && !/^DE\d{9}$/.test(inv.seller.vatId.replace(/\s+/g, '')))
    warnings.push(`German VAT ID must be DE + 9 digits: ${inv.seller.vatId}`);
  if (inv.iban && !ibanValid(inv.iban)) problems.push(`IBAN checksum invalid: ${inv.iban}`);
  if (inv.typeCode === '381') warnings.push('Credit note (type 381)');
  if (inv.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(inv.dueDate) && inv.dueDate < today) warnings.push(`Due date ${inv.dueDate} has passed`);

  return { status: problems.length ? 'check' : 'ok', problems, warnings };
}

if (typeof module !== 'undefined') module.exports = { parseXml, parseInvoice, checkInvoice, ibanValid };
