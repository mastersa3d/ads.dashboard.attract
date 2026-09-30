"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, ExternalLink, Pencil, Repeat, Timer, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtDate, fmtNumber, type Locale } from "@/lib/format";
import { Badge, Button, EmptyState, Select, cx, inputClass } from "@/components/ui/primitives";
import { SERIES_COLORS } from "@/components/charts/charts";
import { deleteCompetitorAd } from "@/app/actions/competitors";
import { ActionButton } from "./action-form";
import { AdForm, CONTENT_TYPES, FUNNELS, type AdFormValue } from "./ad-form";

export type AdView = AdFormValue & {
  competitorId: string;
  competitor: string;
  status: "NEW" | "ACTIVE" | "STOPPED";
  runningDays: number;
  isNew: boolean;
  longRunning: boolean;
};

const STATUS_TONE = { NEW: "info", ACTIVE: "good", STOPPED: "neutral" } as const;

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

/** Month labels for the last `n` months ending with the current one (yyyy-mm). */
function lastMonths(n: number) {
  const now = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

/** Competitor ads: filters, KPIs, monthly timeline, and cards with the full creative analysis. */
export function AdsExplorer({ ads, competitors, canEdit, profileHref, clientQuery }: { ads: AdView[]; competitors: { id: string; name: string }[]; canEdit: boolean; profileHref?: boolean; clientQuery: string }) {
  const { t, locale } = useI18n();
  const [f, setF] = useState({ comp: "", status: "", platform: "", format: "", funnel: "", flag: "", period: "all", q: "" });
  const [limit, setLimit] = useState(12);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setF((s) => ({ ...s, [k]: e.target.value }));
    setLimit(12);
  };

  const platforms = useMemo(() => [...new Set(ads.map((a) => a.platform))], [ads]);
  const filtered = useMemo(() => {
    const now = Date.now();
    const days = f.period === "all" ? null : Number(f.period);
    const q = f.q.trim().toLowerCase();
    return ads.filter((a) => {
      if (f.comp && a.competitorId !== f.comp) return false;
      if (f.status === "ACTIVE" && !a.isActive) return false;
      if (f.status && f.status !== "ACTIVE" && a.status !== f.status) return false;
      if (f.platform && a.platform !== f.platform) return false;
      if (f.format && a.format !== f.format) return false;
      if (f.funnel && a.funnelGuess !== f.funnel) return false;
      if (f.flag === "long" && !a.longRunning) return false;
      if (f.flag === "relaunched" && !a.relaunched) return false;
      if (f.flag === "new" && !a.isNew) return false;
      if (days && new Date(a.lastSeen).getTime() < now - days * 86_400_000) return false;
      if (q && ![a.creativeIdea, a.hook, a.offer, a.message, a.cta, a.product, a.competitor].some((x) => x?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [ads, f]);

  const months = useMemo(() => lastMonths(12), []);
  const compNames = useMemo(() => [...new Set(filtered.map((a) => a.competitor))], [filtered]);
  const timeline = useMemo(
    () =>
      months.map((m) => {
        const row: Record<string, string | number> = { label: fmtDate(m + "-01T00:00:00Z", locale as Locale, { month: "short", year: "2-digit" }) };
        // index keys: competitor names may contain dots, which Recharts reads as nested paths
        compNames.forEach((c, i) => (row[`c${i}`] = filtered.filter((a) => a.competitor === c && monthKey(a.firstSeen) === m).length));
        return row;
      }),
    [months, compNames, filtered, locale],
  );

  const kpis = [
    [t("competitors.ads.kpi.active"), filtered.filter((a) => a.isActive).length],
    [t("competitors.ads.kpi.new"), filtered.filter((a) => a.isNew).length],
    [t("competitors.ads.kpi.stopped"), filtered.filter((a) => !a.isActive).length],
    [t("competitors.ads.kpi.long"), filtered.filter((a) => a.longRunning).length],
    [t("competitors.ads.kpi.relaunched"), filtered.filter((a) => a.relaunched).length],
  ] as const;

  function exportCsv() {
    const cols: [string, (a: AdView) => string | number | null][] = [
      [t("competitors.ads.competitor"), (a) => a.competitor],
      [t("ui.status"), (a) => t(`competitors.ads.status.${a.status}`)],
      [t("filter.platform"), (a) => t(`platform.${a.platform}`)],
      [t("competitors.ads.firstSeen"), (a) => a.firstSeen.slice(0, 10)],
      [t("competitors.ads.lastSeen"), (a) => a.lastSeen.slice(0, 10)],
      [t("competitors.ads.runningDays"), (a) => a.runningDays],
      [t("competitors.ads.format"), (a) => (a.format ? t(`contentType.${a.format}`) : "")],
      [t("competitors.ads.placements"), (a) => a.placements.join(" | ")],
      [t("competitors.ads.variants"), (a) => a.variantCount],
      [t("competitors.ads.relaunched"), (a) => (a.relaunched ? t("ui.yes") : t("ui.no"))],
      [t("competitors.ads.creativeIdea"), (a) => a.creativeIdea],
      [t("competitors.ads.hook"), (a) => a.hook],
      [t("competitors.ads.offer"), (a) => a.offer],
      [t("competitors.ads.message"), (a) => a.message],
      [t("competitors.ads.cta"), (a) => a.cta],
      [t("competitors.ads.product"), (a) => a.product],
      [t("competitors.ads.audience"), (a) => a.audienceGuess],
      [t("competitors.ads.funnel"), (a) => (a.funnelGuess ? t(`funnel.${a.funnelGuess}`) : "")],
      [t("competitors.ads.landingPage"), (a) => a.landingPage],
      [t("competitors.ads.spendMin"), (a) => a.spendMin],
      [t("competitors.ads.spendMax"), (a) => a.spendMax],
      [t("ui.source"), (a) => t(`source.${a.source}`)],
      [t("competitors.ads.libraryUrl"), (a) => a.libraryUrl],
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const lines = [cols.map((c) => esc(c[0])).join(","), ...filtered.map((a) => cols.map((c) => esc(c[1](a))).join(","))];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = "competitor-ads.csv";
    el.click();
    URL.revokeObjectURL(el.href);
  }

  const opt = (xs: readonly string[], prefix: string) => xs.map((x) => ({ value: x, label: t(`${prefix}.${x}`) }));

  return (
    <div className="space-y-4">
      <div className="grid gap-2 px-4 pt-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 no-print">
        <input value={f.q} onChange={set("q")} placeholder={t("ui.search")} aria-label={t("ui.search")} className={cx(inputClass, "xl:col-span-2")} />
        {competitors.length > 1 && <Select aria-label={t("competitors.ads.competitor")} value={f.comp} onChange={set("comp")} placeholder={t("competitors.ads.allCompetitors")} options={competitors.map((c) => ({ value: c.id, label: c.name }))} />}
        <Select aria-label={t("ui.status")} value={f.status} onChange={set("status")} placeholder={t("competitors.ads.allStatuses")} options={opt(["ACTIVE", "NEW", "STOPPED"], "competitors.ads.status")} />
        <Select aria-label={t("filter.platform")} value={f.platform} onChange={set("platform")} placeholder={t("competitors.ads.allPlatforms")} options={opt(platforms, "platform")} />
        <Select aria-label={t("competitors.ads.format")} value={f.format} onChange={set("format")} placeholder={t("competitors.ads.allFormats")} options={opt(CONTENT_TYPES, "contentType")} />
        <Select aria-label={t("competitors.ads.funnel")} value={f.funnel} onChange={set("funnel")} placeholder={t("competitors.ads.allFunnels")} options={opt(FUNNELS, "funnel")} />
        <Select
          aria-label={t("competitors.ads.flag")}
          value={f.flag}
          onChange={set("flag")}
          placeholder={t("competitors.ads.allAds")}
          options={[
            { value: "new", label: t("competitors.ads.flag.new") },
            { value: "long", label: t("competitors.ads.flag.long") },
            { value: "relaunched", label: t("competitors.ads.flag.relaunched") },
          ]}
        />
        <Select
          aria-label={t("competitors.ads.period")}
          value={f.period}
          onChange={set("period")}
          options={[
            { value: "all", label: t("competitors.ads.period.all") },
            { value: "30", label: t("competitors.ads.period.30") },
            { value: "90", label: t("competitors.ads.period.90") },
            { value: "365", label: t("competitors.ads.period.365") },
          ]}
        />
      </div>

      <dl className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-5">
        {kpis.map(([label, n]) => (
          <div key={label} className="rounded-lg border border-border p-2.5">
            <dt className="truncate text-xs text-muted">{label}</dt>
            <dd className="num text-lg font-semibold">{fmtNumber(n, locale as Locale)}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4">
        <h4 className="mb-2 text-xs font-medium text-muted">{t("competitors.ads.timeline")}</h4>
        {filtered.length === 0 ? null : (
          <div style={{ height: 240 }} dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="var(--subtle)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--subtle)" fontSize={11} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
                  formatter={(v, name) => [fmtNumber(Number(v), locale as Locale), String(name)]}
                />
                {compNames.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {compNames.map((c, i) => (
                  <Bar key={c} dataKey={`c${i}`} name={c} stackId="a" fill={SERIES_COLORS[i % SERIES_COLORS.length]} maxBarSize={28} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-4">
        <span className="text-xs text-subtle">
          <span className="num">{fmtNumber(filtered.length, locale as Locale)}</span> {t("competitors.ads.count")}
        </span>
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!filtered.length} className="no-print">
          <Download className="size-3.5" aria-hidden /> CSV
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={t("competitors.ads.empty")} hint={t("competitors.ads.emptyHint")} />
      ) : (
        <ul className="grid gap-3 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, limit).map((a) => (
            <AdCard key={a.id} a={a} canEdit={canEdit} profileHref={profileHref ? `/competitors/${a.competitorId}?${clientQuery}` : undefined} />
          ))}
        </ul>
      )}
      {filtered.length > limit && (
        <div className="px-4 pb-4 text-center">
          <Button size="sm" onClick={() => setLimit((l) => l + 12)}>
            {t("competitors.ads.showMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function AdCard({ a, canEdit, profileHref }: { a: AdView; canEdit: boolean; profileHref?: string }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const lc = locale as Locale;
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="grid grid-cols-[7.5rem_1fr] gap-2">
        <dt className="text-subtle">{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    ) : null;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[a.status]}>{t(`competitors.ads.status.${a.status}`)}</Badge>
        {a.longRunning && (
          <Badge tone="warning">
            <Timer className="size-3" aria-hidden /> {t("competitors.ads.flag.long")}
          </Badge>
        )}
        {a.relaunched && (
          <Badge tone="brand">
            <Repeat className="size-3" aria-hidden /> {t("competitors.ads.relaunched")}
          </Badge>
        )}
        <Badge tone={a.source === "DEMO" ? "demo" : a.source === "API" ? "info" : "neutral"}>{t(`source.${a.source}`)}</Badge>
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {profileHref ? (
            <Link href={profileHref} className="text-sm font-semibold text-brand hover:underline">
              {a.competitor}
            </Link>
          ) : (
            <p className="text-sm font-semibold">{a.creativeIdea ?? t("competitors.ads.untitled")}</p>
          )}
          <p className="text-subtle">
            {t(`platform.${a.platform}`)}
            {a.format && <> · {t(`contentType.${a.format}`)}</>}
            {a.placements.length > 0 && <> · {a.placements.join(", ")}</>}
          </p>
        </div>
        {a.libraryUrl && (
          <a href={a.libraryUrl} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 text-brand" title={t("competitors.ads.viewInLibrary")} aria-label={t("competitors.ads.viewInLibrary")}>
            <ExternalLink className="size-4" aria-hidden />
          </a>
        )}
      </div>
      <p className="num text-muted">
        {t("competitors.ads.firstSeen")}: {fmtDate(a.firstSeen, lc)} · {a.isActive ? t("competitors.ads.runningFor", { n: a.runningDays }) : t("competitors.ads.ranFor", { n: a.runningDays, date: fmtDate(a.lastSeen, lc) })} ·{" "}
        {t("competitors.ads.variantsN", { n: a.variantCount })}
      </p>
      <dl className="space-y-1">
        {profileHref && row(t("competitors.ads.creativeIdea"), a.creativeIdea)}
        {row(t("competitors.ads.hook"), a.hook)}
        {row(t("competitors.ads.offer"), a.offer)}
        {row(t("competitors.ads.message"), a.message && <span className="line-clamp-3">{a.message}</span>)}
        {row(t("competitors.ads.cta"), a.cta)}
        {row(t("competitors.ads.product"), a.product)}
        {row(t("competitors.ads.audience"), a.audienceGuess && <>{a.audienceGuess} <span className="text-subtle">({t("competitors.ads.expected")})</span></>)}
        {row(t("competitors.ads.funnel"), a.funnelGuess && <>{t(`funnel.${a.funnelGuess}`)} <span className="text-subtle">({t("competitors.ads.expected")})</span></>)}
        {row(
          t("competitors.ads.landingPage"),
          a.landingPage && (
            <a href={a.landingPage} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline" dir="ltr">
              {a.landingPage.replace(/^https?:\/\//, "")}
            </a>
          ),
        )}
        {row(
          t("competitors.ads.officialSpend"),
          (a.spendMin != null || a.spendMax != null) && (
            <span className="num" title={t("competitors.ads.officialSpendHint")}>
              {fmtNumber(a.spendMin, lc)}–{a.spendMax == null ? "∞" : fmtNumber(a.spendMax, lc)} {a.spendCurrency ?? ""}{" "}
              <span className="text-subtle">({t("competitors.ads.officialSource")})</span>
            </span>
          ),
        )}
      </dl>
      {canEdit && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1 no-print">
          <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            <Pencil className="size-3.5" aria-hidden /> {t("ui.edit")}
          </Button>
          <ActionButton action={deleteCompetitorAd} hidden={{ adId: a.id }} label={t("ui.delete")} variant="ghost" confirm={t("competitors.confirmDelete")} icon={<Trash2 className="size-3.5" aria-hidden />} />
        </div>
      )}
      {editing && (
        <div className="rounded-lg bg-surface-2 p-2">
          <AdForm competitorId={a.competitorId} value={a} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}
