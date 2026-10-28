import { describe, expect, it } from "vite-plus/test";

import {
  ASSISTED_FEE_BPS,
  FEE_TIER_BPS,
  PLATFORM_FEE_BPS,
  formatCents,
  payoutCents,
  platformFeeCents,
} from "../src/shared/contracts.ts";

describe("platform fee math", () => {
  it("takes 15% in integer cents and rounds to the nearest cent", () => {
    expect(PLATFORM_FEE_BPS).toBe(1500);
    expect(platformFeeCents(10_000)).toBe(1500);
    expect(payoutCents(10_000)).toBe(8500);
    expect(platformFeeCents(12_345)).toBe(1852);
    expect(payoutCents(12_345)).toBe(10_493);
    expect(platformFeeCents(0)).toBe(0);
    expect(platformFeeCents(1)).toBe(0);
    expect(platformFeeCents(999)).toBe(150);
    expect(payoutCents(999)).toBe(849);
    expect(platformFeeCents(100_000_000)).toBe(15_000_000);
    expect(formatCents(12_345, "EUR")).toBe("€123.45");
  });

  it("charges 20% on the assisted tier and keeps the split exact", () => {
    expect(ASSISTED_FEE_BPS).toBe(2000);
    expect(FEE_TIER_BPS).toEqual({ standard: 1500, assisted: 2000 });
    expect(platformFeeCents(12_000, ASSISTED_FEE_BPS)).toBe(2400);
    expect(payoutCents(12_000, ASSISTED_FEE_BPS)).toBe(9600);
    const amounts = [1, 2, 7, 99, 101, 999, 12_345, 100_000_000];
    for (const amount of amounts) {
      const fee = platformFeeCents(amount, ASSISTED_FEE_BPS);
      expect(fee + payoutCents(amount, ASSISTED_FEE_BPS)).toBe(amount);
      expect(Math.abs(fee - amount * 0.2)).toBeLessThanOrEqual(0.5);
    }
  });

  it("always splits the amount into fee plus payout without losing a cent", () => {
    const amounts = [1, 2, 7, 99, 100, 101, 333, 999, 1000, 12_345, 50_000, 1_000_000, 99_999_999];
    for (const amount of amounts) {
      const fee = platformFeeCents(amount);
      const payout = payoutCents(amount);
      expect(fee + payout).toBe(amount);
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(payout).toBeGreaterThanOrEqual(0);
      // Rounded to nearest cent, so the fee never drifts more than 0.5c from 15%.
      expect(Math.abs(fee - amount * 0.15)).toBeLessThanOrEqual(0.5);
    }
  });
});
