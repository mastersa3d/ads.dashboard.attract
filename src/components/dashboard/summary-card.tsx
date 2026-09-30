import { Sparkles, CheckCircle2, AlertTriangle, Lightbulb, TrendingUp, HelpCircle, Target, Newspaper } from "lucide-react";
import type { ExecutiveSummary, Insight } from "@/lib/ai/insights";
import type { TFunction } from "@/lib/i18n/translate";
import { Badge, Card, CardBody, CardHeader, EmptyState, cx } from "@/components/ui/primitives";

const kindTone = { fact: "info", estimate: "warning", recommendation: "brand" } as const;

function Item({ i, t }: { i: Insight; t: TFunction }) {
  return (
    <li className="flex gap-2 text-sm leading-relaxed">
      <span className={cx("mt-2 size-1.5 shrink-0 rounded-full", i.tone === "good" ? "bg-good" : i.tone === "bad" ? "bg-bad" : i.tone === "warning" ? "bg-warn" : "bg-info")} aria-hidden />
      <div className="min-w-0">
        <p>{i.text}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
          <Badge tone={kindTone[i.kind]}>{t(`dashboard.kind_${i.kind}`)}</Badge>
          <span>
            {t("ui.source")}: {i.source}
          </span>
          <span>
            · {t("ui.confidence")}: <span className="num">{Math.round(i.confidence * 100)}%</span>
          </span>
        </p>
      </div>
    </li>
  );
}

function Section({ title, icon, items, t }: { title: string; icon: React.ReactNode; items: Insight[]; t: TFunction }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon} {title}
      </h4>
      <ul className="space-y-2.5">
        {items.map((i, k) => (
          <Item key={k} i={i} t={t} />
        ))}
      </ul>
    </div>
  );
}

export function SummaryCard({ summary, t, meta }: { summary: ExecutiveSummary; t: TFunction; meta: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-brand" /> {t("dashboard.aiSummary")}</span>} subtitle={t("dashboard.aiSummaryNote")} meta={meta} />
      <CardBody>
        {!summary.enoughData ? (
          <EmptyState title={t("dashboard.notEnoughData")} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5">
              <Section title={t("dashboard.whatHappened")} icon={<Newspaper className="size-3.5" />} items={summary.whatHappened} t={t} />
              <Section title={t("dashboard.why")} icon={<HelpCircle className="size-3.5" />} items={summary.why} t={t} />
              <Section title={t("dashboard.good")} icon={<CheckCircle2 className="size-3.5 text-good" />} items={summary.good} t={t} />
              <Section title={t("dashboard.problems")} icon={<AlertTriangle className="size-3.5 text-warn" />} items={summary.problems} t={t} />
            </div>
            <div className="space-y-5">
              <Section title={t("dashboard.actions")} icon={<Lightbulb className="size-3.5 text-brand" />} items={summary.actions} t={t} />
              <Section title={t("dashboard.outlook")} icon={<TrendingUp className="size-3.5" />} items={summary.outlook} t={t} />
              <div className="rounded-lg border border-brand/30 bg-brand-soft/50 p-3">
                <Section title={t("dashboard.decisions")} icon={<Target className="size-3.5 text-brand" />} items={summary.decisions} t={t} />
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
