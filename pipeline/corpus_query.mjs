// corpus.db 검색 — "파일 열어서 읽기" 를 없애는 도구
//
//   node pipeline/corpus_query.mjs "반도체"                       # 발언 검색
//   node pipeline/corpus_query.mjs "반도체 AND 수출규제"           # FTS5 불린 검색
//   node pipeline/corpus_query.mjs "HBM OR 고대역폭" --limit=30
//   node pipeline/corpus_query.mjs "수소" --in=minutes            # 회의록에서
//   node pipeline/corpus_query.mjs "분산에너지" --committee=산업통상
//   node pipeline/corpus_query.mjs "반도체" --count               # 건수만
//   node pipeline/corpus_query.mjs "반도체" --json=out.json       # 후보를 파일로 (AI 판정 입력용)
//
// FTS5 문법: `A AND B` · `A OR B` · `A NOT B` · `"연속 구절"` · `접두사*`
//
// 🔴 이게 그룹사 확장의 핵심 도구다 — 계열사를 늘릴 때 **서버에 다시 안 묻고** 여기서 후보를 뽑아
//   그 부분집합만 AI 판정에 보낸다(토큰 절감의 제일 큰 축).
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };
const CORPUS = process.env.CORPUS_DIR || "C:/AI/_corpus";
const DB_PATH = arg("db", join(CORPUS, "corpus.db"));
const q = process.argv.slice(2).find((a) => !a.startsWith("--"));
const LIMIT = Number(arg("limit", 15));
const IN = arg("in", "speeches");           // speeches | minutes
const COMMITTEE = arg("committee", "");
const SINCE = arg("since", "");
const JSON_OUT = arg("json", "");
const COUNT_ONLY = process.argv.includes("--count");

if (!q) { console.error(`사용: node pipeline/corpus_query.mjs "<검색어>" [--in=minutes] [--committee=…] [--since=YYYY-MM-DD] [--limit=N] [--count] [--json=파일]`); process.exit(1); }
if (!existsSync(DB_PATH)) { console.error(`✗ DB 가 없다: ${DB_PATH}\n  먼저: node pipeline/build_corpus_db.mjs`); process.exit(1); }

const db = new DatabaseSync(DB_PATH);
const isMin = IN === "minutes";
const T = isMin ? "minutes" : "speeches";
const F = isMin ? "minutes_fts" : "speeches_fts";

const where = [`${F} MATCH ?`];
const params = [q];
if (!isMin && COMMITTEE) { where.push("t.committee LIKE ?"); params.push(`%${COMMITTEE}%`); }
if (!isMin && SINCE) { where.push("t.date >= ?"); params.push(SINCE); }
const W = where.join(" AND ");

const total = db.prepare(`SELECT COUNT(*) n FROM ${F} f JOIN ${T} t ON t.id=f.rowid WHERE ${W}`).get(...params).n;
console.log(`🔎 "${q}" · ${isMin ? "회의록" : "국회 발언"}${COMMITTEE ? ` · 위원회~${COMMITTEE}` : ""}${SINCE ? ` · ${SINCE}~` : ""} → ${total.toLocaleString()}건`);
if (COUNT_ONLY) { db.close(); process.exit(0); }

const cols = isMin ? "t.id, t.meeting, t.para, t.text, t.src" : "t.id, t.committee, t.date, t.speaker, t.text, t.conferNum, t.seq";
const rows = db.prepare(`SELECT ${cols} FROM ${F} f JOIN ${T} t ON t.id=f.rowid WHERE ${W} LIMIT ?`).all(...params, JSON_OUT ? 1e9 : LIMIT);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ query: q, source: T, total, items: rows }, null, 1), "utf8");
  console.log(`✔ ${JSON_OUT} 에 ${rows.length.toLocaleString()}건 저장 — AI 판정 입력으로 쓰면 된다.`);
} else {
  rows.forEach((r, i) => {
    const head = isMin ? `${r.meeting} #${r.para}` : `${r.date}  ${String(r.committee).slice(0, 14)}  ${String(r.speaker).slice(0, 14)}`;
    console.log(`\n[${i + 1}] ${head}`);
    console.log(`    ${String(r.text).replace(/\s+/g, " ").slice(0, 180)}`);
  });
  if (total > rows.length) console.log(`\n… 외 ${(total - rows.length).toLocaleString()}건 (--limit 로 더 보기 · --json= 으로 전부 저장)`);
}
db.close();
