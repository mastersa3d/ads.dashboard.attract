import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, Inbox, Info, FlaskConical } from "lucide-react";

export type Tone = "good" | "bad" | "warning" | "info" | "neutral" | "demo" | "brand";

export const cx = clsx;

const toneClasses: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  bad: "bg-bad-soft text-bad",
  warning: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-muted",
  demo: "bg-demo-soft text-demo",
  brand: "bg-brand-soft text-brand",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneClasses[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("card rounded-card border border-border bg-surface shadow-card", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  meta,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        {meta && <div className="mt-1">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 no-print">{actions}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("p-4", className)}>{children}</div>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
const buttonClasses: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg hover:opacity-90",
  secondary: "border border-border bg-surface hover:bg-surface-2 text-text",
  ghost: "hover:bg-surface-2 text-text",
  danger: "bg-bad text-white hover:opacity-90",
  success: "bg-good text-white hover:opacity-90",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
    buttonClasses[variant],
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: { href: string; variant?: ButtonVariant; size?: "sm" | "md"; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={cx(buttonClass(variant, size), className)} {...rest}>
      {children}
    </Link>
  );
}

export function PageHeader({ title, description, actions, badges }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; badges?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {badges}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="rounded-full bg-surface-2 p-3 text-subtle">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="rounded-full bg-bad-soft p-3 text-bad">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: Exclude<Tone, "neutral" | "brand">; title?: React.ReactNode; children?: React.ReactNode }) {
  const border: Record<string, string> = { good: "border-good", bad: "border-bad", warning: "border-warn", info: "border-info", demo: "border-demo" };
  return (
    <div className={cx("rounded-lg border-s-4 p-3 text-sm", toneClasses[tone], border[tone])}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children && <div className="text-text/90">{children}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function Progress({ value, tone = "brand", label }: { value: number | null; tone?: Tone; label?: string }) {
  const pct = Math.max(0, Math.min(1, value ?? 0));
  const bar: Record<Tone, string> = { good: "bg-good", bad: "bg-bad", warning: "bg-warn", info: "bg-info", neutral: "bg-subtle", demo: "bg-demo", brand: "bg-brand" };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-all", bar[tone])} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

export function DemoBadge({ label, hint }: { label: string; hint?: string }) {
  return (
    <Badge tone="demo" title={hint}>
      <FlaskConical className="size-3" aria-hidden /> {label}
    </Badge>
  );
}

export function EstimateBadge({ label, hint }: { label: string; hint?: string }) {
  return (
    <Badge tone="warning" title={hint}>
      <Info className="size-3" aria-hidden /> {label}
    </Badge>
  );
}

/** "Source: Meta Ads API · Last updated 2h ago" + Demo badge when applicable. Required on every chart/table. */
export function DataMeta({
  source,
  updated,
  demo,
  estimate,
  labels,
}: {
  source: string;
  updated?: string | null;
  demo?: boolean;
  estimate?: boolean;
  labels: { source: string; updated: string; demo: string; demoHint: string; estimate?: string; estimateHint?: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-subtle">
      <span>
        {labels.source}: <span className="text-muted">{source}</span>
      </span>
      {updated && (
        <span>
          · {labels.updated}: <span className="text-muted">{updated}</span>
        </span>
      )}
      {demo && <DemoBadge label={labels.demo} hint={labels.demoHint} />}
      {estimate && labels.estimate && <EstimateBadge label={labels.estimate} hint={labels.estimateHint} />}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className="num mt-0.5 text-lg font-semibold">{value}</p>
      {sub && <div className="mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: React.ReactNode; href: string }[]; active: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border no-print" aria-label="Tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            t.key === active ? "border-brand text-brand" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: React.ReactNode; htmlFor?: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-subtle">{hint}</p>}
      {error && <p className="text-[11px] text-bad">{error}</p>}
    </div>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60";
export const textareaClass =
  "min-h-20 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(textareaClass, props.className)} />;
}

export function Select({ options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...props} className={cx(inputClass, "pe-8", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Simple server-rendered table for small datasets. Use DataTable for search/sort/paginate. */
export function SimpleTable({ head, rows, empty }: { head: React.ReactNode[]; rows: React.ReactNode[][]; empty?: React.ReactNode }) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-start text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-start font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Grid({ children, cols = 4, className }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 6; className?: string }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" }[cols];
  return <div className={cx("grid gap-4", c, className)}>{children}</div>;
}
