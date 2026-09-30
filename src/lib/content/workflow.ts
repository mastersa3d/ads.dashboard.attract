import type { ContentStatus } from "@prisma/client";
import type { Permission } from "@/lib/rbac";

/**
 * Content approval workflow — the single source of truth for which status changes are
 * allowed and who may perform them. Used by server actions (enforcement) and by the UI
 * (which buttons / kanban columns to offer). Pure: safe to import in client components.
 *
 *   Idea → Brief → In Production → Internal Review → Client Review → Approved → Scheduled → Published
 *                        ↑                 │                 │
 *                        └── Needs Revision ←────────────────┘   (+ Rejected from either review)
 */

export const STATUS_FLOW: ContentStatus[] = [
  "IDEA",
  "BRIEF",
  "IN_PRODUCTION",
  "INTERNAL_REVIEW",
  "CLIENT_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "NEEDS_REVISION",
  "REJECTED",
];

/** Statuses a brand-new item may start in. */
export const INITIAL_STATUSES: ContentStatus[] = ["IDEA", "BRIEF", "IN_PRODUCTION"];

/** Still waiting for a decision — used by "overdue approval" checks. */
export const PENDING_APPROVAL_STATUSES: ContentStatus[] = ["IDEA", "BRIEF", "IN_PRODUCTION", "INTERNAL_REVIEW", "CLIENT_REVIEW", "NEEDS_REVISION"];

/** Items in these statuses are locked for field edits (only the workflow can move them). */
export const LOCKED_STATUSES: ContentStatus[] = ["PUBLISHED"];

export type ApprovalStage = "INTERNAL" | "CLIENT";

type Transition = {
  to: ContentStatus;
  permission: Permission;
  /** A decision recorded as an Approval row. */
  approval?: { stage: ApprovalStage; decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" };
  /** A written reason is mandatory (rejections and change requests). */
  requiresComment?: boolean;
  /** Needs a publish date/time set on the item. */
  requiresPublishAt?: boolean;
};

const T: Record<ContentStatus, Transition[]> = {
  IDEA: [{ to: "BRIEF", permission: "content:edit" }],
  BRIEF: [
    { to: "IN_PRODUCTION", permission: "content:edit" },
    { to: "IDEA", permission: "content:edit" },
  ],
  IN_PRODUCTION: [
    { to: "INTERNAL_REVIEW", permission: "content:submit" },
    { to: "BRIEF", permission: "content:edit" },
  ],
  NEEDS_REVISION: [
    { to: "IN_PRODUCTION", permission: "content:edit" },
    { to: "INTERNAL_REVIEW", permission: "content:submit" },
  ],
  INTERNAL_REVIEW: [
    { to: "CLIENT_REVIEW", permission: "content:approve_internal", approval: { stage: "INTERNAL", decision: "APPROVED" } },
    { to: "NEEDS_REVISION", permission: "content:approve_internal", approval: { stage: "INTERNAL", decision: "CHANGES_REQUESTED" }, requiresComment: true },
    { to: "REJECTED", permission: "content:approve_internal", approval: { stage: "INTERNAL", decision: "REJECTED" }, requiresComment: true },
    { to: "IN_PRODUCTION", permission: "content:submit" }, // withdraw submission
  ],
  CLIENT_REVIEW: [
    { to: "APPROVED", permission: "content:approve_client", approval: { stage: "CLIENT", decision: "APPROVED" } },
    { to: "NEEDS_REVISION", permission: "content:approve_client", approval: { stage: "CLIENT", decision: "CHANGES_REQUESTED" }, requiresComment: true },
    { to: "REJECTED", permission: "content:approve_client", approval: { stage: "CLIENT", decision: "REJECTED" }, requiresComment: true },
    { to: "INTERNAL_REVIEW", permission: "content:approve_internal" }, // agency recalls it
  ],
  APPROVED: [
    { to: "SCHEDULED", permission: "content:edit", requiresPublishAt: true },
    { to: "NEEDS_REVISION", permission: "content:approve_internal", requiresComment: true },
  ],
  SCHEDULED: [
    { to: "PUBLISHED", permission: "content:edit" },
    { to: "APPROVED", permission: "content:edit" }, // unschedule
  ],
  PUBLISHED: [],
  REJECTED: [
    { to: "IDEA", permission: "content:edit" },
    { to: "BRIEF", permission: "content:edit" },
  ],
};

type PermHolder = { has(p: Permission): boolean } | readonly Permission[];
const has = (perms: PermHolder, p: Permission) => ("has" in perms ? perms.has(p) : perms.includes(p));

export function findTransition(from: ContentStatus, to: ContentStatus): Transition | undefined {
  return T[from].find((t) => t.to === to);
}

/** Transitions the holder of `perms` may perform from `from`. */
export function allowedTransitions(from: ContentStatus, perms: PermHolder): Transition[] {
  return T[from].filter((t) => has(perms, t.permission));
}

export function canTransition(from: ContentStatus, to: ContentStatus, perms: PermHolder) {
  const t = findTransition(from, to);
  return Boolean(t && has(perms, t.permission));
}

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; reason: "INVALID_TRANSITION" | "FORBIDDEN" | "COMMENT_REQUIRED" | "PUBLISH_AT_REQUIRED" };

/** Full validation used by the server before a status change is persisted. */
export function checkTransition(
  from: ContentStatus,
  to: ContentStatus,
  perms: PermHolder,
  ctx: { comment?: string | null; publishAt?: Date | string | null },
): TransitionCheck {
  const t = findTransition(from, to);
  if (!t) return { ok: false, reason: "INVALID_TRANSITION" };
  if (!has(perms, t.permission)) return { ok: false, reason: "FORBIDDEN" };
  if (t.requiresComment && !ctx.comment?.trim()) return { ok: false, reason: "COMMENT_REQUIRED" };
  if (t.requiresPublishAt && !ctx.publishAt) return { ok: false, reason: "PUBLISH_AT_REQUIRED" };
  return { ok: true, transition: t };
}

/** Badge tone per status (matches the design-system tones). */
export function statusTone(s: ContentStatus): "good" | "bad" | "warning" | "info" | "neutral" | "brand" | "demo" {
  switch (s) {
    case "PUBLISHED":
    case "APPROVED":
      return "good";
    case "SCHEDULED":
      return "brand";
    case "INTERNAL_REVIEW":
    case "CLIENT_REVIEW":
      return "info";
    case "NEEDS_REVISION":
      return "warning";
    case "REJECTED":
      return "bad";
    case "IN_PRODUCTION":
      return "demo";
    default:
      return "neutral";
  }
}
