// 워크플로우 결과(.output) → data/_ai_results.json 에 **증분 병합**
//
//   node pipeline/collect_ai.mjs <워크플로결과.json>
//
// 🔴 예전엔 통째로 덮어썼다. 그래서 `--missing` 증분으로 몇 명만 다시 돌린 뒤 이걸 실행하면
//   **기존 총평이 전부 날아갔다**(2026-08-27 실측: 258명분이 23명분으로 줄어들 뻔했다).
//   세션 한도로 나눠 돌리거나 실패한 배치만 재시도할 때도 같은 사고가 난다.
//   → key 기준으로 병합한다. 같은 key 가 오면 새 것으로 교체, 없던 key 는 추가, 나머지는 보존.
//   (SKpolicy 방이 2026-08-16 에 먼저 겪고 고친 것과 같은 패턴 — collect_cab.mjs 와도 원칙이 같다.)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const file = process.argv[2];
if (!file) { console.error("사용: node pipeline/collect_ai.mjs <워크플로결과.json>"); process.exit(1); }

const raw = readFileSync(file, "utf8");
const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const incoming = obj.results || (obj.result && obj.result.results) || [];

const outPath = join(paths.data, "_ai_results.json");
const prev = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")).results || []) : [];
const byKey = new Map(prev.map((r) => [r.key, r]));
const before = byKey.size;

let added = 0, updated = 0, skipped = 0;
for (const r of incoming) {
  // analysis 가 빈 결과는 실패한 배치다 — 기존 총평을 그걸로 덮어쓰면 멀쩡한 걸 잃는다.
  if (!r || !r.key || !r.analysis || !String(r.analysis).trim()) { skipped++; continue; }
  if (byKey.has(r.key)) updated++; else added++;
  byKey.set(r.key, r);
}
const results = [...byKey.values()];
writeFileSync(outPath, JSON.stringify({ results }));

console.log(`✔ _ai_results.json · 이번 +${added}(신규) ~${updated}(갱신)${skipped ? ` ×${skipped}(빈 결과 무시)` : ""} · 누적 ${before} → ${results.length}명`);
