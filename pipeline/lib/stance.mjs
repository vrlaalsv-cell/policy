// 국회의원 사업별 성향 재집계 — build_assembly_speeches.mjs 가 쓴다(시험: test/stance.test.mjs).
//
// 🔴 2026-11-01 전수감사로 바꿈. 예전엔 "기존 판정 ≠ 이번 새 근거의 다수결 → neutral" 이라
//   한 번 neutral 이 되면 영원히 neutral 이고, favor 근거 10건이 있던 사업에 oppose 1건만 더해져도 neutral 이 됐다.
//   → 발언마다 stance 를 저장하고, 그 사업의 **전체 발언** 다수결로 다시 정한다.
//   옛 발언(stance 없음)은 그 사업의 기존 판정을 1표씩 낸 것으로 친다(옛 근거의 무게를 건수만큼 살림).

export const STANCES = ["favor", "neutral", "oppose"];

/** 집계표 → 성향. favor/oppose 중 많은 쪽, 같으면 neutral, 표가 없으면 null(=판정 안 바꿈). */
export function decide(c) {
  const f = c.favor || 0, o = c.oppose || 0, n = c.neutral || 0;
  if (f > o) return "favor";
  if (o > f) return "oppose";
  return f + o + n ? "neutral" : null;
}

/**
 * @param quotes   의원의 전체 발언 [{ biz, stance? }] — 새 발언에는 stance 가 붙어 있다
 * @param current  기존 성향 { 사업: favor|neutral|oppose|unknown }
 * @param bizList  사업 id 목록
 * @param touched  이번에 새 근거가 들어온 사업(Set) — 여기 없는 사업은 기존 판정을 그대로 둔다
 * @returns 새 성향 객체(current 를 고치지 않음)
 */
export function mergeStance(quotes, current, bizList, touched) {
  const out = { ...(current || {}) };
  for (const b of bizList) {
    if (!touched.has(b)) continue;
    const cur = out[b];
    const c = { favor: 0, neutral: 0, oppose: 0 };
    for (const q of quotes || []) {
      if (q.biz !== b) continue;
      const st = q.stance || (STANCES.includes(cur) ? cur : null);
      if (STANCES.includes(st)) c[st]++;
    }
    const next = decide(c);
    if (next) out[b] = next;
  }
  return out;
}
