// utt_ctx.json → 6사업 태깅용 소배치 (data/_ab2/b{i}.json)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
const U = JSON.parse(readFileSync(join(paths.data, "utt_ctx.json"), "utf8")).bySpeaker || {};
const APP = (function () { const d = readFileSync(join(paths.web, "data.js"), "utf8"); return JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1)); })();
const sidoOf = {}; APP.members.forEach((m) => sidoOf[m.name] = m.sido);
const BATCH = 8, PER = 16;
const names = Object.keys(U);
const dir = join(paths.data, "_ab2");
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
let n = 0;
for (let i = 0; i < names.length; i += BATCH) {
  const members = names.slice(i, i + BATCH).map((name) => ({ name, sido: sidoOf[name] || "", utterances: U[name].slice(0, PER) }));
  writeFileSync(join(dir, "b" + n + ".json"), JSON.stringify({ batch: n, members }), "utf8");
  n++;
}
console.log(`✔ ${n}개 배치 (의원 ${names.length}명) → data/_ab2/`);
