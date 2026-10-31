// 기사 재수집 결과를 기존 news.json 에 합치는 규칙 — 5_collect_news.mjs 가 쓴다(시험: test/news_merge.test.mjs).

export const titleKey = (t) => String(t || "").replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 40);

/** 원문 복원에 실패해 아직 Google 뉴스 중간 페이지를 가리키는 주소인가 */
export function isGoogleNewsUrl(u) {
  try { return /(^|\.)news\.google\.com$/i.test(new URL(String(u)).hostname); } catch { return false; }
}

/**
 * 이미 받아 둔 발췌·원문링크를 제목 기준으로 물려줄 표.
 * 🔴 원문 복원에 실패한 기사(url 이 news.google.com)는 물려주지 않는다 — 그 발췌는 기사 내용이 아니라
 *   Google 뉴스 안내 문구("Google 뉴스가 전세계 매체로부터…")라, 물려주면 영영 그 문구로 남는다
 *   (2026-11-01 전수감사: NAS 504건 중 8건). 안 물려주면 6단계가 다시 복원을 시도한다.
 */
export function buildCarry(prev) {
  const carry = {};
  for (const list of Object.values(prev || {})) {
    for (const a of list || []) {
      if (!a || !a.excerpt || isGoogleNewsUrl(a.url)) continue;
      carry[titleKey(a.title)] = { excerpt: a.excerpt, hl: a.hl, url: a.url };
    }
  }
  return carry;
}

/** byMember 의 기사에 carry 를 붙인다. 붙인 건수를 돌려준다. */
export function applyCarry(byMember, carry) {
  let n = 0;
  for (const list of Object.values(byMember)) {
    for (const a of list) {
      const c = carry[titleKey(a.title)];
      if (c) { a.excerpt = c.excerpt; if (c.hl) a.hl = c.hl; if (c.url) a.url = c.url; n++; }
    }
  }
  return n;
}

/**
 * 이번에 **조회에 성공한** 의원만 결과로 교체한다(성공했는데 0건이면 제거).
 * 🔴 조회 실패한 의원은 기존 기사를 그대로 둔다 — 예전엔 대상 전원을 지워서, 일시 오류 한 번에
 *   그 의원 기사가 사라졌다(2026-11-01 전수감사).
 */
export function mergeNews(prev, byMember, okIds) {
  const out = { ...(prev || {}) };
  for (const id of okIds) delete out[id];
  return { ...out, ...byMember };
}
