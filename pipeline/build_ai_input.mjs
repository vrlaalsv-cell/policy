// AI 종합분석 입력 배치 생성 → data/_ai/{asm|cab}_b*.json
//  국회: web/data.js(성향·발언) + data/news.json(뉴스)  /  청와대: web/cabinet.js
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

function loadJS(file) { const d = readFileSync(file, "utf8"); return JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1)); }
const APP = loadJS(join(paths.web, "data.js"));
const CAB = loadJS(join(paths.web, "cabinet.js"));
const NEWS = (function () { try { return JSON.parse(readFileSync(join(paths.data, "news.json"), "utf8")); } catch { return { byMember: {} }; } })();
const byMemberNews = NEWS.byMember || {};

const SLABEL = { favor: "우호", oppose: "비우호", neutral: "중립", unknown: "자료없음" };
const BIZLABEL = { POWER: "전력", LNG: "LNG", RE: "재생E", H2: "수소", CITYGAS: "도시가스", NUCLEAR: "원전" };
const BIZ = Object.keys(BIZLABEL);
function stanceLine(st) { return BIZ.map((b) => BIZLABEL[b] + ":" + SLABEL[(st && st[b]) || "unknown"]).join(" · "); }
function cap(s, n) { s = s || ""; return s.length > n ? s.slice(0, n) + "…" : s; }
function newsItems(list) { return (list || []).slice(0, 6).map((a) => ({ title: cap(a.title, 120), labels: (a.labels || []).map((x) => BIZLABEL[x] || x), date: a.date })); }

// 국회
const nameToNews = {};
APP.members.forEach((m) => { if (byMemberNews[m.id]) nameToNews[m.name] = byMemberNews[m.id]; });
const asm = [];
APP.members.forEach((m) => {
  const quotes = (m.quotes || []).slice(0, 8).map((q) => ({ biz: BIZLABEL[q.biz] || q.biz, text: cap(q.core || q.text, 170) }));
  const news = newsItems(byMemberNews[m.id]);
  if (!quotes.length && !news.length) return; // 자료 없으면 제외
  asm.push({ key: m.id, kind: "asm", name: m.name, party: m.party, district: m.district, stances: stanceLine(m.stance), quotes, news });
});

// 청와대
const cab = CAB.speakers.map((sp) => ({
  key: "cab:" + sp.name, kind: "cab", name: sp.name, role: sp.role || "",
  stances: stanceLine(sp.stance),
  quotes: (sp.quotes || []).slice(0, 8).map((q) => ({ biz: (q.businesses || []).map((b) => BIZLABEL[b] || b).join("/"), text: cap(q.quote, 170), note: cap(q.note, 120) })),
  news: newsItems(nameToNews[sp.name]),
}));

const dir = join(paths.data, "_ai");
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const BATCH = 6;
function writeBatches(arr, prefix) {
  let n = 0;
  for (let i = 0; i < arr.length; i += BATCH) { writeFileSync(join(dir, prefix + "_b" + n + ".json"), JSON.stringify({ people: arr.slice(i, i + BATCH) })); n++; }
  return n;
}
const na = writeBatches(asm, "asm"), nc = writeBatches(cab, "cab");
console.log(`✔ data/_ai/ · 국회 ${asm.length}명(${na}배치) · 청와대 ${cab.length}명(${nc}배치)`);
