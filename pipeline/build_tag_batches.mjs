// data/assembly_speeches.json → data/_tag/b*.json (AI 태깅 입력 배치)
//
//   node pipeline/build_tag_batches.mjs [--size=50] [--only-new]
//     --only-new : web/data.js 에 이미 있는 발언과 겹치지 않는 것만 (재태깅 방지)
//
// 발언 원문이 최대 3,769자라 프롬프트가 커진다 → CAP 자로 잘라 넣는다.
// (전문은 assembly_speeches.json 에 그대로 남아 있고, 태깅 결과를 되붙일 때 원문으로 복원한다)
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
import { tagKey, judgedIndex } from "./lib/tagkey.mjs";

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split("=").slice(1).join("=") : d; };
const SIZE = Number(arg("size", 50));
const ONLY_NEW = process.argv.includes("--only-new");
// 특정 위원회만 (이미 태깅한 위원회를 다시 돌리지 않기 위해)
const COMM = String(arg("committees", "")).split(",").map((s) => s.trim()).filter(Boolean);
const CAP = 1200;

const src = JSON.parse(readFileSync(join(paths.data, "assembly_speeches.json"), "utf8")).speeches;

// 이미 화면에 있는 발언과 중복 제거 (앞 40자 기준)
let items = src;
if (COMM.length) {
  items = items.filter((s) => COMM.some((c) => String(s.committee).startsWith(c)));
  console.log(`위원회 필터(${COMM.join(", ")}): ${src.length} → ${items.length}건`);
}
// 🔴 이미 AI 가 판정한 건 두 번 보내지 않는다 — 증분 갱신 비용의 핵심.
//   예전 --only-new 는 web/data.js 의 quotes(=채택분)만 제외해서, **기각된 판정은 매번 다시** AI 로 갔다
//   (2026-08-12 실측 기각 7,764건 = 증분 한 번에 통째로 재판정). 판정 아카이브를 기준으로 거른다.
if (ONLY_NEW) {
  const archPath = join(paths.data, "_assembly_tagged.json");
  let judged = new Map();
  if (existsSync(archPath)) {
    const arch = JSON.parse(readFileSync(archPath, "utf8"));
    judged = judgedIndex(arch.results || [], src);
  }
  const before = items.length;                       // ⚠ src 가 아니라 items 를 걸러야 위원회 필터가 살아남는다
  items = items.filter((s) => !judged.has(tagKey(s)));
  console.log(`이미 판정한 것 제외: ${before} → ${items.length}건 (아카이브 보유 판정 ${judged.size}건)`);
  if (!items.length) console.log("  → 새로 판정할 발언이 없다. AI 태깅 단계를 건너뛰어도 된다.");
}

const dir = join(paths.data, "_tag");
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let n = 0;
for (let i = 0; i < items.length; i += SIZE) {
  const chunk = items.slice(i, i + SIZE).map((s, k) => ({
    id: i + k,                                  // (하위호환) 배치 통합 순번
    key: tagKey(s),                             // ⭐ 위치와 무관한 안정 키 — 판정 결과는 이걸로 되붙인다
    name: s.name, date: s.date, committee: s.committee,
    text: s.text.length > CAP ? s.text.slice(0, CAP) + "…" : s.text,
  }));
  writeFileSync(join(dir, `b${n}.json`), JSON.stringify({ items: chunk }), "utf8");
  n++;
}
writeFileSync(join(dir, "_index.json"), JSON.stringify({ total: items.length, batches: n, size: SIZE, ids: items.map((s, i) => i) }), "utf8");
console.log(`✔ data/_tag/ · ${items.length}건 → ${n}배치 (배치당 ${SIZE})`);
