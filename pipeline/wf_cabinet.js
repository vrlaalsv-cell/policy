export const meta = {
  name: 'cabinet-reanalyze-8biz',
  description: '국무회의·차관회의 94건을 8사업(전력·LNG·재생E·수소·도시가스·원전·에너지솔루션·분산에너지) + 앞뒤 맥락 포함 발췌로 재분석',
  phases: [{ title: 'Extract', detail: '회의록별 에너지 발언 발췌·성향 판정' }],
}

const BIZ = ['POWER', 'LNG', 'RE', 'H2', 'CITYGAS', 'NUCLEAR', 'ESOL', 'DISTE']
const stanceEnum = { type: 'string', enum: ['favor', 'neutral', 'oppose'] }
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    statements: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          speaker: { type: 'string' },
          role: { type: 'string' },
          businesses: { type: 'array', items: { type: 'string', enum: BIZ } },
          stance: stanceEnum,
          quote: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['speaker', 'role', 'businesses', 'stance', 'quote', 'note'],
      },
    },
  },
  required: ['statements'],
}

const items = typeof args === 'string' ? JSON.parse(args) : args // [{file, meeting}]

function prompt(file) {
  // ⚡ 프롬프트 캐싱 — **변하는 부분(파일 경로)은 반드시 맨 뒤에** 둔다.
  //   병렬 에이전트 수십 개가 같은 지시문을 쓰는데, 앞쪽에 경로가 끼면 그 뒤 전부가 매번 새 토큰이 된다.
  //   공통 접두사를 최대한 길게 유지해야 캐시가 걸린다. 지시문을 고칠 때 이 순서를 깨지 말 것.
  return `너는 SK E&S(LNG·전력·재생에너지·수소·도시가스·원전·에너지솔루션·분산에너지 관련 에너지 기업)의 정책 애널리스트다.
대한민국 국무회의 또는 차관회의 회의록 전문(발언자 표기 포함)을 읽고,
SK E&S의 8개 사업에 영향이 있는 발언만 발췌하라:
- POWER(전력): 전력망·송배전·전기요금(전국 단일요금 체계)·전력시장(도매·SMP)·한전 재무·전력수급
- LNG: LNG·천연가스·가스공사·직수입·LNG발전·터미널
- RE(재생에너지): 태양광·해상풍력·재생에너지·RE100·재생E 확대/규제/입지
- H2(수소): 수소·청정수소·연료전지·암모니아
- CITYGAS(도시가스): 도시가스·소매요금·배관·안전
- NUCLEAR(원전): 원전·원자력·SMR·탈원전·월성·체코 원전·방폐장·고준위
- ESOL(에너지솔루션): 집단에너지·열병합발전·VPP(가상발전소)·수요반응(DR)·ESS(에너지저장장치) 운영·통합에너지솔루션·데이터센터 전력·냉방 솔루션·에너지효율화
- DISTE(분산에너지): 분산에너지법·분산에너지 특별법·분산특구·특화지역 지정·지산지소(지역생산-지역소비)·지역별 차등 전기요금·직접전력거래(PPA)·전력직구제

각 발췌 statement:
- speaker: 발언자 실명(성명)만. role: 직위(예: 대통령, 국무총리, 산업통상자원부장관 등).
- businesses: 관련된 사업 id 배열(위 8개 중). POWER와 DISTE가 헷갈리면 — 전국 단위 요금·시장·한전 구조 얘기면 POWER, 지역별 차등요금·분산특구·PPA 직접거래 얘기면 DISTE.
- stance: 해당 사업에 대한 태도 — favor(확대·지원 우호), oppose(축소·규제·비판), neutral(언급하나 방향 불명확).
- quote: 반드시 회의록 원문 그대로 인용하되, **맥락을 알 수 있도록 해당 발언의 앞뒤 한두 문장을 포함해 2~4문장 분량**으로 발췌하라. 지어내지 마라.
- note: SK E&S 사업 관점에서 이 발언이 갖는 함의를 한 문장으로.
에너지 8개 사업과 무관한 발언은 절대 넣지 마라. 관련 발언이 없으면 statements를 빈 배열로 반환하라.

── 처리 대상 (이 줄 위까지는 모든 회의록에 공통이다) ──
Read 도구로 아래 파일을 읽어 위 기준대로 처리하라:
${file}`
}

phase('Extract')
const results = await parallel(items.map((it, i) => () =>
  agent(prompt(it.file), { label: `cab:${i}`, phase: 'Extract', schema: SCHEMA, effort: 'low' })
    .then((r) => (r && r.statements ? r.statements.map((s) => ({ speaker: s.speaker, role: s.role, businesses: s.businesses, stance: s.stance, quote: s.quote, note: s.note, meeting: it.meeting })) : []))
))
const statements = results.filter(Boolean).flat()
log(`발췌 완료: 파일 ${results.filter(Boolean).length}/${items.length}, 발언 ${statements.length}건`)
return { fileCount: items.length, filesOk: results.filter(Boolean).length, statements }
