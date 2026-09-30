/**
 * DEMO seed. Every record created here is flagged (Client.isDemo = true, source = DEMO) and the UI
 * shows a "Demo Data" badge wherever it appears. Never run against production with real clients
 * unless you intend to add a clearly-labelled demo workspace.
 *
 *   npm run db:seed
 *
 * Demo logins (password for all: Demo@12345) — change or delete these users after first login:
 *   admin@demo.local     SUPER_ADMIN
 *   manager@demo.local   COMPANY_MANAGER
 *   team@demo.local      MARKETING_TEAM
 *   client@demo.local    CLIENT  (only "Nile Home Furniture")
 *   viewer@demo.local    VIEWER  (only "Nile Home Furniture")
 */
import { PrismaClient, Prisma, type Platform, type Objective, type FunnelStage, type ContentType, type ContentStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// deterministic PRNG so the demo looks the same on every install
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const int = (a: number, b: number) => Math.round(between(a, b));

const DAY = 86400000;
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);
const HISTORY_DAYS = 730; // two years, so YoY and seasonal comparisons work

/** Seasonal multiplier: Ramadan/Eid spikes, White Friday in November, summer dip. */
function season(d: Date) {
  const m = d.getUTCMonth();
  let f = 1;
  if (m === 10) f *= 1.45; // White Friday
  if (m === 2 || m === 3) f *= 1.25; // Ramadan / Eid window (approx.)
  if (m === 6 || m === 7) f *= 0.9;
  const dow = d.getUTCDay();
  if (dow === 5) f *= 0.85; // Friday
  if (dow === 4) f *= 1.1; // Thursday
  return f * (0.85 + rnd() * 0.3);
}

async function main() {
  console.log("Seeding demo workspace…");
  await db.organization.deleteMany({ where: { slug: "demo-agency" } });

  const org = await db.organization.create({
    data: { name: "Demo Agency", slug: "demo-agency", country: "EG", industry: "Marketing Agency", currency: "EGP", timezone: "Africa/Cairo", defaultLocale: "ar", primaryColor: "#4f46e5", settings: { fx: { base: "USD", rates: { USD: 1, EGP: 48.5, AED: 3.6725, SAR: 3.75 }, asOf: today.toISOString(), source: "Manual (demo)" } } },
  });

  const hash = await bcrypt.hash("Demo@12345", 12);
  const mkUser = (email: string, name: string, role: Prisma.UserCreateInput["role"], locale = "ar") =>
    db.user.create({ data: { organizationId: org.id, email, name, role, passwordHash: hash, locale } });
  const admin = await mkUser("admin@demo.local", "Sara Admin", "SUPER_ADMIN");
  const manager = await mkUser("manager@demo.local", "Omar Manager", "COMPANY_MANAGER");
  const team = await mkUser("team@demo.local", "Mona Marketer", "MARKETING_TEAM");
  const creator = await mkUser("creator@demo.local", "Youssef Creator", "MARKETING_TEAM", "en");
  const clientUser = await mkUser("client@demo.local", "Karim (Nile Home)", "CLIENT");
  const viewer = await mkUser("viewer@demo.local", "Viewer Account", "VIEWER", "en");

  const clientsSpec = [
    {
      name: "Nile Home Furniture",
      slug: "nile-home",
      industry: "Furniture & Home Decor",
      country: "EG",
      currency: "EGP",
      colors: ["#b45309", "#1f2937"],
      products: ["Sofas", "Bedrooms", "Dining", "Outdoor"],
      audiences: ["Newlyweds", "Young families", "Interior lovers"],
      branches: ["Cairo – New Cairo", "Giza – Sheikh Zayed", "Alexandria"],
      isB2B: false,
      scale: 1,
      platforms: ["META", "GOOGLE_ADS", "TIKTOK"] as Platform[],
    },
    {
      name: "Gulf Dental Clinics",
      slug: "gulf-dental",
      industry: "Healthcare – Dental",
      country: "AE",
      currency: "AED",
      colors: ["#0e7490", "#0f172a"],
      products: ["Implants", "Whitening", "Aligners", "Check-up"],
      audiences: ["Professionals 25-45", "Parents", "Expats"],
      branches: ["Dubai Marina", "Abu Dhabi"],
      isB2B: false,
      scale: 0.35,
      platforms: ["META", "GOOGLE_ADS", "LINKEDIN"] as Platform[],
    },
  ];

  for (const [ci, spec] of clientsSpec.entries()) {
    const client = await db.client.create({
      data: {
        organizationId: org.id,
        name: spec.name,
        slug: spec.slug,
        industry: spec.industry,
        country: spec.country,
        currency: spec.currency,
        timezone: spec.country === "AE" ? "Asia/Dubai" : "Africa/Cairo",
        brandColors: spec.colors,
        fonts: ["IBM Plex Sans Arabic", "Inter"],
        website: `https://${spec.slug}.example.com`,
        products: spec.products,
        audiences: spec.audiences,
        branches: spec.branches,
        contactName: "Client Contact",
        contactEmail: `marketing@${spec.slug}.example.com`,
        accountManagerId: ci === 0 ? team.id : manager.id,
        contractStart: daysAgo(500),
        package: ci === 0 ? "Growth – Full Funnel" : "Performance – Leads",
        goals: ci === 0 ? "Grow online sales 30% YoY with ROAS ≥ 4 and build the brand in Alexandria." : "Generate 400 qualified booking leads/month at CPL ≤ 60 AED.",
        isB2B: spec.isB2B,
        hiddenSections: ["audit"],
        isDemo: true,
      },
    });

    const brand = await db.brand.create({ data: { clientId: client.id, name: spec.name, colors: spec.colors } });
    const brand2 = ci === 0 ? await db.brand.create({ data: { clientId: client.id, name: "Nile Outdoor", colors: ["#15803d"] } }) : null;

    // Integrations in a variety of states so every status is visible in Settings.
    const integrationStates = [
      { platform: "META" as Platform, status: "CONNECTED" as const, expires: 45 },
      { platform: "GOOGLE_ADS" as Platform, status: "CONNECTED" as const, expires: 200 },
      { platform: spec.platforms[2], status: ci === 0 ? ("EXPIRED" as const) : ("PERMISSION_MISSING" as const), expires: -3 },
      { platform: "GA4" as Platform, status: "SYNC_FAILED" as const, expires: 90 },
      { platform: "SEARCH_CONSOLE" as Platform, status: "DISCONNECTED" as const, expires: null },
    ];
    const integrations: Record<string, string> = {};
    for (const s of integrationStates) {
      const integ = await db.integration.create({
        data: {
          organizationId: org.id,
          clientId: client.id,
          platform: s.platform,
          label: `${spec.name} – ${s.platform}`,
          status: s.status,
          tokenLast4: s.status === "DISCONNECTED" ? null : "demo",
          tokenExpiresAt: s.expires == null ? null : new Date(today.getTime() + s.expires * DAY),
          scopesRequired: ["ads_read", "read_insights"],
          scopesGranted: s.status === "PERMISSION_MISSING" ? ["ads_read"] : ["ads_read", "read_insights"],
          lastSyncAt: daysAgo(s.status === "CONNECTED" ? 0 : 2),
          lastSuccessAt: s.status === "DISCONNECTED" ? null : daysAgo(s.status === "CONNECTED" ? 0 : 3),
          lastError:
            s.status === "SYNC_FAILED"
              ? "Rate limit reached (HTTP 429). Will retry with backoff."
              : s.status === "EXPIRED"
                ? "Access token expired. Reconnect required."
                : s.status === "PERMISSION_MISSING"
                  ? "Missing scope: read_insights"
                  : null,
        },
      });
      integrations[s.platform] = integ.id;
      await db.syncRun.createMany({
        data: [0, 1, 2].map((n) => ({
          integrationId: integ.id,
          kind: "sync",
          status: s.status === "CONNECTED" || n > 0 ? "SUCCEEDED" : "FAILED",
          startedAt: daysAgo(n),
          finishedAt: new Date(daysAgo(n).getTime() + 60000),
          rowsUpserted: s.status === "CONNECTED" || n > 0 ? int(200, 900) : 0,
          message: s.status !== "CONNECTED" && n === 0 ? "Demo failure" : "Demo sync",
        })),
      });
    }

    const accounts = [];
    for (const p of spec.platforms) {
      accounts.push(
        await db.adAccount.create({
          data: {
            clientId: client.id,
            brandId: brand.id,
            integrationId: integrations[p],
            platform: p,
            externalId: `demo-${spec.slug}-${p.toLowerCase()}`,
            name: `${spec.name} · ${p.replace("_", " ")}`,
            currency: spec.currency,
            country: spec.country,
            source: "DEMO",
          },
        }),
      );
    }

    // Campaign structure
    type CSpec = { name: string; objective: Objective; funnel: FunnelStage; product: string; cpm: number; ctr: number; cvr: number; aov: number; budget: number; roas?: number; cpl?: number };
    const campaignSpecs: CSpec[] =
      ci === 0
        ? [
            { name: "Awareness – Brand Video", objective: "AWARENESS", funnel: "AWARENESS", product: "Sofas", cpm: 38, ctr: 0.006, cvr: 0.002, aov: 0, budget: 1800 , roas: 0.3, cpl: 900 },
            { name: "Prospecting – Sofas Catalog", objective: "SALES", funnel: "CONSIDERATION", product: "Sofas", cpm: 65, ctr: 0.012, cvr: 0.012, aov: 14500, budget: 3200 , roas: 3.1, cpl: 600 },
            { name: "Retargeting – Cart Abandoners", objective: "SALES", funnel: "CONVERSION", product: "Bedrooms", cpm: 95, ctr: 0.021, cvr: 0.034, aov: 22000, budget: 2200 , roas: 6.8, cpl: 400 },
            { name: "Leads – Interior Consultation", objective: "LEADS", funnel: "CONSIDERATION", product: "Dining", cpm: 55, ctr: 0.014, cvr: 0.07, aov: 0, budget: 1500 , roas: 0, cpl: 165 },
            { name: "Search – Furniture Egypt", objective: "SALES", funnel: "CONVERSION", product: "Sofas", cpm: 180, ctr: 0.055, cvr: 0.03, aov: 16000, budget: 2600 , roas: 4.6, cpl: 350 },
            { name: "Outdoor Summer Collection", objective: "TRAFFIC", funnel: "AWARENESS", product: "Outdoor", cpm: 42, ctr: 0.011, cvr: 0.004, aov: 9000, budget: 900 , roas: 1.4, cpl: 700 },
          ]
        : [
            { name: "Leads – Implants Consultation", objective: "LEADS", funnel: "CONVERSION", product: "Implants", cpm: 28, ctr: 0.011, cvr: 0.09, aov: 0, budget: 900 , roas: 0, cpl: 58 },
            { name: "Search – Dentist Dubai", objective: "LEADS", funnel: "CONVERSION", product: "Check-up", cpm: 120, ctr: 0.06, cvr: 0.08, aov: 0, budget: 700 , roas: 0, cpl: 72 },
            { name: "Awareness – Smile Makeover", objective: "VIDEO_VIEWS", funnel: "AWARENESS", product: "Whitening", cpm: 14, ctr: 0.004, cvr: 0.001, aov: 0, budget: 400 , roas: 0, cpl: 400 },
            { name: "B2B – Corporate Dental Plans", objective: "LEADS", funnel: "CONSIDERATION", product: "Check-up", cpm: 160, ctr: 0.008, cvr: 0.05, aov: 0, budget: 350 , roas: 0, cpl: 140 },
          ];

    const metrics: Prisma.MetricDailyCreateManyInput[] = [];
    const campaignIds: string[] = [];
    const devices = ["mobile", "desktop", "tablet"];
    const placements = ["feed", "stories", "reels", "search", "display"];
    const genders = ["female", "male"];
    const ages = ["18-24", "25-34", "35-44", "45-54", "55+"];

    for (const [i, cs] of campaignSpecs.entries()) {
      const platform: Platform = cs.name.startsWith("Search") ? "GOOGLE_ADS" : cs.name.startsWith("B2B") ? "LINKEDIN" : i % 3 === 2 && spec.platforms.includes("TIKTOK") ? "TIKTOK" : "META";
      const account = accounts.find((a) => a.platform === platform) ?? accounts[0];
      const start = daysAgo(HISTORY_DAYS - i * 20);
      const status = i === campaignSpecs.length - 1 ? "PAUSED" : "ACTIVE";
      const campaign = await db.campaign.create({
        data: {
          clientId: client.id,
          brandId: cs.product === "Outdoor" && brand2 ? brand2.id : brand.id,
          accountId: account.id,
          externalId: `demo-c-${ci}-${i}`,
          name: cs.name,
          platform,
          objective: cs.objective,
          funnelStage: cs.funnel,
          product: cs.product,
          country: spec.country,
          branch: pick(spec.branches),
          status,
          dailyBudget: new Prisma.Decimal(cs.budget * spec.scale),
          startDate: start,
          source: "DEMO",
        },
      });
      campaignIds.push(campaign.id);

      for (let s = 0; s < 2; s++) {
        const adSet = await db.adSet.create({
          data: { campaignId: campaign.id, name: `${cs.name} · ${spec.audiences[s % spec.audiences.length]}`, audience: spec.audiences[s % spec.audiences.length], externalId: `demo-as-${ci}-${i}-${s}` },
        });
        for (let a = 0; a < 2; a++) {
          const format = pick<ContentType>(["VIDEO", "IMAGE", "CAROUSEL", "REEL"]);
          const ad = await db.ad.create({
            data: { adSetId: adSet.id, name: `${format} – ${cs.product} v${a + 1}`, format, headline: `${cs.product}: ${a ? "Limited offer" : "New collection"}`, externalId: `demo-ad-${ci}-${i}-${s}-${a}` },
          });
          const quality = 0.75 + rnd() * 0.6; // some ads are winners
          for (let d = HISTORY_DAYS; d >= 1; d--) {
            const date = daysAgo(d);
            if (date < start) continue;
            if (status === "PAUSED" && d < 20) continue;
            const growth = 0.75 + (1 - d / HISTORY_DAYS) * 0.4; // account matured over time
            const spend = (cs.budget * spec.scale * season(date) * growth) / 4;
            const impressions = Math.round((spend / cs.cpm) * 1000);
            const clicks = Math.round(impressions * cs.ctr * quality * between(0.85, 1.15));
            const isLead = cs.objective === "LEADS";
            // Results are driven by realistic target ROAS / CPL with noise, per ad quality.
            const revenueVal = cs.aov > 0 && cs.roas ? spend * cs.roas * quality * between(0.75, 1.25) : 0;
            // stochastic rounding so low-volume days still convert proportionally
            const expected = cs.aov > 0 ? revenueVal / cs.aov : 0;
            const purchases = Math.floor(expected) + (rnd() < expected - Math.floor(expected) ? 1 : 0);
            const leads = Math.round((spend / (cs.cpl ?? 500)) * quality * between(0.7, 1.3) * (isLead ? 1 : 0.35));
            const videoViews = format === "VIDEO" || format === "REEL" ? Math.round(impressions * between(0.18, 0.32)) : 0;
            metrics.push({
              clientId: client.id,
              accountId: account.id,
              campaignId: campaign.id,
              adSetId: adSet.id,
              adId: ad.id,
              date,
              platform,
              device: platform === "GOOGLE_ADS" ? pick(devices) : rnd() < 0.85 ? "mobile" : "desktop",
              placement: platform === "GOOGLE_ADS" ? "search" : pick(placements.slice(0, 3)),
              gender: pick(genders),
              ageRange: pick(ages.slice(ci === 0 ? 1 : 1, 4)),
              country: spec.country,
              spend: new Prisma.Decimal(spend.toFixed(2)),
              impressions,
              reach: Math.round(impressions / between(1.4, 2.6)),
              clicks,
              leads,
              purchases,
              revenue: new Prisma.Decimal((purchases * cs.aov * between(0.9, 1.1)).toFixed(2)),
              videoViews,
              videoCompletions: Math.round(videoViews * between(0.18, 0.35)),
              engagements: Math.round(impressions * between(0.01, 0.035)),
              currency: spec.currency,
              source: "DEMO",
              syncedAt: new Date(today.getTime() - 2 * 3600000),
            });
          }
        }
      }
    }
    for (let i = 0; i < metrics.length; i += 5000) await db.metricDaily.createMany({ data: metrics.slice(i, i + 5000) });
    console.log(`  ${spec.name}: ${metrics.length} metric rows`);

    // Organic
    const organicAccounts = [];
    for (const p of ["FACEBOOK", "INSTAGRAM", ...(ci === 0 ? ["TIKTOK"] : ["LINKEDIN"])] as Platform[]) {
      organicAccounts.push(
        await db.adAccount.create({
          data: { clientId: client.id, brandId: brand.id, platform: p, externalId: `demo-page-${spec.slug}-${p}`, name: `${spec.name} ${p.toLowerCase()} page`, isOrganic: true, currency: spec.currency, source: "DEMO" },
        }),
      );
    }
    const organic: Prisma.OrganicMetricDailyCreateManyInput[] = [];
    for (const acc of organicAccounts) {
      let followers = int(8000, 60000) * (ci === 0 ? 1 : 0.3);
      for (let d = HISTORY_DAYS; d >= 1; d--) {
        followers += between(5, 60) * (ci === 0 ? 1 : 0.3);
        const posts = rnd() < 0.6 ? 1 : 0;
        const reach = Math.round(followers * between(0.03, 0.12) * (posts ? 1.8 : 1));
        organic.push({
          clientId: client.id,
          accountId: acc.id,
          date: daysAgo(d),
          platform: acc.platform,
          followers: Math.round(followers),
          posts,
          reach,
          impressions: Math.round(reach * 1.4),
          engagements: Math.round(reach * between(0.02, 0.07)),
          videoViews: Math.round(reach * between(0.1, 0.3)),
          source: "DEMO",
        });
      }
    }
    await db.organicMetricDaily.createMany({ data: organic });

    // Strategy
    await db.strategy.create({
      data: {
        clientId: client.id,
        status: "IN_REVIEW",
        sections: {
          overview: { text: `${spec.name} — ${spec.industry}. Demo strategy for illustration.` },
          products: { items: spec.products },
          markets: { items: ci === 0 ? ["Greater Cairo", "Alexandria", "Delta"] : ["Dubai", "Abu Dhabi"] },
          goals: { text: client.goals },
          smartGoals: {
            items:
              ci === 0
                ? ["Reach ROAS 4.0 on prospecting by end of Q4", "Grow Instagram followers 15% in 90 days", "Cut CPL for consultations to 180 EGP by next quarter"]
                : ["400 qualified leads / month at CPL ≤ 60 AED by Q1", "Raise booking show-up rate to 70%"],
          },
          personas: { items: spec.audiences.map((a) => ({ name: a, pains: ["Price transparency", "Delivery time", "Trust"], motivations: ["Quality", "Style"] })) },
          pillars: { items: ci === 0 ? ["Inspiration & styling", "Craftsmanship", "Customer homes (UGC)", "Offers & financing"] : ["Education", "Before & after", "Doctor expertise", "Offers"] },
          tone: { text: ci === 0 ? "Warm, aspirational, family-oriented; Egyptian Arabic in social, MSA on website." : "Reassuring, expert, clear; English & Arabic." },
          channels: { items: spec.platforms },
          kpis: { items: ["ROAS", "CPL", "CPA", "CTR", "Followers growth"] },
          risks: { items: ["Currency fluctuation affects media costs", "Seasonality around Ramadan", "Tracking loss (iOS)"] },
        },
      },
    });

    // Budget plan — current month + previous month
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const campaignsForPlan = await db.campaign.findMany({ where: { clientId: client.id } });
    const monthlyBudget = campaignSpecs.reduce((s, c) => s + c.budget * spec.scale, 0) * 30 * 1.02;
    const plan = await db.budgetPlan.create({
      data: {
        clientId: client.id,
        name: `${monthStart.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" })} media plan`,
        period: "MONTHLY",
        scenario: "BALANCED",
        startDate: monthStart,
        endDate: monthEnd,
        totalBudget: new Prisma.Decimal(Math.round(monthlyBudget)),
        currency: spec.currency,
        objective: ci === 0 ? "SALES" : "LEADS",
        status: "APPROVED",
        approvedById: manager.id,
        approvedAt: daysAgo(28),
        plannedContent: ci === 0 ? 24 : 16,
        source: "DEMO",
        assumptions: { note: "Demo assumptions based on seed data", cpm: { META: 60, GOOGLE_ADS: 170, TIKTOK: 35 } },
      },
    });
    for (const [i, c] of campaignsForPlan.entries()) {
      const cs = campaignSpecs.find((s) => s.name === c.name)!;
      const planned = cs.budget * spec.scale * 30 * (i % 2 ? 0.9 : 1.1);
      const impressions = Math.round((planned / cs.cpm) * 1000);
      const clicks = Math.round(impressions * cs.ctr);
      const conv = cs.objective === "LEADS" ? planned / (cs.cpl ?? 500) : cs.aov > 0 && cs.roas ? (planned * cs.roas) / cs.aov : planned / (cs.cpl ?? 500);
      await db.budgetLine.create({
        data: {
          planId: plan.id,
          category: "CAMPAIGN",
          label: c.name,
          platform: c.platform,
          campaignId: c.id,
          funnelStage: c.funnelStage,
          plannedBudget: new Prisma.Decimal(Math.round(planned)),
          plannedImpressions: impressions,
          plannedReach: Math.round(impressions / 2),
          plannedClicks: clicks,
          plannedLeads: cs.objective === "LEADS" ? Math.round(conv * 1.1) : Math.round((planned / (cs.cpl ?? 500)) * 0.35),
          plannedSales: cs.aov > 0 ? Math.round(conv * 1.05) : 0,
          plannedRevenue: new Prisma.Decimal(Math.round(cs.aov > 0 && cs.roas ? conv * cs.aov * 1.05 : 0)),
        },
      });
    }
    await db.budgetLine.createMany({
      data: [
        { planId: plan.id, category: "PRODUCTION", label: "Content production (shoots, editing)", plannedBudget: new Prisma.Decimal(Math.round(monthlyBudget * 0.06)) },
        { planId: plan.id, category: "TESTING", label: "Creative testing budget", plannedBudget: new Prisma.Decimal(Math.round(monthlyBudget * 0.05)) },
        { planId: plan.id, category: "CONTINGENCY", label: "Contingency reserve", plannedBudget: new Prisma.Decimal(Math.round(monthlyBudget * 0.03)) },
      ],
    });
    await db.expense.createMany({
      data: [
        { clientId: client.id, date: daysAgo(12), amount: new Prisma.Decimal(Math.round(monthlyBudget * 0.04)), currency: spec.currency, description: "Photo shoot – new collection (demo)", createdById: team.id },
        { clientId: client.id, date: daysAgo(5), amount: new Prisma.Decimal(Math.round(monthlyBudget * 0.015)), currency: spec.currency, description: "Video editing (demo)", createdById: team.id },
      ],
    });

    // Content calendar: ±45 days around today
    const statuses: ContentStatus[] = ["IDEA", "BRIEF", "IN_PRODUCTION", "INTERNAL_REVIEW", "CLIENT_REVIEW", "APPROVED", "SCHEDULED", "NEEDS_REVISION"];
    const pillars = ci === 0 ? ["Inspiration & styling", "Craftsmanship", "Customer homes (UGC)", "Offers & financing"] : ["Education", "Before & after", "Doctor expertise", "Offers"];
    const contentPlatforms: Platform[] = ci === 0 ? ["INSTAGRAM", "FACEBOOK", "TIKTOK"] : ["INSTAGRAM", "FACEBOOK", "LINKEDIN"];
    for (let d = -40; d <= 30; d += ci === 0 ? 2 : 3) {
      const when = new Date(today.getTime() + d * DAY + int(10, 20) * 3600000);
      const past = d < 0;
      const type = pick<ContentType>(["REEL", "CAROUSEL", "IMAGE", "STORY", "VIDEO"]);
      const pillar = pick(pillars);
      await db.contentItem.create({
        data: {
          clientId: client.id,
          brandId: brand.id,
          platform: pick(contentPlatforms),
          title: `${pillar}: ${pick(spec.products)} ${type.toLowerCase()}`,
          publishAt: when,
          timezone: client.timezone,
          type,
          pillar,
          funnelStage: pick<FunnelStage>(["AWARENESS", "CONSIDERATION", "CONVERSION"]),
          objective: pick<Objective>(["ENGAGEMENT", "REACH", "TRAFFIC", "LEADS"]),
          audience: pick(spec.audiences),
          caption: ci === 0 ? "بيتك يستاهل أحلى تفاصيل ✨ اكتشف التشكيلة الجديدة" : "Your smile deserves the best care. Book a free consultation.",
          hook: ci === 0 ? "3 أخطاء بتخلي الصالة شكلها أصغر" : "Is your smile holding you back?",
          cta: ci === 0 ? "تسوق الآن" : "Book now",
          hashtags: ci === 0 ? ["#ديكور", "#أثاث", "#NileHome"] : ["#Dubai", "#DentalCare"],
          keywords: [pick(spec.products).toLowerCase()],
          designBrief: "Warm natural light, lifestyle setting, brand colours, logo bottom corner.",
          assigneeId: pick([team.id, creator.id]),
          createdById: team.id,
          status: past ? (rnd() < 0.85 ? "PUBLISHED" : "REJECTED") : pick(statuses),
          publishedUrl: past ? "https://example.com/post/demo" : null,
          isPaid: rnd() < 0.25,
          boostBudget: rnd() < 0.25 ? new Prisma.Decimal(int(500, 3000) * spec.scale) : null,
          approvalDeadline: new Date(when.getTime() - 2 * DAY),
          resultReach: past ? int(3000, 40000) : null,
          resultEngagements: past ? int(100, 2500) : null,
          source: "DEMO",
        },
      });
    }
    const reviewItem = await db.contentItem.findFirst({ where: { clientId: client.id, status: "CLIENT_REVIEW" } });
    if (reviewItem) {
      await db.comment.createMany({
        data: [
          { contentId: reviewItem.id, userId: team.id, body: "Updated the hook per brand guidelines.", internal: true },
          { contentId: reviewItem.id, userId: ci === 0 ? clientUser.id : manager.id, body: "Looks good — can we try a warmer colour grade?", internal: false },
        ],
      });
    }

    // Competitors: 4 manual (accepted) + 4 system suggestions (pending)
    const compNames =
      ci === 0
        ? ["Cairo Living Co.", "Delta Wood Studio", "Modern Nest EG", "Alex Home Gallery", "Pharaoh Interiors", "Urban Majlis", "Zamalek Design House", "Sahel Outdoor"]
        : ["Bright Smile Dubai", "Marina Dental Care", "Pearl Dental Group", "Abu Dhabi Smiles", "Emirates Ortho", "City Dental Hub", "Palm Aligners", "Gulf Implant Center"];
    for (const [k, name] of compNames.entries()) {
      const manual = k < 4;
      const comp = await db.competitor.create({
        data: {
          clientId: client.id,
          name,
          website: `https://${name.toLowerCase().replace(/[^a-z]+/g, "-")}.example.com`,
          socialLinks: { facebook: "https://facebook.com/example", instagram: "https://instagram.com/example" },
          activePlatforms: ["FACEBOOK", "INSTAGRAM", ...(k % 2 ? (["TIKTOK"] as Platform[]) : [])],
          origin: manual ? "MANUAL" : "SUGGESTED",
          state: manual ? "ACCEPTED" : "PENDING",
          suggestionReason: manual ? null : `Same industry (${spec.industry}) and market (${spec.country}); overlaps on keywords "${pick(spec.products).toLowerCase()}" and audience "${pick(spec.audiences)}". (Demo suggestion)`,
          followers: { instagram: { count: int(10000, 250000), growthPct: between(-0.01, 0.06), asOf: today.toISOString(), source: "Demo" } },
          postingPerWeek: Number(between(2, 12).toFixed(1)),
          contentTypes: ["Reels", "Carousels", "Stories"],
          pillars: ["Offers", "Product showcase", "Testimonials"],
          engagementLevel: pick(["LOW", "MEDIUM", "HIGH"]),
          recurringMessages: ci === 0 ? ["Installments 0% interest", "Free delivery", "Made in Egypt"] : ["Free consultation", "Pain-free treatment", "Payment plans"],
          designStyle: "Bright lifestyle photography, bold price tags",
          ctas: ["Shop now", "Send message", "Book now"],
          landingPages: [`https://${name.toLowerCase().replace(/[^a-z]+/g, "-")}.example.com/offers`],
          strengths: ["Consistent posting", "Strong offers"],
          weaknesses: ["Little educational content", "Slow response to comments"],
          opportunities: ["No video tutorials", "Weak presence on TikTok", "No UGC programme"],
          source: "DEMO",
        },
      });
      // ads observed (demo stand-ins for official ad-library records)
      for (let a = 0; a < 5; a++) {
        const first = daysAgo(int(1, 400));
        const active = rnd() < 0.6;
        const last = active ? today : new Date(Math.min(today.getTime(), first.getTime() + int(5, 90) * DAY));
        await db.competitorAd.create({
          data: {
            competitorId: comp.id,
            platform: "META",
            libraryId: `demo-lib-${ci}-${k}-${a}`,
            firstSeen: first,
            lastSeen: last,
            isActive: active,
            placements: ["facebook_feed", "instagram_feed", "instagram_stories"].slice(0, int(1, 3)),
            format: pick<ContentType>(["IMAGE", "VIDEO", "CAROUSEL", "LEAD_FORM"]),
            creativeIdea: pick(["Room makeover before/after", "Price-drop countdown", "Customer testimonial", "Founder story", "Product close-up"]),
            hook: pick(["Only this week!", "Why pay more?", "See the difference", "Your dream home starts here"]),
            offer: pick(["20% off", "0% installments 12 months", "Free delivery", "Free consultation", null]),
            message: pick(spec.products) + " quality at a fair price",
            cta: pick(["Shop now", "Learn more", "Send message", "Book now"]),
            product: pick(spec.products),
            audienceGuess: pick(spec.audiences),
            funnelGuess: pick<FunnelStage>(["AWARENESS", "CONSIDERATION", "CONVERSION"]),
            landingPage: "https://example.com/offer",
            variantCount: int(1, 6),
            relaunched: rnd() < 0.2,
            source: "DEMO",
          },
        });
      }
      // posts across previous years for seasonal analysis
      for (let y = 0; y < 3; y++) {
        for (const occ of ["Ramadan", "Eid al-Fitr", "White Friday", "Back to school", "New Year"]) {
          const month = { Ramadan: 2, "Eid al-Fitr": 3, "White Friday": 10, "Back to school": 8, "New Year": 11 }[occ]!;
          await db.competitorPost.create({
            data: {
              competitorId: comp.id,
              platform: pick<Platform>(["INSTAGRAM", "FACEBOOK", "TIKTOK"]),
              postedAt: new Date(Date.UTC(today.getUTCFullYear() - y, month, int(1, 27))),
              type: pick<ContentType>(["REEL", "CAROUSEL", "IMAGE"]),
              topic: pick(["Discount campaign", "Gift guide", "Family gathering", "Countdown offer", "Charity / CSR"]),
              occasion: occ,
              engagements: int(200, 9000),
              isTopPost: rnd() < 0.2,
              source: "DEMO",
            },
          });
        }
      }
    }

    // Ideas: 10 competitor-inspired + 10 trend + 10 original
    const compIdeas = [
      ["Before/after room makeovers", "Cairo Living Co.", "Transformation content is highly shareable", "Film real customer homes with a 15-second reveal and styling tips"],
      ["Installment calculator ads", "Modern Nest EG", "Reduces price anxiety", "Interactive story poll: 'guess the monthly installment'"],
      ["Founder story video", "Delta Wood Studio", "Builds trust & authenticity", "Workshop mini-documentary series with craftsmen"],
      ["Countdown White Friday", "Alex Home Gallery", "Urgency drives conversion", "Early-access list via WhatsApp instead of generic countdown"],
      ["Customer testimonial carousel", "Cairo Living Co.", "Social proof", "Carousel of real reviews with room photos"],
      ["Free delivery message", "Modern Nest EG", "Removes friction", "Pair with delivery-time guarantee"],
      ["Product close-up ASMR", "Delta Wood Studio", "Stops the scroll", "Fabric & wood texture ASMR reels"],
      ["Room-by-room guides", "Alex Home Gallery", "Saves & shares", "Downloadable styling checklist lead magnet"],
      ["Live showroom tours", "Pharaoh Interiors", "Real-time Q&A", "Monthly live tour with designer answering DMs"],
      ["Bundle offers", "Urban Majlis", "Higher AOV", "Complete-the-room bundle builder landing page"],
    ];
    await db.idea.createMany({
      data: compIdeas.map(([title, comp, why, twist], k) => ({
        clientId: client.id,
        source: "COMPETITOR",
        title,
        competitorName: ci === 0 ? comp : compNames[k % 8],
        originalIdea: title,
        whyItWorked: why,
        ourTwist: twist,
        platform: pick<Platform>(["INSTAGRAM", "TIKTOK", "FACEBOOK"]),
        format: pick<ContentType>(["REEL", "CAROUSEL", "VIDEO", "STORY"]),
        audience: pick(spec.audiences),
        objective: pick<Objective>(["ENGAGEMENT", "SALES", "LEADS"]),
        funnelStage: pick<FunnelStage>(["AWARENESS", "CONSIDERATION", "CONVERSION"]),
        hook: "Would you believe this is the same room?",
        cta: "Book a free design consultation",
        priority: pick(["HIGH", "MEDIUM", "LOW"] as const),
        ease: int(2, 5),
        impact: int(2, 5),
        costEstimate: pick(["Low", "Medium", "High"]),
        successMetrics: ["Saves", "Shares", "CTR"],
        dataSource: "DEMO",
      })),
    });
    const trendKw = ci === 0 ? ["modern sofa designs", "small living room ideas", "كنب مودرن", "غرف نوم 2026", "outdoor furniture", "wood vs mdf", "japandi style", "furniture installments", "home office setup", "كنب سرير"] : ["teeth whitening cost", "invisalign dubai", "dental implants price", "kids dentist", "gum bleeding", "veneers vs crowns", "smile makeover", "emergency dentist", "dental insurance uae", "tooth sensitivity"];
    await db.trendSignal.createMany({
      data: trendKw.map((k, n) => ({
        clientId: client.id,
        keyword: k,
        kind: pick(["SEARCH", "RISING", "QUESTION", "TOPIC"]),
        sourceName: "Demo trend feed",
        growthPct: Number(between(-0.1, 1.8).toFixed(2)),
        volumeIndex: int(20, 100),
        discoveredAt: daysAgo(n),
        expiresAt: new Date(today.getTime() + int(7, 60) * DAY),
        source: "DEMO",
      })),
    });
    await db.idea.createMany({
      data: trendKw.map((k, n) => ({
        clientId: client.id,
        source: "TREND",
        title: `Content around “${k}”`,
        reason: `Rising search interest for "${k}" (demo signal).`,
        signalSource: "Demo trend feed",
        signalGrowth: Number(between(0.1, 1.5).toFixed(2)),
        validUntil: new Date(today.getTime() + int(7, 60) * DAY),
        keyword: k,
        searchIntent: pick(["Informational", "Commercial", "Transactional"]),
        platform: pick<Platform>(["INSTAGRAM", "TIKTOK", "YOUTUBE"]),
        format: pick<ContentType>(["REEL", "SHORT", "CAROUSEL"]),
        audience: pick(spec.audiences),
        objective: pick<Objective>(["REACH", "TRAFFIC", "ENGAGEMENT"]),
        funnelStage: "AWARENESS",
        hook: `Everyone is searching for ${k} — here's what nobody tells you`,
        cta: "Save this for later",
        captionOutline: "1) Problem 2) 3 quick tips 3) Product as solution 4) CTA",
        visualDirection: "Fast cuts, text overlays, native feel",
        priority: n < 3 ? "HIGH" : "MEDIUM",
        ease: int(2, 5),
        impact: int(2, 5),
        isSeasonal: n % 3 === 0,
        isEvergreen: n % 3 !== 0,
        dataSource: "DEMO",
      })),
    });
    const originals = ci === 0 ? ["Design-your-corner challenge", "Meet the craftsman series", "Room styling in 60 seconds", "Customer home of the month", "Fabric guide for families with kids", "Newlywed checklist", "Myth vs fact: solid wood", "Showroom behind the scenes", "Colour of the season", "Care & maintenance tips"] : ["Ask the dentist Friday", "Kids first visit guide", "Smile stories", "Myth vs fact: whitening", "30-day aligner diary", "Corporate wellness webinar", "Price transparency guide", "Emergency checklist", "Meet the team", "Patient FAQ reels"];
    await db.idea.createMany({
      data: originals.map((title, n) => ({
        clientId: client.id,
        source: "ORIGINAL",
        title,
        reason: "Fills a content gap vs competitors and supports the client's SMART goals.",
        platform: pick<Platform>(["INSTAGRAM", "TIKTOK", "FACEBOOK", "LINKEDIN"]),
        format: pick<ContentType>(["REEL", "CAROUSEL", "VIDEO", "LIVE"]),
        audience: pick(spec.audiences),
        objective: pick<Objective>(["ENGAGEMENT", "LEADS", "SALES"]),
        funnelStage: pick<FunnelStage>(["AWARENESS", "CONSIDERATION", "CONVERSION", "RETENTION"]),
        hook: "You've been doing this wrong…",
        cta: "Send us a message",
        priority: n < 4 ? "HIGH" : "MEDIUM",
        ease: int(2, 5),
        impact: int(3, 5),
        costEstimate: pick(["Low", "Medium"]),
        successMetrics: ["Engagement rate", "Leads"],
        isEvergreen: true,
        dataSource: "DEMO",
      })),
    });

    // Reports, tasks
    const report = await db.report.create({
      data: {
        clientId: client.id,
        type: "MONTHLY_CLIENT",
        title: `${spec.name} — Monthly report (demo)`,
        periodStart: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)),
        periodEnd: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)),
        config: { platforms: spec.platforms, kpis: ["spend", "revenue", "roas", "leads", "cpl", "ctr"], compare: "prev" },
        summary: {
          wins: ["Retargeting ROAS improved", "CTR above market median"],
          challenges: ["CPM increased during peak season"],
          learnings: ["Video creatives outperform static on prospecting"],
        },
        schedule: "monthly:1:09:00",
        recipients: [`marketing@${spec.slug}.example.com`],
        createdById: team.id,
      },
    });
    await db.task.createMany({
      data: [
        { clientId: client.id, reportId: report.id, title: "Shift 10% budget from awareness to retargeting", assigneeId: team.id, dueDate: new Date(today.getTime() + 3 * DAY), priority: "HIGH", createdById: manager.id },
        { clientId: client.id, reportId: report.id, title: "Refresh creatives with frequency > 3.5", assigneeId: creator.id, dueDate: new Date(today.getTime() + 5 * DAY), priority: "MEDIUM", status: "IN_PROGRESS", createdById: manager.id },
        { clientId: client.id, title: "Reconnect expired integration", assigneeId: admin.id, dueDate: new Date(today.getTime() + 1 * DAY), priority: "CRITICAL", createdById: admin.id },
        { clientId: client.id, title: "Approve next month's content calendar", assigneeId: ci === 0 ? clientUser.id : manager.id, dueDate: new Date(today.getTime() - 1 * DAY), priority: "HIGH", createdById: team.id },
      ],
    });

    await db.notification.createMany({
      data: [
        { organizationId: org.id, clientId: client.id, type: "SPEND_OVER", severity: "WARNING", title: `${spec.name}: spend pacing 12% above plan`, body: "At the current run-rate the monthly budget will be exhausted 3 days early.", link: "/plan-vs-actual" },
        { organizationId: org.id, clientId: client.id, type: "TOKEN_EXPIRING", severity: "CRITICAL", title: `${spec.name}: an integration token expired`, body: "Reconnect to resume data sync.", link: "/settings?tab=integrations" },
        { organizationId: org.id, clientId: client.id, type: "COMPETITOR_AD", severity: "INFO", title: `${compNames[0]} launched 2 new ads`, body: "New offer messaging detected: '0% installments'. (Demo)", link: "/competitors" },
        { organizationId: org.id, clientId: client.id, type: "TREND", severity: "SUCCESS", title: `Rising trend: "${trendKw[1]}"`, body: "Interest grew in the last 7 days. (Demo)", link: "/trends" },
      ],
    });

    // CLIENT and VIEWER users see only the first client
    if (ci === 0) {
      await db.clientAccess.createMany({ data: [{ userId: clientUser.id, clientId: client.id }, { userId: viewer.id, clientId: client.id }] });
    }
  }

  // Benchmarks — illustrative, clearly marked as estimates. Replace with licensed / verified sources.
  const bm: [string, Platform | null, number, number, number, boolean][] = [
    ["CPM", "META", 35, 55, 85, false],
    ["CPC", "META", 1.2, 2.4, 4.5, false],
    ["CTR", "META", 0.007, 0.012, 0.02, true],
    ["CPL", "META", 60, 140, 260, false],
    ["CVR", "META", 0.01, 0.025, 0.05, true],
    ["ROAS", "META", 1.8, 3.2, 5.0, true],
    ["ER", "INSTAGRAM", 0.008, 0.018, 0.035, true],
    ["VCR", "META", 0.15, 0.25, 0.38, true],
    ["FREQ", "META", 1.4, 2.2, 3.5, false],
    ["CPM", "GOOGLE_ADS", 90, 160, 260, false],
    ["CPC", "GOOGLE_ADS", 2.5, 4.5, 8, false],
    ["CTR", "GOOGLE_ADS", 0.03, 0.05, 0.08, true],
    ["CPA", "GOOGLE_ADS", 300, 650, 1200, false],
    ["CPM", "TIKTOK", 20, 35, 60, false],
    ["CTR", "TIKTOK", 0.006, 0.01, 0.016, true],
    ["CPM", "LINKEDIN", 150, 260, 420, false],
    ["CTR", "LINKEDIN", 0.004, 0.006, 0.009, true],
    ["FOLLOWER_GROWTH", "INSTAGRAM", 0.005, 0.015, 0.03, true],
  ];
  await db.benchmark.createMany({
    data: bm.map(([metric, platform, p25, median, p75, hib]) => ({
      organizationId: null,
      metric,
      platform,
      country: "EG",
      p25,
      median,
      p75,
      higherIsBetter: hib,
      currency: ["CPM", "CPC", "CPL", "CPA"].includes(metric) ? "EGP" : null,
      sourceName: "Illustrative sample benchmark (demo) — replace with a verified source",
      sampleSize: null,
      periodLabel: "Trailing 12 months",
      asOf: daysAgo(20),
      isEstimate: true,
    })),
  });
  await db.benchmark.create({
    data: { organizationId: org.id, metric: "CPL", platform: "META", country: "EG", industry: "Furniture & Home Decor", median: 150, p25: 90, p75: 230, higherIsBetter: false, currency: "EGP", sourceName: "Demo Agency internal portfolio (manual)", sampleSize: 14, periodLabel: "2025", asOf: daysAgo(40), isManual: true, isEstimate: false },
  });

  await db.auditLog.create({ data: { organizationId: org.id, userId: admin.id, userEmail: admin.email, action: "seed", entity: "Organization", entityId: org.id, summary: "Demo workspace created" } });
  console.log("Done. Log in with admin@demo.local / Demo@12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
