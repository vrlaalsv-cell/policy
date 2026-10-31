// 기사 주소 검사(lib/net.mjs) — 집 안 기기·사설 IP 로 넘어가는 주소를 막는다
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicUrl } from "../pipeline/lib/net.mjs";

test("공개 기사 주소는 통과", () => {
  for (const u of ["https://www.yna.co.kr/view/AKR1", "http://news.example.com/a?b=1", "https://8.8.8.8/x"]) assert.equal(isPublicUrl(u), true, u);
});

test("내부 주소는 막는다", () => {
  for (const u of ["http://localhost:8137/", "http://app:8137/api/update", "http://ys:8007", "http://192.168.0.6/", "http://10.0.0.1",
    "http://172.20.0.2", "http://127.0.0.1", "http://100.120.237.109/", "http://169.254.169.254/latest", "http://[::1]/",
    "http://nas.local/", "file:///etc/passwd", "ftp://example.com/", "notaurl"]) assert.equal(isPublicUrl(u), false, u);
});
