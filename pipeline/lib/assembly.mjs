// 열린국회정보 오픈API 헬퍼 (REST/JSON, 페이지네이션)
// 공통 형식: https://open.assembly.go.kr/portal/openapi/{service}?KEY=..&Type=json&pIndex=1&pSize=100[&AGE=22]
const BASE = "https://open.assembly.go.kr/portal/openapi";

// 서비스 코드 (기획안 v1.0 검증본 — 착수 시 공식 명세서로 1회 재확인 권장)
export const SERVICE = {
  members: "nwvrqwxyaytdsfvhu",        // 현직 국회의원 인적사항 (AGE 불필요)
  plenaryMinutes: "nzbyfwhwaoanttzje",  // 본회의 회의록 (DAE_NUM, CONF_DATE)
  committeeMinutes: "ncwgseseafwbuheph",// 위원회 회의록 (DAE_NUM, CONF_DATE)
  votes: "nwbpacrgavhjryiph",           // 국회의원 본회의 표결정보 (AGE)
  bills: "nzmimeepazxkubdpn",           // 국회의원 발의법률안 (AGE)
};

// 한 페이지 호출
async function page(key, service, params, pIndex, pSize) {
  const qs = new URLSearchParams({ KEY: key, Type: "json", pIndex: String(pIndex), pSize: String(pSize), ...params });
  const res = await fetch(`${BASE}/${service}?${qs}`);
  if (!res.ok) throw new Error(`${service} HTTP ${res.status}`);
  const json = await res.json();
  // 응답 형태: { [service]: [ {head:[{list_total_count},{RESULT:{CODE,MESSAGE}}]}, {row:[...]} ] }
  const node = json[service];
  if (!Array.isArray(node)) {
    // 에러 응답 (RESULT.CODE 가 INFO-000 이 아닌 경우 등)
    const msg = JSON.stringify(json).slice(0, 300);
    throw new Error(`${service} 예상치 못한 응답: ${msg}`);
  }
  const head = node[0]?.head || [];
  const total = head[0]?.list_total_count ?? 0;
  const rows = node[1]?.row || [];
  return { rows, total };
}

// 전체 페이지 수집
export async function fetchAll(key, service, params = {}, pSize = 100) {
  let pIndex = 1, out = [];
  for (;;) {
    const { rows, total } = await page(key, service, params, pIndex, pSize);
    out = out.concat(rows);
    if (out.length >= total || rows.length === 0) break;
    pIndex += 1;
  }
  return out;
}
