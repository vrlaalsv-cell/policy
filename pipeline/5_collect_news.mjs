// [5] 의원별 최근 에너지 기사 수집 → data/news.json (+ web/news.js)
//
//   사용:
//     node pipeline/5_collect_news.mjs                  # 기본: 최근 90일, 의원당 5건
//     node pipeline/5_collect_news.mjs --days=180 --per=8
//     node pipeline/5_collect_news.mjs --only=김영환     # 특정 의원만 (테스트용)
//     node pipeline/5_collect_news.mjs --source=naver    # 소스 강제
//
//   소스(--source):
//     auto   (기본) .env 에 NAVER 키가 있으면 naver, 없으면 google
//     naver  네이버 검색 API (NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 필요)
//     google Google 뉴스 RSS — 키 없이 동작하지만 Google 이용약관상
//            "개인용 피드 리더" 용도로 제한됨. 사내/상업 배포본은 naver 사용 권장.
//
//   기사마다 제목·요약에서 에너지원 라벨(LNG·수소·원전·재생E·도시가스·전력)을 붙인다.
//   ⚠ 동명이인 필터는 불가능 — 이름+에너지 키워드가 모두 있는 기사만 남기고,
//     '의원/정당/지역구' 단서가 있는 기사를 앞으로 정렬한다(strong).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, paths } from "./lib/env.mjs";
import { labelsOf, QUERY_TERMS, NOISE_RE } from "./lib/news_labels.mjs";
import { buildNewsWeb } from "./build_news_web.mjs";

// ---------- args ----------
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const DAYS = Number(arg("days", 365));
const PER = Number(arg("per", 5));
const LIMIT = Number(arg("limit", 0));
const ONLY = arg("only", "");
const DELAY = Number(arg("delay", 220));

loadEnv();
let SOURCE = arg("source", "auto");
if (SOURCE === "auto") SOURCE = process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET ? "naver" : "google";
if (!["naver", "google"].includes(SOURCE)) { console.error(`--source 는 naver|google|auto`); process.exit(1); }

// ---------- 의원 명단 ----------
// data/members.json 이 있으면 그걸, 없으면 이미 만들어져 있는 web/data.js 를 읽는다.
function loadMembers() {
  let base;
  const p = join(paths.data, "members.json");
  if (existsSync(p)) base = JSON.parse(readFileSync(p, "utf8"));
  else {
    const dj = join(paths.web, "data.js");
    if (!existsSync(dj)) {
      console.error("data/members.json 도 web/data.js 도 없습니다. 먼저 `npm run collect:members`.");
      process.exit(1);
    }
    const src = readFileSync(dj, "utf8");
    const i = src.indexOf("window.APP_DATA");
    const body = src.slice(src.indexOf("=", i) + 1).trim().replace(/;\s*$/, "");
    base = JSON.parse(body).members;
  }
  // 청와대 국무위원도 뉴스 수집 대상에 포함 (id="CAB:이름", 힌트=직위)
  try {
    const cj = join(paths.web, "cabinet.js");
    if (existsSync(cj)) {
      const cs = readFileSync(cj, "utf8");
      const cb = JSON.parse(cs.slice(cs.indexOf("{"), cs.lastIndexOf("}") + 1));
      for (const sp of (cb.speakers || [])) {
        if (!sp.name || /[()]/.test(sp.name)) continue; // '미표기(상정안건)' 등 제외
        base.push({ id: "CAB:" + sp.name, name: sp.name, party: "", district: "", committee: sp.role ? [sp.role] : [], cabinet: 1 });
      }
    }
  } catch (e) { /* cabinet.js 없으면 국회 명단만 */ }
  return base;
}

const decode = (s) => String(s || "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&");
// ⚠ 엔티티를 먼저 풀고 → 태그를 지운다. 순서를 바꾸면 Google RSS 의 description 안에 있는
//   <a href="...base64..."> 링크가 본문 텍스트로 남아, base64 문자열이 "LNG" 같은 키워드에 오탐된다.
const strip = (s) => decode(decode(s).replace(/<[^>]+>/g, "")).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const noUrl = (s) => String(s || "").replace(/https?:\/\/\S+/g, " ");

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? strip(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : "";
};

// 날짜·시각은 KST 기준 (UTC 로 찍으면 저녁 기사가 하루 밀린다)
const iso = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }); };
const nowKST = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19);

// 동명이인 판별용 단서: 의원/정당(약칭 포함)/지역구/상임위
function hintsOf(m) {
  const party = m.party || "";
  const short = party.replace("더불어", "").replace(/당$/, "");
  const district = (m.district || "").split(/\s+/).filter(Boolean);
  const bare = district.map((d) => d.replace(/(특별자치)?(시|도|군|구)$/, "")).filter((d) => d.length > 1);
  return ["의원", party, short, ...district, ...bare, ...(m.committee || [])].filter((s) => s && s.length > 1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = Date.now() - DAYS * 864e5;

// ---------- 소스별 fetch ----------
async function fromGoogle(name) {
  const when = DAYS <= 400 ? ` when:${DAYS}d` : "";
  const q = `"${name}" (${QUERY_TERMS.join(" OR ")})${when}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (policy-dashboard news collector)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((it) => {
    const press = tag(it, "source");
    let title = tag(it, "title");
    // Google 제목 끝의 " - 언론사" 꼬리표 제거 (간혹 두 번 붙는다)
    while (press && title.endsWith(` - ${press}`)) title = title.slice(0, -(press.length + 3));
    return { title, link: tag(it, "link"), press, date: iso(tag(it, "pubDate")), desc: tag(it, "description") };
  });
}

async function fromNaver(name) {
  const q = `${name} ${QUERY_TERMS.join(" ")}`;
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=30&sort=date`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.items || []).map((it) => ({
    title: strip(it.title),
    link: it.originallink || it.link,
    press: (() => { try { return new URL(it.originallink || it.link).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
    date: iso(it.pubDate),
    desc: strip(it.description),
  }));
}

// ---------- 수집 ----------
const members = loadMembers().filter((m) => (ONLY ? m.name === ONLY : true));
if (!members.length) { console.error(`대상 의원이 없습니다 (--only=${ONLY}).`); process.exit(1); }
const targets = LIMIT ? members.slice(0, LIMIT) : members;

console.log(`[news] source=${SOURCE} · 최근 ${DAYS}일 · 의원당 최대 ${PER}건 · 대상 ${targets.length}명`);

const byMember = {};
let okCount = 0, artCount = 0, failed = [];
for (let i = 0; i < targets.length; i++) {
  const m = targets[i];
  try {
    const raw = SOURCE === "naver" ? await fromNaver(m.name) : await fromGoogle(m.name);
    const seen = {}, keep = [];
    for (const a of raw) {
      if (!a.title || !a.link) continue;
      if (a.date && new Date(a.date).getTime() < since) continue;      // 기간 밖
      // 라벨 판정 텍스트에서 URL 과 언론사명을 뺀다
      //   (URL: base64 가 "LNG" 등에 오탐 / 언론사명: '월간수소경제' 같은 매체명이 수소 기사로 둔갑)
      const text = noUrl(a.press ? `${a.title} ${a.desc}`.split(a.press).join(" ") : `${a.title} ${a.desc}`);
      if (!text.includes(m.name)) continue;                             // 이름 없는 기사 제외
      if (NOISE_RE.test(a.title)) continue;                             // 스포츠·연예 동명이인
      const labels = labelsOf(text);
      if (!labels.length) continue;                                     // 에너지 기사 아님
      const key = a.title.replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 40);
      if (seen[key]) continue;
      seen[key] = 1;
      const strong = hintsOf(m).some((k) => text.includes(k));
      keep.push({ title: a.title, link: a.link, press: a.press, date: a.date, labels, strong });
    }
    keep.sort((a, b) => (b.strong - a.strong) || (a.date < b.date ? 1 : -1));
    const list = keep.slice(0, PER).map(({ strong, ...rest }) => (strong ? { ...rest, strong: 1 } : rest));
    if (list.length) { byMember[m.id] = list; artCount += list.length; }
    okCount++;
  } catch (e) {
    failed.push(`${m.name}(${e.message})`);
  }
  if ((i + 1) % 25 === 0 || i === targets.length - 1) {
    process.stdout.write(`  ${i + 1}/${targets.length} · 기사 ${artCount}건\n`);
  }
  await sleep(DELAY);
}

// ---------- 저장 ----------
// 기존 결과가 있으면 이번에 조회한 의원만 갱신(부분 수집 --only/--limit 보호)
const outPath = join(paths.data, "news.json");
let prev = {};
if (existsSync(outPath)) {
  try {
    const j = JSON.parse(readFileSync(outPath, "utf8"));
    prev = j.byMember || j;
  } catch { prev = {}; }
}
// 이미 받아둔 발췌·원문링크(6_fetch_excerpts.mjs 산출물)는 제목이 같으면 그대로 물려준다.
// 이게 없으면 재수집할 때마다 발췌가 통째로 날아가 화면에 제목만 남는다.
const titleKey = (t) => String(t || "").replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 40);
const carry = {};
for (const list of Object.values(prev)) {
  for (const a of list || []) { if (a && a.excerpt) carry[titleKey(a.title)] = { excerpt: a.excerpt, hl: a.hl, url: a.url }; }
}
let carried = 0;
for (const list of Object.values(byMember)) {
  for (const a of list) {
    const c = carry[titleKey(a.title)];
    if (c) { a.excerpt = c.excerpt; if (c.hl) a.hl = c.hl; if (c.url) a.url = c.url; carried++; }
  }
}

for (const m of targets) { delete prev[m.id]; }          // 이번 대상은 결과로 교체(0건이면 제거)
const merged = { ...prev, ...byMember };

const payload = {
  meta: {
    source: SOURCE,
    days: DAYS,
    perMember: PER,
    collectedAt: nowKST(),
    members: Object.keys(merged).length,
    articles: Object.values(merged).reduce((n, v) => n + v.length, 0),
  },
  byMember: merged,
};
writeFileSync(outPath, JSON.stringify(payload, null, 1), "utf8");
console.log(`✔ data/news.json — 의원 ${payload.meta.members}명 · 기사 ${payload.meta.articles}건 (조회 성공 ${okCount}/${targets.length})`);
if (failed.length) console.log(`  ! 실패 ${failed.length}건: ${failed.slice(0, 8).join(", ")}${failed.length > 8 ? " …" : ""}`);
if (carried) console.log(`  · 기존 발췌 ${carried}건 그대로 유지`);
const noExcerpt = Object.values(merged).reduce((n, v) => n + v.filter((a) => !a.excerpt).length, 0);
if (noExcerpt) console.log(`\n👉 발췌 없는 기사 ${noExcerpt}건 — 이어서 실행하세요:  npm run fetch:excerpts`);

buildNewsWeb();
