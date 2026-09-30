"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { Bell, Languages, LogOut, Menu, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { setLocale, setTheme, logout } from "@/app/actions/preferences";
import { Sidebar } from "./sidebar";
import { FilterBar, type FilterOptions } from "./filter-bar";
import { NO_FILTER_BAR, type NavGroup } from "./nav";

export function AppShell({
  children,
  groups,
  brandName,
  logoUrl,
  brandColor,
  user,
  unread,
  filterOptions,
  theme,
}: {
  children: React.ReactNode;
  groups: NavGroup[];
  brandName: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  user: { name: string; email: string; roleLabel: string };
  unread: number;
  filterOptions: FilterOptions;
  theme: "light" | "dark";
}) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [, start] = useTransition();
  const showFilters = !NO_FILTER_BAR.some((p) => pathname.startsWith(p));

  return (
    <div className="flex min-h-dvh" style={brandColor ? ({ "--brand": brandColor } as React.CSSProperties) : undefined}>
      <Suspense>
        <Sidebar groups={groups} brandName={brandName} logoUrl={logoUrl} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur no-print">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <button className="rounded-lg p-2 hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("nav.menu")}>
              <Menu className="size-5" />
            </button>
            <div className="min-w-0 flex-1" />
            <button
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"
              onClick={() => start(() => setLocale(locale === "ar" ? "en" : "ar"))}
              aria-label={t("ui.language")}
            >
              <Languages className="size-4" /> <span className="hidden sm:inline">{locale === "ar" ? "English" : "العربية"}</span>
            </button>
            <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => start(() => setTheme(theme === "dark" ? "light" : "dark"))} aria-label={t("ui.theme")}>
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <Link href="/notifications" className="relative rounded-lg p-2 hover:bg-surface-2" aria-label={t("nav.notifications")}>
              <Bell className="size-4" />
              {unread > 0 && <span className="num absolute -top-0.5 -end-0.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <div className="hidden text-end leading-tight sm:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-[11px] text-subtle">{user.roleLabel}</p>
            </div>
            <form action={logout}>
              <button className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-bad" aria-label={t("ui.logout")} title={t("ui.logout")}>
                <LogOut className="size-4 flip-rtl" />
              </button>
            </form>
          </div>
          {showFilters && (
            <div className="border-t border-border px-3 py-2 sm:px-5">
              <Suspense>
                <FilterBar options={filterOptions} />
              </Suspense>
            </div>
          )}
        </header>
        <main className="flex-1 px-3 py-5 sm:px-5 lg:px-7">{children}</main>
      </div>
    </div>
  );
}
