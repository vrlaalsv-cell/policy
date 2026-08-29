// AI 종합분석 결과 병합 → web/data.js(members.ai) + web/cabinet.js(speakers.ai)
//  입력: data/_ai_results.json(워크플로우) + data/_ai_manual.json(수기 보완)
//
//   node pipeline/build_ai.mjs            # 평소
//   node pipeline/build_ai.mjs --force    # 대량 실패 가드를 무시하고 강행 (정말 지울 때만)
//
// 🔴 이 스크립트는 실패하면 **기존 분석을 지운다.** 입력을 못 읽으면 catch 로 []가 되고,
//   아래 루프가 data.js·cabinet.js 의 ai 필드를 전부 delete 한 뒤 그대로 덮어쓴다. 원본이 안 남는다.
//   AUTOMATION_TODO.md "⚠️ 함정" #2 가 경고하던 것이라 대량 실패 가드를 넣었다
//   (본보기: 5_collect_news.mjs — 2026-08-08 에 336명 중 9명만 성공해 기사가 통째로 0건이 된 사고 이후 도입).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const FORCE = process.argv.includes("--force");
const KEEP_RATIO = 0.6; // 지금 붙어 있는 것의 60% 미만이면 사고로 본다

function loadResults(file) { try { return JSON.parse(readFileSync(file, "utf8")).results || []; } catch { return []; } }
const results = [
  ...loadResults(join(paths.data, "_ai_results.json")),
  // ⚠ 나중에 로드되는 쪽이 이긴다. _ai_manual.json 에 옛 스냅샷이 남아 있으면 새 분석을 덮어쓴다
  //   (2026-08-08 실사고 — 51건이 남아 있어 재생성분이 화면에 안 나왔다). 손으로 고친 것만 넣을 것.
  ...loadResults(join(paths.data, "_ai_manual.json")),
];
const byKey = {};
for (const r of results) if (r && r.key && r.analysis) byKey[r.key] = { headline: (r.headline || "").trim(), analysis: r.analysis.trim() };
console.log(`분석 ${results.length}건 로드 · 유효 ${Object.keys(byKey).length}건`);

function loadJS(file) { const d = readFileSync(file, "utf8"); const s = d.indexOf("{"), e = d.lastIndexOf("}") + 1; return { head: d.slice(0, s), obj: JSON.parse(d.slice(s, e)), tail: d.slice(e) }; }

const aj = loadJS(join(paths.web, "data.js"));
const cj = loadJS(join(paths.web, "cabinet.js"));

// 🔴 근거가 사라진 사람에게는 총평을 붙이지 않는다 (2026-08-27 실측 4명).
//   기사는 365일 창으로 수집돼서 시간이 지나면 빠지고, 동명이인·군사 '전력(戰力)' 오탐도 나중에 걸러진다.
//   그러면 **화면엔 근거가 하나도 없는데 "AI 종합 분석"만 떠 있는 상태**가 된다 — 독자가 검증할 수 없다.
//   ⚠ `_ai_results.json` 에서 지우지는 않는다. 기사가 다시 잡히면 그대로 되살아나야 하기 때문
//     (지우면 멀쩡한 총평을 잃고 재생성 토큰을 또 쓴다). **표시 단계에서만** 거른다.
const newsOf = (() => {
  try { return JSON.parse(readFileSync(join(paths.data, "news.json"), "utf8")).byMember || {}; } catch { return {}; }
})();
const hasEvidence = (m) => (m.quotes || []).length > 0 || (newsOf[m.id] || []).length > 0;

// ── 🛑 대량 실패 안전장치 ──────────────────────────────────────────────────
//   지금 화면에 붙어 있는 ai 수를 세고, 이번에 붙일 수가 그보다 크게 적으면 **아무것도 쓰지 않고** 멈춘다.
const nowA = aj.obj.members.filter((m) => m.ai).length;
const nowC = (cj.obj.speakers || []).filter((s) => s.ai).length;
const willA = aj.obj.members.filter((m) => byKey[m.id]).length;
const willC = (cj.obj.speakers || []).filter((s) => byKey["cab:" + s.name]).length;
const now = nowA + nowC, will = willA + willC;
if (!FORCE && now > 0 && will < now * KEEP_RATIO) {
  console.error(`\n🛑 중단 — 붙일 분석이 급감했다. 입력이 깨졌을 가능성이 크다.`);
  console.error(`   지금 화면: 국회 ${nowA} · 청와대 ${nowC} (합 ${now}명)`);
  console.error(`   이번 결과: 국회 ${willA} · 청와대 ${willC} (합 ${will}명 — 기준 ${Math.ceil(now * KEEP_RATIO)}명 미만)`);
  console.error(`   data/_ai_results.json 을 먼저 확인할 것. 정말 지우려면 --force.\n`);
  process.exit(1);
}

let na = 0, dropped = [];
for (const m of aj.obj.members) {
  const a = byKey[m.id];
  if (a && !hasEvidence(m)) { dropped.push(m.name); if (m.ai) delete m.ai; continue; }
  if (a) { m.ai = a; na++; } else if (m.ai) { delete m.ai; }
}
writeFileSync(join(paths.web, "data.js"), aj.head + JSON.stringify(aj.obj) + aj.tail, "utf8");

let nc = 0;
for (const sp of cj.obj.speakers) { const a = byKey["cab:" + sp.name]; if (a) { sp.ai = a; nc++; } else if (sp.ai) { delete sp.ai; } }
writeFileSync(join(paths.web, "cabinet.js"), cj.head + JSON.stringify(cj.obj) + cj.tail, "utf8");

console.log(`✔ 국회 ${na}명 · 청와대 ${nc}명 AI 요약 병합`);
if (dropped.length) console.log(`  · 근거(발언·기사)가 없어 화면에 안 붙인 총평 ${dropped.length}명: ${dropped.join(", ")} — _ai_results.json 에는 그대로 남아 기사가 다시 잡히면 복구된다`);

// 붙지 못한 key 를 알려준다 — 이름 표기가 어긋나면 조용히 누락되기 때문이다
// (실제로 "김성환(대독, 제안설명)" 같은 값이 발언자 목록과 안 맞아 1건 떠 있었다).
const used = new Set([...aj.obj.members.filter((m) => m.ai).map((m) => m.id), ...cj.obj.speakers.filter((s) => s.ai).map((s) => "cab:" + s.name)]);
const orphans = Object.keys(byKey).filter((k) => !used.has(k));
if (orphans.length) console.log(`  ⚠ 대상이 없어 안 붙은 분석 ${orphans.length}건: ${orphans.slice(0, 8).join(", ")}${orphans.length > 8 ? " …" : ""}`);
