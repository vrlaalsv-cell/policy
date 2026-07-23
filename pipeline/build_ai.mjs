// AI 종합분석 결과 병합 → web/data.js(members.ai) + web/cabinet.js(speakers.ai)
//  입력: data/_ai_results.json(워크플로우) + data/_ai_manual.json(수기 보완)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

function loadResults(file) { try { return JSON.parse(readFileSync(file, "utf8")).results || []; } catch { return []; } }
const results = [
  ...loadResults(join(paths.data, "_ai_results.json")),
  ...loadResults(join(paths.data, "_ai_manual.json")),
];
const byKey = {};
for (const r of results) if (r && r.key && r.analysis) byKey[r.key] = { headline: (r.headline || "").trim(), analysis: r.analysis.trim() };
console.log(`분석 ${results.length}건 로드 · 유효 ${Object.keys(byKey).length}건`);

function loadJS(file) { const d = readFileSync(file, "utf8"); const s = d.indexOf("{"), e = d.lastIndexOf("}") + 1; return { head: d.slice(0, s), obj: JSON.parse(d.slice(s, e)), tail: d.slice(e) }; }

const aj = loadJS(join(paths.web, "data.js"));
let na = 0;
for (const m of aj.obj.members) { const a = byKey[m.id]; if (a) { m.ai = a; na++; } else if (m.ai) { delete m.ai; } }
writeFileSync(join(paths.web, "data.js"), aj.head + JSON.stringify(aj.obj) + aj.tail, "utf8");

const cj = loadJS(join(paths.web, "cabinet.js"));
let nc = 0;
for (const sp of cj.obj.speakers) { const a = byKey["cab:" + sp.name]; if (a) { sp.ai = a; nc++; } else if (sp.ai) { delete sp.ai; } }
writeFileSync(join(paths.web, "cabinet.js"), cj.head + JSON.stringify(cj.obj) + cj.tail, "utf8");

console.log(`✔ 국회 ${na}명 · 청와대 ${nc}명 AI 요약 병합`);
