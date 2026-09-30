import { describe, expect, it } from "vitest";
import { formatSchedule, isDue, lastOccurrence, nextOccurrence, parseSchedule, rollingPeriod, zonedToUtc } from "@/lib/reports/schedule";
import { readConfig, readSummary, toLines } from "@/lib/reports/schema";
import { isLinkValid, newShareToken } from "@/lib/reports/share";
import { retryDelayMs } from "@/lib/jobs/queue";
import { sha256 } from "@/lib/crypto";

describe("schedule parsing", () => {
  it("parses and formats the three frequencies", () => {
    expect(parseSchedule("weekly:mon:09:00")).toEqual({ freq: "weekly", day: 1, hour: 9, minute: 0 });
    expect(parseSchedule("monthly:1:09:30")).toEqual({ freq: "monthly", day: 1, hour: 9, minute: 30 });
    expect(parseSchedule("daily:07:05")).toEqual({ freq: "daily", day: 0, hour: 7, minute: 5 });
    expect(formatSchedule({ freq: "weekly", day: 0, hour: 8, minute: 0 })).toBe("weekly:sun:08:00");
  });
  it("rejects invalid schedules", () => {
    for (const s of ["", "hourly:10", "weekly:xyz:09:00", "monthly:31:09:00", "daily:25:00", null]) expect(parseSchedule(s)).toBeNull();
  });
});

describe("timezone-aware occurrences", () => {
  it("converts wall-clock time in a zone to UTC", () => {
    expect(zonedToUtc(2026, 9, 30, 9, 0, "Asia/Dubai").toISOString()).toBe("2026-09-30T05:00:00.000Z");
    expect(zonedToUtc(2026, 1, 15, 9, 0, "UTC").toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });
  it("finds last and next weekly occurrences", () => {
    const now = new Date("2026-09-30T12:00:00Z"); // Wednesday
    expect(lastOccurrence("weekly:mon:09:00", now, "UTC")?.toISOString()).toBe("2026-09-28T09:00:00.000Z");
    expect(nextOccurrence("weekly:mon:09:00", now, "UTC")?.toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(nextOccurrence("daily:09:00", now, "UTC")?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(lastOccurrence("monthly:1:09:00", now, "Asia/Dubai")?.toISOString()).toBe("2026-09-01T05:00:00.000Z");
  });
  it("handles month rollover for monthly schedules", () => {
    const now = new Date("2026-01-01T00:30:00Z");
    expect(lastOccurrence("monthly:1:09:00", now, "UTC")?.toISOString()).toBe("2025-12-01T09:00:00.000Z");
  });
  it("is due once per occurrence, never before creation", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    const created = new Date("2026-09-01T00:00:00Z");
    const occ = isDue("weekly:mon:09:00", null, created, now, "UTC");
    expect(occ?.toISOString()).toBe("2026-09-28T09:00:00.000Z");
    expect(isDue("weekly:mon:09:00", new Date("2026-09-28T09:01:00Z"), created, now, "UTC")).toBeNull();
    expect(isDue("weekly:mon:09:00", null, new Date("2026-09-29T00:00:00Z"), now, "UTC")).toBeNull();
  });
  it("rolls reporting periods", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    const iso = (p: { start: Date; end: Date }) => [p.start.toISOString().slice(0, 10), p.end.toISOString().slice(0, 10)];
    expect(iso(rollingPeriod("daily", now, "UTC"))).toEqual(["2026-09-29", "2026-09-29"]);
    expect(iso(rollingPeriod("weekly", now, "UTC"))).toEqual(["2026-09-23", "2026-09-29"]);
    expect(iso(rollingPeriod("monthly", now, "UTC"))).toEqual(["2026-08-01", "2026-08-31"]);
    expect(iso(rollingPeriod("monthly", new Date("2026-01-10T00:00:00Z"), "UTC"))).toEqual(["2025-12-01", "2025-12-31"]);
  });
});

describe("report config & share links", () => {
  it("fills defaults for legacy/seed configs", () => {
    const c = readConfig({ platforms: ["META"], kpis: ["spend", "roas"], compare: "prev" });
    expect(c.platforms).toEqual(["META"]);
    expect(c.charts.length).toBeGreaterThan(0);
    expect(c.theme.whiteLabel).toBe(false);
    expect(readConfig("garbage").kpis.length).toBeGreaterThan(0);
    expect(readSummary({ wins: ["a"] }).wins).toEqual(["a"]);
    expect(toLines("- one\n\n• two\n three ")).toEqual(["one", "two", "three"]);
  });
  it("stores only the hash of share tokens and honours expiry", () => {
    const { token, hash } = newShareToken();
    expect(hash).toBe(sha256(token));
    expect(hash).not.toContain(token);
    expect(isLinkValid(new Date(Date.now() + 1000))).toBe(true);
    expect(isLinkValid(new Date(Date.now() - 1000))).toBe(false);
    expect(isLinkValid(null)).toBe(false);
  });
});

describe("job retry backoff", () => {
  it("grows exponentially and is capped", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(480_000);
    expect(retryDelayMs(20)).toBe(6 * 3600_000);
  });
});
