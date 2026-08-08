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
const SINCE = arg("since", "");
const PAGES = Number(arg("pages", 2));
const ALL = process.argv.includes("--all");

const BASE = "https://www.mois.go.kr";
const BBS = "BBSMSTR_000000000430";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const DATA_DIR = join(process.cwd(), "data");
const MINUTES_DIR = join(DATA_DIR, "cabinet_minutes");
const INDEX_FILE = join(DATA_DIR, "cabinet_minutes_index.json");
if (!existsSync(MINUTES_DIR)) mkdirSync(MINUTES_DIR, { recursive: true });

const get = (url, opt = {}) => axios.get(url, { headers: { "User-Agent": UA }, timeout: 60000, ...opt });
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** 제목 끝의 (YYMMDD) → 실제 회의일 "YYYY-MM-DD" */
function meetingDate(title) {
  const m = title.match(/\((\d{2})(\d{2})(\d{2})\)\s*$/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

console.log("🔄 국무·차관회의 회의록 수집 (행정안전부)");

// ---------- 기존 인덱스 ----------
let index = {};
if (!ALL && existsSync(INDEX_FILE)) {
  try {
    const j = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
    index = Array.isArray(j) ? {} : (j.posts || {});   // 구버전(배열)은 무시하고 새로 만든다
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
const targets = posts.filter((p) => {
  if (SINCE && p.meetingAt && p.meetingAt < SINCE) return false;
  if (!ALL && index[p.nttId]) return false;     // 이미 받음
  return true;
});
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
    const pdf = files.find((f) => /\.pdf$/i.test(f.name));
    const pick = pdf || files[0];
    if (!pick) { console.log(`    - 첨부 없음: ${post.title}`); continue; }

    const res = await get(BASE + pick.href, { responseType: "arraybuffer" });
    const safe = pick.name.replace(/[\/\\:*?"<>|]/g, "_");
    writeFileSync(join(MINUTES_DIR, safe), res.data);
    index[post.nttId] = { title: post.title, meetingAt: post.meetingAt, postedAt: post.postedAt, file: safe, bytes: res.data.length };
    ok++;
    console.log(`    ✓ ${post.meetingAt || post.postedAt}  ${safe} (${(res.data.length / 1024).toFixed(0)}KB)`);

    if (GOOGLE_CREDENTIALS && GOOGLE_FOLDER_ID) {
      try { await uploadFile(GOOGLE_FOLDER_ID, join(MINUTES_DIR, safe), safe, GOOGLE_CREDENTIALS); }
      catch (e) { console.log(`      (드라이브 업로드 실패: ${e.message})`); }
    }
  } catch (e) {
    fail++;
    console.log(`    ✗ ${post.title}: ${e.message}`);
  }
}

writeFileSync(INDEX_FILE, JSON.stringify({ updatedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19), posts: index }, null, 1), "utf8");

const dates = Object.values(index).map((v) => v.meetingAt).filter(Boolean).sort();
console.log(`✔ 신규 ${ok}건 · 실패 ${fail}건 · 보유 ${Object.keys(index).length}건`);
if (dates.length) console.log(`  회의일 범위: ${dates[0]} ~ ${dates[dates.length - 1]}`);
