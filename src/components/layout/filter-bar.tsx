"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Bookmark, RotateCcw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { buttonClass, cx, inputClass } from "@/components/ui/primitives";
import { saveView, deleteView } from "@/app/actions/preferences";

export type FilterOptions = {
  clients: { id: string; name: string; brands: { id: string; name: string }[]; accounts: { id: string; name: string; platform: string; brandId: string | null }[] }[];
  platforms: string[];
  objectives: string[];
  funnels: string[];
  campaignStatuses: string[];
  contentStatuses: string[];
  contentTypes: string[];
  campaigns: { id: string; name: string; clientId: string }[];
  countries: string[];
  branches: string[];
  products: string[];
  audiences: string[];
  devices: string[];
  placements: string[];
  ages: string[];
  genders: string[];
  currencies: string[];
  managers: { id: string; name: string }[];
  creators: { id: string; name: string }[];
  savedViews: { id: string; name: string; path: string; query: string; shared: boolean; mine: boolean }[];
  lockedClientId?: string | null; // CLIENT users with a single client
};

const day = (d: Date) => d.toISOString().slice(0, 10);

function presetRange(key: string): [string, string] {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const back = (n: number) => new Date(today.getTime() - n * 86400000);
  switch (key) {
    case "7":
      return [day(back(6)), day(today)];
    case "90":
      return [day(back(89)), day(today)];
    case "month":
      return [day(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), day(today)];
    case "lastMonth": {
      const s = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const e = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return [day(s), day(e)];
    }
    case "year":
      return [day(new Date(Date.UTC(today.getUTCFullYear(), 0, 1))), day(today)];
    default:
      return [day(back(29)), day(today)];
  }
}

export function FilterBar({ options }: { options: FilterOptions }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [more, setMore] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [shared, setShared] = useState(false);

  const get = (k: string) => sp.get(k) ?? "";
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    start(() => router.push(`${pathname}?${q.toString()}`, { scroll: false }));
  };

  const clientId = options.lockedClientId ?? get("client");
  const client = options.clients.find((c) => c.id === clientId);
  const brands = client?.brands ?? options.clients.flatMap((c) => c.brands);
  const accounts = (client?.accounts ?? options.clients.flatMap((c) => c.accounts)).filter((a) => !get("brand") || a.brandId === get("brand"));
  const campaigns = options.campaigns.filter((c) => !clientId || c.clientId === clientId);

  const initialRange = presetRange("30");
  const from = get("from") || initialRange[0];
  const to = get("to") || initialRange[1];

  const advancedKeys = ["objective", "campaign", "status", "funnel", "mode", "country", "branch", "product", "audience", "device", "placement", "gender", "age", "currency", "manager", "creator", "ctype", "cstatus"];
  const activeAdvanced = advancedKeys.filter((k) => sp.get(k)).length;

  const sel = cx(inputClass, "h-8 w-auto min-w-0 max-w-44 pe-7 text-xs");
  const opt = (values: string[], prefix?: string) => values.map((v) => ({ value: v, label: prefix ? t(`${prefix}.${v}`) : v }));

  const advanced: { key: string; label: string; options: { value: string; label: string }[] }[] = useMemo(
    () => [
      { key: "objective", label: t("filter.objective"), options: opt(options.objectives, "objective") },
      { key: "campaign", label: t("filter.campaign"), options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
      { key: "status", label: t("filter.status"), options: opt(options.campaignStatuses, "campaignStatus") },
      { key: "funnel", label: t("filter.funnel"), options: opt(options.funnels, "funnel") },
      { key: "mode", label: t("filter.mode"), options: [{ value: "paid", label: t("filter.paid") }, { value: "organic", label: t("filter.organic") }] },
      { key: "country", label: t("filter.country"), options: opt(options.countries) },
      { key: "branch", label: t("filter.branch"), options: opt(options.branches) },
      { key: "product", label: t("filter.product"), options: opt(options.products) },
      { key: "audience", label: t("filter.audience"), options: opt(options.audiences) },
      { key: "device", label: t("filter.device"), options: opt(options.devices) },
      { key: "placement", label: t("filter.placement"), options: opt(options.placements) },
      { key: "gender", label: t("filter.gender"), options: opt(options.genders) },
      { key: "age", label: t("filter.age"), options: opt(options.ages) },
      { key: "currency", label: t("filter.currency"), options: opt(options.currencies) },
      { key: "manager", label: t("filter.manager"), options: options.managers.map((m) => ({ value: m.id, label: m.name })) },
      { key: "creator", label: t("filter.creator"), options: options.creators.map((m) => ({ value: m.id, label: m.name })) },
      { key: "ctype", label: t("filter.ctype"), options: opt(options.contentTypes, "contentType") },
      { key: "cstatus", label: t("filter.cstatus"), options: opt(options.contentStatuses, "contentStatus") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, campaigns, t],
  );

  function reset() {
    start(() => router.push(pathname));
  }

  async function onSaveView() {
    if (!viewName.trim()) return;
    await saveView({ name: viewName, path: pathname, query: sp.toString(), shared });
    setViewName("");
    setViewsOpen(false);
  }

  return (
    <div className={cx("flex flex-wrap items-center gap-2", pending && "opacity-70")} aria-busy={pending}>
      {!options.lockedClientId && options.clients.length > 1 && (
        <select aria-label={t("filter.client")} className={sel} value={clientId} onChange={(e) => set({ client: e.target.value || null, brand: null, account: null, campaign: null })}>
          <option value="">{t("filter.allClients")}</option>
          {options.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {brands.length > 1 && (
        <select aria-label={t("filter.brand")} className={sel} value={get("brand")} onChange={(e) => set({ brand: e.target.value || null, account: null })}>
          <option value="">
            {t("filter.brand")}: {t("ui.all")}
          </option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      <select aria-label={t("filter.account")} className={sel} value={get("account")} onChange={(e) => set({ account: e.target.value || null })}>
        <option value="">
          {t("filter.account")}: {t("ui.all")}
        </option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select aria-label={t("filter.platform")} className={sel} value={get("platform")} onChange={(e) => set({ platform: e.target.value || null })}>
        <option value="">
          {t("filter.platform")}: {t("ui.all")}
        </option>
        {options.platforms.map((p) => (
          <option key={p} value={p}>
            {t(`platform.${p}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={t("filter.period")}
        className={sel}
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          const [f, tt] = presetRange(e.target.value);
          set({ from: f, to: tt });
        }}
      >
        <option value="">{t("filter.period")}…</option>
        <option value="7">{t("filter.last7")}</option>
        <option value="30">{t("filter.last30")}</option>
        <option value="90">{t("filter.last90")}</option>
        <option value="month">{t("filter.thisMonth")}</option>
        <option value="lastMonth">{t("filter.lastMonth")}</option>
        <option value="year">{t("filter.thisYear")}</option>
      </select>
      <div className="flex items-center gap-1">
        <input type="date" aria-label={t("ui.from")} className={cx(inputClass, "num h-8 w-36 text-xs")} value={from} max={to} onChange={(e) => set({ from: e.target.value })} />
        <span className="text-subtle">–</span>
        <input type="date" aria-label={t("ui.to")} className={cx(inputClass, "num h-8 w-36 text-xs")} value={to} min={from} onChange={(e) => set({ to: e.target.value })} />
      </div>
      <select aria-label={t("ui.compareTo")} className={sel} value={get("compare") || "prev"} onChange={(e) => set({ compare: e.target.value === "prev" ? null : e.target.value })}>
        <option value="prev">{t("ui.previousPeriod")}</option>
        <option value="yoy">{t("ui.previousYear")}</option>
        <option value="none">{t("ui.noComparison")}</option>
      </select>

      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setMore(true)}>
        <SlidersHorizontal className="size-3.5" aria-hidden /> {t("ui.moreFilters")}
        {activeAdvanced > 0 && <span className="num rounded-full bg-brand px-1.5 text-[10px] text-brand-fg">{activeAdvanced}</span>}
      </button>

      <div className="relative">
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setViewsOpen((o) => !o)} aria-expanded={viewsOpen}>
          <Bookmark className="size-3.5" aria-hidden /> {t("ui.savedViews")}
        </button>
        {viewsOpen && (
          <div className="absolute end-0 z-40 mt-1 w-72 rounded-lg border border-border bg-surface p-2 shadow-lg">
            <ul className="max-h-60 space-y-0.5 overflow-y-auto">
              {options.savedViews.length === 0 && <li className="px-2 py-1 text-xs text-subtle">{t("ui.none")}</li>}
              {options.savedViews.map((v) => (
                <li key={v.id} className="flex items-center gap-1">
                  <button
                    className="min-w-0 flex-1 truncate rounded px-2 py-1 text-start text-sm hover:bg-surface-2"
                    onClick={() => {
                      setViewsOpen(false);
                      router.push(`${v.path}?${v.query}`);
                    }}
                  >
                    {v.name} {v.shared && <span className="text-[10px] text-info">· {t("ui.shareWithTeam")}</span>}
                  </button>
                  {v.mine && (
                    <button className="rounded p-1 text-subtle hover:text-bad" onClick={() => deleteView(v.id)} aria-label={t("ui.delete")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 space-y-1.5 border-t border-border pt-2">
              <input className={cx(inputClass, "h-8 text-xs")} placeholder={t("ui.viewName")} value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={80} />
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t("ui.shareWithTeam")}
              </label>
              <button className={cx(buttonClass("primary", "sm"), "w-full")} onClick={onSaveView} disabled={!viewName.trim()}>
                {t("ui.saveView")}
              </button>
            </div>
          </div>
        )}
      </div>

      {sp.toString() && (
        <button type="button" className={buttonClass("ghost", "sm")} onClick={reset}>
          <RotateCcw className="size-3.5" aria-hidden /> {t("ui.resetFilters")}
        </button>
      )}

      {more && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("ui.moreFilters")}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setMore(false)} />
          <div className="absolute inset-y-0 end-0 flex w-96 max-w-[92vw] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">{t("ui.moreFilters")}</h2>
              <button onClick={() => setMore(false)} className="rounded p-1 hover:bg-surface-2" aria-label={t("ui.close")}>
                <X className="size-5" />
              </button>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
              {advanced.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-xs text-muted">
                  {f.label}
                  <select className={cx(inputClass, "h-8 text-xs")} value={get(f.key)} onChange={(e) => set({ [f.key]: e.target.value || null })} disabled={f.options.length === 0}>
                    <option value="">{t("ui.all")}</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex gap-2 border-t border-border p-3">
              <button
                className={buttonClass("secondary")}
                onClick={() => {
                  set(Object.fromEntries(advancedKeys.map((k) => [k, null])));
                }}
              >
                <RotateCcw className="size-4" /> {t("ui.resetFilters")}
              </button>
              <button className={cx(buttonClass("primary"), "flex-1")} onClick={() => setMore(false)}>
                {t("ui.apply")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
