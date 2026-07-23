// [6] 기사 본문 발췌 채우기 → data/news.json 갱신 (+ web/news.js)
//
//   5_collect_news.mjs 가 모아둔 기사마다
//     · 실제 언론사 기사 URL (Google 뉴스 링크는 중간 리다이렉트 페이지라 원문이 아니다)
//     · 리드 문단 발췌 1~2줄 (og:description → 없으면 본문에서 키워드 문장)
//     · 화면 강조용 키워드
//   를 채운다. 겸사겸사 본문까지 보고 스포츠·동음이의(全力) 오탐을 걸러낸다.
//
//   사용:
//     node pipeline/6_fetch_excerpts.mjs              # 발췌 없는 기사만
//     node pipeline/6_fetch_excerpts.mjs --force      # 전부 다시
//     node pipeline/6_fetch_excerpts.mjs --limit=20   # 앞에서 N건만 (테스트)
//
//   ⚠ Google 뉴스 링크 복원은 news.google.com 내부 API(batchexecute)를 쓴다. 언제든 바뀔 수 있고,
//     실패해도 기사 자체는 그대로 남는다(발췌만 비어 있음). 네이버 소스로 수집한 기사는
//     link 가 이미 원문이라 복원 단계를 건너뛴다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
import { labelsOf, matchedKeyword, NEWS_LABELS, NOISE_RE, isMilitaryPower } from "./lib/news_labels.mjs";
import { buildNewsWeb } from "./build_news_web.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const FORCE = process.argv.includes("--force");
const LIMIT = Number(arg("limit", 0));
const DELAY = Number(arg("delay", 250));
const MAXLEN = Number(arg("maxlen", 220));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) => String(s || "")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&");

// ---------- Google 뉴스 링크 → 원문 URL ----------
async function resolveGoogle(link) {
  const id = link.split("/articles/")[1]?.split("?")[0];
  if (!id) return null;
  const page = await fetch(link, { headers: { "User-Agent": UA } }).then((r) => r.text());
  const sig = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig || !ts) return null;
  const payload = JSON.stringify(["garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
      "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id, Number(ts), sig]);
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", payload, null, "generic"]]])),
  });
  const txt = await res.text();
  const m = txt.match(/garturlres\\",\\"(.*?)\\",/);
  if (!m) return null;
  return m[1].replace(/\\\\u003d/g, "=").replace(/\\\\u0026/g, "&").replace(/\\\\u003f/g, "?").replace(/\\\//g, "/");
}

// ---------- 기사 HTML → 텍스트 ----------
async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let html = buf.toString("utf8");
  const cs = (res.headers.get("content-type") || "").match(/charset=([\w-]+)/i)?.[1]
    || html.slice(0, 3000).match(/charset=["']?([\w-]+)/i)?.[1];
  if (cs && !/utf-?8/i.test(cs)) { try { html = new TextDecoder(cs).decode(buf); } catch { /* 그대로 */ } }
  return html;
}

const metaOf = (html, ...names) => {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i");
    const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re) || html.match(alt);
    if (m) return decode(m[1]).replace(/\s+/g, " ").trim();
  }
  return "";
};

// 본문 텍스트에서 광고·네비게이션 문장 제거
const JUNK = /바로가기|로그인|기사검색|무단전재|재배포|저작권|구독|댓글|이메일|앱 다운로드|쿠키|광고|기사보기|기사의 본문|글씨\s*크기|폰트|스크랩|프린트|공유하기|카카오|페이스북|트위터|텔레그램|검색어|헤드라인|많이 본|관련기사|ⓒ|©|\bRSS\b|가 가|잠깐!|한눈에 보는|-->/;
function bodySentences(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decode(body).replace(/\s+/g, " ").trim()
    .split(/(?<=다\.|요\.|[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 300 && !JUNK.test(s));
}

function clamp(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("다."), cut.lastIndexOf(","));
  return (at > n * 0.6 ? cut.slice(0, at) : cut).trim() + "…";
}

// ---------- 메인 ----------
const outPath = join(paths.data, "news.json");
if (!existsSync(outPath)) { console.error("data/news.json 이 없습니다. 먼저 `npm run collect:news`."); process.exit(1); }
const store = JSON.parse(readFileSync(outPath, "utf8"));
const byMember = store.byMember || store;

const todo = [];
for (const [mid, list] of Object.entries(byMember)) {
  list.forEach((a, i) => { if (FORCE || !a.excerpt) todo.push({ mid, i, a }); });
}
const targets = LIMIT ? todo.slice(0, LIMIT) : todo;
console.log(`[excerpt] 대상 ${targets.length}건 (전체 ${todo.length}건)`);

let ok = 0, resolved = 0, dropped = 0, failed = 0;
const drops = [];
for (let n = 0; n < targets.length; n++) {
  const { mid, i, a } = targets[n];
  try {
    let url = a.url || a.link;
    if (/news\.google\.com/.test(url)) {
      const r = await resolveGoogle(url);
      if (r) { url = r; resolved++; }
    }
    const html = await fetchHtml(url);
    const lead = metaOf(html, "og:description", "description", "twitter:description");
    const sentences = bodySentences(html);

    // 발췌 고르기 — 문장처럼 생긴 것 우선, 그중 키워드가 들어간 것 우선
    //   ① 키워드 있는 리드(og:description)  ② 라벨 키워드가 든 본문 문장
    //   ③ 아무 에너지 키워드나 든 본문 문장  ④ 리드  ⑤ 첫 문장
    const hasKw = (t) => labelsOf(t).length > 0;
    const looksLikeProse = (s) => !!s && s.length >= 40 && /(다\.|요\.|[.!?”"])\s*$/.test(s.trim());
    const prose = sentences.filter(looksLikeProse);
    const pick = [
      hasKw(lead) && lead.length >= 40 ? lead : "",
      prose.find((s) => labelsOf(s).some((id) => a.labels.includes(id))),
      prose.find(hasKw),
      sentences.find((s) => labelsOf(s).some((id) => a.labels.includes(id))),
      lead,
      prose[0],
      sentences[0],
    ].find(Boolean);
    const excerpt = pick || "";

    // 본문까지 보고 오탐 제거 (스포츠 동명이인 / 全力 같은 동음이의)
    const check = `${a.title} ${excerpt}`;
    if (NOISE_RE.test(check) || isMilitaryPower(check, labelsOf(check)) || !hasKw(check)) {
      byMember[mid][i] = null;
      dropped++; drops.push(a.title.slice(0, 40));
      continue;
    }

    const item = byMember[mid][i];
    item.url = url;
    item.excerpt = clamp(excerpt, MAXLEN);
    item.hl = matchedKeyword(item.excerpt, a.labels) || matchedKeyword(item.excerpt);
    ok++;
  } catch (e) {
    failed++;
  }
  if ((n + 1) % 20 === 0 || n === targets.length - 1) {
    console.log(`  ${n + 1}/${targets.length} · 발췌 ${ok} · 링크복원 ${resolved} · 제외 ${dropped} · 실패 ${failed}`);
  }
  await sleep(DELAY);
}

// 제외된 기사 제거
for (const [mid, list] of Object.entries(byMember)) {
  const kept = list.filter(Boolean);
  if (kept.length) byMember[mid] = kept; else delete byMember[mid];
}

store.byMember = byMember;
store.meta = {
  ...(store.meta || {}),
  members: Object.keys(byMember).length,
  articles: Object.values(byMember).reduce((n, v) => n + v.length, 0),
  excerpts: Object.values(byMember).reduce((n, v) => n + v.filter((a) => a.excerpt).length, 0),
  excerptAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19),
};
writeFileSync(outPath, JSON.stringify(store, null, 1), "utf8");
console.log(`✔ data/news.json — 기사 ${store.meta.articles}건 중 발췌 ${store.meta.excerpts}건 (제외 ${dropped}, 실패 ${failed})`);
if (drops.length) console.log(`  제외: ${drops.slice(0, 10).join(" / ")}${drops.length > 10 ? " …" : ""}`);

buildNewsWeb();
