"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronsLeft, X, LayoutDashboard, LineChart, Megaphone, Building2, Compass, Wallet, Scale, CalendarDays, Library, CheckCheck, Swords, TrendingUp, Gauge, FileBarChart, ListChecks, Bell, Users, Settings, ScrollText, LifeBuoy, Circle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cx } from "@/components/ui/primitives";
import type { NavGroup } from "./nav";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { LayoutDashboard, LineChart, Megaphone, Building2, Compass, Wallet, Scale, CalendarDays, Library, CheckCheck, Swords, TrendingUp, Gauge, FileBarChart, ListChecks, Bell, Users, Settings, ScrollText, LifeBuoy, Circle };

const FILTER_CARRY = ["client", "brand", "account", "platform", "from", "to", "compare"];

export function Sidebar({ groups, brandName, logoUrl, mobileOpen, onClose }: { groups: NavGroup[]; brandName: string; logoUrl?: string | null; mobileOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
    } catch {}
  }, []);
  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });
  }

  // keep the core filters when navigating between pages
  const carry = new URLSearchParams();
  for (const k of FILTER_CARRY) {
    const v = sp.get(k);
    if (v) carry.set(k, v);
  }
  const qs = carry.toString() ? `?${carry}` : "";

  const content = (isMobile: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cx("flex h-14 items-center gap-2 border-b border-border px-3", collapsed && !isMobile && "justify-center")}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-8 rounded-lg object-contain" />
        ) : (
          <div className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-fg">{brandName.slice(0, 1)}</div>
        )}
        {(!collapsed || isMobile) && <span className="truncate text-sm font-semibold">{brandName}</span>}
        {isMobile && (
          <button onClick={onClose} className="ms-auto rounded p-1 hover:bg-surface-2" aria-label={t("ui.close")}>
            <X className="size-5" />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label={t("nav.menu")}>
        {groups.map((g) => (
          <div key={g.key} className="mb-3">
            {(!collapsed || isMobile) && <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const Icon = ICONS[it.icon] ?? Circle;
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href + qs}
                      onClick={isMobile ? onClose : undefined}
                      title={collapsed && !isMobile ? it.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                        active ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
                        collapsed && !isMobile && "justify-center px-0",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {(!collapsed || isMobile) && <span className="truncate">{it.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {!isMobile && (
        <button onClick={toggle} className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted hover:text-text" aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}>
          <ChevronsLeft className={cx("size-4 transition flip-rtl", collapsed && "rotate-180")} />
          {!collapsed && t("nav.collapse")}
        </button>
      )}
    </div>
  );

  return (
    <>
      <aside className={cx("sticky top-0 hidden h-dvh shrink-0 border-e border-border bg-surface transition-[width] lg:block no-print", collapsed ? "w-16" : "w-64")}>{content(false)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden no-print">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-surface shadow-xl">{content(true)}</aside>
        </div>
      )}
    </>
  );
}
