// 워크플로우 결과(.output) → data/_cab_results.json 에 **증분 병합**한다.
//
//   node pipeline/collect_cab.mjs <워크플로 출력 파일>
//
// 🔴 예전 버전은 이 파일을 매번 통째로 덮어썼다 — 실행할 때마다 이전 판정이 전부 사라지는
//   버그였다(2026-08-14 발견). judgedMeetings 대장을 도입해 **기존 결과에 이번 결과를 얹는다.**
//   이미 판정한 회의를 이번에 다시 안 보냈으면(= cab_todo.mjs 가 걸렀으면) 그 판정은 그대로 남아야 한다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const raw = readFileSync(process.argv[2], "utf8");
const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));

const fileCount = obj.fileCount ?? (obj.result && obj.result.fileCount) ?? 0;
// 🔴 okMeetings 가 아예 없으면(= 옛 wf_cabinet.js 산출물, filesOk 만 있던 버전) 여기서 멈춘다.
//   구버전은 실패/성공-0건을 구분 못 해 이 필드가 없다 — 조용히 []로 때우면 그 결과를 "0건 성공"
//   으로 잘못 병합해 실은 실패한 회의를 judgedMeetings 에 올려버린다(재판정 기회를 영영 잃음).
const okMeetings = obj.okMeetings || (obj.result && obj.result.okMeetings) || null;
if (!okMeetings) {
  console.error("✗ okMeetings 없음 — wf_cabinet.js 가 옛 버전(실패/성공-0건 구분 로직 없음)으로 만든 출력이다.");
  console.error("  이대로 병합하면 실패한 회의를 성공으로 잘못 기록할 수 있다. wf_cabinet.js 를 최신화하고 다시 돌릴 것.");
  process.exit(1);
}
const newStatements = obj.statements || (obj.result && obj.result.statements) || [];
const failedCount = Math.max(0, fileCount - okMeetings.length);

const resPath = join(paths.data, "_cab_results.json");
// 🔴 기존 파일을 통째로 읽어 **그대로 이어받는다**(스프레드) — judgedMeetings·statements 외의
//   필드(company·configHash·updatedAt·runs 등, 다른 스크립트가 나중에 심을 수 있는 메타데이터)를
//   이 스크립트가 몰라도 지우지 않기 위함. 예전 버그(통째 덮어쓰기)가 바로 이걸 어겼다.
const prev = existsSync(resPath) ? JSON.parse(readFileSync(resPath, "utf8")) : {};
const prevStatements = prev.statements || [];
let judgedMeetings = new Set(prev.judgedMeetings || []);
// 옛 파일(judgedMeetings 없이 statements 만 있던 버전) 호환 — 발췌가 있던 회의도 판정한 것으로 인정.
for (const s of prevStatements) if (s.meeting) judgedMeetings.add(s.meeting);

// 같은 회의가 재판정으로 다시 들어오면 옛 발췌를 버리고 새 것으로 교체(중복 누적 방지).
const okSet = new Set(okMeetings);
const keptPrev = prevStatements.filter((s) => !okSet.has(s.meeting));
const statements = [...keptPrev, ...newStatements];
for (const m of okMeetings) judgedMeetings.add(m);

writeFileSync(resPath, JSON.stringify({
  ...prev,
  judgedMeetings: [...judgedMeetings].sort(),
  statements,
}, null, 0));
console.log(`✔ _cab_results.json · 누적 판정 ${judgedMeetings.size}회의(이번 +${okMeetings.length}, 실패 ${failedCount}) · 발언 ${statements.length}건(이번 +${newStatements.length})`);
