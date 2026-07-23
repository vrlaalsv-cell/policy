// 국회 회의록 재파싱 — 에너지 발언에 앞뒤 문단 맥락 + 회의명/날짜 + 고유 id 부여 → data/utt_ctx.json
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
import { ENERGY_KEYWORDS } from "./lib/config.mjs";

const DIR = join(paths.data, "raw", "국회 회의록");
const files = readdirSync(DIR).filter((f) => /\.xls$/i.test(f)).sort();

const dj = readFileSync(join(paths.web, "data.js"), "utf8");
const APP = JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1));
const roster = new Set(APP.members.map((m) => m.name));

const KW = new RegExp(ENERGY_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
const ROLE_MEMBER = /위원|의원|간사/;
function clean(s) {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function memberOf(speaker) {
  if (!speaker || !ROLE_MEMBER.test(speaker)) return null;
  for (const t of speaker.split(" ")) if (roster.has(t)) return t;
  return null;
}
function cap(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }

const bySpeaker = {};
let uid = 0, kept = 0;
const CAP = 22;

for (const f of files) {
  let html; try { html = readFileSync(join(DIR, f), "utf8"); } catch { continue; }
  const mt = html.match(/회의제목[\s\S]{0,80}?<th[^>]*>([\s\S]*?)<\/th>/);
  const meeting = (mt ? clean(mt[1]) : f.replace(/\.xls$/, "")).replace(/^제22대국회\s*/, "");
  // 행 파싱: [발언자, 발언내용]
  const rows = [];
  for (const seg of html.split(/<tr[^>]*>/i)) {
    const tds = [...seg.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => clean(m[1]));
    if (tds.length >= 2 && tds[0] && tds[1] && tds[1].length >= 4) rows.push({ sp: tds[0], tx: tds[1] });
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!KW.test(r.tx)) continue;
    const name = memberOf(r.sp);
    if (!name) continue;
    const arr = (bySpeaker[name] || (bySpeaker[name] = []));
    if (arr.length >= CAP) continue;
    const prev = rows[i - 1] ? cap(rows[i - 1].tx, 90) : "";
    const next = rows[i + 1] ? cap(rows[i + 1].tx, 90) : "";
    const core = cap(r.tx, 240);
    const text = (prev ? "(앞) " + prev + " ⟩ " : "") + core + (next ? " ⟩ (뒤) " + next : "");
    arr.push({ id: "u" + (uid++), meeting, text: cap(text, 460) });
    kept++;
  }
}
writeFileSync(join(paths.data, "utt_ctx.json"), JSON.stringify({ updatedAt: new Date().toISOString().slice(0, 10), speakerCount: Object.keys(bySpeaker).length, kept, bySpeaker }), "utf8");
console.log(`✔ data/utt_ctx.json · 의원 ${Object.keys(bySpeaker).length}명 · 맥락발췌 ${kept}건`);
