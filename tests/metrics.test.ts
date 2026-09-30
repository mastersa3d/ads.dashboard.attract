import { describe, expect, it } from "vitest";
import { deriveKpis, EMPTY_TOTALS, forecastSpend, trendTone, variance, varianceTone } from "@/lib/metrics";
import { comparisonRange, parseFilters, metricWhere } from "@/lib/filters";
import { convert, DEFAULT_FX } from "@/lib/fx";

describe("KPI derivation", () => {
  it("derives ratios from additive totals and never divides by zero", () => {
    const k = deriveKpis({ ...EMPTY_TOTALS, spend: 1000, impressions: 100_000, reach: 40_000, clicks: 1500, leads: 20, revenue: 4000 });
    expect(k.ctr).toBeCloseTo(0.015);
    expect(k.cpm).toBeCloseTo(10);
    expect(k.cpl).toBeCloseTo(50);
    expect(k.roas).toBeCloseTo(4);
    expect(k.frequency).toBeCloseTo(2.5);
    expect(deriveKpis(EMPTY_TOTALS).cpl).toBeNull();
  });

  it("colours cost metrics inversely", () => {
    expect(trendTone("cpl", 0.2)).toBe("bad");
    expect(trendTone("roas", 0.2)).toBe("good");
    expect(trendTone("roas", 0.01)).toBe("neutral");
  });
});

describe("forecast & variance", () => {
  it("projects month-end spend and depletion date from run-rate", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const days = Array.from({ length: 10 }, (_, i) => ({ date: new Date(start.getTime() + i * 86400000), spend: 200 }));
    const f = forecastSpend({ dailySpend: days, budget: 3000, periodStart: start, periodEnd: new Date("2026-09-30T00:00:00Z"), asOf: new Date("2026-09-10T00:00:00Z") });
    expect(f.spent).toBe(2000);
    expect(f.runRate).toBe(200);
    expect(f.projected).toBe(2000 + 200 * 20);
    expect(f.depletionDate?.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("variance tone treats overspend as bad and under-delivery of results as bad", () => {
    expect(variance(100, 130).pct).toBeCloseTo(0.3);
    expect(varianceTone(0.3, "cost")).toBe("bad");
    expect(varianceTone(-0.3, "result")).toBe("bad");
    expect(varianceTone(0.3, "result")).toBe("good");
  });
});

describe("filters", () => {
  it("builds the previous equal-length period and YoY period", () => {
    const f = parseFilters({ from: "2026-09-01", to: "2026-09-30" });
    expect(comparisonRange(f)).toEqual({ from: new Date("2026-08-02T00:00:00Z"), to: new Date("2026-08-31T00:00:00Z") });
    const y = parseFilters({ from: "2026-09-01", to: "2026-09-30", compare: "yoy" });
    expect(comparisonRange(y)?.from.toISOString().slice(0, 10)).toBe("2025-09-01");
  });

  it("always keeps the tenant scope in metric queries", () => {
    const f = parseFilters({ client: "attacker-chosen", platform: "META" });
    const w = metricWhere(f, { clientId: { in: ["a", "b"] } });
    expect(w.clientId).toEqual({ in: ["a", "b"] });
  });
});

describe("FX", () => {
  it("converts through the base currency and leaves unknown currencies untouched", () => {
    expect(convert(48.5, "EGP", "USD", DEFAULT_FX)).toBeCloseTo(1);
    expect(convert(100, "XYZ", "USD", DEFAULT_FX)).toBe(100);
  });
});
