// 국무·차관회의 회의록 수집 → data/cabinet_minutes/
//
//   출처: 행정안전부 정보공개 > 사전정보공개 > 국무·차관회의 회의록 (로그인·API키 불필요)
//   https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000430
//   ※ 코드 주석에 '정부24'로 적혀 있었으나 실제 출처는 행정안전부다.
//
//   사용:
//     node pipeline/update-cabinet.mjs                 # 아직 안 받은 것만 (증분)
//     node pipeline/update-cabinet.mjs --since=2026-06-01   # 회의일 기준으로 받기
//     node pipeline/update-cabinet.mjs --pages=3       # 목록 3페이지까지 훑기
//     node pipeline/update-cabinet.mjs --all           # 인덱스 무시하고 전부 다시
//
//   ⚠ 등록일 ≠ 회의일. 회의 후 약 6주 뒤 공개된다.
//     예) 제27회 국무회의는 회의일 2026-06-23, 등록일 2026-08-06.
//     그래서 제목 끝의 (YYMMDD) 를 파싱해 회의일로 쓴다.
//
//   GOOGLE_CREDENTIALS / GOOGLE_FOLDER_ID 가 있으면 구글 드라이브에도 올린다(선택).
import axios from "axios";
import { load } from "cheerio";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { uploadFile } from "./lib/google-drive.mjs";

const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;
const GOOGLE_FOLDER_ID = process.env.GOOGLE_FOLDER_ID;

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
// 🔴 **정권 하한선 — 이재명 정부(2025-06-05~) 회의록만 받는다.**
//   이 대시보드는 *현직* 국무위원의 성향을 본다. 이전 정권 회의록이 섞이면 지금 없는 사람들의 발언이
//   들어와 분석이 오염된다(사용자 지시 2026-08-12). 실제로 --pages=45 로 긁었다가 2003~2020년
//   연도별 묶음 zip 까지 딸려와 476개+36zip 을 지웠다.
//   경계 근거: 회의록 주재자 표기가 250528 까지 '대통령권한대행' → **250605 부터 '대통령'**.
//   ⚠ 국무총리로 자르면 안 된다 — 김민석 총리는 250705 부터라 6월분이 통째로 빠진다.
//   넘기려면 `--floor=` 로 명시(연구 목적 등). 기본값은 항상 이 하한을 지킨다.
const FLOOR = arg("floor", "2025-06-05");
const SINCE = arg("since", "");
const PAGES = Number(arg("pages", 2));
const ALL = process.argv.includes("--all");

const BASE = "https://www.mois.go.kr";
const BBS = "BBSMSTR_000000000430";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const DATA_DIR = join(process.cwd(), "data");
// PDF 원본은 **워크스페이스 공용 자산**이다(국회 발언 원본과 같은 원리) — 방마다 중복 보관하거나
// 새 방에서 재수집하지 않도록 `C:\AI\_corpus\cabinet_raw` 를 기본값으로 둔다.
// ⚠ 행안부는 오래된 회의록을 다시 안 준다(2026-01-23 이전 전량 HTTP 400, findings.json dead_ends).
//   즉 **한 번 놓친 원본은 영영 못 받는다** → 이 폴더는 절대 지우지 말 것.
// `--dir=` 또는 env `CABINET_RAW_DIR` 로 바꿀 수 있다. 인덱스(JSON)는 프로젝트에 남는다(커밋 대상).
// ⚠ 컨테이너(리눅스)에서는 위 윈도우 경로가 없다 → **폴더가 실제로 있을 때만** 공용 경로를 쓰고,
//   없으면 `data/cabinet_minutes`(컨테이너에선 볼륨 마운트된 /app/data)로 떨어진다.
//   NAS 스케줄러는 compose 의 `CABINET_RAW_DIR` 로 명시 지정한다.
const SHARED_CABINET = "C:/AI/_corpus/cabinet_raw";
const MINUTES_DIR = arg("dir", process.env.CABINET_RAW_DIR
  || (existsSync(SHARED_CABINET) ? SHARED_CABINET : join(DATA_DIR, "cabinet_minutes")));
const INDEX_FILE = join(DATA_DIR, "cabinet_minutes_index.json");
if (!existsSync(MINUTES_DIR)) mkdirSync(MINUTES_DIR, { recursive: true });

// 🔴 **행안부는 빠르게 연속 요청하면 WAF 가 막는다 — HTTP 400 이 뜬다.** (2026-08-12 원인 규명)
//   증상이 헷갈린다: 앞의 40여 건은 성공하다가 그 뒤로 전부 400 이 나서, 마치 "오래된 첨부가 삭제됐다"
//   처럼 보인다. 실제로 그렇게 오판해서 findings.json 에 "영구 소실" 로 적었다가 뒤집었다.
//   판별법: 실패한 그 파일을 **단건으로** 다시 받아 보면 멀쩡히 받아진다(실측 1.1MB). 그러면 레이트리밋이다.
//   → 요청 간 간격을 두고, 400/403/429 는 백오프로 재시도한다.
const DELAY = Number(arg("delay", 1500));          // 다운로드 사이 간격(ms)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opt = {}, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await axios.get(url, { headers: { "User-Agent": UA }, timeout: 60000, ...opt });
    } catch (e) {
      lastErr = e;
      const st = e.response?.status;
      if (![400, 403, 429, 503].includes(st)) throw e;   // 레이트리밋 계열이 아니면 즉시 포기
      const wait = 3000 * Math.pow(2, i);                 // 3s → 6s → 12s → 24s
      console.log(`      (차단 추정 ${st} — ${wait / 1000}초 후 재시도 ${i + 1}/${tries - 1})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** 제목 끝의 (YYMMDD) → 실제 회의일 "YYYY-MM-DD" */
function meetingDate(title) {
  const m = title.match(/\((\d{2})(\d{2})(\d{2})\)\s*$/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

console.log("🔄 국무·차관회의 회의록 수집 (행정안전부)");

// ---------- 기존 인덱스 ----------
// 🔴 `--all` 은 "인덱스를 무시하고 전부 다시 받아본다"는 뜻이지 **"인덱스를 지운다"가 아니다.**
//   예전엔 --all 이면 index 를 빈 객체로 시작해서, 이번 실행에서 못 받은 회의(행안부가 이제 400 을 주는
//   과거분)의 항목이 **PDF 는 손에 있는데도 인덱스에서 통째로 사라졌다**(2026-08-12 실측 4건 유실 후 복구).
//   → 파일이 실제로 남아 있는 항목은 항상 살린다.
let index = {};
if (existsSync(INDEX_FILE)) {
  try {
    const j = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
    const prev = Array.isArray(j) ? {} : (j.posts || {});   // 구버전(배열)은 무시하고 새로 만든다
    for (const [id, p] of Object.entries(prev)) {
      // --all 이어도 **원본 파일이 남아 있으면 인덱스를 보존**한다. 재다운로드 여부는 아래 shouldGet 이 정한다.
      if (!ALL || (p?.file && existsSync(join(MINUTES_DIR, p.file)))) index[id] = p;
    }
  } catch { index = {}; }
}
console.log(`  기존 인덱스: ${Object.keys(index).length}건`);

// ---------- 목록 수집 ----------
const posts = [];
for (let p = 1; p <= PAGES; p++) {
  const url = `${BASE}/frt/bbs/type001/commonSelectBoardList.do?bbsId=${BBS}&pageIndex=${p}`;
  const $ = load((await get(url)).data);
  const rows = $("table tbody tr");
  if (!rows.length) break;
  rows.each((i, el) => {
    const a = $(el).find("td.l a").first();
    const href = a.attr("href") || "";
    const nttId = (href.match(/nttId=(\d+)/) || [])[1];
    const title = clean(a.text());
    if (!nttId || !title) return;
    const tds = $(el).find("td").map((j, td) => clean($(td).text())).get();
    posts.push({ nttId, title, postedAt: tds.find((t) => /^\d{4}\.\d{2}\.\d{2}\.$/.test(t)) || "", meetingAt: meetingDate(title) });
  });
}
console.log(`  목록 ${posts.length}건 (${PAGES}페이지)`);
if (!posts.length) { console.error("✗ 게시글을 찾지 못했습니다 — 페이지 구조가 바뀌었을 수 있습니다."); process.exit(1); }

// ---------- 받을 대상 고르기 ----------
let floorSkip = 0;
const targets = posts.filter((p) => {
  // 정권 하한선 — 회의일을 못 읽는 글(연도별 묶음 zip 등)도 여기서 함께 걸러진다.
  if (FLOOR) {
    if (!p.meetingAt) { floorSkip++; return false; }
    if (p.meetingAt < FLOOR) { floorSkip++; return false; }
  }
  if (SINCE && p.meetingAt && p.meetingAt < SINCE) return false;
  if (!ALL && index[p.nttId]) return false;     // 이미 받음
  return true;
});
if (floorSkip) console.log(`  정권 하한선(${FLOOR}) 이전·회의일 미상 ${floorSkip}건 제외`);
console.log(`  받을 대상: ${targets.length}건${SINCE ? ` (회의일 ${SINCE} 이후)` : ""}`);

// ---------- 첨부 다운로드 ----------
let ok = 0, fail = 0;
for (const post of targets) {
  try {
    const durl = `${BASE}/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=${BBS}&nttId=${post.nttId}`;
    const $ = load((await get(durl)).data);

    // 첨부는 /cmm/fms/FileDown.do?atchFileId=...&fileSn=N . 같은 회의록이 hwpx·pdf 로 함께 올라온다 → pdf 우선.
    const files = [];
    $('a[href*="/cmm/fms/FileDown.do"]').each((i, el) => {
      const href = $(el).attr("href");
      const label = clean($(el).text());
      const name = (label.match(/^(.*?\.(?:pdf|hwpx?|zip))/i) || [])[1];
      if (href && name) files.push({ href, name });
    });
    // 🔴 **pdf 와 hwpx 를 둘 다 받는다.**
    //   ① 2025-07-05 이전 글은 **hwpx 만 있고 pdf 가 없다** — pdf 만 받으면 그 구간을 통째로 놓친다.
    //   ② hwpx 가 텍스트 추출에 훨씬 유리하다: ZIP+XML 이라 문단 순서가 그대로고(PDF 는 2단 조판에서
    //      좌우가 뒤섞여 별도 방어가 필요했다), 크기도 10배 작고, Node 만으로 파싱된다(파이썬 불필요).
    //   hwpx 는 100~160KB 수준이라 둘 다 받아도 부담이 없다.
    if (!files.length) { console.log(`    - 첨부 없음: ${post.title}`); continue; }
    const wanted = files.filter((f) => /\.(pdf|hwpx?)$/i.test(f.name));
    const saved = [];
    for (const f of (wanted.length ? wanted : [files[0]])) {
      const res = await get(BASE + f.href, { responseType: "arraybuffer" });
      const safe = f.name.replace(/[\/\\:*?"<>|]/g, "_");
      writeFileSync(join(MINUTES_DIR, safe), res.data);
      saved.push({ name: safe, bytes: res.data.length });
      if (saved.length < (wanted.length || 1)) await sleep(DELAY);   // 같은 글의 두 번째 첨부도 간격을 둔다
    }
    // `file` 은 기존 소비자(extract_minutes.py·cab_todo)와의 호환을 위해 pdf 우선으로 남긴다.
    const primary = saved.find((s) => /\.pdf$/i.test(s.name)) || saved[0];
    const hwpx = saved.find((s) => /\.hwpx?$/i.test(s.name));
    index[post.nttId] = {
      title: post.title, meetingAt: post.meetingAt, postedAt: post.postedAt,
      file: primary.name, bytes: primary.bytes,
      ...(hwpx ? { hwpx: hwpx.name, hwpxBytes: hwpx.bytes } : {}),
    };
    ok++;
    console.log(`    ✓ ${post.meetingAt || post.postedAt}  ${saved.map((s) => `${s.name} (${(s.bytes / 1024).toFixed(0)}KB)`).join(" + ")}`);

    if (GOOGLE_CREDENTIALS && GOOGLE_FOLDER_ID) {
      try { await uploadFile(GOOGLE_FOLDER_ID, join(MINUTES_DIR, safe), safe, GOOGLE_CREDENTIALS); }
      catch (e) { console.log(`      (드라이브 업로드 실패: ${e.message})`); }
    }
  } catch (e) {
    fail++;
    console.log(`    ✗ ${post.title}: ${e.message}`);
  }
  await sleep(DELAY);   // WAF 차단 방지 (아래 주석 참고)
}

writeFileSync(INDEX_FILE, JSON.stringify({ updatedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19), posts: index }, null, 1), "utf8");

const dates = Object.values(index).map((v) => v.meetingAt).filter(Boolean).sort();
console.log(`✔ 신규 ${ok}건 · 실패 ${fail}건 · 보유 ${Object.keys(index).length}건`);
if (dates.length) console.log(`  회의일 범위: ${dates[0]} ~ ${dates[dates.length - 1]}`);

// 🔴 다운로드만 하고 corpus.db 적재를 안 부르면, DB 가 조용히 낡아 새 회의가 cab_todo.mjs 에
//   영영 안 뜬다(워크스페이스 규칙 C:\AI\CLAUDE.md §①-B — "수집 → 변환 → DB 적재가 자동으로
//   이어지는지 확인할 것"). SKpolicy 방에서 검증된 두 단계를 그대로 잇는다(2026-08-14 이식).
if (ok > 0) {
  const { spawnSync } = await import("node:child_process");
  const run = (cmd, cmdArgs, label) => {
    console.log(`\n▶ ${label}: ${cmd} ${cmdArgs.join(" ")}`);
    const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) { console.log(`  ⚠ ${label} 실패(exit ${r.status}) — 수동으로 다시 돌릴 것.`); return false; }
    return true;
  };
  const okExtract = run("python", ["pipeline/extract_pdf_text.py", "--since", FLOOR], "PDF 텍스트 추출(hwpx 없는 회의 보충용)");
  if (okExtract) run("node", ["pipeline/build_corpus_db.mjs"], "corpus.db 적재(증분)");
} else {
  console.log("  (신규 없음 — corpus.db 적재 단계 생략)");
}
