// Approval before payment: the request text (same content for e-mail, WhatsApp and Telegram)
// and reading the answer of a "Send and Wait for Response" node.

const T = {
  de: {
    subject: (r) => `Freigabe: Rechnung ${r.invoiceNumber || '?'} von ${r.sellerName || '?'}`,
    intro: 'Bitte Rechnung freigeben:',
    seller: 'Lieferant', invoice: 'Rechnung', from: 'vom', due: 'fällig', amount: 'Betrag', notes: 'Hinweise',
    payable: 'Zahlbetrag (weicht vom Rechnungsbetrag ab!)',
  },
  en: {
    subject: (r) => `Approve invoice ${r.invoiceNumber || '?'} from ${r.sellerName || '?'}`,
    intro: 'Please approve this invoice:',
    seller: 'Supplier', invoice: 'Invoice', from: 'from', due: 'due', amount: 'Amount', notes: 'Notes',
    payable: 'Amount to pay (differs from the invoice total!)',
  },
};

function money(v, cur, lang) {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
  const s = Number(v).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} ${cur || ''}`.trim();
}

function spacedIban(s) {
  return String(s || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

// r: a stored invoice row. Returns { subject, text } — plain text works in all three channels.
function approvalRequest(r, lang = 'de') {
  const t = T[lang] || T.de;
  const lines = [
    t.intro,
    '',
    `${t.seller}: ${r.sellerName || '?'}${r.sellerVatId ? ' (' + r.sellerVatId + ')' : ''}`,
    `${t.invoice}: ${r.invoiceNumber || '?'} ${t.from} ${r.invoiceDate || '?'}${r.dueDate ? ', ' + t.due + ' ' + r.dueDate : ''}`,
    `${t.amount}: ${money(r.grossAmount, r.currency, lang)}`,
  ];
  // The bank transfer uses the amount due — if it differs, the approver has to see it.
  const due = Number(r.amountDue), gross = Number(r.grossAmount);
  if (r.amountDue !== null && r.amountDue !== undefined && r.amountDue !== '' && !isNaN(due) && Math.abs(due - gross) > 0.005)
    lines.push(`${t.payable}: ${money(due, r.currency, lang)}`);
  if (r.iban) lines.push(`IBAN: ${spacedIban(r.iban)}`);
  if (r.warnings) lines.push('', `${t.notes}:`, ...String(r.warnings).split('\n').map(w => '• ' + w));
  return { subject: t.subject(r), text: lines.join('\n') };
}

// Output of a send-and-wait node: { data: { approved: true|false } }; nothing when the wait time ran out.
function readDecision(json) {
  const a = json && json.data && json.data.approved;
  if (a === true) return 'approved';
  if (a === false) return 'declined';
  return 'no answer';
}

if (typeof module !== 'undefined') module.exports = { approvalRequest, readDecision, money, spacedIban };
