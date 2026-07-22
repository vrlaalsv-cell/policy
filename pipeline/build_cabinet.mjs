// 워크플로우 .output(들) → data/cabinet.json + web/cabinet.js
//   국무/차관 회의록 발췌 발언을 발언자별·사업별로 집계.
// 사용: node pipeline/build_cabinet.mjs <output1.output> [output2.output ...]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const args = process.argv.slice(2);
if (!args.length) { console.error("사용법: node pipeline/build_cabinet.mjs <.output 경로들>"); process.exit(1); }

function extract(raw) {
  const r = JSON.parse(raw);
  if (Array.isArray(r?.result?.statements)) return r.result.statements;
  if (Array.isArray(r?.statements)) return r.statements;
  if (Array.isArray(r?.result)) return r.result.flatMap((x) => x.statements || []);
  return [];
}

let stmts = [];
for (const p of args) { try { stmts = stmts.concat(extract(readFileSync(p, "utf8"))); } catch (e) { console.log("! 읽기 실패:", p, e.message); } }
console.log(`발췌 발언 총 ${stmts.length}건 로드`);

// dedup (speaker+quote 앞부분)
const seen = new Set(); const uniq = [];
for (const s of stmts) {
  const k = (s.speaker || "") + "|" + (s.quote || "").slice(0, 40);
  if (seen.has(k)) continue; seen.add(k); uniq.push(s);
}
console.log(`중복 제거 후 ${uniq.length}건`);

const BIZ = ["LNG", "H2", "RE", "CITYGAS", "POWER"];
function agg(counts) { // {favor,neutral,oppose} → 대표 성향
  const f = counts.favor || 0, o = counts.oppose || 0, n = counts.neutral || 0;
  if (f > o) return "favor"; if (o > f) return "oppose"; if (f + o + n === 0) return "unknown"; return "neutral";
}

// 발언자별 집계
const bySpeaker = {};
for (const s of uniq) {
  const name = (s.speaker || "").trim(); if (!name) continue;
  const sp = bySpeaker[name] || (bySpeaker[name] = { name, role: s.role || "", tally: {}, quotes: [] });
  // 더 구체적인(긴) 직위 채택
  if ((s.role || "").length > sp.role.length) sp.role = s.role;
  for (const b of (s.businesses || [])) {
    if (!BIZ.includes(b)) continue;
    (sp.tally[b] || (sp.tally[b] = { favor: 0, neutral: 0, oppose: 0 }))[s.stance] += 1;
  }
  sp.quotes.push({ businesses: s.businesses || [], stance: s.stance, quote: s.quote, meeting: s.meeting, note: s.note });
}
// 발언자별 사업 성향 확정
const speakers = Object.values(bySpeaker).map((sp) => {
  const stance = {}; BIZ.forEach((b) => stance[b] = sp.tally[b] ? agg(sp.tally[b]) : "unknown");
  return { name: sp.name, role: sp.role, stance, count: sp.quotes.length, quotes: sp.quotes };
}).sort((a, b) => b.count - a.count);

// 사업별 발언 모음
const byBusiness = {}; BIZ.forEach((b) => byBusiness[b] = []);
for (const s of uniq) for (const b of (s.businesses || [])) if (byBusiness[b]) byBusiness[b].push({ speaker: s.speaker, role: s.role, meeting: s.meeting, stance: s.stance, quote: s.quote, note: s.note, businesses: s.businesses });

// 통계
const stanceCount = { favor: 0, neutral: 0, oppose: 0 };
uniq.forEach((s) => { stanceCount[s.stance] = (stanceCount[s.stance] || 0) + 1; });
const bizCount = {}; BIZ.forEach((b) => bizCount[b] = byBusiness[b].length);

const out = {
  updatedAt: new Date().toISOString().slice(0, 10),
  source: "이재명 정부 국무회의·차관회의 회의록(94건) 발췌 분석",
  totalStatements: uniq.length, stanceCount, bizCount,
  speakers, byBusiness,
};

writeFileSync(join(paths.data, "cabinet.json"), JSON.stringify(out, null, 2), "utf8");
writeFileSync(join(paths.web, "cabinet.js"), "/* 자동생성 build_cabinet.mjs */\nwindow.CABINET_DATA = " + JSON.stringify(out) + ";\n", "utf8");
console.log(`✔ data/cabinet.json, web/cabinet.js 생성`);
console.log(`  발언자 ${speakers.length}명 · 사업별 건수 ${JSON.stringify(bizCount)} · 성향 ${JSON.stringify(stanceCount)}`);
console.log(`  상위 발언자:`, speakers.slice(0, 8).map((s) => s.name + "(" + s.count + ")").join(", "));
