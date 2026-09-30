import type { ContentStatus } from "@prisma/client";
import { PENDING_APPROVAL_STATUSES } from "./workflow";

/** Pure "due soon" / "overdue approval" predicates for highlighting (client-safe). */

export const DUE_SOON_HOURS = 48;
export const NOT_DUE_STATUSES: ContentStatus[] = ["PUBLISHED", "REJECTED"];

export function isDueSoon(publishAt: Date | string | null, status: ContentStatus, now = new Date(), hours = DUE_SOON_HOURS) {
  if (!publishAt || NOT_DUE_STATUSES.includes(status)) return false;
  const t = new Date(publishAt).getTime();
  return t >= now.getTime() && t <= now.getTime() + hours * 3600000;
}

export function isApprovalOverdue(deadline: Date | string | null, status: ContentStatus, now = new Date()) {
  return Boolean(deadline && PENDING_APPROVAL_STATUSES.includes(status) && new Date(deadline).getTime() < now.getTime());
}
