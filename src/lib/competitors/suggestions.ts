import "server-only";
import { z } from "zod";
import type { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { aiEnabled, generateStructured } from "@/lib/ai/claude";
import type { TFunction } from "@/lib/i18n/translate";
import { searchAdLibrary, adLibraryConfigured } from "./meta-ad-library";

/**
 * Competitor suggestion engine. Suggestions are stored as PENDING competitors with a reason and
 * need a human to Accept / Reject / Replace them. Evidence sources, strongest first:
 *   1. Meta Ad Library (official API): advertisers running active ads in the client's country for
 *      the client's products / industry keywords.
 *   2. Workspace knowledge: competitors already confirmed for other clients in the same industry
 *      and country (names/websites only — never another client's analysis).
 *   3. Claude (optional, when enabled): named businesses the model believes compete, clearly
 *      flagged "AI — verify before accepting".
 */

export type SuggestionCandidate = {
  name: string;
  website: string | null;
  platforms: Platform[];
  reason: string;
  signal: "AD_LIBRARY" | "WORKSPACE" | "AI";
};

export type SuggestionRun = {
  candidates: SuggestionCandidate[];
  adLibrary: "OK" | "NOT_CONFIGURED" | "FAILED" | "SKIPPED";
  ai: "OK" | "DISABLED" | "FAILED" | "SKIPPED";
};

type ClientProfile = {
  id: string;
  organizationId: string;
  name: string;
  industry: string | null;
  country: string | null;
  products: string[];
  audiences: string[];
  website: string | null;
};

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const aiSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string(),
        website: z.string().nullable(),
        platforms: z.array(z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "LINKEDIN", "YOUTUBE", "X", "GOOGLE_ADS"])),
        reason: z.string(),
      }),
    )
    .max(8),
});

export async function suggestCompetitors(opts: {
  client: ClientProfile;
  exclude: string[]; // names already tracked / rejected — never re-suggested
  need: number;
  locale: "ar" | "en";
  t: TFunction;
  allowAi: boolean;
}): Promise<SuggestionRun> {
  const { client, t } = opts;
  const taken = new Set([...opts.exclude, client.name].map(key));
  const out: SuggestionCandidate[] = [];
  const push = (c: SuggestionCandidate) => {
    const k = key(c.name);
    if (!k || taken.has(k) || out.length >= opts.need) return;
    taken.add(k);
    out.push(c);
  };
  const country = (client.country ?? "").toUpperCase();
  const industry = client.industry ?? t("competitors.suggest.yourIndustry");

  // 1) Official ad library
  let adLibrary: SuggestionRun["adLibrary"] = "SKIPPED";
  const keywords = [...client.products.slice(0, 3), ...(client.industry ? [client.industry] : [])].filter(Boolean);
  if (!adLibraryConfigured()) adLibrary = "NOT_CONFIGURED";
  else if (country && keywords.length) {
    const advertisers = new Map<string, { name: string; ads: number; keywords: Set<string>; platforms: Set<string> }>();
    adLibrary = "OK";
    for (const kw of keywords) {
      const r = await searchAdLibrary({ countries: [country], searchTerms: kw, activeStatus: "ACTIVE", maxPages: 1 });
      if (!r.ok) {
        adLibrary = "FAILED";
        break;
      }
      for (const ad of r.ads) {
        if (!ad.page_name) continue;
        const k = key(ad.page_name);
        const a = advertisers.get(k) ?? { name: ad.page_name, ads: 0, keywords: new Set<string>(), platforms: new Set<string>() };
        a.ads++;
        a.keywords.add(kw);
        for (const p of ad.publisher_platforms ?? []) a.platforms.add(p.toUpperCase());
        advertisers.set(k, a);
      }
    }
    const ranked = [...advertisers.values()].sort((a, b) => b.keywords.size - a.keywords.size || b.ads - a.ads);
    for (const a of ranked) {
      push({
        name: a.name,
        website: null,
        platforms: (["FACEBOOK", "INSTAGRAM"] as Platform[]).filter((p) => a.platforms.has(p)),
        reason: t("competitors.suggest.reasonAdLibrary", { n: a.ads, country, keywords: [...a.keywords].map((k) => `“${k}”`).join(", ") }),
        signal: "AD_LIBRARY",
      });
    }
  }

  // 2) Workspace knowledge (same industry + country)
  if (out.length < opts.need && client.industry) {
    const peers = await db.competitor.findMany({
      where: {
        state: "ACCEPTED",
        clientId: { not: client.id },
        client: { organizationId: client.organizationId, archived: false, industry: { equals: client.industry, mode: "insensitive" }, ...(country ? { country: { equals: country, mode: "insensitive" } } : {}) },
      },
      select: { name: true, website: true, activePlatforms: true },
      take: 50,
    });
    const counts = new Map<string, { c: (typeof peers)[number]; n: number }>();
    for (const p of peers) {
      const k = key(p.name);
      counts.set(k, { c: p, n: (counts.get(k)?.n ?? 0) + 1 });
    }
    for (const { c } of [...counts.values()].sort((a, b) => b.n - a.n)) {
      push({ name: c.name, website: c.website, platforms: c.activePlatforms, reason: t("competitors.suggest.reasonWorkspace", { industry, country: country || "—" }), signal: "WORKSPACE" });
    }
  }

  // 3) Claude (optional)
  let ai: SuggestionRun["ai"] = "SKIPPED";
  if (out.length < opts.need) {
    if (!opts.allowAi || !aiEnabled()) ai = "DISABLED";
    else {
      try {
        const r = await generateStructured({
          schema: aiSchema,
          locale: opts.locale,
          effort: "low",
          data: {
            client: { industry: client.industry, country: client.country, products: client.products, audiences: client.audiences, website: client.website },
            alreadyTracked: opts.exclude,
          },
          task:
            "Suggest up to 6 real, currently operating businesses that compete with this client for the same customers in the same country. " +
            "Only name businesses you are confident exist; if unsure, return fewer. Do not include any business listed in alreadyTracked. " +
            "For each, give a one-sentence reason grounded in the provided industry/products/audiences. Never state follower counts, spend or other numbers.",
        });
        ai = "OK";
        for (const c of r.competitors) {
          push({
            name: c.name.slice(0, 120),
            website: c.website && /^https?:\/\//.test(c.website) ? c.website.slice(0, 300) : null,
            platforms: c.platforms.filter((p) => p !== "GOOGLE_ADS") as Platform[],
            reason: `${t("competitors.suggest.reasonAiPrefix")} ${c.reason.slice(0, 400)}`,
            signal: "AI",
          });
        }
      } catch {
        ai = "FAILED";
      }
    }
  }

  return { candidates: out, adLibrary, ai };
}
