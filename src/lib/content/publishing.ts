import type { Platform } from "@prisma/client";

/**
 * Publishing through official platform APIs. This app never auto-publishes: a user clicks
 * "Publish via API", which enqueues a `content.publish` Job (handled by the worker) that runs
 * at the post's publish time. The button only appears when a CONNECTED integration exists for
 * the post's platform. Pure — client-safe.
 */

export const PUBLISH_JOB_TYPE = "content.publish";

/** Integration platforms able to publish content for a given post platform. */
export function publishingIntegrationPlatforms(p: Platform): Platform[] {
  switch (p) {
    case "FACEBOOK":
    case "INSTAGRAM":
      return [p, "META"]; // Meta Graph API (Pages / Instagram Graph) via the Meta integration
    default:
      return [p];
  }
}

/** Key used to look up connected integrations: `${clientId}:${platform}`. */
export const integrationKey = (clientId: string, p: Platform) => `${clientId}:${p}`;

export function canPublishVia(connected: Set<string> | string[], clientId: string, p: Platform) {
  const set = Array.isArray(connected) ? new Set(connected) : connected;
  return publishingIntegrationPlatforms(p).some((ip) => set.has(integrationKey(clientId, ip)));
}
