// 인물 총평 생성 + **근거 기반 적대 검증** + 탈락분 재생성.  (2026-08-27 신설)
//
//   node pipeline/build_ai_input.mjs --missing --batch=8     ← 남은 사람만 배치로
//   Workflow({ scriptPath: 'pipeline/wf_ai_verified.js', args: { dir, asm, cab } })
//   node pipeline/collect_ai.mjs <워크플로결과.json>          ← 증분 병합
//   node pipeline/build_ai.mjs                                ← web/*.js 에 반영
//
// 🔴 `wf_ai.js` 와 뭐가 다른가 — **검증 단계가 있다.** wf_ai.js 는 생성만 하고 그대로 믿는다.
//   발언이 1~2건뿐인 인물(청와대 차관급·기사만 있는 의원)은 AI 가 근거 없이 부풀리기 쉬운데,
//   2026-08-27 실측에서 23명 중 **2명이 실제로 탈락**했다:
//     · 기사 제목엔 "에너지고속도로 지중화"뿐인데 "재생에너지 송전망"·"주민 수용성"까지
//       외부 지식을 끌어와 "추진에 적극"이라 단정 (입력 stances 는 8사업 전부 자료없음)
//     · stances 가 원전:자료없음인데 "원전에 강한 우호"라 단정하고, 근거가 기사 제목 3건뿐인데도
//       판단 근거가 제한적이라는 취지를 안 밝힘
//   검증 없이 넣었으면 **틀린 분석이 그대로 화면에 실렸다.** 근거가 얇은 인물을 돌릴 땐 이쪽을 쓸 것.
export const meta = {
  name: 'cabinet-ai-summary-verified',
  description: '총평이 없는 청와대·국회 인물의 AI 종합분석 생성 + 근거 기반 적대 검증 + 탈락분 재생성',
  phases: [
    { title: 'Summarize', detail: '배치별 인물 총평 생성 (3배치)' },
    { title: 'Verify', detail: '총평이 입력 근거에만 기반하는지 적대 검증' },
    { title: 'Redo', detail: '검증 탈락 인물만 근거 엄격 모드로 재생성' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args // { dir, asm, cab }

const files = []
for (let i = 0; i < A.asm; i++) files.push({ file: A.dir + '\\asm_b' + i + '.json', label: 'asm_b' + i })
for (let i = 0; i < A.cab; i++) files.push({ file: A.dir + '\\cab_b' + i + '.json', label: 'cab_b' + i })

const SUM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { key: { type: 'string' }, headline: { type: 'string' }, analysis: { type: 'string' } },
        required: ['key', 'headline', 'analysis'],
      },
    },
  },
  required: ['results'],
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          key: { type: 'string' },
          grounded: { type: 'boolean' },
          problem: { type: 'string' },
        },
        required: ['key', 'grounded', 'problem'],
      },
    },
  },
  required: ['verdicts'],
}

// ⚡ 프롬프트 캐싱 — 변하는 부분(파일 경로·생성물)은 **반드시 맨 뒤**. 앞쪽에 끼면 그 뒤 전부가
//   매번 새 토큰이 된다(C:\AI\CLAUDE.md §②). 지시문을 고칠 때 이 순서를 깨지 말 것.
const COMMON = `너는 SK E&S(LNG·전력·재생에너지·수소·도시가스·원전·에너지솔루션·분산에너지 사업을 하는 에너지 기업)의 정책 애널리스트다.
입력 파일은 { people:[{ key, name, party 또는 role, district?, stances(8사업 성향 요약), quotes(회의록 핵심 발언), news(최근 기사 제목·에너지라벨·날짜) }] } 형태다.

각 인물마다, 제공된 "발언 + 기사 + 사업별 성향"을 종합해 그 인물의 에너지 정책 성향을 분석하라. 결과는 다음 두 필드로:
- headline: 45자 이내 한 줄 총평. 예) "재생에너지 확대엔 적극적, 원전엔 비판적"
- analysis: 3~5문장. 어떤 사업(전력·LNG·재생E·수소·도시가스·원전·에너지솔루션·분산에너지)에 우호/중립/비우호인지와 그 근거(발언·기사)를 요약하고, SK E&S 사업에 주는 함의를 담아라.

엄격 규칙:
- 반드시 제공된 발언·기사·성향에만 근거하라. 없는 사실·수치·입장을 지어내지 마라.
- 발언과 기사가 적거나 한 사업에만 쏠려 있으면 "판단 근거가 제한적"임을 분석에 명시하라.
- 특정 정당이라는 이유로 성향을 단정하지 마라. 근거 텍스트가 우선이다.
- 중립적·분석적 어조. 과장 금지.
🔴 이 배치의 인물들은 대부분 **발언이 1~2건뿐**이다. 그 한두 건이 다루지 않은 사업에 대해서는
   성향을 추정하지 말고, 무엇을 근거로 무엇까지만 말할 수 있는지 분명히 하라.
   직위(장관·차관 등)에서 성향을 유추하는 것도 금지다 — 그건 근거가 아니라 통념이다.
모든 인물을 results 배열에 key를 그대로 넣어 반환하라.`

function sumPrompt(file) {
  return `${COMMON}

── 처리 대상 (이 줄 위까지는 모든 배치에 공통이다) ──
Read 도구로 아래 파일을 읽어 위 기준대로 처리하라:
${file}`
}

const VERIFY_COMMON = `너는 정책 분석 결과를 **반증하는** 검토자다. 생성된 인물 총평이 입력 근거를 넘어서지 않았는지 본다.

판정 기준 — 아래 중 하나라도 해당하면 grounded=false 다:
1. 입력 quotes/news 에 없는 사실·수치·법안명·사건을 총평이 언급한다.
2. 근거가 다루지 않은 사업에 대해 우호/비우호 성향을 단정한다.
   (입력의 stances 에 "자료없음"으로 돼 있는 사업을 단정하면 위반이다.)
3. 발언이 1~2건뿐인데 "판단 근거가 제한적"이라는 취지를 전혀 밝히지 않고 단정적으로 서술한다.
4. 직위·소속만으로 성향을 유추한다(예: "산업부 차관이므로 원전에 우호적일 것").
5. headline 이 analysis 내용과 어긋난다.

의심스러우면 **grounded=false 쪽으로 판정하라.** 통과시키는 것보다 한 번 더 보는 게 싸다.
problem 에는 위반 근거를 한 문장으로 구체적으로 적어라(어느 문장이 왜 근거를 넘었는지).
문제가 없으면 grounded=true, problem 은 빈 문자열.
입력에 있는 모든 인물의 key 를 verdicts 에 빠짐없이 넣어라.`

function verifyPrompt(file, results) {
  return `${VERIFY_COMMON}

── 검토 대상 (이 줄 위까지는 모든 배치에 공통이다) ──
먼저 Read 도구로 아래 **원본 입력 파일**을 읽어 각 인물의 실제 근거(quotes·news·stances)를 확인하라:
${file}

그다음 아래 **생성된 총평**을 그 근거와 대조해 판정하라:
${JSON.stringify(results)}`
}

// 🔴 agent() 가 reject 하면 parallel() 이 그 자리를 null 로 채운다 — .then() 만으론 못 잡고
//   뒤에서 null 역참조로 워크플로 전체가 죽는다(SKpolicy 2026-08-16 실사고). .catch() 로 방어.
const summarize = (f) =>
  agent(sumPrompt(f.file), { label: 'ai:' + f.label, phase: 'Summarize', schema: SUM_SCHEMA, effort: 'low' })
    .then((r) => ({ ...f, ok: !!r, results: (r && r.results) || [] }))
    .catch(() => ({ ...f, ok: false, results: [] }))

const verify = (b) => {
  if (!b.results.length) return Promise.resolve({ ...b, verdicts: [] })
  return agent(verifyPrompt(b.file, b.results), { label: 'verify:' + b.label, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'medium' })
    .then((r) => ({ ...b, verdicts: (r && r.verdicts) || [] }))
    .catch(() => ({ ...b, verdicts: [] }))
}

phase('Summarize')
// ⚡ 첫 배치는 혼자 보낸다 — 캐시 항목은 첫 응답이 와야 다른 요청이 읽을 수 있다(fan-out 함정).
const [head, ...tail] = files
const firstBatch = await summarize(head)
const firstVerified = await verify(firstBatch)
const restVerified = tail.length
  ? await parallel(tail.map((f) => () => summarize(f).then(verify)))
  : []

const batches = [firstVerified, ...restVerified].filter(Boolean)

const all = batches.flatMap((b) => b.results)
const verdictByKey = new Map()
for (const b of batches) for (const v of b.verdicts) verdictByKey.set(v.key, v)

const failed = all.filter((r) => { const v = verdictByKey.get(r.key); return v && v.grounded === false })
const unchecked = all.filter((r) => !verdictByKey.has(r.key))
log(`1차 생성 ${all.length}명 · 검증 통과 ${all.length - failed.length - unchecked.length} · 탈락 ${failed.length} · 미검증 ${unchecked.length}`)

// ── 탈락분 재생성 ────────────────────────────────────────────────────────────
phase('Redo')
let redone = []
if (failed.length) {
  const byFile = new Map()
  for (const r of failed) {
    const b = batches.find((x) => x.results.some((y) => y.key === r.key))
    if (!b) continue
    if (!byFile.has(b.file)) byFile.set(b.file, [])
    byFile.get(b.file).push({ key: r.key, problem: (verdictByKey.get(r.key) || {}).problem || '' })
  }
  const jobs = [...byFile.entries()]
  redone = (await parallel(jobs.map(([file, items], i) => () =>
    agent(`${COMMON}

🔴 아래 인물들은 1차 총평이 **근거를 넘어섰다는 지적**을 받았다. 지적을 반영해 다시 쓰라.
근거가 부족하면 부족하다고 쓰는 것이 정답이다 — 빈칸을 추측으로 채우지 마라.

── 처리 대상 (이 줄 위까지는 모든 재생성에 공통이다) ──
Read 도구로 아래 파일을 읽고, **지적된 인물만** 다시 분석해 results 로 반환하라:
${file}

지적 내용:
${JSON.stringify(items)}`,
      { label: 'redo:' + i, phase: 'Redo', schema: SUM_SCHEMA, effort: 'medium' })
      .then((r) => (r && r.results) || [])
      .catch(() => [])
  ))).filter(Boolean).flat()
  log(`재생성 ${redone.length}명`)
}

// 재생성분이 1차분을 덮어쓴다.
const merged = new Map(all.map((r) => [r.key, r]))
for (const r of redone) merged.set(r.key, r)
const results = [...merged.values()].filter((r) => r && r.key && r.analysis && String(r.analysis).trim())

log(`최종 ${results.length}명 (배치 ${batches.filter((b) => b.ok).length}/${files.length} 성공)`)
return {
  results,
  stats: {
    batches: files.length,
    okBatches: batches.filter((b) => b.ok).length,
    generated: all.length,
    failedVerify: failed.length,
    redone: redone.length,
    final: results.length,
    problems: failed.map((r) => ({ key: r.key, problem: (verdictByKey.get(r.key) || {}).problem || '' })),
  },
}
