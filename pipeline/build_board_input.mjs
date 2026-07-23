// 사업×성향 그룹별 후보 의원 + 발언 → data/_board_input.json (LLM 선정·요약 입력)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const BIZ = ["POWER", "LNG", "RE", "H2", "CITYGAS", "NUCLEAR"];
const BIZLABEL = { POWER: "전력", LNG: "LNG", RE: "재생E", H2: "수소", CITYGAS: "도시가스", NUCLEAR: "원전" };
const SLABEL = { favor: "우호", neutral: "중립", oppose: "비우호" };
const KW = {
  POWER: /(전력망|송전|배전|전기\s?요금|전력\s?요금|전력수급|전력시장|전원믹스|한국전력|한전|분산에너지|전기사업법|송배전|계통)/,
  LNG: /(LNG|천연가스|가스공사|직수입|액화천연|열병합|집단에너지|가스전)/,
  RE: /(재생에너지|신재생|태양광|풍력|해상풍력|RE100|영농형|햇빛|바이오매스|재생E)/,
  H2: /(수소|연료전지|암모니아)/,
  CITYGAS: /(도시가스|소매요금|가스요금|가스배관)/,
  NUCLEAR: /(원전|원자력|SMR|탈원전|월성|방폐장|고준위|핵발전|원자로|한수원)/,
};
function shorten(s, n) { s = (s || "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s; var c = s.slice(0, n); var sp = c.lastIndexOf(" "); if (sp > n * 0.6) c = c.slice(0, sp); return c + "…"; }

const U = JSON.parse(readFileSync(join(paths.data, "utt_ctx.json"), "utf8")).bySpeaker || {};
const APP = (function () { const d = readFileSync(join(paths.web, "data.js"), "utf8"); return JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1)); })();

const groups = [];
for (const b of BIZ) for (const st of ["favor", "neutral", "oppose"]) {
  const re = KW[b];
  const cands = [];
  for (const m of APP.members) {
    if (((m.stance && m.stance[b]) || "unknown") !== st) continue;
    const hits = (U[m.name] || []).filter((u) => re.test(u.core || ""));
    if (!hits.length) continue;
    const statements = hits.slice().sort((a, c) => (c.core || "").length - (a.core || "").length).slice(0, 5).map((u) => shorten(u.core, 170));
    cands.push({ id: m.id, name: m.name, party: m.party, count: hits.length, statements });
  }
  cands.sort((a, c) => c.count - a.count);
  if (cands.length) groups.push({ biz: b, bizLabel: BIZLABEL[b], stance: st, stanceLabel: SLABEL[st], candidates: cands.slice(0, 8) });
}
writeFileSync(join(paths.data, "_board_input.json"), JSON.stringify({ groups }));
console.log("✔ data/_board_input.json · 그룹 " + groups.length + "개");
groups.forEach((g) => console.log("  " + g.bizLabel + "/" + g.stanceLabel + ": 후보 " + g.candidates.length + "명"));
