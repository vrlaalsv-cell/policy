// [scheduler] 기사 자동 재수집 — 컨테이너 안에서 계속 떠 있으면서 정해진 시각에 수집을 돌린다.
//
//   사용: node pipeline/scheduler.mjs        (docker compose 의 scheduler 서비스가 이걸 실행)
//   환경변수:
//     NEWS_AT        수집 시각(KST, "HH:MM", 기본 "04:30")
//     NEWS_ON_START  컨테이너 시작 시 데이터가 낡았으면 즉시 1회 수집 (기본 "1")
//     NEWS_MAX_AGE_H 낡음 판정 기준 시간 (기본 20시간)
//
//   ⚠ Synology DSM 작업 스케줄러는 최소 주기가 1시간이라 여기서 직접 루프를 돈다.
//     (Market Calendar 와 같은 패턴 — '부팅 시 1회 실행 + 무한 루프' 로 원하는 주기를 만든다)
//
//   수집 결과는 data/ 에 쓰이고, data/ 는 호스트 볼륨이라 이미지 재빌드와 무관하게 유지된다.
//   serve.mjs 가 data/news.js 를 우선 서빙하므로 수집이 끝나면 새로고침만으로 화면에 반영된다.
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const AT = (process.env.NEWS_AT || "04:30").trim();
const ON_START = (process.env.NEWS_ON_START ?? "1") !== "0";
const MAX_AGE_H = Number(process.env.NEWS_MAX_AGE_H || 20);

// 컨테이너는 TZ=Asia/Seoul 로 뜨고 개발 PC도 KST 라 '현지시각 = KST' 로 다룬다.
// (Date 를 KST 문자열로 만들었다가 다시 파싱하면 9시간이 두 번 적용돼 어긋난다 — 실제로 겪음)
const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19);
const log = (...a) => console.log(`[scheduler ${stamp()}]`, ...a);

/** 수집 1회 실행 (collect → excerpts). 실패해도 프로세스는 죽지 않는다. */
function runOnce(reason) {
  return new Promise((resolve) => {
    log(`수집 시작 (${reason})`);
    const started = Date.now();
    const child = spawn(process.execPath, [join(paths.root, "pipeline", "run_news.mjs")], {
      cwd: paths.root,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("close", (code) => {
      const min = Math.round((Date.now() - started) / 60000);
      log(code === 0 ? `수집 완료 (${min}분)` : `수집 실패 code=${code} (${min}분) — 기존 데이터는 유지됨`);
      resolve(code);
    });
    child.on("error", (e) => { log("수집 실행 오류:", e.message); resolve(-1); });
  });
}

/** data/news.json 이 얼마나 오래됐는지(시간). 없으면 Infinity */
function dataAgeHours() {
  const p = join(paths.data, "news.json");
  if (!existsSync(p)) return Infinity;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    const at = j?.meta?.collectedAt;              // "YYYY-MM-DD HH:MM:SS" (KST)
    if (!at) return Infinity;
    const t = Date.parse(at.replace(" ", "T"));   // 현지시각(KST)으로 해석
    return isNaN(t) ? Infinity : (Date.now() - t) / 36e5;
  } catch { return Infinity; }
}

/** 다음 실행까지 남은 ms */
function msUntilNext() {
  const [h, m] = AT.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

log(`가동 — 매일 ${AT} (KST) 수집 · 시작 시 검사 ${ON_START ? "on" : "off"} · 낡음 기준 ${MAX_AGE_H}시간`);

if (ON_START) {
  const age = dataAgeHours();
  if (age > MAX_AGE_H) {
    log(`기존 데이터가 ${age === Infinity ? "없음" : Math.round(age) + "시간 전"} → 즉시 수집`);
    await runOnce("시작 시 검사");
  } else {
    log(`기존 데이터가 ${Math.round(age)}시간 전 → 즉시 수집 생략`);
  }
}

// 무한 루프: 다음 예정 시각까지 자고 일어나서 수집
for (;;) {
  const wait = msUntilNext();
  log(`다음 수집까지 ${Math.round(wait / 60000)}분 대기 (${AT} KST)`);
  await new Promise((r) => setTimeout(r, wait));
  await runOnce("정기 실행");
  await new Promise((r) => setTimeout(r, 60000)); // 같은 분에 두 번 도는 것 방지
}
