/* 기획서 표시용 최소 마크다운 변환기
 * 지원: 제목(#~####), 문단, 굵게, 인라인 코드, 링크, 목록(- / 1., 들여쓰기 한 단계), 표, 코드 블록, 구분선
 */
(function (root) {
  'use strict';
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(text) {
    const codes = [];
    let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const safe = /^(https?:|#|\.{0,2}\/|[\w.-]+\.(md|html)$)/i.test(u) ? u : '#';
      return '<a href="' + safe + '" target="_blank" rel="noopener">' + t + '</a>';
    });
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[Number(i)]) + '</code>');
  }

  // 표 한 줄을 칸으로 나눔 (인라인 코드 안의 | 는 나누지 않음)
  function cells(line) {
    const out = [];
    let cur = '', code = false;
    const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    for (const ch of body) {
      if (ch === '`') code = !code;
      if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function slug(text, used) {
    let base = 'sec-' + text.replace(/[^0-9A-Za-z가-힣]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    let s = base, n = 1;
    while (used[s]) s = base + '-' + (++n);
    used[s] = true;
    return s;
  }

  // 반환: { html, toc: [{level, text, id}] }
  function render(md) {
    const lines = md.replace(/\r/g, '').split('\n');
    const html = [], toc = [], used = {};
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        html.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        const level = h[1].length, text = h[2].trim(), id = slug(text, used);
        if (level >= 2 && level <= 3) toc.push({ level, text, id });
        html.push('<h' + level + ' id="' + id + '">' + inline(text) + '</h' + level + '>');
        i++; continue;
      }
      if (/^---+\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        html.push('<div class="md-table"><table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
          if (m[1].length >= 2 && items.length) items[items.length - 1].sub.push(m[3]);
          else items.push({ text: m[3], sub: [] });
          i++;
          // 들여쓴 이어지는 줄은 앞 항목에 붙임
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
            items[items.length - 1].text += ' ' + lines[i].trim(); i++;
          }
        }
        const tag = ordered ? 'ol' : 'ul';
        html.push('<' + tag + '>' + items.map(it => '<li>' + inline(it.text) +
          (it.sub.length ? '<ul>' + it.sub.map(s => '<li>' + inline(s) + '</li>').join('') + '</ul>' : '') + '</li>').join('') + '</' + tag + '>');
        continue;
      }
      if (!line.trim()) { i++; continue; }
      const buf = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|---+\s*$|\s*\||\s*([-*]|\d+\.)\s+)/.test(lines[i])) buf.push(lines[i++].trim());
      html.push('<p>' + buf.map(inline).join('<br>') + '</p>');
    }
    return { html: html.join('\n'), toc };
  }

  const api = { render };
  root.FC = root.FC || {};
  root.FC.markdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
