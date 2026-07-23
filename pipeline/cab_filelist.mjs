import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { paths } from "./lib/env.mjs";
const dir = join(paths.data, "cabinet_minutes", "국무회의 회의록");
const files = readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
const out = [];
for (const f of files) {
  const base = f.replace(/\.txt$/, "");
  const m = base.match(/^(\d{2})(\d{2})(\d{2})\s+(제\d+회)\s+(국무회의록|차관회의록)/);
  let meeting = base;
  if (m) { const yy = "20" + m[1]; const kind = m[5].replace("록", ""); meeting = m[4] + " " + kind + " (" + yy + "-" + m[2] + "-" + m[3] + ")"; }
  out.push({ file: resolve(dir, f), meeting });
}
writeFileSync(join(paths.data, "_cab_files.json"), JSON.stringify(out));
console.log("파일 " + out.length + "개 · 샘플: " + out[0].meeting + " | " + out[1].meeting);
