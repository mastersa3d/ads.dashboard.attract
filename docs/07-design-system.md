# 07 · Design System

> **ملخص بالعربية**
>
> نظام التصميم مبني على متغيرات CSS في `src/app/globals.css` مع Tailwind v4، ويدعم الوضع الفاتح والداكن.
> - **ألوان الحالة لها معنى ثابت:** الأخضر = جيد، الأحمر = يحتاج إجراء، البرتقالي = تحذير، الأزرق = معلومة، البنفسجي = بيانات تجريبية.
> - **الخطوط:** Inter للإنجليزية وIBM Plex Sans Arabic للعربية.
> - **الاتجاه:** عند اختيار العربية تنعكس الواجهة بالكامل (من اليمين لليسار) باستخدام خصائص منطقية (`ms-*`، `pe-*`، `text-start`)، مع إبقاء الأرقام من اليسار لليمين.
> - **الرسوم البيانية:** لوحة ألوان ثابتة مختبرة لعمى الألوان، اللون يتبع السلسلة وليس ترتيبها، ولا نستخدم محورين رأسيين أبدًا.
> - **الحالات:** هيكل تحميل، حالة فارغة، حالة خطأ — في كل صفحة. **إمكانية الوصول** وفق WCAG 2.1 AA.

## 1. Tokens (`src/app/globals.css`)

Tokens are CSS custom properties exposed to Tailwind through `@theme inline` (`bg-surface`, `text-muted`, `border-border`, `bg-good-soft`, …). Dark mode is class-based (`.dark` on `<html>`, from the `theme` cookie) so a user's choice beats the OS setting.

### Surfaces & text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f7fb` | `#0b1020` | Page background |
| `--surface` | `#ffffff` | `#121a2e` | Cards, menus, tooltips |
| `--surface-2` | `#f1f3f9` | `#19233b` | Table headers, hover, skeleton base |
| `--border` | `#e3e6ef` | `#26324d` | Dividers, inputs |
| `--text` | `#0f172a` | `#e6eaf3` | Primary text |
| `--muted` | `#5b6477` | `#a0aac0` | Secondary text, labels |
| `--subtle` | `#8a93a6` | `#6f7a93` | Axis ticks, placeholders (not for body text) |

### Brand (white label)

| Token | Default | Notes |
|---|---|---|
| `--brand` | `#4f46e5` (dark `#818cf8`) | Overridden per client via inline style from `Client.brandColors[0]` / `Organization.primaryColor`. Used for primary buttons, active nav, focus rings — **never** to encode good/bad. |
| `--brand-fg` | `#ffffff` (dark `#0b1020`) | Text on brand. Check contrast when a client colour is light. |
| `--brand-soft` | `color-mix(brand 12%)` | Selected rows, active nav background. |

### Status colours (semantic — fixed meaning)

| Token | Light / soft | Dark | Meaning | Examples |
|---|---|---|---|---|
| `--good` | `#16a34a` / `#dcfce7` | `#22c55e` | Good / on target | KPI improved, CONNECTED, variance within plan, beats market |
| `--bad` | `#dc2626` / `#fee2e2` | `#f87171` | Needs action | KPI worsened, EXPIRED, SYNC_FAILED, over budget > 10%, REJECTED |
| `--warn` | `#ea8a0c` / `#ffedd5` | `#fb923c` | Warning / watch | PERMISSION_MISSING, under-pacing, high frequency, token expiring |
| `--info` | `#2563eb` / `#dbeafe` | `#60a5fa` | Neutral information | SYNCING, tips, in-review |
| `--demo` | `#a21caf` / `#fae8ff` | `#e879f9` | Demo data | `DemoBadge` on anything with `source = DEMO` / `Client.isDemo` |

Rules:

* Direction ≠ tone. "Up" is good for ROAS/CTR/leads and bad for CPL/CPC/CPM/CPA/frequency — use `trendTone(key, delta)` and `LOWER_IS_BETTER` from `src/lib/metrics.ts`, never hand-pick colours.
* Colour is never the only signal: pair with an icon (▲ ▼ ✓ ⚠), text or badge label.
* Estimates use the `EstimateBadge` (info tone + "Estimate" + tooltip with method), not a status colour.

### Shape & elevation

`--radius: 0.75rem` (`rounded-card`), `--shadow` (`shadow-card`). Cards: `bg-surface border border-border rounded-card shadow-card`. Print removes shadows.

## 2. Typography

| Script | Font | Loaded in | Weights |
|---|---|---|---|
| Latin | **Inter** (`--font-inter`) | `src/app/layout.tsx` via `next/font/google`, `display: swap` | variable |
| Arabic | **IBM Plex Sans Arabic** (`--font-arabic`) | same | 400, 500, 600, 700 |

`--font-sans` puts Inter first in LTR and IBM Plex Sans Arabic first when `html[dir="rtl"]`, each falling back to the other so mixed text renders correctly.

Scale (Tailwind): page title `text-xl/2xl font-semibold`; card title `text-sm font-semibold`; body `text-sm`; meta/captions `text-xs text-muted`; KPI value `text-2xl font-semibold num`. Arabic needs slightly larger line height — use `leading-relaxed` for paragraphs; never letter-space Arabic.

Numbers: `className="num"` → `direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums`, so "+12.5%" and "EGP 1,240" don't flip inside Arabic sentences and columns align. Format only with `src/lib/format.ts` (`fmtMoney`, `fmtPct`, `fmtNumber`, `fmtCompact`, `fmtDate`, `fmtRelative`) — Latin digits in both locales for consistency with platform exports.

## 3. RTL rules

1. `<html lang dir>` is set from the locale (`dirOf()`); everything else flows from it.
2. Use **logical** utilities only: `ms-* me-* ps-* pe-* start-* end-* text-start text-end border-s border-e rounded-s rounded-e`. Never `ml/mr/pl/pr/left/right/text-left/text-right`.
3. Directional icons (chevrons, arrows, "back", sidebar collapse) get `flip-rtl`. Non-directional icons (search, bell, check) never flip. Trend arrows ▲▼ never flip.
4. Charts: time axes run left→right in both directions (reading convention for time series in Arabic business reporting); legends and tooltips follow the page direction; Recharts axis labels use `.num` formatting.
5. Tables: column order mirrors (first column on the right in Arabic); numeric columns are end-aligned (`text-end`).
6. Mixed content (Arabic caption with English hashtags/URLs) uses `dir="auto"` on user-generated text blocks.
7. Test every screen in both locales at 360 px and 1440 px.

## 4. Components inventory

| Component | File | Notes |
|---|---|---|
| `Card`, `CardHeader`, `CardBody` | `components/ui/primitives.tsx` | Base container; header takes title, description, actions. |
| `PageHeader` | same | Title, description, badges (Demo), actions (Export, primary CTA). |
| `Button`, `LinkButton`, `buttonClass(variant, size)` | same | Variants: primary (brand), secondary, ghost, danger, success. Sizes sm (h-8) / md (h-9). |
| `Badge` (`tone`: good, bad, warning, info, neutral, demo, brand) | same | Status pills. |
| `DemoBadge`, `EstimateBadge` | same | Data-honesty badges with tooltip hint. |
| `DataMeta` | same | Footer "Source · Last updated · Demo/Estimate" on every chart/table. |
| `Callout` | same | Inline notice (info/good/warning/bad/demo). |
| `EmptyState`, `ErrorState`, `Skeleton` | same | Required states (see §6). |
| `Progress` | same | Pacing / completion bars with tone. |
| `Stat`, `Grid` (2/3/4/6 cols), `Tabs` | same | Layout helpers; `Tabs` are links (URL state). |
| `Field`, `Input`, `Textarea`, `Select`, `inputClass` | same | Form controls with label, hint, error (`aria-describedby`). |
| `SimpleTable` | same | Small static tables. |
| `KpiCard` | `components/ui/kpi-card.tsx` | Value, delta vs previous (tone via `trendTone`), target, market benchmark, sparkline. |
| `DataTable` | `components/ui/data-table.tsx` | Sortable, searchable, CSV download, horizontal scroll on mobile, cell `{ v, d }` (value + display). |
| `ExportMenu` | `components/ui/export-menu.tsx` | CSV/Excel via `/api/export/[dataset]`, PDF via print CSS, PNG via `html-to-image`. |
| `TimeSeriesChart`, `RankBarChart`, `GroupedBarChart`, `DonutChart` | `components/charts/charts.tsx` | Recharts wrappers with tokens, formatters, empty state. |
| `SummaryCard` | `components/dashboard/summary-card.tsx` | Executive summary with FACT/ESTIMATE/RECOMMENDATION chips + confidence. |
| `AppShell`, `Sidebar`, `FilterBar` | `components/layout/*` | Shell, nav from `nav.ts`, URL-driven filters. |
| `AuthForm`, `LocaleSwitch` | `components/auth/*` | Auth pages. |

## 5. Chart rules

1. **Fixed categorical palette** (`--chart-1 … --chart-7`, exported as `SERIES_COLORS`):

   | Slot | Light | Dark |
   |---|---|---|
   | 1 | `#2a78d6` blue | `#3987e5` |
   | 2 | `#eb6834` orange | `#d95926` |
   | 3 | `#1baf7a` green | `#199e70` |
   | 4 | `#eda100` amber | `#c98500` |
   | 5 | `#e87ba4` pink | `#d55181` |
   | 6 | `#4a3aa7` indigo | `#9085e9` |
   | 7 | `#8a93a6` grey ("Other") | `#6f7a93` |

   Validated for colour-vision deficiency separation (deuteranopia/protanopia/tritanopia) with the dataviz validator. Order is fixed; **colour follows the series, never its rank** — e.g. Meta keeps slot 1 across every chart on the page. More than 6 series → group the tail as "Other" (slot 7).
2. **Never dual axis.** One y-axis per chart. For spend vs results use two small charts, an indexed chart (base = 100), or a ratio metric (CPL, ROAS).
3. Status colours (`good/bad/warn`) are for **judgement**, not for series identity. Planned vs actual: actual = series colour, plan = dashed line/outlined bar of the same colour; variance labels use status tones.
4. Start bar axes at zero. Line charts may zoom but label the baseline.
5. Donuts: ≤ 6 slices, sorted descending, with value labels; prefer bars when comparing.
6. Always show units and currency in axis/tooltip (`fmtMoney`, `fmtPct`, `fmtCompact`), and `<DataMeta>` under the chart.
7. Empty data → the chart renders "No data" text rather than an empty frame.
8. Every chart has a text alternative: title + summary sentence, or the underlying `DataTable` toggle.

## 6. States

| State | Component | Rule |
|---|---|---|
| Loading | `Skeleton` + route `loading.tsx` (e.g. `src/app/(app)/loading.tsx`) | Skeleton mirrors final layout (KPI row, chart block, table rows). Shimmer disabled under `prefers-reduced-motion`. |
| Empty | `EmptyState` | Explain why (no data in range / no integration / no permission for any client) and give the next action (change filters, connect integration, add first item). |
| Error | `ErrorState` + route `error.tsx` | Human message, retry button, no stack traces or ids that leak data. Errors are logged server-side as JSON. |
| Partial | `Callout tone="warning"` | e.g. PERMISSION_MISSING: "Google Ads data is missing — reconnect". |
| Demo | `DemoBadge` + page badge | Any demo row in view. |
| Estimate | `EstimateBadge` | Forecasts, FX roll-ups, competitor intensity, best time. |
| Permission denied | redirect `?denied=` + toast/callout | Never render disabled controls a role can never use — hide them. |

## 7. Accessibility (WCAG 2.1 AA)

* Contrast ≥ 4.5:1 for text (tokens chosen for this; `--subtle` only for non-essential text ≥ 3:1). Re-check contrast when a client brand colour is applied.
* Visible focus indicator on every interactive element (buttons: `focus-visible:outline-2 outline-offset-2 outline-brand`; inputs: `focus:ring-2 ring-brand/20 border-brand`); logical tab order in both directions.
* Semantic HTML: `<nav>`, `<main>`, headings in order, `<table>` with `<th scope>`, `<button>` for actions and `<a>` for navigation.
* Forms: `<label for>`; errors linked with `aria-describedby`; don't rely on placeholder text.
* Icons-only buttons have `aria-label` (translated).
* Status conveyed by text/icon as well as colour.
* Charts: `role="img"` + `aria-label` summary, or accompanying table.
* Motion: respect `prefers-reduced-motion`.
* Language: `lang="ar"`/`"en"` on `<html>`; `dir` correct so screen readers read Arabic properly.
* Touch targets ≥ 36 px high (md buttons/inputs are `h-9`), ≥ 40 px preferred for primary mobile actions; layouts work at 360 px and 200 % zoom without horizontal page scroll (tables scroll inside their container).

## 8. Print / PDF

`@media print` hides `.no-print` (sidebar, filters, buttons), removes shadows, keeps cards unbroken (`.card { break-inside: avoid }`), `.print-break` forces a page break. PDF export = browser print, which preserves Arabic shaping and RTL perfectly.
