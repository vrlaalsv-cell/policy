// web/ 정적 파일 서버 (외부 패키지 없이). 사용: npm run serve
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const PORT = process.env.PORT || 8137;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ico": "image/x-icon",
};

/**
 * pipeline 스크립트를 자식 프로세스로 돌리고 결과를 JSON 으로 응답한다.
 *
 * ⚠ 예전 구현은 자식이 정상 종료해도 5분 타이머를 지우지 않았다. 정상 종료한 자식의
 *   child.killed 는 false 라서 300초 뒤 타임아웃 분기가 그대로 실행됐고, 이미 끝난 응답에
 *   res.writeHead 를 다시 불러 ERR_HTTP_HEADERS_SENT 가 났다. 그 예외는 요청 핸들러의
 *   try/catch 밖(setTimeout 콜백)이라 uncaughtException 이 되어 **웹서버가 죽었다**.
 *   → 종료 시 clearTimeout + headersSent 가드 두 겹으로 막는다.
 */
function runScript(res, script, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const child = spawn("node", [join(dirname(fileURLToPath(import.meta.url)), script)], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let error = "";
    let done = false;

    child.stdout?.on("data", (d) => { output += d.toString(); });
    child.stderr?.on("data", (d) => { error += d.toString(); });

    const finish = (status, body) => {
      if (done || res.headersSent || res.writableEnded) return;
      done = true;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
      resolve();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(504, { success: false, error: "업데이트 시간 초과" });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      finish(200, { success: code === 0, output, error, code });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      finish(500, { success: false, error: e.message });
    });
  });
}

const runUpdate = (res) => runScript(res, "update-assembly.mjs");
const runUpdateCabinet = (res) => runScript(res, "update-cabinet.mjs");

createServer(async (req, res) => {
  try {
    // API 엔드포인트
    if (req.url === "/api/update" && req.method === "POST") {
      await runUpdate(res);
      return;
    }
    if (req.url === "/api/update-cabinet" && req.method === "POST") {
      await runUpdateCabinet(res);
      return;
    }

    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = normalize(join(WEB, p));
    if (!file.startsWith(WEB)) { res.writeHead(403).end("forbidden"); return; }
    // 스케줄러가 새로 만든 기사 데이터(data/news.js)가 있으면 그것을 우선 서빙한다.
    // data/ 는 볼륨 마운트라 이미지 재빌드와 무관하게 최신 수집분이 유지된다.
    if (p === "/news.js") {
      try {
        const fresh = await readFile(join(DATA, "news.js"));
        res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
        res.end(fresh);
        return;
      } catch { /* 없으면 이미지에 포함된 web/news.js 사용 */ }
    }
    const buf = await readFile(file);
    // 이미지는 재배포해도 파일명이 안 바뀌니 짧게(1일)만 캐시 — 매 새로고침마다 로고·사진을
    // 통째로 재다운로드하던 문제(no-store 전면 적용) 해소. JS/HTML은 그대로 no-store 유지
    // — 안 그러면 "재배포됐는데 화면이 옛날 그대로"인 클라 캐시 혼동이 재발한다.
    const ext = extname(file).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg"].includes(ext);
    const cacheControl = isImage ? "public, max-age=86400" : "no-store";
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cacheControl });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
  }
}).listen(PORT, "0.0.0.0", () => {
  let ip = "localhost";
  const interfaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        ip = addr.address;
        break;
      }
    }
    if (ip !== "localhost") break;
  }
  console.log(`대시보드: http://${ip}:${PORT}`);
});
