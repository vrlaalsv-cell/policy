// [2] 에너지 관련 발언 수집 → data/utterances.json  (발언자별 텍스트)
//
//  1순위 소스: 국회도서관 "발언 빅데이터"(dataset.nanet.go.kr)에서 발언 단위 EXCEL/CSV 를
//             내려받아 data/raw/ 에 두면 이 스크립트가 정규화한다.
//  보조 소스 : 공공데이터포털 ProceedingInfoService 로 회의록 전문을 받아 '◯이름 직위' 정규식 분해.
//
//  사용: node pipeline/2_collect_utterances.mjs            (data/raw/*.csv|*.json 파싱)
//        node pipeline/2_collect_utterances.mjs --since=2025-01-01   (신규분 필터)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
import { ENERGY_KEYWORDS } from "./lib/config.mjs";

const since = (process.argv.find((a) => a.startsWith("--since=")) || "").split("=")[1] || null;
const RAW = join(paths.data, "raw");

function parseCSV(text) {
  const rows = [];
  let field = "", row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; } if (c === "\r" && text[i + 1] === "\n") i++; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function pickCol(headers, keys) {
  return headers.findIndex((h) => keys.some((k) => h.includes(k)));
}

const bySpeaker = {};
function add(name, text, date, source) {
  if (!name || !text) return;
  if (!ENERGY_KEYWORDS.some((k) => text.includes(k))) return; // 에너지 사전 필터 (토큰 절감)
  if (since && date && date < since) return;
  (bySpeaker[name] ||= []).push({ text: text.trim(), date: date || "", source: source || "" });
}

if (!existsSync(RAW)) {
  console.log(`data/raw/ 폴더가 없습니다. 아래 중 하나를 준비하세요:`);
  console.log(` 1) 국회도서관 발언 빅데이터(dataset.nanet.go.kr)에서 발언 EXCEL/CSV 다운로드 → data/raw/ 에 저장`);
  console.log(`    (열: 발언자, 발언내용, 회의일자 등)`);
  console.log(` 2) 또는 ProceedingInfoService 회의록 전문을 받아 파싱하는 로직 추가(TODO)`);
  mkdirSync(RAW, { recursive: true });
  process.exit(0);
}

const files = readdirSync(RAW).filter((f) => /\.(csv|json)$/i.test(f));
if (!files.length) { console.log("data/raw/ 에 csv/json 파일이 없습니다."); process.exit(0); }

for (const f of files) {
  const text = readFileSync(join(RAW, f), "utf8");
  if (f.toLowerCase().endsWith(".json")) {
    const arr = JSON.parse(text);
    for (const r of arr) add(r.speaker || r.발언자 || r.name, r.text || r.발언내용 || r.발언, r.date || r.회의일자, r.source || r.url);
  } else {
    const rows = parseCSV(text);
    const headers = rows.shift() || [];
    const ci = { name: pickCol(headers, ["발언자", "성명", "speaker", "이름"]), text: pickCol(headers, ["발언내용", "발언", "text", "내용"]), date: pickCol(headers, ["회의일", "일자", "date"]) };
    if (ci.name < 0 || ci.text < 0) { console.log(`  ! ${f}: 발언자/발언 열을 찾지 못함 (헤더: ${headers.join(", ")})`); continue; }
    for (const r of rows) add(r[ci.name], r[ci.text], ci.date >= 0 ? r[ci.date] : "");
  }
  console.log(`  파싱: ${f}`);
}

mkdirSync(paths.data, { recursive: true });
const total = Object.values(bySpeaker).reduce((n, a) => n + a.length, 0);
writeFileSync(join(paths.data, "utterances.json"), JSON.stringify({ updatedAt: new Date().toISOString().slice(0, 10), since, bySpeaker }, null, 2), "utf8");
console.log(`✔ data/utterances.json 저장 (발언자 ${Object.keys(bySpeaker).length}명 · 발언 ${total}건)`);
