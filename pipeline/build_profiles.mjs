// 프로필 수집 워크플로우 결과(.output) → web/data.js 의 members.terms/committee 갱신
// 사용: node pipeline/build_profiles.mjs <.output ...>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const argv = process.argv.slice(2);
if (!argv.length) { console.error("사용법: node pipeline/build_profiles.mjs <.output ...>"); process.exit(1); }
function extract(raw) {
  const r = JSON.parse(raw);
  if (Array.isArray(r?.result?.members)) return r.result.members;
  if (Array.isArray(r?.members)) return r.members;
  if (Array.isArray(r?.result)) return r.result.flatMap((x) => x.members || []);
  return [];
}
let profs = [];
for (const p of argv) { try { profs = profs.concat(extract(readFileSync(p, "utf8"))); } catch (e) { console.log("! " + p + ": " + e.message); } }
console.log(`프로필 ${profs.length}건 로드`);

// 이름→프로필(들)
const byName = {};
for (const p of profs) { if (!p || !p.name) continue; (byName[p.name] || (byName[p.name] = [])).push(p); }
const norm = (s) => (s || "").replace(/\s+/g, "").replace(/[·・]/g, "");

const dj = readFileSync(join(paths.web, "data.js"), "utf8");
const APP = JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1));

let gotTerms = 0, gotComm = 0, matched = 0;
for (const m of APP.members) {
  const cands = byName[m.name];
  if (!cands || !cands.length) continue;
  let p = cands[0];
  if (cands.length > 1) { // 동명이인 → 선거구로 매칭
    const byDist = cands.find((c) => norm(c.district) === norm(m.district)) || cands.find((c) => norm(c.district).includes(norm(m.district)) || norm(m.district).includes(norm(c.district)));
    if (byDist) p = byDist;
  }
  matched++;
  if (p.terms && p.terms > 0) { m.terms = p.terms; gotTerms++; }
  if (Array.isArray(p.committees) && p.committees.length) { m.committee = p.committees; gotComm++; }
}
APP.meta.updatedAt = new Date().toISOString().slice(0, 10);

const out = "/* 자동 생성 — build_profiles.mjs 적용. 22대 국회의원 명단+회의록 성향+프로필(선수·위원회). */\nwindow.APP_DATA = " + JSON.stringify(APP) + ";\n";
writeFileSync(join(paths.web, "data.js"), out, "utf8");
console.log(`✔ web/data.js 갱신 · 매칭 ${matched}명 · 선수 ${gotTerms}명 · 위원회 ${gotComm}명 (전체 ${APP.members.length})`);
