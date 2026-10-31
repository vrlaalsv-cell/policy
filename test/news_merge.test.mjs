// 기사 재수집 병합(lib/news_merge.mjs) — 5_collect_news.mjs 가 쓴다
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeNews, buildCarry, applyCarry, isGoogleNewsUrl } from "../pipeline/lib/news_merge.mjs";

const art = (title, extra = {}) => ({ title, link: "https://news.google.com/rss/articles/X", ...extra });

test("조회 실패한 의원의 기존 기사는 남는다", () => {
  const prev = { M001: [art("가")], M002: [art("나")] };
  const out = mergeNews(prev, { M001: [art("다")] }, ["M001"]);   // M002 는 조회 실패
  assert.deepEqual(out.M002, [art("나")]);
  assert.equal(out.M001[0].title, "다");
});

test("조회는 성공했는데 0건이면 지운다", () => {
  const out = mergeNews({ M001: [art("가")] }, {}, ["M001"]);
  assert.equal(out.M001, undefined);
});

test("발췌는 제목이 같으면 물려주되, 원문 복원 실패(Google 주소)분은 안 물려준다", () => {
  const prev = { M001: [
    art("원전 수출 확대", { excerpt: "진짜 발췌", url: "https://www.example.co.kr/a/1", hl: "원전" }),
    art("수소 버스 도입", { excerpt: "Google 뉴스가 전세계 매체로부터 종합한 최신 뉴스", url: "https://news.google.com/rss/articles/Y" }),
  ] };
  const now = { M001: [art("원전 수출 확대!"), art("수소 버스 도입")] };
  const n = applyCarry(now, buildCarry(prev));
  assert.equal(n, 1);
  assert.equal(now.M001[0].excerpt, "진짜 발췌");
  assert.equal(now.M001[0].url, "https://www.example.co.kr/a/1");
  assert.equal(now.M001[1].excerpt, undefined);
});

test("isGoogleNewsUrl", () => {
  assert.equal(isGoogleNewsUrl("https://news.google.com/rss/articles/abc"), true);
  assert.equal(isGoogleNewsUrl("https://www.hani.co.kr/news.google.com"), false);
  assert.equal(isGoogleNewsUrl(undefined), false);
});
