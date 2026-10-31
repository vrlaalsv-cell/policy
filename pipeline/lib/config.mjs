// 공용 설정: 에너지 키워드, 지역구→시도 매핑
// (사업·성향 메타와 시도 좌표는 옛 build_web_data.mjs 전용이라 2026-11-01 함께 지움 — 화면은 web/data.js 의 meta 를 쓴다)

// 에너지 관련 발언 사전 필터 키워드 (토큰 절감의 핵심)
export const ENERGY_KEYWORDS = [
  "에너지", "LNG", "액화천연가스", "천연가스", "수소", "재생에너지", "신재생", "태양광", "풍력", "해상풍력",
  "원전", "원자력", "SMR", "전력", "전기요금", "발전", "도시가스", "가스공사", "한전", "한국전력",
  "탄소중립", "RE100", "계통", "송전", "배전", "석탄", "화력", "전원믹스", "에너지전환",
  "에너지솔루션", "분산에너지", "분산특구", "집단에너지",
  // ⚠ "에너지"가 이미 "분산에너지"·"에너지솔루션"의 부분문자열이라 로컬 정규식(KW)·서버 검색 둘 다
  //   이 4개를 굳이 안 넣어도 이미 걸린다. 그래도 명시해 두는 건 목록만 보고 커버리지를 판단할 때
  //   "이 키워드가 왜 빠졌지"란 재조사를 막기 위함(문서화 목적, 실질적 커버리지 변화는 없음).
];

// ⚠ 사업별 태깅 키워드(BIZ_KEYWORDS)는 2026-08-10 삭제했다 — 어디서도 안 쓰는 죽은 코드였다
//   (옛 Gemini 판정 경로 잔재. NUCLEAR 키가 아예 없고 POWER 에 "원전"이 들어 있어 현행 8개 체계와
//   맞지도 않아, 이걸 보고 분류 기준을 판단하면 오해한다).
//   **지금 사업 분류는 키워드 매칭이 아니라 AI 판정이다** — 분류 정의문은 태깅 워크플로 프롬프트
//   (`pipeline/wf_cabinet.js` 의 8개 사업 설명)에 있고, 뉴스 기사만 `lib/news_labels.mjs` 의
//   카테고리별 키워드로 매칭한다. 수집 단계 사전필터는 위 ENERGY_KEYWORDS(카테고리 구분 없는 평면 목록).

const SIDO_PREFIX = {
  "서울": "SEOUL", "부산": "BUSAN", "대구": "DAEGU", "인천": "INCHEON", "광주": "GWANGJU",
  "대전": "DAEJEON", "울산": "ULSAN", "세종": "SEJONG", "경기": "GYEONGGI", "강원": "GANGWON",
  "충북": "CHUNGBUK", "충청북도": "CHUNGBUK", "충남": "CHUNGNAM", "충청남도": "CHUNGNAM",
  "전북": "JEONBUK", "전라북도": "JEONBUK", "전남": "JEONNAM", "전라남도": "JEONNAM",
  "경북": "GYEONGBUK", "경상북도": "GYEONGBUK", "경남": "GYEONGNAM", "경상남도": "GYEONGNAM",
  "제주": "JEJU",
};

// ORIG_NM(예: "서울 종로구", "경기 수원시갑") → 시도 코드
export function districtToSido(orig) {
  if (!orig) return null;
  const head = String(orig).trim().split(/\s+/)[0];
  for (const [k, v] of Object.entries(SIDO_PREFIX)) if (head.startsWith(k)) return v;
  return null;
}
