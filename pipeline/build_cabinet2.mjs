// 청와대 재분석 결과(data/_cab_results.json) → data/cabinet.json + web/cabinet.js
//  · 8사업(POWER,LNG,RE,H2,CITYGAS,NUCLEAR,ESOL,DISTE) · 발언에 앞뒤 맥락 포함 · 회의명·날짜(meeting) 유지
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const BIZ = ["POWER", "LNG", "RE", "H2", "CITYGAS", "NUCLEAR", "ESOL", "DISTE"];
const res = JSON.parse(readFileSync(join(paths.data, "_cab_results.json"), "utf8"));
let stmts = res.statements || res || [];
console.log(`발췌 발언 ${stmts.length}건 로드`);

// 🔴 발언자 이름에 직위가 섞여 들어온 것을 정규화한다 (2026-08-27 실측 6건).
//   AI 발췌가 "대통령 이재명"·"국무총리 김민석" 처럼 직위를 이름 앞에 붙여 뱉은 게 있는데,
//   아래 bySpeaker 가 speaker 문자열을 그대로 키로 쓰기 때문에 **"이재명" 과 다른 사람으로 집계된다.**
//   실제 피해: ① 화면에 같은 인물이 두 번 나오고 ② 쪼개진 쪽은 발언수가 1~3건뿐이라 뒤로 밀리고
//   ③ AI 총평이 `cab:<이름>` 키로 붙는데(build_ai.mjs) 이름이 안 맞아 **총평이 안 달린다.**
//   규칙은 통념이 아니라 데이터 기반이다 — 오염된 값 6건은 **전부 자기 role 로 시작**한다.
//   (이름 길이로 자르는 방식은 쓰지 않는다. 남궁·선우 같은 복성이면 4글자라 오작동한다.)
function cleanName(raw, role) {
  let n = String(raw || "").trim();
  n = n.replace(/\s*\([^)]*\)\s*$/, "").trim();                  // "김성환(대독, 제안설명)" → "김성환"
  const r = String(role || "").trim();
  if (r && n.startsWith(r)) n = n.slice(r.length).trim() || n;    // "대통령 이재명" → "이재명"
  // role 표기가 미세하게 다를 때 대비 — 앞부분이 직위어면 마지막 토큰을 이름으로 본다.
  if (/\s/.test(n) && /(대통령|총리|장관|차관|처장|청장|위원장|실장|본부장|차장|수석|비서관|원장)/.test(n.split(/\s+/).slice(0, -1).join(" "))) {
    n = n.split(/\s+/).pop();
  }
  return n;
}
{
  let fixed = 0;
  stmts = stmts.map((s) => {
    if (!s || !s.speaker) return s;
    const c = cleanName(s.speaker, s.role);
    if (c && c !== s.speaker) { fixed++; return { ...s, speaker: c }; }
    return s;
  });
  if (fixed) console.log(`  발언자 이름 정규화 ${fixed}건 (직위가 이름에 섞여 있던 것)`);
}

// dedup (speaker + quote 앞부분)
//  ⚠ 공백을 제거하고 비교한다. 같은 법령 제안이유가 차관회의(심의)와 국무회의(의결)에 두 번 실리는데
//    조판 때문에 띄어쓰기만 달라진다("할당대상" vs "할당 대상"). 공백을 안 지우면 다른 발언으로 남아
//    화면 목록(앞 30자로 다시 dedup)과 칩 숫자가 어긋난다 — 실제로 296 vs 295 로 벌어져 있었다.
const norm = (t) => String(t || "").replace(/\s+/g, "");
const seen = new Set(); const uniq = [];
for (const s of stmts) {
  if (!s || !s.quote) continue;
  const k = (s.speaker || "") + "|" + norm(s.quote).slice(0, 40);
  if (seen.has(k)) continue; seen.add(k); uniq.push(s);
}
console.log(`중복 제거 후 ${uniq.length}건`);

function agg(c) { const f = c.favor || 0, o = c.oppose || 0, n = c.neutral || 0; if (f > o) return "favor"; if (o > f) return "oppose"; if (f + o + n === 0) return "unknown"; return "neutral"; }

const bySpeaker = {};
for (const s of uniq) {
  const name = (s.speaker || "").trim(); if (!name) continue;
  const sp = bySpeaker[name] || (bySpeaker[name] = { name, role: s.role || "", tally: {}, quotes: [] });
  if ((s.role || "").length > sp.role.length) sp.role = s.role;
  for (const b of (s.businesses || [])) { if (!BIZ.includes(b)) continue; (sp.tally[b] || (sp.tally[b] = { favor: 0, neutral: 0, oppose: 0 }))[s.stance] = ((sp.tally[b] || {})[s.stance] || 0) + 1; }
  sp.quotes.push({ businesses: (s.businesses || []).filter((b) => BIZ.includes(b)), stance: s.stance, quote: s.quote, meeting: s.meeting, note: s.note });
}
// 🔴 기존 cabinet.js 의 AI 총평(speakers[].ai)을 물려받는다 — **이걸 안 하면 조용히 날아간다.**
//   실사고(2026-08-14→08-27, 13일간 발견 못 함): 회의록 112회의를 반영하며 이 스크립트를 돌렸는데
//   build_ai.mjs 를 이어서 안 돌렸다. 이 스크립트는 speakers 를 통째로 새로 만들기 때문에
//   그 순간 **청와대 총평 33명분이 전부 사라졌고**, 화면엔 발언 발췌만 남았다.
//   에러도 경고도 없어서 아무도 몰랐다("국회는 총평이 있는데 청와대만 없다"로 뒤늦게 발견).
//   ai 는 발언이 아니라 **이름**에 붙는 값이라 재빌드와 무관하게 유효하다 → 물려받는 게 맞다.
//   (AUTOMATION_TODO.md "⚠️ 함정" #2·#3 이 경고하던 바로 그 위험이다.)
const prevAI = (() => {
  const m = new Map();
  try {
    const d = readFileSync(join(paths.web, "cabinet.js"), "utf8");
    const o = JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1));
    for (const sp of o.speakers || []) if (sp && sp.name && sp.ai) m.set(sp.name, sp.ai);
  } catch { /* 최초 실행이면 없는 게 정상 */ }
  return m;
})();

const speakers = Object.values(bySpeaker).map((sp) => {
  const stance = {}; BIZ.forEach((b) => stance[b] = sp.tally[b] ? agg(sp.tally[b]) : "unknown");
  const out = { name: sp.name, role: sp.role, stance, count: sp.quotes.length, quotes: sp.quotes };
  const ai = prevAI.get(sp.name);
  if (ai) out.ai = ai;
  return out;
}).sort((a, b) => b.count - a.count);
{
  const kept = speakers.filter((s) => s.ai).length;
  if (prevAI.size || kept) console.log(`  기존 AI 총평 ${kept}/${prevAI.size}명 물려받음${prevAI.size > kept ? ` (${prevAI.size - kept}명은 발언자 목록에서 사라져 제외)` : ""}`);
}

const byBusiness = {}; BIZ.forEach((b) => byBusiness[b] = []);
for (const s of uniq) for (const b of (s.businesses || [])) if (byBusiness[b]) byBusiness[b].push({ speaker: s.speaker, role: s.role, meeting: s.meeting, stance: s.stance, quote: s.quote, note: s.note, businesses: (s.businesses || []).filter((x) => BIZ.includes(x)) });

const stanceCount = { favor: 0, neutral: 0, oppose: 0 };
uniq.forEach((s) => { stanceCount[s.stance] = (stanceCount[s.stance] || 0) + 1; });
const bizCount = {}; BIZ.forEach((b) => bizCount[b] = byBusiness[b].length);

const meetings = new Set(uniq.map((s) => s.meeting).filter(Boolean));
const months = [...meetings].map((m) => (m.match(/\((\d{4}-\d{2})/) || [])[1]).filter(Boolean).sort();
const span = months.length ? ` ${months[0]}~${months[months.length - 1]}` : "";
// 🔴 분석한 회의 수(judged)와 발췌가 나온 회의 수(meetings.size)는 다르다 — 에너지 발언이 없어
//   0건으로 판정된 회의가 있기 때문이다(2026-08-27 실측: 112회 판정 중 발췌는 77회에서만 나옴).
//   예전엔 발췌가 나온 77회만 적어서 **분석 범위가 실제의 69% 로 축소돼 보였다.** 둘 다 적는다.
const judged = (res.judgedMeetings || []).length;
const scope = judged ? `${judged}회 전량 분석(에너지 발언이 있는 ${meetings.size}회${span}에서 발췌)` : `${meetings.size}회${span} 발췌 분석`;
const out = { updatedAt: new Date().toISOString().slice(0, 10), source: `이재명 정부 국무회의·차관회의 회의록 ${scope} · 8사업(원전·에너지솔루션·분산에너지 포함)`, totalStatements: uniq.length, stanceCount, bizCount, speakers, byBusiness };
writeFileSync(join(paths.data, "cabinet.json"), JSON.stringify(out, null, 2), "utf8");
writeFileSync(join(paths.web, "cabinet.js"), "/* 자동생성 build_cabinet2.mjs */\nwindow.CABINET_DATA = " + JSON.stringify(out) + ";\n", "utf8");
console.log(`✔ cabinet.json / cabinet.js · 발언자 ${speakers.length}명 · 사업별 ${JSON.stringify(bizCount)} · 성향 ${JSON.stringify(stanceCount)}`);
console.log(`  상위:`, speakers.slice(0, 8).map((s) => s.name + "(" + s.count + ")").join(", "));
