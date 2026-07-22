// 태깅 결과에 없는(미분석) 의원과 그 발언만 data/_untagged.json 로 추출
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const outs = process.argv.slice(2);
const done = new Set();
for (const p of outs) {
  try {
    const r = JSON.parse(readFileSync(p, "utf8"));
    const arr = r?.result?.results || r?.results || [];
    arr.forEach((t) => { if (t && t.name) done.add(t.name); });
  } catch (e) { console.log("! " + p + ": " + e.message); }
}
const U = JSON.parse(readFileSync(join(paths.data, "utterances.json"), "utf8")).bySpeaker || {};
const APP = (function () { const d = readFileSync(join(paths.web, "data.js"), "utf8"); return JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1)); })();
const sidoOf = {}; APP.members.forEach((m) => sidoOf[m.name] = m.sido);

const missing = Object.keys(U).filter((n) => !done.has(n));
const members = missing.map((name) => ({
  name, sido: sidoOf[name] || "",
  utterances: U[name].slice(0, 8).map((u) => (u.text.length > 130 ? u.text.slice(0, 130) : u.text)),
}));
writeFileSync(join(paths.data, "_untagged.json"), JSON.stringify({ members }, null, 1), "utf8");
console.log(`태깅완료 ${done.size}명 · 미태깅(발언보유) ${missing.length}명 → data/_untagged.json`);
