import { ConnectorError } from "./types";

/** Reads a required env var for a connector; throws NOT_CONFIGURED (without revealing anything) when absent. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new ConnectorError("NOT_CONFIGURED", `${name} is not configured on the server`);
  return v.trim();
}

export function hasEnv(name: string) {
  return Boolean(process.env[name]?.trim());
}

/** Readiness of a list of env vars — booleans only, values are never returned. */
export function envReadiness(names: string[]) {
  return names.map((name) => ({ name, set: hasEnv(name) }));
}

/** Server-level settings shown on the Data Sync tab (names only). */
export const CORE_ENV = ["DATABASE_URL", "ENCRYPTION_KEY", "APP_URL", "SMTP_HOST", "CRON_SECRET", "META_WEBHOOK_VERIFY_TOKEN"];
