// Supplier check: compares each new invoice with earlier invoices of the same supplier.
// Changed bank details are the classic invoice fraud, so an unknown IBAN always goes to a person.

const CHANGED = 'Bank details changed';
// the stored text may already be translated (messages.js), so recognise both languages
const wasAlarm = r => /Bank details changed|Bankverbindung geändert/.test(String(r.problems || ''));
const norm = s => String(s || '').replace(/\s+/g, '').toUpperCase();
const supplierKey = r => norm(r.sellerVatId) || norm(r.sellerName);
// Same supplier if the VAT ID / tax number OR the name matches — a fake that drops the VAT ID must not look new.
const sameSupplier = (a, b) =>
  (norm(a.sellerVatId) && norm(a.sellerVatId) === norm(b.sellerVatId)) ||
  (norm(a.sellerName) && norm(a.sellerName) === norm(b.sellerName));
const mailDomain = s => {
  const m = String(s || '').match(/@([A-Za-z0-9.-]+)/);
  return m ? m[1].toLowerCase() : '';
};
const shortIban = s => {
  const n = norm(s);
  return n.length > 8 ? n.slice(0, 4) + ' … ' + n.slice(-4) : n;
};

// history: rows already in the table; invoices: new rows (not yet saved), in arrival order.
function checkSuppliers(invoices, history) {
  const seen = history.slice();
  return invoices.map(inv => {
    const key = supplierKey(inv);
    const out = { ...inv, previousIban: '' };
    const problems = inv.problems ? inv.problems.split('\n') : [];
    const warnings = inv.warnings ? inv.warnings.split('\n') : [];
    if (!key) {
      seen.push(out);
      return out;
    }
    const earlier = seen.filter(r => sameSupplier(r, inv));
    if (!earlier.length) {
      warnings.push('First invoice from this supplier — check the bank details once before paying');
    } else {
      // An IBAN counts as known only if it came in without a bank-change alarm, or a person confirmed it.
      const trusted = earlier.filter(r => norm(r.iban) && (!wasAlarm(r) || r.ibanConfirmed === 'yes'));
      const known = new Set(trusted.map(r => norm(r.iban)));
      const iban = norm(inv.iban);
      const ids = new Set(earlier.map(r => norm(r.sellerVatId)).filter(Boolean));
      if (ids.size && !ids.has(norm(inv.sellerVatId))) {
        warnings.push(`VAT ID / tax number ${inv.sellerVatId || '(none)'} differs from earlier invoices of this supplier (${[...ids].join(', ')})`);
      }
      if (iban && !known.size) {
        warnings.push('First IBAN from this supplier — check the bank details once before paying');
      } else if (iban && !known.has(iban)) {
        const last = trusted[trusted.length - 1];
        out.previousIban = norm(last.iban);
        problems.unshift(`${CHANGED}: IBAN ${shortIban(iban)} was never used by this supplier before ` +
          `(last: ${shortIban(last.iban)} on invoice ${last.invoiceNumber || '?'}). ` +
          'Confirm by phone on a number you already know — not one from this invoice or email.');
      }
      const domains = new Set(earlier.map(r => mailDomain(r.emailFrom)).filter(Boolean));
      const domain = mailDomain(inv.emailFrom);
      if (domain && domains.size && !domains.has(domain)) {
        warnings.push(`Sent from ${domain}, earlier invoices of this supplier came from ${[...domains].join(', ')}`);
      }
    }
    out.problems = problems.join('\n');
    out.warnings = warnings.join('\n');
    if (problems.length) out.status = 'check';
    seen.push(out);
    return out;
  });
}

if (typeof module !== 'undefined') module.exports = { checkSuppliers, CHANGED };
