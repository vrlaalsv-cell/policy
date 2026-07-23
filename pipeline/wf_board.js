export const meta = {
  name: 'board-pick-summarize',
  description: '사업×성향 그룹별로 임팩트 있는 의원 5명 이내 선정 + 성향 드러나는 3줄 요약',
  phases: [{ title: 'Pick', detail: '그룹별 선정·요약' }],
}
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    biz: { type: 'string' }, stance: { type: 'string' },
    picks: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, summary: { type: 'string' } }, required: ['id', 'summary'] },
    },
  },
  required: ['biz', 'stance', 'picks'],
}
const FILE = args.file, N = args.n;
function prompt(i) {
  return `너는 SK E&S(에너지 기업)의 정책 애널리스트다. 파일을 Read 도구로 읽어라: ${FILE}
{ groups:[{ biz, bizLabel, stance, stanceLabel, candidates:[{id,name,party,count,statements[]}] }] } 구조다.
이번에 처리할 그룹은 groups[${i}] "하나만"이다. 그 그룹의 bizLabel(사업)과 stanceLabel(우호/중립/비우호)을 확인하라.

작업:
1) 후보(candidates) 중 이 사업에 대해 해당 성향을 "가장 임팩트 있게" 대표하는 의원을 최대 5명 선정하라. 꼭 5명을 채우지 말고, 발언이 뚜렷하고 강한 인물 중심으로 5명 이내(적으면 그 이하)로 골라라. 발언이 빈약하거나 성향이 흐릿한 후보는 제외하라.
2) 선정한 각 의원마다, 그 사람이 이 사업에 대해 가진 생각·성향이 잘 드러나도록 statements를 근거로 "3줄 이내"로 요약하라. 그 사람의 성향을 보여주는 표현을 쓰거나 직접 말한 표현을 인용해도 좋다(예: 핵심 주장 한 문장 + 근거/뉘앙스). 없는 사실을 지어내지 마라.
picks에 {id, summary}를 임팩트 높은 순서로 담아 반환하라. biz/stance 필드에는 그 그룹의 biz, stance 값을 그대로 넣어라.`
}
phase('Pick')
const out = await parallel(Array.from({ length: N }, (_, i) => () =>
  agent(prompt(i), { label: 'board:g' + i, phase: 'Pick', schema: SCHEMA, effort: 'low' })
))
const results = out.filter(Boolean)
log(`선정·요약 완료: 그룹 ${results.length}/${N}`)
return { n: N, ok: results.length, results }
