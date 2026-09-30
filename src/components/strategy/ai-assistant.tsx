"use client";

import { useState, useTransition } from "react";
import { Bot, Check, Cpu, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmtDateTime } from "@/lib/format";
import { decideStrategySuggestion, generateStrategySuggestions } from "@/app/actions/strategy";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";

export type SuggestionView = {
  id: string;
  area: string;
  title: string;
  lines: string[];
  reasoning: string;
  confidence: number;
  dataSources: string[];
  method: "ai" | "rules";
  generatedAt: string | null;
  state: "PENDING" | "ACCEPTED" | "REJECTED";
};

/**
 * AI Strategy Assistant panel. Generates PENDING suggestions from a tenant-scoped data package;
 * each must be explicitly accepted (merged into its section) or rejected. Never applied automatically.
 */
export function AiAssistant({
  clientId,
  aiEnabled,
  canGenerate,
  canDecide,
  pending,
  history,
  meta,
}: {
  clientId: string;
  aiEnabled: boolean;
  canGenerate: boolean;
  canDecide: boolean;
  pending: SuggestionView[];
  history: SuggestionView[];
  meta: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "info" | "bad" | "warning"; text: string } | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  function generate() {
    setNotice(null);
    start(async () => {
      const res = await generateStrategySuggestions({ clientId });
      if (!res.ok) setNotice({ tone: "bad", text: t(`strategy.error.${res.error}`) });
      else if (res.aiError) setNotice({ tone: "warning", text: t("strategy.ai.fellBack", { code: res.aiError }) });
    });
  }

  function decide(id: string, decision: "ACCEPTED" | "REJECTED") {
    setDeciding(id);
    start(async () => {
      const res = await decideStrategySuggestion({ id, decision });
      if (!res.ok) setNotice({ tone: "bad", text: t(`strategy.error.${res.error}`) });
      setDeciding(null);
    });
  }

  return (
    <Card className="no-print">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-4 text-brand" aria-hidden /> {t("strategy.ai.title")}
          </span>
        }
        subtitle={aiEnabled ? t("strategy.ai.subtitleAi") : t("strategy.ai.subtitleRules")}
        meta={meta}
        actions={
          canGenerate ? (
            <Button variant="primary" size="sm" onClick={generate} disabled={busy}>
              {aiEnabled ? <Bot className="size-3.5" aria-hidden /> : <Cpu className="size-3.5" aria-hidden />}
              {busy && !deciding ? t("strategy.ai.generating") : pending.length ? t("strategy.ai.regenerate") : t("strategy.ai.generate")}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        <p className="text-xs text-muted">{t("strategy.ai.guardrail")}</p>
        {notice && <Callout tone={notice.tone}>{notice.text}</Callout>}
        {pending.length === 0 ? (
          <EmptyState title={t("strategy.ai.empty")} hint={canGenerate ? t("strategy.ai.emptyHint") : t("strategy.ai.emptyHintViewer")} icon={<Sparkles className="size-6" aria-hidden />} />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {pending.map((s) => (
              <article key={s.id} className="flex flex-col rounded-lg border border-border p-3">
                <header className="mb-2 flex flex-wrap items-center gap-1.5">
                  <h4 className="me-auto text-sm font-semibold">{s.title}</h4>
                  {s.method === "ai" ? <Badge tone="brand">{t("strategy.ai.methodAi")}</Badge> : <Badge tone="warning">{t("strategy.ai.methodRules")}</Badge>}
                  <Badge tone="neutral">
                    {t("ui.confidence")}: <span className="num">{Math.round(s.confidence * 100)}%</span>
                  </Badge>
                </header>
                <ul className="mb-2 list-disc space-y-1 ps-5 text-sm marker:text-subtle">
                  {s.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                <details className="mb-2 text-xs text-muted">
                  <summary className="cursor-pointer select-none font-medium text-text">{t("strategy.ai.reasoning")}</summary>
                  <p className="mt-1 whitespace-pre-line">{s.reasoning}</p>
                </details>
                <p className="mb-3 text-[11px] text-subtle">
                  {t("ui.source")}: {s.dataSources.join(" · ") || "—"}
                  {s.generatedAt && <> · {fmtDateTime(s.generatedAt, locale)}</>}
                </p>
                {canDecide && (
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="success" disabled={busy} onClick={() => decide(s.id, "ACCEPTED")}>
                      <Check className="size-3.5" aria-hidden /> {t("strategy.ai.accept")}
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => decide(s.id, "REJECTED")}>
                      <X className="size-3.5" aria-hidden /> {t("ui.reject")}
                    </Button>
                    {deciding === s.id && <span className="self-center text-xs text-muted">{t("ui.loading")}</span>}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {history.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer select-none text-muted">{t("strategy.ai.history", { n: history.length })}</summary>
            <ul className="mt-2 space-y-1">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={h.state === "ACCEPTED" ? "good" : "bad"}>{t(`strategy.ai.state.${h.state}`)}</Badge>
                  <span>{h.title}</span>
                  <span className="text-subtle">{h.method === "ai" ? t("strategy.ai.methodAi") : t("strategy.ai.methodRules")}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
