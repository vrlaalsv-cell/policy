// [5] 의원별 최근 에너지 기사 → data/news.json  (네이버 검색 API)
//   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 필요.
//   사용: node pipeline/5_collect_news.mjs [--limit=N]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv, paths } from "./lib/env.mjs";

const id = requireEnv("NAVER_CLIENT_ID");
const secret = requireEnv("NAVER_CLIENT_SECRET");
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0);

const members = JSON.parse(readFileSync(join(paths.data, "members.json"), "utf8"));
const strip = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");

const out = {};
let i = 0;
for (const m of members) {
  if (limit && i >= limit) break;
  const q = encodeURIComponent(`${m.name} 에너지 OR 전력 OR 재생에너지 OR 원전`);
  const url = `https://openapi.naver.com/v1/search/news.json?query=${q}&display=5&sort=date`;
  try {
    const res = await fetch(url, { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } });
    if (!res.ok) { console.log(`  ! ${m.name}: HTTP ${res.status}`); }
    else {
      const j = await res.json();
      out[m.id] = (j.items || []).map((it) => ({ title: strip(it.title), link: it.originallink || it.link, pubDate: it.pubDate }));
    }
  } catch (e) { console.log(`  ! ${m.name}: ${e.message}`); }
  i++;
  await new Promise((r) => setTimeout(r, 120)); // 초당 ~10회 제한 준수
}

writeFileSync(join(paths.data, "news.json"), JSON.stringify(out, null, 2), "utf8");
console.log(`✔ data/news.json 저장 (${Object.keys(out).length}명)`);
