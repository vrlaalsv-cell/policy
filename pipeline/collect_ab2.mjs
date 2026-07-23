// 워크플로우 결과(.output) → data/_ab2_results.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
const src = process.argv[2];
const raw = readFileSync(src, "utf8");
const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const members = obj.members || (obj.result && obj.result.members) || [];
writeFileSync(join(paths.data, "_ab2_results.json"), JSON.stringify({ members }));
console.log(`✔ _ab2_results.json · 의원 ${members.length}명 (batchesOk=${obj.batchesOk})`);
