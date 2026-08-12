// 국회도서관 발언 빅데이터 xlsx → 발언 레코드
//
// 🔴 왜 별도 파일인가 — 수집기(`collect_assembly_speeches.mjs`)와 DB 빌더(`build_corpus_db.mjs`)가
//   같은 파서를 써야 한다. 그렇다고 수집기를 `import` 하면 **수집이 실제로 실행된다**
//   (모듈 최상위 코드는 import 즉시 돈다 — 2026-08-12 스케줄러에서 실제로 당했다).
//   그래서 파서만 부작용 없는 모듈로 떼어 둔다.
//
// 함정 3종은 그대로 방어한다(전부 실측으로 겪은 것):
//   ① 무제한토론(필리버스터) 행은 컬럼이 한 칸 우측으로 밀린다
//   ② 발언내용1~7 은 엑셀 셀 한도(32,767자)로 넘어간 것이지 고정 분할이 아니다 → 반드시 이어붙인다
//   ③ 헤더가 0~2행에 있어 데이터는 3행부터다
import { createRequire } from "node:module";
// xlsx 0.18 은 CJS 라 ESM 네임스페이스 임포트로는 readFile 이 안 잡힌다(XLSX.readFile is not a function).
const XLSX = createRequire(import.meta.url)("xlsx");

/** @returns {{conferNum,dae,classCode,committee,date,speaker,memberId,seq,text}[]} */
export function parseSpeechXlsx(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const out = [];
  for (const r of rows.slice(3)) {
    if (!r || r.length < 12) continue;
    let c = r.slice();
    // ① 판별 — 의원ID 자리(12)에 숫자가 아닌 값이 오면 한 칸 밀린 행이다.
    const idCell = String(c[12] ?? "").trim();
    if (idCell && !/^\d+(\.\d+)?$/.test(idCell)) c = [...c.slice(0, 11), ...c.slice(12)];
    // ②
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

/** "2026년04월02일(목)" / "2024년7월9일(화)" → "2026-04-02"
 *  ⚠ 월·일이 한 자리로 오는 행이 섞여 있다(1319/5452 실측). \d{2} 로 고정하면 조용히 파싱 실패한다. */
export function normSpeechDate(s) {
  const m = String(s).match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

/** 발언자 표기 정리 — '柳榮夏 의원' 처럼 한자가 섞이고 '이재강 위원'/'위원장 이철규' 로 흔들린다. */
export function cleanSpeakerName(s) {
  return String(s || "").replace(/\s*(의원|위원장|위원|장관|차관|본부장|청장|처장|실장|총장|원장)\s*$/, "")
    .replace(/^\s*(위원장|부위원장|의원)\s*/, "").trim();
}
