// 기사 에너지원 라벨(lib/news_labels.mjs) — 전력(電力) 오탐 방지
import { test } from "node:test";
import assert from "node:assert/strict";
import { labelsOf, isMilitaryPower } from "../pipeline/lib/news_labels.mjs";

const hasPower = (t) => labelsOf(t).includes("POWER");

test("前歷(과거 경력)의 '전력' 은 전력 기사가 아니다 (2026-11-01 실제 실린 제목들)", () => {
  for (const t of [
    "여야 ‘외교 참사’ vs ‘과거 전력 책임’ 공방 격화",
    "국보법 전력 진성준, 국방위원장 논란",
    "'대북송금 유죄' 전력으로 누구에게 거짓말 운운하나",
    "문대림 ‘탈당 전력 25% 감점’ 논란",
    "탄핵 찬성 전력 소환",
    "吳 “함께하면 전력 몇 배, 보수통합 필요”",
    "반미 전력보다 한미 이상기류 탓?",
    "군공항 전력 재배치 논의",
  ]) assert.equal(hasPower(t), false, t);
});

test("진짜 전력(電力) 기사는 그대로 잡는다", () => {
  for (const t of [
    "이헌승 국회의원, '전력망 알박기' 문제에 \"계통용량 관리 강화해야\"",
    "한국전력 성과급 5년간 8,032억 원",
    "호남권 반도체 산업단지 전력공급 1단계 공사",
    "데이터센터 전력요금제 설계에 반영",
  ]) assert.equal(hasPower(t), true, t);
});

test("다른 라벨과 함께면 군사 문맥이어도 남긴다", () => {
  assert.equal(isMilitaryPower("국방부 태양광 발전", labelsOf("국방부 태양광 발전")), false);
  assert.equal(isMilitaryPower("국방부 전력 증강", ["POWER"]), true);
});
