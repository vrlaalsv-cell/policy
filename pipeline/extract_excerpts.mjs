// 남은(stall된) 회의록에서 에너지 관련 발언을 발언자와 함께 발췌 → data/_excerpts_missing.md
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "C:/Users/Admin/Desktop/게임만들기/assembly-dashboard/data/cabinet_minutes/국무회의 회의록";
const OUT = "C:/Users/Admin/Desktop/게임만들기/assembly-dashboard/data/_excerpts_missing.md";
const FILES = [
  "250715 제31회 국무회의록(용산).txt", "250717 제26회 차관회의록(서울-세종).txt",
  "250722 제32회 국무회의록(용산).txt", "250724 제27회 차관회의록(서울-세종).txt",
  "251111 제49회 국무회의록(용산).txt", "251113 제42회 차관회의록(서울-세종).txt",
  "260305 제8회 국무회의록(청와대).txt", "260305 제8회 차관회의록(서울-세종).txt",
  "260310 제9회 국무회의록(청와대).txt", "260313 제9회 차관회의록(서울-세종).txt",
  "260317 제10회 국무회의록(세종).txt", "260319 제10회 차관회의록(서울-세종).txt",
  "260515 제18회 차관회의록(서울-세종).txt", "260520 제22회 국무회의록(청와대).txt",
  "260522 제19회 차관회의록(서울-세종).txt", "260526 제23회 국무회의록(청와대).txt",
];
const KW = /(에너지|전력|전기요금|수소|재생에너지|신재생|태양광|풍력|해상풍력|원전|원자력|SMR|LNG|천연가스|도시가스|가스공사|한전|한국전력|탄소중립|송전|계통|전력망|분산에너지|집단에너지|열병합|발전소|전원|석탄|화력|CCUS|이산화탄소 포집|에너지고속도로|RE100|방폐장|고준위)/;

function speakerOf(line) {
  const t = line.replace(/^ㅇ\s*/, "").trim();
  if (!t || t.length > 45) return null;
  const m = t.match(/^(.*?(?:장관|차관|총리|대통령|처장|실장|위원장|부위원장|차장|본부장|청장))\s+([가-힣]{2,4})$/);
  if (m && m[1].length <= 40) return m[2] + " (" + m[1].trim() + ")";
  return null;
}

let out = "";
for (const f of FILES) {
  let lines;
  try { lines = readFileSync(join(DIR, f), "utf8").split(/\r?\n/); } catch (e) { out += `\n## ${f} — 읽기실패\n`; continue; }
  const meeting = f.replace(/\.txt$/, "");
  out += `\n\n## ${meeting}\n`;
  let cur = "(발언자미상)";
  let lastHit = -99, buf = [];
  const flush = () => { if (buf.length) { out += `- [${cur}] ${buf.join(" ").replace(/\s+/g, " ").trim()}\n`; buf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const sp = speakerOf(lines[i]);
    if (sp) { flush(); cur = sp; continue; }
    if (KW.test(lines[i])) {
      if (i - lastHit > 4) flush();
      // 매칭 라인 + 다음 1~2줄 붙여 문장성 확보
      buf.push(lines[i].trim());
      if (lines[i + 1] && !speakerOf(lines[i + 1])) buf.push(lines[i + 1].trim());
      lastHit = i;
    }
  }
  flush();
}
writeFileSync(OUT, out, "utf8");
const bytes = Buffer.byteLength(out, "utf8");
console.log(`✔ ${OUT}`);
console.log(`  용량 ${bytes} bytes (~${Math.round(bytes / 3)} tokens), 발췌 줄 ${(out.match(/^- /gm) || []).length}`);
