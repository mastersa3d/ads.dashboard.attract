/**
 * Strategy document structure. Section ids match the keys stored in Strategy.sections (JSON);
 * labels/hints resolve as t(`strategy.section.<id>`) / t(`strategy.hint.<id>`).
 * Every section holds free text plus an ordered list of items.
 */
export const STRATEGY_SECTIONS = [
  { id: "overview", group: "foundation" },
  { id: "products", group: "foundation" },
  { id: "markets", group: "foundation" },
  { id: "goals", group: "foundation" },
  { id: "smartGoals", group: "foundation" },
  { id: "personas", group: "audience" },
  { id: "painPoints", group: "audience" },
  { id: "journey", group: "audience" },
  { id: "funnel", group: "audience" },
  { id: "valueProp", group: "brand" },
  { id: "positioning", group: "brand" },
  { id: "keyMessages", group: "brand" },
  { id: "pillars", group: "brand" },
  { id: "tone", group: "brand" },
  { id: "channels", group: "channels" },
  { id: "organic", group: "channels" },
  { id: "paid", group: "channels" },
  { id: "remarketing", group: "channels" },
  { id: "influencer", group: "channels" },
  { id: "leadGen", group: "channels" },
  { id: "retention", group: "channels" },
  { id: "kpis", group: "measure" },
  { id: "risks", group: "measure" },
  { id: "monthlyPlan", group: "plan" },
  { id: "quarterlyPlan", group: "plan" },
  { id: "yearlyPlan", group: "plan" },
] as const;

export type SectionId = (typeof STRATEGY_SECTIONS)[number]["id"];
export const SECTION_IDS = STRATEGY_SECTIONS.map((s) => s.id) as SectionId[];
export const SECTION_GROUPS = ["foundation", "audience", "brand", "channels", "measure", "plan"] as const;

export type SectionContent = { text: string; items: string[] };

/** AI / rule-based suggestion areas and the section an accepted suggestion merges into. */
export const AREA_SECTION = {
  "strategy.smartGoals": "smartGoals",
  "strategy.channels": "channels",
  "strategy.pillars": "pillars",
  "strategy.plan": "quarterlyPlan",
} as const satisfies Record<string, SectionId>;
export type StrategyArea = keyof typeof AREA_SECTION;

function itemToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(itemToString).join(", ");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const head = typeof o.name === "string" ? o.name : typeof o.title === "string" ? o.title : null;
    const rest = Object.entries(o)
      .filter(([k]) => k !== "name" && k !== "title")
      .map(([k, x]) => `${k}: ${itemToString(x)}`)
      .join("; ");
    return head ? (rest ? `${head} — ${rest}` : head) : rest;
  }
  return "";
}

/** Tolerant reader: seed/legacy sections may store items as objects (e.g. personas). */
export function readSection(raw: unknown): SectionContent {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = typeof o.text === "string" ? o.text : typeof raw === "string" ? raw : "";
  const items = Array.isArray(o.items) ? o.items.map(itemToString).filter(Boolean) : Array.isArray(raw) ? raw.map(itemToString).filter(Boolean) : [];
  return { text, items };
}

export function readSections(raw: unknown): Record<SectionId, SectionContent> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(SECTION_IDS.map((id) => [id, readSection(o[id])])) as Record<SectionId, SectionContent>;
}

export function isFilled(s: SectionContent) {
  return Boolean(s.text.trim() || s.items.length);
}
