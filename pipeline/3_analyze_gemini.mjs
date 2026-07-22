// [3] 의원별 사업 우호도 분석 → data/analysis.json  (Gemini)
//   입력: data/members.json, data/utterances.json
//   ⚠ 대량 1차 배치는 비용 절감을 위해 Gemini "Batch API" 사용 권장(50% 할인). 여기선 동기 호출.
//   사용: node pipeline/3_analyze_gemini.mjs [--only-new] [--limit=N]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { requireEnv, paths } from "./lib/env.mjs";
import { geminiJSON, STANCE_SCHEMA, buildTaggingPrompt } from "./lib/gemini.mjs";
import { ENERGY_KEYWORDS } from "./lib/config.mjs";

const apiKey = requireEnv("GEMINI_API_KEY");
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const onlyNew = process.argv.includes("--only-new");
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0);

const members = JSON.parse(readFileSync(join(paths.data, "members.json"), "utf8"));
const utter = existsSync(join(paths.data, "utterances.json"))
  ? JSON.parse(readFileSync(join(paths.data, "utterances.json"), "utf8")).bySpeaker || {}
  : {};

const outPath = join(paths.data, "analysis.json");
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : [];
const done = new Map(existing.map((a) => [a.memberId, a]));

const today = new Date().toISOString().slice(0, 10);
let processed = 0;

for (const m of members) {
  if (limit && processed >= limit) break;
  if (onlyNew && done.has(m.id)) continue;

  const raw = (utter[m.name] || []).map((u) => u.text);
  const filtered = raw.filter((t) => ENERGY_KEYWORDS.some((k) => t.includes(k)));

  if (!filtered.length) {
    done.set(m.id, { memberId: m.id, stance: { LNG: "unknown", H2: "unknown", RE: "unknown", CITYGAS: "unknown", POWER: "unknown" }, quotes: [], updatedAt: today });
    continue;
  }

  try {
    const res = await geminiJSON({ apiKey, model, prompt: buildTaggingPrompt(m.name, filtered), schema: STANCE_SCHEMA, maxOutputTokens: 700 });
    done.set(m.id, { memberId: m.id, stance: res.stance, quotes: (res.quotes || []).map((q) => ({ ...q, source: "", date: "" })), updatedAt: today });
    processed++;
    console.log(`  ✓ ${m.name} (${processed})`);
    await new Promise((r) => setTimeout(r, 200)); // 간단한 rate limit
  } catch (e) {
    console.log(`  ! ${m.name}: ${e.message}`);
  }
}

writeFileSync(outPath, JSON.stringify([...done.values()], null, 2), "utf8");
console.log(`✔ data/analysis.json 저장 (총 ${done.size}명, 이번 실행 분석 ${processed}명)`);
console.log(`  다음: npm run build:data 로 web/data.js 갱신`);
