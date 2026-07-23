// [build] data/*.json → web/data.js (대시보드가 읽는 최종 산출물)
//   members.json (+ analysis.json, news.json 있으면 병합) → window.APP_DATA
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
import { META, SIDO } from "./lib/config.mjs";

function readJSON(name, fallback) {
  const p = join(paths.data, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
}

const members = readJSON("members.json", null);
if (!members) {
  console.error("data/members.json 이 없습니다. 먼저 `npm run collect:members` 실행.");
  process.exit(1);
}
const analysis = readJSON("analysis.json", []);
const newsRaw = readJSON("news.json", {});
const news = newsRaw.byMember || newsRaw;   // {meta,byMember} / 구버전 flat map 둘 다 지원
const byId = Object.fromEntries(analysis.map((a) => [a.memberId, a]));

const merged = members.map((m) => {
  const a = byId[m.id];
  const emptyStance = { LNG: "unknown", H2: "unknown", RE: "unknown", CITYGAS: "unknown", POWER: "unknown" };
  return {
    ...m,
    stance: a?.stance || emptyStance,
    quotes: a?.quotes || [],
    news: news[m.id] || [],
  };
});

const APP = {
  meta: { ...META, isSample: false, updatedAt: new Date().toISOString().slice(0, 10) },
  sido: SIDO,
  members: merged,
};

const out = "/* 자동 생성 — build_web_data.mjs. 직접 수정 금지 */\nwindow.APP_DATA = " + JSON.stringify(APP) + ";\n";
writeFileSync(join(paths.web, "data.js"), out, "utf8");
console.log(`✔ web/data.js 생성 (의원 ${merged.length}명, 분석 ${analysis.length}건)`);
