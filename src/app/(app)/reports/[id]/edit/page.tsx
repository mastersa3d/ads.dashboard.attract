import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { isoDay } from "@/lib/format";
import { builderOptions } from "@/lib/reports/builder-options";
import { readConfig, readSummary } from "@/lib/reports/schema";
import { PageHeader } from "@/components/ui/primitives";
import { ReportBuilder } from "@/components/reports/report-builder";

export const metadata = { title: "Edit report" };

export default async function EditReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawParams> }) {
  const { id } = await params;
  const ctx = await pageContext(await searchParams, "reports:create");
  const report = await db.report.findFirst({ where: { id, clientId: { in: ctx.clientIds } } });
  if (!report) notFound();
  const cfg = readConfig(report.config);
  const sum = readSummary(report.summary);
  const opts = await builderOptions(ctx);

  return (
    <div className="space-y-5">
      <Link href={`/reports/${report.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4 flip-rtl" aria-hidden /> {report.title}
      </Link>
      <PageHeader title={ctx.t("reports.builder.editTitle")} description={ctx.t("reports.builder.editHint")} />
      <ReportBuilder
        {...opts}
        initial={{
          id: report.id,
          clientId: report.clientId,
          type: report.type,
          title: report.title,
          periodStart: isoDay(report.periodStart),
          periodEnd: isoDay(report.periodEnd),
          platforms: cfg.platforms,
          kpis: cfg.kpis,
          charts: cfg.charts,
          compare: cfg.compare,
          theme: { logoUrl: cfg.theme.logoUrl || "", primary: cfg.theme.primary, accent: cfg.theme.accent, whiteLabel: cfg.theme.whiteLabel },
          executive: sum.executive,
          wins: sum.wins.join("\n"),
          challenges: sum.challenges.join("\n"),
          learnings: sum.learnings.join("\n"),
          recommendations: sum.recommendations.join("\n"),
          comments: sum.comments,
        }}
      />
    </div>
  );
}
