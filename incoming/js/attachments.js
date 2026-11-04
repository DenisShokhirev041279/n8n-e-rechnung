// Which attachments are invoices: PDF and XML by content (not only by file name), ZIP archives unpacked.
// Needs inflateRaw from extract_xml.js. Nothing is dropped silently: skipped files are listed.

function sniffKind(buf, name, mime) {
  const head = buf.subarray(0, 1024).toString('latin1').replace(/^﻿|^ï»¿/, '').trimStart();
  if (head.startsWith('%PDF')) return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  if (head.startsWith('<')) return 'xml';
  if (/\.pdf$/i.test(name) || /pdf/i.test(mime || '')) return 'pdf';
  if (/\.xml$/i.test(name) || /xml/i.test(mime || '')) return 'xml';
  return null;
}

// ZIP via the central directory (sizes are reliable there even with data descriptors).
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > 500) throw new Error('ZIP: more than 500 files');
  let total = 0;
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP: broken central directory');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (flags & 1) { files.push({ name, error: 'encrypted' }); continue; }
    if (method === 0) files.push({ name, data: raw });
    else if (method === 8) {
      const data = inflateRaw(raw);
      total += data.length;
      if (total > 60 * 1024 * 1024) throw new Error('ZIP: unpacked size larger than 60 MB');
      files.push({ name, data });
    }
    else files.push({ name, error: 'compression method ' + method });
  }
  return files;
}

// entries: [{ name, mime, buf }] → { files: [{ name, buf, kind }], skipped: ['name (reason)'] }
function pickInvoiceFiles(entries, depth = 0) {
  const files = [], skipped = [];
  for (const e of entries) {
    const kind = sniffKind(e.buf, e.name, e.mime);
    if (kind === 'zip' && depth < 2) {
      try {
        const inner = unzip(e.buf);
        inner.filter(f => f.error).forEach(f => skipped.push(`${e.name}/${f.name} (${f.error})`));
        const r = pickInvoiceFiles(inner.filter(f => f.data).map(f => ({ name: f.name, mime: '', buf: f.data })), depth + 1);
        r.files.forEach(f => files.push({ ...f, name: f.name.split('/').pop(), fromZip: e.name }));
        r.skipped.forEach(s => skipped.push(`${e.name}/${s}`));
      } catch (err) {
        skipped.push(`${e.name} (ZIP could not be opened: ${err.message})`);
      }
    } else if (kind === 'pdf' || kind === 'xml') {
      files.push({ name: e.name, buf: e.buf, kind });
    } else if (!/\.(png|jpe?g|gif|svg|ics|vcf)$/i.test(e.name) || e.buf.length > 200000) {
      // small images are logos in signatures; anything else is listed so a person can look at it
      skipped.push(`${e.name} (not a PDF, XML or ZIP)`);
    }
  }
  return { files, skipped };
}

// Links in the mail body that look like an invoice download (portal invoices without attachment).
function invoiceLinks(text) {
  const urls = String(text || '').match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  const hit = /rechnung|invoice|faktura|beleg|billing|download|portal|kundencenter|mein-?konto|account/i;
  return [...new Set(urls.filter(u => hit.test(u)))].slice(0, 5);
}

if (typeof module !== 'undefined') module.exports = { sniffKind, unzip, pickInvoiceFiles, invoiceLinks };
