import { Prisma, type Platform, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail, appUrl, emailLayout } from "@/lib/mailer";
import { convert, fxFromSettings, type FxTable } from "@/lib/fx";
import { forecastSpend } from "@/lib/metrics";
import { toNum, type Locale } from "@/lib/format";
import { makeT } from "@/lib/i18n/translate";
import { missingScopes } from "@/lib/integrations/status";
import { evaluateRules, resolveDelivery, type AlertCandidate, type ClientSnapshot, type PeriodKpis, type Preference } from "./rules";

/**
 * Alerts engine (hourly job `alerts.evaluate`). For each organization → client:
 *   1. build a ClientSnapshot from tenant-scoped queries,
 *   2. run the pure rules,
 *   3. for each recipient with access to the client, resolve NotificationPreference,
 *   4. insert a Notification (unique userId+dedupeKey → at most once per bucket) and e-mail if asked.
 * Competitor-ad and trend alerts already raised by other modules (org-wide notifications) are reused.
 */

const DAY = 86_400_000;
const TEAM: Role[] = ["SUPER_ADMIN", "COMPANY_MANAGER", "MARKETING_TEAM"];
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function weekKpis(clientId: string, from: Date, to: Date, currency: string, fx: FxTable) {
  const rows = await db.metricDaily.groupBy({
    by: ["platform", "currency"],
    where: { clientId, date: { gte: from, lte: to } },
    _sum: { spend: true, leads: true, purchases: true, revenue: true },
  });
  const map = new Map<Platform | "ALL", PeriodKpis>();
  const add = (k: Platform | "ALL", r: (typeof rows)[number]) => {
    const cur = map.get(k) ?? { spend: 0, leads: 0, purchases: 0, revenue: 0 };
    cur.spend += convert(toNum(r._sum.spend), r.currency, currency, fx);
    cur.revenue += convert(toNum(r._sum.revenue), r.currency, currency, fx);
    cur.leads += r._sum.leads ?? 0;
    cur.purchases += r._sum.purchases ?? 0;
    map.set(k, cur);
  };
  for (const r of rows) {
    add("ALL", r);
    add(r.platform, r);
  }
  return map;
}

export async function buildSnapshot(clientId: string, fx: FxTable, now = new Date()): Promise<ClientSnapshot | null> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, currency: true, archived: true } });
  if (!client || client.archived) return null;
  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - DAY);
  const cur = { from: new Date(yesterday.getTime() - 6 * DAY), to: yesterday };
  const prev = { from: new Date(cur.from.getTime() - 7 * DAY), to: new Date(cur.from.getTime() - DAY) };
  const c = client.currency;

  // Budget plan covering today (approved plans first).
  const plan = await db.budgetPlan.findFirst({ where: { clientId, startDate: { lte: today }, endDate: { gte: today } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
  let planSnap: ClientSnapshot["plan"] = null;
  if (plan) {
    const daily = await db.metricDaily.groupBy({ by: ["date", "currency"], where: { clientId, date: { gte: plan.startDate, lte: today } }, _sum: { spend: true }, orderBy: { date: "asc" } });
    const byDay = new Map<number, number>();
    for (const d of daily) byDay.set(d.date.getTime(), (byDay.get(d.date.getTime()) ?? 0) + convert(toNum(d._sum.spend), d.currency, plan.currency, fx));
    const fc = forecastSpend({
      dailySpend: [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, spend]) => ({ date: new Date(t), spend })),
      budget: toNum(plan.totalBudget),
      periodStart: plan.startDate,
      periodEnd: plan.endDate,
      asOf: yesterday < plan.startDate ? plan.startDate : yesterday,
    });
    planSnap = { name: plan.name, budget: toNum(plan.totalBudget), spent: fc.spent, expectedByNow: fc.expectedByNow, periodEnd: plan.endDate, depletionDate: fc.depletionDate };
  }

  const [curW, prevW, camp7, camp14, integrations, content, rejections, ads, trendRows] = await Promise.all([
    weekKpis(clientId, cur.from, cur.to, c, fx),
    weekKpis(clientId, prev.from, prev.to, c, fx),
    db.metricDaily.groupBy({ by: ["campaignId", "currency"], where: { clientId, campaignId: { not: null }, date: { gte: cur.from, lte: cur.to } }, _sum: { impressions: true, reach: true, spend: true } }),
    db.metricDaily.groupBy({
      by: ["campaignId", "currency"],
      where: { clientId, campaignId: { not: null }, date: { gte: new Date(yesterday.getTime() - 13 * DAY), lte: yesterday } },
      _sum: { spend: true, leads: true, purchases: true, revenue: true },
    }),
    db.integration.findMany({ where: { clientId }, select: { id: true, label: true, platform: true, status: true, enabled: true, accessTokenEnc: true, tokenLast4: true, lastSuccessAt: true, tokenExpiresAt: true, scopesGranted: true, scopesRequired: true } }),
    db.contentItem.findMany({
      where: {
        clientId,
        OR: [
          { status: { in: ["INTERNAL_REVIEW", "CLIENT_REVIEW"] }, approvalDeadline: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } },
          { status: { notIn: ["APPROVED", "SCHEDULED", "PUBLISHED", "REJECTED"] }, publishAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } },
        ],
      },
      select: { id: true, title: true, status: true, approvalDeadline: true, publishAt: true },
      take: 200,
    }),
    db.approval.findMany({ where: { content: { clientId }, stage: "CLIENT", decision: "REJECTED", createdAt: { gte: new Date(now.getTime() - 2 * DAY) } }, select: { id: true, comment: true, content: { select: { id: true, title: true } } } }),
    db.competitorAd.findMany({ where: { competitor: { clientId }, createdAt: { gte: new Date(now.getTime() - 2 * DAY) } }, select: { id: true, competitor: { select: { id: true, name: true } } } }),
    db.trendSignal.findMany({ where: { clientId, discoveredAt: { gte: new Date(now.getTime() - 7 * DAY) }, growthPct: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true, keyword: true, growthPct: true, sourceName: true } }),
  ]);

  const campIds = [...new Set([...camp7, ...camp14].map((r) => r.campaignId!))];
  const camps = new Map((await db.campaign.findMany({ where: { id: { in: campIds }, clientId }, select: { id: true, name: true, platform: true } })).map((x) => [x.id, x]));

  const merge7 = new Map<string, ClientSnapshot["campaigns7d"][number]>();
  for (const r of camp7) {
    const meta = camps.get(r.campaignId!);
    if (!meta) continue;
    const x = merge7.get(meta.id) ?? { id: meta.id, name: meta.name, platform: meta.platform, impressions: 0, reach: 0, spend: 0 };
    x.impressions += r._sum.impressions ?? 0;
    x.reach += r._sum.reach ?? 0;
    x.spend += convert(toNum(r._sum.spend), r.currency, c, fx);
    merge7.set(meta.id, x);
  }
  const merge14 = new Map<string, ClientSnapshot["campaigns14d"][number]>();
  for (const r of camp14) {
    const meta = camps.get(r.campaignId!);
    if (!meta) continue;
    const x = merge14.get(meta.id) ?? { id: meta.id, name: meta.name, platform: meta.platform, spend: 0, leads: 0, purchases: 0, revenue: 0 };
    x.spend += convert(toNum(r._sum.spend), r.currency, c, fx);
    x.revenue += convert(toNum(r._sum.revenue), r.currency, c, fx);
    x.leads += r._sum.leads ?? 0;
    x.purchases += r._sum.purchases ?? 0;
    merge14.set(meta.id, x);
  }

  const byCompetitor = new Map<string, { competitorId: string; competitorName: string; adIds: string[] }>();
  for (const a of ads) {
    const e = byCompetitor.get(a.competitor.id) ?? { competitorId: a.competitor.id, competitorName: a.competitor.name, adIds: [] };
    e.adIds.push(a.id);
    byCompetitor.set(a.competitor.id, e);
  }

  const platforms = new Set<Platform | "ALL">([...curW.keys(), ...prevW.keys()]);
  const zero = { spend: 0, leads: 0, purchases: 0, revenue: 0 };
  return {
    clientId,
    clientName: client.name,
    currency: c,
    plan: planSnap,
    weeks: [...platforms].map((p) => ({ platform: p, current: curW.get(p) ?? zero, previous: prevW.get(p) ?? zero })),
    campaigns7d: [...merge7.values()],
    campaigns14d: [...merge14.values()],
    integrations: integrations.map((i) => ({
      id: i.id,
      label: i.label,
      platform: i.platform,
      status: i.status,
      enabled: i.enabled,
      // Demo integrations carry a tokenLast4 marker but no encrypted token.
      hasCredentials: Boolean(i.accessTokenEnc || i.tokenLast4),
      lastSuccessAt: i.lastSuccessAt,
      tokenExpiresAt: i.tokenExpiresAt,
      missing: i.scopesGranted.length ? missingScopes(i.scopesRequired, i.scopesGranted) : [],
    })),
    content,
    rejections: rejections.map((r) => ({ approvalId: r.id, contentId: r.content.id, title: r.content.title, comment: r.comment })),
    competitorAds: [...byCompetitor.values()],
    trends: trendRows.map((t) => ({ id: t.id, keyword: t.keyword, growthPct: t.growthPct ?? 0, sourceName: t.sourceName })),
  };
}

type Recipient = { id: string; email: string; name: string; role: Role; locale: string; clientIds: Set<string> | null; prefs: Preference[] };

async function recipients(organizationId: string): Promise<Recipient[]> {
  const users = await db.user.findMany({
    where: { organizationId, active: true, role: { in: [...TEAM, "CLIENT"] } },
    select: { id: true, email: true, name: true, role: true, locale: true, clientAccess: { select: { clientId: true } }, notificationPrefs: true },
  });
  return users.map((u) => {
    const listed = new Set(u.clientAccess.map((a) => a.clientId));
    // Mirrors lib/tenant.ts: managers see all; team sees listed clients or all when none listed; CLIENT only listed.
    const clientIds = u.role === "SUPER_ADMIN" || u.role === "COMPANY_MANAGER" || (u.role === "MARKETING_TEAM" && listed.size === 0) ? null : listed;
    return { id: u.id, email: u.email, name: u.name, role: u.role, locale: u.locale, clientIds, prefs: u.notificationPrefs };
  });
}

const canSee = (r: Recipient, c: AlertCandidate) =>
  (r.clientIds === null || r.clientIds.has(c.clientId)) && (TEAM.includes(r.role) || (r.role === "CLIENT" && c.audience === "client"));

/** Title/body in the recipient's language. */
export function renderAlert(c: AlertCandidate, locale: Locale) {
  const t = makeT(locale);
  const vars = { ...c.message.vars, scope: c.message.vars.scope ? ` (${t(`platform.${c.message.vars.scope}`)})` : "" };
  return { title: t(`integrations.alert.${c.message.key}.title`, vars), body: t(`integrations.alert.${c.message.key}.body`, vars) };
}

export async function evaluateAlerts(opts: { organizationId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const orgs = await db.organization.findMany({ where: opts.organizationId ? { id: opts.organizationId } : {}, select: { id: true, settings: true } });
  let created = 0;
  let emailed = 0;
  let candidates = 0;
  for (const org of orgs) {
    const fx = fxFromSettings(org.settings);
    const [clients, people, external] = await Promise.all([
      db.client.findMany({ where: { organizationId: org.id, archived: false }, select: { id: true } }),
      recipients(org.id),
      // Org-wide notifications raised by other modules (competitor scans, trend imports) in the last day.
      db.notification.findMany({ where: { organizationId: org.id, userId: null, type: { in: ["COMPETITOR_AD", "TREND"] }, createdAt: { gte: new Date(now.getTime() - DAY) } }, select: { type: true, clientId: true } }),
    ]);
    const reused = new Set(external.map((n) => `${n.type}:${n.clientId}`));

    for (const { id: clientId } of clients) {
      const snap = await buildSnapshot(clientId, fx, now);
      if (!snap) continue;
      const list = evaluateRules(snap, now).filter((c) => !reused.has(`${c.type}:${c.clientId}`));
      candidates += list.length;
      const seen = new Set(
        (await db.notification.findMany({ where: { organizationId: org.id, dedupeKey: { in: list.map((c) => c.dedupeKey) } }, select: { userId: true, dedupeKey: true } })).map((n) => `${n.userId}|${n.dedupeKey}`),
      );
      for (const c of list) {
        for (const r of people) {
          if (seen.has(`${r.id}|${c.dedupeKey}`) || !canSee(r, c)) continue;
          const delivery = resolveDelivery(c, r.prefs);
          if (!delivery) continue;
          const locale: Locale = r.locale === "en" ? "en" : "ar";
          const msg = renderAlert(c, locale);
          try {
            await db.notification.create({
              data: {
                organizationId: org.id,
                userId: r.id,
                clientId: c.clientId,
                type: c.type,
                severity: c.severity,
                title: msg.title.slice(0, 300),
                body: msg.body.slice(0, 2000),
                link: c.link,
                dedupeKey: c.dedupeKey,
                // E-mail-only preference: keep the record for de-duplication but don't show it as unread.
                readAt: delivery.inApp ? null : now,
              },
            });
            created++;
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // already notified in this bucket
            throw e;
          }
          if (delivery.email) {
            try {
              const t = makeT(locale);
              await sendMail(
                r.email,
                msg.title,
                emailLayout(esc(msg.title), `<p>${esc(msg.body)}</p><p><a href="${appUrl(c.link)}">${esc(t("integrations.alert.open"))}</a></p>`),
              );
              emailed++;
            } catch (e) {
              logger.warn("alerts.email_failed", { userId: r.id, type: c.type, message: (e as Error).message });
            }
          }
        }
      }
    }
  }
  logger.info("alerts.evaluated", { candidates, created, emailed });
  return { candidates, created, emailed };
}
