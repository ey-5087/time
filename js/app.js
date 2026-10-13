/* 화면 동작 — 한 페이지 대시보드 */
(function () {
  'use strict';
  const C = window.FC.calc, H = window.FC.holidays, IO = window.FC.io;
  const STORE_KEY = 'flexcomp.v2';
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const $ = id => document.getElementById(id);

  /* ===================== 상태 ===================== */
  function mondayOf(dateStr) { const w = H.dow(dateStr); return H.addDays(dateStr, w === 0 ? -6 : 1 - w); }
  function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function newState() {
    return {
      agreement: { type: '3m', start: mondayOf(todayStr()), weeks: Array.from({ length: 4 }, () => ({ regular: 40, fixedOT: 12, written: '' })), isDefault: true },
      days: {}, customHolidays: [], removedHolidays: [], lastImport: null
    };
  }

  let store = { current: '기본', profiles: {}, fmt: 'hm' };
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) store = Object.assign(store, JSON.parse(raw));
    } catch (e) { /* 저장소 사용 불가: 메모리로만 동작 */ }
    if (!store.profiles[store.current]) store.profiles[store.current] = newState();
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 무시 */ }
  }
  const S = () => store.profiles[store.current];

  /* ===================== 표시 형식 ===================== */
  const f = min => store.fmt === 'dec' ? C.fmtDec(min) : C.fmtHM(min);
  function fShort(min) { // 날짜 칸용: 8:00 → 8
    if (store.fmt === 'dec') return (min / 60).toFixed(1).replace(/\.0$/, '');
    return min % 60 === 0 ? String(min / 60) : C.fmtHM(min);
  }
  const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 6000 : 4000);
  }

  /* ===================== 렌더링 ===================== */
  let lastResult = null;

  function render() {
    document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px');
    const st = S();
    const res = C.compute(st);
    lastResult = res;
    renderProfiles();
    renderAgreementBar(st);
    renderSummary(st, res);
    renderBoard(st, res);
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.fmt === store.fmt));
    persist();
  }

  function renderProfiles() {
    const sel = $('profileSel');
    sel.innerHTML = Object.keys(store.profiles).map(n => '<option' + (n === store.current ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  }

  function renderAgreementBar(st) {
    const ag = st.agreement;
    $('agType').value = ag.type;
    $('agStart').value = ag.start || '';
    $('agWeeks').value = ag.weeks.length;
    $('agEnd').textContent = ag.start ? '~ ' + H.addDays(ag.start, ag.weeks.length * 7 - 1) + ' (' + ag.weeks.length * 7 + '일)' : '';
  }

  function renderSummary(st, res) {
    const t = res.total;
    const tv = $('sumTotal');
    tv.textContent = f(t.comp);
    tv.classList.toggle('neg', t.comp < 0);
    const ag = st.agreement;
    $('sumPeriod').textContent = ag.start ? ag.start + ' ~ ' + H.addDays(ag.start, ag.weeks.length * 7 - 1) + ' · ' + ag.weeks.length + '주 · 실근로 ' + f(t.W) : '';
    $('sumOt').textContent = f(t.otPay);
    $('sumOtRaw').textContent = '고정 OT 초과 ' + f(t.OTx) + ' (연장 ' + f(t.OT) + ')';
    $('sumHol').textContent = f(t.holPay);
    $('sumHolRaw').textContent = '8h 이내 ' + f(t.H1) + ' · 초과 ' + f(t.H2);
    $('sumNight').textContent = f(t.nightPay);
    $('sumNightRaw').textContent = '야간 ' + f(t.N);
    $('sumLate').textContent = t.L ? '−' + f(t.L) : f(0);

    const notes = [];
    res.warnings.forEach(w => notes.push(['warn', w]));
    const autoDays = [], mismatch = [], noOut = [], capped = [];
    res.weeks.forEach(w => w.days.forEach(d => {
      if (!d.rec) return;
      if (d.eff.src === 'auto' && d.rec.in != null) autoDays.push(md(d.date));
      if (C.statusMismatch(d.rec.status, d.type)) mismatch.push(md(d.date) + ' "' + d.rec.status + '"');
      if (d.rec.in != null && d.rec.out == null && d.eff.src !== 'excel' && d.eff.src !== 'manual') noOut.push(md(d.date));
      if (d.eff.capped) capped.push(md(d.date));
    }));
    if (autoDays.length) notes.push(['warn', '정상·연장·야간이 비어 있어 출퇴근으로 자동 계산한 날 ' + autoDays.length + '일: ' + autoDays.join(', ') + '. 근태 집계 후 다시 올리면 바뀝니다.']);
    if (noOut.length) notes.push(['warn', '퇴근 기록이 없어 0시간으로 본 날: ' + noOut.join(', ')]);
    if (mismatch.length) notes.push(['warn', '근무상태와 달력의 휴일 여부가 다른 날 (달력 기준으로 계산): ' + mismatch.join(', ')]);
    if (capped.length) notes.push(['info', '30:00(새벽 6시) 상한을 적용한 날: ' + capped.join(', ')]);
    res.weeks.forEach(w => { if (w.W + w.H1 + w.H2 > 52 * 60) notes.push(['info', w.index + '주차 총 근로 ' + f(w.W + w.H1 + w.H2) + ' — 주 52시간 초과 (계산에는 영향 없음)']); });
    if (res.outside.length) notes.push(['info', '합의서 기간 밖 기록 ' + res.outside.length + '일은 계산에서 제외했습니다 (' + md(res.outside[0]) + ' ~ ' + md(res.outside[res.outside.length - 1]) + ').']);
    if (st.lastImport) notes.push(['ok', st.lastImport]);
    $('notices').innerHTML = notes.map(([k, m]) => '<div class="notice ' + k + '">' + esc(m) + '</div>').join('');
  }

  function dayCell(d, outside) {
    const rec = d.rec, e = d.eff;
    const hol = H.holidayName(d.date, S().customHolidays, S().removedHolidays);
    const cls = ['day', 't-' + d.type];
    if (outside) cls.push('outside');
    if (e && (e.src === 'auto' || e.src === 'manual')) cls.push('src-' + e.src);
    let body = '';
    if (e && e.src !== 'none' && e.total + e.late > 0) {
      body += '<div class="d-total">' + fShort(e.total) + '</div>';
      const parts = [];
      const ring = d.type === 'holiday' ? ' ring' : '';   // 휴일 근무는 속 빈 동그라미
      if (e.normal) parts.push('<span><i class="dot a' + ring + '"></i>' + fShort(e.normal) + '</span>');
      if (e.ext) parts.push('<span><i class="dot b' + ring + '"></i>' + fShort(e.ext) + '</span>');
      if (e.night) parts.push('<span><i class="dot c' + ring + '"></i>' + fShort(e.night) + '</span>');
      body += '<div class="d-split">' + parts.join('') + '</div>';
    } else {
      body += '<div class="d-total empty">—</div>';
    }
    if (rec && rec.in != null) body += '<div class="d-time">' + C.fmtClock(rec.in) + '–' + (rec.out != null ? C.fmtClock(rec.out) : '?') + '</div>';
    const flags = [];
    if (e && e.late) flags.push('<span class="flag late">지각 ' + fShort(e.late) + '</span>');
    const leave = rec && (rec.leave || C.leaveFromStatus(rec.status));
    if (leave) flags.push('<span class="flag leave">' + esc(leave) + '</span>');
    if (e && e.src === 'auto') flags.push('<span class="flag auto">자동</span>');
    if (e && e.src === 'manual') flags.push('<span class="flag man">수정</span>');
    if (rec && C.statusMismatch(rec.status, d.type)) flags.push('<span class="flag warn" title="근무상태: ' + esc(rec.status) + '">상태 ⚠</span>');
    if (e && e.capped) flags.push('<span class="flag">상한</span>');
    const title = d.date + ' (' + DOW[H.dow(d.date)] + ') ' + ({ holiday: '휴일', offday: '휴무일', workday: '근로일' }[d.type]) + (hol ? ' · ' + hol : '');
    return '<button class="' + cls.join(' ') + '" data-date="' + d.date + '" title="' + esc(title) + '">' +
      '<div class="d-top"><span class="d-date">' + md(d.date) + '</span>' + (hol ? '<span class="d-hol">' + esc(hol) + '</span>' : '') + '</div>' +
      body + '<div class="d-flags">' + flags.join('') + '</div></button>';
  }

  function agCell(w, i) {
    const wk = S().agreement.weeks[i];
    const sum = (Number(wk.regular) || 0) + (Number(wk.fixedOT) || 0);
    const bad = wk.written !== '' && wk.written !== null && wk.written !== undefined && Number(wk.written) !== sum;
    return '<div class="ag">' +
      '<input type="number" min="0" step="1" data-i="' + i + '" data-k="regular" value="' + esc(wk.regular) + '" aria-label="' + (i + 1) + '주차 정규근무">' +
      '<input type="number" min="0" step="1" data-i="' + i + '" data-k="fixedOT" value="' + esc(wk.fixedOT) + '" aria-label="' + (i + 1) + '주차 연장근무">' +
      '<input type="number" min="0" step="1" data-i="' + i + '" data-k="written" value="' + esc(wk.written) + '" placeholder="' + sum + '" class="' + (bad ? 'bad' : '') + '" aria-label="' + (i + 1) + '주차 근로시간">' +
      '<div class="ag-sum" title="이번 주 정상(A) 합계 (휴일 제외)"><i class="dot a"></i>' + f(w.SA) + '</div>' +
      '<div class="ag-sum" title="이번 주 연장(B) 합계 (휴일 제외)"><i class="dot b"></i>' + f(w.SB) + '</div>' +
      '<div class="ag-sum" title="이번 주 야간(C) 합계 (휴일 제외)"><i class="dot c"></i>' + f(w.SC) + '</div>' +
      (w.HA + w.HB + w.HC ? '<div class="ag-sum hol" title="휴일 정상 합계"><i class="dot a ring"></i>' + f(w.HA) + '</div>' +
        '<div class="ag-sum hol" title="휴일 연장 합계"><i class="dot b ring"></i>' + f(w.HB) + '</div>' +
        '<div class="ag-sum hol" title="휴일 야간 합계"><i class="dot c ring"></i>' + f(w.HC) + '</div>' : '') +
      '<div class="ag-calc' + (bad ? ' bad' : '') + '">' + (bad ? '⚠ 계산 기준 ' + sum + 'h' : '기준 ' + sum + 'h') + '</div></div>';
  }

  function stCell(w) {
    const lim = w.A + w.F;
    const scale = Math.max(lim, w.W, 60 * 60) * 1.05;
    const pct = m => (m / scale * 100).toFixed(2) + '%';
    const reg = Math.min(w.W, w.A), fix = Math.min(Math.max(0, w.W - w.A), w.F), over = Math.max(0, w.W - lim);
    const v = (m, neg) => m ? '<em>' + (neg ? '−' : '') + f(m) + '</em>' : '<em class="zero">0</em>';
    return '<div class="st">' +
      '<div class="st-cap"><span>실근로 <b>' + f(w.W) + '</b></span><span>기준 ' + f(lim) + '</span></div>' +
      '<div class="st-bar" title="정규 ' + f(reg) + ' · 고정 OT ' + f(fix) + ' · 초과 ' + f(over) + '">' +
      '<span class="r" style="left:0;width:' + pct(reg) + '"></span>' +
      '<span class="f" style="left:' + pct(reg) + ';width:' + pct(fix) + '"></span>' +
      '<span class="o" style="left:' + pct(reg + fix) + ';width:' + pct(over) + '"></span>' +
      '<i class="mark" style="left:' + pct(lim) + '"></i></div>' +
      '<div class="st-grid">' +
      '<span>연장 ' + f(w.OT) + ' → 고정 OT 초과 ' + f(w.OTx) + ' ×1.5</span>' + v(w.otPay) +
      '<span>휴일 ' + f(w.H1 + w.H2) + (w.H2 ? ' (8h 초과 ' + f(w.H2) + ')' : '') + '</span>' + v(w.holPay) +
      '<span>야간 ' + f(w.N) + ' ×0.5</span>' + v(w.nightPay) +
      '<span>지각</span>' + v(w.L, true) +
      '</div>' +
      '<div class="st-total"><span>주 보상</span><b class="' + (w.comp < 0 ? 'neg' : '') + '">' + f(w.comp) + '</b></div></div>';
  }

  function renderBoard(st, res) {
    const ag = st.agreement;
    let html = '<div class="row head"><div>주차</div>' +
      ['월', '화', '수', '목', '금', '토', '일'].map((k, i) => '<div class="' + (i === 6 ? 'h-sun' : i === 5 ? 'h-sat' : '') + '">' + k + '</div>').join('') +
      '<div class="h-ag"><span><i class="dot a"></i>정규근무</span><span><i class="dot b"></i>연장근무</span><span>근로시간</span></div><div class="h-st">주별 정산</div></div>';

    // 시작일이 월요일이 아니면 머리글 요일을 시작 요일 기준으로
    if (ag.start && H.dow(ag.start) !== 1) {
      const s = H.dow(ag.start);
      html = html.replace(/<div class="row head">[\s\S]*?<div class="h-ag">/, () =>
        '<div class="row head"><div>주차</div>' + Array.from({ length: 7 }, (_, i) => { const w = (s + i) % 7; return '<div class="' + (w === 0 ? 'h-sun' : w === 6 ? 'h-sat' : '') + '">' + DOW[w] + '</div>'; }).join('') + '<div class="h-ag">');
    }

    if (!ag.start || !res.weeks.length) {
      $('board').innerHTML = html + '<div class="empty-state">합의서 <b>시작일</b>과 <b>주 수</b>를 입력하세요.</div>';
      return;
    }

    res.weeks.forEach((w, i) => {
      html += '<div class="row"><div class="wk">' + w.index + '주<small>' + md(w.start) + '~</small></div>' +
        w.days.map(d => dayCell(d, false)).join('') + agCell(w, i) + stCell(w) + '</div>';
    });

    const t = res.total;
    html += '<div class="board-foot"><div class="ft-label">합계 · 실근로 ' + f(t.W) + ' · 연장 ' + f(t.OT) + ' · 휴일 ' + f(t.H1 + t.H2) + ' · 야간 ' + f(t.N) + '</div>' +
      '<div class="ft-ag">정규 평균 ' + (ag.weeks.reduce((a, x) => a + (Number(x.regular) || 0), 0) / ag.weeks.length).toFixed(1) + 'h</div>' +
      '<div style="text-align:right">최종 ' + f(t.comp) + '</div></div>';

    // 기간 밖 기록
    if (res.outside.length) {
      const startDow = H.dow(ag.start);
      const weekStartOf = d => H.addDays(d, -((H.dow(d) - startDow + 7) % 7));
      const starts = [...new Set(res.outside.map(weekStartOf))].sort();
      let rows = '';
      starts.forEach(ws => {
        const days = [];
        for (let k = 0; k < 7; k++) {
          const date = H.addDays(ws, k);
          const type = H.dayType(date, st.customHolidays, st.removedHolidays);
          const rec = st.days[date];
          days.push({ date, type, rec, eff: rec ? C.effectiveDay(rec, type) : null });
        }
        rows += '<div class="row outside-row"><div class="wk">기간 외<small>' + md(ws) + '~</small></div>' +
          days.map(d => dayCell(d, true)).join('') + '<div class="ag"></div><div class="st excluded">계산 제외</div></div>';
      });
      html += '<details class="outside-block"><summary>합의서 기간 밖 기록 ' + res.outside.length + '일 보기 (계산 제외)</summary>' + rows + '</details>';
    }
    $('board').innerHTML = html;
  }

  /* ===================== 합의서 편집 ===================== */
  function setWeeks(n) {
    const ag = S().agreement;
    n = Math.max(1, Math.min(27, n | 0));
    while (ag.weeks.length < n) ag.weeks.push({ regular: 40, fixedOT: 12, written: '' });
    ag.weeks.length = n;
  }
  function onAgreementChange() {
    const ag = S().agreement;
    ag.type = $('agType').value;
    if ($('agStart').value) ag.start = $('agStart').value;
    setWeeks(Number($('agWeeks').value) || 1);
    ag.isDefault = false;
    render();
  }

  /* 합의서 표 입력 대화상자: 확인 전까지 draft에서만 고침 */
  let agDraft = null;
  function openAgDialog() {
    const ag = S().agreement;
    agDraft = { start: ag.start, weeks: ag.weeks.map(w => Object.assign({}, w)) };
    $('agDlgStart').value = agDraft.start || '';
    renderAgTable();
    $('agDlg').showModal();
    const first = $('agRows').querySelector('input');
    if (first) first.focus();
  }
  function num(v) { return v === '' || v === null || v === undefined ? '' : Number(v); }
  function renderAgTable() {
    const d = agDraft;
    const n = d.weeks.length;
    $('agDlgRange').textContent = d.start ? d.start + ' ~ ' + H.addDays(d.start, n * 7 - 1) + ' · ' + n + '주 (' + n * 7 + '일)' : '시작일을 입력하세요';
    $('agRows').innerHTML = d.weeks.map((w, i) => {
      const sum = (Number(w.regular) || 0) + (Number(w.fixedOT) || 0);
      const bad = w.written !== '' && w.written !== null && w.written !== undefined && Number(w.written) !== sum;
      const per = d.start ? md(H.addDays(d.start, i * 7)) + ' ~ ' + md(H.addDays(d.start, i * 7 + 6)) : '';
      const cell = (k, cls) => '<td><input type="number" min="0" step="1" data-r="' + i + '" data-c="' + k + '" value="' + esc(w[k]) + '"' +
        (k === 'written' ? ' placeholder="' + sum + '"' : '') + (cls ? ' class="' + cls + '"' : '') +
        ' aria-label="' + (i + 1) + '주차 ' + { regular: '정규근무', fixedOT: '연장근무', written: '근로시간' }[k] + '"></td>';
      return '<tr><th scope="row">' + (i + 1) + '주차</th><td class="per">' + per + '</td>' +
        cell('regular') + cell('fixedOT') + cell('written', bad ? 'bad' : '') +
        '<td class="base' + (bad ? ' bad' : '') + '">' + sum + 'h' + (bad ? ' ⚠' : '') + '</td></tr>';
    }).join('');
    const tot = k => d.weeks.reduce((a, w) => a + (Number(w[k]) || 0), 0);
    const reg = tot('regular'), ot = tot('fixedOT');
    const avg = n ? reg / n : 0;
    $('agFoot').innerHTML = '<tr><th scope="row">합계</th><td class="avg">정규 평균 <span class="' + (avg > 40 ? 'over' : '') + '">' + avg.toFixed(1) + 'h</span></td>' +
      '<td>' + reg + '</td><td>' + ot + '</td><td>' + d.weeks.reduce((a, w) => a + (w.written === '' ? 0 : Number(w.written) || 0), 0) + '</td><td>' + (reg + ot) + 'h</td></tr>';
  }
  const AG_COLS = ['regular', 'fixedOT', 'written'];
  function agInput(e) {
    const inp = e.target.closest('input[data-r]');
    if (!inp) return;
    agDraft.weeks[Number(inp.dataset.r)][inp.dataset.c] = num(inp.value);
    // 다시 그리면 입력 중 포커스를 잃으므로 해당 행의 기준·합계만 갱신
    const r = Number(inp.dataset.r), w = agDraft.weeks[r];
    const sum = (Number(w.regular) || 0) + (Number(w.fixedOT) || 0);
    const bad = w.written !== '' && Number(w.written) !== sum;
    const tr = inp.closest('tr');
    tr.querySelector('input[data-c="written"]').classList.toggle('bad', bad);
    tr.querySelector('input[data-c="written"]').placeholder = sum;
    const base = tr.querySelector('.base');
    base.className = 'base' + (bad ? ' bad' : '');
    base.textContent = sum + 'h' + (bad ? ' ⚠' : '');
    const tot = k => agDraft.weeks.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    const reg = tot('regular'), ot = tot('fixedOT'), avg = reg / agDraft.weeks.length;
    $('agFoot').innerHTML = '<tr><th scope="row">합계</th><td class="avg">정규 평균 <span class="' + (avg > 40 ? 'over' : '') + '">' + avg.toFixed(1) + 'h</span></td>' +
      '<td>' + reg + '</td><td>' + ot + '</td><td>' + tot('written') + '</td><td>' + (reg + ot) + 'h</td></tr>';
  }
  // 여러 칸 붙여넣기: 커서가 있는 칸부터 오른쪽·아래로 채움
  function agPaste(e) {
    const inp = e.target.closest('input[data-r]');
    if (!inp) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // 한 칸 값은 기본 동작
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    const r0 = Number(inp.dataset.r), c0 = AG_COLS.indexOf(inp.dataset.c);
    let last = -1;
    lines.forEach((line, li) => {
      const vals = line.split(/\t|\s{2,}/).map(v => v.trim()).filter(v => v !== '' && !/주\s*차?$|^구분$/.test(v))
        .map(v => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null)).filter(v => v !== null);
      if (!vals.length) return;
      const r = r0 + li;
      while (agDraft.weeks.length <= r && agDraft.weeks.length < 27) agDraft.weeks.push({ regular: 40, fixedOT: 12, written: '' });
      if (r >= agDraft.weeks.length) return;
      vals.forEach((v, k) => { const c = c0 + k; if (c < AG_COLS.length) agDraft.weeks[r][AG_COLS[c]] = v; });
      last = r;
    });
    // 첫 주부터 붙여넣으면 합의서 전체로 보고 주 수를 붙여넣은 줄 수에 맞춤
    if (r0 === 0 && last >= 0) agDraft.weeks.length = last + 1;
    renderAgTable();
    toast(lines.length + '줄을 붙여넣었습니다.');
  }
  function applyAgDialog() {
    if (!agDraft.weeks.length) { toast('최소 1주가 필요합니다.', 'error'); return; }
    const ag = S().agreement;
    if ($('agDlgStart').value) ag.start = $('agDlgStart').value;
    ag.weeks = agDraft.weeks.map(w => ({ regular: w.regular === '' ? 0 : w.regular, fixedOT: w.fixedOT === '' ? 12 : w.fixedOT, written: w.written }));
    ag.isDefault = false;
    $('agDlg').close();
    render();
    toast(ag.weeks.length + '주 합의서 값을 적용했습니다.');
  }

  /* ===================== 날짜 편집 ===================== */
  let editDate = null, dirtyVals = false;
  function openDay(date) {
    const st = S();
    editDate = date;
    dirtyVals = false;
    const type = H.dayType(date, st.customHolidays, st.removedHolidays);
    const rec = st.days[date] || {};
    const hol = H.holidayName(date, st.customHolidays, st.removedHolidays);
    const e = C.effectiveDay(rec, type);
    $('dayTitle').textContent = date + ' (' + DOW[H.dow(date)] + ')';
    $('daySub').textContent = ({ holiday: '휴일', offday: '휴무일', workday: '근로일' }[type]) + (hol ? ' · ' + hol : '') + (rec.status ? ' · 근무상태 "' + rec.status + '"' : '') + (rec.src ? ' · ' + rec.src : '');
    $('fIn').value = rec.in != null ? C.fmtClock(rec.in) : '';
    $('fOut').value = rec.out != null ? C.fmtClock(rec.out) : '';
    $('fLeave').value = rec.leave || C.leaveFromStatus(rec.status) || '';
    $('fA').value = C.fmtHM(e.normal); $('fB').value = C.fmtHM(e.ext); $('fC').value = C.fmtHM(e.night); $('fL').value = C.fmtHM(e.late);
    $('srcNote').textContent = { excel: '— 근태 엑셀 값', manual: '— 직접 수정한 값', auto: '— 출퇴근으로 자동 계산', none: '' }[e.src];
    const ref = [];
    if (rec.excel) {
      const x = rec.excel, has = [x.normal, x.ext, x.night].some(v => v != null);
      ref.push('엑셀: ' + (has ? '정상 ' + C.fmtHM(x.normal || 0) + ' · 연장 ' + C.fmtHM(x.ext || 0) + ' · 야간 ' + C.fmtHM(x.night || 0) : '정상·연장·야간 비어 있음') + (x.late ? ' · 지각 ' + C.fmtHM(x.late) : ''));
    }
    if (rec.in != null && rec.out != null) ref.push('출퇴근 기준 계산: 정상 ' + C.fmtHM(e.auto.normal) + ' · 연장 ' + C.fmtHM(e.auto.ext) + ' · 야간 ' + C.fmtHM(e.auto.night) + ' · 지각 ' + C.fmtHM(e.auto.late));
    ref.push('정상 09~18시 · 연장 19~22시 · 야간 22시 이후 (30:00까지)');
    $('dayRef').innerHTML = ref.map(esc).join('<br>');
    $('btnDayReset').disabled = !rec.manual;
    $('dayDlg').showModal();
  }

  function parseClockInput(v) {
    v = v.trim();
    if (!v) return null;
    if (/^\d{3,4}$/.test(v)) v = v.slice(0, -2) + ':' + v.slice(-2);
    return C.parseHM(v);
  }

  function saveDay() {
    const st = S();
    const rec = Object.assign({ in: null, out: null, status: '', excel: null, manual: null }, st.days[editDate] || {});
    const fin = parseClockInput($('fIn').value), fout = parseClockInput($('fOut').value);
    if (($('fIn').value.trim() && fin === null) || ($('fOut').value.trim() && fout === null)) { toast('시각은 HH:MM 형식으로 입력하세요 (예: 09:00, 26:30).', 'error'); return; }
    rec.in = fin;
    rec.out = (fin !== null && fout !== null && fout <= fin) ? fout + 1440 : fout;
    rec.leave = $('fLeave').value;
    if (dirtyVals) {
      const vals = ['fA', 'fB', 'fC', 'fL'].map(id => $(id).value.trim() === '' ? 0 : C.parseHM($(id).value));
      if (vals.some(v => v === null)) { toast('시간은 H:MM 형식으로 입력하세요 (예: 3:30).', 'error'); return; }
      rec.manual = { normal: vals[0], ext: vals[1], night: vals[2], late: vals[3] };
    }
    st.days[editDate] = rec;
    $('dayDlg').close();
    render();
  }

  /* ===================== 파일 올리기 ===================== */
  async function importFiles(files) {
    const st = S();
    const results = [];
    for (const file of files) {
      try {
        const r = await IO.parseFile(file.name, await file.arrayBuffer());
        results.push(r);
      } catch (e) {
        toast(file.name + ': ' + e.message, 'error');
      }
    }
    if (!results.length) return;
    results.sort((a, b) => (a.from || '').localeCompare(b.from || ''));

    // 성명으로 프로필 맞추기
    const name = results.map(r => r.name).find(Boolean);
    if (name && name !== store.current) {
      const cur = S();
      const empty = !Object.keys(cur.days).length;
      if (store.current === '기본' && empty && !store.profiles[name]) {
        store.profiles[name] = cur; delete store.profiles['기본']; store.current = name;
      } else if (confirm('파일의 성명 "' + name + '"이(가) 현재 프로필 "' + store.current + '"과 다릅니다.\n"' + name + '" 프로필로 전환(없으면 새로 만듦)할까요?\n\n[취소]를 누르면 현재 프로필에 넣습니다.')) {
        if (!store.profiles[name]) {
          const ns = newState();
          ns.agreement = JSON.parse(JSON.stringify(cur.agreement));
          ns.customHolidays = JSON.parse(JSON.stringify(cur.customHolidays));
          ns.removedHolidays = cur.removedHolidays.slice();
          store.profiles[name] = ns;
        }
        store.current = name;
      }
    }
    const target = S();
    let count = 0, overwritten = 0, keptManual = 0;
    const msgs = [];
    const seen = {};
    results.forEach(r => {
      r.records.forEach(rec => {
        const prev = target.days[rec.date];
        if (seen[rec.date]) overwritten++;
        seen[rec.date] = true;
        const nr = { in: rec.in, out: rec.out, status: rec.status, leave: rec.leave || '', excel: rec.excel, manual: null, src: r.fileName };
        if (prev && prev.manual) { nr.manual = prev.manual; keptManual++; }
        target.days[rec.date] = nr;
        count++;
      });
      let m = r.fileName + ': ' + (r.from ? md(r.from) + '~' + md(r.to) + ' ' : '') + r.records.length + '일';
      if (r.failed.length) m += ' · 읽지 못한 행 ' + r.failed.length + '개 (' + r.failed.slice(0, 3).map(x => x.row + '행').join(', ') + ')';
      r.warnings.forEach(w => { m += ' · ' + w; });
      msgs.push(m);
    });
    if (overwritten) msgs.push('파일끼리 겹친 날짜 ' + overwritten + '일은 나중 파일 값을 사용');
    if (keptManual) msgs.push('직접 수정한 ' + keptManual + '일은 수정값을 유지');

    // 합의서를 아직 입력하지 않았으면 기록 기간으로 주 수를 맞춤
    const ag = target.agreement;
    if (ag.isDefault) {
      const dates = Object.keys(target.days).sort();
      ag.start = mondayOf(dates[0]);
      const span = Math.round((H.toDate(dates[dates.length - 1]) - H.toDate(ag.start)) / 86400000) + 1;
      setWeeks(Math.ceil(span / 7));
      toast('합의서가 비어 있어 기록 기간으로 임시 설정했습니다. 합의서 값을 입력하세요.');
    }
    target.lastImport = '불러오기 — ' + msgs.join(' / ');
    render();
    toast(count + '일 기록을 불러왔습니다.');
  }

  /* ===================== 저장·불러오기 ===================== */
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function saveFile() {
    const data = { app: 'flexcomp', version: 2, appVersion: window.FC.version.APP_VERSION, profile: store.current, savedAt: new Date().toISOString(), state: S() };
    download('탄력근로정산_' + store.current + '_' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('파일로 저장했습니다.');
  }
  function loadFile(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('JSON 형식이 아닙니다.', 'error'); return; }
    let state, name;
    if (data.app === 'flexcomp' && data.state) {
      state = data.state; name = data.profile || '불러온 데이터';
    } else if (Array.isArray(data.schedule)) { // v1 파일
      state = newState(); name = 'v1 데이터';
      state.agreement.start = data.startDate;
      setWeeksOn(state, data.schedule.length);
      data.schedule.forEach(week => week.forEach(d => {
        if (d.start && d.end) {
          const i = C.parseHM(d.start); let o = C.parseHM(d.end);
          if (o <= i) o += 1440;
          state.days[d.date] = { in: i, out: o, status: d.designated ? '휴일' : '', leave: '', excel: null, manual: null, src: 'v1' };
        }
      }));
      if (data.sourceName) name = data.sourceName.replace(/\.[^.]+$/, '');
      state.agreement.isDefault = false;
    } else { toast('알 수 없는 파일 형식입니다.', 'error'); return; }
    if (store.profiles[name] && !confirm('"' + name + '" 프로필을 파일 내용으로 덮어쓸까요?')) return;
    store.profiles[name] = Object.assign(newState(), state);
    store.current = name;
    render();
    toast('"' + name + '" 데이터를 불러왔습니다.');
  }
  function setWeeksOn(state, n) {
    state.agreement.weeks = Array.from({ length: n }, () => ({ regular: 40, fixedOT: 12, written: '' }));
  }
  function exportCsv() {
    const r = lastResult;
    if (!r || !r.weeks.length) return;
    const h = m => (m / 60).toFixed(2);
    const rows = [['주차', '시작', '종료', '정규(A)', '고정OT(F)', '실근로', '연장', '고정OT초과', '연장보상(x1.5)', '휴일8h이내', '휴일8h초과', '휴일보상', '야간', '야간가산(x0.5)', '지각', '주별보상']];
    r.weeks.forEach(w => rows.push([w.index, w.start, w.end, h(w.A), h(w.F), h(w.W), h(w.OT), h(w.OTx), h(w.otPay), h(w.H1), h(w.H2), h(w.holPay), h(w.N), h(w.nightPay), h(w.L), h(w.comp)]));
    const t = r.total;
    rows.push(['합계', '', '', '', '', h(t.W), h(t.OT), h(t.OTx), h(t.otPay), h(t.H1), h(t.H2), h(t.holPay), h(t.N), h(t.nightPay), h(t.L), h(t.comp)]);
    download('정산결과_' + store.current + '_' + todayStr() + '.csv', '﻿' + rows.map(x => x.join(',')).join('\r\n'), 'text/csv');
  }

  /* ===================== 휴일 관리 ===================== */
  function openHolidays() {
    const st = S();
    const years = new Set(H.supportedYears());
    if (st.agreement.start) { years.add(Number(st.agreement.start.slice(0, 4))); }
    const sel = $('holYear');
    const cur = st.agreement.start ? Number(st.agreement.start.slice(0, 4)) : new Date().getFullYear();
    sel.innerHTML = [...years].sort().map(y => '<option' + (y === cur ? ' selected' : '') + '>' + y + '</option>').join('');
    renderHolList();
    $('holDlg').showModal();
  }
  function renderHolList() {
    const st = S();
    const y = Number($('holYear').value);
    const base = H.holidaysOfYear(y);
    const items = Object.keys(base).map(d => ({ date: d, name: base[d], custom: false }));
    st.customHolidays.filter(c => c.date.startsWith(y + '-')).forEach(c => items.push({ date: c.date, name: c.name, custom: true }));
    items.sort((a, b) => a.date.localeCompare(b.date));
    $('holList').innerHTML = items.map(it => {
      const off = !it.custom && st.removedHolidays.indexOf(it.date) >= 0;
      return '<li class="' + (off ? 'off' : '') + '">' +
        (it.custom ? '<span style="width:16px"></span>' : '<input type="checkbox" data-date="' + it.date + '"' + (off ? '' : ' checked') + ' aria-label="' + esc(it.name) + ' 휴일 적용">') +
        '<span class="hd">' + it.date.slice(5) + ' (' + DOW[H.dow(it.date)] + ')</span><span class="hn">' + esc(it.name) + '</span>' +
        (it.custom ? '<span class="custom">추가함</span><button type="button" class="rm" data-date="' + it.date + '" aria-label="삭제">✕</button>' : '') + '</li>';
    }).join('') || '<li>이 연도의 공휴일 자료가 없습니다. 아래에서 직접 추가하세요.</li>';
  }

  /* ===================== 이벤트 ===================== */
  function bind() {
    $('btnImport').onclick = () => $('fileImport').click();
    $('fileImport').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) importFiles(fs); };
    $('btnSave').onclick = () => { closeMenu(); saveFile(); };
    $('btnLoad').onclick = () => { closeMenu(); $('fileLoad').click(); };
    $('fileLoad').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (file) loadFile(await file.text()); };
    $('btnCsv').onclick = () => { closeMenu(); exportCsv(); };
    $('btnPrint').onclick = () => { closeMenu(); window.print(); };
    $('btnNewProfile').onclick = () => {
      closeMenu();
      const n = (prompt('새 프로필 이름 (예: 직원 성명)') || '').trim();
      if (!n) return;
      if (store.profiles[n]) { toast('이미 있는 이름입니다.', 'error'); return; }
      const ns = newState();
      ns.agreement = JSON.parse(JSON.stringify(S().agreement));
      store.profiles[n] = ns; store.current = n; render();
    };
    $('btnRenameProfile').onclick = () => {
      closeMenu();
      const n = (prompt('프로필 이름', store.current) || '').trim();
      if (!n || n === store.current) return;
      if (store.profiles[n]) { toast('이미 있는 이름입니다.', 'error'); return; }
      store.profiles[n] = S(); delete store.profiles[store.current]; store.current = n; render();
    };
    $('btnDeleteProfile').onclick = () => {
      closeMenu();
      if (!confirm('"' + store.current + '" 프로필과 모든 기록을 이 브라우저에서 삭제할까요?')) return;
      delete store.profiles[store.current];
      store.current = Object.keys(store.profiles)[0] || '기본';
      if (!store.profiles[store.current]) store.profiles[store.current] = newState();
      render();
    };
    $('btnClearDays').onclick = () => {
      closeMenu();
      if (!confirm('현재 프로필의 근무 기록을 모두 지울까요? (합의서와 휴일 설정은 유지)')) return;
      S().days = {}; S().lastImport = null; render();
    };
    $('profileSel').onchange = e => { store.current = e.target.value; render(); };
    document.querySelectorAll('.seg-btn').forEach(b => { b.onclick = () => { store.fmt = b.dataset.fmt; render(); }; });

    ['agType', 'agStart', 'agWeeks'].forEach(id => { $(id).onchange = onAgreementChange; });
    $('btnAgEdit').onclick = openAgDialog;
    $('agRows').addEventListener('input', agInput);
    $('agRows').addEventListener('paste', agPaste);
    $('agRows').addEventListener('keydown', e => { // Enter: 아래 칸으로
      const inp = e.target.closest('input[data-r]');
      if (!inp || e.key !== 'Enter') return;
      e.preventDefault();
      const next = $('agRows').querySelector('input[data-r="' + (Number(inp.dataset.r) + 1) + '"][data-c="' + inp.dataset.c + '"]');
      if (next) next.focus(); else $('btnAgApply').focus();
    });
    $('agDlgStart').onchange = () => { agDraft.start = $('agDlgStart').value; renderAgTable(); };
    $('btnAgAdd').onclick = () => { if (agDraft.weeks.length < 27) { agDraft.weeks.push({ regular: 40, fixedOT: 12, written: '' }); renderAgTable(); } };
    $('btnAgRemove').onclick = () => { if (agDraft.weeks.length > 1) { agDraft.weeks.pop(); renderAgTable(); } };
    $('btnAgApply').onclick = applyAgDialog;

    $('board').addEventListener('click', e => {
      const day = e.target.closest('.day');
      if (day) openDay(day.dataset.date);
    });
    $('board').addEventListener('change', e => {
      const inp = e.target.closest('.ag input');
      if (!inp) return;
      const wk = S().agreement.weeks[Number(inp.dataset.i)];
      wk[inp.dataset.k] = inp.value === '' ? '' : Number(inp.value);
      S().agreement.isDefault = false;
      render();
    });

    ['fA', 'fB', 'fC', 'fL'].forEach(id => { $(id).addEventListener('input', () => { dirtyVals = true; }); });
    $('btnDaySave').onclick = saveDay;
    $('btnDayReset').onclick = () => { const r = S().days[editDate]; if (r) r.manual = null; $('dayDlg').close(); render(); };
    $('btnDayDelete').onclick = () => { delete S().days[editDate]; $('dayDlg').close(); render(); };
    $('dayForm').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveDay(); } });

    $('btnVersion').onclick = () => {
      $('verList').innerHTML = window.FC.version.CHANGELOG.map((v, i) =>
        '<section><h3>v' + esc(v.version) + (v.date ? '<small>' + esc(v.date) + '</small>' : '') + (i === 0 ? '<span class="cur">현재</span>' : '') + '</h3><ul>' +
        v.items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></section>').join('');
      $('verDlg').showModal();
    };
    $('btnHolidays').onclick = openHolidays;
    $('holYear').onchange = renderHolList;
    $('holList').addEventListener('change', e => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const st = S(), d = cb.dataset.date;
      st.removedHolidays = st.removedHolidays.filter(x => x !== d);
      if (!cb.checked) st.removedHolidays.push(d);
      renderHolList(); render();
    });
    $('holList').addEventListener('click', e => {
      const b = e.target.closest('.rm');
      if (!b) return;
      S().customHolidays = S().customHolidays.filter(c => c.date !== b.dataset.date);
      renderHolList(); render();
    });
    $('btnHolAdd').onclick = () => {
      const d = $('holDate').value, n = $('holName').value.trim() || '회사 휴일';
      if (!d) { toast('날짜를 선택하세요.', 'error'); return; }
      const st = S();
      st.customHolidays = st.customHolidays.filter(c => c.date !== d).concat([{ date: d, name: n }]);
      st.removedHolidays = st.removedHolidays.filter(x => x !== d);
      $('holYear').value = d.slice(0, 4);
      $('holName').value = '';
      renderHolList(); render();
    };

    window.addEventListener('resize', () => document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px'));

    // 파일 끌어다 놓기
    document.addEventListener('dragover', e => { e.preventDefault(); });
    document.addEventListener('drop', e => {
      e.preventDefault();
      const fs = [...(e.dataTransfer?.files || [])];
      if (!fs.length) return;
      const json = fs.find(x => /\.json$/i.test(x.name));
      if (json) json.text().then(loadFile); else importFiles(fs);
    });
    document.addEventListener('click', e => { const m = document.querySelector('.menu[open]'); if (m && !m.contains(e.target)) m.open = false; });
  }
  function closeMenu() { const m = document.querySelector('.menu[open]'); if (m) m.open = false; }

  $('btnVersion').textContent = 'v' + window.FC.version.APP_VERSION;
  document.title = '탄력근로 보상시간 정산 v' + window.FC.version.APP_VERSION;
  load();
  bind();
  render();
})();
