// web/ 정적 파일 서버 (외부 패키지 없이). 사용: npm run serve
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const PORT = process.env.PORT || 8137;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
};

createServer(async (req, res) => {
  try {
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
