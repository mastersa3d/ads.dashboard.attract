"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, History, Lock, MessageSquare, Paperclip, Repeat, Send, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { ContentStatus, ContentType, FunnelStage, Objective } from "@prisma/client";
import { useI18n } from "@/lib/i18n/client";
import {
  addComment,
  changeStatus,
  deleteContent,
  enqueuePublish,
  getContentDetail,
  saveContent,
  type ActionResult,
  type ContentDetail,
  type ContentInput,
} from "@/app/actions/content";
import type { ContentDTO } from "@/lib/content/queries";
import type { Conflict } from "@/lib/content/conflicts";
import { allowedTransitions, INITIAL_STATUSES, LOCKED_STATUSES } from "@/lib/content/workflow";
import { parseRecurrence, RECURRENCE_FREQS } from "@/lib/content/recurrence";
import { canPublishVia } from "@/lib/content/publishing";
import { addDays, COMMON_TIMEZONES, weekdayOf, zonedDayKey, zonedTime } from "@/lib/content/tz";
import type { SnapshotField } from "@/lib/content/versions";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { Badge, Button, Callout, cx, EmptyState, Field, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { StatusBadge } from "./status-badge";
import { ContentPreview } from "./preview";
import { AssetThumb } from "./asset-thumb";
import { BestTimePanel } from "./best-time-panel";
import { CommentDialog } from "./comment-dialog";
import { ACCEPT_UPLOADS, MAX_UPLOAD_MB, useUpload } from "./use-upload";
import type { EditorOptions } from "./types";

type Form = {
  clientId: string;
  brandId: string;
  title: string;
  campaignName: string;
  platform: string;
  date: string;
  time: string;
  timezone: string;
  type: string;
  pillar: string;
  funnelStage: string;
  objective: string;
  audience: string;
  caption: string;
  hook: string;
  cta: string;
  hashtags: string;
  keywords: string;
  designBrief: string;
  designUrl: string;
  videoUrl: string;
  assetUrls: string[];
  assigneeId: string;
  status: string;
  statusComment: string;
  notes: string;
  publishedUrl: string;
  isPaid: boolean;
  boostBudget: string;
  deadline: string;
  recurFreq: string;
  recurCount: string;
  resultReach: string;
  resultEngagements: string;
};

export type DrawerDefaults = { day?: string; time?: string; clientId?: string; platform?: string };

function toForm(item: ContentDTO | null, d: DrawerDefaults, o: EditorOptions): Form {
  const clientId = item?.clientId ?? d.clientId ?? (o.clients.length === 1 ? o.clients[0].id : "");
  const tz = item?.timezone ?? o.clients.find((c) => c.id === clientId)?.timezone ?? o.timezone;
  const at = item?.publishAt ? new Date(item.publishAt) : null;
  const dl = item?.approvalDeadline ? new Date(item.approvalDeadline) : null;
  const rec = parseRecurrence(item?.recurrence);
  return {
    clientId,
    brandId: item?.brandId ?? "",
    title: item?.title ?? "",
    campaignName: item?.campaignName ?? "",
    platform: item?.platform ?? d.platform ?? "INSTAGRAM",
    date: at ? zonedDayKey(at, tz) : (d.day ?? ""),
    time: at ? zonedTime(at, tz) : (d.time ?? (d.day ? "12:00" : "")),
    timezone: tz,
    type: item?.type ?? "IMAGE",
    pillar: item?.pillar ?? "",
    funnelStage: item?.funnelStage ?? "",
    objective: item?.objective ?? "",
    audience: item?.audience ?? "",
    caption: item?.caption ?? "",
    hook: item?.hook ?? "",
    cta: item?.cta ?? "",
    hashtags: item?.hashtags.join(" ") ?? "",
    keywords: item?.keywords.join(", ") ?? "",
    designBrief: item?.designBrief ?? "",
    designUrl: item?.designUrl ?? "",
    videoUrl: item?.videoUrl ?? "",
    assetUrls: item?.assetUrls ?? [],
    assigneeId: item?.assigneeId ?? "",
    status: item?.status ?? "IDEA",
    statusComment: "",
    notes: item?.notes ?? "",
    publishedUrl: item?.publishedUrl ?? "",
    isPaid: item?.isPaid ?? false,
    boostBudget: item?.boostBudget != null ? String(item.boostBudget) : "",
    deadline: dl ? `${zonedDayKey(dl, tz)}T${zonedTime(dl, tz)}` : "",
    recurFreq: rec?.freq ?? "",
    recurCount: rec ? String(rec.count) : "4",
    resultReach: item?.resultReach != null ? String(item.resultReach) : "",
    resultEngagements: item?.resultEngagements != null ? String(item.resultEngagements) : "",
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const splitTags = (s: string) => s.split(/[\s,،]+/).map((x) => x.trim()).filter(Boolean);
const splitList = (s: string) => s.split(/[,،\n]+/).map((x) => x.trim()).filter(Boolean);

function toInput(id: string | undefined, f: Form, allowConflict: boolean): ContentInput {
  return {
    id,
    clientId: f.clientId,
    brandId: f.brandId || null,
    title: f.title,
    campaignName: f.campaignName,
    platform: f.platform as ContentInput["platform"],
    publishLocal: f.date ? `${f.date}T${f.time || "12:00"}` : null,
    timezone: f.timezone,
    type: f.type as ContentInput["type"],
    pillar: f.pillar,
    funnelStage: (f.funnelStage || null) as ContentInput["funnelStage"],
    objective: (f.objective || null) as ContentInput["objective"],
    audience: f.audience,
    caption: f.caption,
    hook: f.hook,
    cta: f.cta,
    hashtags: splitTags(f.hashtags),
    keywords: splitList(f.keywords),
    designBrief: f.designBrief,
    designUrl: f.designUrl,
    videoUrl: f.videoUrl,
    assetUrls: f.assetUrls,
    assigneeId: f.assigneeId || null,
    status: f.status as ContentInput["status"],
    statusComment: f.statusComment,
    notes: f.notes,
    publishedUrl: f.publishedUrl,
    isPaid: f.isPaid,
    boostBudget: f.isPaid ? num(f.boostBudget) : null,
    approvalDeadlineLocal: f.deadline || null,
    recurrence: !id && f.recurFreq && f.date ? { freq: f.recurFreq as (typeof RECURRENCE_FREQS)[number], count: Number(f.recurCount) || 2 } : null,
    resultReach: num(f.resultReach),
    resultEngagements: num(f.resultEngagements),
    allowConflict,
  };
}

type Tab = "details" | "comments" | "history" | "approvals";

export function ContentDrawer({
  item,
  defaults = {},
  options,
  onClose,
  onChanged,
}: {
  item: ContentDTO | null;
  defaults?: DrawerDefaults;
  options: EditorOptions;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const perms = useMemo(() => new Set(options.perms), [options.perms]);
  const isNew = !item;
  const canEdit = isNew ? perms.has("content:create") : perms.has("content:edit");
  const locked = item ? LOCKED_STATUSES.includes(item.status) : false;
  const [tab, setTab] = useState<Tab>("details");
  const [form, setForm] = useState<Form>(() => toForm(item, defaults, options));
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ list: Conflict[]; blocked: boolean; window: number } | null>(null);
  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ to: ContentStatus; required: boolean; label: string; tone: "primary" | "danger" | "success" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftInternal, setDraftInternal] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const up = useUpload();

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const client = options.clients.find((c) => c.id === form.clientId);

  const loadDetail = useCallback(async () => {
    if (!item) return;
    const res = await getContentDetail(item.id);
    if (res.ok) setDetail(res.detail);
  }, [item]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    panelRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !dialog && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose, dialog]);

  function handle<T extends object>(res: ActionResult<T>, after?: (r: T) => void) {
    if (res.ok) {
      setError(null);
      setConflicts(null);
      after?.(res);
      return;
    }
    if ((res.error === "CONFLICT" || res.error === "CONFLICT_BLOCKED") && res.conflicts) {
      setConflicts({ list: res.conflicts, blocked: res.error === "CONFLICT_BLOCKED", window: res.windowMinutes ?? options.conflictWindowMinutes });
      setError(null);
      return;
    }
    setError(res.error === "VALIDATION" && res.fields?.length ? `${t("content.err.VALIDATION")} (${res.fields.map((f) => t(`content.field.${f}`)).join("، ")})` : t(`content.err.${res.error}`));
  }

  function save(allowConflict = false) {
    start(async () => {
      const res = await saveContent(toInput(item?.id, form, allowConflict));
      handle(res, (r) => {
        onChanged();
        if (r.created > 1) setNotice(t("content.seriesCreated", { n: r.created }));
        onClose();
      });
    });
  }

  function transition(to: ContentStatus, comment?: string) {
    if (!item) return;
    start(async () => {
      const res = await changeStatus({ id: item.id, to, comment: comment ?? null });
      handle(res, () => {
        setDialog(null);
        onChanged();
        loadDetail();
      });
    });
  }

  function publish() {
    if (!item) return;
    start(async () => {
      const res = await enqueuePublish(item.id);
      handle(res, (r) => {
        setNotice(t("content.publishQueued", { at: fmtDateTime(r.runAt, locale, item.timezone) }));
        onChanged();
        loadDetail();
      });
    });
  }

  function remove(series: boolean) {
    if (!item || !confirm(series ? t("content.confirmDeleteSeries") : t("content.confirmDelete"))) return;
    start(async () => {
      const res = await deleteContent({ id: item.id, series });
      handle(res, () => {
        onChanged();
        onClose();
      });
    });
  }

  function applyBestTime(weekday: number, hour: number) {
    const base = form.date || zonedDayKey(new Date(), form.timezone);
    const day = addDays(base, (weekday - weekdayOf(base) + 7) % 7);
    setForm((f) => ({ ...f, date: day, time: `${String(hour).padStart(2, "0")}:00` }));
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length || !form.clientId) return;
    const assets = await up.upload(files, form.clientId, ["content"]);
    if (assets.length) setForm((f) => ({ ...f, assetUrls: [...f.assetUrls, ...assets.map((a) => a.url)] }));
  }

  const transitions = item ? allowedTransitions(item.status, perms) : [];
  const statusOptions = isNew ? INITIAL_STATUSES : item ? [item.status, ...transitions.map((x) => x.to)] : [];
  const statusNeedsComment = item && form.status !== item.status && transitions.find((x) => x.to === form.status)?.requiresComment;
  const showPublish = item && perms.has("content:edit") && ["APPROVED", "SCHEDULED"].includes(item.status) && item.publishAt && canPublishVia(options.connected, item.clientId, item.platform);
  const seeInternal = perms.has("content:comment_internal");
  const tzOptions = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set([form.timezone, ...COMMON_TIMEZONES, ...all])];
  }, [form.timezone]);

  const decisionLabel = (to: ContentStatus, decision?: string) =>
    decision === "APPROVED" ? (to === "CLIENT_REVIEW" ? t("content.approveInternal") : t("ui.approve")) : decision === "CHANGES_REQUESTED" ? t("ui.requestChanges") : decision === "REJECTED" ? t("ui.reject") : t("content.moveTo", { status: t(`contentStatus.${to}`) });

  const enumOpts = (values: string[], prefix: string) => values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));
  const disabled = !canEdit || pending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-drawer-title"
        className="flex h-full w-full max-w-2xl flex-col border-s border-border bg-bg shadow-2xl outline-none"
      >
        {/* Header */}
        <header className="flex items-start gap-3 border-b border-border bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="content-drawer-title" className="truncate text-base font-semibold">
              {isNew ? t("content.newPost") : item.title}
            </h2>
            {item && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <StatusBadge status={item.status} label={t(`contentStatus.${item.status}`)} />
                <span>{t(`platform.${item.platform}`)}</span>
                <span>·</span>
                <span className="num">v{item.version}</span>
                {item.seriesId && (
                  <Badge tone="info" title={item.recurrence ?? undefined}>
                    <Repeat className="size-3" aria-hidden /> {t("content.series")}
                  </Badge>
                )}
                {item.source === "DEMO" && <Badge tone="demo">{t("ui.demoData")}</Badge>}
                {locked && (
                  <Badge tone="neutral">
                    <Lock className="size-3" aria-hidden /> {t("content.locked")}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={t("ui.close")}>
            <X className="size-4" />
          </button>
        </header>

        {/* Workflow bar */}
        {item && (transitions.length > 0 || showPublish) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
            <ShieldCheck className="size-4 text-muted" aria-hidden />
            {transitions.map((tr) => {
              const tone = tr.approval?.decision === "APPROVED" ? "success" : tr.approval?.decision === "REJECTED" ? "danger" : "secondary";
              return (
                <Button
                  key={tr.to}
                  size="sm"
                  variant={tone}
                  disabled={pending}
                  onClick={() => {
                    const label = decisionLabel(tr.to, tr.approval?.decision);
                    if (tr.requiresComment || tr.approval) setDialog({ to: tr.to, required: Boolean(tr.requiresComment), label, tone: tone === "secondary" ? "primary" : tone });
                    else transition(tr.to);
                  }}
                >
                  {decisionLabel(tr.to, tr.approval?.decision)}
                </Button>
              );
            })}
            {showPublish && (
              <Button size="sm" variant="primary" disabled={pending} onClick={publish} title={t("content.publishViaApiHint")} className="ms-auto">
                <Send className="size-3.5 flip-rtl" aria-hidden /> {t("content.publishViaApi")}
              </Button>
            )}
          </div>
        )}

        {/* Tabs */}
        {item && (
          <nav className="flex gap-1 border-b border-border bg-surface px-3" aria-label={t("content.tabs")}>
            {(
              [
                ["details", t("ui.details"), null],
                ["comments", t("ui.comments"), detail?.comments.length],
                ["history", t("content.history"), detail?.versions.length],
                ["approvals", t("content.approvalsTab"), detail?.approvals.length],
              ] as [Tab, string, number | undefined | null][]
            ).map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-current={tab === k ? "page" : undefined}
                className={cx("-mb-px border-b-2 px-2.5 py-2 text-xs font-medium whitespace-nowrap", tab === k ? "border-brand text-brand" : "border-transparent text-muted hover:text-text")}
              >
                {label}
                {n ? <span className="num ms-1 rounded-full bg-surface-2 px-1.5 text-[10px]">{n}</span> : null}
              </button>
            ))}
          </nav>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {notice && <Callout tone="good">{notice}</Callout>}
          {error && <Callout tone="bad">{error}</Callout>}
          {conflicts && (
            <Callout tone={conflicts.blocked ? "bad" : "warning"} title={t(conflicts.blocked ? "content.conflict.blockedTitle" : "content.conflict.title", { minutes: conflicts.window })}>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs">
                {conflicts.list.map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.title}</span> · <span className="num">{fmtDateTime(c.publishAt, locale, form.timezone)}</span> · {t(`contentStatus.${c.status}`)}
                  </li>
                ))}
              </ul>
              {!conflicts.blocked && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => save(true)}>
                    {t("content.conflict.saveAnyway")}
                  </Button>
                  <Button size="sm" onClick={() => setConflicts(null)}>
                    {t("content.conflict.pickAnother")}
                  </Button>
                </div>
              )}
            </Callout>
          )}
          {item && showPublish && detail?.publishJob && (
            <Callout tone="info">{t("content.publishJob", { status: t(`content.jobStatus.${detail.publishJob.status}`), at: fmtDateTime(detail.publishJob.runAt, locale, item.timezone) })}</Callout>
          )}

          {(tab === "details" || !item) &&
            (canEdit && !locked ? (
              renderEditor()
            ) : item ? (
              renderReadOnly(item)
            ) : (
              <Callout tone="bad">{t("ui.accessDenied")}</Callout>
            ))}
          {item && tab === "details" && locked && canEdit && renderPostPublish()}
          {item && tab === "comments" && renderComments()}
          {item && tab === "history" && renderHistory()}
          {item && tab === "approvals" && renderApprovals()}
        </div>

        {/* Footer */}
        {(tab === "details" || !item) && canEdit && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-3">
            <Button variant="primary" disabled={pending || !form.title.trim() || !form.clientId} onClick={() => save(false)}>
              {pending ? t("ui.loading") : isNew ? t("ui.create") : t("ui.save")}
            </Button>
            <Button onClick={onClose} disabled={pending}>
              {t("ui.cancel")}
            </Button>
            {item && perms.has("content:delete") && (
              <div className="ms-auto flex gap-1">
                <Button variant="ghost" size="sm" className="text-bad" disabled={pending} onClick={() => remove(false)}>
                  <Trash2 className="size-3.5" aria-hidden /> {t("ui.delete")}
                </Button>
                {item.seriesId && (
                  <Button variant="ghost" size="sm" className="text-bad" disabled={pending} onClick={() => remove(true)}>
                    {t("content.deleteSeries")}
                  </Button>
                )}
              </div>
            )}
          </footer>
        )}
      </div>

      {dialog && (
        <CommentDialog
          title={dialog.label}
          required={dialog.required}
          confirmLabel={dialog.label}
          tone={dialog.tone}
          busy={pending}
          onCancel={() => setDialog(null)}
          onConfirm={(c) => transition(dialog.to, c)}
        />
      )}
    </div>
  );

  // ───────────── Sections (plain render functions over the drawer state) ─────────────

  function section(title: string, children: React.ReactNode) {
    return (
      <fieldset className="space-y-3 rounded-card border border-border bg-surface p-3">
        <legend className="px-1 text-xs font-semibold text-muted">{title}</legend>
        {children}
      </fieldset>
    );
  }

  function renderEditor() {
    const brands = client?.brands ?? [];
    return (
      <div className="space-y-4">
        {section(
          t("content.sec.basics"),
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("content.field.title")} htmlFor="cf-title" className="sm:col-span-2">
              <Input id="cf-title" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required disabled={disabled} />
            </Field>
            <Field label={t("content.field.clientId")} htmlFor="cf-client">
              <Select
                id="cf-client"
                value={form.clientId}
                disabled={disabled || !isNew}
                placeholder={t("content.choose")}
                options={options.clients.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(e) => {
                  const c = options.clients.find((x) => x.id === e.target.value);
                  setForm((f) => ({ ...f, clientId: e.target.value, brandId: "", timezone: c?.timezone ?? f.timezone }));
                }}
              />
            </Field>
            <Field label={t("content.field.brandId")} htmlFor="cf-brand">
              <Select id="cf-brand" value={form.brandId} disabled={disabled} placeholder={t("ui.none")} options={brands.map((b) => ({ value: b.id, label: b.name }))} onChange={(e) => set("brandId", e.target.value)} />
            </Field>
            <Field label={t("content.field.campaignName")} htmlFor="cf-campaign">
              <Input id="cf-campaign" list="cf-campaigns" value={form.campaignName} onChange={(e) => set("campaignName", e.target.value)} maxLength={160} disabled={disabled} />
              <datalist id="cf-campaigns">
                {options.campaigns.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label={t("content.field.platform")} htmlFor="cf-platform">
              <Select id="cf-platform" value={form.platform} disabled={disabled} options={enumOpts(options.platforms, "platform")} onChange={(e) => set("platform", e.target.value)} />
            </Field>
            <Field label={t("content.field.type")} htmlFor="cf-type">
              <Select id="cf-type" value={form.type} disabled={disabled} options={enumOpts(Object.values(ContentType), "contentType")} onChange={(e) => set("type", e.target.value)} />
            </Field>
            <Field label={t("content.field.pillar")} htmlFor="cf-pillar">
              <Input id="cf-pillar" list="cf-pillars" value={form.pillar} onChange={(e) => set("pillar", e.target.value)} maxLength={120} disabled={disabled} />
              <datalist id="cf-pillars">
                {options.pillars.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label={t("content.field.funnelStage")} htmlFor="cf-funnel">
              <Select id="cf-funnel" value={form.funnelStage} disabled={disabled} placeholder={t("ui.none")} options={enumOpts(Object.values(FunnelStage), "funnel")} onChange={(e) => set("funnelStage", e.target.value)} />
            </Field>
            <Field label={t("content.field.objective")} htmlFor="cf-objective">
              <Select id="cf-objective" value={form.objective} disabled={disabled} placeholder={t("ui.none")} options={enumOpts(Object.values(Objective), "objective")} onChange={(e) => set("objective", e.target.value)} />
            </Field>
            <Field label={t("content.field.audience")} htmlFor="cf-audience" className="sm:col-span-2">
              <Input id="cf-audience" list="cf-audiences" value={form.audience} onChange={(e) => set("audience", e.target.value)} maxLength={300} disabled={disabled} />
              <datalist id="cf-audiences">
                {options.audiences.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>,
        )}

        {section(
          t("content.sec.schedule"),
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("content.publishDate")} htmlFor="cf-date">
                <Input id="cf-date" type="date" className="num" value={form.date} onChange={(e) => set("date", e.target.value)} disabled={disabled} />
              </Field>
              <Field label={t("content.publishTime")} htmlFor="cf-time">
                <Input id="cf-time" type="time" className="num" value={form.time} onChange={(e) => set("time", e.target.value)} disabled={disabled || !form.date} />
              </Field>
              <Field label={t("content.field.timezone")} htmlFor="cf-tz">
                <Select id="cf-tz" value={form.timezone} disabled={disabled} options={tzOptions.map((z) => ({ value: z, label: z }))} onChange={(e) => set("timezone", e.target.value)} />
              </Field>
              <Field label={t("content.field.approvalDeadline")} htmlFor="cf-deadline" hint={t("content.deadlineHint")} className="sm:col-span-2">
                <Input id="cf-deadline" type="datetime-local" className="num" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} disabled={disabled} />
              </Field>
            </div>
            {isNew && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("content.field.recurrence")} htmlFor="cf-recur" hint={t("content.recurrenceHint")} className="sm:col-span-2">
                  <Select
                    id="cf-recur"
                    value={form.recurFreq}
                    disabled={disabled || !form.date}
                    placeholder={t("content.recur.none")}
                    options={RECURRENCE_FREQS.map((f) => ({ value: f, label: t(`content.recur.${f}`) }))}
                    onChange={(e) => set("recurFreq", e.target.value)}
                  />
                </Field>
                <Field label={t("content.recurCount")} htmlFor="cf-recur-count">
                  <Input id="cf-recur-count" type="number" className="num" min={2} max={52} value={form.recurCount} onChange={(e) => set("recurCount", e.target.value)} disabled={disabled || !form.recurFreq} />
                </Field>
              </div>
            )}
            {!isNew && item?.recurrence && <p className="text-xs text-muted">{t("content.seriesEditNote")}</p>}
            <p className="text-[11px] text-subtle">{t("content.conflictRule", { minutes: options.conflictWindowMinutes })}</p>
            {form.clientId && (
              <BestTimePanel clientId={form.clientId} platform={form.platform} timezone={form.timezone} chosenLocal={form.date ? `${form.date}T${form.time || "12:00"}` : null} onApply={canEdit ? applyBestTime : undefined} />
            )}
          </div>,
        )}

        {section(
          t("content.sec.copy"),
          <div className="grid gap-3">
            <Field label={t("content.field.hook")} htmlFor="cf-hook">
              <Input id="cf-hook" value={form.hook} onChange={(e) => set("hook", e.target.value)} maxLength={500} disabled={disabled} />
            </Field>
            <Field label={t("content.field.caption")} htmlFor="cf-caption" hint={`${fmtNumber(form.caption.length, locale)} / 5000`}>
              <Textarea id="cf-caption" className="min-h-32" value={form.caption} onChange={(e) => set("caption", e.target.value)} maxLength={5000} disabled={disabled} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("content.field.cta")} htmlFor="cf-cta">
                <Input id="cf-cta" value={form.cta} onChange={(e) => set("cta", e.target.value)} maxLength={200} disabled={disabled} />
              </Field>
              <Field label={t("content.field.hashtags")} htmlFor="cf-hashtags" hint={t("content.hashtagsHint")}>
                <Input id="cf-hashtags" value={form.hashtags} onChange={(e) => set("hashtags", e.target.value)} disabled={disabled} />
              </Field>
              <Field label={t("content.field.keywords")} htmlFor="cf-keywords" hint={t("content.keywordsHint")} className="sm:col-span-2">
                <Input id="cf-keywords" value={form.keywords} onChange={(e) => set("keywords", e.target.value)} disabled={disabled} />
              </Field>
            </div>
          </div>,
        )}

        {section(
          t("content.sec.creative"),
          <div className="grid gap-3">
            <Field label={t("content.field.designBrief")} htmlFor="cf-brief">
              <Textarea id="cf-brief" value={form.designBrief} onChange={(e) => set("designBrief", e.target.value)} maxLength={5000} disabled={disabled} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("content.field.designUrl")} htmlFor="cf-design">
                <Input id="cf-design" type="url" dir="ltr" placeholder="https://" value={form.designUrl} onChange={(e) => set("designUrl", e.target.value)} disabled={disabled} />
              </Field>
              <Field label={t("content.field.videoUrl")} htmlFor="cf-video">
                <Input id="cf-video" type="url" dir="ltr" placeholder="https://" value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} disabled={disabled} />
              </Field>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted">{t("content.field.assetUrls")}</p>
              {form.assetUrls.length > 0 && (
                <ul className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {form.assetUrls.map((u) => (
                    <li key={u} className="group relative overflow-hidden rounded-lg border border-border bg-surface-2">
                      <AssetThumb url={u} alt="" className="aspect-square w-full object-cover" label={t("content.file")} />
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => set("assetUrls", form.assetUrls.filter((x) => x !== u))}
                          className="absolute end-1 top-1 rounded-full bg-black/60 p-1 text-white"
                          aria-label={t("content.removeAsset")}
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!disabled && (
                <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted hover:bg-surface-2", (!form.clientId || up.busy) && "pointer-events-none opacity-50")}>
                  {up.busy ? <Upload className="size-3.5 animate-pulse" aria-hidden /> : <Paperclip className="size-3.5" aria-hidden />}
                  {up.busy ? t("content.uploading") : t("content.uploadAssets", { mb: MAX_UPLOAD_MB })}
                  <input type="file" multiple accept={ACCEPT_UPLOADS} className="sr-only" onChange={(e) => onFiles(e.target.files)} />
                </label>
              )}
              {up.error && <p className="mt-1 text-[11px] text-bad">{t(up.error, { mb: MAX_UPLOAD_MB })}</p>}
            </div>
          </div>,
        )}

        {section(
          t("content.sec.workflow"),
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("content.field.assigneeId")} htmlFor="cf-assignee">
              <Select id="cf-assignee" value={form.assigneeId} disabled={disabled} placeholder={t("content.unassigned")} options={options.users.map((u) => ({ value: u.id, label: u.name }))} onChange={(e) => set("assigneeId", e.target.value)} />
            </Field>
            <Field label={t("content.field.status")} htmlFor="cf-status" hint={isNew ? t("content.statusNewHint") : t("content.statusHint")}>
              <Select id="cf-status" value={form.status} disabled={disabled} options={[...new Set(statusOptions)].map((s) => ({ value: s, label: t(`contentStatus.${s}`) }))} onChange={(e) => set("status", e.target.value)} />
            </Field>
            {statusNeedsComment && (
              <Field label={t("content.statusComment")} htmlFor="cf-status-comment" className="sm:col-span-2">
                <Textarea id="cf-status-comment" value={form.statusComment} onChange={(e) => set("statusComment", e.target.value)} maxLength={2000} required />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.isPaid} onChange={(e) => set("isPaid", e.target.checked)} disabled={disabled} className="size-4 accent-[var(--brand)]" />
              {t("content.field.isPaid")}
            </label>
            {form.isPaid && (
              <Field label={`${t("content.field.boostBudget")}${client ? ` (${client.currency})` : ""}`} htmlFor="cf-boost">
                <Input id="cf-boost" type="number" min={0} step="0.01" className="num" value={form.boostBudget} onChange={(e) => set("boostBudget", e.target.value)} disabled={disabled} />
              </Field>
            )}
            <Field label={t("content.field.publishedUrl")} htmlFor="cf-published" className={form.isPaid ? "" : "sm:col-span-2"}>
              <Input id="cf-published" type="url" dir="ltr" placeholder="https://" value={form.publishedUrl} onChange={(e) => set("publishedUrl", e.target.value)} disabled={disabled} />
            </Field>
            <Field label={t("content.field.notes")} htmlFor="cf-notes" className="sm:col-span-2">
              <Textarea id="cf-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={5000} disabled={disabled} />
            </Field>
            {item && ["PUBLISHED", "SCHEDULED"].includes(item.status) && renderResultFields()}
          </div>,
        )}
      </div>
    );
  }

  function renderResultFields() {
    return (
      <>
        <Field label={t("content.field.resultReach")} htmlFor="cf-reach" hint={t("content.resultsHint")}>
          <Input id="cf-reach" type="number" min={0} className="num" value={form.resultReach} onChange={(e) => set("resultReach", e.target.value)} disabled={!canEdit || pending} />
        </Field>
        <Field label={t("content.field.resultEngagements")} htmlFor="cf-eng">
          <Input id="cf-eng" type="number" min={0} className="num" value={form.resultEngagements} onChange={(e) => set("resultEngagements", e.target.value)} disabled={!canEdit || pending} />
        </Field>
      </>
    );
  }

  /** Published posts are locked; only post-publish fields stay editable. */
  function renderPostPublish() {
    return section(
      t("content.sec.results"),
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("content.field.publishedUrl")} htmlFor="cf-published" className="sm:col-span-2">
          <Input id="cf-published" type="url" dir="ltr" value={form.publishedUrl} onChange={(e) => set("publishedUrl", e.target.value)} disabled={pending} />
        </Field>
        {renderResultFields()}
        <Field label={t("content.field.notes")} htmlFor="cf-notes" className="sm:col-span-2">
          <Textarea id="cf-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={5000} disabled={pending} />
        </Field>
      </div>,
    );
  }

  function renderReadOnly(it: ContentDTO) {
    const rows: [string, React.ReactNode][] = [
      [t("content.field.campaignName"), it.campaignName],
      [t("content.field.pillar"), it.pillar],
      [t("content.field.funnelStage"), it.funnelStage && t(`funnel.${it.funnelStage}`)],
      [t("content.field.objective"), it.objective && t(`objective.${it.objective}`)],
      [t("content.field.audience"), it.audience],
      [t("content.field.keywords"), it.keywords.join("، ")],
      [t("content.field.designBrief"), it.designBrief],
      [t("content.field.assigneeId"), it.assigneeName],
      [t("content.field.approvalDeadline"), it.approvalDeadline && <span className="num">{fmtDateTime(it.approvalDeadline, locale, it.timezone)}</span>],
      [t("content.field.publishedUrl"), it.publishedUrl && <a className="text-brand hover:underline" href={it.publishedUrl} target="_blank" rel="noopener noreferrer">{it.publishedUrl}</a>],
    ];
    if (seeInternal) rows.push([t("content.field.notes"), it.notes]);
    return (
      <div className="space-y-4">
        <ContentPreview item={it} t={t} locale={locale} clientName={options.clients.find((c) => c.id === it.clientId)?.name} currency={options.clients.find((c) => c.id === it.clientId)?.currency} />
        {it.assetUrls.length > 1 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {it.assetUrls.slice(1).map((u) => (
              <li key={u} className="overflow-hidden rounded-lg border border-border bg-surface-2">
                <AssetThumb url={u} alt="" className="aspect-square w-full object-cover" label={t("content.file")} />
              </li>
            ))}
          </ul>
        )}
        <dl className="grid gap-x-4 gap-y-2 rounded-card border border-border bg-surface p-3 text-sm sm:grid-cols-2">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
        </dl>
      </div>
    );
  }

  function renderComments() {
    if (!detail) return <Skeleton className="h-24 w-full" />;
    const canComment = perms.has("content:comment");
    return (
      <div className="space-y-3">
        {detail.comments.length === 0 ? (
          <EmptyState title={t("content.noComments")} icon={<MessageSquare className="size-6" aria-hidden />} />
        ) : (
          <ul className="space-y-2">
            {detail.comments.map((c) => (
              <li key={c.id} className={cx("rounded-lg border p-3 text-sm", c.internal ? "border-warn/40 bg-warn-soft/40" : "border-border bg-surface")}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-text">{c.userName}</span>
                  <span className="num">{fmtDateTime(c.createdAt, locale)}</span>
                  {c.internal && (
                    <Badge tone="warning">
                      <Lock className="size-3" aria-hidden /> {t("content.internal")}
                    </Badge>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canComment && (
          <form
            className="space-y-2 rounded-card border border-border bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!item || !draft.trim()) return;
              start(async () => {
                const res = await addComment({ contentId: item.id, body: draft, internal: seeInternal && draftInternal });
                handle(res, () => {
                  setDraft("");
                  loadDetail();
                });
              });
            }}
          >
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} placeholder={t("content.writeComment")} aria-label={t("content.writeComment")} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {seeInternal ? (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={draftInternal} onChange={(e) => setDraftInternal(e.target.checked)} className="size-4" />
                  {t("content.internalComment")}
                </label>
              ) : (
                <span />
              )}
              <Button type="submit" size="sm" variant="primary" disabled={pending || !draft.trim()}>
                {t("ui.submit")}
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  function fmtValue(field: SnapshotField, v: unknown): string {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "—";
    if (Array.isArray(v)) return field === "assetUrls" ? t("content.nFiles", { n: v.length }) : v.join(", ");
    if (typeof v === "boolean") return v ? t("ui.yes") : t("ui.no");
    const s = String(v);
    switch (field) {
      case "publishAt":
      case "approvalDeadline":
        return fmtDateTime(s, locale, item?.timezone);
      case "status":
        return t(`contentStatus.${s}`);
      case "platform":
        return t(`platform.${s}`);
      case "type":
        return t(`contentType.${s}`);
      case "funnelStage":
        return t(`funnel.${s}`);
      case "objective":
        return t(`objective.${s}`);
      case "assigneeId":
        return options.users.find((u) => u.id === s)?.name ?? "—";
      case "brandId":
        return client?.brands.find((b) => b.id === s)?.name ?? "—";
      case "clientId":
        return options.clients.find((c) => c.id === s)?.name ?? "—";
      default:
        return s.length > 140 ? s.slice(0, 140) + "…" : s;
    }
  }

  function renderHistory() {
    if (!detail) return <Skeleton className="h-24 w-full" />;
    if (!detail.versions.length) return <EmptyState title={t("content.noHistory")} icon={<History className="size-6" aria-hidden />} />;
    return (
      <ol className="space-y-3">
        {detail.versions.map((v, i) => (
          <li key={v.id} className="rounded-card border border-border bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={i === 0 ? "brand" : "neutral"}>
                <span className="num">v{v.version}</span>
              </Badge>
              <span className="font-medium text-text">{v.editedBy ?? t("content.system")}</span>
              <span className="num">{fmtDateTime(v.createdAt, locale)}</span>
            </div>
            {v.version === 1 && i === detail.versions.length - 1 ? (
              <p className="text-xs text-muted">{t("content.created")}</p>
            ) : v.changes.length === 0 ? (
              <p className="text-xs text-muted">{t("content.noChanges")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted">
                      <th className="py-1 pe-2 text-start font-medium">{t("content.fieldCol")}</th>
                      <th className="py-1 pe-2 text-start font-medium">{t("content.before")}</th>
                      <th className="py-1 text-start font-medium">{t("content.after")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.changes.map((c) => (
                      <tr key={c.field} className="border-t border-border/60 align-top">
                        <td className="py-1 pe-2 font-medium whitespace-nowrap">{t(`content.field.${c.field}`)}</td>
                        <td className="py-1 pe-2 break-words text-bad line-through decoration-bad/40">{fmtValue(c.field, c.before)}</td>
                        <td className="py-1 break-words text-good">{fmtValue(c.field, c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ol>
    );
  }

  function renderApprovals() {
    if (!detail) return <Skeleton className="h-24 w-full" />;
    if (!detail.approvals.length) return <EmptyState title={t("content.noApprovals")} icon={<ShieldCheck className="size-6" aria-hidden />} />;
    return (
      <ul className="space-y-2">
        {detail.approvals.map((a) => (
          <li key={a.id} className="rounded-card border border-border bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={a.decision === "APPROVED" ? "good" : a.decision === "REJECTED" ? "bad" : "warning"}>{t(`content.decision.${a.decision}`)}</Badge>
              <Badge tone="neutral">{t(`content.stage.${a.stage}`)}</Badge>
              <span className="font-medium">{a.userName}</span>
              <span className="num text-muted">{fmtDateTime(a.createdAt, locale)}</span>
            </div>
            {a.comment && <p className="mt-1 whitespace-pre-wrap text-muted">{a.comment}</p>}
          </li>
        ))}
      </ul>
    );
  }
}
