// 6사업 재태깅 결과(data/_ab2_results.json) + utt_ctx.json → web/data.js 갱신
//  · stance: {POWER,LNG,RE,H2,CITYGAS,NUCLEAR}
//  · quotes: evidence id → {biz, text(앞뒤 맥락 포함), meeting(회의명·날짜)}
//  · 프로필(선수·위원회)·명단·지역구는 그대로 보존
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const BIZ = ["POWER", "LNG", "RE", "H2", "CITYGAS", "NUCLEAR"];
const BIZLABEL = { POWER: "전력", LNG: "LNG", RE: "재생E", H2: "수소", CITYGAS: "도시가스", NUCLEAR: "원전" };

// 발언 id → {meeting, text}
const U = JSON.parse(readFileSync(join(paths.data, "utt_ctx.json"), "utf8")).bySpeaker || {};
const byId = {};
for (const name of Object.keys(U)) for (const u of U[name]) byId[u.id] = { meeting: u.meeting, text: u.text };

// 태깅 결과
const res = JSON.parse(readFileSync(join(paths.data, "_ab2_results.json"), "utf8"));
const tagged = (res.members || res || []);
const byName = {};
for (const m of tagged) if (m && m.name) byName[m.name] = m; // 배치 내 이름 유일

const dj = readFileSync(join(paths.web, "data.js"), "utf8");
const APP = JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1));

let withStance = 0, quoteN = 0;
for (const m of APP.members) {
  const t = byName[m.name];
  const stance = { POWER: "unknown", LNG: "unknown", RE: "unknown", H2: "unknown", CITYGAS: "unknown", NUCLEAR: "unknown" };
  const quotes = [];
  if (t) {
    for (const b of BIZ) if (t.stance && t.stance[b]) stance[b] = t.stance[b];
    const seen = new Set();
    for (const ev of (t.evidence || [])) {
      const u = byId[ev.id];
      if (!u || !BIZ.includes(ev.biz)) continue;
      const k = ev.biz + "|" + ev.id;
      if (seen.has(k)) continue; seen.add(k);
      quotes.push({ biz: ev.biz, text: u.text, meeting: u.meeting });
    }
    if (BIZ.some((b) => stance[b] !== "unknown")) withStance++;
    quoteN += quotes.length;
  }
  m.stance = stance;
  m.quotes = quotes;
}

// 사업군 6개 + 순서
APP.meta.businesses = [{ id: "all", label: "전체" }].concat(BIZ.map((id) => ({ id, label: BIZLABEL[id] })));
APP.meta.stancePending = false;
APP.meta.isSample = false;
if (APP.meta.stance && APP.meta.stance.unknown) APP.meta.stance.unknown.label = "자료부족";
APP.meta.updatedAt = new Date().toISOString().slice(0, 10);

const out = "/* 자동 생성 — build_assembly2.mjs. 22대 국회의원 명단+프로필+6사업(원전 포함) 성향(회의록 맥락 발췌·회의명 표기). */\nwindow.APP_DATA = " + JSON.stringify(APP) + ";\n";
writeFileSync(join(paths.web, "data.js"), out, "utf8");
console.log(`✔ web/data.js · 의원 ${APP.members.length}명 · 성향보유 ${withStance}명 · 근거발언 ${quoteN}건 · 사업 ${BIZ.length}개`);
