// 국회 상임위 발언 수집 → data/raw_speeches/*.xlsx (원본) + data/assembly_speeches.json (정규화)
//
//   node pipeline/collect_assembly_speeches.mjs                      # 기본: 기노위+산업위, 22대 전체(2024-05-30~)
//   node pipeline/collect_assembly_speeches.mjs --since=2025-10-01   # 기간 지정
//   node pipeline/collect_assembly_speeches.mjs --committees=기후에너지환경노동위원회
//   node pipeline/collect_assembly_speeches.mjs --dry                # 목록만 세고 다운로드 안 함
//
// 출처: 국회도서관 '발언 빅데이터' dataset.nanet.go.kr — **인증키·로그인 불필요**.
//   경로·함정의 근거는 data/findings.json (조회: node pipeline/findings.mjs 발언)
//
// ⚠ 원본 xlsx 를 data/raw_speeches/ 에 남긴다. 지금 국회 발언 갱신이 막혔던 근본 원인이
//   "원본을 안 남기고 가공본만 커밋" 이었다. 원본이 있으면 파서만 고쳐 재파싱된다.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { paths } from "./lib/env.mjs";
// xlsx 0.18 은 CJS 라 ESM 의 네임스페이스 임포트로는 readFile 이 안 잡힌다(XLSX.readFile is not a function).
const XLSX = createRequire(import.meta.url)("xlsx");
import { ENERGY_KEYWORDS } from "./lib/config.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BASE = "https://dataset.nanet.go.kr";
const DAE = 22;

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const SINCE = arg("since", "2024-05-30");   // 제22대 국회 임기 개시일
const UNTIL = arg("until", "2030-12-31");
const DRY = process.argv.includes("--dry");
// 에너지가 주업이 아닌 위원회(기재위·과방위·국토위 등)는 전량이 수십만 건이라 키워드 모드로 받는다
const BY_KEYWORD = process.argv.includes("--by-keyword");
// ⭐ --raw-only : 원본 xlsx 만 받아 `data/raw_speeches/` 에 쌓고 **끝낸다**.
//   에너지 키워드 필터도 안 걸고 `assembly_speeches.json`(SK E&S 산출물)도 건드리지 않는다.
//   왜 필요한가 — 이 저장소의 12,891건은 ENERGY_KEYWORDS 로 이미 걸러진 결과라(원본의 5.4%),
//   반도체·통신·제약 같은 다른 주제로는 못 쓴다. 계열사를 늘리려면 **무필터 원본**을 확보해 두고
//   회사별 키워드로 그때그때 로컬에서 걸러야 한다. 원본은 한 번만 받아두면 서버에 다시 안 물어봐도 된다.
const RAW_ONLY = process.argv.includes("--raw-only");
const COMMITTEES = arg("committees", "기후에너지환경노동위원회,산업통상자원중소벤처기업위원회").split(",").map((s) => s.trim()).filter(Boolean);

// 원본 xlsx 보관 위치.
//   🔴 **원본은 프로젝트가 아니라 워크스페이스 자산이다.** 같은 국회 회의록을 SK E&S 버전도,
//   그룹사 버전도, 앞으로 만들 무엇도 똑같이 쓴다. 프로젝트 폴더 안에 두면 방마다 수백 MB 를
//   중복 보관하거나, 새 방에서 몇 시간짜리 재수집을 또 하게 된다.
//   → 기본값을 공용 폴더(`C:\AI\_corpus\assembly_raw`)로 둔다. `--raw-dir=` 또는 env `SPEECH_RAW_DIR` 로 바꿀 수 있다.
const RAW = arg("raw-dir", process.env.SPEECH_RAW_DIR || "C:/AI/_corpus/assembly_raw");
const OUT = join(paths.data, "assembly_speeches.json");
if (!existsSync(RAW)) mkdirSync(RAW, { recursive: true });

const ymd = (s) => String(s).replace(/-/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opt = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(opt.headers || {}) }, ...opt });
  return res;
}

/** 검색 결과 HTML → 발언 메타(레코드 본문은 스니펫이라 쓰지 않는다) */
function parseList(html) {
  const dec = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  const out = [];
  for (const b of html.split("speak_contents_list").slice(1)) {
    const id = (b.match(/value="(\d{6,})"/) || [])[1];
    const nm = b.match(/speak_list_title">([\s\S]*?)<\/div>[\s\S]*?fs_20 fw_700">([\s\S]*?)<\/div>/);
    const mt = b.match(/color_665440[^>]*>\s*<div>([\s\S]*?)<\/div>/);
    const dt = b.match(/fs_13 fw_400 color_666">\s*([\d-]{10})/);
    if (!id) continue;
    out.push({ contentId: id, speakerType: nm ? dec(nm[1]) : "", speaker: nm ? dec(nm[2]) : "", meeting: mt ? dec(mt[1]) : "", date: dt ? dt[1] : "" });
  }
  return out;
}

/** 위원회 하나를 기간으로 훑어 발언 메타 수집.
 *  word 를 주면 서버에서 그 키워드로 먼저 걸러 받는다.
 *
 *  ⚠ 위원회 전량(word 없음)은 에너지가 주업인 위원회에서만 쓸 것.
 *    기재위·과방위·국토위는 22대 전량이 28만 건이라(실측) 다 받으면 몇 시간·수백 MB 다.
 *    어차피 같은 ENERGY_KEYWORDS 로 로컬 필터를 걸므로, 서버에서 미리 걸러도 결과가 같다.
 */
async function listCommittee(comm, word) {
  const found = new Map();
  const PER = 1000;
  const q = word ? `&searchWord=${encodeURIComponent(word)}&srchDisp=${encodeURIComponent(word)}&phraseField=content&phraseSearch=Y` : "";
  for (let page = 1; page <= 200; page++) {
    const url = `${BASE}/content?searchType=content&srchIdx=content&tabGb=content&srchGb=total&orgId=NAM`
      + `&sort=date:desc&pageNo=${page}&recordCountPerPage=${PER}&facetDaeNum=${DAE}`
      + `&facetCommName=${encodeURIComponent(comm)}&isDetail=Y${q}`
      + `&dtl_startMeetingDate=${ymd(SINCE)}&dtl_endMeetingDate=${ymd(UNTIL)}`;
    const res = await get(url);
    const html = await res.text();
    // ⚠ 죽은 경로가 404 가 아니라 200 + 353바이트 에러페이지로 온다 — 본문을 봐야 한다
    if (html.length < 2000) throw new Error(`${comm} p${page}: 응답이 비정상(${html.length}b) — 파라미터/사이트 변경 의심`);
    const rows = parseList(html);
    rows.forEach((r) => found.set(r.contentId, { ...r, committee: comm }));
    if (rows.length < PER) break;
    await sleep(700);
  }
  return [...found.values()];
}

/** contentId 배치 → xlsx 원본 파일 경로 */
async function downloadBatch(ids, name) {
  const file = join(RAW, `${name}.xlsx`);
  if (existsSync(file)) return file;                       // 이미 받은 건 건너뛴다(증분)
  const body = new URLSearchParams({
    viewType: "CONTENT_LIST", dataInfo: ids.join(","), downFileType: "xlsx",
    downFileName: name, dataDownKeyId: randomUUID(), dataCount: String(ids.length),
    downContentType: "", orgId: "NAM",
  });
  const r1 = await get(`${BASE}/content/down/ajax`, {
    method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
  });
  const j = await r1.json();
  if (j.resultCode !== "ERR-0000" || !j.fid) throw new Error(`파일 생성 실패: ${JSON.stringify(j).slice(0, 200)}`);
  await sleep(500);
  const r2 = await get(`${BASE}/content/down/file?fid=${j.fid}&ftype=xlsx&fnm=${encodeURIComponent(name)}`);
  const buf = Buffer.from(await r2.arrayBuffer());
  if (buf.slice(0, 2).toString() !== "PK") throw new Error(`받은 파일이 xlsx 가 아님(${buf.length}b)`);
  writeFileSync(file, buf);
  return file;
}

/** xlsx → 발언 레코드 (함정 3종 방어) */
function parseXlsx(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const out = [];
  for (const r of rows.slice(3)) {
    if (!r || r.length < 12) continue;
    let c = r.slice();
    // ⚠ 함정: 무제한토론(필리버스터) 행은 컬럼이 한 칸 우측으로 밀린다.
    //   판별 — 의원ID 자리(12)에 숫자가 아닌 값이 온다.
    const idCell = String(c[12] ?? "").trim();
    if (idCell && !/^\d+(\.\d+)?$/.test(idCell)) c = [...c.slice(0, 11), ...c.slice(12)];
    // ⚠ 함정: 발언내용1~7 은 엑셀 셀 한도(32,767자)로 넘어간 것 — 고정 분할이 아니다. 반드시 이어붙인다.
    const text = c.slice(14, 21).map((x) => String(x ?? "")).join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push({
      conferNum: String(c[0] ?? ""), dae: String(c[2] ?? ""), classCode: String(c[3] ?? ""),
      committee: String(c[4] ?? ""), date: String(c[8] ?? ""),
      speaker: String(c[11] ?? "").trim(), memberId: String(c[12] ?? "").trim(),
      seq: String(c[13] ?? ""), text,
    });
  }
  return out;
}

const KW = new RegExp(ENERGY_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
/** "2026년04월02일(목)" / "2024년7월9일(화)" → "2026-04-02"
 *  ⚠ 월·일이 한 자리로 오는 행이 섞여 있다(1319/5452 실측). \d{2} 로 고정하면 조용히 파싱 실패한다. */
const normDate = (s) => {
  const m = String(s).match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : "";
};
/** 발언자 표기 흔들림 정리: '위원장 이철규' / '이철규 위원' / '소위원장 김원이' / '위원장대리 김주영' → 이름만 */
const TITLE = "(?:소위원장|위원장대리|위원장직무대리|부위원장|위원장|간사|위원|의원)";
const cleanName = (s) => String(s).replace(new RegExp(`^${TITLE}\\s*`), "").replace(new RegExp(`\\s*${TITLE}$`), "").trim();

/** 의사진행 정형구 — 개회·상정·의결 선언은 성향 근거가 못 된다(실측 164/5473건) */
const PROCEDURAL = /의석을 정돈|성원이 되었으므로|개회하겠습니다|산회를 선포|의사일정 제\d+항|이의 없으십니까|가결되었음을 선포|보고사항은 단말기|의결하도록 하겠습니다|정회를 선포|속개하겠습니다|회의록에 실기로/;

(async () => {
  console.log(`🔄 국회 상임위 발언 수집 · ${SINCE} ~ ${UNTIL} · ${COMMITTEES.join(", ")}`);
  console.log(`   출처: 국회도서관 발언 빅데이터 (인증키 불필요)`);

  let metas = [];
  if (BY_KEYWORD) {
    console.log(`   키워드 모드: ENERGY_KEYWORDS ${ENERGY_KEYWORDS.length}개로 서버에서 먼저 걸러 받는다`);
    for (const c of COMMITTEES) {
      const seen = new Map();
      for (let i = 0; i < ENERGY_KEYWORDS.length; i++) {
        const rows = await listCommittee(c, ENERGY_KEYWORDS[i]);
        rows.forEach((r) => seen.set(r.contentId, r));
        process.stdout.write(`\r  ${c} [${i + 1}/${ENERGY_KEYWORDS.length}] ${ENERGY_KEYWORDS[i]} → 누적 ${seen.size}건        `);
        await sleep(400);
      }
      process.stdout.write("\n");
      metas = metas.concat([...seen.values()]);
    }
  } else {
    for (const c of COMMITTEES) {
      const rows = await listCommittee(c);
      console.log(`  ${c} → ${rows.length}건`);
      metas = metas.concat(rows);
    }
  }
  const uniq = [...new Map(metas.map((m) => [m.contentId, m])).values()];
  console.log(`  발언 메타 ${uniq.length}건 (중복 제거 후)`);
  if (!uniq.length) { console.error("✗ 수집된 발언이 없습니다 — 파라미터나 사이트 구조 변경 의심"); process.exit(1); }
  if (DRY) { console.log("(--dry: 다운로드 생략)"); process.exit(0); }

  // ── 원본 xlsx 내려받기 (1000건 배치) ──
  const BATCH = 1000;
  const files = [];
  for (let i = 0; i < uniq.length; i += BATCH) {
    const chunk = uniq.slice(i, i + BATCH);
    // ⚠ 파일명에 위원회를 넣어야 한다. 예전엔 `nanet_<since>_<n>` 이라 위원회를 나눠 돌리면
    //   파일명이 겹쳐 "이미 받음"으로 건너뛰고 **다른 위원회 파일을 다시 파싱**했다(신규 0건).
    const tag = COMMITTEES.map((c) => c.slice(0, 2)).join("");
    const name = `nanet_${tag}_${ymd(SINCE)}_${String(i / BATCH + 1).padStart(3, "0")}`;
    process.stdout.write(`\r  다운로드 ${i + chunk.length}/${uniq.length} (${name})   `);
    files.push(await downloadBatch(chunk.map((x) => x.contentId), name));
    await sleep(800);
  }
  process.stdout.write("\n");

  // ── 파싱 → 의원 본인 발언 → 에너지 필터 ──
  //   증인·참고인·기관장·국무위원 발언도 같이 내려오는데, 의원 성향 분석엔 쓰지 않는다.
  //   의원 판별은 의원ID(숫자) 우선, 없으면 현직 명단(web/data.js) 이름 대조.
  const dj = readFileSync(join(paths.web, "data.js"), "utf8");
  const roster = new Set(JSON.parse(dj.slice(dj.indexOf("{"), dj.lastIndexOf("}") + 1)).members.map((m) => m.name));

  let recs = [];
  for (const f of files) recs = recs.concat(parseXlsx(f));
  const named = recs.map((r) => ({ ...r, date: normDate(r.date) || r.date, name: cleanName(r.speaker) }));
  const mine = named.filter((r) => /^\d+$/.test(r.memberId) || roster.has(r.name));

  if (RAW_ONLY) {
    const energyN = mine.filter((r) => KW.test(r.text)).length;
    console.log(`  파싱 ${recs.length}건 → 의원 발언 ${mine.length}건`);
    console.log(`  (참고: 이 중 에너지 키워드 통과분은 ${energyN}건 = ${(energyN / (mine.length || 1) * 100).toFixed(1)}%)`);
    console.log(`  ⭐ --raw-only : 원본 xlsx 만 보관하고 종료한다. assembly_speeches.json 은 건드리지 않았다.`);
    console.log(`     원본 위치: ${RAW}`);
    console.log(`     다음: node pipeline/build_speech_db.mjs 로 검색 가능한 DB 를 만든다.`);
    return;
  }

  const energy = mine.filter((r) => KW.test(r.text));
  const clean = energy.filter((r) => !PROCEDURAL.test(r.text) && r.text.length >= 30);
  console.log(`  파싱 ${recs.length}건 → 의원 발언 ${mine.length}건 → 에너지 ${energy.length}건 → 의사진행·초단문 제외 후 ${clean.length}건`);

  // ── 기존 결과와 병합 ──
  //   ⚠ 덮어쓰면 안 된다. 위원회를 나눠 돌리는 게 정상 사용법이라(--committees),
  //     3개 위원회만 수집했다고 이전 위원회 결과가 사라지면 안 된다.
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const key = (r) => `${r.conferNum}|${r.seq}|${r.speaker}|${r.text.slice(0, 30)}`;
  const merged = new Map((prev?.speeches || []).map((r) => [key(r), r]));
  const beforeN = merged.size;
  clean.forEach((r) => merged.set(key(r), r));
  const all = [...merged.values()];
  console.log(`  병합: 기존 ${beforeN}건 + 이번 ${clean.length}건 → ${all.length}건 (신규 ${all.length - beforeN})`);

  // ── 대량 실패 가드 (뉴스 수집기와 같은 장치) ──
  //   이번 수집분이 이 위원회들의 기존 보유분보다 크게 줄면 파서·사이트 변경을 의심한다.
  const prevSameComm = (prev?.speeches || []).filter((r) => COMMITTEES.some((c) => r.committee.startsWith(c)));
  if (prevSameComm.length > 0 && clean.length < prevSameComm.length * 0.6) {
    console.error(`\n🛑 중단: 같은 위원회 기존 ${prevSameComm.length}건 → 이번 ${clean.length}건 으로 급감. 저장하지 않습니다.`);
    console.error(`   원본은 ${RAW} 에 남아 있으니 파서만 고쳐 다시 돌리면 됩니다.`);
    process.exit(1);
  }

  const dates = all.map((r) => r.date).filter(Boolean).sort();
  writeFileSync(OUT, JSON.stringify({
    updatedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19),
    source: "국회도서관 발언 빅데이터(dataset.nanet.go.kr) · 인증키 불필요",
    range: { since: SINCE, until: UNTIL, first: dates[0] || null, last: dates[dates.length - 1] || null },
    committees: [...new Set([...(prev?.committees || []), ...COMMITTEES])],
    lastRun: { committees: COMMITTEES, at: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 19), added: all.length - beforeN },
    totalParsed: recs.length, memberSpeeches: mine.length, energyMatched: energy.length,
    speeches: all,
  }, null, 1), "utf8");

  const byC = {}; all.forEach((r) => (byC[r.committee.replace(/-.*/, "")] = (byC[r.committee.replace(/-.*/, "")] || 0) + 1));
  const byM = {}; all.forEach((r) => { const k = r.date.slice(0, 7); byM[k] = (byM[k] || 0) + 1; });
  console.log(`✔ ${OUT}`);
  console.log(`  위원회별 ${JSON.stringify(byC)}`);
  console.log(`  월별 ${Object.entries(byM).sort().map(([k, v]) => `${k}:${v}`).join(" ")}`);
  console.log(`  원본 ${files.length}개 → ${RAW}`);
})();
