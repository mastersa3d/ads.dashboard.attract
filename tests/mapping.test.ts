import { describe, expect, it } from "vitest";
import { backfillFollowers, graphMetricsByDay, mapGa4, mapGoogleAds, mapLinkedIn, mapMetaInsights, mapYoutube, metaObjective } from "@/lib/integrations/mapping";

describe("Meta insights mapping", () => {
  const rows = mapMetaInsights("act_1", "EGP", [
    {
      date_start: "2026-09-01",
      campaign_id: "c1",
      campaign_name: "Retargeting",
      objective: "OUTCOME_SALES",
      account_currency: "EGP",
      spend: "1234.567",
      impressions: "10000",
      reach: "8000",
      clicks: "150",
      actions: [
        { action_type: "omni_purchase", value: "7" },
        { action_type: "purchase", value: "7" }, // same conversions, must not double count
        { action_type: "lead", value: "3" },
        { action_type: "video_view", value: "500" },
        { action_type: "post_engagement", value: "900" },
      ],
      action_values: [{ action_type: "omni_purchase", value: "21000.5" }],
      video_p100_watched_actions: [{ action_type: "video_view", value: "40" }],
    },
  ]);
  it("maps fields without double counting conversions", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-09-01", spend: 1234.57, impressions: 10000, reach: 8000, clicks: 150, purchases: 7, leads: 3, revenue: 21000.5, videoViews: 500, videoCompletions: 40, engagements: 900 });
    expect(rows[0].campaign).toEqual({ externalId: "c1", name: "Retargeting", objective: "SALES" });
  });
  it("maps legacy and ODAX objectives", () => {
    expect(metaObjective("LEAD_GENERATION")).toBe("LEADS");
    expect(metaObjective("OUTCOME_AWARENESS")).toBe("AWARENESS");
    expect(metaObjective("UNKNOWN")).toBeUndefined();
  });
  it("buckets page insights by the day before end_time", () => {
    const m = graphMetricsByDay([{ name: "page_impressions", values: [{ value: 10, end_time: "2026-09-02T07:00:00+0000" }] }]);
    expect(m.get("2026-09-01")).toEqual({ page_impressions: 10 });
  });
});

describe("Google Ads mapping", () => {
  it("converts micros, splits conversions by value and leaves reach at 0", () => {
    const rows = mapGoogleAds("123", "AED", [
      {
        results: [
          { campaign: { id: "9", name: "Search", status: "ENABLED", advertisingChannelType: "SEARCH" }, customer: { currencyCode: "AED" }, segments: { date: "2026-09-01" }, metrics: { costMicros: "12500000", impressions: "1000", clicks: "50", conversions: 4.6, conversionsValue: 900 } },
          { campaign: { id: "10", name: "Leads", status: "PAUSED", advertisingChannelType: "DISPLAY" }, segments: { date: "2026-09-01" }, metrics: { costMicros: 1000000, conversions: 2, conversionsValue: 0 } },
        ],
      },
    ]);
    expect(rows[0]).toMatchObject({ spend: 12.5, impressions: 1000, clicks: 50, purchases: 5, leads: 0, revenue: 900, reach: 0, currency: "AED" });
    expect(rows[0].campaign).toMatchObject({ status: "ACTIVE", objective: "SALES" });
    expect(rows[1]).toMatchObject({ spend: 1, leads: 2, purchases: 0, currency: "AED" });
    expect(rows[1].campaign?.status).toBe("PAUSED");
  });
});

describe("GA4 / YouTube / LinkedIn mapping", () => {
  it("maps GA4 runReport rows by header name", () => {
    const rows = mapGa4("p1", {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "totalUsers" }, { name: "screenPageViews" }, { name: "engagedSessions" }, { name: "sessions" }],
      rows: [{ dimensionValues: [{ value: "20260901" }], metricValues: [{ value: "120" }, { value: "400" }, { value: "80" }, { value: "150" }] }],
    });
    expect(rows[0]).toEqual({ accountExternalId: "p1", date: "2026-09-01", followers: 0, posts: 0, reach: 120, impressions: 400, engagements: 80, videoViews: 0 });
  });
  it("backfills followers exactly from net daily changes", () => {
    const f = backfillFollowers(["2026-09-01", "2026-09-02", "2026-09-03"], 1000, new Map([["2026-09-02", 10], ["2026-09-03", -5]]));
    expect(f.get("2026-09-03")).toBe(1000);
    expect(f.get("2026-09-02")).toBe(1005);
    expect(f.get("2026-09-01")).toBe(995);
  });
  it("maps YouTube day reports", () => {
    const rows = mapYoutube("UC1", { columnHeaders: ["day", "views", "likes", "comments", "shares", "subscribersGained", "subscribersLost"].map((name) => ({ name })), rows: [["2026-09-01", 100, 5, 2, 1, 3, 1]] }, 500);
    expect(rows[0]).toMatchObject({ date: "2026-09-01", videoViews: 100, engagements: 8, followers: 500 });
  });
  it("maps LinkedIn analytics with campaign names", () => {
    const rows = mapLinkedIn("55", "USD", [{ dateRange: { start: { year: 2026, month: 9, day: 3 } }, pivotValues: ["urn:li:sponsoredCampaign:77"], costInLocalCurrency: "20.5", impressions: 900, clicks: 9, oneClickLeads: 2 }], new Map([["77", "B2B leads"]]));
    expect(rows[0]).toMatchObject({ date: "2026-09-03", spend: 20.5, leads: 2, campaign: { externalId: "77", name: "B2B leads" } });
  });
});
