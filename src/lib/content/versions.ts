/**
 * Content version snapshots. Every save writes a ContentVersion whose `snapshot` holds the
 * editable fields below; the History tab diffs consecutive snapshots. Pure — client-safe.
 */

export const SNAPSHOT_FIELDS = [
  "title",
  "clientId",
  "brandId",
  "campaignName",
  "platform",
  "publishAt",
  "timezone",
  "type",
  "pillar",
  "funnelStage",
  "objective",
  "audience",
  "caption",
  "hook",
  "cta",
  "hashtags",
  "keywords",
  "designBrief",
  "designUrl",
  "videoUrl",
  "assetUrls",
  "assigneeId",
  "status",
  "notes",
  "publishedUrl",
  "isPaid",
  "boostBudget",
  "approvalDeadline",
  "recurrence",
  "resultReach",
  "resultEngagements",
] as const;

export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];
export type Snapshot = Partial<Record<SnapshotField, string | number | boolean | string[] | null>>;

function norm(v: unknown): string | number | boolean | string[] | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "object" && "toNumber" in (v as object)) return (v as { toNumber(): number }).toNumber();
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

export function snapshotOf(item: Record<string, unknown>): Snapshot {
  const out: Snapshot = {};
  for (const f of SNAPSHOT_FIELDS) out[f] = norm(item[f]);
  return out;
}

export type FieldChange = { field: SnapshotField; before: Snapshot[SnapshotField]; after: Snapshot[SnapshotField] };

export function diffSnapshots(before: Snapshot | null, after: Snapshot): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const f of SNAPSHOT_FIELDS) {
    const a = before?.[f] ?? null;
    const b = after[f] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field: f, before: a, after: b });
  }
  return changes;
}
