import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2];
const lines = readFileSync(dir + "/journal.jsonl", "utf8").split(/\r?\n/).filter(Boolean);
const results = [];
for (const ln of lines) { let j; try { j = JSON.parse(ln); } catch { continue; }
  if (j.type !== "result") continue;
  let v = j.value || j.result || j.output;
  if (typeof v === "string") { try { v = JSON.parse(v.slice(v.indexOf("{"), v.lastIndexOf("}") + 1)); } catch {} }
  if (v && Array.isArray(v.picks) && v.biz && v.biz !== "N/A") results.push({ biz: v.biz, stance: v.stance, picks: v.picks });
}
writeFileSync("data/_board_results.json", JSON.stringify({ results }));
console.log("저널 복구 결과:", results.length, "그룹");
