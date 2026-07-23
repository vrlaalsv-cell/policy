// [build] data/news.json → web/news.js (대시보드가 읽는 최근 기사 데이터)
//   window.NEWS_DATA = { meta, labels, byMember }
//   web/data.js 를 건드리지 않으므로 다른 작업(성향 분석)과 충돌하지 않는다.
//   사용: node pipeline/build_news_web.mjs   (수집기가 끝나면 자동 호출)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";
import { labelMeta } from "./lib/news_labels.mjs";

export function buildNewsWeb() {
  const src = join(paths.data, "news.json");
  const raw = existsSync(src) ? JSON.parse(readFileSync(src, "utf8")) : {};
  const byMember = raw.byMember || raw;
  const meta = raw.meta || { source: "", days: 0, collectedAt: "" };

  const out =
    "/* 자동 생성 — build_news_web.mjs. 직접 수정 금지 */\n" +
    "window.NEWS_DATA = " + JSON.stringify({ meta, labels: labelMeta(), byMember }) + ";\n";
  writeFileSync(join(paths.web, "news.js"), out, "utf8");

  const n = Object.values(byMember).reduce((a, v) => a + v.length, 0);
  console.log(`✔ web/news.js 생성 (의원 ${Object.keys(byMember).length}명 · 기사 ${n}건)`);
}

// 직접 실행했을 때만 동작 (수집기에서 import 할 때는 실행 안 됨)
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("build_news_web.mjs")) buildNewsWeb();
