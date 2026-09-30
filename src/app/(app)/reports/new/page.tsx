import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { builderOptions } from "@/lib/reports/builder-options";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ReportBuilder } from "@/components/reports/report-builder";

export const metadata = { title: "New report" };

export default async function NewReportPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const ctx = await pageContext(await searchParams, "reports:create");
  const { t } = ctx;
  const opts = await builderOptions(ctx);
  // Pre-select the client from the global filter when set.
  if (ctx.client) opts.clients.sort((a, b) => (a.id === ctx.client!.id ? -1 : b.id === ctx.client!.id ? 1 : 0));

  return (
    <div className="space-y-5">
      <Link href={`/reports?${ctx.query}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4 flip-rtl" aria-hidden /> {t("reports.title")}
      </Link>
      <PageHeader title={t("reports.builder.title")} description={t("reports.builder.description")} />
      {opts.clients.length === 0 ? (
        <Card>
          <EmptyState title={t("reports.noClients")} />
        </Card>
      ) : (
        <ReportBuilder {...opts} />
      )}
    </div>
  );
}
