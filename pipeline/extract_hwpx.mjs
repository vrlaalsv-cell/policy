// HWPX 회의록 → 문단 텍스트 (Node 내장만 사용, 의존성 0)
//
//   node pipeline/extract_hwpx.mjs <파일.hwpx>          # 한 파일 확인용(문단 출력)
//   import { extractHwpx } from "./extract_hwpx.mjs"    # 빌더에서 사용
//
// 🔴 왜 HWPX 인가 (2026-08-12 결정)
//   · **PDF 가 없는 구간이 있다.** 2025-07-05 이전 회의록은 hwpx 만 올라와 있다(실측 보유 PDF 102 vs HWPX 364).
//   · **추출 품질이 낫다.** PDF 는 렌더링 결과라 2단 조판에서 좌우가 뒤섞여, `extract_minutes.py` 에
//     거터 폭 판별 같은 방어를 넣어야 했다. HWPX 는 ZIP+XML 이라 **문단 순서가 그대로**다.
//   · **파이썬이 필요 없다.** 컨테이너에 pdfplumber 를 넣는 숙제(AUTOMATION_TODO §C-2)를 피할 수 있다.
//
// HWPX 구조 (실측)
//   ZIP 안에 mimetype / version.xml / Contents/header.xml / **Contents/section0.xml** / Preview/PrvText.txt ...
//   본문은 `Contents/section{N}.xml` 의 `<hp:p>`(문단) 안 `<hp:t>`(텍스트런). 실측 395문단·표 16개.
//   ⚠ 한 문단이 여러 `<hp:t>` 로 쪼개져 있다(글꼴·서식 단위) → **문단 단위로 이어붙여야** 말이 된다.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { basename } from "node:path";

/** ZIP 아카이브에서 이름이 매칭되는 엔트리들을 꺼낸다(중앙 디렉터리 기반 — 압축/무압축 both). */
function unzip(buf, want) {
  const out = new Map();
  // End of Central Directory 찾기 (뒤에서부터)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP 구조가 아님(EOCD 없음)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);            // 중앙 디렉터리 시작
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lhOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    if (want(name)) {
      // 로컬 헤더에서 실제 데이터 시작 위치 계산 (로컬 헤더의 name/extra 길이가 중앙과 다를 수 있다)
      const lnLen = buf.readUInt16LE(lhOff + 26);
      const leLen = buf.readUInt16LE(lhOff + 28);
      const start = lhOff + 30 + lnLen + leLen;
      const raw = buf.slice(start, start + compSize);
      out.set(name, method === 0 ? raw : inflateRawSync(raw));
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

const unesc = (s) => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");   // amp 는 마지막(이중 디코딩 방지)

/**
 * hwpx → { file, paragraphs: string[], text: string }
 * 문단 단위로 뽑는다 — 발언자 줄 판별(불릿+직위+이름)이 **줄 단위 규칙**이라 문단 경계가 살아야 한다.
 */
export function extractHwpx(path) {
  const buf = readFileSync(path);
  const files = unzip(buf, (n) => /^Contents\/section\d+\.xml$/i.test(n));
  const names = [...files.keys()].sort((a, b) => {
    const na = +(a.match(/section(\d+)/i)?.[1] ?? 0), nb = +(b.match(/section(\d+)/i)?.[1] ?? 0);
    return na - nb;
  });
  const paragraphs = [];
  for (const n of names) {
    const xml = files.get(n).toString("utf8");
    for (const m of xml.matchAll(/<hp:p\b[^>]*>([\s\S]*?)<\/hp:p>/g)) {
      // 문단 안의 모든 텍스트런을 이어붙인다. (탭·줄바꿈 태그는 공백으로)
      const inner = m[1].replace(/<hp:tab\b[^>]*\/?>/g, " ").replace(/<hp:lineBreak\b[^>]*\/?>/g, " ");
      const runs = [...inner.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((x) => unesc(x[1]));
      const line = runs.join("").replace(/\s+/g, " ").trim();
      if (line) paragraphs.push(line);
    }
  }
  if (!paragraphs.length) throw new Error(`본문을 못 찾음 — section xml ${names.length}개 (구조 변경 의심)`);
  return { file: basename(path), paragraphs, text: paragraphs.join("\n") };
}

// 직접 실행하면 확인용 출력
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("extract_hwpx.mjs")) {
  const p = process.argv[2];
  if (!p) { console.error("사용: node pipeline/extract_hwpx.mjs <파일.hwpx>"); process.exit(1); }
  const r = extractHwpx(p);
  console.log(`✔ ${r.file} · 문단 ${r.paragraphs.length}개 · ${r.text.length}자`);
  console.log("--- 앞 15문단 ---");
  r.paragraphs.slice(0, 15).forEach((l, i) => console.log(String(i).padStart(3), l.slice(0, 90)));
}
