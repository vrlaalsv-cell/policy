// 워크플로우 결과(.output) → data/_cab_results.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
const raw = readFileSync(process.argv[2], "utf8");
const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const statements = obj.statements || (obj.result && obj.result.statements) || [];
writeFileSync(join(paths.data, "_cab_results.json"), JSON.stringify({ statements }));
console.log(`✔ _cab_results.json · 발언 ${statements.length}건 (filesOk=${obj.filesOk})`);
