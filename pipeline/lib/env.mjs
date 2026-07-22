// 아주 얇은 .env 로더 (외부 패키지 없이). 프로젝트 루트의 .env 를 읽어 process.env 에 주입.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function requireEnv(name) {
  loadEnv();
  const v = process.env[name];
  if (!v) {
    console.error(`\n[중단] .env 에 ${name} 가 비어 있습니다. .env 파일에 키를 넣고 다시 실행하세요.\n`);
    process.exit(1);
  }
  return v;
}

export const paths = {
  root: ROOT,
  data: join(ROOT, "data"),
  web: join(ROOT, "web"),
};
