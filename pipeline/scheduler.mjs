// [scheduler] 기사 자동 재수집 — 컨테이너 안에서 계속 떠 있으면서 정해진 시각에 수집을 돌린다.
//
//   사용: node pipeline/scheduler.mjs        (docker compose 의 scheduler 서비스가 이걸 실행)
//   환경변수:
//     NEWS_AT        수집 시각(KST). 쉼표로 여러 번 가능 — 기본 "06:00,09:00,12:00,15:00,18:00"
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

// "07:00,13:00,19:00" 처럼 여러 시각 지원. 한 번만 돌리려면 "04:30" 하나만 적으면 된다.
// 재수집은 증분(새 기사만 본문을 받아옴)이라 회당 4~5분이고 외부 유료 API 를 쓰지 않는다.
const AT_LIST = (process.env.NEWS_AT || "06:00,09:00,12:00,15:00,18:00")
  .split(",").map((s) => s.trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s))
  .sort();
if (!AT_LIST.length) AT_LIST.push("07:00");
const AT = AT_LIST.join(", ");
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

// ── 국무·차관회의 회의록 PDF 자동 확보 ───────────────────────────────────────
//  🔴 왜 자동화가 꼭 필요한가 — **행안부는 오래된 회의록 첨부를 순차적으로 내린다.**
//     실측(2026-08-12): 3일 전만 해도 받아지던 2026-01-23~02-03 4건이 그 사이 전부 HTTP 400 이 됐다.
//     즉 공개된 걸 제때 안 받으면 **영구 소실**이다(다시 받을 방법이 없다 — findings.json dead_ends).
//     사람이 기억해서 돌리는 구조로는 반드시 놓친다 → 매일 자동으로 훑어 받아 둔다.
//  · 새 회의록은 회의 후 약 6주 뒤 올라오므로 하루 1회면 충분하다(놓칠 위험 대비 여유 큼).
//  · 받기만 한다. 판정·빌드는 사람이 PC 에서 한다(AI 비용이 드는 단계라 자동화하지 않는다).
//  · PDF 저장 위치는 env `CABINET_RAW_DIR`. 컨테이너에선 반드시 **볼륨 마운트 경로**여야 살아남는다.
const CAB_ON = (process.env.CABINET_FETCH ?? "1") !== "0";
const CAB_AT = (process.env.CABINET_AT || "05:30").trim();
const CAB_PAGES = Number(process.env.CABINET_PAGES || 3);

function fetchCabinet(reason) {
  return new Promise((resolve) => {
    log(`회의록 PDF 확보 시작 (${reason})`);
    const started = Date.now();
    const child = spawn(process.execPath, [join(paths.root, "pipeline", "update-cabinet.mjs"), `--pages=${CAB_PAGES}`], {
      cwd: paths.root, env: process.env, stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("close", (code) => {
      const min = Math.round((Date.now() - started) / 60000);
      // 실패해도 절대 죽지 않는다 — 기사 수집 루프가 이것 때문에 멈추면 안 된다.
      log(code === 0 ? `회의록 확보 완료 (${min}분)` : `회의록 확보 실패 code=${code} — 다음 주기에 재시도`);
      resolve(code);
    });
    child.on("error", (e) => { log("회의록 확보 실행 오류:", e.message); resolve(-1); });
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

/** 다음 실행 예정 작업과 남은 ms. 기사 수집(news)과 회의록 확보(cabinet)를 한 타임라인에서 고른다. */
function nextRun() {
  const now = new Date();
  const jobs = AT_LIST.map((t) => ({ t, kind: "news" }));
  if (CAB_ON && /^\d{1,2}:\d{2}$/.test(CAB_AT)) jobs.push({ t: CAB_AT, kind: "cabinet" });
  let best = null;
  for (const j of jobs) {
    const [h, m] = j.t.split(":").map(Number);
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    if (!best || at < best.at) best = { at, label: j.t, kind: j.kind };
  }
  return { ms: best.at - now, label: best.label, kind: best.kind };
}

log(`가동 — 매일 ${AT} (KST) 기사 수집 · 시작 시 검사 ${ON_START ? "on" : "off"} · 낡음 기준 ${MAX_AGE_H}시간`);
log(`     회의록 PDF 확보 ${CAB_ON ? `매일 ${CAB_AT} (KST) · 목록 ${CAB_PAGES}페이지` : "꺼짐"}`);

// 시작 시 회의록도 한 번 훑는다. 재부팅·재배포로 컨테이너가 내려가 있던 사이에 공개분이 생겼을 수 있고,
// 행안부는 시간이 지나면 그걸 다시 안 준다 → 뜨자마자 확인하는 편이 안전하다(이미 받은 건 건너뛰므로 싸다).
if (CAB_ON) await fetchCabinet("시작 시 확인");

if (ON_START) {
  const age = dataAgeHours();
  if (age > MAX_AGE_H) {
    log(`기존 데이터가 ${age === Infinity ? "없음" : Math.round(age) + "시간 전"} → 즉시 수집`);
    await runOnce("시작 시 검사");
  } else {
    log(`기존 데이터가 ${Math.round(age)}시간 전 → 즉시 수집 생략`);
  }
}

// 무한 루프: 다음 예정 작업 시각까지 자고 일어나서 실행
for (;;) {
  const { ms, label, kind } = nextRun();
  log(`다음 작업까지 ${Math.round(ms / 60000)}분 대기 (${label} KST · ${kind === "cabinet" ? "회의록 확보" : "기사 수집"})`);
  await new Promise((r) => setTimeout(r, ms));
  if (kind === "cabinet") await fetchCabinet(`정기 실행 ${label}`);
  else await runOnce(`정기 실행 ${label}`);
  await new Promise((r) => setTimeout(r, 60000)); // 같은 분에 두 번 도는 것 방지
}
