/* 최소 .xlsx 리더 — 첫 번째 시트의 셀 값을 2차원 배열로 반환
 * 외부 라이브러리 없이 브라우저 내장 DecompressionStream('deflate-raw') 사용
 */
(function (root) {
  'use strict';

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ZIP 중앙 디렉터리에서 파일 목록 읽기
  function listZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('xlsx 파일이 아닙니다 (ZIP 구조 없음)');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
      files[name] = { method, csize, off };
      p += 46 + nlen + xlen + clen;
    }
    return files;
  }

  async function readEntry(buf, f) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const nlen = dv.getUint16(f.off + 26, true), xlen = dv.getUint16(f.off + 28, true);
    const start = f.off + 30 + nlen + xlen;
    const data = buf.subarray(start, start + f.csize);
    const raw = f.method === 0 ? data : await inflateRaw(data);
    return new TextDecoder('utf-8').decode(raw);
  }

  function unescapeXml(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/g, '&');
  }
  function textOf(xml) { // <t> 조각을 모두 이어 붙임 (서식 있는 문자열 대응)
    let out = '';
    xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (_, t) => { out += unescapeXml(t); return ''; });
    return out;
  }
  function colIndex(ref) {
    const letters = /^[A-Z]+/.exec(ref)[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function readXlsx(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const files = listZip(buf);
    const get = async name => files[name] ? readEntry(buf, files[name]) : null;

    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await get('xl/workbook.xml');
    const rels = await get('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const sm = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
      if (sm) {
        const re = new RegExp('<Relationship\\b[^>]*Id="' + sm[1] + '"[^>]*/?>');
        const rm = re.exec(rels);
        const tm = rm && /Target="([^"]+)"/.exec(rm[0]);
        if (tm) sheetPath = tm[1].startsWith('/') ? tm[1].slice(1) : 'xl/' + tm[1].replace(/^\.\//, '');
      }
    }
    const sheet = await get(sheetPath);
    if (!sheet) throw new Error('시트를 찾을 수 없습니다');

    const shared = [];
    const ss = await get('xl/sharedStrings.xml');
    if (ss) ss.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, si) => { shared.push(textOf(si)); return ''; });

    const rows = [];
    sheet.replace(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, (rowXml, inner) => {
      const rn = /\br="(\d+)"/.exec(rowXml);
      const ri = rn ? Number(rn[1]) - 1 : rows.length;
      const row = [];
      (inner || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (_, attrs, body) => {
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs);
        const ci = ref ? colIndex(ref[1]) : row.length;
        const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1] || 'n';
        body = body || '';
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        let val = null;
        if (t === 's') val = vm ? (shared[Number(vm[1])] ?? '') : null;
        else if (t === 'inlineStr') val = textOf(body);
        else if (t === 'str' || t === 'e') val = vm ? unescapeXml(vm[1]) : null;
        else if (t === 'b') val = vm ? vm[1] === '1' : null;
        else val = vm ? Number(vm[1]) : null;
        row[ci] = val;
        return '';
      });
      rows[ri] = row;
      return '';
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  const api = { readXlsx };
  root.FC = root.FC || {};
  root.FC.xlsx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
