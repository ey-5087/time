/* 공휴일 계산 — 「관공서의 공휴일에 관한 규정」(2026.4.30 개정) 기준
 * 브라우저: window.FC.holidays / Node: module.exports
 */
(function (root) {
  'use strict';

  // 음력 공휴일·선거일·임시공휴일은 날짜 표로 관리 (한국천문연구원 월력요항 기준)
  const LUNAR = {
    2024: { seol: '2024-02-10', buddha: '2024-05-15', chuseok: '2024-09-17' },
    2025: { seol: '2025-01-29', buddha: '2025-05-05', chuseok: '2025-10-06' },
    2026: { seol: '2026-02-17', buddha: '2026-05-24', chuseok: '2026-09-25' },
    2027: { seol: '2027-02-07', buddha: '2027-05-13', chuseok: '2027-09-15' }
  };
  const ELECTIONS = {
    '2024-04-10': '국회의원선거일',
    '2025-06-03': '대통령선거일',
    '2026-06-03': '지방선거일'
  };
  const TEMPORARY = {
    '2024-10-01': '임시공휴일(국군의날)',
    '2025-01-27': '임시공휴일'
  };

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function fromDate(dt) { return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function addDays(s, n) { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return fromDate(dt); }
  function dow(s) { return toDate(s).getUTCDay(); }

  // 대체공휴일 적용 유형
  //  'weekend' : 토·일과 겹치면 대체 (국경일, 부처님오신날, 노동절, 어린이날, 기독탄신일)
  //  'sunday'  : 일요일과 겹칠 때만 대체 (설·추석 연휴)
  //  null      : 대체 없음 (1월 1일, 현충일, 선거일, 임시공휴일)
  function baseList(year) {
    const list = [];
    const add = (date, name, sub) => list.push({ date, name, sub });
    const from2026 = year >= 2026;

    add(ymd(year, 1, 1), '1월 1일', null);
    add(ymd(year, 3, 1), '3·1절', 'weekend');
    add(ymd(year, 5, 1), from2026 ? '노동절' : '근로자의날', from2026 ? 'weekend' : null);
    add(ymd(year, 5, 5), '어린이날', 'weekend');
    add(ymd(year, 6, 6), '현충일', null);
    if (from2026) add(ymd(year, 7, 17), '제헌절', 'weekend');
    add(ymd(year, 8, 15), '광복절', 'weekend');
    add(ymd(year, 10, 3), '개천절', 'weekend');
    add(ymd(year, 10, 9), '한글날', 'weekend');
    add(ymd(year, 12, 25), '기독탄신일', 'weekend');

    const l = LUNAR[year];
    if (l) {
      add(addDays(l.seol, -1), '설날 연휴', 'sunday');
      add(l.seol, '설날', 'sunday');
      add(addDays(l.seol, 1), '설날 연휴', 'sunday');
      add(l.buddha, '부처님 오신 날', 'weekend');
      add(addDays(l.chuseok, -1), '추석 연휴', 'sunday');
      add(l.chuseok, '추석', 'sunday');
      add(addDays(l.chuseok, 1), '추석 연휴', 'sunday');
    }
    Object.keys(ELECTIONS).forEach(d => { if (d.startsWith(year + '-')) add(d, ELECTIONS[d], null); });
    Object.keys(TEMPORARY).forEach(d => { if (d.startsWith(year + '-')) add(d, TEMPORARY[d], null); });
    return list;
  }

  const cache = {};
  // year → { 'YYYY-MM-DD': '이름' } (일요일 자체는 포함하지 않음)
  function holidaysOfYear(year) {
    if (cache[year]) return cache[year];
    const list = baseList(year);
    const map = {};
    list.forEach(h => { map[h.date] = map[h.date] ? map[h.date] + '·' + h.name : h.name; });

    const isPublic = d => dow(d) === 0 || map[d] !== undefined || subs[d] !== undefined;
    const subs = {};
    // 대체가 필요한 경우 수집 (날짜순)
    const needs = [];
    const byDate = {};
    list.forEach(h => { (byDate[h.date] = byDate[h.date] || []).push(h); });
    Object.keys(byDate).sort().forEach(d => {
      const hs = byDate[d];
      const w = dow(d);
      hs.forEach(h => {
        if (h.sub === 'weekend' && (w === 0 || w === 6)) needs.push(d);
        else if (h.sub === 'sunday' && w === 0) needs.push(d);
      });
      // 평일에 공휴일(2~10호)끼리 겹친 경우: 겹친 수 - 1 만큼 대체
      if (w !== 0 && w !== 6) {
        const n = hs.filter(h => h.sub).length;
        for (let i = 1; i < n; i++) needs.push(d);
      }
    });
    needs.forEach(d => {
      let c = addDays(d, 1);
      while (isPublic(c) || dow(c) === 6) c = addDays(c, 1);
      subs[c] = '대체공휴일';
    });
    const out = Object.assign({}, map);
    Object.keys(subs).forEach(d => { out[d] = out[d] ? out[d] + '·대체공휴일' : '대체공휴일'; });
    cache[year] = out;
    return out;
  }

  // 사용자 설정 반영: custom = [{date, name}], removed = ['YYYY-MM-DD']
  function holidayName(date, custom, removed) {
    if (removed && removed.indexOf(date) >= 0) return null;
    if (custom) {
      const c = custom.find(h => h.date === date);
      if (c) return c.name || '회사 휴일';
    }
    const y = Number(date.slice(0, 4));
    return holidaysOfYear(y)[date] || null;
  }

  // 'holiday' | 'offday' | 'workday'
  function dayType(date, custom, removed) {
    const w = dow(date);
    if (w === 0 || holidayName(date, custom, removed)) return 'holiday';
    if (w === 6) return 'offday';
    return 'workday';
  }

  function supportedYears() { return Object.keys(LUNAR).map(Number); }

  const api = { holidaysOfYear, holidayName, dayType, supportedYears, addDays, dow, toDate, fromDate };
  root.FC = root.FC || {};
  root.FC.holidays = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
