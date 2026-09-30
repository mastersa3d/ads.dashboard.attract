# Development conventions

Read this before adding a page, action or integration. The Executive Dashboard
(`src/app/(app)/dashboard/page.tsx`) is the reference implementation.

## Stack

Next.js 15 (App Router, server components + server actions) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 (tokens in `src/app/globals.css`) · Prisma 6 + PostgreSQL · Recharts · Zod ·
lucide-react icons · Anthropic SDK (optional AI) · Postgres-backed job queue (`worker/`).

## Local setup

```bash
cp .env.example .env         # set DATABASE_URL and ENCRYPTION_KEY (openssl rand -base64 32)
npm install
npx prisma migrate dev       # creates the schema
npm run db:seed              # DEMO workspace (every record flagged as demo)
npm run dev                  # http://localhost:3000 — admin@demo.local / Demo@12345
npm run worker               # background jobs (sync, alerts, scheduled reports)
```

## Page recipe

```tsx
// src/app/(app)/<route>/page.tsx  — a server component
import type { RawParams } from "@/lib/filters";
import { pageContext } from "@/lib/page";

export default async function Page({ searchParams }: { searchParams: Promise<RawParams> }) {
  const ctx = await pageContext(await searchParams, "analytics:view"); // auth + RBAC + filters + tenant scope
  const { t, locale, filters, scope, q, currency } = ctx;
  const rows = await db.contentItem.findMany({ where: { ...scope, /* filters */ } });
  ...
}
```

* **Tenant isolation is mandatory.** Every Prisma query on a client-owned model spreads
  `ctx.scope` (`{ clientId }`) into `where`. For models without `clientId`, filter through the
  relation (`{ campaign: ctx.scope }`, `{ competitor: ctx.scope }`, `{ plan: ctx.scope }`).
  Never trust an id from the URL/form without scoping it.
* **Performance data** goes through `src/lib/queries/performance.ts` with `ctx.q`
  (scope + reporting currency + FX). Don't aggregate `MetricDaily` by hand unless you also
  convert currencies (`lib/fx.ts`).
* **Filters** are URL search params (`lib/filters.ts`); the global `FilterBar` edits them. Pages
  read `ctx.filters` and must honour the ones relevant to them. Links between pages keep
  `ctx.query`.
* **Every chart / table** shows `<DataMeta source=… updated=… demo=… />` (source + last update +
  Demo badge). Estimates carry `estimate` / `<EstimateBadge>`.
* **States:** use `EmptyState`, `ErrorState`, `Callout`; add `loading.tsx` with `Skeleton`s for
  heavy routes.
* **Exports:** `<ExportMenu dataset="…" query={ctx.query} targetId="…" />` — CSV/Excel via
  `/api/export/[dataset]`, PDF via print CSS, PNG via html-to-image. `DataTable` also has CSV.

## Server actions

```ts
"use server";
export async function updateThing(input: unknown) {
  const user = await assertUser("content:edit");            // throws on no auth / no permission
  const data = schema.parse(input);                           // Zod-validate every input
  await assertClientAccess(user, data.clientId);              // tenant check
  const row = await db.thing.update(...);
  await audit(user, { action: "update", entity: "Thing", entityId: row.id, clientId: data.clientId, diff: data });
  revalidatePath("/route");
}
```

* Server actions are CSRF-protected by Next.js (same-origin check); route handlers that mutate
  must check `Origin` (see `lib/http.ts` `assertSameOrigin`).
* Permissions: `lib/rbac.ts` (`PERMISSIONS`, role defaults, per-user overrides).
* Write an `AuditLog` row for every create / update / delete / approve / reject / export / connect.
* Secrets: `lib/crypto.ts` `encrypt()` before saving; only `tokenLast4` ever reaches the browser.
  Never log tokens — `lib/logger.ts` redacts known keys.

## i18n (Arabic RTL / English LTR)

* All UI strings come from `src/lib/i18n/messages/<namespace>.ts` (`en` + `ar`, same keys).
  Server: `ctx.t("ns.key")` / `getI18n()`; client: `useI18n()`.
* Shared vocabulary (nav, KPIs, enums, statuses, platforms) lives in `common.ts` — reuse
  `t("kpi.cpl")`, `t("platform.META")`, `t("contentStatus.APPROVED")` etc.
* Layout must work in both directions: use logical Tailwind utilities (`ms-*`, `me-*`, `ps-*`,
  `pe-*`, `start-*`, `end-*`, `text-start`, `border-s`) — never `ml/mr/left/right`.
  Wrap numbers in `className="num"`; directional icons get `flip-rtl`.
* Format with `lib/format.ts` (`fmtMoney`, `fmtPct`, `fmtNumber`, `fmtDate`) — Latin digits.

## Design system

Tokens: `bg`, `surface`, `surface-2`, `border`, `text`, `muted`, `subtle`, `brand`, and status
colours `good` (green), `bad` (red), `warn` (orange), `info` (blue), `demo` (purple).
Components: `components/ui/primitives.tsx`, `kpi-card.tsx`, `data-table.tsx`, `export-menu.tsx`,
`components/charts/charts.tsx` (fixed categorical palette — never dual axis). Mobile first:
every page must work at 360px width (tables scroll horizontally, grids collapse).

## Data honesty

* Demo rows use `source = DEMO` / `Client.isDemo` — always badged.
* Estimates (forecasts, FX conversions, competitor intensity, best-time benchmarks) are labelled
  as estimates with method + confidence.
* AI (`lib/ai/claude.ts`) receives only tenant-scoped data, never invents numbers, and its
  output is stored as PENDING `AiRecommendation` until a human accepts it.
* No scraping. Competitor ads come from official ad-library APIs or manual entry.
