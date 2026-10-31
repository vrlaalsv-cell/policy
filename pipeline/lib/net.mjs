// 바깥 기사 주소를 받아 읽을 때 쓰는 검사 — 6_fetch_excerpts.mjs (시험: test/net.test.mjs)

/** 공개 인터넷 주소인가 — 기사 링크가 집 안 기기·컨테이너 이름(app·ys)·사설 IP 로 넘어가는 걸 막는다 */
export function isPublicUrl(u) {
  let h;
  try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return false; h = x.hostname.toLowerCase().replace(/^\[|\]$/g, ""); }
  catch { return false; }
  if (!h.includes(".") && !h.includes(":")) return false;                        // localhost·app·ys 같은 한 단어 이름
  if (/\.(local|localhost|internal|lan|home|ts\.net)$/.test(h)) return false;
  if (/^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false; // 사설·Tailscale
  if (h.includes(":") && (h === "::1" || /^(fc|fd|fe80)/.test(h) || h.startsWith("::ffff:"))) return false;
  return true;
}
