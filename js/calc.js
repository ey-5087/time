/* 보상시간 계산 엔진 — 기획서 5~6장
 * 모든 시간은 "분" 단위 정수. 시각은 출근일 00:00 기준 분 (26:00 = 1560).
 */
(function (root) {
  'use strict';
  const H = (typeof module !== 'undefined' && module.exports) ? require('./holidays.js') : root.FC.holidays;

  const HOUR = 60;
  const WORK_START = 9 * HOUR;
  const LUNCH = [12 * HOUR, 13 * HOUR];
  const NORMAL_END = 18 * HOUR;
  const EXT = [18 * HOUR + 30, 22 * HOUR];     // 18:00~18:30 저녁 휴게 → 연장 최대 3:30
  const EXT_MAX = EXT[1] - EXT[0];
  const NIGHT = [22 * HOUR, 30 * HOUR];
  const CAP = 30 * HOUR;                         // 다음 날 06:00
  const HALF_DAY_START = 13 * HOUR;              // 오전 반차 후 시업
  const LEAVE_FULL = 8 * HOUR, LEAVE_HALF = 4 * HOUR;
  const HOLIDAY_BASE = 8 * HOUR;

  /* ---------- 시간 문자열 ---------- */
  // 'H:MM', 'HH:MM', '26:30' → 분. 숫자(엑셀 시각 비율)도 허용. 실패 시 null
  function parseHM(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Math.round(v * 24 * 60);
    const m = /^\s*(\d{1,3}):(\d{2})(?::\d{2})?\s*$/.exec(String(v));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function fmtHM(min) {
    if (min === null || min === undefined) return '';
    const sign = min < 0 ? '-' : '';
    const a = Math.abs(Math.round(min));
    return sign + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0');
  }
  function fmtClock(min) { // 시각 표기 (두 자리 시)
    if (min === null || min === undefined) return '';
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  function fmtDec(min) { return (min / 60).toFixed(2); }

  // v1 규칙: 끝자리 8·9분은 올림, 나머지는 버림 (10분 단위)
  function roundTo10(min) {
    if (!min || min < 0) return min > 0 ? min : 0;
    const last = min % 10;
    return (last === 8 || last === 9) ? Math.ceil(min / 10) * 10 : Math.floor(min / 10) * 10;
  }
  function overlap(a1, a2, b1, b2) { const s = Math.max(a1, b1), e = Math.min(a2, b2); return e > s ? e - s : 0; }

  /* ---------- 하루: 출퇴근 → 정상/연장/야간/지각 ---------- */
  // type: 'workday' | 'offday' | 'holiday', leave: '' | '연차' | '오전반차' | '오후반차' | '결근'
  function autoCalc(inMin, outMin, type, leave) {
    const r = { normal: 0, ext: 0, night: 0, late: 0, capped: false };
    if (leave === '결근') return r;
    let credit = 0;
    if (leave === '연차') { r.normal = LEAVE_FULL; return r; }
    if (leave === '오전반차' || leave === '오후반차') credit = LEAVE_HALF;

    if (inMin !== null && outMin !== null) {
      let out = outMin;
      if (out <= inMin) out += 24 * HOUR;          // 자정 넘김 입력 (02:00 → 26:00)
      if (out > CAP) { out = CAP; r.capped = true; }
      const base = leave === '오전반차' ? HALF_DAY_START : WORK_START;
      let start;
      if (type === 'workday') {
        start = Math.min(base, out);               // 지각해도 시업부터 산정하고 지각을 따로 공제
        if (inMin > base) {
          const lateEnd = Math.min(inMin, out);
          r.late = (lateEnd - base) - overlap(base, lateEnd, LUNCH[0], LUNCH[1]) - overlap(base, lateEnd, NORMAL_END, EXT[0]);
        }
      } else {
        start = Math.max(inMin, WORK_START);
      }
      if (out > start) {
        r.normal = overlap(start, out, WORK_START, NORMAL_END) - overlap(start, out, LUNCH[0], LUNCH[1]);
        r.ext = overlap(start, out, EXT[0], EXT[1]);
        r.night = overlap(start, out, NIGHT[0], NIGHT[1]);
      }
    }
    r.normal = Math.min(LEAVE_FULL, roundTo10(r.normal + credit));
    r.ext = roundTo10(r.ext);
    r.night = roundTo10(r.night);
    r.late = roundTo10(Math.max(0, r.late));
    return r;
  }

  function hasVals(v) { return !!v && ['normal', 'ext', 'night'].some(k => v[k] !== null && v[k] !== undefined); }

  /* 하루 기록 → 계산에 쓸 값
   * rec: { in, out, leave, status, excel:{normal,ext,night,late}|null, manual:{normal,ext,night,late}|null }
   */
  function effectiveDay(rec, type) {
    const leave = rec.leave || leaveFromStatus(rec.status);
    // 탄력 조정일: 근태상 근무로 간주되지만 실제 근로가 아니므로 계산에서는 0 (근태 엑셀·수정값보다 우선)
    if (leave === '탄력조정') {
      return { src: 'adjust', auto: autoCalc(null, null, type, ''), capped: false, normal: 0, ext: 0, night: 0, late: 0, total: 0 };
    }
    const auto = autoCalc(rec.in ?? null, rec.out ?? null, type, leave);
    let src = 'none', v = null;
    if (hasVals(rec.manual)) { src = 'manual'; v = rec.manual; }
    else if (hasVals(rec.excel)) { src = 'excel'; v = rec.excel; }
    const out = { src, auto, capped: auto.capped };
    if (v) {
      out.normal = roundTo10(v.normal || 0);
      out.ext = roundTo10(v.ext || 0);
      out.night = roundTo10(v.night || 0);
      const lateSrc = (v.late !== null && v.late !== undefined) ? v.late
        : (rec.excel && rec.excel.late !== null && rec.excel.late !== undefined) ? rec.excel.late : auto.late;
      out.late = roundTo10(lateSrc || 0);
    } else {
      const usable = (rec.in !== null && rec.in !== undefined && rec.out !== null && rec.out !== undefined)
        || ['연차', '오전반차', '오후반차'].indexOf(rec.leave || leaveFromStatus(rec.status)) >= 0;
      if (usable) out.src = 'auto';
      out.normal = usable ? auto.normal : 0;
      out.ext = usable ? auto.ext : 0;
      out.night = usable ? auto.night : 0;
      const xl = rec.excel && rec.excel.late;
      out.late = usable ? (xl !== null && xl !== undefined ? roundTo10(xl) : auto.late) : 0;
    }
    if (out.night > NIGHT[1] - NIGHT[0]) { out.night = NIGHT[1] - NIGHT[0]; out.capped = true; }
    if (type !== 'workday') out.late = 0;          // 휴일·휴무일은 지각 없음
    out.total = out.normal + out.ext + out.night;
    return out;
  }

  function leaveFromStatus(status) {
    if (!status) return '';
    const s = String(status).replace(/\s/g, '');
    if (s.indexOf('오전반차') >= 0) return '오전반차';
    if (s.indexOf('오후반차') >= 0) return '오후반차';
    if (s.indexOf('연차') >= 0 || s === '휴가') return '연차';
    if (s.indexOf('결근') >= 0) return '결근';
    if (s.indexOf('탄력조정') >= 0) return '탄력조정';
    return '';
  }

  // 엑셀 근무상태와 달력 판정이 휴일 여부에서 다른지
  function statusMismatch(status, type) {
    if (!status) return false;
    const s = String(status);
    if (/휴무/.test(s)) return type === 'holiday';
    if (/휴일/.test(s)) return type !== 'holiday';
    return false;
  }

  /* ---------- 합의서 ---------- */
  const TYPES = {
    '2w': { label: '2주 이내 (취업규칙)', maxWeeks: 2, weekCap: 48 },
    '3m': { label: '3개월 이내 (서면 합의)', maxDays: 92, weekCap: 52 },
    '6m': { label: '3개월 초과 6개월 이내 (서면 합의)', maxDays: 184, weekCap: 52 }
  };
  function agreementWarnings(ag) {
    const w = [];
    if (!ag || !ag.start || !ag.weeks || !ag.weeks.length) return w;
    const t = TYPES[ag.type] || TYPES['3m'];
    const n = ag.weeks.length;
    if (t.maxWeeks && n > t.maxWeeks) w.push('단위기간 ' + n + '주가 ' + t.label + '의 최대 기간을 넘습니다.');
    if (t.maxDays && n * 7 > t.maxDays) w.push('단위기간 ' + n + '주가 ' + t.label + '의 최대 기간을 넘습니다.');
    const avg = ag.weeks.reduce((a, x) => a + (Number(x.regular) || 0), 0) / n;
    if (avg > 40 + 1e-9) w.push('정규근무 평균이 ' + avg.toFixed(1) + '시간으로 주 40시간을 넘습니다.');
    ag.weeks.forEach((x, i) => {
      const reg = Number(x.regular) || 0, ot = Number(x.fixedOT) || 0;
      if (reg > t.weekCap) w.push((i + 1) + '주차 정규근무 ' + reg + '시간이 주 ' + t.weekCap + '시간 한도를 넘습니다.');
      if (x.written !== null && x.written !== undefined && x.written !== '' && Number(x.written) !== reg + ot)
        w.push((i + 1) + '주차 근로시간 ' + x.written + '이 정규 ' + reg + ' + 연장 ' + ot + ' = ' + (reg + ot) + '과 다릅니다. 계산은 ' + (reg + ot) + '시간 기준.');
    });
    return w;
  }

  /* ---------- 탄력 조정일 자동 반영 ----------
   * 따로 지정하지 않았더라도, 그 주 정상(A) 합계가 합의 정규를 넘으면 넘는 만큼을
   * 그 주의 마지막 날부터 거꾸로 "정상만 있는 근로일"(연장·야간 없음, 연차·반차 아님)에서 탄력 조정일로 봅니다.
   * 하루치 정상 시간이 남은 초과분보다 크면 그날은 조정하지 않습니다 (실제 근무로 봄).
   * 근태를 '정상 근무(조정 안 함)'로 지정한 날은 제외합니다.
   */
  function autoAdjust(dayList, A) {
    let excess = dayList.reduce((a, d) => a + (d.eff && d.type !== 'holiday' ? d.eff.normal : 0), 0) - A;
    for (let k = dayList.length - 1; k >= 0 && excess > 0; k--) {
      const d = dayList[k], e = d.eff;
      if (!e || d.type !== 'workday' || (e.src !== 'excel' && e.src !== 'auto')) continue;
      const leave = d.rec.leave || leaveFromStatus(d.rec.status);
      if (leave || e.ext || e.night || !e.normal || e.normal > excess) continue;
      excess -= e.normal;
      d.eff = { src: 'adjust', autoAdjusted: true, auto: e.auto, capped: false, normal: 0, ext: 0, night: 0, late: 0, total: 0 };
    }
  }

  /* ---------- 주·단위기간 정산 ---------- */
  // state: { agreement:{type,start,weeks:[{regular,fixedOT,written}]}, days:{date:rec}, customHolidays, removedHolidays }
  function compute(state) {
    const ag = state.agreement || {};
    const days = state.days || {};
    const custom = state.customHolidays || [], removed = state.removedHolidays || [];
    const weeks = [];
    const total = { W: 0, OT: 0, OTx: 0, H1: 0, H2: 0, N: 0, L: 0, comp: 0, otPay: 0, holPay: 0, nightPay: 0 };
    const inPeriod = {};
    const n = (ag.start && ag.weeks) ? ag.weeks.length : 0;

    for (let i = 0; i < n; i++) {
      const wk = ag.weeks[i];
      const A = Math.round((Number(wk.regular) || 0) * HOUR);
      const F = Math.round((wk.fixedOT === '' || wk.fixedOT === undefined || wk.fixedOT === null ? 12 : Number(wk.fixedOT)) * HOUR);
      const r = { index: i + 1, start: H.addDays(ag.start, i * 7), A, F, days: [], W: 0, H1: 0, H2: 0, N: 0, L: 0, SA: 0, SB: 0, SC: 0, HA: 0, HB: 0, HC: 0, hasData: false };
      for (let d = 0; d < 7; d++) {
        const date = H.addDays(ag.start, i * 7 + d);
        inPeriod[date] = true;
        const type = H.dayType(date, custom, removed);
        const rec = days[date];
        r.days.push({ date, type, rec, eff: rec ? effectiveDay(rec, type) : null });
      }
      autoAdjust(r.days, A);
      for (const { type, eff: e } of r.days) {
        if (!e) continue;
        if (e.src !== 'none') r.hasData = true;
        if (type === 'holiday') {
          r.H1 += Math.min(e.total, HOLIDAY_BASE);
          r.H2 += Math.max(0, e.total - HOLIDAY_BASE);
        } else {
          r.W += e.total;
        }
        r.N += e.night;
        // 화면 표시용 정상·연장·야간 주 합계: 근로일·휴무일(S)과 휴일(H)을 나눠 집계
        if (type === 'holiday') { r.HA += e.normal; r.HB += e.ext; r.HC += e.night; }
        else { r.SA += e.normal; r.SB += e.ext; r.SC += e.night; }
        r.L += e.late;
      }
      r.end = H.addDays(r.start, 6);
      r.OT = Math.max(0, r.W - A);
      r.OTx = Math.max(0, r.OT - F);
      // 합의 기준 분류: 합의한 정규 시간까지는 시간대와 상관없이 정규, 넘은 부분만 연장
      r.REG = Math.min(r.W, A);
      r.OTin = Math.min(r.OT, F);
      r.otPay = r.OTx * 1.5;
      r.holPay = r.H1 * 1.5 + r.H2 * 2.0;
      r.nightPay = r.N * 0.5;
      r.comp = r.otPay + r.holPay + r.nightPay;   // 지각(L)은 공제하지 않고 따로 표시 — 추후 별도 공제
      weeks.push(r);
      ['W', 'OT', 'OTx', 'H1', 'H2', 'N', 'L', 'comp', 'otPay', 'holPay', 'nightPay'].forEach(k => { total[k] += r[k]; });
    }
    const outside = Object.keys(days).filter(d => !inPeriod[d] && days[d] && (hasVals(days[d].excel) || hasVals(days[d].manual) || days[d].in != null)).sort();
    return { weeks, total, outside, warnings: agreementWarnings(ag) };
  }

  const api = {
    HOUR, CAP, EXT_MAX, parseHM, fmtHM, fmtClock, fmtDec, roundTo10, autoCalc, effectiveDay,
    leaveFromStatus, statusMismatch, agreementWarnings, compute, TYPES
  };
  root.FC = root.FC || {};
  root.FC.calc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
