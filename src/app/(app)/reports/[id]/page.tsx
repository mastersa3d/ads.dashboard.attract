import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDateTime, isoDay } from "@/lib/format";
import { loadReportData } from "@/lib/reports/data";
import { isLinkValid } from "@/lib/reports/share";
import { nextOccurrence, parseSchedule, WEEKDAYS } from "@/lib/reports/schedule";
import { Card, CardBody, CardHeader, LinkButton } from "@/components/ui/primitives";
import { ExportMenu } from "@/components/ui/export-menu";
import { ReportDocument } from "@/components/reports/report-document";
import { SchedulePanel, SharePanel } from "@/components/reports/report-share";
import { DeleteReportButton } from "@/components/reports/delete-report";

export const metadata = { title: "Report" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawParams> }) {
  const { id } = await params;
  const ctx = await pageContext(await searchParams, "reports:view");
  const { t, locale } = ctx;
  // Tenant scope: the report's client must be one this user can access.
  const report = await db.report.findFirst({ where: { id, clientId: { in: ctx.clientIds } } });
  if (!report) notFound();
  const data = await loadReportData(report);
  const now = new Date();
  const sched = parseSchedule(report.schedule);
  const next = report.schedule ? nextOccurrence(report.schedule, now, data.client.timezone) : null;
  const exportQuery = new URLSearchParams({
    client: report.clientId,
    from: isoDay(report.periodStart),
    to: isoDay(report.periodEnd),
    ...(data.config.platforms.length ? { platform: data.config.platforms.join(",") } : {}),
  }).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <Link href={`/reports?${ctx.query}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4 flip-rtl" aria-hidden /> {t("reports.title")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {ctx.can("reports:create") && (
            <LinkButton href={`/reports/${report.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("ui.edit")}
            </LinkButton>
          )}
          {ctx.can("reports:export") && <ExportMenu dataset="campaigns" query={exportQuery} targetId="report-root" fileName={`report-${isoDay(report.periodStart)}`} />}
          {ctx.can("reports:create") && <DeleteReportButton id={report.id} />}
        </div>
      </div>

      {ctx.can("reports:share") && (
        <div className="grid gap-4 lg:grid-cols-2 no-print">
          <Card>
            <CardHeader title={t("reports.share.title")} subtitle={t("reports.share.hint")} />
            <CardBody>
              <SharePanel reportId={report.id} active={isLinkValid(report.shareExpiresAt, now)} expiresAt={report.shareExpiresAt?.toISOString() ?? null} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title={t("reports.schedule.title")}
              subtitle={report.lastSentAt ? t("reports.schedule.lastSent", { date: fmtDateTime(report.lastSentAt, locale, data.client.timezone) }) : t("reports.schedule.hint")}
            />
            <CardBody>
              <SchedulePanel
                reportId={report.id}
                nextRunLabel={next ? fmtDateTime(next, locale, data.client.timezone) : null}
                initial={{
                  freq: sched?.freq ?? "none",
                  weekday: sched?.freq === "weekly" ? WEEKDAYS[sched.day] : "mon",
                  monthDay: sched?.freq === "monthly" ? sched.day : 1,
                  time: sched ? `${String(sched.hour).padStart(2, "0")}:${String(sched.minute).padStart(2, "0")}` : "09:00",
                  recipients: report.recipients,
                  rolling: data.config.rolling,
                }}
              />
            </CardBody>
          </Card>
        </div>
      )}

      <ReportDocument report={report} data={data} t={t} locale={locale} labels={ctx.metaLabels} updatedLabel={ctx.rel(data.updated)} agencyName={ctx.org.name} />
    </div>
  );
}
