// 국회의원 성향 태깅 워크플로우 결과(.output) → web/data.js 의 members.stance/quotes 갱신
// 사용: node pipeline/build_assembly_analysis.mjs <.output 경로> [추가 .output ...]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const args = process.argv.slice(2);
if (!args.length) { console.error("사용법: node pipeline/build_assembly_analysis.mjs <.output>"); process.exit(1); }

function extract(raw) {
  const r = JSON.parse(raw);
  if (Array.isArray(r?.result?.results)) return r.result.results;
  if (Array.isArray(r?.results)) return r.results;
  if (Array.isArray(r?.result)) return r.result.flatMap((x) => x.results || x || []);
  return [];
}
let tagged = [];
for (const p of args) { try { tagged = tagged.concat(extract(readFileSync(p, "utf8"))); } catch (e) { console.log("! " + p + ": " + e.message); } }
const byName = {}; tagged.forEach((t) => { if (t && t.name) byName[t.name] = t; });
console.log(`태깅 결과 ${tagged.length}건 · 고유 의원 ${Object.keys(byName).length}명`);

const dj = readFileSync(join(paths.web, "data.js"), "utf8");
const APP = JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1));
const BIZ = ["LNG", "H2", "RE", "CITYGAS", "POWER"];
const EMPTY = { LNG: "unknown", H2: "unknown", RE: "unknown", CITYGAS: "unknown", POWER: "unknown" };

let withStance = 0, favor = 0, oppose = 0, neutral = 0;
APP.members.forEach((m) => {
  const t = byName[m.name];
  if (t && t.stance) {
    m.stance = {}; BIZ.forEach((b) => m.stance[b] = t.stance[b] || "unknown");
    m.quotes = (t.quotes || []).map((q) => ({ biz: q.biz, text: q.text, source: "", date: "", confer: "국회 회의록" }));
    if (BIZ.some((b) => m.stance[b] !== "unknown")) withStance++;
    BIZ.forEach((b) => { if (m.stance[b] === "favor") favor++; else if (m.stance[b] === "oppose") oppose++; else if (m.stance[b] === "neutral") neutral++; });
  } else { m.stance = { ...EMPTY }; m.quotes = []; }
});

APP.meta.stancePending = false;
APP.meta.analyzed = true;
APP.meta.updatedAt = new Date().toISOString().slice(0, 10);
APP.meta.analysisNote = "22대 국회 회의록(219건) 발언 발췌 기반 SK E&S 사업별 성향";

const out = "/* 자동 생성 — build_assembly_analysis.mjs. 실제 22대 국회의원 명단 + 회의록 기반 성향. */\nwindow.APP_DATA = " + JSON.stringify(APP) + ";\n";
writeFileSync(join(paths.web, "data.js"), out, "utf8");
console.log(`✔ web/data.js 갱신 · 성향 부여 의원 ${withStance}명 / 전체 ${APP.members.length}`);
console.log(`  사업×의원 성향 분포: 우호 ${favor} · 중립 ${neutral} · 비우호 ${oppose}`);
