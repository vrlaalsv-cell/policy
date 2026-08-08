// [run] 기사 수집 한 번 = 목록 수집(5) → 본문 발췌·원문링크(6)
//   npm 없이도 돌도록 node 로 직접 이어 실행한다 (컨테이너 스케줄러가 이걸 부른다).
//   사용: node pipeline/run_news.mjs [--days=365] [--per=5]
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);

function run(script, args = []) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(HERE, script), ...args], {
      // NEWS_CHAINED: 두 단계를 이어서 돌리는 중이라는 표시(수집기가 불필요한 안내문을 안 띄우게)
      cwd: join(HERE, ".."), env: { ...process.env, NEWS_CHAINED: "1" }, stdio: ["ignore", "inherit", "inherit"],
    });
    c.on("close", resolve);
    c.on("error", () => resolve(-1));
  });
}

const code1 = await run("5_collect_news.mjs", extra);
if (code1 !== 0) {
  // 수집기가 안전장치로 중단한 경우도 여기로 온다 → 발췌 단계는 건너뛴다(기존 데이터 보존).
  console.error(`[run_news] 목록 수집 실패(code=${code1}) — 발췌 단계를 건너뜁니다.`);
  process.exit(code1 || 1);
}
const code2 = await run("6_fetch_excerpts.mjs");
process.exit(code2 || 0);
