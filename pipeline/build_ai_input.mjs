// AI 종합분석 입력 배치 생성 → data/_ai/{asm|cab}_b*.json
//  국회: web/data.js(성향·발언) + data/news.json(뉴스)  /  청와대: web/cabinet.js
//
//   node pipeline/build_ai_input.mjs                 # 전원 (재생성)
//   node pipeline/build_ai_input.mjs --missing       # 총평이 아직 없는 사람만 (증분)
//   node pipeline/build_ai_input.mjs --batch=8       # 배치당 인원 (기본 6)
//
// 🔴 `--missing` 이 왜 필요한가 — 워크스페이스 공통 원칙 "한 거 또 하지 마라"(C:\AI\CLAUDE.md §①).
//   전원을 다시 돌리면 이미 총평이 있는 사람까지 AI 에 또 보내 토큰이 그대로 낭비된다.
//   실측(2026-08-27): 청와대 49명 중 33명은 이미 총평 보유 → 증분이면 **16명(3배치)만** 보내면 된다.
//   판단 기준은 `_ai_results.json`(+`_ai_manual.json`)의 key 다 — 그게 build_ai.mjs 가 병합에 쓰는 키와 같다.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const ONLY_MISSING = process.argv.includes("--missing");
const BATCH = (() => { const h = process.argv.find((a) => a.startsWith("--batch=")); return h ? Math.max(1, Number(h.split("=")[1])) : 6; })();

// 이미 총평이 있는 key 집합. analysis 가 비어 있으면 "안 한 것"으로 본다(실패한 배치 재시도용).
const doneKeys = (() => {
  const s = new Set();
  for (const f of ["_ai_results.json", "_ai_manual.json"]) {
    try {
      for (const r of JSON.parse(readFileSync(join(paths.data, f), "utf8")).results || []) {
        if (r && r.key && r.analysis && String(r.analysis).trim()) s.add(r.key);
      }
    } catch { /* 없으면 없는 대로 — 전원이 대상이 된다 */ }
  }
  return s;
})();

function loadJS(file) { const d = readFileSync(file, "utf8"); return JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1)); }
const APP = loadJS(join(paths.web, "data.js"));
const CAB = loadJS(join(paths.web, "cabinet.js"));
const NEWS = (function () { try { return JSON.parse(readFileSync(join(paths.data, "news.json"), "utf8")); } catch { return { byMember: {} }; } })();
const byMemberNews = NEWS.byMember || {};

const SLABEL = { favor: "우호", oppose: "비우호", neutral: "중립", unknown: "자료없음" };
const BIZLABEL = { POWER: "전력", LNG: "LNG", RE: "재생E", H2: "수소", CITYGAS: "도시가스", NUCLEAR: "원전", ESOL: "에너지솔루션", DISTE: "분산에너지" };
const BIZ = Object.keys(BIZLABEL);
function stanceLine(st) { return BIZ.map((b) => BIZLABEL[b] + ":" + SLABEL[(st && st[b]) || "unknown"]).join(" · "); }
function cap(s, n) { s = s || ""; return s.length > n ? s.slice(0, n) + "…" : s; }
function newsItems(list) { return (list || []).slice(0, 6).map((a) => ({ title: cap(a.title, 120), labels: (a.labels || []).map((x) => BIZLABEL[x] || x), date: a.date })); }

// 국회
const nameToNews = {};
APP.members.forEach((m) => { if (byMemberNews[m.id]) nameToNews[m.name] = byMemberNews[m.id]; });
const asm = [];
APP.members.forEach((m) => {
  const quotes = (m.quotes || []).slice(0, 8).map((q) => ({ biz: BIZLABEL[q.biz] || q.biz, text: cap(q.core || q.text, 170) }));
  const news = newsItems(byMemberNews[m.id]);
  if (!quotes.length && !news.length) return; // 자료 없으면 제외
  asm.push({ key: m.id, kind: "asm", name: m.name, party: m.party, district: m.district, stances: stanceLine(m.stance), quotes, news });
});

// 청와대 — 발언은 최신 회의부터 8건 (뒤에 붙은 최근 발언이 잘려나가지 않도록)
const mDate = (q) => ((q && q.meeting) || "").match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
const cab = CAB.speakers.map((sp) => ({
  key: "cab:" + sp.name, kind: "cab", name: sp.name, role: sp.role || "",
  stances: stanceLine(sp.stance),
  quotes: (sp.quotes || []).slice().sort((a, b) => mDate(b).localeCompare(mDate(a))).slice(0, 8)
    .map((q) => ({ biz: (q.businesses || []).map((b) => BIZLABEL[b] || b).join("/"), text: cap(q.quote, 170), note: cap(q.note, 120), meeting: q.meeting })),
  // 국무위원 기사는 5_collect_news.mjs 가 "CAB:<이름>" 키로 모은다(:65). 이름 매칭(nameToNews)은
  // 국회의원 명단을 거치는 경로라 국회의원이 아닌 국무위원은 하나도 안 걸렸다 —
  // 그 결과 대통령을 포함한 13명 53건의 기사가 AI 종합분석 입력에서 통째로 빠져 있었다(2026-08-08).
  news: newsItems(nameToNews[sp.name] || byMemberNews["CAB:" + sp.name]),
}));

// 증분 필터 — 이미 총평이 있는 사람은 뺀다.
const asmAll = asm.length, cabAll = cab.length;
const asmOut = ONLY_MISSING ? asm.filter((p) => !doneKeys.has(p.key)) : asm;
const cabOut = ONLY_MISSING ? cab.filter((p) => !doneKeys.has(p.key)) : cab;

const dir = join(paths.data, "_ai");
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
function writeBatches(arr, prefix) {
  let n = 0;
  for (let i = 0; i < arr.length; i += BATCH) { writeFileSync(join(dir, prefix + "_b" + n + ".json"), JSON.stringify({ people: arr.slice(i, i + BATCH) })); n++; }
  return n;
}
const na = writeBatches(asmOut, "asm"), nc = writeBatches(cabOut, "cab");

if (ONLY_MISSING) {
  console.log(`✔ data/_ai/ (증분 · 배치당 ${BATCH}명)`);
  console.log(`   국회   ${asmOut.length}명(${na}배치)  — 이미 총평 있어 제외 ${asmAll - asmOut.length}명 / 전체 ${asmAll}명`);
  console.log(`   청와대 ${cabOut.length}명(${nc}배치)  — 이미 총평 있어 제외 ${cabAll - cabOut.length}명 / 전체 ${cabAll}명`);
  // 🔴 0건이면 AI 단계를 아예 건너뛰라고 명시한다 — 안 그러면 빈 배치로 워크플로를 돌린다.
  if (!asmOut.length && !cabOut.length) console.log(`\n   → 새로 분석할 인물이 없다. 워크플로를 돌릴 필요 없다.`);
  // 🔴 증분 대상은 대개 **근거가 얇은 인물**(발언 1~2건)이라 AI 가 부풀리기 쉽다.
  //   그래서 무검증 wf_ai.js 가 아니라 검증이 붙은 wf_ai_verified.js 를 안내한다(2026-08-27 실측 23명 중 2명 탈락).
  else console.log(`\n   → wf_ai_verified.js args: { "dir": "${dir.replace(/\\/g, "\\\\")}", "asm": ${na}, "cab": ${nc} }`);
} else {
  console.log(`✔ data/_ai/ · 국회 ${asmOut.length}명(${na}배치) · 청와대 ${cabOut.length}명(${nc}배치)`);
}
