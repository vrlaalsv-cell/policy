export const meta = {
  name: 'ai-stance-summary',
  description: '인물별 발언+뉴스+6사업 성향을 종합해 SK E&S 관점 성향 분석·요약 생성',
  phases: [{ title: 'Summarize', detail: '배치별 인물 종합 분석' }],
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          key: { type: 'string' },
          headline: { type: 'string' },
          analysis: { type: 'string' },
        },
        required: ['key', 'headline', 'analysis'],
      },
    },
  },
  required: ['results'],
}

const A = args // { dir, asm, cab }
const files = []
for (let i = 0; i < A.asm; i++) files.push(A.dir + '\\asm_b' + i + '.json')
for (let i = 0; i < A.cab; i++) files.push(A.dir + '\\cab_b' + i + '.json')

function prompt(file) {
  return `너는 SK E&S(LNG·전력·재생에너지·수소·도시가스·원전 사업을 하는 에너지 기업)의 정책 애널리스트다.
파일을 Read 도구로 읽어라: ${file}
{ people:[{ key, name, party 또는 role, district?, stances(6사업 성향 요약), quotes(회의록 핵심 발언), news(최근 기사 제목·에너지라벨·날짜) }] } 형태다.

각 인물마다, 제공된 "발언 + 기사 + 사업별 성향"을 종합해 그 인물의 에너지 정책 성향을 분석하라. 결과는 다음 두 필드로:
- headline: 45자 이내 한 줄 총평. 예) "재생에너지 확대엔 적극적, 원전엔 비판적"
- analysis: 3~5문장. 어떤 사업(전력·LNG·재생E·수소·도시가스·원전)에 우호/중립/비우호인지와 그 근거(발언·기사)를 요약하고, SK E&S 사업에 주는 함의를 담아라.

엄격 규칙:
- 반드시 제공된 발언·기사·성향에만 근거하라. 없는 사실·수치·입장을 지어내지 마라.
- 발언과 기사가 적거나 한 사업에만 쏠려 있으면 "판단 근거가 제한적"임을 분석에 명시하라.
- 특정 정당이라는 이유로 성향을 단정하지 마라. 근거 텍스트가 우선이다.
- 중립적·분석적 어조. 과장 금지.
모든 인물을 results 배열에 key를 그대로 넣어 반환하라.`
}

phase('Summarize')
const out = await parallel(files.map((f, i) => () =>
  agent(prompt(f), { label: 'ai:' + (f.split('\\').pop().replace('.json', '')), phase: 'Summarize', schema: SCHEMA, effort: 'low' })
    .then((r) => (r && r.results ? r.results : []))
))
const results = out.filter(Boolean).flat()
log(`분석 완료: 배치 ${out.filter(Boolean).length}/${files.length}, 인물 ${results.length}명`)
return { fileCount: files.length, filesOk: out.filter(Boolean).length, count: results.length, results }
