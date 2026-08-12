// 원본(raw) → 검색 가능한 SQLite DB  ·  `C:\AI\_corpus\corpus.db`
//
//   node pipeline/build_corpus_db.mjs                 # 증분(이미 넣은 파일은 건너뜀)
//   node pipeline/build_corpus_db.mjs --rebuild       # 처음부터 다시
//   node pipeline/build_corpus_db.mjs --limit=50      # 앞 50개 파일만(테스트)
//   node pipeline/build_corpus_db.mjs --stats         # 현황만 보기
//
// 🔴 왜 SQLite 인가 — 국회 발언이 **111만 건**(실측 1,118,676)이다. 평균 900자면 텍스트만 1GB 라
//   JSON 한 덩이로 만들면 **열지도 못한다.** "할 때마다 파일 열어서 읽는" 걸 없애는 게 목적이므로
//   전문검색(FTS5)이 되는 DB 로 만든다.
// 🔴 왜 `node:sqlite` 인가 — **Node 22.5+ 내장**이라 npm 설치도 네이티브 빌드도 필요 없다.
//   NAS(Celeron) 에서 better-sqlite3 를 빌드하는 고생을 피한다. 2026-08-12 FTS5 동작 확인.
//
// 원본이 원본이고 **DB 는 언제든 다시 만들 수 있는 파생물**이다(워크스페이스 규칙과 같은 원리).
// → `corpus.db` 는 백업 대상이 아니다. 백업해야 할 건 `_corpus/*_raw/` 원본 폴더다.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { parseSpeechXlsx, normSpeechDate } from "./lib/parse_speech_xlsx.mjs";
import { extractHwpx } from "./extract_hwpx.mjs";

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };
const CORPUS = arg("corpus", process.env.CORPUS_DIR || "C:/AI/_corpus");
const DB_PATH = arg("db", join(CORPUS, "corpus.db"));
const REBUILD = process.argv.includes("--rebuild");
const STATS_ONLY = process.argv.includes("--stats");
const LIMIT = Number(arg("limit", 0));

if (!existsSync(CORPUS)) { console.error(`✗ 원본 폴더가 없다: ${CORPUS}`); process.exit(1); }
if (REBUILD && existsSync(DB_PATH)) { const { rmSync } = await import("node:fs"); rmSync(DB_PATH); console.log("  (--rebuild: 기존 DB 삭제)"); }

const db = new DatabaseSync(DB_PATH);
// 대량 삽입 성능 — WAL + 동기화 완화. 파생물이라 최악의 경우 다시 만들면 된다.
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;");

db.exec(`
CREATE TABLE IF NOT EXISTS speeches (
  id INTEGER PRIMARY KEY,
  src TEXT, conferNum TEXT, dae TEXT, classCode TEXT,
  committee TEXT, date TEXT, speaker TEXT, memberId TEXT, seq TEXT, text TEXT
);
-- 🔴 중복 방지 — 같은 발언이 여러 xlsx 배치에 들어온다(위원회를 나눠 받으면 겹친다).
--   실측 2026-08-12: 중복 제거 전 1,149,618건 → 고유 1,034,540건, **10.0% 가 중복**이었다.
--   그대로 두면 AI 판정 비용이 10% 그냥 새고, 검색 결과에도 같은 발언이 두 번 뜬다.
--   (conferNum, seq, speaker, 본문 앞 60자) 를 자연키로 잡는다 — collect 쪽 dedupe 키와 같은 원리.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sp_nat ON speeches(conferNum, seq, speaker, substr(text,1,60));
CREATE INDEX IF NOT EXISTS ix_sp_comm ON speeches(committee);
CREATE INDEX IF NOT EXISTS ix_sp_date ON speeches(date);
CREATE INDEX IF NOT EXISTS ix_sp_spk  ON speeches(speaker);

CREATE TABLE IF NOT EXISTS minutes (
  id INTEGER PRIMARY KEY,
  src TEXT, meeting TEXT, para INTEGER, text TEXT
);
CREATE INDEX IF NOT EXISTS ix_mi_src ON minutes(src);

-- 이미 넣은 파일 기록(증분의 핵심). 파일명+크기로 판단한다.
CREATE TABLE IF NOT EXISTS ingested (
  file TEXT PRIMARY KEY, kind TEXT, bytes INTEGER, rows INTEGER, at TEXT
);
`);
// FTS5 — 본문 전문검색. content 를 원본 테이블에 연결(external content)하면 중복 저장이 없다.
db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS speeches_fts USING fts5(text, content='speeches', content_rowid='id', tokenize='unicode61');
CREATE VIRTUAL TABLE IF NOT EXISTS minutes_fts  USING fts5(text, content='minutes',  content_rowid='id', tokenize='unicode61');
`);

const stats = () => {
  const q = (s) => { try { return db.prepare(s).get(); } catch { return {}; } };
  const sp = q("SELECT COUNT(*) n FROM speeches").n ?? 0;
  const mi = q("SELECT COUNT(*) n FROM minutes").n ?? 0;
  const ing = q("SELECT COUNT(*) n FROM ingested").n ?? 0;
  const comm = db.prepare("SELECT committee, COUNT(*) n FROM speeches GROUP BY committee ORDER BY n DESC LIMIT 20").all();
  const mb = existsSync(DB_PATH) ? (statSync(DB_PATH).size / 1048576).toFixed(0) : "0";
  console.log(`\n📊 corpus.db (${mb}MB) · 발언 ${sp.toLocaleString()}건 · 회의록 문단 ${mi.toLocaleString()}개 · 처리 파일 ${ing}개`);
  if (comm.length) { console.log("  위원회별 발언:"); comm.forEach((c) => console.log(`    ${String(c.n).padStart(7)}  ${c.committee}`)); }
};

if (STATS_ONLY) { stats(); process.exit(0); }

const done = new Set(db.prepare("SELECT file FROM ingested").all().map((r) => r.file));
// OR IGNORE — 위 ux_sp_nat 유니크 인덱스에 걸리면 조용히 건너뛴다(중복 10% 제거).
const insSp = db.prepare("INSERT OR IGNORE INTO speeches (src,conferNum,dae,classCode,committee,date,speaker,memberId,seq,text) VALUES (?,?,?,?,?,?,?,?,?,?)");
const insMi = db.prepare("INSERT INTO minutes (src,meeting,para,text) VALUES (?,?,?,?)");
const insIng = db.prepare("INSERT OR REPLACE INTO ingested (file,kind,bytes,rows,at) VALUES (?,?,?,?,?)");
const now = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19);

// ── 1) 국회 발언 xlsx ──────────────────────────────────────────
const spDir = join(CORPUS, "assembly_raw");
let spFiles = existsSync(spDir) ? readdirSync(spDir).filter((f) => f.endsWith(".xlsx")).sort() : [];
spFiles = spFiles.filter((f) => !done.has(f));
if (LIMIT) spFiles = spFiles.slice(0, LIMIT);
console.log(`국회 발언 xlsx: 처리 대상 ${spFiles.length}개 (이미 처리 ${done.size}개)`);

let spRows = 0, spErr = 0;
for (let i = 0; i < spFiles.length; i++) {
  const f = spFiles[i];
  const p = join(spDir, f);
  try {
    const recs = parseSpeechXlsx(p);
    db.exec("BEGIN");
    for (const r of recs) {
      insSp.run(f, r.conferNum, r.dae, r.classCode, r.committee, normSpeechDate(r.date) || r.date,
        r.speaker, r.memberId, r.seq, r.text);
    }
    insIng.run(f, "speech", statSync(p).size, recs.length, now());
    db.exec("COMMIT");
    spRows += recs.length;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 트랜잭션이 없을 수도 있다 */ }
    spErr++;
    console.log(`\n  ✗ ${f}: ${e.message}`);
  }
  if ((i + 1) % 25 === 0 || i === spFiles.length - 1) {
    process.stdout.write(`\r  ${i + 1}/${spFiles.length} · 누적 ${spRows.toLocaleString()}건 `);
  }
}
if (spFiles.length) process.stdout.write("\n");

// ── 2) 국무·차관회의 회의록 (hwpx 우선, pdf 는 파이썬 추출기 몫) ──
const miDir = join(CORPUS, "cabinet_raw");
const allMi = existsSync(miDir) ? readdirSync(miDir) : [];
// ⚠ `.hwp`(구형)과 `.hwpx`(신형)는 **완전히 다른 포맷**이다. hwpx 만 ZIP+XML 이고,
//   hwp 는 OLE/CFB 바이너리라 이 추출기로는 못 읽는다(`ZIP 구조가 아님` 에러).
//   실측 2026-08-12: hwp 122개(전부 2021~2022년, PDF·hwpx 대체본 없음) — 지금 분석 대상이
//   22대 국회(2024-06~)·이재명 정부(2025-07~)라 우선순위가 낮아 **의도적으로 제외**한다.
//   필요해지면 별도 파서가 필요하다(§HANDOFF 참고).
// 🔴 **정권 경계 필터 — 이재명 정부(2025-06-05~) 회의록만 넣는다.**
//   이 대시보드는 *현직* 국무위원의 성향을 본다. 이전 정권 회의록을 섞으면 지금 없는 사람들의 발언이
//   들어와 **분석이 오염된다**(사용자 지시 2026-08-12: "그전에 껀 오히려 오염돼").
//   경계 근거(실측): 회의록 주재자 표기가 250528 까지 '대통령권한대행' → **250605 부터 '대통령'**.
//   총리는 250705 부터 김민석(그 전은 직무대행)이라, 총리 기준으로 자르면 6월분을 놓친다 → **주재자 기준**.
//   ※ 원본 파일은 지우지 않는다(이미 받아둔 것이고 언젠가 비교용으로 쓸 수 있다). DB 에만 안 넣는다.
const MIN_SINCE = arg("minutes-since", "2025-06-05");
const fileDate = (f) => { const m = f.match(/^(\d{2})(\d{2})(\d{2})/); return m ? `20${m[1]}-${m[2]}-${m[3]}` : ""; };
let miFiles = allMi.filter((f) => /\.hwpx$/i.test(f)).sort();
const preAdmin = miFiles.filter((f) => { const d = fileDate(f); return d && d < MIN_SINCE; });
miFiles = miFiles.filter((f) => { const d = fileDate(f); return !d || d >= MIN_SINCE; });
const oldHwp = allMi.filter((f) => /\.hwp$/i.test(f));
if (preAdmin.length) console.log(`  (정권 필터: ${MIN_SINCE} 이전 회의록 ${preAdmin.length}개 제외 — 이전 정권이라 분석 오염)`);
miFiles = miFiles.filter((f) => !done.has(f));
if (LIMIT) miFiles = miFiles.slice(0, LIMIT);
console.log(`회의록 hwpx: 처리 대상 ${miFiles.length}개` + (oldHwp.length ? `  (구형 .hwp ${oldHwp.length}개는 제외 — 포맷이 다름)` : ""));

let miRows = 0, miErr = 0;
for (let i = 0; i < miFiles.length; i++) {
  const f = miFiles[i];
  try {
    const r = extractHwpx(join(miDir, f));
    // 회의명은 파일명에서 뽑는다: "250715 제31회 국무회의록(용산).hwpx" → "제31회 국무회의 (2025-07-15)"
    const m = f.match(/^(\d{2})(\d{2})(\d{2})\s+(제\d+회)\s*(국무회의|차관회의)/);
    const meeting = m ? `${m[4]} ${m[5]} (20${m[1]}-${m[2]}-${m[3]})` : f.replace(/\.hwpx?$/i, "");
    db.exec("BEGIN");
    r.paragraphs.forEach((t, k) => insMi.run(f, meeting, k, t));
    insIng.run(f, "minutes", statSync(join(miDir, f)).size, r.paragraphs.length, now());
    db.exec("COMMIT");
    miRows += r.paragraphs.length;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* noop */ }
    miErr++;
    console.log(`  ✗ ${f}: ${e.message}`);
  }
  if ((i + 1) % 25 === 0 || i === miFiles.length - 1) {
    process.stdout.write(`\r  ${i + 1}/${miFiles.length} · 누적 ${miRows.toLocaleString()}문단 `);
  }
}
if (miFiles.length) process.stdout.write("\n");

// ── 2') HWPX 가 없는 회의는 PDF 로 보충 ─────────────────────────
//   HWPX 커버리지가 실측 95/112(85%) 라 나머지는 PDF 에서 가져와야 빠짐이 없다.
//   PDF 텍스트는 `extract_pdf_text.py`(무필터, 2단 조판 처리 포함)가 만든 JSON 을 읽어 넣는다.
//     python pipeline/extract_pdf_text.py --src <원본> --since 2025-06-05 --out <CORPUS>/_pdf_text.json
//   ⚠ `extract_minutes.py` 를 쓰면 안 된다 — 그쪽은 **에너지 키워드로 걸러서** SK E&S 전용이다.
const pdfJson = arg("pdf-text", join(CORPUS, "extracted", "cabinet_pdf_text.json"));
let pdfRows = 0, pdfDocs = 0;
if (existsSync(pdfJson)) {
  const { readFileSync } = await import("node:fs");
  const docs = JSON.parse(readFileSync(pdfJson, "utf8")).docs || [];
  const haveHwpx = new Set(allMi.filter((f) => /\.hwpx$/i.test(f)).map((f) => f.replace(/\.hwpx$/i, "")));
  for (const d of docs) {
    const stem = d.file.replace(/\.pdf$/i, "");
    if (haveHwpx.has(stem)) continue;                       // HWPX 로 이미 들어갔다
    if (done.has(d.file)) continue;                          // 이미 처리
    if (MIN_SINCE && d.date && d.date < MIN_SINCE) continue; // 정권 필터
    try {
      db.exec("BEGIN");
      d.paragraphs.forEach((t, k) => insMi.run(d.file, d.meeting, k, t));
      insIng.run(d.file, "minutes-pdf", 0, d.paragraphs.length, now());
      db.exec("COMMIT");
      pdfRows += d.paragraphs.length; pdfDocs++;
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* noop */ } console.log(`  ✗ ${d.file}: ${e.message}`); }
  }
  console.log(`회의록 PDF 보충: ${pdfDocs}개 · ${pdfRows.toLocaleString()}문단 (HWPX 없는 회의만)`);
} else {
  console.log(`회의록 PDF 보충: 건너뜀 — ${pdfJson} 없음`);
  console.log(`  만들려면: python pipeline/extract_pdf_text.py --src ${join(CORPUS, "cabinet_raw")} --since ${MIN_SINCE} --out ${pdfJson}`);
}

// ── 3) 전문검색 인덱스 재구축 ──
//   external content FTS 는 원본에 INSERT 해도 자동으로 안 따라온다 → 여기서 한 번에 rebuild.
if (spRows || miRows || pdfRows) {
  console.log("전문검색 인덱스 재구축 중…");
  db.exec("INSERT INTO speeches_fts(speeches_fts) VALUES('rebuild')");
  db.exec("INSERT INTO minutes_fts(minutes_fts) VALUES('rebuild')");
}

console.log(`\n✔ 완료 — 발언 +${spRows.toLocaleString()}건(실패 ${spErr}) · 회의록 +${miRows.toLocaleString()}문단(실패 ${miErr})`);
stats();
console.log(`\n  써먹는 법(예):`);
console.log(`    node pipeline/corpus_query.mjs "반도체 AND 수출규제" --limit=20`);
db.close();
