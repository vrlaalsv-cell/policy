// 그룹 선정·요약 결과 → web/bizboard.js
//  입력: data/_board_results.json(워크플로우 저널 복구) + data/_board_manual.json(수기 보완)
//  성향(favor/neutral/oppose)은 에이전트 라벨이 아니라 의원의 실제 data.js 성향으로 확정(오분류 방지).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const BIZ = ["POWER", "LNG", "RE", "H2", "CITYGAS", "NUCLEAR"];
function loadRes(f) { try { return JSON.parse(readFileSync(f, "utf8")).results || []; } catch { return []; } }
const results = [
  ...loadRes(join(paths.data, "_board_results.json")),
  ...loadRes(join(paths.data, "_board_manual.json")),
];

function loadJS(f) { const d = readFileSync(f, "utf8"); return JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1)); }
const APP = loadJS(join(paths.web, "data.js"));
const byId = {}; APP.members.forEach((m) => byId[m.id] = m);

// 후보 발언수 (biz|id -> count) + biz 소속 검증용
const inp = JSON.parse(readFileSync(join(paths.data, "_board_input.json"), "utf8")).groups || [];
const countByBizId = {};
for (const g of inp) for (const c of g.candidates) countByBizId[g.biz + "|" + c.id] = c.count;

const board = {}; BIZ.forEach((b) => board[b] = { favor: [], neutral: [], oppose: [] });
const seen = new Set();
let picksN = 0;
for (const r of results) {
  if (!r || !board[r.biz]) continue;
  for (const p of (r.picks || [])) {
    const m = byId[p.id];
    const key = r.biz + "|" + p.id;
    if (!m || !p.summary || !(key in countByBizId)) continue; // biz 소속 검증
    const st = m.stance && m.stance[r.biz]; // 실제 성향으로 확정
    if (!board[r.biz][st]) continue;
    const dk = r.biz + "|" + st + "|" + p.id;
    if (seen.has(dk)) continue; seen.add(dk);
    board[r.biz][st].push({ id: p.id, name: m.name, party: m.party, count: countByBizId[key] || 0, summary: p.summary.trim() });
    picksN++;
  }
}
// 성향별 최대 5명 (발언수 순 유지 위해 count 내림차순 후 컷)
for (const b of BIZ) for (const st of ["favor", "neutral", "oppose"]) {
  board[b][st].sort((a, c) => c.count - a.count);
  board[b][st].splice(5);
}

const out = "/* 자동 생성 — build_board.mjs. 사업별 성향 임팩트 의원(5명 이내) + 3줄 성향요약. */\nwindow.BIZ_BOARD = " + JSON.stringify(board) + ";\n";
writeFileSync(join(paths.web, "bizboard.js"), out, "utf8");
const summ = BIZ.map((b) => b + "(" + board[b].favor.length + "/" + board[b].neutral.length + "/" + board[b].oppose.length + ")").join(" ");
console.log("✔ web/bizboard.js · 선정 " + picksN + "명 · 우호/중립/비우호: " + summ);
