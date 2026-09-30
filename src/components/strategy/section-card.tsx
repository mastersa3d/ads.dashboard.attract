"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { saveStrategySection } from "@/app/actions/strategy";
import { Button, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui/primitives";
import type { SectionContent, SectionId } from "./sections";

/** One strategy section: read view + inline edit form (free text and an ordered item list). */
export function SectionCard({ clientId, id, content, canEdit }: { clientId: string; id: SectionId; content: SectionContent; canEdit: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(content.text);
  const [items, setItems] = useState<string[]>(content.items);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const empty = !content.text.trim() && !content.items.length;

  function reset() {
    setText(content.text);
    setItems(content.items);
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveStrategySection({ clientId, sectionId: id, text, items: items.map((i) => i.trim()).filter(Boolean) });
      if (res.ok) setEditing(false);
      else setError(t(`strategy.error.${res.error}`));
    });
  }

  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const copy = [...xs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  return (
    <Card id={`sec-${id}`} className="scroll-mt-40">
      <CardHeader
        title={t(`strategy.section.${id}`)}
        subtitle={t(`strategy.hint.${id}`)}
        actions={
          canEdit && !editing ? (
            <Button size="sm" variant="ghost" onClick={() => {
                setText(content.text);
                setItems(content.items);
                setEditing(true);
              }}
              aria-label={`${t("ui.edit")} — ${t(`strategy.section.${id}`)}`}>
              <Pencil className="size-3.5" aria-hidden /> {t("ui.edit")}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {!editing ? (
          empty ? (
            <p className="text-sm text-subtle">{t("strategy.emptySection")}</p>
          ) : (
            <div className="space-y-3 text-sm leading-relaxed">
              {content.text && <p className="whitespace-pre-line">{content.text}</p>}
              {content.items.length > 0 && (
                <ul className="list-disc space-y-1 ps-5 marker:text-subtle">
                  {content.items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label={t("strategy.form.text")} htmlFor={`txt-${id}`}>
              <Textarea id={`txt-${id}`} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={10000} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-muted">{t("strategy.form.items")}</legend>
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="num w-5 shrink-0 text-end text-xs text-subtle">{i + 1}.</span>
                  <Input value={it} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${t("strategy.form.item")} ${i + 1}`} maxLength={1000} />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" aria-label={t("strategy.form.moveUp")}>
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30" aria-label={t("strategy.form.moveDown")}>
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label={t("strategy.form.remove")}>
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => setItems((xs) => [...xs, ""])}>
                <Plus className="size-3.5" aria-hidden /> {t("strategy.form.addItem")}
              </Button>
            </fieldset>
            {error && (
              <p role="alert" className="text-xs text-bad">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? t("ui.loading") : t("ui.save")}
              </Button>
              <Button type="button" onClick={reset} disabled={pending}>
                {t("ui.cancel")}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
