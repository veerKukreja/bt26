import type { SessionUsage } from "./types";

export const EMPTY_USAGE: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

const WH_PER_1K_TOKENS = 0.3;
const ML_PER_1K_TOKENS = 0.5;
const CACHE_READ_MULTIPLIER = 0.1;

export function effectiveTokens(u: SessionUsage): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheCreationTokens +
    CACHE_READ_MULTIPLIER * u.cacheReadTokens
  );
}

export function computeUsage(u: SessionUsage): { energyWh: number; waterMl: number } {
  const t = effectiveTokens(u);
  return {
    energyWh: (t * WH_PER_1K_TOKENS) / 1000,
    waterMl: (t * ML_PER_1K_TOKENS) / 1000,
  };
}

export function accumulateUsage(a: SessionUsage, b: SessionUsage): SessionUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

export function isZeroUsage(u: SessionUsage): boolean {
  return effectiveTokens(u) === 0;
}
