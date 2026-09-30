"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Loader2, Send, ShieldOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtDate } from "@/lib/format";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionButton, ResultLine, useErrorText } from "@/components/integrations/action-button";
import { createShareLink, revokeShareLink, saveSchedule, sendReportNow } from "@/app/actions/reports";

/** Public link: generate (shown once), expiry, revoke. */
export function SharePanel({ reportId, active, expiresAt }: { reportId: string; active: boolean; expiresAt: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [days, setDays] = useState("14");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{active && expiresAt ? t("reports.share.activeUntil", { date: fmtDate(expiresAt, locale) }) : t("reports.share.none")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("reports.share.expiry")} htmlFor="share-days">
          <Select id="share-days" value={days} onChange={(e) => setDays(e.target.value)} options={["1", "7", "14", "30", "90"].map((d) => ({ value: d, label: t("reports.share.days", { n: d }) }))} />
        </Field>
        <Button
          variant="primary"
          size="md"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await createShareLink({ id: reportId, days: Number(days) });
              if (r.ok && r.data) {
                setLink(`${window.location.origin}/r/${r.data.token}`);
                setResult(null);
              } else if (!r.ok) setResult({ tone: "bad", text: errorText(r.error) });
              router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />} {active ? t("reports.share.regenerate") : t("reports.share.create")}
        </Button>
        {active && (
          <ActionButton size="md" variant="ghost" className="text-bad" action={() => revokeShareLink(reportId)} confirm={t("reports.share.confirmRevoke")} onDone={setResult} success={() => t("reports.share.revoked")}>
            <ShieldOff className="size-4" aria-hidden /> {t("reports.share.revoke")}
          </ActionButton>
        )}
      </div>
      {link && (
        <div className="space-y-1 rounded-lg border border-warn/40 bg-warn-soft p-3">
          <p className="text-xs font-medium text-warn">{t("reports.share.onlyOnce")}</p>
          <div className="flex gap-2">
            <Input readOnly value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={t("reports.share.link")} />
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              }}
            >
              <Copy className="size-4" aria-hidden /> {copied ? t("ui.copied") : t("ui.copyLink")}
            </Button>
          </div>
        </div>
      )}
      <ResultLine result={result} />
    </div>
  );
}

/** Schedule (daily / weekly / monthly + recipients) processed by the worker, and "send now". */
export function SchedulePanel({
  reportId,
  initial,
  nextRunLabel,
}: {
  reportId: string;
  initial: { freq: "none" | "daily" | "weekly" | "monthly"; weekday: string; monthDay: number; time: string; recipients: string[]; rolling: boolean };
  nextRunLabel: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [pending, start] = useTransition();
  const [s, setS] = useState(initial);
  const [recipients, setRecipients] = useState(initial.recipients.join("\n"));
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const list = recipients.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
          const r = await saveSchedule({ id: reportId, ...s, recipients: list });
          setResult(r.ok ? { tone: "good", text: t("ui.saved") } : { tone: "bad", text: errorText(r.error) });
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("reports.schedule.frequency")} htmlFor="sch-freq">
          <Select id="sch-freq" value={s.freq} onChange={(e) => setS({ ...s, freq: e.target.value as typeof s.freq })} options={["none", "daily", "weekly", "monthly"].map((f) => ({ value: f, label: t(`reports.schedule.${f}`) }))} />
        </Field>
        {s.freq === "weekly" && (
          <Field label={t("reports.schedule.weekday")} htmlFor="sch-wd">
            <Select id="sch-wd" value={s.weekday} onChange={(e) => setS({ ...s, weekday: e.target.value })} options={["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => ({ value: d, label: t(`reports.weekday.${d}`) }))} />
          </Field>
        )}
        {s.freq === "monthly" && (
          <Field label={t("reports.schedule.monthDay")} htmlFor="sch-md">
            <Input id="sch-md" type="number" min={1} max={28} value={s.monthDay} onChange={(e) => setS({ ...s, monthDay: Number(e.target.value) })} />
          </Field>
        )}
        {s.freq !== "none" && (
          <Field label={t("reports.schedule.time")} htmlFor="sch-time" hint={t("reports.schedule.timeHint")}>
            <Input id="sch-time" type="time" value={s.time} onChange={(e) => setS({ ...s, time: e.target.value })} />
          </Field>
        )}
      </div>
      <Field label={t("reports.schedule.recipients")} htmlFor="sch-rcpt" hint={t("reports.schedule.recipientsHint")}>
        <Textarea id="sch-rcpt" rows={3} dir="ltr" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={s.rolling} onChange={(e) => setS({ ...s, rolling: e.target.checked })} />
        {t("reports.schedule.rolling")}
      </label>
      {nextRunLabel && s.freq !== "none" && <p className="text-xs text-muted">{t("reports.schedule.next", { date: nextRunLabel })}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("ui.save")}
        </Button>
        <ActionButton
          size="md"
          action={() => sendReportNow(reportId)}
          refresh={false}
          onDone={(r) => setResult(r.tone === "bad" && r.text === "NO_RECIPIENTS" ? { tone: "bad", text: t("reports.schedule.noRecipients") } : r)}
          success={() => t("reports.schedule.sendQueued")}
          disabled={initial.recipients.length === 0}
        >
          <Send className="size-4 flip-rtl" aria-hidden /> {t("reports.schedule.sendNow")}
        </ActionButton>
      </div>
      <ResultLine result={result} />
    </form>
  );
}
