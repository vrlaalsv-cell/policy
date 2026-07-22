// 워크플로우가 수집한 22대 국회의원 실명단(JSON) → web/data.js (실명단, 성향은 "분석 전")
// 사용: node pipeline/build_from_fetch.mjs "<fetch output .output 파일 경로>"
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const src = process.argv[2];
if (!src) { console.error("사용법: node pipeline/build_from_fetch.mjs <fetch.output 경로>"); process.exit(1); }

const raw = JSON.parse(readFileSync(src, "utf8"));
const regions = Array.isArray(raw) ? raw : raw.result;
if (!Array.isArray(regions)) { console.error("result 배열을 찾을 수 없습니다."); process.exit(1); }

const META = {
  isSample: false, realNames: true, stancePending: true, updatedAt: new Date().toISOString().slice(0, 10),
  source: "한국어 위키백과 '대한민국 제22대 국회의원 목록' (2026-07 기준). 성향은 회의록 분석 전.",
  businesses: [
    { id: "all", label: "전체" }, { id: "LNG", label: "LNG" }, { id: "H2", label: "수소" },
    { id: "RE", label: "재생E" }, { id: "CITYGAS", label: "도시가스" }, { id: "POWER", label: "전력" }],
  parties: {
    "더불어민주당": { short: "민주", color: "#152484" },
    "국민의힘": { short: "국힘", color: "#E61E2B" },
    "조국혁신당": { short: "조국", color: "#0073CF" },
    "개혁신당": { short: "개혁", color: "#FF7210" },
    "진보당": { short: "진보", color: "#D6001C" },
    "기본소득당": { short: "기본", color: "#00D2C3" },
    "사회민주당": { short: "사민", color: "#F58400" },
    "무소속": { short: "무소속", color: "#8894A6" }
  },
  stance: {
    favor: { label: "우호", color: "#0f7a4d", bg: "#e6f7ee" }, neutral: { label: "중립", color: "#6b7280", bg: "#eef1f5" },
    oppose: { label: "비우호", color: "#b01e2e", bg: "#fdeef0" }, unknown: { label: "분석 전", color: "#9aa4b2", bg: "#f3f5f8" }
  }
};
const SIDO = [
  { code: "SEOUL", name: "서울", seats: 48, q: 5, r: 3 }, { code: "INCHEON", name: "인천", seats: 14, q: 1, r: 4 },
  { code: "GYEONGGI", name: "경기", seats: 60, q: 3, r: 6 }, { code: "GANGWON", name: "강원", seats: 8, q: 10, r: 3 },
  { code: "SEJONG", name: "세종", seats: 2, q: 1, r: 9 }, { code: "CHUNGBUK", name: "충북", seats: 8, q: 4, r: 8 },
  { code: "CHUNGNAM", name: "충남", seats: 11, q: -3, r: 9 }, { code: "DAEJEON", name: "대전", seats: 7, q: 0, r: 11 },
  { code: "GYEONGBUK", name: "경북", seats: 13, q: 7, r: 8 }, { code: "DAEGU", name: "대구", seats: 12, q: 5, r: 11 },
  { code: "JEONBUK", name: "전북", seats: 10, q: -3, r: 13 }, { code: "GWANGJU", name: "광주", seats: 8, q: -6, r: 16 },
  { code: "JEONNAM", name: "전남", seats: 10, q: -8, r: 18 }, { code: "GYEONGNAM", name: "경남", seats: 16, q: 1, r: 15 },
  { code: "ULSAN", name: "울산", seats: 6, q: 6, r: 13 }, { code: "BUSAN", name: "부산", seats: 18, q: 4, r: 15 },
  { code: "JEJU", name: "제주", seats: 3, q: -9, r: 22 }, { code: "PROP", name: "비례대표", seats: 46, q: 8, r: 20 }
];
const KNOWN = Object.keys(META.parties);
function canonParty(p) {
  const t = (p || "").replace(/\s+/g, "").trim();
  for (const k of KNOWN) if (t === k.replace(/\s+/g, "")) return k;
  return t || "무소속";
}
const EMPTY = { LNG: "unknown", H2: "unknown", RE: "unknown", CITYGAS: "unknown", POWER: "unknown" };

const members = [];
let n = 0, warn = [];
const expected = Object.fromEntries(SIDO.map((s) => [s.code, s.seats]));
for (const rg of regions) {
  const code = rg.code;
  const list = rg.members || [];
  if (expected[code] != null && list.length !== expected[code]) warn.push(`${code}: ${list.length}/${expected[code]}`);
  for (const m of list) {
    n++;
    members.push({
      id: "M" + String(n).padStart(3, "0"), name: (m.name || "").trim(),
      party: canonParty(m.party), sido: code,
      district: (m.district || (code === "PROP" ? "비례대표" : "")).trim(),
      committee: [], terms: undefined, stance: { ...EMPTY }, quotes: []
    });
  }
}

const APP = { meta: META, sido: SIDO, members };
const out = "/* 자동 생성 — build_from_fetch.mjs. 실제 22대 국회의원 명단(위키백과 기준). 성향은 회의록 분석 전(자료부족). */\nwindow.APP_DATA = " + JSON.stringify(APP) + ";\n";
writeFileSync(join(paths.web, "data.js"), out, "utf8");

console.log(`✔ web/data.js 생성 · 의원 ${members.length}명`);
const pc = {}; members.forEach((m) => pc[m.party] = (pc[m.party] || 0) + 1);
console.log("정당별:", JSON.stringify(pc));
if (warn.length) console.log("⚠ 의석수 불일치:", warn.join(", ")); else console.log("모든 시도 의석수 일치 ✓");
