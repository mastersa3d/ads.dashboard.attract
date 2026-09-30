import { topValues } from "./intensity";

/**
 * Seasonal competitor analysis: what competitors did in the same calendar window in previous
 * years (posts + ads), which occasions/offers they leaned on, what repeats year after year and
 * where the client still has room. Pure function — callers pass tenant-scoped rows.
 */

export type SeasonalPost = { competitor: string; postedAt: Date; type: string | null; topic: string | null; occasion: string | null; engagements: number | null };
export type SeasonalAd = { competitor: string; firstSeen: Date; lastSeen: Date; format: string | null; offer: string | null; creativeIdea: string | null };
export type ClientPlanItem = { title: string; pillar: string | null; campaignName: string | null; publishAt: Date | null };

export type SeasonalWindow = { month: number; span: number }; // month 0..11

export type SeasonalAnalysis = {
  currentYear: number;
  years: number[];
  hasHistory: boolean;
  perYear: { year: number; posts: number; ads: number; avgEngagement: number | null; competitors: number }[];
  occasions: { label: string; byYear: Record<number, number>; yearsSeen: number; competitors: string[] }[];
  offers: { label: string; n: number }[];
  adFormats: { label: string; byYear: Record<number, number>; yearsSeen: number }[];
  recurringIdeas: { label: string; years: number[]; competitors: string[] }[];
  opportunities: { label: string; kind: "NOT_PLANNED" | "LOW_COMPETITION"; competitors: string[]; lastYear: number }[];
};

export function windowFor(year: number, w: SeasonalWindow) {
  return { from: new Date(Date.UTC(year, w.month, 1)), to: new Date(Date.UTC(year, w.month + w.span, 1)) };
}

const inWin = (d: Date, win: { from: Date; to: Date }) => d >= win.from && d < win.to;
const norm = (s: string) => s.trim().toLowerCase();

export function analyseSeason(posts: SeasonalPost[], ads: SeasonalAd[], plan: ClientPlanItem[], w: SeasonalWindow, now = new Date()): SeasonalAnalysis {
  const currentYear = now.getUTCFullYear();
  const allYears = [...posts.map((p) => p.postedAt.getUTCFullYear()), ...ads.map((a) => a.firstSeen.getUTCFullYear())];
  const minYear = allYears.length ? Math.max(Math.min(...allYears), currentYear - 5) : currentYear;
  const years: number[] = [];
  for (let y = minYear; y <= currentYear; y++) years.push(y);

  const postsByYear = new Map<number, SeasonalPost[]>();
  const adsByYear = new Map<number, SeasonalAd[]>();
  for (const y of years) {
    const win = windowFor(y, w);
    postsByYear.set(y, posts.filter((p) => inWin(p.postedAt, win)));
    // an ad belongs to the window when it was live at any time during it
    adsByYear.set(y, ads.filter((a) => a.firstSeen < win.to && a.lastSeen >= win.from));
  }

  const perYear = years.map((year) => {
    const ps = postsByYear.get(year)!;
    const as = adsByYear.get(year)!;
    const eng = ps.filter((p) => p.engagements != null);
    return {
      year,
      posts: ps.length,
      ads: as.length,
      avgEngagement: eng.length ? eng.reduce((s, p) => s + (p.engagements ?? 0), 0) / eng.length : null,
      competitors: new Set([...ps.map((p) => p.competitor), ...as.map((a) => a.competitor)]).size,
    };
  });
  const prevYears = years.filter((y) => y < currentYear);
  const hasHistory = prevYears.some((y) => postsByYear.get(y)!.length + adsByYear.get(y)!.length > 0);

  // Occasions per year
  const occ = new Map<string, { label: string; byYear: Record<number, number>; competitors: Set<string> }>();
  for (const y of years) {
    for (const p of postsByYear.get(y)!) {
      if (!p.occasion?.trim()) continue;
      const k = norm(p.occasion);
      const o = occ.get(k) ?? { label: p.occasion.trim(), byYear: {}, competitors: new Set<string>() };
      o.byYear[y] = (o.byYear[y] ?? 0) + 1;
      o.competitors.add(p.competitor);
      occ.set(k, o);
    }
  }
  const occasions = [...occ.values()]
    .map((o) => ({ label: o.label, byYear: o.byYear, yearsSeen: Object.keys(o.byYear).length, competitors: [...o.competitors] }))
    .sort((a, b) => b.yearsSeen - a.yearsSeen || total(b.byYear) - total(a.byYear));

  const offers = topValues(prevYears.flatMap((y) => adsByYear.get(y)!.map((a) => a.offer)), 6);

  const fmt = new Map<string, Record<number, number>>();
  for (const y of years) for (const a of adsByYear.get(y)!) if (a.format) fmt.set(a.format, { ...fmt.get(a.format), [y]: (fmt.get(a.format)?.[y] ?? 0) + 1 });
  const adFormats = [...fmt.entries()]
    .map(([label, byYear]) => ({ label, byYear, yearsSeen: Object.keys(byYear).length }))
    .sort((a, b) => b.yearsSeen - a.yearsSeen || total(b.byYear) - total(a.byYear));

  // Ideas (post topics + ad creative ideas) seen in ≥ 2 different years
  const ideas = new Map<string, { label: string; years: Set<number>; competitors: Set<string> }>();
  const addIdea = (label: string | null, year: number, competitor: string) => {
    if (!label?.trim()) return;
    const k = norm(label);
    const e = ideas.get(k) ?? { label: label.trim(), years: new Set<number>(), competitors: new Set<string>() };
    e.years.add(year);
    e.competitors.add(competitor);
    ideas.set(k, e);
  };
  for (const y of years) {
    for (const p of postsByYear.get(y)!) addIdea(p.topic, y, p.competitor);
    for (const a of adsByYear.get(y)!) addIdea(a.creativeIdea, y, a.competitor);
  }
  const recurringIdeas = [...ideas.values()]
    .filter((i) => i.years.size >= 2)
    .map((i) => ({ label: i.label, years: [...i.years].sort(), competitors: [...i.competitors] }))
    .sort((a, b) => b.years.length - a.years.length || b.competitors.length - a.competitors.length);

  // Opportunities: occasions competitors used before that the client hasn't planned for this window,
  // and occasions only one competitor touches (low competition).
  const thisWin = windowFor(currentYear, w);
  const planText = plan
    .filter((p) => !p.publishAt || inWin(p.publishAt, thisWin))
    .map((p) => norm([p.title, p.pillar ?? "", p.campaignName ?? ""].join(" ")))
    .join(" | ");
  const opportunities: SeasonalAnalysis["opportunities"] = [];
  for (const o of occasions) {
    const seenYears = Object.keys(o.byYear).map(Number).filter((y) => y < currentYear);
    if (!seenYears.length) continue;
    const lastYear = Math.max(...seenYears);
    if (!planText.includes(norm(o.label))) opportunities.push({ label: o.label, kind: "NOT_PLANNED", competitors: o.competitors, lastYear });
    else if (o.competitors.length <= 1) opportunities.push({ label: o.label, kind: "LOW_COMPETITION", competitors: o.competitors, lastYear });
  }

  return { currentYear, years, hasHistory, perYear, occasions, offers, adFormats, recurringIdeas, opportunities };
}

function total(r: Record<number, number>) {
  return Object.values(r).reduce((s, v) => s + v, 0);
}
