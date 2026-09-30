import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./action-result";

/** A user-facing failure with an i18n key (e.g. "users.errLastAdmin"). */
export class ActionError extends Error {
  constructor(public key: string) {
    super(key);
  }
}

/**
 * Runs a server-action body and converts failures into an ActionResult instead of an
 * unhandled 500: auth → "ui.accessDenied", Zod → "settings.errInvalid", ActionError → its key.
 * Next.js redirects / notFound are re-thrown untouched.
 */
export async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ActionError) return { error: e.key };
    if (e instanceof AuthError) return { error: e.code === "NOT_FOUND" ? "settings.errNotFound" : "ui.accessDenied" };
    if (e instanceof ZodError) {
      const field = e.issues[0]?.path.join(".");
      return { error: "settings.errInvalid", data: field ? { field } : undefined };
    }
    logger.error("action.error", { message: (e as Error)?.message });
    return { error: "ui.error" };
  }
}

/** FormData → plain object of trimmed strings (multi-value keys keep the last value). */
export function formFields(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v.trim();
  return out;
}

/** All non-empty values for a repeated field (checkbox groups, repeated inputs). */
export function formList(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

/** "a, b\nc" → ["a", "b", "c"] — used for textarea list fields (branches, products…). */
export function splitList(v: string | undefined | null, max = 100): string[] {
  if (!v) return [];
  return [...new Set(v.split(/[\n,،]/).map((s) => s.trim()).filter(Boolean))].slice(0, max);
}

/** Empty string → null, for optional text columns. */
export function orNull(v: string | undefined | null): string | null {
  return v && v.trim() ? v.trim() : null;
}

/** Only allow internal redirect targets from forms. */
export function safePath(v: string | undefined | null): string | null {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
}
