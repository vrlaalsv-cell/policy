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
const A = typeof args === 'string' ? JSON.parse(args) : args
const FILE = A.file, N = A.n;
function prompt(i) {
  // ⚡ 프롬프트 캐싱 — 변하는 부분(그룹 인덱스)은 맨 뒤. 자세한 이유는 wf_cabinet.js 주석 참고.
  return `너는 SK E&S(에너지 기업)의 정책 애널리스트다.
입력 파일은 { groups:[{ biz, bizLabel, stance, stanceLabel, candidates:[{id,name,party,count,statements[]}] }] } 구조다.
지정된 그룹 "하나만" 처리한다. 그 그룹의 bizLabel(사업)과 stanceLabel(우호/중립/비우호)을 먼저 확인하라.

작업:
1) 후보(candidates) 중 이 사업에 대해 해당 성향을 "가장 임팩트 있게" 대표하는 의원을 최대 5명 선정하라. 꼭 5명을 채우지 말고, 발언이 뚜렷하고 강한 인물 중심으로 5명 이내(적으면 그 이하)로 골라라. 발언이 빈약하거나 성향이 흐릿한 후보는 제외하라.
2) 선정한 각 의원마다, 그 사람이 이 사업에 대해 가진 생각·성향이 잘 드러나도록 statements를 근거로 "3줄 이내"로 요약하라. 그 사람의 성향을 보여주는 표현을 쓰거나 직접 말한 표현을 인용해도 좋다(예: 핵심 주장 한 문장 + 근거/뉘앙스). 없는 사실을 지어내지 마라.
picks에 {id, summary}를 임팩트 높은 순서로 담아 반환하라. biz/stance 필드에는 그 그룹의 biz, stance 값을 그대로 넣어라.

── 처리 대상 (이 줄 위까지는 모든 그룹에 공통이다) ──
Read 도구로 아래 파일을 읽고, groups 배열의 **인덱스 ${i}번째 원소(groups[${i}]) 하나만** 처리하라.
다른 인덱스와 절대 혼동하지 마라 — 출력의 biz/stance 는 groups[${i}] 의 값이어야 한다.
${FILE}`
}
phase('Pick')
const out = await parallel(Array.from({ length: N }, (_, i) => () =>
  agent(prompt(i), { label: 'board:g' + i, phase: 'Pick', schema: SCHEMA, effort: 'low' })
))
const results = out.filter(Boolean)
log(`선정·요약 완료: 그룹 ${results.length}/${N}`)
return { n: N, ok: results.length, results }
