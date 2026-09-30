# 06 · Wireframes (low fidelity)

> **ملخص بالعربية**
>
> رسومات تخطيطية مبسطة لأهم الصفحات على الحاسوب والجوال: لوحة الإدارة التنفيذية، تقويم المحتوى، مخطط الميزانية، ذكاء المنافسين، الإعدادات والتكاملات، والتقرير المشارك. الرسومات مرسومة باتجاه الإنجليزية (من اليسار لليمين)؛ في العربية تنعكس الواجهة بالكامل: القائمة الجانبية على اليمين، والأسهم معكوسة، بينما تبقى الأرقام والرسوم البيانية الزمنية من اليسار لليمين. الجوال مصمم لعرض 360 بكسل: البطاقات عمود واحد، الجداول تُمرَّر أفقيًا، والقائمة الجانبية تصبح قائمة منزلقة.

Conventions

* Drawn LTR. In Arabic the whole layout mirrors (sidebar on the right, `flip-rtl` chevrons, `text-start`), but numbers (`.num`) and time axes stay left-to-right.
* `[▾]` select · `[ Button ]` · `(•)` status dot · `▮▮▮` bar · `╱╲` line · `⟲` sync · `ⓘ` tooltip · `DEMO` purple badge · `EST` estimate badge.
* Every chart/table card footer: `Source · Last updated · DEMO/EST badge` (`<DataMeta>`).
* Mobile width 360 px: one column, sticky top bar, filter bar collapses into a "Filters" sheet, tables scroll horizontally.

---

## 1. Executive Dashboard `/dashboard`

### Desktop (≥ 1280 px)

```
┌───────────────┬──────────────────────────────────────────────────────────────────────────────┐
│ ◧ Logo  Name  │ Executive Dashboard                         AR|EN  ☾  🔔3  (SA) Sara ▾        │
│               ├──────────────────────────────────────────────────────────────────────────────┤
│ OVERVIEW      │ [Client ▾ Nile Home] [Brand ▾] [Platform ▾] [Last 30 days ▾] [vs Prev ▾] [+More]│
│ ▸ Dashboard   │                                               [Save view] [Export ▾] DEMO     │
│   Analytics   ├──────────────────────────────────────────────────────────────────────────────┤
│   Campaigns   │ ┌Spend──────────┐┌Revenue────────┐┌ROAS──────────┐┌Leads─────────┐┌CPL────────┐ │
│   Clients     │ │ EGP 1.24M     ││ EGP 5.1M      ││ 4.1x         ││ 3,420        ││ EGP 362   │ │
│ PLAN          │ │ ▲ 8.2% vs prev││ ▲ 12%         ││ ▲ 0.3        ││ ▼ 4% (red)   ││ ▲ 6% (red)│ │
│   Strategy    │ │ Target 1.3M   ││ Mkt —         ││ Mkt 3.2x ✓   ││ Target 3.6k  ││ Mkt 410 ✓ │ │
│   Budget      │ └───────────────┘└───────────────┘└──────────────┘└──────────────┘└───────────┘ │
│   Plan vs Act │ ┌ Spend & results over time ─────────────────────┐┌ Budget pacing ───────────┐ │
│ CONTENT       │ │  ╱╲    ╱╲╱╲      ── Spend  ── Revenue           ││ ████████████░░░░  72%    │ │
│   Calendar    │ │ ╱  ╲__╱    ╲╱╲                                  ││ Planned 1.7M · Spent 1.24M│ │
│   Library     │ │ one Y axis only (no dual axis)                  ││ Forecast 1.68M  EST ⓘ    │ │
│   Approvals   │ │ Source: Meta, Google API · Updated 12 min ago   ││ Depletes: 28 Oct EST     │ │
│ INTELLIGENCE  │ └─────────────────────────────────────────────────┘└──────────────────────────┘ │
│   Competitors │ ┌ Executive summary (rule-based / AI) ────────────────────────────────────────┐ │
│   Trends      │ │ What happened   • Spent EGP 1.24M, up 8.2% [FACT · Meta API · 100%]         │ │
│   Benchmarks  │ │ Why             • CPM ▲ 14% drove cost [FACT · 80%]                         │ │
│ REPORTING     │ │ Problems        • Campaign "Summer Sofas" frequency 4.2 [FACT]              │ │
│   Reports     │ │ Actions         • Move EGP 18k from A → B [RECOMMENDATION · 70%] [Accept][✕]│ │
│   Tasks       │ │ Outlook         • Projected spend 1.68M [ESTIMATE · 65%]                    │ │
│   Notif.      │ └──────────────────────────────────────────────────────────────────────────────┘ │
│ ADMIN         │ ┌ Platform split (donut) ──┐┌ Top campaigns ─────────────────────────────────┐  │
│   Users       │ │   ◔ Meta 58%             ││ Name          Spend   ROAS  CPL   Freq  Status │  │
│   Settings    │ │   ◑ Google 31%           ││ Summer Sofas  210k    3.1x  410   4.2⚠  Active │  │
│   Audit       │ │   ◕ TikTok 11%           ││ Bedrooms Srch 180k    5.4x  290   —     Active │  │
│   Help        │ └──────────────────────────┘└────────────────────────────────────────────────┘  │
└───────────────┴──────────────────────────────────────────────────────────────────────────────┘
```

### Mobile (360 px)

```
┌──────────────────────────────┐
│ ☰  Executive Dashboard   🔔 ◉│
├──────────────────────────────┤
│ Nile Home ▾ · 30d ▾ [Filters]│
│ DEMO                [Export] │
├──────────────────────────────┤
│ ┌Spend───────┐┌Revenue─────┐ │
│ │EGP 1.24M   ││EGP 5.1M    │ │
│ │▲ 8.2%      ││▲ 12%       │ │
│ └────────────┘└────────────┘ │
│ ┌ROAS────────┐┌Leads───────┐ │
│ │4.1x        ││3,420 ▼4%   │ │
│ └────────────┘└────────────┘ │
│ ┌ Spend over time ─────────┐ │
│ │ ╱╲  ╱╲╱                  │ │
│ │ Source · 12 min ago      │ │
│ └──────────────────────────┘ │
│ ┌ Budget pacing ───────────┐ │
│ │ ████████░░░ 72%  EST     │ │
│ └──────────────────────────┘ │
│ ┌ Summary ─────────── ▾ ──┐ │
│ │ • Spent 1.24M (FACT)     │ │
│ └──────────────────────────┘ │
│ ┌ Top campaigns ──── ⇆ ───┐ │
│ │ Name      Spend  ROAS  … │ │  ← horizontal scroll
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

---

## 2. Content Calendar `/calendar`

### Desktop

```
┌─ Content Calendar ───────────────────────────────────────────────────────────────────────────┐
│ [Client ▾] [Platform ▾] [Type ▾] [Status ▾] [Assignee ▾]      [Month|Week|List]  [+ New post] │
│ ‹  October 2026  ›   TZ: Africa/Cairo ⓘ                                   Best times: EST ⓘ   │
├────────┬────────┬────────┬────────┬────────┬────────┬────────┬───────────────────────────────┤
│  Sat   │  Sun   │  Mon   │  Tue   │  Wed   │  Thu   │  Fri   │ ┌ Selected post ────────────┐ │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┤ │ Reel · Instagram           │ │
│ 1      │ 2      │ 3      │ 4      │ 5      │ 6      │ 7      │ │ "Autumn living room"       │ │
│ ▣ IG   │        │ ▣ FB   │ ▣ TT ⚠ │        │ ▣ IG   │        │ │ Status: (•) Client review  │ │
│ Reel   │        │ Post   │ conflict│       │ Carou. │        │ │ Publish: 6 Oct 19:30       │ │
│ (•)Appr│        │ (•)Idea│ (•)Rev │        │ (•)Sch │        │ │ Pillar: Inspiration        │ │
├────────┼────────┼────────┼────────┼────────┼────────┼────────┤ │ Caption / Hook / CTA …     │ │
│ 8      │ 9 ▢drop│ 10     │ 11     │ 12     │ 13     │ 14     │ │ Assets ▢▢  v3 ⟲ history    │ │
│ ▣ LI   │        │ ▣ IG ↻ │        │ ▣ YT   │ ▣ IG ↻ │        │ │ Comments (2) · internal 🔒 │ │
│ Article│        │ weekly │        │ Short  │ weekly │        │ │ [Submit for review]        │ │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┘ └────────────────────────────┘ │
│ Legend: (•) grey Idea/Brief · blue In production · orange Review · green Approved/Scheduled │
│         purple Published · red Needs revision/Rejected   ↻ recurring   ⚠ time conflict       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile

```
┌──────────────────────────────┐
│ ☰  Calendar        [+ New]   │
│ Nile Home ▾   [Week|List]    │
├──────────────────────────────┤
│ ‹ Wk 41 · 6–12 Oct ›         │
│ Mon 6                        │
│ ┌ 19:30 IG Reel ─── (•)Rev ┐ │
│ │ Autumn living room       │ │
│ └──────────────────────────┘ │
│ Tue 7                        │
│ ┌ 12:00 FB Post ── (•)Appr ┐ │
│ └──────────────────────────┘ │
│ Wed 8   — nothing scheduled  │
│  (tap a card → full-screen   │
│   editor sheet)              │
└──────────────────────────────┘
```

---

## 3. Budget Planner `/budget`

### Desktop

```
┌─ Budget Planner ─────────────────────────────────────────────────────────────────────────────┐
│ [Client ▾] Plan: [Q4 2026 ▾] [+ New plan]      Status: DRAFT   [Submit] [Approve]* [Export ▾] │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Period [Quarterly ▾]  01 Oct – 31 Dec   Total [ EGP 1,800,000 ]  Objective [Sales ▾]          │
│ Scenario:  ( ) Conservative  (•) Balanced  ( ) Aggressive  ( ) Custom                          │
├───────────────────────────────────────────────────────┬──────────────────────────────────────┤
│ Allocation                        [By platform|funnel|objective|campaign]                     │
│ Line            Category     Budget      %    Exp.CPM  Exp.CPL  Leads  Sales  Revenue  EST   │
│ Meta prospect.  PROSPECTING  720,000   40%     85      350     2,057   …      …        ⓘ     │
│ Meta retarget.  RETARGETING  270,000   15%    120      210     1,285   …      …              │
│ Google Search   PLATFORM     540,000   30%     —       300     1,800   …      …              │
│ TikTok test     TESTING      180,000   10%     40      —       …                              │
│ Contingency     CONTINGENCY   90,000    5%                                                    │
│ ───────────────────────────────────────────                                                   │
│ Total                      1,800,000  100%  ✓ balanced                  [+ Add line]         │
├───────────────────────────────────────────────────────┴──────────────────────────────────────┤
│ ┌ Split (stacked bar, fixed palette) ┐ ┌ Expected results (from assumptions) EST ┐           │
│ │ ▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯               │ │ Leads 5,142 · Sales 610 · ROAS 3.4x      │           │
│ └────────────────────────────────────┘ │ Assumptions: [edit CPM/CPC/CPL/CVR]      │           │
│                                         └──────────────────────────────────────────┘           │
│ * Approve visible only with budget:approve.   AI: [Suggest reallocation] → pending suggestion │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile

```
┌──────────────────────────────┐
│ ☰  Budget          [Export]  │
│ Q4 2026 ▾   DRAFT            │
├──────────────────────────────┤
│ Total  EGP 1,800,000         │
│ Scenario [Balanced ▾]        │
├──────────────────────────────┤
│ ┌ Meta prospecting ───────┐  │
│ │ 720,000 · 40%    [edit] │  │
│ │ Exp. leads 2,057  EST   │  │
│ └─────────────────────────┘  │
│ ┌ Google Search ──────────┐  │
│ │ 540,000 · 30%    [edit] │  │
│ └─────────────────────────┘  │
│ … [+ Add line]               │
│ Σ 100% ✓                     │
│ [Submit for approval]        │
└──────────────────────────────┘
```

---

## 4. Competitor Intelligence `/competitors`

### Desktop

```
┌─ Competitor Intelligence ────────────────────────────────────────────────────────────────────┐
│ [Client ▾]  Competitors: [All ▾]  Platform [▾]  Period [90d ▾]   [+ Add competitor] [Export]  │
│ ⓘ Ads from the official Meta Ad Library. Spend is not disclosed for most ads — we show an     │
│   Estimated Advertising Intensity index instead.                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Competitor      Active ads  New(14d)  Avg run  Intensity (EST ⓘ)      Followers   Posts/wk   │
│ Cairo Living        24          6       38d    ██████████░ 78 HIGH     412k (IG)    5.5       │
│ Delta Furnish       9           1       61d    █████░░░░░░ 44 MED      98k          3.0       │
│ Home Box EG         2           0       12d    ██░░░░░░░░░ 17 LOW      51k          1.5       │
├──────────────────────────────────────┬───────────────────────────────────────────────────────┤
│ Suggested competitors (PENDING)      │ Ad feed — Cairo Living                                 │
│ • Sofa Town  reason: same category   │ ┌ NEW · FB, IG · since 3 Oct ───────────────────────┐ │
│   [Accept] [Reject]                  │ │ Hook: "Only 5 days left…"  Offer: 30% off          │ │
│                                      │ │ CTA: Shop now  Funnel guess: CONVERSION            │ │
│ SWOT (manual / AI-assisted, editable)│ │ Variants 4 · [View in Ad Library ↗]                │ │
│ Strengths · Weaknesses · Opps        │ │ [→ Create idea from this] (original adaptation)    │ │
│                                      │ └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────┴───────────────────────────────────────────────────────┘
```

### Mobile

```
┌──────────────────────────────┐
│ ☰  Competitors        [+ ]   │
│ ⓘ Intensity = estimate       │
├──────────────────────────────┤
│ ┌ Cairo Living ───────────┐  │
│ │ 24 active · 6 new        │  │
│ │ ██████████░ 78 HIGH EST  │  │
│ │ [Ads] [Posts] [SWOT]     │  │
│ └──────────────────────────┘  │
│ ┌ Delta Furnish ──────────┐  │
│ │ █████░░░ 44 MED EST      │  │
│ └──────────────────────────┘  │
└──────────────────────────────┘
```

---

## 5. Settings → Integrations `/settings/integrations`

### Desktop

```
┌─ Settings ───────────────────────────────────────────────────────────────────────────────────┐
│ [General] [Branding] [Security] [FX rates] [Integrations] [Notifications]                     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Client: [Nile Home ▾]                                   Server config: APP_URL ✓ ENCRYPTION ✓ │
│                                                         SMTP ✓ CRON_SECRET ✗                  │
│ ┌ Meta Ads ─────────────── (•) CONNECTED ┐ ┌ Google Ads ──────── (•) PERMISSION_MISSING ┐     │
│ │ Token ****9f3a · expires in 52 days     │ │ Token ****k2Qe                               │     │
│ │ Scopes ✓ ads_read ✓ business_management │ │ Missing: adwords  [Reconnect]               │     │
│ │ Accounts: 2 linked [Manage]             │ │ Last success 3 days ago                      │     │
│ │ Last sync 12 min ago · 1,204 rows       │ │ Last error: PERMISSION — forbidden …          │     │
│ │ [⟲ Sync now] [Test] [Disconnect]        │ │ [Test] [Disconnect]                          │     │
│ └─────────────────────────────────────────┘ └──────────────────────────────────────────────┘     │
│ ┌ TikTok Ads ───────────── (•) EXPIRED ─┐ ┌ X (Twitter) ─────── (•) DISCONNECTED ────┐        │
│ │ ⚠ Token revoked — reconnect            │ │ Requires paid API tier ⓘ                  │        │
│ │ [Reconnect]                            │ │ Env: X_CLIENT_ID ✗  [Setup guide ↗]       │        │
│ └────────────────────────────────────────┘ └───────────────────────────────────────────┘        │
│ ┌ Google Trends ─ No official API ─ Import CSV only [Import] ┐                                │
│ Sync history (SyncRun): time · kind · status · rows · message                                │
│ Only Super Admins can connect or disconnect. Tokens are encrypted; only last 4 chars shown.  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile

```
┌──────────────────────────────┐
│ ‹ Settings · Integrations    │
│ Client [Nile Home ▾]         │
├──────────────────────────────┤
│ ┌ Meta Ads  (•) Connected ┐  │
│ │ ****9f3a · 52 d left     │  │
│ │ Synced 12 min ago        │  │
│ │ [⟲ Sync] [⋯]             │  │
│ └──────────────────────────┘  │
│ ┌ Google Ads (•) Missing ─┐  │
│ │ scope adwords  [Fix]     │  │
│ └──────────────────────────┘  │
│ ┌ TikTok (•) Expired ─────┐  │
│ │ [Reconnect]              │  │
│ └──────────────────────────┘  │
└──────────────────────────────┘
```

---

## 6. Report — builder `/reports` and shared view `/r/[token]`

### Desktop (shared report, white-labelled, no app chrome)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Client logo]  Nile Home Furniture — Monthly Report · September 2026        [Download PDF]    │
│ Prepared by Demo Agency · Period 1–30 Sep 2026 vs Aug 2026        DEMO (if demo data)         │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Executive summary                                                                             │
│  Wins: … · Challenges: … · Learnings: … · Next month: …                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌Spend──────┐┌Revenue────┐┌ROAS──────┐┌Leads─────┐┌CPL──────┐                                 │
│ │EGP 1.1M   ││EGP 4.6M   ││4.2x      ││3,100     ││EGP 355  │                                 │
│ └───────────┘└───────────┘└──────────┘└──────────┘└─────────┘                                 │
│ ┌ Performance over time ────────────────┐┌ By platform (bar) ───────────────┐                 │
│ └───────────────────────────────────────┘└──────────────────────────────────┘                 │
│ ┌ Plan vs actual ──────────────────────────────────────────────────────────┐                  │
│ ┌ Content published (top posts) ───────────────────────────────────────────┐                  │
│ ┌ Competitor highlights (Intensity = estimate) ────────────────────────────┐                  │
│ ┌ Action items (Tasks) ────────────────────────────────────────────────────┐                  │
│ Footer: data sources & last update per section · link expires 30 Oct 2026                     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Builder (desktop, condensed)

```
┌─ Reports ──────────────────────────────────────────────────────────────────────────────────┐
│ [+ New report ▾ Monthly client | Weekly | Executive | Campaign | Content | Competitor | …]   │
│ Title [..........]  Period [Sep 2026 ▾]  Compare [Prev ▾]                                   │
│ Sections  ☑ Summary ☑ KPIs ☑ Trend ☑ Platforms ☑ Plan vs actual ☐ Content ☐ Competitors    │
│ Schedule [Monthly, 1st, 09:00 ▾]  Recipients [client@…, +]                                  │
│ [Preview] [Save] [Share link]* [Send now]         * requires reports:share                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Mobile (shared report)

```
┌──────────────────────────────┐
│ [logo] Nile Home · Sep 2026  │
│ [PDF]                        │
├──────────────────────────────┤
│ Summary (collapsible)        │
│ Spend EGP 1.1M   ▲ 5%        │
│ ROAS 4.2x        ▲ 0.2       │
│ Leads 3,100      ▼ 3%        │
│ ┌ Trend ───────────────────┐ │
│ └──────────────────────────┘ │
│ ┌ Platforms ───────────────┐ │
│ └──────────────────────────┘ │
│ Sources · updated 1 Oct      │
└──────────────────────────────┘
```
