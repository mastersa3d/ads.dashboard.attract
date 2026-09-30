import type { Platform } from "@prisma/client";
import type { Connector } from "./types";
import { facebookPages, instagram, metaAds } from "./providers/meta";
import { ga4, googleAds, googleCalendar, googleDrive, searchConsole, youtube } from "./providers/google";
import { tiktok } from "./providers/tiktok";
import { linkedinAds, linkedinPages } from "./providers/linkedin";
import { xConnector } from "./providers/x";
import { email, googleTrends, oneDrive, outlookCalendar } from "./providers/other";

/** Every supported connector, in the order shown in Settings → Integrations. */
export const CONNECTORS: Connector[] = [
  metaAds,
  facebookPages,
  instagram,
  googleAds,
  ga4,
  searchConsole,
  youtube,
  tiktok,
  linkedinAds,
  linkedinPages,
  xConnector,
  googleTrends,
  email,
  googleCalendar,
  outlookCalendar,
  googleDrive,
  oneDrive,
];

/** Default connector per platform (platforms with several providers pick via Integration.syncCursor.connector). */
const DEFAULT_FOR: Record<Platform, string> = {
  META: "meta",
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  GOOGLE_ADS: "google-ads",
  GA4: "ga4",
  SEARCH_CONSOLE: "search-console",
  YOUTUBE: "youtube",
  TIKTOK: "tiktok",
  LINKEDIN: "linkedin",
  X: "x",
  GOOGLE_TRENDS: "google-trends",
  EMAIL: "email",
  CALENDAR: "google-calendar",
  CLOUD_STORAGE: "google-drive",
};

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export function connectorFor(platform: Platform, variant?: string | null): Connector {
  const byVariant = variant ? getConnector(variant) : undefined;
  if (byVariant && byVariant.platform === platform) return byVariant;
  return getConnector(DEFAULT_FOR[platform])!;
}

/** Whether all env vars needed by the connector's OAuth app are set (booleans only). */
export function isConfigured(c: Connector) {
  if (c.id === "email") return Boolean(process.env.SMTP_HOST?.trim());
  return c.envVars.every((v) => Boolean(process.env[v]?.trim()));
}
