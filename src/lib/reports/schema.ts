import { z } from "zod";
import { Platform, ReportType } from "@prisma/client";

/**
 * Report.config / Report.summary JSON shapes. Parsing is lenient (defaults fill gaps) so reports
 * created by older versions or the demo seed keep rendering.
 */

export const REPORT_TYPES = Object.values(ReportType);

export const REPORT_KPIS = [
  "spend",
  "revenue",
  "roas",
  "roi",
  "leads",
  "purchases",
  "cpl",
  "cpa",
  "cvr",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "impressions",
  "frequency",
  "clicks",
  "videoViews",
  "engagementRate",
] as const;
export type ReportKpi = (typeof REPORT_KPIS)[number];

export const REPORT_CHARTS = ["trend", "platformShare", "platformTable", "campaignTable", "organic", "budget"] as const;
export type ReportChart = (typeof REPORT_CHARTS)[number];

/** Sensible defaults per report type (the builder pre-selects these). */
export const TYPE_DEFAULTS: Record<ReportType, { kpis: ReportKpi[]; charts: ReportChart[] }> = {
  DAILY: { kpis: ["spend", "leads", "cpl", "ctr", "roas"], charts: ["trend", "platformTable"] },
  WEEKLY: { kpis: ["spend", "revenue", "roas", "leads", "cpl", "ctr"], charts: ["trend", "platformTable", "campaignTable"] },
  MONTHLY_CLIENT: { kpis: ["spend", "revenue", "roas", "leads", "cpl", "ctr", "reach"], charts: ["trend", "platformShare", "platformTable", "campaignTable", "organic", "budget"] },
  EXECUTIVE: { kpis: ["spend", "revenue", "roas", "roi", "leads", "cpl"], charts: ["trend", "platformShare", "budget"] },
  CAMPAIGN: { kpis: ["spend", "impressions", "clicks", "ctr", "cpc", "leads", "cpl", "roas", "frequency"], charts: ["trend", "campaignTable"] },
  CONTENT: { kpis: ["reach", "impressions", "engagementRate", "videoViews"], charts: ["organic", "trend"] },
  COMPETITOR: { kpis: ["spend", "ctr", "cpm"], charts: ["platformTable"] },
  BUDGET: { kpis: ["spend", "revenue", "roas", "cpl", "cpa"], charts: ["budget", "platformShare", "platformTable"] },
  ANNUAL: { kpis: ["spend", "revenue", "roas", "roi", "leads", "purchases", "cpl", "reach"], charts: ["trend", "platformShare", "platformTable", "campaignTable", "organic", "budget"] },
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const reportThemeSchema = z.object({
  logoUrl: z.string().url().max(500).optional().or(z.literal("")),
  primary: hex.optional(),
  accent: hex.optional(),
  /** Hide the agency name on the public/printed report (client branding only). */
  whiteLabel: z.boolean().default(false),
});

export const reportConfigSchema = z.object({
  platforms: z.array(z.enum(Platform)).default([]),
  kpis: z.array(z.enum(REPORT_KPIS)).default(["spend", "revenue", "roas", "leads", "cpl", "ctr"]),
  charts: z.array(z.enum(REPORT_CHARTS)).default(["trend", "platformShare", "platformTable", "campaignTable"]),
  compare: z.enum(["prev", "yoy", "none"]).default("prev"),
  /** Scheduled sends recompute the period (yesterday / last 7 days / previous month). */
  rolling: z.boolean().default(true),
  theme: reportThemeSchema.default({ whiteLabel: false }),
  /** Hashes of the last scheduled-delivery links (public read-only), newest first. */
  delivery: z.array(z.object({ h: z.string(), exp: z.string() })).default([]),
  deliveryHashes: z.array(z.string()).default([]),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

const lines = z.array(z.string().trim().min(1).max(500)).max(30).default([]);

export const reportSummarySchema = z.object({
  executive: z.string().max(5000).default(""),
  wins: lines,
  challenges: lines,
  learnings: lines,
  recommendations: lines,
  comments: z.string().max(5000).default(""),
  nextActions: z.array(z.object({ title: z.string(), ownerName: z.string().optional(), dueDate: z.string().optional(), taskId: z.string().optional() })).default([]),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export function readConfig(raw: unknown): ReportConfig {
  const r = reportConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : reportConfigSchema.parse({});
}

export function readSummary(raw: unknown): ReportSummary {
  const r = reportSummarySchema.safeParse(raw ?? {});
  return r.success ? r.data : reportSummarySchema.parse({});
}

/** Textarea → list: one item per line, blanks dropped. */
export function toLines(s: string | undefined | null): string[] {
  return (s ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 30);
}
