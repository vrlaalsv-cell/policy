export const meta = {
  name: 'cabinet-reanalyze-6biz',
  description: '국무회의·차관회의 94건을 6사업(전력·LNG·재생E·수소·도시가스·원전) + 앞뒤 맥락 포함 발췌로 재분석',
  phases: [{ title: 'Extract', detail: '회의록별 에너지 발언 발췌·성향 판정' }],
}

const BIZ = ['POWER', 'LNG', 'RE', 'H2', 'CITYGAS', 'NUCLEAR']
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

const items = args // [{file, meeting}]

function prompt(file) {
  return `너는 SK E&S(LNG·전력·재생에너지·수소·도시가스·원전 관련 에너지 기업)의 정책 애널리스트다.
회의록 파일을 Read 도구로 읽어라: ${file}
이 파일은 대한민국 국무회의 또는 차관회의 회의록 전문(발언자 표기 포함)이다.
SK E&S의 6개 사업에 영향이 있는 발언만 발췌하라:
- POWER(전력): 전력망·송배전·전기요금·전력시장·분산에너지·한전
- LNG: LNG·천연가스·가스공사·직수입·LNG발전·터미널
- RE(재생에너지): 태양광·해상풍력·재생에너지·RE100·재생E 확대/규제/입지
- H2(수소): 수소·청정수소·연료전지·암모니아
- CITYGAS(도시가스): 도시가스·소매요금·배관·안전
- NUCLEAR(원전): 원전·원자력·SMR·탈원전·월성·체코 원전·방폐장·고준위

각 발췌 statement:
- speaker: 발언자 실명(성명)만. role: 직위(예: 대통령, 국무총리, 산업통상자원부장관 등).
- businesses: 관련된 사업 id 배열(위 6개 중).
- stance: 해당 사업에 대한 태도 — favor(확대·지원 우호), oppose(축소·규제·비판), neutral(언급하나 방향 불명확).
- quote: 반드시 회의록 원문 그대로 인용하되, **맥락을 알 수 있도록 해당 발언의 앞뒤 한두 문장을 포함해 2~4문장 분량**으로 발췌하라. 지어내지 마라.
- note: SK E&S 사업 관점에서 이 발언이 갖는 함의를 한 문장으로.
에너지 6개 사업과 무관한 발언은 절대 넣지 마라. 관련 발언이 없으면 statements를 빈 배열로 반환하라.`
}

phase('Extract')
const results = await parallel(items.map((it, i) => () =>
  agent(prompt(it.file), { label: `cab:${i}`, phase: 'Extract', schema: SCHEMA, effort: 'low' })
    .then((r) => (r && r.statements ? r.statements.map((s) => ({ speaker: s.speaker, role: s.role, businesses: s.businesses, stance: s.stance, quote: s.quote, note: s.note, meeting: it.meeting })) : []))
))
const statements = results.filter(Boolean).flat()
log(`발췌 완료: 파일 ${results.filter(Boolean).length}/${items.length}, 발언 ${statements.length}건`)
return { fileCount: items.length, filesOk: results.filter(Boolean).length, statements }
