// AI 판정 결과 → data/_cab_results.json 병합 (기존 발언 보존, 중복 차단)
//
//   node pipeline/merge_cabinet_judged.mjs <judged.json> <raw.json> [--dry]
//
//   judged.json : [{ idx, relevant, quote, businesses, stance, note }]  (idx = raw.records 인덱스)
//   raw.json    : extract_minutes.py 산출물 { records:[{ meeting, date, speaker, role, text }] }
//
// 4중 안전장치 — 하나라도 걸리면 그 건은 버린다.
//   ① relevant:false / businesses 비어 있음
//   ② quote 가 원문에 실제로 없음 (AI 가 지어낸 인용 차단)
//   ③ 회의록 목차·토의표 찌꺼기가 섞인 인용
//   ④ 같은 회의·같은 발언자에서 기존 인용문과 내용이 겹침 (중복 게시 방지)
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const [judgedPath, rawPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY = process.argv.includes("--dry");
if (!judgedPath || !rawPath) {
  console.error("사용: node pipeline/merge_cabinet_judged.mjs <judged.json> <raw.json> [--dry]");
  process.exit(1);
}

const RESULTS = join(paths.data, "_cab_results.json");
const judged = JSON.parse(readFileSync(judgedPath, "utf8"));
const raw = JSON.parse(readFileSync(rawPath, "utf8")).records;
const res = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : { statements: [] };
const before = res.statements.length;

const unesc = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
const norm = (t) => String(t || "").replace(/\s+/g, "");
const JUNK = /\[[가-힣]{2,6}(처|청|부|위원회)\]|ᄋ\s*토\s*의|의견\s*없음/;
/** "제27회 국무회의 (2026.06.23)" → "제27회 국무회의 (2026-06-23)" (기존 표기에 맞춤) */
const fixMeeting = (m) => String(m).replace(/\((\d{4})\.(\d{2})\.(\d{2})\)/, "($1-$2-$3)");
const meetKey = (m) => (String(m).match(/제(\d+)회\s*(국무회의|차관회의)/) || []).slice(1, 3).join("|");

/** 같은 회의·같은 발언자에 이미 비슷한 인용이 있는가 (20자 연속 일치를 겹침으로 본다) */
function overlaps(existing, q) {
  const a = norm(q);
  for (const e of existing) {
    const b = norm(e);
    if (!b) continue;
    if (a.includes(b.slice(0, 20)) || b.includes(a.slice(0, 20))) return true;
    for (let i = 0; i + 20 <= a.length; i += 10) if (b.includes(a.slice(i, i + 20))) return true;
  }
  return false;
}

// 기존 발언을 회의|발언자 로 색인
const prior = new Map();
for (const s of res.statements) {
  const k = meetKey(s.meeting) + "|" + (s.speaker || "");
  if (!prior.has(k)) prior.set(k, []);
  prior.get(k).push(s.quote || "");
}

const added = [];
const skipped = [];
for (const j of judged) {
  const r = raw[j.idx];
  const who = r ? `${r.speaker}(${r.meeting})` : `idx ${j.idx}`;
  if (!r) { skipped.push(`idx ${j.idx}: 원본 없음`); continue; }
  if (!j.relevant) { skipped.push(`${who}: 에너지 무관`); continue; }
  if (!j.businesses || !j.businesses.length) { skipped.push(`${who}: 사업 미지정`); continue; }

  const quote = unesc(j.quote);
  if (quote.length < 40) { skipped.push(`${who}: 인용 짧음(${quote.length}자)`); continue; }
  if (JUNK.test(quote)) { skipped.push(`${who}: 목차 찌꺼기`); continue; }
  if (!norm(r.text).includes(norm(quote).slice(0, 40))) { skipped.push(`${who}: ⚠ 인용이 원문에 없음`); continue; }

  const k = meetKey(r.meeting) + "|" + r.speaker;
  const seen = prior.get(k) || [];
  if (overlaps(seen, quote)) { skipped.push(`${who}: 기존 발언과 중복`); continue; }

  const st = {
    speaker: r.speaker,
    role: r.role,
    businesses: j.businesses,
    stance: j.stance,
    quote,
    meeting: fixMeeting(r.meeting),
    note: unesc(j.note),
  };
  seen.push(quote);
  prior.set(k, seen);
  added.push(st);
}

console.log(`기존 ${before}건 + 신규 ${added.length}건 = ${before + added.length}건`);
const reasons = {};
skipped.forEach((s) => { const r = s.split(": ").pop(); reasons[r] = (reasons[r] || 0) + 1; });
console.log(`제외 ${skipped.length}건 ${JSON.stringify(reasons, null, 0)}`);
for (const s of skipped.filter((x) => /원문에 없음/.test(x))) console.log("  " + s);

if (DRY) { console.log("(--dry: 저장하지 않음)"); process.exit(0); }
copyFileSync(RESULTS, RESULTS + ".bak");
res.statements = res.statements.concat(added);
writeFileSync(RESULTS, JSON.stringify(res, null, 1), "utf8");
console.log(`✔ ${RESULTS} 저장 (백업: _cab_results.json.bak)`);
console.log("  다음: node pipeline/build_cabinet2.mjs && node pipeline/build_ai.mjs");
