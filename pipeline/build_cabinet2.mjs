// 청와대 재분석 결과(data/_cab_results.json) → data/cabinet.json + web/cabinet.js
//  · 6사업(POWER,LNG,RE,H2,CITYGAS,NUCLEAR) · 발언에 앞뒤 맥락 포함 · 회의명·날짜(meeting) 유지
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const BIZ = ["POWER", "LNG", "RE", "H2", "CITYGAS", "NUCLEAR"];
const res = JSON.parse(readFileSync(join(paths.data, "_cab_results.json"), "utf8"));
let stmts = res.statements || res || [];
console.log(`발췌 발언 ${stmts.length}건 로드`);

// dedup (speaker + quote 앞부분)
const seen = new Set(); const uniq = [];
for (const s of stmts) {
  if (!s || !s.quote) continue;
  const k = (s.speaker || "") + "|" + (s.quote || "").slice(0, 40);
  if (seen.has(k)) continue; seen.add(k); uniq.push(s);
}
console.log(`중복 제거 후 ${uniq.length}건`);

function agg(c) { const f = c.favor || 0, o = c.oppose || 0, n = c.neutral || 0; if (f > o) return "favor"; if (o > f) return "oppose"; if (f + o + n === 0) return "unknown"; return "neutral"; }

const bySpeaker = {};
for (const s of uniq) {
  const name = (s.speaker || "").trim(); if (!name) continue;
  const sp = bySpeaker[name] || (bySpeaker[name] = { name, role: s.role || "", tally: {}, quotes: [] });
  if ((s.role || "").length > sp.role.length) sp.role = s.role;
  for (const b of (s.businesses || [])) { if (!BIZ.includes(b)) continue; (sp.tally[b] || (sp.tally[b] = { favor: 0, neutral: 0, oppose: 0 }))[s.stance] = ((sp.tally[b] || {})[s.stance] || 0) + 1; }
  sp.quotes.push({ businesses: (s.businesses || []).filter((b) => BIZ.includes(b)), stance: s.stance, quote: s.quote, meeting: s.meeting, note: s.note });
}
const speakers = Object.values(bySpeaker).map((sp) => {
  const stance = {}; BIZ.forEach((b) => stance[b] = sp.tally[b] ? agg(sp.tally[b]) : "unknown");
  return { name: sp.name, role: sp.role, stance, count: sp.quotes.length, quotes: sp.quotes };
}).sort((a, b) => b.count - a.count);

const byBusiness = {}; BIZ.forEach((b) => byBusiness[b] = []);
for (const s of uniq) for (const b of (s.businesses || [])) if (byBusiness[b]) byBusiness[b].push({ speaker: s.speaker, role: s.role, meeting: s.meeting, stance: s.stance, quote: s.quote, note: s.note, businesses: (s.businesses || []).filter((x) => BIZ.includes(x)) });

const stanceCount = { favor: 0, neutral: 0, oppose: 0 };
uniq.forEach((s) => { stanceCount[s.stance] = (stanceCount[s.stance] || 0) + 1; });
const bizCount = {}; BIZ.forEach((b) => bizCount[b] = byBusiness[b].length);

const out = { updatedAt: new Date().toISOString().slice(0, 10), source: "이재명 정부 국무회의·차관회의 회의록(94건) 발췌 분석 · 6사업(원전 포함)", totalStatements: uniq.length, stanceCount, bizCount, speakers, byBusiness };
writeFileSync(join(paths.data, "cabinet.json"), JSON.stringify(out, null, 2), "utf8");
writeFileSync(join(paths.web, "cabinet.js"), "/* 자동생성 build_cabinet2.mjs */\nwindow.CABINET_DATA = " + JSON.stringify(out) + ";\n", "utf8");
console.log(`✔ cabinet.json / cabinet.js · 발언자 ${speakers.length}명 · 사업별 ${JSON.stringify(bizCount)} · 성향 ${JSON.stringify(stanceCount)}`);
console.log(`  상위:`, speakers.slice(0, 8).map((s) => s.name + "(" + s.count + ")").join(", "));
