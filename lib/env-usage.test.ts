import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_USAGE,
  accumulateUsage,
  computeUsage,
  effectiveTokens,
  isZeroUsage,
} from "./env-usage";

test("computeUsage: 1000 effective tokens = 0.3 Wh and 0.5 mL", () => {
  const u = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const r = computeUsage(u);
  assert.equal(r.energyWh, 0.3);
  assert.equal(r.waterMl, 0.5);
});

test("computeUsage: cache-read counts at 10% weight", () => {
  const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10_000, cacheCreationTokens: 0 };
  assert.equal(effectiveTokens(u), 1000);
  const r = computeUsage(u);
  assert.equal(r.energyWh, 0.3);
});

test("computeUsage: cache-creation counts at full weight", () => {
  const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 1000 };
  const r = computeUsage(u);
  assert.equal(r.energyWh, 0.3);
});

test("computeUsage: zero usage returns zero", () => {
  const r = computeUsage(EMPTY_USAGE);
  assert.equal(r.energyWh, 0);
  assert.equal(r.waterMl, 0);
});

test("accumulateUsage: sums all four fields independently", () => {
  const a = { inputTokens: 100, outputTokens: 200, cacheReadTokens: 300, cacheCreationTokens: 400 };
  const b = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 };
  const sum = accumulateUsage(a, b);
  assert.deepEqual(sum, {
    inputTokens: 101,
    outputTokens: 202,
    cacheReadTokens: 303,
    cacheCreationTokens: 404,
  });
});

test("isZeroUsage: true for empty, false for any non-zero effective token", () => {
  assert.equal(isZeroUsage(EMPTY_USAGE), true);
  assert.equal(isZeroUsage({ ...EMPTY_USAGE, inputTokens: 1 }), false);
  assert.equal(isZeroUsage({ ...EMPTY_USAGE, cacheReadTokens: 1 }), false);
});
