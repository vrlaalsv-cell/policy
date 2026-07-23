// 기사 → 에너지원 라벨 분류 (LNG·수소·원전·재생E·도시가스·전력)
//   수집기(5_collect_news.mjs)와 웹 빌더(build_news_web.mjs)가 함께 쓴다.
//   색은 web/news.js 로 그대로 실려 나가 대시보드 칩 색이 된다.
//   ※ 구체적인 것 → 일반적인 것 순서. "전력"은 가장 포괄적이라 맨 뒤.

export const NEWS_LABELS = [
  {
    id: "NUCLEAR", label: "원전", color: "#7a3ea3", bg: "#f3ecfa",
    kw: ["원전", "원자력", "SMR", "소형모듈원자로", "핵발전", "고준위", "사용후핵연료", "월성", "한수원", "체코 원전"],
  },
  {
    id: "H2", label: "수소", color: "#0e7490", bg: "#e6f6f9",
    kw: ["수소", "연료전지", "수전해", "청정수소", "암모니아 발전"],
  },
  {
    id: "RE", label: "재생E", color: "#0f7a4d", bg: "#eafaf1",
    kw: ["재생에너지", "재생 에너지", "신재생", "태양광", "태양전지", "풍력", "RE100", "햇빛연금", "에너지전환", "에너지 전환"],
  },
  {
    id: "LNG", label: "LNG", color: "#b45309", bg: "#fdf3e3",
    // "가스공사"는 프로농구단(대구 한국가스공사) 기사가 딸려와 제외.
    kw: ["LNG", "액화천연가스", "천연가스", "가스전", "복합화력", "가스발전"],
  },
  {
    id: "CITYGAS", label: "도시가스", color: "#a1471f", bg: "#fceee7",
    kw: ["도시가스", "가스요금", "가스 요금", "취사용", "난방비"],
  },
  {
    id: "POWER", label: "전력", color: "#1d4ed8", bg: "#e8eefc",
    kw: ["전력", "전기요금", "전기 요금", "한전", "한국전력", "송전", "변전", "계통", "발전소", "전력망", "에너지고속도로", "블랙아웃", "전력수급", "전기본", "전력거래소", "SMP"],
    // 電力 아니라 全力/戰力 — "전력질주(全力)·전력 증강(戰力)" 은 에너지 기사가 아니다.
    //   국방부장관처럼 군 관련 인물은 '전력 증강·군 전력' 기사가 대량으로 딸려온다.
    neg: /전심\s*전력|전력\s*질주|전력\s*투구|전력을?\s*다\s*해?|전력해|전력 다\b|총력전|사력을|전력\s*(증강|공백|누수|보강|손실|열세|우위|평가전)|(군|해병대|해군|공군|육군|방산|국방|전투)\s*전력|전력화/g,
  },
];

/** 라벨 판정용으로 오해 소지가 있는 표현을 지운 텍스트 */
function scrub(text, L) {
  const t = String(text || "");
  return (L.neg ? t.replace(L.neg, " ") : t).toUpperCase();
}

/** 기사 제목+요약에서 검출된 에너지원 라벨 id 배열 (최대 max개, 구체적인 것 우선) */
export function labelsOf(text, max = 3) {
  const hit = [];
  for (const L of NEWS_LABELS) {
    const t = scrub(text, L);
    if (L.kw.some((k) => t.includes(k.toUpperCase()))) hit.push(L.id);
  }
  return hit.slice(0, max);
}

/** 이 텍스트에서 실제로 걸린 키워드 하나 (화면에서 강조 표시용) */
export function matchedKeyword(text, labelIds) {
  const list = NEWS_LABELS.filter((L) => !labelIds || labelIds.includes(L.id));
  for (const L of list) {
    const t = scrub(text, L);
    const k = L.kw.find((x) => t.includes(x.toUpperCase()));
    if (k) return k;
  }
  return "";
}

// 스포츠·연예 기사 걸러내기 (동명이인 선수/코치가 "전력분석·전력 재정비" 같은 표현으로 걸린다).
// ⚠ '감독'은 넣지 말 것 — "한국전력감독원" 같은 진짜 에너지 기사가 함께 날아간다.
export const NOISE_RE = /프로야구|프로농구|프로축구|KBL|KBO|코칭스태프|육성선수|플레이오프|타율|투수|포수|골키퍼|미드필더|드래프트|트레이드|아이돌|예능|안타|홈런|타점|이닝|고척|잠실구장|시즌 [0-9]/;

// 군사 기사 판별 — 여기 걸리면서 라벨이 '전력' 하나뿐이면 戰力(군사력) 기사로 보고 제외한다.
// (국방부장관 등 군 관련 인물에게서 "전력 증강" 류 기사가 대량으로 딸려온다.
//  같은 기사라도 태양광·수소 등 다른 라벨이 함께 붙으면 진짜 에너지 기사이므로 남긴다.)
// ⚠ 사람 이름·일반 단어와 겹치는 말은 넣지 말 것:
//   '장병'(장병용 이사) · '사단'(사단법인) · '병력'(병력=病歷) 때문에 한전기술 기사가 잘못 걸렸었다.
export const MILITARY_RE = /해병|해군|공군|육군|국방부|국방장관|국방부 장관|방위사업|방산|무기체계|전투기|잠수함|구축함|미사일|군사력|전투력|참모총장|한미연합|작전권|국방예산|합참|전력지원체계|국방전력|국방 전력|신병교육|드론전력|드론 전력/;

// 동명이인 걸러내기 — "이름 + 직함" 이 의원/장관이 아닌 직업이고, 기사 어디에도
// 정치인 단서가 없으면 다른 사람으로 본다. (예: 박상혁 교수(항공대), 윤상현 박사(공주대))
// ⚠ '대표'(당대표)·'시장'(지방선거 당선)·'위원'(위원장)은 본인일 수 있어 넣지 않는다.
const OTHER_ROLE = "(교수|박사|연구원|연구위원|총장|학장|코치|선수|감독|본부장|팀장|아나운서|가수|배우|작가|셰프|주무관)";
const POLITICIAN_RE = /의원|장관|국회|의장|위원장|당대표|최고위원|원내대표|더불어민주당|국민의힘|조국혁신당|개혁신당|진보당|기본소득당|사회민주당|무소속|대통령실|정부|시의회|도의회/;

/** 이름은 같지만 다른 사람(교수·연구자·선수 등)의 기사인가 */
export function isOtherPerson(text, name) {
  if (!name) return false;
  const t = String(text || "");
  return new RegExp(name + "\\s*" + OTHER_ROLE).test(t) && !POLITICIAN_RE.test(t);
}

/** 군사 문맥의 '전력(戰力)' 기사인가 */
export function isMilitaryPower(text, labels) {
  const only = (labels || []).filter((id) => id !== "POWER").length === 0;
  return only && MILITARY_RE.test(String(text || ""));
}

/** 대시보드로 넘길 라벨 메타(키워드는 제외 — 화면에서 쓰지 않음) */
export function labelMeta() {
  return NEWS_LABELS.map(({ id, label, color, bg }) => ({ id, label, color, bg }));
}

/** 검색 질의에 쓸 에너지 키워드(OR 묶음) */
export const QUERY_TERMS = ["LNG", "수소", "원전", "재생에너지", "도시가스", "전력"];
