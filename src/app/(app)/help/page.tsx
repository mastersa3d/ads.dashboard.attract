import Link from "next/link";
import { BookOpen, Calculator, CircleHelp, FileText, ShieldCheck, Users, Megaphone, Building2 } from "lucide-react";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { Badge, Card, CardBody, CardHeader, DemoBadge, EstimateBadge, PageHeader, cx } from "@/components/ui/primitives";

export const metadata = { title: "Help & Documentation" };

/** Guide ids and how many numbered steps each has in the "help" namespace (help.guide.<id>.<n>). */
const GUIDES = [
  { id: "admin", icon: ShieldCheck, steps: 7, roles: ["SUPER_ADMIN", "COMPANY_MANAGER"] },
  { id: "team", icon: Megaphone, steps: 7, roles: ["MARKETING_TEAM"] },
  { id: "client", icon: Building2, steps: 6, roles: ["CLIENT", "VIEWER"] },
] as const;

/** KPI glossary: key in common "kpi.*" + formula / meaning in help.kpi.<id>.* */
const KPIS = ["spend", "impressions", "reach", "frequency", "ctr", "cpc", "cpm", "cvr", "cpl", "cpa", "roas", "roi", "engagementRate", "vcr", "followersGrowth", "utilization", "forecast"] as const;
const FAQ_COUNT = 8;
const DOCS = ["deploy", "integrations", "security", "backups", "roles", "i18n"] as const;

export default async function HelpPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const ctx = await pageContext(await searchParams);
  const { t, user } = ctx;
  // The reader's own guide comes first.
  const guides = [...GUIDES].sort((a, b) => Number((b.roles as readonly string[]).includes(user.role)) - Number((a.roles as readonly string[]).includes(user.role)));
  const toc = [
    { id: "guides", label: t("help.guides"), icon: Users },
    { id: "honesty", label: t("help.honesty"), icon: ShieldCheck },
    { id: "glossary", label: t("help.glossary"), icon: Calculator },
    { id: "faq", label: t("help.faq"), icon: CircleHelp },
    { id: "docs", label: t("help.docs"), icon: FileText },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("help.title")} description={t("help.subtitle")} />
      <nav aria-label={t("help.contents")} className="flex flex-wrap gap-2 no-print">
        {toc.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand/50 hover:text-brand">
            <s.icon className="size-4" aria-hidden /> {s.label}
          </a>
        ))}
      </nav>

      <section id="guides" aria-labelledby="guides-h" className="scroll-mt-20 space-y-3">
        <h2 id="guides-h" className="text-lg font-semibold">{t("help.guides")}</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {guides.map((g) => {
            const mine = (g.roles as readonly string[]).includes(user.role);
            return (
              <Card key={g.id} className={cx(mine && "border-brand/50")}>
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <g.icon className="size-4 text-brand" aria-hidden /> {t(`help.guide.${g.id}.title`)}
                    </span>
                  }
                  subtitle={t(`help.guide.${g.id}.intro`)}
                  actions={mine ? <Badge tone="brand">{t("help.yourGuide")}</Badge> : undefined}
                />
                <CardBody>
                  <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed">
                    {Array.from({ length: g.steps }, (_, i) => (
                      <li key={i}>{t(`help.guide.${g.id}.${i + 1}`)}</li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>

      <section id="honesty" aria-labelledby="honesty-h" className="scroll-mt-20">
        <Card>
          <CardHeader title={<span id="honesty-h">{t("help.honesty")}</span>} subtitle={t("help.honestyIntro")} />
          <CardBody className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Badge tone="good">{t("ui.actual")}</Badge>
              <p className="text-sm">{t("help.honestyActual")}</p>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <EstimateBadge label={t("ui.estimate")} />
              <p className="text-sm">{t("help.honestyEstimate")}</p>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <DemoBadge label={t("ui.demoData")} />
              <p className="text-sm">{t("help.honestyDemo")}</p>
            </div>
            <p className="text-sm text-muted md:col-span-3">{t("help.honestyAi")}</p>
          </CardBody>
        </Card>
      </section>

      <section id="glossary" aria-labelledby="glossary-h" className="scroll-mt-20">
        <Card>
          <CardHeader title={<span id="glossary-h">{t("help.glossary")}</span>} subtitle={t("help.glossaryIntro")} />
          <dl className="grid divide-y divide-border md:grid-cols-2 md:divide-y-0">
            {KPIS.map((k) => (
              <div key={k} className="border-border px-4 py-3 md:border-b md:odd:border-e">
                <dt className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{t(`kpi.${k}`)}</span>
                  <code dir="ltr" className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                    {t(`help.kpi.${k}.formula`)}
                  </code>
                </dt>
                <dd className="mt-1 text-sm text-muted">{t(`help.kpi.${k}.meaning`)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section id="faq" aria-labelledby="faq-h" className="scroll-mt-20">
        <Card>
          <CardHeader title={<span id="faq-h">{t("help.faq")}</span>} />
          <div className="divide-y divide-border">
            {Array.from({ length: FAQ_COUNT }, (_, i) => (
              <details key={i} className="group px-4 py-3">
                <summary className="cursor-pointer list-none font-medium marker:hidden">
                  <span className="me-2 inline-block text-brand transition group-open:rotate-90 flip-rtl">›</span>
                  {t(`help.faq.${i + 1}.q`)}
                </summary>
                <p className="mt-2 ps-5 text-sm leading-relaxed text-muted">{t(`help.faq.${i + 1}.a`)}</p>
              </details>
            ))}
          </div>
        </Card>
      </section>

      <section id="docs" aria-labelledby="docs-h" className="scroll-mt-20 space-y-3">
        <h2 id="docs-h" className="text-lg font-semibold">{t("help.docs")}</h2>
        <p className="text-sm text-muted">{t("help.docsIntro")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {DOCS.map((d) => (
            <Card key={d}>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="size-4 text-brand" aria-hidden /> {t(`help.doc.${d}.title`)}
                  </span>
                }
                subtitle={<code dir="ltr">{t(`help.doc.${d}.file`)}</code>}
              />
              <CardBody>
                <p className="text-sm leading-relaxed whitespace-pre-line">{t(`help.doc.${d}.body`)}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <p className="text-xs text-subtle">
        <Link href="/legal/privacy" className="hover:text-text">{t("help.legal.privacyTitle")}</Link> ·{" "}
        <Link href="/legal/terms" className="hover:text-text">{t("help.legal.termsTitle")}</Link>
      </p>
    </div>
  );
}
