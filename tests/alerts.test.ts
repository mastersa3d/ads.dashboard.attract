import { describe, expect, it } from "vitest";
import { budgetEnding, contentDue, efficiencyChanges, evaluateRules, frequency, integrationHealth, passes, reallocation, resolveDelivery, spendPacing, weekBucket, type ClientSnapshot } from "@/lib/alerts/rules";
import { forecastSpend } from "@/lib/metrics";

const now = new Date("2026-09-30T10:00:00Z");
const snap = (over: Partial<ClientSnapshot> = {}): ClientSnapshot => ({
  clientId: "c1",
  clientName: "Nile",
  currency: "EGP",
  plan: null,
  weeks: [],
  campaigns7d: [],
  campaigns14d: [],
  integrations: [],
  content: [],
  rejections: [],
  competitorAds: [],
  trends: [],
  ...over,
});

describe("spend & budget rules", () => {
  it("flags spend over plan and respects the default threshold", () => {
    const [c] = spendPacing(snap({ plan: { name: "Sept", budget: 30000, spent: 12000, expectedByNow: 10000, periodEnd: new Date("2026-10-31"), depletionDate: null } }), now);
    expect(c.type).toBe("SPEND_OVER");
    expect(c.value).toBeCloseTo(0.2);
    expect(passes(c, c.threshold)).toBe(true);
    expect(passes(c, 0.25)).toBe(false); // user threshold 25% → not alerted
  });
  it("flags spend under plan", () => {
    const [c] = spendPacing(snap({ plan: { name: "Sept", budget: 30000, spent: 7000, expectedByNow: 10000, periodEnd: new Date("2026-10-31"), depletionDate: null } }), now);
    expect(c.type).toBe("SPEND_UNDER");
    expect(c.value).toBeCloseTo(0.3);
  });
  it("warns when the budget runs out before period end (lte rule)", () => {
    const [c] = budgetEnding(snap({ plan: { name: "Sept", budget: 1, spent: 1, expectedByNow: 1, periodEnd: new Date("2026-10-31"), depletionDate: new Date("2026-10-03T10:00:00Z") } }), now);
    expect(c.value).toBe(3);
    expect(passes(c, 5)).toBe(true);
    expect(passes(c, 2)).toBe(false);
  });
});

describe("forecast (metrics.forecastSpend)", () => {
  it("projects month-end spend and depletion from the 7-day run-rate", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const daily = Array.from({ length: 20 }, (_, i) => ({ date: new Date(start.getTime() + i * 86_400_000), spend: 1000 }));
    const fc = forecastSpend({ dailySpend: daily, budget: 25_000, periodStart: start, periodEnd: new Date("2026-09-30T00:00:00Z"), asOf: new Date("2026-09-20T00:00:00Z") });
    expect(fc.spent).toBe(20_000);
    expect(fc.runRate).toBe(1000);
    expect(fc.projected).toBe(30_000);
    expect(fc.depletionDate?.toISOString().slice(0, 10)).toBe("2026-09-25");
  });
});

describe("efficiency rules", () => {
  it("detects CPL increase and ROAS drop week over week with minimum volume", () => {
    const out = efficiencyChanges(
      snap({ weeks: [{ platform: "ALL", current: { spend: 1500, leads: 10, purchases: 10, revenue: 3000 }, previous: { spend: 1000, leads: 10, purchases: 10, revenue: 4000 } }] }),
      now,
    );
    const cpl = out.find((c) => c.message.key === "CPL_UP")!;
    const roas = out.find((c) => c.type === "ROAS_DOWN")!;
    expect(cpl.value).toBeCloseTo(0.5);
    expect(roas.value).toBeCloseTo(0.5); // 4x → 2x
    expect(cpl.dedupeKey).toContain(weekBucket(now));
  });
  it("ignores noise below the minimum conversions", () => {
    expect(efficiencyChanges(snap({ weeks: [{ platform: "META", current: { spend: 500, leads: 2, purchases: 0, revenue: 0 }, previous: { spend: 100, leads: 2, purchases: 0, revenue: 0 } }] }), now)).toEqual([]);
  });
  it("computes frequency and reallocation suggestions", () => {
    const [f] = frequency(snap({ campaigns7d: [{ id: "k", name: "Promo", platform: "META", impressions: 40_000, reach: 10_000, spend: 100 }] }), now);
    expect(f.value).toBe(4);
    expect(passes(f, 3.5)).toBe(true);
    const [r] = reallocation(
      snap({
        campaigns14d: [
          { id: "a", name: "Best", platform: "META", spend: 1000, leads: 0, purchases: 5, revenue: 6000 },
          { id: "b", name: "Worst", platform: "META", spend: 1000, leads: 0, purchases: 1, revenue: 1000 },
        ],
      }),
      now,
    );
    expect(r.value).toBe(6);
    expect(r.message.vars).toMatchObject({ best: "Best", worst: "Worst" });
    expect(r.severity).toBe("INFO");
  });
});

describe("integration & content rules", () => {
  const integ = { id: "i1", label: "Meta", platform: "META" as const, status: "CONNECTED" as const, enabled: true, hasCredentials: true, missing: [] as string[] };
  it("raises token expiry, missing permission and sync stopped", () => {
    const out = integrationHealth(
      snap({ integrations: [{ ...integ, lastSuccessAt: new Date("2026-09-28T10:00:00Z"), tokenExpiresAt: new Date("2026-10-03T10:00:00Z"), missing: ["read_insights"] }] }),
      now,
    );
    expect(out.find((c) => c.type === "TOKEN_EXPIRING")?.value).toBe(3);
    expect(out.find((c) => c.type === "PERMISSION_MISSING")?.message.vars.scopes).toBe("read_insights");
    const sync = out.find((c) => c.type === "SYNC_STOPPED")!;
    expect(sync.value).toBe(48);
    expect(passes(sync, 24)).toBe(true);
  });
  it("uses the TOKEN_EXPIRED message once the token is past expiry", () => {
    const [c] = integrationHealth(snap({ integrations: [{ ...integ, status: "EXPIRED", lastSuccessAt: null, tokenExpiresAt: new Date("2026-09-20T00:00:00Z") }] }), now);
    expect(c.message.key).toBe("TOKEN_EXPIRED");
    expect(c.severity).toBe("CRITICAL");
  });
  it("targets client users only for client-review deadlines", () => {
    const out = contentDue(
      snap({
        content: [
          { id: "x", title: "Reel", status: "CLIENT_REVIEW", approvalDeadline: new Date("2026-10-01T10:00:00Z"), publishAt: null },
          { id: "y", title: "Post", status: "IN_PRODUCTION", approvalDeadline: null, publishAt: new Date("2026-09-30T20:00:00Z") },
        ],
      }),
      now,
    );
    expect(out.find((c) => c.message.key === "CONTENT_REVIEW_DUE")?.audience).toBe("client");
    expect(out.find((c) => c.message.key === "CONTENT_PUBLISH_SOON")).toMatchObject({ audience: "team", value: 10 });
  });
  it("evaluates all rules together", () => {
    expect(evaluateRules(snap({ trends: [{ id: "t", keyword: "sofa", growthPct: 1.2, sourceName: "Google Trends (CSV)" }] }), now)).toHaveLength(1);
  });
});

describe("notification preferences", () => {
  const cand = frequency(snap({ campaigns7d: [{ id: "k", name: "Promo", platform: "META", impressions: 40_000, reach: 10_000, spend: 100 }] }), now)[0];
  it("defaults to in-app, e-mail only for critical", () => {
    expect(resolveDelivery(cand, [])).toEqual({ inApp: true, email: false });
  });
  it("applies client-specific thresholds over global ones", () => {
    const prefs = [
      { type: "FREQUENCY", clientId: null, platform: null, inApp: true, email: true, threshold: 3 },
      { type: "FREQUENCY", clientId: "c1", platform: null, inApp: true, email: false, threshold: 5 },
    ];
    expect(resolveDelivery(cand, prefs)).toBeNull(); // 4 < 5 for this client
    expect(resolveDelivery({ ...cand, clientId: "other" }, prefs)).toEqual({ inApp: true, email: true });
  });
  it("honours platform scope and fully muted preferences", () => {
    expect(resolveDelivery(cand, [{ type: "FREQUENCY", clientId: null, platform: "TIKTOK", inApp: true, email: false, threshold: null }])).toBeNull();
    expect(resolveDelivery(cand, [{ type: "FREQUENCY", clientId: null, platform: null, inApp: false, email: false, threshold: null }])).toBeNull();
  });
});
