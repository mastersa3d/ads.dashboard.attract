import Link from "next/link";
import { Building2, UserRound, Package, Link2 } from "lucide-react";
import type { TFunction } from "@/lib/i18n/translate";
import { Badge, DemoBadge } from "@/components/ui/primitives";
import { countryName } from "@/components/admin/constants";

export type ClientCardData = {
  id: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColors: string[];
  industry: string | null;
  country: string | null;
  currency: string;
  isDemo: boolean;
  archived: boolean;
  package: string | null;
  accounts: number;
  brands: number;
  manager: string | null;
};

export function ClientLogo({ name, logoUrl, color, size = "md" }: { name: string; logoUrl: string | null; color?: string; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "size-16 text-2xl" : "size-12 text-lg";
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- logos live on arbitrary client hosts
    <img src={logoUrl} alt="" className={`${cls} shrink-0 rounded-xl border border-border bg-surface object-contain p-1`} />
  ) : (
    <div className={`${cls} grid shrink-0 place-items-center rounded-xl font-bold text-white`} style={{ background: color ?? "var(--brand)" }} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </div>
  );
}

/** Client summary card for the /clients grid. */
export function ClientCard({ c, t, locale }: { c: ClientCardData; t: TFunction; locale: string }) {
  const [primary, secondary] = c.brandColors;
  const cover = c.coverUrl
    ? { backgroundImage: `url("${c.coverUrl.replace(/"/g, "")}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: `linear-gradient(135deg, ${primary ?? "var(--brand)"}, ${secondary ?? primary ?? "var(--brand)"})` };
  return (
    <Link href={`/clients/${c.id}`} className="card group block overflow-hidden rounded-card border border-border bg-surface shadow-card transition hover:border-brand/50 focus-visible:outline-2 focus-visible:outline-brand">
      <div className="h-16" style={cover} aria-hidden />
      <div className="-mt-7 space-y-3 px-4 pb-4">
        <div className="flex items-end justify-between gap-2">
          <ClientLogo name={c.name} logoUrl={c.logoUrl} color={primary} />
          <div className="flex flex-wrap justify-end gap-1">
            {c.isDemo && <DemoBadge label={t("ui.demoData")} hint={t("ui.demoDataHint")} />}
            {c.archived && <Badge tone="warning">{t("clients.archived")}</Badge>}
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold group-hover:text-brand">{c.name}</h2>
          <p className="truncate text-xs text-muted">
            {c.industry ?? t("clients.noIndustry")} · {countryName(c.country, locale)}
          </p>
        </div>
        <div className="flex items-center gap-1.5" aria-label={t("clients.brandColors")}>
          {c.brandColors.length ? (
            c.brandColors.map((col) => <span key={col} className="size-4 rounded-full border border-border" style={{ background: col }} title={col} />)
          ) : (
            <span className="text-[11px] text-subtle">{t("clients.noColors")}</span>
          )}
          <Badge className="ms-auto num">{c.currency}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-muted">
            <Link2 className="size-3.5 shrink-0" aria-hidden />
            <dt className="sr-only">{t("clients.accounts")}</dt>
            <dd>
              <span className="num font-medium text-text">{c.accounts}</span> {t("clients.accountsShort")}
            </dd>
          </div>
          <div className="flex items-center gap-1.5 text-muted">
            <Building2 className="size-3.5 shrink-0" aria-hidden />
            <dt className="sr-only">{t("clients.brands")}</dt>
            <dd>
              <span className="num font-medium text-text">{c.brands}</span> {t("clients.brandsShort")}
            </dd>
          </div>
          <div className="col-span-2 flex min-w-0 items-center gap-1.5 text-muted">
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            <dt className="sr-only">{t("clients.accountManager")}</dt>
            <dd className="truncate">{c.manager ?? t("clients.noManager")}</dd>
          </div>
          <div className="col-span-2 flex min-w-0 items-center gap-1.5 text-muted">
            <Package className="size-3.5 shrink-0" aria-hidden />
            <dt className="sr-only">{t("clients.package")}</dt>
            <dd className="truncate">{c.package ?? "—"}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}
