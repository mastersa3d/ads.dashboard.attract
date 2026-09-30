/**
 * TrendSignal.kind vocabulary. The schema stores it as free text; these are the kinds the
 * Trends & Opportunities Center understands (each maps to one section of the page).
 */
export const SIGNAL_KINDS = ["SEARCH", "RISING", "QUESTION", "TOPIC", "INTEREST", "SOCIAL", "HOOK", "FORMAT", "NEWS", "SEASONAL"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** A signal is valid until `expiresAt`; without one we assume 30 days from discovery. */
export const DEFAULT_VALIDITY_DAYS = 30;

export function signalValidUntil(s: { discoveredAt: Date; expiresAt: Date | null }) {
  return s.expiresAt ?? new Date(s.discoveredAt.getTime() + DEFAULT_VALIDITY_DAYS * 86_400_000);
}
