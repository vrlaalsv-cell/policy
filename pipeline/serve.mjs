// web/ 정적 파일 서버 (외부 패키지 없이). 사용: npm run serve
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
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

// 한 번에 하나만 — 단추를 연타하거나 두 화면에서 누르면 같은 파일을 두 프로세스가 동시에 쓴다.
let running = false;
async function runExclusive(res, script) {
  if (running) {
    res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, error: "이미 업데이트 중입니다" }));
    return;
  }
  running = true;
  try { await runScript(res, script); } finally { running = false; }
}
const runUpdate = (res) => runExclusive(res, "update-assembly.mjs");
const runUpdateCabinet = (res) => runExclusive(res, "update-cabinet.mjs");

// 이 화면(app.js)이 보낸 요청인가 — 다른 사이트의 페이지가 테일넷 기기 브라우저를 빌려 몰래 POST 하는 걸 막는다.
//   ① 커스텀 헤더는 다른 출처에서 붙이려면 사전 요청(CORS preflight)이 필요한데 이 서버는 그걸 허락하지 않는다.
//   ② Origin 이 붙어 오면 이 서버 주소와 같아야 한다.
const fromThisPage = (req) => {
  if (req.headers["x-policy-update"] !== "1") return false;
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
};

// 수집 실행은 집 LAN·Tailscale(ys:8007)에서만 받는다. 공개 주소(Cloudflare 터널)로 온 요청에는
// Cloudflare 가 cf-connecting-ip·cf-ray 를 붙이므로 그걸로 가려 거절한다(2026-10-28 사용자 결정).
// 기사·회의록은 스케줄러가 어차피 자동으로 모은다.
const viaTunnel = (req) => Boolean(req.headers["cf-connecting-ip"] || req.headers["cf-ray"]);
const refuseUpdate = (res) => {
  res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ success: false, error: "공개 주소에서는 업데이트를 실행할 수 없습니다" }));
};

createServer(async (req, res) => {
  try {
    // API 엔드포인트
    if (req.url === "/api/update" && req.method === "POST") {
      if (viaTunnel(req) || !fromThisPage(req)) { refuseUpdate(res); return; }
      await runUpdate(res);
      return;
    }
    if (req.url === "/api/update-cabinet" && req.method === "POST") {
      if (viaTunnel(req) || !fromThisPage(req)) { refuseUpdate(res); return; }
      await runUpdateCabinet(res);
      return;
    }

    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = normalize(join(WEB, p));
    if (!file.startsWith(WEB)) { res.writeHead(403).end("forbidden"); return; }
    // 스케줄러가 새로 만든 기사 데이터(data/news.js)가 있으면 그것을 우선 서빙한다.
    // data/ 는 볼륨 마운트라 이미지 재빌드와 무관하게 최신 수집분이 유지된다.
    let target = file;
    if (p === "/news.js") {
      try { await stat(join(DATA, "news.js")); target = join(DATA, "news.js"); }
      catch { /* 없으면 이미지에 포함된 web/news.js 사용 */ }
    }
    const st = await stat(target);
    if (!st.isFile()) throw new Error("not a file");
    // 이미지는 재배포해도 파일명이 안 바뀌니 짧게(1일)만 캐시. JS/HTML 은 no-cache + ETag —
    // 매번 서버에 묻되 안 바뀌었으면 304 로 끝난다. (예전 no-store 는 방문마다 data.js 등 4MB 를 통째로 다시 받았다.
    //  no-cache 는 '묻지 않고 쓰기'가 아니라서 "재배포됐는데 화면이 옛날 그대로" 는 생기지 않는다.)
    const ext = extname(target).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg"].includes(ext);
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": isImage ? "public, max-age=86400" : "no-cache", ETag: etag };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers).end(); return; }
    // 통째로 메모리에 올리지 않고 흘려 보낸다
    res.writeHead(200, { ...headers, "Content-Length": st.size });
    createReadStream(target).on("error", () => res.destroy()).pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
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
