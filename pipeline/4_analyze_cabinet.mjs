// [4] 국무회의 회의록(지정 폴더) → 국무위원별 성향 → data/cabinet.json  (Gemini)
//   입력 폴더: .env 의 CABINET_MINUTES_DIR (기본 ./data/cabinet_minutes)
//   지원: .txt / .md  (.pdf/.hwp 는 먼저 텍스트로 변환해 두세요)
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { requireEnv, loadEnv, paths } from "./lib/env.mjs";
import { geminiJSON } from "./lib/gemini.mjs";
import { ENERGY_KEYWORDS } from "./lib/config.mjs";

loadEnv();
const apiKey = requireEnv("GEMINI_API_KEY");
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const dir = process.env.CABINET_MINUTES_DIR || join(paths.data, "cabinet_minutes");

const CABINET_SCHEMA = {
  type: "object",
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },  // 예: 국무총리, 산업통상자원부 장관
          stance: {
            type: "object",
            properties: {
              LNG: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
              H2: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
              RE: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
              CITYGAS: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
              POWER: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
            },
            required: ["LNG", "H2", "RE", "CITYGAS", "POWER"],
          },
          quotes: { type: "array", items: { type: "object", properties: { biz: { type: "string" }, text: { type: "string" } }, required: ["biz", "text"] } },
        },
        required: ["name", "stance"],
      },
    },
  },
  required: ["people"],
};

if (!existsSync(dir)) { console.log(`지정 폴더가 없습니다: ${dir}`); process.exit(0); }
const files = readdirSync(dir).filter((f) => [".txt", ".md"].includes(extname(f).toLowerCase()));
if (!files.length) { console.log(`${dir} 에 분석할 .txt/.md 회의록이 없습니다. (README 참고)`); process.exit(0); }

const merged = new Map(); // name → record
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  // 에너지 관련 문단만 추려 토큰 절감
  const passages = text.split(/\n{2,}|(?=◯|○)/).filter((p) => ENERGY_KEYWORDS.some((k) => p.includes(k)));
  if (!passages.length) { console.log(`  · ${f}: 에너지 관련 발언 없음`); continue; }
  const prompt = [
    `다음은 국무회의 회의록에서 에너지 관련으로 추린 발언 문단이다.`,
    `발언한 국무위원(총리/장차관)별로 LNG/H2(수소)/RE(재생에너지)/CITYGAS(도시가스)/POWER(전력) 성향을`,
    `favor/neutral/oppose/unknown 으로 판정하고, 근거 발언을 quotes 에 원문으로 담아라.`,
    ``,
    passages.slice(0, 60).join("\n\n"),
  ].join("\n");

  try {
    const res = await geminiJSON({ apiKey, model, prompt, schema: CABINET_SCHEMA, maxOutputTokens: 1200 });
    for (const p of res.people || []) {
      merged.set(p.name, { ...p, source: f });
    }
    console.log(`  ✓ ${f}: ${res.people?.length || 0}명`);
  } catch (e) {
    console.log(`  ! ${f}: ${e.message}`);
  }
}

const out = { updatedAt: new Date().toISOString().slice(0, 10), isSample: false, members: [...merged.values()] };
writeFileSync(join(paths.data, "cabinet.json"), JSON.stringify(out, null, 2), "utf8");
console.log(`✔ data/cabinet.json 저장 (국무위원 ${out.members.length}명)`);
