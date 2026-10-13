/* 근무 기록 파일 해석 — 근태 엑셀(월별근무현황), 간단 표(날짜|출근|퇴근|구분), CSV, v1 txt */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./calc.js') : root.FC.calc;
  const H = isNode ? require('./holidays.js') : root.FC.holidays;
  const X = isNode ? require('./xlsx-lite.js') : root.FC.xlsx;

  const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = n => String(n).padStart(2, '0');
  const norm = v => (v === null || v === undefined) ? '' : String(v).replace(/\s+/g, '');

  function serialToDate(serial) { // 엑셀 날짜 일련번호 → 'YYYY-MM-DD'
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return H.fromDate(dt);
  }
  function daysBetween(a, b) { return Math.round((H.toDate(b) - H.toDate(a)) / 86400000); }

  // 시각 셀 → 출근일 00:00 기준 분
  function cellToClock(v, rowDate) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
      if (v >= 1) {
        const d = serialToDate(v);
        return daysBetween(rowDate, d) * 1440 + Math.round((v - Math.floor(v)) * 1440);
      }
      return Math.round(v * 1440);
    }
    const s = String(v).trim();
    const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(s);
    if (m) {
      const d = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
      return daysBetween(rowDate, d) * 1440 + Number(m[4]) * 60 + Number(m[5]);
    }
    return C.parseHM(s);
  }
  // 시간(길이) 셀 → 분. 숫자는 1 미만이면 엑셀 시각 비율, 1 이상이면 시간 단위 숫자로 봄
  function cellToDuration(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v < 1 ? Math.round(v * 1440) : Math.round(v * 60);
    const s = String(v).trim();
    if (s === '-' ) return null;
    const hm = C.parseHM(s);
    if (hm !== null) return hm;
    const num = Number(s);
    return isFinite(num) && s !== '' ? Math.round(num * 60) : null;
  }
  function cellToDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && v > 20000) return serialToDate(v);
    const m = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(String(v));
    return m ? m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) : null;
  }

  const COLS = {
    date: s => /^(일자|날짜|일)$/.test(s),
    in: s => /^출근/.test(s),
    out: s => /^퇴근/.test(s),
    late: s => /^지각/.test(s),
    status: s => /^(근무상태|구분|근태|상태)$/.test(s),
    normal: s => /^정상/.test(s),
    ext: s => /^연장(\(|$)/.test(s),
    night: s => /^야간(\(|$)/.test(s)
  };

  // 2차원 배열 → 기록
  function parseRows(rows, fileName) {
    const res = { fileName, name: null, ym: null, records: [], warnings: [], failed: [] };
    let hr = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const row = rows[r] || [];
      row.forEach(c => {
        const s = norm(c);
        const ym = /(\d{4})년(\d{1,2})월/.exec(s);
        if (ym && !res.ym) res.ym = { y: Number(ym[1]), m: Number(ym[2]) };
        const nm = /성명[:：](.+)$/.exec(s);
        if (nm && !res.name) res.name = nm[1];
      });
      if (hr < 0 && row.some(c => COLS.date(norm(c)))) hr = r;
    }
    if (hr < 0) { res.warnings.push('머리글(일자/날짜)을 찾지 못했습니다.'); return res; }

    const col = {};
    [hr, hr + 1].forEach(r => (rows[r] || []).forEach((c, i) => {
      const s = norm(c);
      Object.keys(COLS).forEach(k => { if (col[k] === undefined && s && COLS[k](s)) col[k] = i; });
    }));
    const sub = rows[hr + 1] || [];
    const firstData = (sub[col.date] === null || sub[col.date] === undefined || sub[col.date] === '') && sub.some(c => /정상|연장|야간/.test(norm(c))) ? hr + 2 : hr + 1;

    let prev = null;
    for (let r = firstData; r < rows.length; r++) {
      const row = rows[r] || [];
      const raw = row[col.date];
      const s = norm(raw);
      if (!s) continue;
      if (/합계|소계|계$/.test(s)) break;

      let date = cellToDate(raw);
      if (!date) {
        const m = /^(\d{1,2})\(([일월화수목금토])\)/.exec(s);
        if (!m || !res.ym) { res.failed.push({ row: r + 1, text: String(raw) }); continue; }
        date = resolveDay(Number(m[1]), m[2], res.ym, prev);
        if (!date) { res.failed.push({ row: r + 1, text: String(raw) }); continue; }
      }
      prev = date;

      const rec = { date, in: null, out: null, status: '', excel: null };
      rec.in = cellToClock(row[col.in], date);
      rec.out = cellToClock(row[col.out], date);
      if (rec.in !== null && rec.out !== null && rec.out <= rec.in) rec.out += 1440;
      rec.status = col.status !== undefined ? String(row[col.status] ?? '').trim() : '';
      const ex = {
        normal: col.normal !== undefined ? cellToDuration(row[col.normal]) : null,
        ext: col.ext !== undefined ? cellToDuration(row[col.ext]) : null,
        night: col.night !== undefined ? cellToDuration(row[col.night]) : null,
        late: col.late !== undefined ? cellToDuration(row[col.late]) : null
      };
      if ([ex.normal, ex.ext, ex.night, ex.late].some(v => v !== null)) rec.excel = ex;
      rec.leave = C.leaveFromStatus(rec.status);
      res.records.push(rec);
    }
    if (res.records.length) {
      res.from = res.records[0].date;
      res.to = res.records[res.records.length - 1].date;
    }
    return res;
  }

  // "28(월)" → 기준 연월(앞뒤 한 달 포함)에서 요일이 맞는 날짜. 이전 행 다음 날을 우선
  function resolveDay(day, dowKo, ym, prev) {
    const cands = [];
    for (let k = -1; k <= 1; k++) {
      const dt = new Date(Date.UTC(ym.y, ym.m - 1 + k, day));
      if (dt.getUTCDate() !== day) continue;
      const d = H.fromDate(dt);
      if (DOW_KO[H.dow(d)] === dowKo) cands.push(d);
    }
    if (!cands.length) return null;
    if (prev) {
      const want = H.addDays(prev, 1);
      cands.sort((a, b) => Math.abs(daysBetween(want, a)) - Math.abs(daysBetween(want, b)));
      return cands[0];
    }
    const mid = ym.y + '-' + pad(ym.m) + '-15';
    cands.sort((a, b) => Math.abs(daysBetween(mid, a)) - Math.abs(daysBetween(mid, b)));
    return cands[0];
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.map(r => r.map(c => c === '' ? null : c));
  }

  // v1 txt: "2026년 10월" / "12 [월] 09:00 26:30" / "17 [토] 휴무"
  function parseTxt(text, fileName) {
    const res = { fileName, name: null, ym: null, records: [], warnings: [], failed: [] };
    let ym = null, prev = null;
    const now = new Date();
    text.split(/\r?\n/).forEach((line, idx) => {
      const t = line.trim();
      if (!t) return;
      const mh = /^(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월/.exec(t);
      if (mh && t.indexOf('[') < 0) {
        let y = mh[1] ? Number(mh[1]) : (ym ? ym.y : now.getFullYear());
        if (y < 100) y += 2000;
        const m = Number(mh[2]);
        if (ym && !mh[1] && m < ym.m) y = ym.y + 1;
        ym = { y, m };
        if (!res.ym) res.ym = ym;
        prev = null;
        return;
      }
      const dm = /^(\d{1,2})\s*\[\s*([일월화수목금토])\s*\]\s*(.*)$/.exec(t);
      if (!dm || !ym) { res.failed.push({ row: idx + 1, text: t }); return; }
      const date = resolveDay(Number(dm[1]), dm[2], ym, prev);
      if (!date) { res.failed.push({ row: idx + 1, text: t }); return; }
      prev = date;
      const tm = /(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/.exec(dm[3]);
      const status = dm[3].replace(/\d{1,2}:\d{2}/g, '').trim();
      const rec = { date, in: null, out: null, status, excel: null, leave: C.leaveFromStatus(status) };
      if (tm) {
        rec.in = C.parseHM(tm[1]);
        rec.out = C.parseHM(tm[2]);
        if (rec.out <= rec.in) rec.out += 1440;
      }
      res.records.push(rec);
    });
    if (res.records.length) { res.from = res.records[0].date; res.to = res.records[res.records.length - 1].date; }
    return res;
  }

  async function parseFile(name, arrayBuffer) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      return parseRows(await X.readXlsx(arrayBuffer), name);
    }
    if (lower.endsWith('.xls')) throw new Error('예전 .xls 형식은 읽을 수 없습니다. 엑셀에서 .xlsx로 저장한 뒤 올려 주세요.');
    let text = new TextDecoder('utf-8').decode(arrayBuffer);
    if (text.indexOf('�') >= 0) { try { text = new TextDecoder('euc-kr').decode(arrayBuffer); } catch (e) { /* utf-8 유지 */ } }
    text = text.replace(/^﻿/, '');
    if (lower.endsWith('.csv')) return parseRows(parseCSV(text), name);
    if (/\[\s*[일월화수목금토]\s*\]/.test(text)) return parseTxt(text, name);
    return parseRows(parseCSV(text), name);
  }

  const api = { parseRows, parseTxt, parseCSV, parseFile, resolveDay, cellToClock, cellToDuration };
  root.FC = root.FC || {};
  root.FC.io = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
