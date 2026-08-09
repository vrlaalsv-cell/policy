// AI 태깅 결과 + 수집 원문 → web/data.js 의 members[].quotes / members[].stance 갱신
//
//   node pipeline/build_assembly_speeches.mjs <tagged.json> [--dry]
//
//   tagged.json : [{ id, relevant, biz, stance, core }]  (id = data/_tag 배치의 id)
//
// ⚠ 기존 발언(다른 상임위·국정감사분 472건)은 **보존**한다. 이번 수집은 기노위·산업위
//   두 곳만이라, 덮어쓰면 나머지 위원회 근거가 통째로 사라진다.
//
// 4중 안전장치 — 하나라도 걸리면 그 건은 버린다.
//   ① relevant:false / biz=NONE
//   ② core 가 원문에 실제로 없음 (AI 가 지어낸 인용 차단)
//   ③ 같은 의원의 기존 인용문과 내용이 겹침 (중복 게시 방지)
//   ④ 명단에 없는 이름 (동명이인·표기 오류)
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const [tagPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY = process.argv.includes("--dry");
// ⚠ build_tag_batches.mjs 에 준 필터와 **똑같이** 줘야 id 가 맞는다. 다르면 엉뚱한 발언에 태깅이 붙는다.
const commArg = process.argv.find((a) => a.startsWith("--committees="));
const COMM = commArg ? commArg.split("=").slice(1).join("=").split(",").map((s) => s.trim()).filter(Boolean) : [];
if (!tagPath) { console.error("사용: node pipeline/build_assembly_speeches.mjs <tagged.json> [--dry]"); process.exit(1); }

const BIZ = ["POWER", "LNG", "RE", "H2", "CITYGAS", "NUCLEAR", "ESOL", "DISTE"];
const tagged = JSON.parse(readFileSync(tagPath, "utf8"));
const src = JSON.parse(readFileSync(join(paths.data, "assembly_speeches.json"), "utf8")).speeches;

// build_tag_batches.mjs 가 --only-new 로 걸러낸 순서와 같아야 한다 → 같은 방식으로 재현
const DJ = join(paths.web, "data.js");
const dj = readFileSync(DJ, "utf8");
// ⚠ head 를 원본 그대로 보존하면 옛 스크립트 이름·사업 개수가 영영 안 바뀐다 — 매번 새로 생성한다.
const head = `/* 자동 생성 — build_assembly_speeches.mjs. 22대 국회의원 명단+프로필+${BIZ.length}사업(원전 포함) 성향(회의록 맥락 발췌·회의명 표기). */\n`;
const tail = dj.slice(dj.lastIndexOf("}") + 1);
const app = JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1));

// ⚠ AI 가 인용문에 HTML 엔티티를 섞어 내놓는다("R&D" → "R&amp;D"). 화면에 그대로 노출되므로 풀어준다.
const unesc = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const norm = (s) => String(s || "").replace(/\s+/g, "").slice(0, 40);
const seenPrior = new Set(app.members.flatMap((m) => (m.quotes || []).flatMap((q) => [norm(q.core), norm(q.pre)])).filter(Boolean));
let items = src;
if (COMM.length) items = items.filter((s) => COMM.some((c) => String(s.committee).startsWith(c)));
items = items.filter((s) => !seenPrior.has(norm(s.text)));
console.log(`태깅 대상 재현: ${src.length} → ${items.length}건 (태깅 결과 ${tagged.length}건)${COMM.length ? ` · 위원회 ${COMM.join(",")}` : ""}`);
if (items.length !== tagged.length) console.warn(`⚠ 건수가 다르다 — id 정렬이 어긋났을 수 있으니 결과를 확인할 것`);

const byName = new Map(app.members.map((m) => [m.name, m]));
const nrm = (t) => String(t || "").replace(/\s+/g, "");

/** 같은 의원에게 이미 비슷한 인용이 있는가 (20자 연속 일치) */
function overlaps(list, q) {
  const a = nrm(q);
  for (const e of list) {
    const b = nrm(e);
    if (!b) continue;
    if (a.includes(b.slice(0, 20)) || b.includes(a.slice(0, 20))) return true;
    for (let i = 0; i + 20 <= a.length; i += 10) if (b.includes(a.slice(i, i + 20))) return true;
  }
  return false;
}

const prior = new Map();
for (const m of app.members) prior.set(m.name, (m.quotes || []).map((q) => q.core || q.text || ""));

const added = [];
const skipped = {};
const skip = (why) => (skipped[why] = (skipped[why] || 0) + 1);

for (const t of tagged) {
  const s = items[t.id];
  if (!s) { skip("원본 없음"); continue; }
  if (!t.relevant || t.biz === "NONE" || !BIZ.includes(t.biz)) { skip("근거 부적합"); continue; }
  const m = byName.get(s.name);
  if (!m) { skip("명단에 없는 이름"); continue; }
  const core = unesc(t.core).trim();
  if (core.length < 30) { skip("인용 짧음"); continue; }
  if (!nrm(s.text).includes(nrm(core).slice(0, 30))) { skip("⚠ 인용이 원문에 없음"); continue; }
  const list = prior.get(s.name) || [];
  if (overlaps(list, core)) { skip("기존 발언과 중복"); continue; }

  // 앞뒤 맥락: 원문에서 core 위치를 찾아 좌우를 덧댄다(화면이 pre/core/post 구조를 쓴다)
  const flat = s.text;
  const pos = flat.replace(/\s+/g, " ").indexOf(core.replace(/\s+/g, " ").slice(0, 30));
  const oneline = flat.replace(/\s+/g, " ");
  const pre = pos > 0 ? oneline.slice(Math.max(0, pos - 120), pos).trim() : "";
  const post = pos >= 0 ? oneline.slice(pos + core.length, pos + core.length + 120).trim() : "";

  list.push(core);
  prior.set(s.name, list);
  added.push({ name: s.name, biz: t.biz, stance: t.stance, core, pre, post, meeting: `${s.committee}(${s.date})`, date: s.date });
}

// ── 의원별 반영 ──
const byMember = {};
for (const a of added) (byMember[a.name] || (byMember[a.name] = [])).push(a);

let touched = 0;
for (const [name, list] of Object.entries(byMember)) {
  const m = byName.get(name);
  m.quotes = (m.quotes || []).concat(list.map((a) => ({ biz: a.biz, meeting: a.meeting, pre: a.pre, core: a.core, post: a.post })));
  // 성향 재집계: 사업별 favor/oppose 다수결 (build_cabinet2 의 agg 와 같은 규칙)
  const tally = {};
  for (const q of m.quotes) {
    const st = (list.find((a) => a.core === q.core) || {}).stance;
    if (!st) continue;                                  // 기존 발언은 성향 정보가 quote 에 없다 → 기존 stance 를 존중
    (tally[q.biz] || (tally[q.biz] = { favor: 0, neutral: 0, oppose: 0 }))[st]++;
  }
  m.stance = m.stance || {};
  for (const b of BIZ) {
    const c = tally[b];
    if (!c) continue;                                   // 이번에 근거가 안 늘어난 사업은 기존 판정 유지
    const cur = m.stance[b];
    const next = c.favor > c.oppose ? "favor" : c.oppose > c.favor ? "oppose" : "neutral";
    // 기존 판정이 있으면 새 근거와 합쳐서 본다(기존을 통째로 뒤집지 않는다)
    m.stance[b] = cur && cur !== "unknown" && cur !== next ? "neutral" : next;
  }
  touched++;
}

console.log(`반영 ${added.length}건 · 의원 ${touched}명`);
console.log(`제외 ${JSON.stringify(skipped)}`);
const total = app.members.reduce((n, m) => n + (m.quotes || []).length, 0);
console.log(`전체 발언 ${total}건 · 발언 보유 의원 ${app.members.filter((m) => (m.quotes || []).length).length}명`);

if (DRY) { console.log("(--dry: 저장하지 않음)"); process.exit(0); }

// 기존 발언에도 HTML 엔티티가 섞여 있다(옛 파이프라인 잔재, 실측 2건) → 저장 전에 한 번 훑어 푼다
let fixed = 0;
for (const m of app.members) {
  for (const q of m.quotes || []) for (const k of ["pre", "core", "post", "text", "meeting"]) {
    if (q[k] && /&(amp|lt|gt|quot|#39);/.test(q[k])) { q[k] = unesc(q[k]); fixed++; }
  }
  if (m.ai) for (const k of ["headline", "analysis"]) {
    if (m.ai[k] && /&(amp|lt|gt|quot|#39);/.test(m.ai[k])) { m.ai[k] = unesc(m.ai[k]); fixed++; }
  }
}
if (fixed) console.log(`HTML 엔티티 정리 ${fixed}건`);

copyFileSync(DJ, DJ + ".bak");
app.meta = app.meta || {};
app.meta.updatedAt = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
app.meta.analysisNote = `22대 국회 회의록 발언 ${total}건 발췌 기반 SK E&S ${BIZ.length}개 사업별 성향 (상임위 17개 전 위원회 + 기존 국정감사분)`;
if (app.meta.source && app.meta.source.includes("성향은 회의록 분석 전")) {
  app.meta.source = app.meta.source.replace(/\s*성향은 회의록 분석 전\.?/, "");
}
writeFileSync(DJ, head + JSON.stringify(app) + tail, "utf8");
console.log(`✔ ${DJ} (백업: data.js.bak)`);
console.log(`  다음: node pipeline/build_ai_input.mjs → AI 종합분석 재생성 → node pipeline/build_ai.mjs`);
