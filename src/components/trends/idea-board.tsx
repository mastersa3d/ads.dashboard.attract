"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmtNumber, type Locale } from "@/lib/format";
import { Button, EmptyState, Select, cx, inputClass } from "@/components/ui/primitives";
import { IdeaCard } from "./idea-card";
import { IDEA_PLATFORMS, PRIORITIES, type IdeaView } from "./idea-form";
import { quadrant } from "./ease-impact-matrix";

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Searchable, filterable grid of idea cards. */
export function IdeaBoard({ ideas, clientId, canEdit, canCalendar, emptyTitle, emptyHint }: { ideas: IdeaView[]; clientId: string; canEdit: boolean; canCalendar: boolean; emptyTitle: string; emptyHint?: string }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState("");
  const [platform, setPlatform] = useState("");
  const [view, setView] = useState("");
  const [limit, setLimit] = useState(12);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ideas
      .filter((i) => !priority || i.priority === priority)
      .filter((i) => !platform || i.platform === platform)
      .filter((i) => (view === "quick" ? quadrant(i) === "quickWins" : view === "open" ? !i.addedToCalendar : view === "seasonal" ? i.isSeasonal : view === "evergreen" ? i.isEvergreen : true))
      .filter((i) => !needle || [i.title, i.reason, i.keyword, i.competitorName, i.hook, i.audience].some((x) => x?.toLowerCase().includes(needle)))
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || b.impact * b.ease - a.impact * a.ease);
  }, [ideas, q, priority, platform, view]);

  if (!ideas.length) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 no-print">
        <input
          value={q}
          onChange={(e) => (setQ(e.target.value), setLimit(12))}
          placeholder={t("ui.search")}
          aria-label={t("ui.search")}
          className={cx(inputClass, "lg:col-span-2")}
        />
        <Select aria-label={t("ui.priority")} value={priority} onChange={(e) => setPriority(e.target.value)} placeholder={t("trends.board.allPriorities")} options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) }))} />
        <Select aria-label={t("filter.platform")} value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder={t("competitors.ads.allPlatforms")} options={IDEA_PLATFORMS.map((p) => ({ value: p, label: t(`platform.${p}`) }))} />
        <Select
          aria-label={t("trends.board.view")}
          value={view}
          onChange={(e) => setView(e.target.value)}
          placeholder={t("trends.board.allIdeas")}
          options={[
            { value: "quick", label: t("trends.matrix.quickWins") },
            { value: "open", label: t("trends.board.notInCalendar") },
            { value: "seasonal", label: t("trends.idea.seasonal") },
            { value: "evergreen", label: t("trends.idea.evergreen") },
          ]}
        />
      </div>
      <p className="text-xs text-subtle">
        <span className="num">{fmtNumber(list.length, locale as Locale)}</span> {t("trends.board.ideas")}
      </p>
      {list.length === 0 ? (
        <EmptyState title={t("ui.noData")} hint={t("ui.noDataHint")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.slice(0, limit).map((i) => (
            <IdeaCard key={i.id} idea={i} clientId={clientId} canEdit={canEdit} canCalendar={canCalendar} />
          ))}
        </div>
      )}
      {list.length > limit && (
        <div className="text-center">
          <Button size="sm" onClick={() => setLimit((l) => l + 12)}>
            {t("competitors.ads.showMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
