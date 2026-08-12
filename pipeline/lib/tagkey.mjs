// 발언 1건을 가리키는 **위치와 무관한 안정 키**.
//
// 왜 필요한가 — 예전에는 판정 결과를 배치 안 순번(id)으로만 가리켰다. 그래서
//   ① 수집이 한 건이라도 늘면 뒤쪽 순번이 통째로 밀려 **엉뚱한 발언에 판정이 붙을** 위험이 있었고
//      (`build_assembly_speeches.mjs` 가 필터를 똑같이 재현해야만 맞는 구조라 늘 조심해야 했다),
//   ② "이미 판정한 것"을 알 방법이 없어 증분 갱신 때마다 **기각분까지 전부 다시 AI 에 보냈다**
//      (2026-08-12 실측: 12,891건 중 기각 7,764건 — 증분 한 번에 이만큼이 그대로 낭비).
// 내용 기반 키를 쓰면 순서가 바뀌든 위원회를 나눠 돌리든 판정을 그대로 재사용할 수 있다.
//
// 키 구성: 회의번호 | 발언순번 | 발언자 | 본문 앞 60자(공백 제거)
//   - conferNum+seq 만으로도 대개 유일하지만, 같은 회의에서 순번이 재사용되는 행이 있어 본문을 덧댄다.
//   - 본문은 공백을 지워 비교한다 — 회의록 조판에 따라 띄어쓰기가 흔들린다(청와대 쪽에서 실제로 겪음).
export function tagKey(s) {
  const norm = String(s?.text || "").replace(/\s+/g, "").slice(0, 60);
  return [s?.conferNum ?? "", s?.seq ?? "", s?.name ?? "", norm].join("|");
}

/** 판정 배열 → key 로 찾는 Map. key 가 없는 옛 판정은 speeches 순번으로 키를 채워 넣는다(1회 마이그레이션). */
export function judgedIndex(judgments, speeches) {
  const idx = new Map();
  for (const j of judgments || []) {
    let k = j.key;
    if (!k && Number.isInteger(j.id) && speeches && speeches[j.id]) k = tagKey(speeches[j.id]);
    if (k) idx.set(k, j);
  }
  return idx;
}
