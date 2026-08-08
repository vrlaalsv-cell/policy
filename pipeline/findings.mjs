// 조사 저장소 조회 — data/findings.json
//
//   node pipeline/findings.mjs               # 전체 목록
//   node pipeline/findings.mjs 회의록          # 키워드로 검색 (dead_ends 포함)
//
// ⚠ 조사하기 전에 여기부터 뒤진다. 알아낸 건 시키지 않아도 여기에 적재한다.
//   특히 "찾아봤는데 없더라"(dead_ends)를 남겨야 다음 세션이 같은 곳을 다시 훑지 않는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const db = JSON.parse(readFileSync(join(paths.data, "findings.json"), "utf8"));
const q = process.argv.slice(2).join(" ").trim();
const hit = (o) => !q || JSON.stringify(o).toLowerCase().includes(q.toLowerCase());

const F = (db.findings || []).filter(hit);
const D = (db.dead_ends || []).filter(hit);

console.log(`조사 저장소 (갱신 ${db.updatedAt}) — 확인사실 ${db.findings.length}건 · dead_ends ${db.dead_ends.length}건`);
if (q) console.log(`검색어 "${q}" → 확인사실 ${F.length}건 · dead_ends ${D.length}건`);

for (const f of F) {
  console.log(`\n■ [${f.id}] ${f.title}`);
  console.log(`   주제: ${f.topic} · 확인 ${f.verifiedAt}`);
  if (f.summary) console.log(`   ${f.summary}`);
  for (const s of f.steps || []) console.log(`   ${s.step}) ${s.what}\n      ${s.url}`);
  for (const g of f.gotchas || []) console.log(`   ⚠ ${g}`);
  if (f.compat) console.log(`   호환성: ${f.compat}`);
  if (f.coverage) console.log(`   범위: ${f.coverage}`);
}

if (D.length) {
  console.log(`\n─── dead_ends (찾아봤는데 없더라 — 다시 조사하지 말 것) ───`);
  for (const d of D) console.log(`\n✗ ${d.what}\n   → ${d.verdict}${d.evidence ? `\n   근거: ${d.evidence}` : ""}`);
}
if (!F.length && !D.length) console.log("\n해당 없음 — 새로 조사했으면 findings.json 에 적재할 것.");
