// 기획서.md를 화면에서 볼 수 있도록 js/plan-content.js로 옮깁니다.
// 기획서.md를 고친 뒤 실행: node tools/sync-plan.js
// (file:// 로 열어도 보이도록 fetch 대신 스크립트 파일에 담습니다. 테스트가 두 파일이 같은지 확인합니다.)
// 산정 기준 창에는 계산 기준(1~10장)만 싣고, 개발용 내용(11장 화면 구성 ~ 16장 버전 관리)은 뺍니다.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const LAST_SECTION = 10;

function criteriaOnly(md) {
  const parts = md.split(/^(?=## \d+\. )/m);
  const kept = parts.filter((p, i) => i === 0 || Number(/^## (\d+)\./.exec(p)[1]) <= LAST_SECTION);
  return kept.join('').replace(/\n---\s*$/, '').trimEnd() + '\n';
}

function build() {
  const md = criteriaOnly(fs.readFileSync(path.join(root, '기획서.md'), 'utf8'));
  return '/* 자동 생성 파일 — 직접 고치지 말고 기획서.md를 고친 뒤 `node tools/sync-plan.js`를 실행하세요. */\n' +
    '(function (root) {\n  root.FC = root.FC || {};\n  root.FC.planMarkdown = ' + JSON.stringify(md) + ';\n' +
    '  if (typeof module !== \'undefined\' && module.exports) module.exports = root.FC.planMarkdown;\n' +
    '})(typeof window !== \'undefined\' ? window : globalThis);\n';
}

if (require.main === module) {
  fs.writeFileSync(path.join(root, 'js', 'plan-content.js'), build());
  console.log('js/plan-content.js 갱신 완료');
}
module.exports = { build, criteriaOnly };
