// Build an XRechnung 3.0 invoice (UN/CEFACT CII syntax, EN 16931 + German BR-DE rules) from plain JSON.
// Pure JavaScript, no libraries. Amounts are rounded per line and per VAT group as EN 16931 requires.

const XR_SPEC = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const XR_PROCESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

const VAT_REASONS = {
  E: 'Steuerbefreit',
  AE: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)',
  K: 'Steuerfreie innergemeinschaftliche Lieferung',
  G: 'Steuerfreie Ausfuhrlieferung',
  O: 'Nicht steuerbar',
};

const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const amt = v => r2(v).toFixed(2);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const d102 = s => String(s).slice(0, 10).replace(/-/g, '');
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(n)); return d.toISOString().slice(0, 10); };

// Validate input and compute everything the XML needs. Returns { invoice, errors }.
function prepareInvoice(input, seller) {
  const errors = [];
  const need = (v, label) => { if (v === undefined || v === null || String(v).trim() === '') errors.push(`Missing ${label}`); };
  const b = input.buyer || {};
  need(input.invoiceNumber, 'invoice number');
  need(seller.name, 'seller name'); need(seller.street, 'seller street'); need(seller.postcode, 'seller postcode');
  need(seller.city, 'seller city'); need(seller.contactName, 'seller contact name'); need(seller.phone, 'seller phone');
  need(seller.email, 'seller email'); need(seller.iban, 'seller IBAN');
  if (!seller.vatId && !seller.taxNumber) errors.push('Seller needs a VAT ID or a tax number');
  need(b.name, 'buyer name'); need(b.street, 'buyer street'); need(b.postcode, 'buyer postcode'); need(b.city, 'buyer city');
  need(b.email, 'buyer email (electronic address, BT-49)');
  const lines = (input.lines || []).filter(l => l && String(l.name || '').trim());
  if (!lines.length) errors.push('At least one invoice line is needed');

  const smallBusiness = !!seller.smallBusiness;
  const issueDate = input.issueDate || new Date().toISOString().slice(0, 10);
  const preparedLines = lines.map((l, i) => {
    const quantity = Number(l.quantity ?? 1), unitPrice = Number(l.unitPrice);
    if (!isFinite(quantity) || !isFinite(unitPrice) || l.unitPrice === '' || l.unitPrice === null || l.unitPrice === undefined)
      errors.push(`Line ${i + 1} (${String(l.name).trim()}): quantity and unit price must be numbers`);
    const category = smallBusiness ? 'E' : (l.vatCategory || (Number(l.vatRate) === 0 ? 'Z' : 'S'));
    const rate = ['S', 'Z'].includes(category) ? Number(l.vatRate ?? 19) : 0;
    return { id: String(i + 1), name: String(l.name).trim(), description: l.description || '', unit: l.unit || 'C62',
             quantity, unitPrice, net: r2(quantity * unitPrice), category, rate };
  });
  if (preparedLines.some(l => l.category === 'AE' || l.category === 'K') && !b.vatId)
    errors.push('Reverse charge / intra-community supply needs the buyer VAT ID');

  // One VAT group per category + rate
  const groups = new Map();
  for (const l of preparedLines) {
    const k = l.category + '|' + l.rate;
    if (!groups.has(k)) groups.set(k, { category: l.category, rate: l.rate, basis: 0 });
    groups.get(k).basis = r2(groups.get(k).basis + l.net);
  }
  const taxes = [...groups.values()].map(g => ({
    ...g, amount: r2(g.basis * g.rate / 100),
    reason: g.category === 'E' && smallBusiness ? 'Kleinunternehmer gemäß § 19 UStG' : VAT_REASONS[g.category] || '',
  }));
  const lineTotal = r2(preparedLines.reduce((a, l) => a + l.net, 0));
  const taxTotal = r2(taxes.reduce((a, t) => a + t.amount, 0));
  const grand = r2(lineTotal + taxTotal);
  const prepaid = r2(input.prepaid || 0);
  if (!errors.length && !(grand > 0) && (input.typeCode || '380') === '380') errors.push(`Invoice total is ${grand.toFixed(2)} — an invoice must be greater than 0`);
  const dueDays = input.dueDays ?? seller.dueDays ?? 14;
  const dueDate = input.dueDate || addDays(issueDate, dueDays);

  return {
    errors,
    invoice: {
      invoiceNumber: String(input.invoiceNumber || ''), typeCode: input.typeCode || '380', issueDate,
      deliveryDate: input.deliveryDate || issueDate, dueDate,
      paymentTerms: input.paymentTerms || seller.paymentTerms || `Zahlbar bis ${dueDate.split('-').reverse().join('.')} ohne Abzug.`,
      currency: input.currency || 'EUR', buyerReference: b.reference || b.leitwegId || input.invoiceNumber,
      orderReference: input.orderReference || '', note: input.note || '', smallBusiness,
      seller, buyer: { country: 'DE', ...b }, lines: preparedLines, taxes,
      totals: { lineTotal, taxBasis: lineTotal, tax: taxTotal, grand, prepaid, due: r2(grand - prepaid) },
    },
  };
}

function buildXRechnungCII(inv) {
  const s = inv.seller, b = inv.buyer, cur = inv.currency, t = inv.totals;
  const addr = p => `<ram:PostalTradeAddress><ram:PostcodeCode>${esc(p.postcode)}</ram:PostcodeCode><ram:LineOne>${esc(p.street)}</ram:LineOne><ram:CityName>${esc(p.city)}</ram:CityName><ram:CountryID>${esc(p.country || 'DE')}</ram:CountryID></ram:PostalTradeAddress>`;
  const email = e => `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(e)}</ram:URIID></ram:URIUniversalCommunication>`;
  const taxReg = p => [p.vatId && `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(p.vatId.replace(/\s+/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>`,
    p.taxNumber && `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(p.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>`].filter(Boolean).join('');
  const notes = [inv.note && `<ram:IncludedNote><ram:Content>${esc(inv.note)}</ram:Content></ram:IncludedNote>`,
    inv.smallBusiness && `<ram:IncludedNote><ram:Content>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</ram:Content></ram:IncludedNote>`].filter(Boolean).join('');

  const lines = inv.lines.map(l => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.name)}</ram:Name>${l.description ? `<ram:Description>${esc(l.description)}</ram:Description>` : ''}</ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.unitPrice}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${esc(l.unit)}">${l.quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${l.category}</ram:CategoryCode><ram:RateApplicablePercent>${l.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('');

  const taxes = inv.taxes.map(x => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amt(x.amount)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${x.reason ? `<ram:ExemptionReason>${esc(x.reason)}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${amt(x.basis)}</ram:BasisAmount><ram:CategoryCode>${x.category}</ram:CategoryCode><ram:RateApplicablePercent>${x.rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${XR_PROCESS}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${XR_SPEC}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(inv.invoiceNumber)}</ram:ID><ram:TypeCode>${esc(inv.typeCode)}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(inv.issueDate)}</udt:DateTimeString></ram:IssueDateTime>${notes}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${esc(inv.buyerReference)}</ram:BuyerReference>
      <ram:SellerTradeParty>${!s.vatId && !s.registrationId && s.taxNumber ? `
        <ram:ID>${esc(s.taxNumber)}</ram:ID>` : ''}
        <ram:Name>${esc(s.name)}</ram:Name>${s.registrationId ? `
        <ram:SpecifiedLegalOrganization><ram:ID>${esc(s.registrationId)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:DefinedTradeContact><ram:PersonName>${esc(s.contactName)}</ram:PersonName><ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(s.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication><ram:URIID>${esc(s.email)}</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>
        ${addr(s)}${email(s.email)}${taxReg(s)}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${esc(b.name)}</ram:Name>
        ${addr(b)}${email(b.email)}${b.vatId ? taxReg({ vatId: b.vatId }) : ''}
      </ram:BuyerTradeParty>${inv.orderReference ? `
      <ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${esc(inv.orderReference)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d102(inv.deliveryDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${esc(inv.invoiceNumber)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>${esc(cur)}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(String(s.iban).replace(/\s+/g, ''))}</ram:IBANID>${s.accountName ? `<ram:AccountName>${esc(s.accountName)}</ram:AccountName>` : ''}</ram:PayeePartyCreditorFinancialAccount>${s.bic ? `
        <ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(s.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>${taxes}
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>${esc(inv.paymentTerms)}</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${d102(inv.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amt(t.lineTotal)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amt(t.taxBasis)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${esc(cur)}">${amt(t.tax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amt(t.grand)}</ram:GrandTotalAmount>${t.prepaid ? `
        <ram:TotalPrepaidAmount>${amt(t.prepaid)}</ram:TotalPrepaidAmount>` : ''}
        <ram:DuePayableAmount>${amt(t.due)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

if (typeof module !== 'undefined') module.exports = { prepareInvoice, buildXRechnungCII };
