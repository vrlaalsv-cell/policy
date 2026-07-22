// 공용 설정: 사업/정당/성향 메타, 시도 좌표(육각 카토그램), 에너지 키워드, 지역구→시도 매핑

export const META = {
  businesses: [
    { id: "all", label: "전체" },
    { id: "LNG", label: "LNG" },
    { id: "H2", label: "수소" },
    { id: "RE", label: "재생E" },
    { id: "CITYGAS", label: "도시가스" },
    { id: "POWER", label: "전력" },
  ],
  parties: {
    "더불어민주당": { short: "민주", color: "#152484" },
    "국민의힘": { short: "국힘", color: "#E61E2B" },
    "조국혁신당": { short: "조국", color: "#0073CF" },
    "개혁신당": { short: "개혁", color: "#FF7210" },
    "진보당": { short: "진보", color: "#D6001C" },
    "기본소득당": { short: "기본", color: "#00D2C3" },
    "사회민주당": { short: "사민", color: "#F58400" },
    "무소속": { short: "무소속", color: "#8894A6" },
  },
  stance: {
    favor: { label: "우호", color: "#0f7a4d", bg: "#e6f7ee" },
    neutral: { label: "중립", color: "#6b7280", bg: "#eef1f5" },
    oppose: { label: "비우호", color: "#b01e2e", bg: "#fdeef0" },
    unknown: { label: "자료부족", color: "#9aa4b2", bg: "#f3f5f8" },
  },
};

export const SIDO = [
  // q,r = 육각 앵커(한반도 배치). web/app.js 의 카토그램 배치에 사용.
  { code: "SEOUL", name: "서울", seats: 48, q: 5, r: 3 },
  { code: "INCHEON", name: "인천", seats: 14, q: 1, r: 4 },
  { code: "GYEONGGI", name: "경기", seats: 60, q: 3, r: 6 },
  { code: "GANGWON", name: "강원", seats: 8, q: 10, r: 3 },
  { code: "SEJONG", name: "세종", seats: 2, q: 1, r: 9 },
  { code: "CHUNGBUK", name: "충북", seats: 8, q: 4, r: 8 },
  { code: "CHUNGNAM", name: "충남", seats: 11, q: -3, r: 9 },
  { code: "DAEJEON", name: "대전", seats: 7, q: 0, r: 11 },
  { code: "GYEONGBUK", name: "경북", seats: 13, q: 7, r: 8 },
  { code: "DAEGU", name: "대구", seats: 12, q: 5, r: 11 },
  { code: "JEONBUK", name: "전북", seats: 10, q: -3, r: 13 },
  { code: "GWANGJU", name: "광주", seats: 8, q: -6, r: 16 },
  { code: "JEONNAM", name: "전남", seats: 10, q: -8, r: 18 },
  { code: "GYEONGNAM", name: "경남", seats: 16, q: 1, r: 15 },
  { code: "ULSAN", name: "울산", seats: 6, q: 6, r: 13 },
  { code: "BUSAN", name: "부산", seats: 18, q: 4, r: 15 },
  { code: "JEJU", name: "제주", seats: 3, q: -9, r: 22 },
  { code: "PROP", name: "비례대표", seats: 46, q: 15, r: 12 },
];

// 에너지 관련 발언 사전 필터 키워드 (토큰 절감의 핵심)
export const ENERGY_KEYWORDS = [
  "에너지", "LNG", "액화천연가스", "천연가스", "수소", "재생에너지", "신재생", "태양광", "풍력", "해상풍력",
  "원전", "원자력", "SMR", "전력", "전기요금", "발전", "도시가스", "가스공사", "한전", "한국전력",
  "탄소중립", "RE100", "계통", "송전", "배전", "석탄", "화력", "전원믹스", "에너지전환",
];

// 사업별 태깅 힌트 (Gemini 프롬프트에 사용)
export const BIZ_KEYWORDS = {
  LNG: ["LNG", "액화천연가스", "천연가스", "가스발전", "벙커링"],
  H2: ["수소", "청정수소", "수소경제", "연료전지"],
  RE: ["재생에너지", "신재생", "태양광", "풍력", "해상풍력", "RE100"],
  CITYGAS: ["도시가스", "가스공사", "배관", "가스요금"],
  POWER: ["전력", "전기요금", "발전", "송전", "계통", "한전", "전원믹스", "원전"],
};

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
