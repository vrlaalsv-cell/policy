// utterances.json → 분석용 소배치 파일들 (data/_abatch/b{i}.json)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./lib/env.mjs";

const U = JSON.parse(readFileSync(join(paths.data, "utterances.json"), "utf8"));
const bySpeaker = U.bySpeaker || {};
const APP = (function () { const d = readFileSync(join(paths.web, "data.js"), "utf8"); return JSON.parse(d.slice(d.indexOf("{"), d.lastIndexOf("}") + 1)); })();
const sidoOf = {}; APP.members.forEach((m) => sidoOf[m.name] = m.sido);

const BATCH = 8, PER_MEMBER = 28, TXT = 220;
const names = Object.keys(bySpeaker);
const dir = join(paths.data, "_abatch");
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let n = 0;
for (let i = 0; i < names.length; i += BATCH) {
  const slice = names.slice(i, i + BATCH).map((name) => ({
    name, sido: sidoOf[name] || "",
    utterances: bySpeaker[name].slice(0, PER_MEMBER).map((u) => (u.text.length > TXT ? u.text.slice(0, TXT) : u.text)),
  }));
  writeFileSync(join(dir, "b" + n + ".json"), JSON.stringify({ batch: n, members: slice }), "utf8");
  n++;
}
console.log(`✔ ${n}개 배치 (의원 ${names.length}명, 배치당 ${BATCH}명) → data/_abatch/`);
