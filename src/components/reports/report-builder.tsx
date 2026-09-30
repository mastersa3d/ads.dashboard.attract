"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea, cx } from "@/components/ui/primitives";
import { ResultLine, useErrorText } from "@/components/integrations/action-button";
import { saveReport } from "@/app/actions/reports";

type ClientOpt = { id: string; name: string; platforms: string[]; colors: string[]; logoUrl: string | null };
type Action = { title: string; assigneeId: string; dueDate: string; priority: string };

export type BuilderInitial = {
  id?: string;
  clientId: string;
  type: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  platforms: string[];
  kpis: string[];
  charts: string[];
  compare: "prev" | "yoy" | "none";
  theme: { logoUrl?: string; primary?: string; accent?: string; whiteLabel: boolean };
  executive: string;
  wins: string;
  challenges: string;
  learnings: string;
  recommendations: string;
  comments: string;
};

const toLines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 30);

/** Period presets per report type, computed from today (UTC dates). */
function presetPeriod(type: string, today = new Date()) {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  const yesterday = utc(y, m, today.getUTCDate() - 1);
  switch (type) {
    case "DAILY":
      return { from: d(yesterday), to: d(yesterday) };
    case "WEEKLY":
      return { from: d(utc(y, m, today.getUTCDate() - 7)), to: d(yesterday) };
    case "ANNUAL":
      return { from: d(utc(y - 1, 0, 1)), to: d(utc(y - 1, 11, 31)) };
    default:
      return { from: d(utc(y, m - 1, 1)), to: d(utc(y, m, 0)) };
  }
}

export function ReportBuilder({
  clients,
  users,
  types,
  kpiOptions,
  chartOptions,
  typeDefaults,
  initial,
}: {
  clients: ClientOpt[];
  users: { id: string; name: string }[];
  types: string[];
  kpiOptions: string[];
  chartOptions: string[];
  typeDefaults: Record<string, { kpis: string[]; charts: string[] }>;
  initial?: BuilderInitial;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const first = clients[0];
  const firstPeriod = presetPeriod("MONTHLY_CLIENT");
  const [s, setS] = useState<BuilderInitial>(
    initial ?? {
      clientId: first?.id ?? "",
      type: "MONTHLY_CLIENT",
      title: "",
      periodStart: firstPeriod.from,
      periodEnd: firstPeriod.to,
      platforms: [],
      kpis: typeDefaults.MONTHLY_CLIENT.kpis,
      charts: typeDefaults.MONTHLY_CLIENT.charts,
      compare: "prev",
      theme: { primary: first?.colors[0], accent: first?.colors[1], logoUrl: first?.logoUrl ?? "", whiteLabel: false },
      executive: "",
      wins: "",
      challenges: "",
      learnings: "",
      recommendations: "",
      comments: "",
    },
  );
  const [actions, setActions] = useState<Action[]>([]);
  const client = clients.find((c) => c.id === s.clientId);
  const set = <K extends keyof BuilderInitial>(k: K, v: BuilderInitial[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const toggle = (k: "platforms" | "kpis" | "charts", v: string) => set(k, s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v]);
  const suggestedTitle = useMemo(() => `${client?.name ?? ""} — ${t(`reports.type.${s.type}`)}`, [client, s.type, t]);

  const chip = (active: boolean) =>
    cx("rounded-full border px-2.5 py-1 text-xs transition", active ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:bg-surface-2");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveReport({
            id: s.id,
            clientId: s.clientId,
            type: s.type,
            title: s.title.trim() || suggestedTitle,
            periodStart: s.periodStart,
            periodEnd: s.periodEnd,
            platforms: s.platforms,
            kpis: s.kpis,
            charts: s.charts,
            compare: s.compare,
            theme: { ...s.theme, logoUrl: s.theme.logoUrl || "" },
            executive: s.executive,
            wins: toLines(s.wins),
            challenges: toLines(s.challenges),
            learnings: toLines(s.learnings),
            recommendations: toLines(s.recommendations),
            comments: s.comments,
            nextActions: actions.filter((a) => a.title.trim()),
          });
          if (r.ok && r.data) router.push(`/reports/${r.data.id}`);
          else if (!r.ok) setResult({ tone: "bad", text: errorText(r.error) });
        });
      }}
    >
      <Card>
        <CardHeader title={t("reports.builder.basics")} />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("filter.client")} htmlFor="rb-client">
            <Select
              id="rb-client"
              value={s.clientId}
              disabled={Boolean(s.id)}
              onChange={(e) => {
                const c = clients.find((x) => x.id === e.target.value);
                setS((prev) => ({ ...prev, clientId: e.target.value, platforms: [], theme: { ...prev.theme, primary: c?.colors[0], accent: c?.colors[1], logoUrl: c?.logoUrl ?? "" } }));
              }}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field label={t("reports.col.type")} htmlFor="rb-type">
            <Select
              id="rb-type"
              value={s.type}
              onChange={(e) => {
                const type = e.target.value;
                const p = presetPeriod(type);
                setS((prev) => ({ ...prev, type, kpis: typeDefaults[type].kpis, charts: typeDefaults[type].charts, periodStart: p.from, periodEnd: p.to }));
              }}
              options={types.map((x) => ({ value: x, label: t(`reports.type.${x}`) }))}
            />
          </Field>
          <Field label={t("reports.col.title")} htmlFor="rb-title">
            <Input id="rb-title" value={s.title} maxLength={200} placeholder={suggestedTitle} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label={t("ui.from")} htmlFor="rb-from">
            <Input id="rb-from" type="date" required value={s.periodStart} onChange={(e) => set("periodStart", e.target.value)} />
          </Field>
          <Field label={t("ui.to")} htmlFor="rb-to">
            <Input id="rb-to" type="date" required value={s.periodEnd} min={s.periodStart} onChange={(e) => set("periodEnd", e.target.value)} />
          </Field>
          <Field label={t("ui.compareTo")} htmlFor="rb-cmp">
            <Select
              id="rb-cmp"
              value={s.compare}
              onChange={(e) => set("compare", e.target.value as BuilderInitial["compare"])}
              options={[
                { value: "prev", label: t("ui.previousPeriod") },
                { value: "yoy", label: t("ui.previousYear") },
                { value: "none", label: t("ui.noComparison") },
              ]}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.builder.content")} subtitle={t("reports.builder.contentHint")} />
        <CardBody className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted">{t("reports.builder.platforms")}</legend>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chip(s.platforms.length === 0)} onClick={() => set("platforms", [])} aria-pressed={s.platforms.length === 0}>
                {t("ui.all")}
              </button>
              {(client?.platforms ?? []).map((p) => (
                <button type="button" key={p} className={chip(s.platforms.includes(p))} onClick={() => toggle("platforms", p)} aria-pressed={s.platforms.includes(p)}>
                  {t(`platform.${p}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted">{t("reports.builder.kpis")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {kpiOptions.map((k) => (
                <button type="button" key={k} className={chip(s.kpis.includes(k))} onClick={() => toggle("kpis", k)} aria-pressed={s.kpis.includes(k)}>
                  {t(`kpi.${k}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted">{t("reports.builder.charts")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {chartOptions.map((k) => (
                <button type="button" key={k} className={chip(s.charts.includes(k))} onClick={() => toggle("charts", k)} aria-pressed={s.charts.includes(k)}>
                  {t(`reports.chart.${k}`)}
                </button>
              ))}
            </div>
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.builder.branding")} subtitle={t("reports.builder.brandingHint")} />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("reports.builder.logoUrl")} htmlFor="rb-logo" className="sm:col-span-2">
            <Input id="rb-logo" type="url" value={s.theme.logoUrl ?? ""} placeholder="https://" onChange={(e) => set("theme", { ...s.theme, logoUrl: e.target.value })} />
          </Field>
          <Field label={t("reports.builder.primary")} htmlFor="rb-primary">
            <Input id="rb-primary" type="color" className="p-1" value={s.theme.primary ?? "#4f46e5"} onChange={(e) => set("theme", { ...s.theme, primary: e.target.value })} />
          </Field>
          <Field label={t("reports.builder.accent")} htmlFor="rb-accent">
            <Input id="rb-accent" type="color" className="p-1" value={s.theme.accent ?? "#0ea5e9"} onChange={(e) => set("theme", { ...s.theme, accent: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={s.theme.whiteLabel} onChange={(e) => set("theme", { ...s.theme, whiteLabel: e.target.checked })} />
            {t("reports.builder.whiteLabel")}
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.builder.narrative")} subtitle={t("reports.builder.narrativeHint")} />
        <CardBody className="grid gap-3 md:grid-cols-2">
          <Field label={t("reports.section.executive")} htmlFor="rb-exec" className="md:col-span-2">
            <Textarea id="rb-exec" rows={4} maxLength={5000} value={s.executive} onChange={(e) => set("executive", e.target.value)} />
          </Field>
          {(["wins", "challenges", "learnings", "recommendations"] as const).map((k) => (
            <Field key={k} label={t(`reports.section.${k}`)} htmlFor={`rb-${k}`} hint={t("reports.builder.onePerLine")}>
              <Textarea id={`rb-${k}`} rows={4} value={s[k]} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
          <Field label={t("reports.section.comments")} htmlFor="rb-comments" className="md:col-span-2">
            <Textarea id="rb-comments" rows={3} maxLength={5000} value={s.comments} onChange={(e) => set("comments", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("reports.section.nextActions")} subtitle={t("reports.builder.actionsHint")} />
        <CardBody className="space-y-2">
          {actions.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_180px_150px_130px_auto] sm:items-end">
              <Field label={t("tasks.col.title")} htmlFor={`act-t-${i}`}>
                <Input id={`act-t-${i}`} value={a.title} maxLength={300} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              </Field>
              <Field label={t("ui.owner")} htmlFor={`act-o-${i}`}>
                <Select id={`act-o-${i}`} value={a.assigneeId} placeholder="—" onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, assigneeId: e.target.value } : x)))} options={users.map((u) => ({ value: u.id, label: u.name }))} />
              </Field>
              <Field label={t("ui.dueDate")} htmlFor={`act-d-${i}`}>
                <Input id={`act-d-${i}`} type="date" value={a.dueDate} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
              </Field>
              <Field label={t("ui.priority")} htmlFor={`act-p-${i}`}>
                <Select id={`act-p-${i}`} value={a.priority} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, priority: e.target.value } : x)))} options={["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => ({ value: p, label: t(`priority.${p}`) }))} />
              </Field>
              <Button type="button" variant="ghost" size="sm" aria-label={t("ui.delete")} onClick={() => setActions(actions.filter((_, j) => j !== i))}>
                <Trash2 className="size-4 text-bad" aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" onClick={() => setActions([...actions, { title: "", assigneeId: "", dueDate: "", priority: "MEDIUM" }])}>
            <Plus className="size-4" aria-hidden /> {t("reports.builder.addAction")}
          </Button>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !s.clientId || s.kpis.length === 0}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {s.id ? t("ui.save") : t("reports.builder.create")}
        </Button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}
