/* 프로젝트 저장소 — 프로필(직원)별로 프로젝트를 이 컴퓨터의 브라우저에 저장 (서버 전송 없음)
 * 저장 위치: IndexedDB (용량이 커서 이력 보관에 적합). 쓸 수 없는 브라우저에서는 localStorage로 대신 저장.
 * 레코드: { profile, name, savedAt, appVersion, state, meta, history: [{ savedAt, appVersion, state, meta }] }
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./calc.js') : root.FC.calc;
  const H = isNode ? require('./holidays.js') : root.FC.holidays;

  const DB_NAME = 'flexcomp-projects', STORE = 'projects', LS_KEY = 'flexcomp.projects.v1';
  const MAX_HISTORY = 20;

  /* ---------- 순수 함수 (테스트 대상) ---------- */
  const clone = o => JSON.parse(JSON.stringify(o));

  // 비교·저장용 정리: 내용 없는 날짜 기록을 빼고, 비교할 때는 마지막 불러오기 안내문도 뺌
  function compact(state, forCompare) {
    const s = clone(state || {});
    const days = s.days || {};
    Object.keys(days).forEach(d => {
      const r = days[d];
      if (!r || (r.in == null && r.out == null && !r.excel && !r.manual && !r.leave && !r.status)) delete days[d];
    });
    if (forCompare) delete s.lastImport;
    return s;
  }
  function same(a, b) { return JSON.stringify(compact(a, true)) === JSON.stringify(compact(b, true)); }

  function meta(state) {
    const ag = (state && state.agreement) || {};
    const n = ag.weeks ? ag.weeks.length : 0;
    let comp = 0, W = 0;
    try { const r = C.compute(state); comp = r.total.comp; W = r.total.W; } catch (e) { /* 계산 불가 상태는 0 */ }
    const days = Object.keys((state && state.days) || {}).filter(d => state.days[d] && (state.days[d].excel || state.days[d].manual || state.days[d].in != null)).length;
    return { start: ag.start || '', end: ag.start && n ? H.addDays(ag.start, n * 7 - 1) : '', weeks: n, comp, W, days };
  }

  // 같은 이름으로 다시 저장: 이전 저장본을 이력 맨 앞에 넣고 최근 MAX_HISTORY개만 보관
  // 반환: { record, changed } — 내용이 같으면 changed=false (이력을 늘리지 않음)
  function saveVersion(existing, profile, name, state, now, appVersion) {
    const st = compact(state);
    const m = meta(st);
    if (existing && same(existing.state, st)) return { record: existing, changed: false };
    const history = existing ? [{ savedAt: existing.savedAt, appVersion: existing.appVersion, state: existing.state, meta: existing.meta }].concat(existing.history || []) : [];
    return {
      changed: true,
      record: { profile, name, savedAt: now, appVersion, state: st, meta: m, history: history.slice(0, MAX_HISTORY) }
    };
  }

  // 겹치는 이름이면 "이름 (2)" 식으로 새 이름
  function uniqueName(name, taken) {
    if (!taken(name)) return name;
    for (let i = 2; ; i++) { const n = name + ' (' + i + ')'; if (!taken(n)) return n; }
  }

  /* ---------- 저장소 ---------- */
  const mem = {};            // mem[profile][name] = record
  let db = null, useLS = false;

  function put(rec) { (mem[rec.profile] = mem[rec.profile] || {})[rec.name] = rec; }
  function allRecords() { return Object.keys(mem).reduce((a, p) => a.concat(Object.values(mem[p])), []); }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('no indexedDB')); return; }
      const req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: ['profile', 'name'] }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function txDone(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      fn(t.objectStore(STORE));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('저장이 취소되었습니다'));
    });
  }
  function persistLS() { root.localStorage.setItem(LS_KEY, JSON.stringify(allRecords())); }

  async function init() {
    try {
      db = await openDB();
      const all = await new Promise((resolve, reject) => {
        const r = db.transaction(STORE).objectStore(STORE).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
      all.forEach(put);
    } catch (e) {
      useLS = true;
      try { const raw = root.localStorage.getItem(LS_KEY); if (raw) JSON.parse(raw).forEach(put); } catch (e2) { /* 비어 있음 */ }
    }
    return { storage: useLS ? 'localStorage' : 'indexedDB' };
  }

  async function write(rec) {
    put(rec);
    if (useLS) persistLS(); else await txDone('readwrite', s => s.put(rec));
  }
  async function remove(profile, name) {
    if (mem[profile]) delete mem[profile][name];
    if (useLS) persistLS(); else await txDone('readwrite', s => s.delete([profile, name]));
  }

  function list(profile) {
    return Object.values(mem[profile] || {}).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  }
  function get(profile, name) { return (mem[profile] || {})[name] || null; }

  async function save(profile, name, state, appVersion) {
    const { record, changed } = saveVersion(get(profile, name), profile, name, state, new Date().toISOString(), appVersion);
    if (changed) await write(record);
    return { record, changed };
  }
  async function renameProfile(from, to) {
    for (const rec of list(from)) {
      await remove(from, rec.name);
      await write(Object.assign({}, rec, { profile: to }));
    }
  }
  async function deleteProfile(profile) {
    for (const rec of list(profile)) await remove(profile, rec.name);
    delete mem[profile];
  }
  // 백업 파일의 레코드를 넣음. 같은 이름이 있으면 같은 저장본은 건너뛰고, 다르면 새 이름으로 추가
  async function importRecords(profile, records) {
    let added = 0, skipped = 0;
    for (const r of records) {
      if (!r || !r.name || !r.state) continue;
      const cur = get(profile, r.name);
      if (cur && cur.savedAt === r.savedAt && same(cur.state, r.state)) { skipped++; continue; }
      const name = cur ? uniqueName(r.name + ' (백업)', n => !!get(profile, n)) : r.name;
      await write(Object.assign({}, clone(r), { profile, name }));
      added++;
    }
    return { added, skipped };
  }

  const api = {
    MAX_HISTORY, compact, same, meta, saveVersion, uniqueName,
    init, list, get, save, remove, renameProfile, deleteProfile, importRecords,
    storageKind: () => (useLS ? 'localStorage' : 'indexedDB')
  };
  root.FC = root.FC || {};
  root.FC.projects = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
