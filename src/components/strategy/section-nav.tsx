"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cx, inputClass } from "@/components/ui/primitives";
import { SECTION_GROUPS, STRATEGY_SECTIONS, type SectionId } from "./sections";

/** Sticky side list on desktop, a jump-to select on mobile. Highlights the section in view. */
export function SectionNav({ filled }: { filled: SectionId[] }) {
  const { t } = useI18n();
  const [active, setActive] = useState<string>(STRATEGY_SECTIONS[0].id);
  const done = new Set(filled);

  useEffect(() => {
    const els = STRATEGY_SECTIONS.map((s) => document.getElementById(`sec-${s.id}`)).filter((e): e is HTMLElement => Boolean(e));
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace("sec-", ""));
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  const go = (id: string) => {
    setActive(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="lg:hidden no-print">
        <label htmlFor="strategy-jump" className="sr-only">
          {t("strategy.jumpTo")}
        </label>
        <select id="strategy-jump" className={inputClass} value={active} onChange={(e) => go(e.target.value)}>
          {SECTION_GROUPS.map((g) => (
            <optgroup key={g} label={t(`strategy.group.${g}`)}>
              {STRATEGY_SECTIONS.filter((s) => s.group === g).map((s) => (
                <option key={s.id} value={s.id}>
                  {done.has(s.id) ? "✓ " : ""}
                  {t(`strategy.section.${s.id}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <nav aria-label={t("strategy.sections")} className="sticky top-40 hidden max-h-[calc(100dvh-11rem)] overflow-y-auto pe-1 lg:block no-print">
        {SECTION_GROUPS.map((g) => (
          <div key={g} className="mb-3">
            <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">{t(`strategy.group.${g}`)}</p>
            <ul>
              {STRATEGY_SECTIONS.filter((s) => s.group === g).map((s) => (
                <li key={s.id}>
                  <a
                    href={`#sec-${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      go(s.id);
                    }}
                    aria-current={active === s.id ? "location" : undefined}
                    className={cx(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition",
                      active === s.id ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    {done.has(s.id) ? <CheckCircle2 className="size-3.5 shrink-0 text-good" aria-hidden /> : <Circle className="size-3.5 shrink-0 text-subtle" aria-hidden />}
                    <span className="truncate">{t(`strategy.section.${s.id}`)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
