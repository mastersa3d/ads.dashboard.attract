import "server-only";
import type { Prisma, ContentItem, ContentStatus, ContentType, FunnelStage, Objective, Platform } from "@prisma/client";
import type { Filters } from "@/lib/filters";
import { toNum } from "@/lib/format";

type Scope = { clientId: string | { in: string[] } };

/**
 * ContentItem where-clause from the global filters. `scope` MUST be ctx.scope (tenant isolation).
 * Honours: client (via scope), brand, platform, ctype, cstatus, creator (assignee), funnel,
 * objective, mode (paid / organic → isPaid).
 */
export function contentWhere(f: Filters, scope: Scope, extra: Prisma.ContentItemWhereInput = {}): Prisma.ContentItemWhereInput {
  const w: Prisma.ContentItemWhereInput = { ...scope, ...extra };
  if (f.brandId) w.brandId = f.brandId;
  if (f.platforms.length) w.platform = { in: f.platforms };
  if (f.contentType) w.type = f.contentType;
  if (f.contentStatus) w.status = f.contentStatus;
  if (f.creatorId) w.assigneeId = f.creatorId;
  if (f.funnel) w.funnelStage = f.funnel;
  if (f.objective) w.objective = f.objective;
  if (f.mode === "paid") w.isPaid = true;
  if (f.mode === "organic") w.isPaid = false;
  return w;
}

/** Serializable shape passed to client components. */
export type ContentDTO = {
  id: string;
  clientId: string;
  brandId: string | null;
  campaignName: string | null;
  platform: Platform;
  title: string;
  publishAt: string | null;
  timezone: string;
  type: ContentType;
  pillar: string | null;
  funnelStage: FunnelStage | null;
  objective: Objective | null;
  audience: string | null;
  caption: string | null;
  hook: string | null;
  cta: string | null;
  hashtags: string[];
  keywords: string[];
  designBrief: string | null;
  designUrl: string | null;
  videoUrl: string | null;
  assetUrls: string[];
  assigneeId: string | null;
  assigneeName: string | null;
  status: ContentStatus;
  notes: string | null;
  publishedUrl: string | null;
  isPaid: boolean;
  boostBudget: number | null;
  approvalDeadline: string | null;
  recurrence: string | null;
  seriesId: string | null;
  version: number;
  resultReach: number | null;
  resultEngagements: number | null;
  source: string;
  updatedAt: string;
};

export const contentInclude = { assignee: { select: { name: true } } } satisfies Prisma.ContentItemInclude;

export function toDTO(c: ContentItem & { assignee?: { name: string } | null }): ContentDTO {
  return {
    id: c.id,
    clientId: c.clientId,
    brandId: c.brandId,
    campaignName: c.campaignName,
    platform: c.platform,
    title: c.title,
    publishAt: c.publishAt?.toISOString() ?? null,
    timezone: c.timezone,
    type: c.type,
    pillar: c.pillar,
    funnelStage: c.funnelStage,
    objective: c.objective,
    audience: c.audience,
    caption: c.caption,
    hook: c.hook,
    cta: c.cta,
    hashtags: c.hashtags,
    keywords: c.keywords,
    designBrief: c.designBrief,
    designUrl: c.designUrl,
    videoUrl: c.videoUrl,
    assetUrls: c.assetUrls,
    assigneeId: c.assigneeId,
    assigneeName: c.assignee?.name ?? null,
    status: c.status,
    notes: c.notes,
    publishedUrl: c.publishedUrl,
    isPaid: c.isPaid,
    boostBudget: c.boostBudget == null ? null : toNum(c.boostBudget),
    approvalDeadline: c.approvalDeadline?.toISOString() ?? null,
    recurrence: c.recurrence,
    seriesId: c.seriesId,
    version: c.version,
    resultReach: c.resultReach,
    resultEngagements: c.resultEngagements,
    source: c.source,
    updatedAt: c.updatedAt.toISOString(),
  };
}
