// Answer questions about stored invoices. The language model only turns the question into a filter;
// all matching and arithmetic happens here, so every number in the reply comes from the data.

function answerQuery(rows, q, today) {
  const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const iso = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  const f = {
    intent: ['list', 'total', 'by_seller', 'overdue', 'count', 'problems'].includes(q.intent) ? q.intent : 'list',
    seller: String(q.seller || '').trim(), search: String(q.search || '').trim(),
    status: ['ok', 'check'].includes(q.status) ? q.status : '',
    dateFrom: iso(q.dateFrom), dateTo: iso(q.dateTo), dueFrom: iso(q.dueFrom), dueTo: iso(q.dueTo),
    minAmount: Number.isFinite(Number(q.minAmount)) && q.minAmount !== '' && q.minAmount !== null ? Number(q.minAmount) : null,
    maxAmount: Number.isFinite(Number(q.maxAmount)) && q.maxAmount !== '' && q.maxAmount !== null ? Number(q.maxAmount) : null,
  };
  if (f.intent === 'overdue' && !f.dueTo) {
    const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); f.dueTo = d.toISOString().slice(0, 10);
  }
  if (f.intent === 'problems') f.status = 'check';

  const hit = rows.filter(r => {
    if (f.seller && !norm(r.sellerName).includes(norm(f.seller))) return false;
    if (f.search && ![r.sellerName, r.invoiceNumber, r.fileName, r.buyerName, r.emailSubject].some(v => norm(v).includes(norm(f.search)))) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.dateFrom && !(r.invoiceDate >= f.dateFrom)) return false;
    if (f.dateTo && !(r.invoiceDate <= f.dateTo)) return false;
    if ((f.dueFrom || f.dueTo) && !r.dueDate) return false;
    if (f.dueFrom && !(r.dueDate >= f.dueFrom)) return false;
    if (f.dueTo && !(r.dueDate <= f.dueTo)) return false;
    if (f.minAmount !== null && !(Number(r.grossAmount) >= f.minAmount)) return false;
    if (f.maxAmount !== null && !(Number(r.grossAmount) <= f.maxAmount)) return false;
    return true;
  }).sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)));

  const r2 = v => Math.round(v * 100) / 100;
  const totals = {};
  for (const r of hit) {
    const c = r.currency || '?';
    totals[c] = totals[c] || { net: 0, vat: 0, gross: 0, count: 0 };
    totals[c].net = r2(totals[c].net + Number(r.netAmount || 0));
    totals[c].vat = r2(totals[c].vat + Number(r.vatAmount || 0));
    totals[c].gross = r2(totals[c].gross + Number(r.grossAmount || 0));
    totals[c].count += 1;
  }
  const bySeller = Object.values(hit.reduce((m, r) => {
    const k = (r.sellerName || '?') + '|' + (r.currency || '');
    m[k] = m[k] || { seller: r.sellerName || '?', currency: r.currency || '', count: 0, gross: 0 };
    m[k].count += 1; m[k].gross = r2(m[k].gross + Number(r.grossAmount || 0));
    return m;
  }, {})).sort((a, b) => b.gross - a.gross);

  return { filter: f, count: hit.length, totals, bySeller: bySeller.slice(0, 10), rows: hit.slice(0, 15), more: Math.max(0, hit.length - 15) };
}

function formatResult(res, lang) {
  const de = lang !== 'en';
  const m = (v, c) => (v === null || v === undefined || v === '' ? '' :
    Number(v).toLocaleString(de ? 'de-DE' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (c ? ' ' + c : ''));
  const lines = [];
  const f = res.filter, dd = v => v.split('-').reverse().join('.');
  const parts = [f.seller && (de ? `Lieferant enthält „${f.seller}“` : `supplier contains "${f.seller}"`),
    f.search && (de ? `Suche „${f.search}“` : `search "${f.search}"`),
    f.status && `Status ${f.status}`,
    (f.dateFrom || f.dateTo) && (de ? 'Rechnungsdatum ' : 'invoice date ') + `${f.dateFrom ? dd(f.dateFrom) : '…'}–${f.dateTo ? dd(f.dateTo) : '…'}`,
    (f.dueFrom || f.dueTo) && (de ? 'fällig ' : 'due ') + `${f.dueFrom ? dd(f.dueFrom) : '…'}–${f.dueTo ? dd(f.dueTo) : '…'}`,
    f.minAmount !== null && `≥ ${f.minAmount}`, f.maxAmount !== null && `≤ ${f.maxAmount}`].filter(Boolean);
  const filterLine = '_Filter: ' + (parts.length ? parts.join(' · ') : (de ? 'alle Rechnungen' : 'all invoices')) + '_';
  const tot = Object.entries(res.totals);
  if (!res.count) return filterLine + '\n\n' + (de ? '_Keine passenden Rechnungen gefunden._' : '_No matching invoices found._');
  lines.push(filterLine, '');
  lines.push(tot.map(([c, t]) => (de ? `**${t.count} Rechnung(en)** · netto ${m(t.net, c)} · USt. ${m(t.vat, c)} · brutto **${m(t.gross, c)}**`
    : `**${t.count} invoice(s)** · net ${m(t.net, c)} · VAT ${m(t.vat, c)} · gross **${m(t.gross, c)}**`)).join('\n'));
  if (res.filter.intent === 'by_seller' || res.bySeller.length > 1) {
    lines.push('', de ? '| Lieferant | Anzahl | Brutto |' : '| Supplier | Count | Gross |', '|---|---:|---:|');
    for (const s of res.bySeller) lines.push(`| ${s.seller} | ${s.count} | ${m(s.gross, s.currency)} |`);
  }
  if (res.filter.intent !== 'total' && res.filter.intent !== 'count') {
    lines.push('', de ? '| Datum | Nr. | Lieferant | Brutto | Fällig | Status |' : '| Date | No. | Supplier | Gross | Due | Status |', '|---|---|---|---:|---|---|');
    for (const r of res.rows) lines.push(`| ${r.invoiceDate || ''} | ${r.invoiceNumber || ''} | ${r.sellerName || ''} | ${m(r.grossAmount, r.currency)} | ${r.dueDate || ''} | ${r.status || ''} |`);
    if (res.more) lines.push(de ? `_… und ${res.more} weitere._` : `_… and ${res.more} more._`);
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined') module.exports = { answerQuery, formatResult };
