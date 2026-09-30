import type { Permission } from "@/lib/rbac";

export type NavItem = { href: string; label: string; icon: string; permission: Permission; section: string };
export type NavGroup = { key: string; label: string; items: NavItem[] };

/** Single source for sidebar structure. `section` is the key used by Client.hiddenSections (white label). */
export const NAV: { group: string; items: Omit<NavItem, "label">[] }[] = [
  {
    group: "nav.overview",
    items: [
      { href: "/dashboard", icon: "LayoutDashboard", permission: "dashboard:view", section: "dashboard" },
      { href: "/analytics", icon: "LineChart", permission: "analytics:view", section: "analytics" },
      { href: "/campaigns", icon: "Megaphone", permission: "campaigns:view", section: "campaigns" },
      { href: "/clients", icon: "Building2", permission: "clients:view", section: "clients" },
    ],
  },
  {
    group: "nav.plan",
    items: [
      { href: "/strategy", icon: "Compass", permission: "strategy:view", section: "strategy" },
      { href: "/budget", icon: "Wallet", permission: "budget:view", section: "budget" },
      { href: "/plan-vs-actual", icon: "Scale", permission: "budget:view", section: "plan-vs-actual" },
    ],
  },
  {
    group: "nav.content",
    items: [
      { href: "/calendar", icon: "CalendarDays", permission: "content:view", section: "calendar" },
      { href: "/library", icon: "Library", permission: "content:view", section: "library" },
      { href: "/approvals", icon: "CheckCheck", permission: "content:view", section: "approvals" },
    ],
  },
  {
    group: "nav.intelligence",
    items: [
      { href: "/competitors", icon: "Swords", permission: "competitors:view", section: "competitors" },
      { href: "/trends", icon: "TrendingUp", permission: "trends:view", section: "trends" },
      { href: "/benchmarks", icon: "Gauge", permission: "benchmarks:view", section: "benchmarks" },
    ],
  },
  {
    group: "nav.reporting",
    items: [
      { href: "/reports", icon: "FileBarChart", permission: "reports:view", section: "reports" },
      { href: "/tasks", icon: "ListChecks", permission: "tasks:view", section: "tasks" },
      { href: "/notifications", icon: "Bell", permission: "dashboard:view", section: "notifications" },
    ],
  },
  {
    group: "nav.admin",
    items: [
      { href: "/users", icon: "Users", permission: "users:view", section: "users" },
      { href: "/settings", icon: "Settings", permission: "settings:view", section: "settings" },
      { href: "/audit", icon: "ScrollText", permission: "audit:view", section: "audit" },
      { href: "/help", icon: "LifeBuoy", permission: "dashboard:view", section: "help" },
    ],
  },
];

export const NAV_LABEL: Record<string, string> = {
  "/dashboard": "nav.dashboard",
  "/analytics": "nav.analytics",
  "/campaigns": "nav.campaigns",
  "/clients": "nav.clients",
  "/strategy": "nav.strategy",
  "/budget": "nav.budget",
  "/plan-vs-actual": "nav.planVsActual",
  "/calendar": "nav.calendar",
  "/library": "nav.library",
  "/approvals": "nav.approvals",
  "/competitors": "nav.competitors",
  "/trends": "nav.trends",
  "/benchmarks": "nav.benchmarks",
  "/reports": "nav.reports",
  "/tasks": "nav.tasks",
  "/notifications": "nav.notifications",
  "/users": "nav.users",
  "/settings": "nav.settings",
  "/audit": "nav.audit",
  "/help": "nav.help",
};

/** Pages where the global performance filter bar is not relevant. */
export const NO_FILTER_BAR = ["/settings", "/users", "/audit", "/help", "/notifications", "/onboarding", "/clients/new"];
