// 국회 회의록(HTML .xls) 전량 파싱 → 에너지 발언만 추려 의원별로 정리 → data/utterances.json
// 사용: node pipeline/parse_speeches.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
import { ENERGY_KEYWORDS } from "./lib/config.mjs";

const DIR = join(paths.data, "raw", "국회 회의록");
const files = readdirSync(DIR).filter((f) => /\.xls$/i.test(f));
console.log(`회의록 파일 ${files.length}개`);

// 의원 명단(실명) 로드 — web/data.js
const dj = readFileSync(join(paths.web, "data.js"), "utf8");
const APP = JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1));
const roster = new Set(APP.members.map((m) => m.name));
console.log(`의원 명단 ${roster.size}명`);

const KW = new RegExp(ENERGY_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
const ROLE_MEMBER = /위원|의원|간사/;        // 의원 발언 표시
const ROLE_NONMEMBER = /장관|차관|참고인|증인|실장|정책관|국장|본부장|청장|처장|차장|원장|과장|단장|총장|국무위원|후보자|소장|위원회위원장?$/;

function clean(s) {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function memberOf(speaker) {
  if (!speaker || !ROLE_MEMBER.test(speaker)) return null;
  var toks = speaker.split(" ");
  for (var i = 0; i < toks.length; i++) if (roster.has(toks[i])) return toks[i];
  return null;
}

const bySpeaker = {};
let totalRows = 0, energyRows = 0, kept = 0;
const CAP = 60; // 의원당 최대 발췌 수(토큰 관리)

for (const f of files) {
  let html;
  try { html = readFileSync(join(DIR, f), "utf8"); } catch (e) { console.log("! " + f + ": " + e.message); continue; }
  const mt = html.match(/회의제목[\s\S]{0,80}?<th[^>]*>([\s\S]*?)<\/th>/);
  const meeting = mt ? clean(mt[1]) : f;
  const rows = html.split(/<tr[^>]*>/i);
  for (const row of rows) {
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => clean(m[1]));
    if (tds.length < 2) continue;
    const speaker = tds[0], text = tds[1];
    if (!speaker || !text || text.length < 6) continue;
    totalRows++;
    if (!KW.test(text)) continue;
    energyRows++;
    const name = memberOf(speaker);
    if (!name) continue;
    const arr = (bySpeaker[name] || (bySpeaker[name] = []));
    if (arr.length < CAP) { arr.push({ text: text.length > 400 ? text.slice(0, 400) : text, meeting: meeting }); kept++; }
  }
}

const out = {
  updatedAt: new Date().toISOString().slice(0, 10),
  totalFiles: files.length, totalRows, energyRows, keptUtterances: kept,
  speakerCount: Object.keys(bySpeaker).length, bySpeaker,
};
writeFileSync(join(paths.data, "utterances.json"), JSON.stringify(out), "utf8");
console.log(`✔ data/utterances.json`);
console.log(`  전체 발언행 ${totalRows} · 에너지관련 ${energyRows} · 의원귀속 발췌 ${kept} · 대상 의원 ${out.speakerCount}명`);
const top = Object.entries(bySpeaker).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
console.log("  상위 의원:", top.map(([n, a]) => n + "(" + a.length + ")").join(", "));
