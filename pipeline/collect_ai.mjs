// 워크플로우 결과(.output) → data/_ai_results.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
const raw = readFileSync(process.argv[2], "utf8");
const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const results = obj.results || (obj.result && obj.result.results) || [];
writeFileSync(join(paths.data, "_ai_results.json"), JSON.stringify({ results }));
console.log(`✔ _ai_results.json · ${results.length}명`);
