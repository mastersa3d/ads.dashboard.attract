import type { AlertSeverity, IntegrationStatus, Platform } from "@prisma/client";

/**
 * Pure alert rules (unit-tested in tests/alerts.test.ts). The engine (engine.ts) loads a
 * per-client snapshot from the database, runs these rules, then applies each recipient's
 * NotificationPreference (threshold / channel / platform scope) and de-duplicates.
 *
 * Every candidate carries a measured `value` and a default `threshold`; the per-user threshold
 * (NotificationPreference.threshold) replaces the default at delivery time. Rules therefore emit
 * a candidate whenever a signal is *measurable* and `passes()` decides who is alerted.
 */

export const ALERT_TYPES = [
  "SPEND_OVER",
  "SPEND_UNDER",
  "CPL_UP",
  "ROAS_DOWN",
  "FREQUENCY",
  "BUDGET_ENDING",
  "SYNC_STOPPED",
  "TOKEN_EXPIRING",
  "PERMISSION_MISSING",
  "CONTENT_DUE",
  "CONTENT_REJECTED",
  "COMPETITOR_AD",
  "TREND",
  "REALLOCATION",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Default thresholds (unit in comments). Users override them in notification preferences. */
export const DEFAULT_THRESHOLDS: Record<AlertType, number> = {
  SPEND_OVER: 0.15, // pacing above plan, ratio
  SPEND_UNDER: 0.2, // pacing below plan, ratio
  CPL_UP: 0.2, // cost per lead / purchase increase week over week, ratio
  ROAS_DOWN: 0.2, // ROAS decrease week over week, ratio
  FREQUENCY: 3.5, // impressions / reach over 7 days
  BUDGET_ENDING: 5, // days until the budget runs out (before period end)
  SYNC_STOPPED: 24, // hours since last successful sync
  TOKEN_EXPIRING: 7, // days until the token expires
  PERMISSION_MISSING: 1, // missing scopes
  CONTENT_DUE: 48, // hours until approval deadline / publish time
  CONTENT_REJECTED: 1,
  COMPETITOR_AD: 1, // new ads
  TREND: 0.5, // growth ratio (+50%)
  REALLOCATION: 2, // efficiency ratio best vs worst campaign
};

/** "lte" rules alert when the value is at or BELOW the threshold (time left). */
const DIRECTION: Partial<Record<AlertType, "lte">> = { BUDGET_ENDING: "lte", TOKEN_EXPIRING: "lte", CONTENT_DUE: "lte" };

/** Minimum volume before cost/efficiency changes are considered signal rather than noise. */
export const MIN_CONVERSIONS = 5;

export type AlertCandidate = {
  type: AlertType;
  severity: AlertSeverity;
  clientId: string;
  platform?: Platform | null;
  value: number;
  threshold: number;
  /** Stable id of what the alert is about + time bucket — becomes Notification.dedupeKey. */
  dedupeKey: string;
  /** i18n key suffix + vars; rendered in each recipient's language by the engine. */
  message: { key: string; vars: Record<string, string | number> };
  link: string;
  /** "team" = agency roles only; "client" = also CLIENT users of that client. */
  audience: "team" | "client";
};

export function passes(c: Pick<AlertCandidate, "type" | "value">, threshold: number) {
  return DIRECTION[c.type] === "lte" ? c.value <= threshold : c.value >= threshold;
}

// ───────────────────────── snapshot ─────────────────────────

export type PeriodKpis = { spend: number; leads: number; purchases: number; revenue: number };
export type ClientSnapshot = {
  clientId: string;
  clientName: string;
  currency: string;
  plan?: { name: string; budget: number; spent: number; expectedByNow: number; periodEnd: Date; depletionDate: Date | null } | null;
  /** Last 7 complete days vs the 7 days before, overall ("ALL") and per platform. */
  weeks: { platform: Platform | "ALL"; current: PeriodKpis; previous: PeriodKpis }[];
  campaigns7d: { id: string; name: string; platform: Platform; impressions: number; reach: number; spend: number }[];
  campaigns14d: { id: string; name: string; platform: Platform; spend: number; leads: number; purchases: number; revenue: number }[];
  integrations: { id: string; label: string; platform: Platform; status: IntegrationStatus; enabled: boolean; hasCredentials: boolean; lastSuccessAt: Date | null; tokenExpiresAt: Date | null; missing: string[] }[];
  content: { id: string; title: string; status: string; approvalDeadline: Date | null; publishAt: Date | null }[];
  rejections: { approvalId: string; contentId: string; title: string; comment: string | null }[];
  competitorAds: { competitorId: string; competitorName: string; adIds: string[] }[];
  trends: { id: string; keyword: string; growthPct: number; sourceName: string }[];
};

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
/** ISO-week-ish bucket (UTC Monday) so weekly alerts fire at most once per week. */
export function weekBucket(d: Date) {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
  return day(m);
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ───────────────────────── rules ─────────────────────────

export function spendPacing(s: ClientSnapshot, now: Date): AlertCandidate[] {
  const p = s.plan;
  if (!p || p.expectedByNow <= 0) return [];
  const ratio = p.spent / p.expectedByNow - 1;
  const base = { clientId: s.clientId, link: "/plan-vs-actual", audience: "team" as const };
  const vars = { client: s.clientName, plan: p.name, pct: pct(Math.abs(ratio)) };
  if (ratio > 0)
    return [{ ...base, type: "SPEND_OVER", severity: ratio > 0.3 ? "CRITICAL" : "WARNING", value: ratio, threshold: DEFAULT_THRESHOLDS.SPEND_OVER, dedupeKey: `SPEND_OVER:${s.clientId}:${day(now)}`, message: { key: "SPEND_OVER", vars } }];
  return [{ ...base, type: "SPEND_UNDER", severity: "WARNING", value: -ratio, threshold: DEFAULT_THRESHOLDS.SPEND_UNDER, dedupeKey: `SPEND_UNDER:${s.clientId}:${day(now)}`, message: { key: "SPEND_UNDER", vars } }];
}

export function budgetEnding(s: ClientSnapshot, now: Date): AlertCandidate[] {
  const p = s.plan;
  if (!p?.depletionDate || p.depletionDate >= p.periodEnd) return [];
  const daysLeft = Math.max(0, Math.round((p.depletionDate.getTime() - now.getTime()) / DAY));
  return [
    {
      type: "BUDGET_ENDING",
      severity: daysLeft <= 2 ? "CRITICAL" : "WARNING",
      clientId: s.clientId,
      value: daysLeft,
      threshold: DEFAULT_THRESHOLDS.BUDGET_ENDING,
      dedupeKey: `BUDGET_ENDING:${s.clientId}:${day(p.depletionDate)}`,
      message: { key: daysLeft === 0 ? "BUDGET_EXHAUSTED" : "BUDGET_ENDING", vars: { client: s.clientName, plan: p.name, days: daysLeft, date: day(p.depletionDate) } },
      link: "/plan-vs-actual",
      audience: "team",
    },
  ];
}

/** Week-over-week cost per lead / per purchase increase and ROAS decrease, overall and per platform. */
export function efficiencyChanges(s: ClientSnapshot, now: Date): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const wk = weekBucket(now);
  for (const w of s.weeks) {
    const platform = w.platform === "ALL" ? null : w.platform;
    const scope = w.platform;
    const where = { client: s.clientName, scope: scope === "ALL" ? "" : scope };
    const cost = (k: "leads" | "purchases", x: PeriodKpis) => (x[k] > 0 ? x.spend / x[k] : null);
    for (const k of ["leads", "purchases"] as const) {
      if (w.current[k] < MIN_CONVERSIONS || w.previous[k] < MIN_CONVERSIONS) continue;
      const a = cost(k, w.current)!;
      const b = cost(k, w.previous)!;
      const change = (a - b) / b;
      if (change <= 0) continue;
      out.push({
        type: "CPL_UP",
        severity: change > 0.5 ? "CRITICAL" : "WARNING",
        clientId: s.clientId,
        platform,
        value: change,
        threshold: DEFAULT_THRESHOLDS.CPL_UP,
        dedupeKey: `CPL_UP:${s.clientId}:${scope}:${k}:${wk}`,
        message: { key: k === "leads" ? "CPL_UP" : "CPA_UP", vars: { ...where, pct: pct(change), now: r2(a), before: r2(b), currency: s.currency } },
        link: "/analytics",
        audience: "team",
      });
    }
    if (w.previous.spend > 0 && w.current.spend > 0 && w.previous.revenue > 0 && w.current.purchases + w.previous.purchases >= MIN_CONVERSIONS) {
      const a = w.current.revenue / w.current.spend;
      const b = w.previous.revenue / w.previous.spend;
      const drop = (b - a) / b;
      if (drop > 0)
        out.push({
          type: "ROAS_DOWN",
          severity: drop > 0.4 ? "CRITICAL" : "WARNING",
          clientId: s.clientId,
          platform,
          value: drop,
          threshold: DEFAULT_THRESHOLDS.ROAS_DOWN,
          dedupeKey: `ROAS_DOWN:${s.clientId}:${scope}:${wk}`,
          message: { key: "ROAS_DOWN", vars: { ...where, pct: pct(drop), now: r2(a), before: r2(b) } },
          link: "/analytics",
          audience: "team",
        });
    }
  }
  return out;
}

/**
 * Frequency = impressions / reach over the last 7 days. Daily reach is summed across days, which
 * overstates unique reach, so this frequency is a conservative (lower-bound) approximation.
 */
export function frequency(s: ClientSnapshot, now: Date): AlertCandidate[] {
  return s.campaigns7d
    .filter((c) => c.reach > 0 && c.spend > 0)
    .map((c) => {
      const f = c.impressions / c.reach;
      return {
        type: "FREQUENCY" as const,
        severity: f > 5 ? ("CRITICAL" as const) : ("WARNING" as const),
        clientId: s.clientId,
        platform: c.platform,
        value: r2(f),
        threshold: DEFAULT_THRESHOLDS.FREQUENCY,
        dedupeKey: `FREQUENCY:${c.id}:${weekBucket(now)}`,
        message: { key: "FREQUENCY", vars: { client: s.clientName, campaign: c.name, value: r2(f) } },
        link: `/campaigns?client=${s.clientId}&campaign=${c.id}`,
        audience: "team" as const,
      };
    });
}

/** Suggests (never applies) moving budget from the least to the most efficient campaign. */
export function reallocation(s: ClientSnapshot, now: Date): AlertCandidate[] {
  const total = s.campaigns14d.reduce((a, c) => a + c.spend, 0);
  if (total <= 0) return [];
  // Efficiency per unit of spend: revenue when campaigns sell, else conversions.
  const useRevenue = s.campaigns14d.some((c) => c.revenue > 0);
  const scored = s.campaigns14d
    .filter((c) => c.spend >= total * 0.05)
    .map((c) => ({ ...c, eff: (useRevenue ? c.revenue : c.leads + c.purchases) / c.spend }))
    .filter((c) => useRevenue || c.leads + c.purchases >= MIN_CONVERSIONS || c.eff === 0)
    .sort((a, b) => b.eff - a.eff);
  if (scored.length < 2) return [];
  const best = scored[0];
  const worst = scored[scored.length - 1];
  if (best.eff <= 0) return [];
  const ratio = worst.eff > 0 ? best.eff / worst.eff : 99;
  return [
    {
      type: "REALLOCATION",
      severity: "INFO",
      clientId: s.clientId,
      value: r2(ratio),
      threshold: DEFAULT_THRESHOLDS.REALLOCATION,
      dedupeKey: `REALLOCATION:${s.clientId}:${weekBucket(now)}`,
      message: { key: useRevenue ? "REALLOCATION_ROAS" : "REALLOCATION_CONV", vars: { client: s.clientName, best: best.name, worst: worst.name, ratio: r2(ratio) } },
      link: `/budget?client=${s.clientId}`,
      audience: "team",
    },
  ];
}

export function integrationHealth(s: ClientSnapshot, now: Date): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const link = "/settings/integrations";
  for (const i of s.integrations) {
    if (!i.enabled || !i.hasCredentials) continue;
    const vars = { client: s.clientName, integration: i.label };
    if (i.tokenExpiresAt) {
      const days = Math.floor((i.tokenExpiresAt.getTime() - now.getTime()) / DAY);
      const band = days < 0 ? "expired" : days <= 3 ? "3" : days <= 7 ? "7" : days <= 14 ? "14" : "later";
      out.push({
        type: "TOKEN_EXPIRING",
        severity: days < 0 ? "CRITICAL" : days <= 3 ? "CRITICAL" : "WARNING",
        clientId: s.clientId,
        platform: i.platform,
        value: days,
        threshold: DEFAULT_THRESHOLDS.TOKEN_EXPIRING,
        dedupeKey: `TOKEN_EXPIRING:${i.id}:${band}:${day(i.tokenExpiresAt)}`,
        message: { key: days < 0 ? "TOKEN_EXPIRED" : "TOKEN_EXPIRING", vars: { ...vars, days: Math.max(0, days), date: day(i.tokenExpiresAt) } },
        link,
        audience: "team",
      });
    }
    if (i.missing.length || i.status === "PERMISSION_MISSING") {
      out.push({
        type: "PERMISSION_MISSING",
        severity: "WARNING",
        clientId: s.clientId,
        platform: i.platform,
        value: Math.max(1, i.missing.length),
        threshold: DEFAULT_THRESHOLDS.PERMISSION_MISSING,
        dedupeKey: `PERMISSION_MISSING:${i.id}:${[...i.missing].sort().join(",")}`,
        message: { key: "PERMISSION_MISSING", vars: { ...vars, scopes: i.missing.join(", ") || "—" } },
        link,
        audience: "team",
      });
    }
    if (["CONNECTED", "SYNCING", "SYNC_FAILED"].includes(i.status)) {
      const hours = i.lastSuccessAt ? (now.getTime() - i.lastSuccessAt.getTime()) / 3_600_000 : Infinity;
      if (Number.isFinite(hours))
        out.push({
          type: "SYNC_STOPPED",
          severity: hours > 72 ? "CRITICAL" : "WARNING",
          clientId: s.clientId,
          platform: i.platform,
          value: Math.round(hours),
          threshold: DEFAULT_THRESHOLDS.SYNC_STOPPED,
          dedupeKey: `SYNC_STOPPED:${i.id}:${day(now)}`,
          message: { key: "SYNC_STOPPED", vars: { ...vars, hours: Math.round(hours) } },
          link,
          audience: "team",
        });
    }
  }
  return out;
}

export function contentDue(s: ClientSnapshot, now: Date): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const c of s.content) {
    const inReview = c.status === "INTERNAL_REVIEW" || c.status === "CLIENT_REVIEW";
    if (inReview && c.approvalDeadline && c.approvalDeadline > now) {
      const hours = Math.round((c.approvalDeadline.getTime() - now.getTime()) / 3_600_000);
      out.push({
        type: "CONTENT_DUE",
        severity: hours <= 12 ? "WARNING" : "INFO",
        clientId: s.clientId,
        value: hours,
        threshold: DEFAULT_THRESHOLDS.CONTENT_DUE,
        dedupeKey: `CONTENT_DUE:review:${c.id}:${day(c.approvalDeadline)}`,
        message: { key: "CONTENT_REVIEW_DUE", vars: { client: s.clientName, title: c.title, hours } },
        link: `/approvals?client=${s.clientId}`,
        audience: c.status === "CLIENT_REVIEW" ? "client" : "team",
      });
    }
    const notReady = !["APPROVED", "SCHEDULED", "PUBLISHED", "REJECTED"].includes(c.status);
    if (notReady && c.publishAt && c.publishAt > now) {
      const hours = Math.round((c.publishAt.getTime() - now.getTime()) / 3_600_000);
      out.push({
        type: "CONTENT_DUE",
        severity: hours <= 24 ? "WARNING" : "INFO",
        clientId: s.clientId,
        value: hours,
        threshold: DEFAULT_THRESHOLDS.CONTENT_DUE,
        dedupeKey: `CONTENT_DUE:publish:${c.id}:${day(c.publishAt)}`,
        message: { key: "CONTENT_PUBLISH_SOON", vars: { client: s.clientName, title: c.title, hours } },
        link: `/calendar?client=${s.clientId}`,
        audience: "team",
      });
    }
  }
  return out;
}

export function contentRejected(s: ClientSnapshot): AlertCandidate[] {
  return s.rejections.map((r) => ({
    type: "CONTENT_REJECTED" as const,
    severity: "WARNING" as const,
    clientId: s.clientId,
    value: 1,
    threshold: DEFAULT_THRESHOLDS.CONTENT_REJECTED,
    dedupeKey: `CONTENT_REJECTED:${r.approvalId}`,
    message: { key: "CONTENT_REJECTED", vars: { client: s.clientName, title: r.title, comment: r.comment ?? "" } },
    link: `/approvals?client=${s.clientId}`,
    audience: "team" as const,
  }));
}

export function competitorAds(s: ClientSnapshot): AlertCandidate[] {
  return s.competitorAds
    .filter((c) => c.adIds.length)
    .map((c) => ({
      type: "COMPETITOR_AD" as const,
      severity: "INFO" as const,
      clientId: s.clientId,
      value: c.adIds.length,
      threshold: DEFAULT_THRESHOLDS.COMPETITOR_AD,
      dedupeKey: `COMPETITOR_AD:${c.competitorId}:${[...c.adIds].sort().join(",").slice(0, 150)}`,
      message: { key: "COMPETITOR_AD", vars: { client: s.clientName, competitor: c.competitorName, count: c.adIds.length } },
      link: `/competitors?client=${s.clientId}`,
      audience: "team" as const,
    }));
}

export function trends(s: ClientSnapshot): AlertCandidate[] {
  return s.trends.map((t) => ({
    type: "TREND" as const,
    severity: "SUCCESS" as const,
    clientId: s.clientId,
    value: t.growthPct,
    threshold: DEFAULT_THRESHOLDS.TREND,
    dedupeKey: `TREND:${t.id}`,
    message: { key: "TREND", vars: { client: s.clientName, keyword: t.keyword, pct: pct(t.growthPct), source: t.sourceName } },
    link: `/trends?client=${s.clientId}`,
    audience: "team" as const,
  }));
}

export function evaluateRules(s: ClientSnapshot, now = new Date()): AlertCandidate[] {
  return [
    ...spendPacing(s, now),
    ...budgetEnding(s, now),
    ...efficiencyChanges(s, now),
    ...frequency(s, now),
    ...reallocation(s, now),
    ...integrationHealth(s, now),
    ...contentDue(s, now),
    ...contentRejected(s),
    ...competitorAds(s),
    ...trends(s),
  ];
}

// ───────────────────────── preferences ─────────────────────────

export type Preference = { type: string; clientId: string | null; platform: Platform | null; inApp: boolean; email: boolean; threshold: number | null };

/**
 * Resolves delivery for one user + candidate. Most specific preference wins (client-specific over
 * global). A preference scoped to a platform only applies to alerts about that platform — alerts
 * about other platforms are suppressed for that user. Defaults: in-app on; e-mail only for CRITICAL.
 */
export function resolveDelivery(c: AlertCandidate, prefs: Preference[]): { inApp: boolean; email: boolean } | null {
  const mine = prefs.filter((p) => p.type === c.type);
  const pref = mine.find((p) => p.clientId === c.clientId) ?? mine.find((p) => p.clientId === null);
  if (pref?.platform && c.platform !== pref.platform) return null;
  const threshold = pref?.threshold ?? c.threshold;
  if (!passes(c, threshold)) return null;
  const inApp = pref ? pref.inApp : true;
  const email = pref ? pref.email : c.severity === "CRITICAL";
  if (!inApp && !email) return null;
  return { inApp, email };
}
