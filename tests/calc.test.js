// 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const H = require('../js/holidays.js');
const io = require('../js/io.js');

const hm = s => C.parseHM(s);
const fmt = m => C.fmtHM(m);

test('공휴일 2026 (노동절·제헌절·대체공휴일)', () => {
  const y = H.holidaysOfYear(2026);
  assert.equal(y['2026-05-01'], '노동절');
  assert.equal(y['2026-07-17'], '제헌절');
  for (const d of ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05']) assert.equal(y[d], '대체공휴일', d);
  assert.equal(y['2026-09-28'], undefined, '추석(9/24~26)은 일요일과 겹치지 않아 대체 없음');
  assert.equal(y['2026-06-08'], undefined, '현충일은 대체 없음');
  assert.equal(H.dayType('2026-10-03'), 'holiday', '토요일 공휴일은 휴일');
  assert.equal(H.dayType('2026-10-10'), 'offday');
  assert.equal(H.dayType('2026-10-11'), 'holiday');
  assert.equal(H.dayType('2026-10-12'), 'workday');
});

test('공휴일 2024·2025 대체공휴일', () => {
  assert.equal(H.holidaysOfYear(2024)['2024-02-12'], '대체공휴일');
  assert.equal(H.holidaysOfYear(2024)['2024-05-06'], '대체공휴일');
  assert.equal(H.holidaysOfYear(2025)['2025-05-06'], '대체공휴일', '어린이날·부처님 오신 날 겹침');
  assert.equal(H.holidaysOfYear(2025)['2025-10-08'], '대체공휴일');
});

test('회사 휴일 추가·공휴일 제외', () => {
  assert.equal(H.dayType('2026-10-13', [{ date: '2026-10-13', name: '창립기념일' }], []), 'holiday');
  assert.equal(H.dayType('2026-10-09', [], ['2026-10-09']), 'workday');
});

test('10분 단위 (8·9분 올림)', () => {
  assert.equal(C.roundTo10(37), 30);
  assert.equal(C.roundTo10(38), 40);
  assert.equal(C.roundTo10(82), 80);
  assert.equal(C.roundTo10(149), 150);
});

// 기획서 5.7 예시
const cases = [
  ['① 근로일 08:40~18:00', '08:40', '18:00', 'workday', [480, 0, 0, 0]],
  ['② 근로일 09:00~26:30', '09:00', '26:30', 'workday', [480, 210, 270, 0]],
  ['③ 근로일 09:00~31:00 상한', '09:00', '31:00', 'workday', [480, 210, 480, 0]],
  ['④ 근로일 10:20~19:00 지각', '10:20', '19:00', 'workday', [480, 30, 0, 80]],
  ['⑤ 근로일 09:00~18:30', '09:00', '18:30', 'workday', [480, 0, 0, 0]],
  ['⑥ 휴일 09:00~20:00', '09:00', '20:00', 'holiday', [480, 90, 0, 0]],
  ['⑦ 휴일 13:00~20:00', '13:00', '20:00', 'holiday', [300, 90, 0, 0]],
  ['⑧ 휴무일 09:00~15:00', '09:00', '15:00', 'offday', [300, 0, 0, 0]]
];
for (const [name, i, o, type, [n, e, ni, l]] of cases) {
  test('하루 계산 ' + name, () => {
    const r = C.autoCalc(hm(i), hm(o), type, '');
    assert.deepEqual([r.normal, r.ext, r.night, r.late], [n, e, ni, l],
      [r.normal, r.ext, r.night, r.late].map(fmt).join(' '));
  });
}

test('02:00 입력과 26:00 입력은 같다', () => {
  assert.deepEqual(C.autoCalc(hm('09:00'), hm('02:00'), 'workday', ''), C.autoCalc(hm('09:00'), hm('26:00'), 'workday', ''));
});

test('연차·반차', () => {
  assert.equal(C.autoCalc(null, null, 'workday', '연차').normal, 480);
  const am = C.autoCalc(hm('12:50'), hm('18:00'), 'workday', '오전반차');
  assert.equal(am.normal, 480);
  assert.equal(am.late, 0);
  assert.equal(C.autoCalc(null, null, 'workday', '결근').normal, 0);
});

test('엑셀 값 우선, 수동 값 최우선, 야간 8시간 상한', () => {
  const rec = { in: hm('09:00'), out: hm('23:00'), excel: { normal: 480, ext: 150, night: 60, late: null }, manual: null };
  let e = C.effectiveDay(rec, 'workday');
  assert.equal(e.src, 'excel');
  assert.equal(e.total, 480 + 150 + 60);
  rec.manual = { normal: 480, ext: 180, night: 60, late: 0 };
  e = C.effectiveDay(rec, 'workday');
  assert.equal(e.src, 'manual');
  assert.equal(e.ext, 180);
  e = C.effectiveDay({ excel: { normal: 480, ext: 180, night: 600 } }, 'workday');
  assert.equal(e.night, 480);
  assert.equal(e.capped, true);
});

test('정상·연장·야간이 비어 있으면 출퇴근으로 자동 계산', () => {
  const e = C.effectiveDay({ in: hm('10:22'), out: hm('23:26'), excel: { normal: null, ext: null, night: null, late: 82 } }, 'workday');
  assert.equal(e.src, 'auto');
  assert.deepEqual([e.normal, e.ext, e.night, e.late], [480, 210, 80, 80]);
});

function weekState(regular, list) {
  const days = {};
  list.forEach(([date, normal, ext, night, late]) => { days[date] = { excel: { normal: normal * 60, ext: ext * 60, night: night * 60, late: (late || 0) * 60 } }; });
  return { agreement: { type: '3m', start: '2026-10-12', weeks: [{ regular, fixedOT: 12, written: regular + 12 }] }, days };
}

test('기획서 6.3 주 단위 예시: 17시간', () => {
  // 월 09~26시 = 정상 8, 연장 3:30, 야간 4 / 화~금 8 / 토 5 / 일(휴일) 9:30
  const st = weekState(44, [
    ['2026-10-12', 8, 3.5, 4], ['2026-10-13', 8, 0, 0], ['2026-10-14', 8, 0, 0], ['2026-10-15', 8, 0, 0],
    ['2026-10-16', 8, 0, 0], ['2026-10-17', 5, 0, 0], ['2026-10-18', 8, 1.5, 0]
  ]);
  const w = C.compute(st).weeks[0];
  assert.equal(w.W, 52.5 * 60);
  assert.equal(w.OT, 8.5 * 60);
  assert.equal(w.OTx, 0);
  assert.equal(w.holPay, 15 * 60);
  assert.equal(w.nightPay, 2 * 60);
  assert.equal(w.comp, 17 * 60);
});

test('합의 32시간 주에 50시간: 연장 18h → 고정 OT 초과 6h × 1.5 = 9h', () => {
  const st = weekState(32, [
    ['2026-10-12', 8, 2, 0], ['2026-10-13', 8, 2, 0], ['2026-10-14', 8, 2, 0], ['2026-10-15', 8, 2, 0], ['2026-10-16', 8, 2, 0]
  ]);
  const w = C.compute(st).weeks[0];
  assert.equal(w.OT, 18 * 60);
  assert.equal(w.OTx, 6 * 60);
  assert.equal(w.comp, 9 * 60);
});

test('지각은 공제하지 않고 따로 집계', () => {
  const st = weekState(40, [['2026-10-12', 8, 0, 0, 1.5]]);
  const w = C.compute(st).weeks[0];
  assert.equal(w.comp, 0);
  assert.equal(w.L, 90);
});

test('휴일근로는 연장가산과 중복하지 않음 (8h 이내 1.5, 초과 2.0)', () => {
  const st = weekState(40, [
    ['2026-10-12', 8, 0, 0], ['2026-10-13', 8, 0, 0], ['2026-10-14', 8, 0, 0], ['2026-10-15', 8, 0, 0], ['2026-10-16', 8, 0, 0],
    ['2026-10-18', 8, 2, 0]
  ]);
  const w = C.compute(st).weeks[0];
  assert.equal(w.OT, 0);
  assert.equal(w.comp, 16 * 60);
});

test('합의서 경고: 근로시간 오타, 평균 40 초과', () => {
  const w = C.agreementWarnings({ type: '3m', start: '2026-09-21', weeks: [{ regular: 24, fixedOT: 12, written: 26 }] });
  assert.ok(w.some(s => s.indexOf('26') >= 0 && s.indexOf('36') >= 0));
  const w2 = C.agreementWarnings({ type: '3m', start: '2026-09-21', weeks: [{ regular: 48, fixedOT: 12, written: 60 }] });
  assert.ok(w2.some(s => s.indexOf('평균') >= 0));
});

test('근태 엑셀 일자 해석: 앞뒤 달 판별', () => {
  const ym = { y: 2026, m: 10 };
  let d = io.resolveDay(28, '월', ym, null);
  assert.equal(d, '2026-09-28');
  assert.equal(io.resolveDay(1, '목', ym, '2026-09-30'), '2026-10-01');
  assert.equal(io.resolveDay(1, '일', ym, '2026-10-31'), '2026-11-01');
  assert.equal(io.resolveDay(31, '월', { y: 2026, m: 9 }, null), '2026-08-31');
});

test('근태 표 해석 (월별근무현황 형식)', () => {
  const rows = [
    [], [null, '월별근무현황(개인)'],
    [null, null, null, null, null, null, null, null, '날짜 : 2026년 10월', null, '성명 : 홍길동'],
    ['일자', '출근', '퇴근', '지각시간', '근무상태', '실근무시간', null, null, '보상시간'],
    [null, null, null, null, null, '정상(A)', '연장(B)', '야간(C)', '연장소계', '합계'],
    ['28(월)', '08:52', '23:28', null, '정상', '8:00', '3:00', '1:30', null, '1:55'],
    ['30(수)', '08:52', '2026-10-01 00:25', null, '정상', '8:00', '3:00', '2:20'],
    ['02(금)', '10:22', '23:26', '1:22', '정상'],
    ['합계']
  ];
  const r = io.parseRows(rows, 't.xlsx');
  assert.equal(r.name, '홍길동');
  assert.equal(r.records.length, 3);
  const [a, b, c] = r.records;
  assert.equal(a.date, '2026-09-28');
  assert.deepEqual(a.excel, { normal: 480, ext: 180, night: 90, late: null });
  assert.equal(b.out, 24 * 60 + 25);
  assert.equal(c.date, '2026-10-02');
  assert.equal(c.excel.late, 82);
  assert.equal(c.excel.normal, null);
});

test('v1 txt 해석', () => {
  const r = io.parseTxt('2026년 10월\n12 [월] 09:00 02:30\n17 [토] 휴무\n19 [월] 연차\n', 'a.txt');
  assert.equal(r.records.length, 3);
  assert.equal(r.records[0].out, 26 * 60 + 30);
  assert.equal(r.records[2].leave, '연차');
});

test('화면 버전과 CHANGELOG.md 최신 항목이 같다', () => {
  const V = require('../js/version.js');
  const md = require('fs').readFileSync(require('path').join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const top = /^## v(\d+\.\d+\.\d+)/m.exec(md)[1];
  assert.equal(V.APP_VERSION, top);
  assert.match(V.APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('합의 기준 분류: 합의 정규까지는 정규, 넘은 부분만 연장', () => {
  // 정규 52 합의, 실근로 59:30 → 정규 52, 연장 7:30, 고정 OT 초과 0
  const st = weekState(52, [
    ['2026-10-12', 8, 3, 1.5], ['2026-10-13', 8, 0, 0], ['2026-10-14', 8, 3, 2 + 1 / 3],
    ['2026-10-15', 8, 3, 2 + 1 / 3], ['2026-10-16', 8, 3, 4 / 3]
  ]);
  const w = C.compute(st).weeks[0];
  assert.equal(w.W, 59.5 * 60);
  assert.equal(w.REG, 52 * 60);
  assert.equal(w.OTin, 7.5 * 60);
  assert.equal(w.OTx, 0);
  const w2 = C.compute(weekState(32, [['2026-10-12', 8, 2, 0], ['2026-10-13', 8, 2, 0], ['2026-10-14', 8, 2, 0], ['2026-10-15', 8, 2, 0], ['2026-10-16', 8, 2, 0]])).weeks[0];
  assert.deepEqual([w2.REG, w2.OTin, w2.OTx], [32 * 60, 12 * 60, 6 * 60]);
});

test('산정 기준 창: plan-content.js가 기획서.md와 같다 (다르면 node tools/sync-plan.js)', () => {
  const fs = require('fs'), path = require('path');
  const built = require('../tools/sync-plan.js').build();
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'js', 'plan-content.js'), 'utf8'), built);
});

test('기획서 마크다운 변환: 표·목록·코드·목차', () => {
  const M = require('../js/markdown.js');
  const r = M.render('# 제목\n\n## 1. 가\n\n| a | b |\n|---|---|\n| `x|y` | **굵게** |\n\n- 하나\n  - 둘\n\n```\n<코드>\n```\n### 1.1 나\n본문 [링크](https://example.com)');
  assert.match(r.html, /<td><code>x\|y<\/code><\/td><td><strong>굵게<\/strong><\/td>/);
  assert.match(r.html, /<li>하나<ul><li>둘<\/li><\/ul><\/li>/);
  assert.match(r.html, /&lt;코드&gt;/);
  assert.deepEqual(r.toc.map(t => t.level), [2, 3]);
  const real = M.render(require('../js/plan-content.js'));
  assert.ok(real.toc.length > 20);
  const md = require('../js/plan-content.js');
  assert.match(md, /^## 10\. /m);
  assert.doesNotMatch(md, /^## 1[1-6]\. /m);
  assert.ok(!/<script/i.test(real.html));
});
