// 아직 판정 안 한 회의록만 골라 wf_cabinet.js 인자로 쓸 목록을 만든다.
//
//   node pipeline/cab_todo.mjs            # 남은 것 목록만 출력
//   node pipeline/cab_todo.mjs --json     # wf_cabinet.js args 로 바로 쓸 JSON
//
// 🔴 왜 필요한가 — wf_cabinet 은 넘긴 파일을 **전부** AI 로 보낸다. 보유 PDF 를 통째로 넘기면
//   이미 판정한 회의까지 다시 돌아 토큰이 그대로 낭비된다(2026-08-12 실측: 46건 중 24건이 재판정 대상).
//   특히 **"에너지 관련 발언 없음"으로 0건 판정된 회의**는 statements 에 아무것도 안 남아서
//   결과만 보면 "안 한 것"과 구분이 안 된다 → `_cab_results.json` 의 `judgedMeetings` 대장으로 판단한다.
//
// 🔴 **원본(PDF·HWPX)을 다시 읽지 않는다** — 2026-08-14 사용자 지시로 확립된 워크스페이스 원칙
//   (`C:\AI\CLAUDE.md` §①-B). 원본은 최초 1회만 파싱해 `corpus.db` 로 적재했고, 그 뒤 모든
//   소비자는 **DB에서만** 읽는다. 여기서는 `minutes` 테이블에서 회의별 문단을 꺼내
//   **텍스트 파일로 떨궈** 워크플로에 넘긴다(SKpolicy 방 2026-08-14 실증 이식).
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { paths } from "./lib/env.mjs";

const JSON_OUT = process.argv.includes("--json");
const LIMIT = (() => { const h = process.argv.find((a) => a.startsWith("--limit=")); return h ? Number(h.split("=")[1]) : 0; })();

const CORPUS = process.env.CORPUS_DIR || "C:/AI/_corpus";
const DB_PATH = join(CORPUS, "corpus.db");
if (!existsSync(DB_PATH)) {
  console.error(`✗ 코퍼스 DB 가 없다: ${DB_PATH}\n  원본 → DB 적재를 먼저 할 것(build_corpus_db.mjs).`);
  process.exit(1);
}
const TEXT_DIR = join(paths.data, "_cabtext");

const resPath = join(paths.data, "_cab_results.json");
let judged = new Set();
if (existsSync(resPath)) {
  const res = JSON.parse(readFileSync(resPath, "utf8"));
  const stmts = res.statements || res || [];
  // 대장이 우선. 없으면(옛 파일) 발췌가 있는 회의만이라도 제외한다.
  for (const m of res.judgedMeetings || []) judged.add(m);
  for (const s of stmts) if (s.meeting) judged.add(s.meeting);
}

const db = new DatabaseSync(DB_PATH);
const meetings = db.prepare("SELECT DISTINCT meeting FROM minutes WHERE meeting IS NOT NULL AND meeting <> '' ORDER BY meeting").all();
const getParas = db.prepare("SELECT text FROM minutes WHERE meeting = ? ORDER BY para");

const all = meetings.map((r) => r.meeting).filter((m) => !judged.has(m));

// 🔴 --limit= 은 앞에서 자르지 않고 **시간축에 걸쳐 균등 간격**으로 뽑는다.
//   앞에서 자르면(정렬이 회차순이라) 특정 시기에 쏠려 편향된다.
const picked = LIMIT && LIMIT < all.length
  ? Array.from({ length: LIMIT }, (_, i) => all[Math.floor((i * all.length) / LIMIT)])
  : all;

mkdirSync(TEXT_DIR, { recursive: true });
const slug = (m) => m.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
const todo = [];
let wrote = 0, chars = 0;
for (const meeting of picked) {
  const file = join(TEXT_DIR, `${slug(meeting)}.txt`);
  if (!existsSync(file)) {
    writeFileSync(file, `# ${meeting}\n\n${getParas.all(meeting).map((r) => r.text).join("\n")}\n`, "utf8");
    wrote++;
  }
  chars += readFileSync(file, "utf8").length;
  todo.push({ file, meeting });
}
db.close();

if (JSON_OUT) { console.log(JSON.stringify(todo)); }
else {
  console.log(`원천: ${DB_PATH} (minutes) → 텍스트 ${TEXT_DIR.replace(paths.root || "", ".")}`);
  console.log(`DB 보유 ${meetings.length}회의 · 이미 판정 ${judged.size}회의 · 미판정 ${all.length}건${LIMIT ? ` → 표본 ${todo.length}건(시간축 균등)` : ""}`);
  if (wrote) console.log(`   텍스트 새로 떨군 것 ${wrote}건 (나머지는 기존 파일 재사용)`);
  if (todo.length) console.log(`   이번 대상 총 ${Math.round(chars / 1000).toLocaleString()}K자 · 회의당 평균 ${Math.round(chars / todo.length / 1000)}K자`);
  todo.slice(0, 5).forEach((x) => console.log("  -", x.meeting));
  if (todo.length > 5) console.log(`  … 외 ${todo.length - 5}건`);
  if (!todo.length) console.log("  → 새로 판정할 회의가 없다. wf_cabinet 을 돌릴 필요 없다.");
  else console.log(`\n  wf_cabinet 인자로 쓰려면: node pipeline/cab_todo.mjs --json`);
}
