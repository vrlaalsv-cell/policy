// 총평이 정말 낡았는지 감사한다 — "기사가 갱신됨" 이 아니라 "이 사람 근거가 실제로 달라짐" 기준.
//
//   node pipeline/stale_audit.mjs [repo경로]            # 감사만 (읽기 전용)
//   node pipeline/stale_audit.mjs [repo경로] --apply    # 근거 그대로인 사람에게 해시 backfill
//
// 🔴 **평소에는 쓸 일이 없다.** 평소 증분은 `build_ai_input.mjs --todo` 가 `_ai_results.json` 의
//   `srcHash` 로 판단한다. 이 스크립트는 **해시가 없는 옛 결과를 구제하는 일회성 마이그레이션**이다.
//   2026-08-29 에 기존 281명이 해시 없이 있어서, 그대로 두면 `--todo` 가 전원을 다시 돌릴 판이었다
//   (약 4M 토큰 낭비). 생성 당시 커밋으로 되돌려 payload 를 재구성해 비교했고, 지금과 같은
//   **149명에는 재생성 없이 해시만 박아 넣어**(--apply) 건너뛰게 만들었다.
//
// 🔴 **언제 다시 필요해지나** — `build_ai_input.mjs` 의 payload 조립 방식이 바뀌면(필드 추가·자르는 길이 변경 등)
//   저장된 해시가 **전부 무효**가 되어 다시 전원이 대상이 된다. 그때 SNAPS 에 그 시점 커밋을 넣고 이 스크립트를
//   돌리면 된다. 그래서 지우지 않고 남겨 둔다.
//
// ⚠ 아래 payloads() 는 `build_ai_input.mjs` 의 조립 로직을 **복제**한 것이다. 한 글자라도 어긋나면
//   해시가 달라져 감사가 통째로 무의미해진다. 그쪽을 고치면 여기도 같이 고칠 것.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.argv[2] || "C:/AI/policy";
const at = (rev, path) => { try { return execSync(`git show ${rev}:${path}`, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }); } catch { return null; } };
const parseJS = (t) => t ? JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) : null;

const SLABEL = { favor: "우호", oppose: "비우호", neutral: "중립", unknown: "자료없음" };
const BIZLABEL = { POWER: "전력", LNG: "LNG", RE: "재생E", H2: "수소", CITYGAS: "도시가스", NUCLEAR: "원전", ESOL: "에너지솔루션", DISTE: "분산에너지" };
const BIZ = Object.keys(BIZLABEL);
const stanceLine = (st) => BIZ.map((b) => BIZLABEL[b] + ":" + SLABEL[(st && st[b]) || "unknown"]).join(" · ");
const cap = (s, n) => { s = s || ""; return s.length > n ? s.slice(0, n) + "…" : s; };
const newsItems = (list) => (list || []).slice(0, 6).map((a) => ({ title: cap(a.title, 120), labels: (a.labels || []).map((x) => BIZLABEL[x] || x), date: a.date }));
const mDate = (q) => ((q && q.meeting) || "").match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
const hash = (p) => { const { key, ...rest } = p; return createHash("sha1").update(JSON.stringify(rest)).digest("hex").slice(0, 16); };

// build_ai_input.mjs 와 **똑같은** payload 를 만든다. 하나라도 어긋나면 감사가 무의미해진다.
function payloads(APP, CAB, NEWS) {
  const byMemberNews = (NEWS && NEWS.byMember) || {};
  const nameToNews = {};
  APP.members.forEach((m) => { if (byMemberNews[m.id]) nameToNews[m.name] = byMemberNews[m.id]; });
  const out = new Map();
  APP.members.forEach((m) => {
    const quotes = (m.quotes || []).slice(0, 8).map((q) => ({ biz: BIZLABEL[q.biz] || q.biz, text: cap(q.core || q.text, 170) }));
    const news = newsItems(byMemberNews[m.id]);
    if (!quotes.length && !news.length) return;
    out.set(m.id, hash({ key: m.id, kind: "asm", name: m.name, party: m.party, district: m.district, stances: stanceLine(m.stance), quotes, news }));
  });
  (CAB.speakers || []).forEach((sp) => {
    out.set("cab:" + sp.name, hash({
      key: "cab:" + sp.name, kind: "cab", name: sp.name, role: sp.role || "", stances: stanceLine(sp.stance),
      quotes: (sp.quotes || []).slice().sort((a, b) => mDate(b).localeCompare(mDate(a))).slice(0, 8)
        .map((q) => ({ biz: (q.businesses || []).map((b) => BIZLABEL[b] || b).join("/"), text: cap(q.quote, 170), note: cap(q.note, 120), meeting: q.meeting })),
      news: newsItems(nameToNews[sp.name] || byMemberNews["CAB:" + sp.name]),
    }));
  });
  return out;
}

// 현재
const now = payloads(
  parseJS(readFileSync(join(ROOT, "web/data.js"), "utf8")),
  parseJS(readFileSync(join(ROOT, "web/cabinet.js"), "utf8")),
  JSON.parse(readFileSync(join(ROOT, "data/news.json"), "utf8")),
);

// 생성 당시 후보 스냅샷 — 총평이 만들어진 시점의 커밋들
const SNAPS = [
  ["8/27 (청와대 복구·23명 생성)", "b78e0b1"],
  ["8/16 (뉴스 재수집)", "697868b"],
  ["8/12 (AI 재판정 정비)", "cfd12dc"],
  ["8/09 (카테고리 8개 확장)", "9016380"],
];
const snapHashes = [];
for (const [label, rev] of SNAPS) {
  const d = parseJS(at(rev, "web/data.js")), c = parseJS(at(rev, "web/cabinet.js"));
  const n = at(rev, "data/news.json");
  if (!d || !c || !n) { console.log(`  (건너뜀: ${label} — 파일 없음)`); continue; }
  snapHashes.push([label, payloads(d, c, JSON.parse(n))]);
}

const results = JSON.parse(readFileSync(join(ROOT, "data/_ai_results.json"), "utf8")).results || [];
const haveSummary = new Set(results.filter((r) => r.analysis && r.analysis.trim()).map((r) => r.key));
// 🔴 해시가 이미 있는 사람은 이 스크립트의 대상이 아니다 — `build_ai_input.mjs --todo` 가 정확히 판단한다.
//   여기서 같이 세면, 방금 재생성했지만 아직 커밋 안 된 사람이 "근거 바뀜"으로 잡혀 **오해를 부른다**
//   (과거 커밋 스냅샷과 비교하기 때문). 이 스크립트는 **해시 없는 옛 결과만** 구제 대상으로 본다.
const alreadyHashed = new Set(results.filter((r) => r.srcHash).map((r) => r.key));

let same = 0, changed = 0, missing = 0, skipped = 0;
const changedList = [], matchBy = {};
for (const [key, h] of now) {
  if (alreadyHashed.has(key)) { skipped++; continue; }
  if (!haveSummary.has(key)) { missing++; continue; }
  const hit = snapHashes.find(([, m]) => m.get(key) === h);
  if (hit) { same++; matchBy[hit[0]] = (matchBy[hit[0]] || 0) + 1; }
  else { changed++; changedList.push(key); }
}
const orphan = [...haveSummary].filter((k) => !now.has(k));

console.log(`\n=== 총평 최신성 감사 (전체 ${now.size}명) ===`);
console.log(`  해시 있음 → --todo 담당    : ${skipped}명 (이 스크립트 대상 아님)`);
if (!missing && !same && !changed) console.log(`\n  → 해시 없는 옛 결과가 없다. 이 스크립트를 돌릴 필요 없다.`);
console.log(`  총평 없음(신규 생성 대상) : ${missing}명`);
console.log(`  근거 그대로(건너뛰어도 됨) : ${same}명`);
console.log(`  근거 바뀜(재생성 대상)     : ${changed}명`);
if (orphan.length) console.log(`  대상 없는 총평(고아)       : ${orphan.length}건 — ${orphan.slice(0, 3).join(", ")}`);
console.log(`\n  '근거 그대로' 가 어느 스냅샷과 일치했나:`);
Object.entries(matchBy).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${v}명 ← ${k}`));
console.log(`\n  재생성 대상 ${missing + changed}명 → 배치 8명 기준 ${Math.ceil((missing + changed) / 8)}개`);
console.log(`  (근거 바뀐 사람 예시: ${changedList.slice(0, 12).join(", ")}${changedList.length > 12 ? " …" : ""})`);

// --apply : 근거가 그대로인 사람에게 현재 해시를 박아 넣는다(재생성 없이, 토큰 0).
//   이렇게 해야 다음 `--todo` 가 이들을 건너뛴다. 안 하면 해시가 없어서 매번 전원이 대상이 된다.
if (process.argv.includes("--apply")) {
  const p = join(ROOT, "data/_ai_results.json");
  const doc = JSON.parse(readFileSync(p, "utf8"));
  let stamped = 0;
  doc.results = (doc.results || []).map((r) => {
    if (!r || !r.key || r.srcHash) return r;
    const h = now.get(r.key);
    if (!h) return r;
    const hit = snapHashes.find(([, m]) => m.get(r.key) === h);
    if (!hit) return r;                       // 근거가 바뀐 사람은 건드리지 않는다 — 재생성 대상으로 남겨야 한다
    stamped++;
    return { ...r, srcHash: h, hashBackfilledAt: "2026-08-29" };
  });
  writeFileSync(p, JSON.stringify(doc));
  console.log(`\n✔ --apply · 근거 그대로인 ${stamped}명에 현재 해시를 기록(재생성 없음, 토큰 0)`);
}
