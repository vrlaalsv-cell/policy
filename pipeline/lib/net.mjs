// 바깥 기사 주소와 DNS 결과를 검사하고 검증한 IP로만 연결한다.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
]) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  blocked.addSubnet(address, prefix, "ipv6");
}
const isPublicAddress = (address) => {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
};

/** URL 문법 검사. 도메인은 연결할 때 DNS 결과까지 별도로 검사한다. */
export function isPublicUrl(u) {
  let h;
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol) || x.username || x.password) return false;
    h = x.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch { return false; }
  if (isIP(h)) return isPublicAddress(h);
  if (!h.includes(".") || /\.(local|localhost|internal|lan|home|ts\.net)$/.test(h)) return false;
  return true;
}

/** 원래 Host·TLS 이름은 보존하고, 소켓 lookup에는 검증된 주소만 돌려준다. */
export async function fetchPublic(value, options = {}, { lookup = dnsLookup, request } = {}) {
  let url = new URL(value);
  for (let hop = 0; ; hop++) {
    if (!isPublicUrl(url)) throw new Error("공개 주소 아님");
    options.signal?.throwIfAborted();
    const res = await new Promise((resolve, reject) => {
      const send = request || (url.protocol === "https:" ? httpsRequest : httpRequest);
      const req = send(url, {
        ...options, agent: false,
        lookup(hostname, opt, callback) {
          lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
            if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
              callback(new Error("공개 DNS 주소 아님"));
              return;
            }
            if (opt.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          }, callback);
        },
      }, (incoming) => {
        // 여기서 던지면 잡을 곳 없이 수집 전체가 죽는다(예: 600 이상 상태 코드는 Response 가 거부) → 실패로 돌린다.
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const noBody = [204, 205, 304].includes(incoming.statusCode) || options.method === "HEAD";
          if (noBody) incoming.resume();
          resolve(new Response(noBody ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers }));
        } catch (e) {
          incoming.destroy();
          reject(e);
        }
      });
      req.on("error", reject);
      req.end(options.body);
    });
    const location = res.status >= 300 && res.status < 400 && res.headers.get("location");
    if (!location) return res;
    await res.body?.cancel();
    if (hop >= 5) throw new Error("리다이렉트 너무 많음");
    url = new URL(location, url);
    // 브라우저 fetch와 같은 POST → GET 전환.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && options.method === "POST")) {
      options = { ...options, method: "GET", body: undefined };
    }
  }
}
