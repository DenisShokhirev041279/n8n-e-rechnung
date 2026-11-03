// Extract the embedded e-invoice XML (ZUGFeRD / Factur-X / XRechnung) from a PDF/A-3.
// Pure JavaScript: no require(), no zlib, no external API. Runs in the n8n Code node sandbox.

// --- Minimal inflate (RFC 1951), adapted from the public-domain "tinf" approach ---
function inflateRaw(src) {
  const out = [];
  let pos = 0, bitBuf = 0, bitCnt = 0;
  const bits = n => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('inflate: unexpected end of data');
      bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n; bitCnt -= n;
    return v;
  };
  const build = lengths => {
    const counts = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(lengths.length);
    for (const l of lengths) counts[l]++;
    counts[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    lengths.forEach((l, s) => { if (l) symbols[offs[l]++] = s; });
    return { counts, symbols };
  };
  const decode = t => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = t.counts[len];
      if (code - first < c) return t.symbols[index + code - first];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  let fixedL, fixedD;
  const fixed = () => {
    if (!fixedL) {
      const l = new Array(288);
      for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
      fixedL = build(l); fixedD = build(new Array(30).fill(5));
    }
    return [fixedL, fixedD];
  };
  const ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
  const dynamic = () => {
    const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
    const cl = new Array(19).fill(0);
    for (let i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
    const clt = build(cl);
    const lens = [];
    while (lens.length < hlit + hdist) {
      const sym = decode(clt);
      if (sym < 16) lens.push(sym);
      else if (sym === 16) { const p = lens[lens.length - 1]; for (let r = 3 + bits(2); r; r--) lens.push(p); }
      else if (sym === 17) for (let r = 3 + bits(3); r; r--) lens.push(0);
      else for (let r = 11 + bits(7); r; r--) lens.push(0);
    }
    return [build(lens.slice(0, hlit)), build(lens.slice(hlit))];
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < len; i++) out.push(src[pos++]);
    } else if (type === 1 || type === 2) {
      const [lt, dt] = type === 1 ? fixed() : dynamic();
      for (;;) {
        const sym = decode(lt);
        if (sym < 256) out.push(sym);
        else if (sym === 256) break;
        else {
          const li = sym - 257, len = LBASE[li] + bits(LEXT[li]);
          const di = decode(dt), dist = DBASE[di] + bits(DEXT[di]);
          for (let i = 0; i < len; i++) out.push(out[out.length - dist]);
        }
      }
    } else throw new Error('inflate: invalid block type');
  } while (!last);
  return Buffer.from(out);
}

// zlib stream (FlateDecode) = 2-byte header + raw deflate + adler32
const inflateZlib = buf => inflateRaw(buf.subarray(2));

// Find every stream whose dictionary marks it as an embedded file, decode it, keep the XML.
function extractEmbeddedXml(pdf) {
  const text = pdf.toString('latin1');
  const found = [];
  const re = /<<((?:(?!>>\s*stream)[\s\S]){0,2000})>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const dict = m[1];
    if (!/\/Type\s*\/EmbeddedFile\b/.test(dict) && !/\/Subtype\s*\/(text#2Fxml|application#2Fxml)/.test(dict)) continue;
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) continue;
    let raw = pdf.subarray(start, end);
    let data;
    try {
      data = /\/FlateDecode/.test(dict) ? inflateZlib(raw) : raw;
    } catch (e) {
      continue;
    }
    const xml = data.toString('utf8').replace(/^﻿/, '').trim();
    if (/<(\w+:)?(CrossIndustryInvoice|CrossIndustryDocument|Invoice|CreditNote)\b/.test(xml)) found.push(xml);
  }
  return found;
}

if (typeof module !== 'undefined') module.exports = { inflateRaw, extractEmbeddedXml };
