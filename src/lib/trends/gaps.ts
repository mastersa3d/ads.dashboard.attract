import type { ContentType } from "@prisma/client";

/**
 * Content-gap analysis: the client's pillars / formats vs what tracked competitors cover.
 * Matching is deliberately fuzzy (shared significant word) because pillars are free text.
 */

export type Gap = { label: string; kind: "COMPETITOR_ONLY" | "WHITE_SPACE" | "FORMAT" | "UNTAPPED"; competitors: string[] };

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);

export function similar(a: string, b: string) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const wa = new Set(words(x).map(stem));
  return words(y).some((w) => wa.has(stem(w)));
}

function stem(w: string) {
  return w.replace(/(ings|ing|es|s)$/u, "");
}

const TYPE_ALIASES: [RegExp, ContentType][] = [
  [/reel/i, "REEL"],
  [/carousel|كاروسيل/i, "CAROUSEL"],
  [/stor(y|ies)|ستوري/i, "STORY"],
  [/live|بث/i, "LIVE"],
  [/short/i, "SHORT"],
  [/video|فيديو/i, "VIDEO"],
  [/image|photo|صور/i, "IMAGE"],
  [/article|blog|مقال/i, "ARTICLE"],
];

export function toContentType(s: string): ContentType | null {
  for (const [re, t] of TYPE_ALIASES) if (re.test(s)) return t;
  return null;
}

export function contentGaps(input: {
  clientPillars: string[];
  clientTypes: ContentType[];
  competitors: { name: string; pillars: string[]; contentTypes: string[]; opportunities: string[] }[];
  competitorPostTypes: { competitor: string; type: ContentType | null }[];
}): Gap[] {
  const gaps: Gap[] = [];
  const add = (label: string, kind: Gap["kind"], competitor?: string) => {
    const g = gaps.find((x) => x.kind === kind && x.label.toLowerCase() === label.trim().toLowerCase());
    if (g) {
      if (competitor && !g.competitors.includes(competitor)) g.competitors.push(competitor);
    } else gaps.push({ label: label.trim(), kind, competitors: competitor ? [competitor] : [] });
  };

  for (const c of input.competitors) {
    for (const p of c.pillars) if (!input.clientPillars.some((cp) => similar(cp, p))) add(p, "COMPETITOR_ONLY", c.name);
    for (const o of c.opportunities) add(o, "UNTAPPED", c.name);
  }
  for (const cp of input.clientPillars) {
    if (!input.competitors.some((c) => c.pillars.some((p) => similar(cp, p)))) add(cp, "WHITE_SPACE");
  }
  const clientTypes = new Set(input.clientTypes);
  const compTypes = new Map<ContentType, Set<string>>();
  for (const c of input.competitors)
    for (const s of c.contentTypes) {
      const t = toContentType(s);
      if (t) compTypes.set(t, (compTypes.get(t) ?? new Set()).add(c.name));
    }
  for (const p of input.competitorPostTypes) if (p.type) compTypes.set(p.type, (compTypes.get(p.type) ?? new Set()).add(p.competitor));
  for (const [t, comps] of compTypes) if (!clientTypes.has(t)) for (const c of comps) add(t, "FORMAT", c);

  const order: Gap["kind"][] = ["WHITE_SPACE", "COMPETITOR_ONLY", "FORMAT", "UNTAPPED"];
  return gaps.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.competitors.length - a.competitors.length);
}
