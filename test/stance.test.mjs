// 성향 재집계(lib/stance.mjs) — build_assembly_speeches.mjs 가 쓴다
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStance, decide } from "../pipeline/lib/stance.mjs";

const BIZ = ["POWER", "LNG"];
const q = (biz, stance) => (stance ? { biz, stance } : { biz });

test("한 번 neutral 이어도 새 근거가 한쪽으로 쌓이면 바뀐다", () => {
  const quotes = [q("POWER", "favor"), q("POWER", "favor"), q("POWER", "favor")];
  assert.equal(mergeStance(quotes, { POWER: "neutral" }, BIZ, new Set(["POWER"])).POWER, "favor");
});

test("옛 발언(stance 없음)은 기존 판정 1표씩 — favor 10건에 oppose 1건이면 favor 유지", () => {
  const quotes = [...Array(10).fill(q("POWER")), q("POWER", "oppose")];
  assert.equal(mergeStance(quotes, { POWER: "favor" }, BIZ, new Set(["POWER"])).POWER, "favor");
});

test("새 근거 favor·oppose 동수면 neutral", () => {
  const quotes = [q("LNG", "favor"), q("LNG", "oppose")];
  assert.equal(mergeStance(quotes, {}, BIZ, new Set(["LNG"])).LNG, "neutral");
});

test("이번에 근거가 안 늘어난 사업은 그대로", () => {
  const quotes = [q("POWER", "oppose"), q("LNG", "oppose")];
  const out = mergeStance(quotes, { POWER: "favor", LNG: "favor" }, BIZ, new Set(["LNG"]));
  assert.equal(out.POWER, "favor");
  assert.equal(out.LNG, "oppose");
});

test("unknown 은 표가 아니다", () => {
  const quotes = [q("POWER"), q("POWER", "oppose")];
  assert.equal(mergeStance(quotes, { POWER: "unknown" }, BIZ, new Set(["POWER"])).POWER, "oppose");
});

test("decide — 표가 없으면 null", () => {
  assert.equal(decide({ favor: 0, neutral: 0, oppose: 0 }), null);
  assert.equal(decide({ neutral: 2 }), "neutral");
});
