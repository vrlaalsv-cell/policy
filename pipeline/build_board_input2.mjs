// 사업×성향 그룹별 후보 의원 + 발언 → data/_board_input.json (보드 선정·요약 LLM 입력)
//
//   node pipeline/build_board_input2.mjs [--top=8] [--stmts=5]
//
// ⚠ 구버전 build_board_input.mjs 는 data/utt_ctx.json 을 읽는데 그 파일이 저장소에 없어
//   재생성이 막혀 있었다. 그 결과 web/bizboard.js 가 2026-07-23 스냅샷에 동결됐고,
//   보드에 실린 발언수가 실제와 크게 어긋났다(대조 43명 중 41명 불일치, 2026-08-09 실측).
//   → 이 버전은 web/data.js 의 members[].quotes 를 직접 읽는다. 발언에 biz 가 이미 붙어 있어
//     키워드 재매칭이 필요 없고, 화면에 보이는 근거와 보드가 항상 일치한다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? Number(h.split("=")[1]) : d; };
const TOP = arg("top", 8);        // 그룹당 LLM 에 넘길 후보 수
const STMTS = arg("stmts", 5);    // 후보당 발언 표본 수

const BIZ = ["POWER", "LNG", "RE", "H2", "CITYGAS", "NUCLEAR"];
const BIZLABEL = { POWER: "전력", LNG: "LNG", RE: "재생E", H2: "수소", CITYGAS: "도시가스", NUCLEAR: "원전" };
const SLABEL = { favor: "우호", neutral: "중립", oppose: "비우호" };

const dj = readFileSync(join(paths.web, "data.js"), "utf8");
const APP = JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1));

function shorten(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const c = s.slice(0, n), sp = c.lastIndexOf(" ");
  return (sp > n * 0.6 ? c.slice(0, sp) : c) + "…";
}
/** 회의명에서 날짜 뽑기 — 최신 발언을 우선 보여주기 위함 */
const dateOf = (q) => (String(q.meeting || "").match(/(\d{4})[-.](\d{2})[-.](\d{2})/) || []).slice(1).join("-");

const groups = [];
for (const b of BIZ) for (const st of ["favor", "neutral", "oppose"]) {
  const cands = [];
  for (const m of APP.members) {
    if (((m.stance && m.stance[b]) || "unknown") !== st) continue;
    const hits = (m.quotes || []).filter((q) => q.biz === b);
    if (!hits.length) continue;
    // 표본은 최신 우선 + 너무 짧은 것 제외 (보드 요약의 근거가 된다)
    const statements = hits.slice()
      .sort((a, c) => (dateOf(c) || "").localeCompare(dateOf(a) || "") || (c.core || "").length - (a.core || "").length)
      .filter((q) => (q.core || q.text || "").length >= 40)
      .slice(0, STMTS)
      .map((q) => shorten(q.core || q.text, 170));
    if (!statements.length) continue;
    cands.push({ id: m.id, name: m.name, party: m.party, count: hits.length, statements });
  }
  cands.sort((a, c) => c.count - a.count);
  if (cands.length) groups.push({ biz: b, bizLabel: BIZLABEL[b], stance: st, stanceLabel: SLABEL[st], candidates: cands.slice(0, TOP) });
}

writeFileSync(join(paths.data, "_board_input.json"), JSON.stringify({ groups }), "utf8");
console.log(`✔ data/_board_input.json · 그룹 ${groups.length}개 (후보 상위 ${TOP}명 · 발언 표본 ${STMTS}건)`);
for (const g of groups) {
  const top = g.candidates.slice(0, 3).map((c) => `${c.name}(${c.count})`).join(", ");
  console.log(`  ${g.bizLabel}/${g.stanceLabel}: 후보 ${g.candidates.length}명 — ${top}`);
}
