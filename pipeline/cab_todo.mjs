// 아직 판정 안 한 회의록만 골라 wf_cabinet.js 인자로 쓸 목록을 만든다.
//
//   node pipeline/cab_todo.mjs            # 남은 것 목록만 출력
//   node pipeline/cab_todo.mjs --json     # wf_cabinet.js args 로 바로 쓸 JSON
//
// 🔴 왜 필요한가 — wf_cabinet 은 넘긴 파일을 **전부** AI 로 보낸다. 보유 PDF 를 통째로 넘기면
//   이미 판정한 회의까지 다시 돌아 토큰이 그대로 낭비된다(2026-08-12 실측: 46건 중 24건이 재판정 대상).
//   특히 **"에너지 관련 발언 없음"으로 0건 판정된 회의**는 statements 에 아무것도 안 남아서
//   결과만 보면 "안 한 것"과 구분이 안 된다 → `_cab_results.json` 의 `judgedMeetings` 대장으로 판단한다.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const JSON_OUT = process.argv.includes("--json");
const idx = JSON.parse(readFileSync(join(paths.data, "cabinet_minutes_index.json"), "utf8"));

const resPath = join(paths.data, "_cab_results.json");
let judged = new Set();
if (existsSync(resPath)) {
  const res = JSON.parse(readFileSync(resPath, "utf8"));
  const stmts = res.statements || res || [];
  // 대장이 우선. 없으면(옛 파일) 발췌가 있는 회의만이라도 제외한다.
  for (const m of res.judgedMeetings || []) judged.add(m);
  for (const s of stmts) if (s.meeting) judged.add(s.meeting);
}

/** 게시글 제목 → `_cab_results.json` 의 meeting 표기와 같은 형식 */
const label = (p) => {
  const m = String(p.title).match(/(제\d+회\s*(?:국무회의|차관회의))/);
  return (m ? m[1].replace(/\s+/g, " ").trim() : p.title) + ` (${p.meetingAt})`;
};

const todo = Object.values(idx.posts)
  .map((p) => ({ file: join(paths.data, "cabinet_minutes", p.file), meeting: label(p) }))
  .filter((x) => !judged.has(x.meeting))
  .sort((a, b) => a.meeting.localeCompare(b.meeting));

if (JSON_OUT) { console.log(JSON.stringify(todo)); }
else {
  console.log(`보유 PDF ${Object.keys(idx.posts).length}건 · 이미 판정 ${judged.size}회의 · 남은 것 ${todo.length}건`);
  todo.forEach((x) => console.log("  -", x.meeting));
  if (!todo.length) console.log("  → 새로 판정할 회의가 없다. wf_cabinet 을 돌릴 필요 없다.");
  else console.log(`\n  wf_cabinet 인자로 쓰려면: node pipeline/cab_todo.mjs --json`);
}
