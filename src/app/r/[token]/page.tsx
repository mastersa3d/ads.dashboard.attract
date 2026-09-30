import type { Metadata } from "next";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { fmtRelative } from "@/lib/format";
import { findReportByToken } from "@/lib/reports/share";
import { loadReportData } from "@/lib/reports/data";
import { ReportDocument } from "@/components/reports/report-document";
import { ErrorState } from "@/components/ui/primitives";
import { PrintButton } from "@/components/reports/print-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Report",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

/**
 * Public, read-only report (/r/<token>). No login, no app chrome, client branding only.
 * The token is looked up by its sha256 hash and must not be expired; requests are rate-limited per IP.
 */
export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getI18n();
  const ip = clientIp(await headers()) ?? "unknown";

  const shell = (children: React.ReactNode) => <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6">{children}</main>;

  if (!rateLimit(`public-report:${ip}`, 30, 60_000).ok) return shell(<ErrorState title={t("reports.public.rateLimited")} />);
  const id = await findReportByToken(token);
  if (!id) return shell(<ErrorState title={t("reports.public.invalid")} hint={t("reports.public.invalidHint")} />);

  const report = await db.report.findUniqueOrThrow({ where: { id } });
  const data = await loadReportData(report);
  const labels = {
    source: t("ui.source"),
    updated: t("ui.lastUpdated"),
    demo: t("ui.demoData"),
    demoHint: t("ui.demoDataHint"),
    estimate: t("ui.estimate"),
    estimateHint: t("ui.estimateHint"),
  };
  const org = data.theme.whiteLabel ? undefined : (await db.organization.findFirst({ where: { clients: { some: { id: report.clientId } } }, select: { name: true } }))?.name;

  return shell(
    <div className="space-y-4">
      <div className="flex justify-end no-print">
        <PrintButton />
      </div>
      <ReportDocument report={report} data={data} t={t} locale={locale} labels={labels} updatedLabel={data.updated ? fmtRelative(data.updated, locale) : null} agencyName={org} />
      <p className="text-center text-[11px] text-subtle no-print">{t("reports.public.readOnly")}</p>
    </div>,
  );
}
