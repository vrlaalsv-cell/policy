// web/ 정적 파일 서버 (외부 패키지 없이). 사용: npm run serve
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const PORT = process.env.PORT || 8137;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
};

function runUpdate(res) {
  return new Promise((resolve) => {
    const child = spawn("node", [join(dirname(fileURLToPath(import.meta.url)), "update-assembly.mjs")], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let error = "";

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      error += data.toString();
    });

    child.on("close", (code) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: code === 0, output, error, code }));
      resolve();
    });

    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        res.writeHead(504, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: "업데이트 시간 초과" }));
        resolve();
      }
    }, 300000); // 5분 타임아웃
  });
}

createServer(async (req, res) => {
  try {
    // API 엔드포인트
    if (req.url === "/api/update" && req.method === "POST") {
      await runUpdate(res);
      return;
    }

    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = normalize(join(WEB, p));
    if (!file.startsWith(WEB)) { res.writeHead(403).end("forbidden"); return; }
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
  }
}).listen(PORT, () => console.log(`대시보드: http://localhost:${PORT}`));
