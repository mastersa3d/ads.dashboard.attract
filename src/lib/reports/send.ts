import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMail, appUrl, emailLayout } from "@/lib/mailer";
import { fmtDate, type Locale } from "@/lib/format";
import { makeT } from "@/lib/i18n/translate";
import { enqueue } from "@/lib/jobs/queue";
import { createDeliveryLink } from "./share";
import { readConfig } from "./schema";
import { isDue, parseSchedule, rollingPeriod } from "./schedule";

/**
 * Scheduled report delivery (job `report.send`). E-mails each recipient a read-only link
 * (/r/<token>, valid 30 days, no login needed). A PDF can be produced from that page with the
 * browser's "Save as PDF" (print-optimised) — server-side PDF rendering is not bundled.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendReport(reportId: string, opts: { now?: Date; scheduled?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const report = await db.report.findUnique({ where: { id: reportId }, include: { client: { include: { organization: true } } } });
  if (!report) return { sent: 0, skipped: "Report no longer exists" };
  if (!report.recipients.length) return { sent: 0, skipped: "No recipients" };

  const cfg = readConfig(report.config);
  const sched = parseSchedule(report.schedule);
  let { periodStart, periodEnd } = report;
  if (opts.scheduled && sched && cfg.rolling) {
    const p = rollingPeriod(sched.freq, now, report.client.timezone);
    periodStart = p.start;
    periodEnd = p.end;
    await db.report.update({ where: { id: report.id }, data: { periodStart, periodEnd } });
  }

  const token = await createDeliveryLink(report.id, now);
  const locale: Locale = report.client.organization.defaultLocale === "en" ? "en" : "ar";
  const t = makeT(locale);
  const link = appUrl(`/r/${token}`);
  const period = `${fmtDate(periodStart, locale)} – ${fmtDate(periodEnd, locale)}`;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const subject = `${report.title} · ${period}`;
  const body =
    `<div dir="${dir}"><p>${esc(t("reports.email.intro", { client: report.client.name, period }))}</p>` +
    `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${esc(t("reports.email.open"))}</a></p>` +
    `<p style="color:#6b7280;font-size:12px">${esc(t("reports.email.note", { days: 30 }))}</p></div>`;

  let sent = 0;
  for (const to of report.recipients) {
    try {
      await sendMail(to, subject, emailLayout(esc(report.title), body));
      sent++;
    } catch (e) {
      logger.warn("report.email_failed", { reportId, message: (e as Error).message });
    }
  }
  if (sent === 0) throw new Error("No e-mail could be delivered");
  await db.report.update({ where: { id: report.id }, data: { lastSentAt: now } });
  await db.auditLog.create({
    data: { organizationId: report.client.organizationId, clientId: report.clientId, action: "send", entity: "Report", entityId: report.id, summary: `Report e-mailed to ${sent} recipient(s)${opts.scheduled ? " (scheduled)" : ""}` },
  });
  return { sent };
}

/** Enqueues `report.send` for every report whose schedule is due (idempotent per occurrence). */
export async function enqueueDueReports(now = new Date()) {
  const reports = await db.report.findMany({
    where: { schedule: { not: null }, recipients: { isEmpty: false }, client: { archived: false } },
    select: { id: true, schedule: true, lastSentAt: true, createdAt: true, client: { select: { timezone: true, organizationId: true } } },
  });
  let queued = 0;
  for (const r of reports) {
    const occ = isDue(r.schedule, r.lastSentAt, r.createdAt, now, r.client.timezone);
    if (!occ) continue;
    const res = await enqueue("report.send", { reportId: r.id, scheduled: true }, { organizationId: r.client.organizationId, dedupeKey: `report:${r.id}:${occ.toISOString()}`, dedupeAnyStatus: true, maxAttempts: 3 });
    if (!res.deduped) queued++;
  }
  return queued;
}
