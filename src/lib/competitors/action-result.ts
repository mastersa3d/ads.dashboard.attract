import "server-only";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

/**
 * Result shape shared by the competitor & trends server actions (used with useActionState).
 * `error` / `ok` are i18n keys; `vars` are interpolated by the client.
 */
export type ActionState = { ok?: string; error?: string; vars?: Record<string, string | number>; at?: number } | undefined;

/** Thrown inside an action to return a translated, user-facing error. */
export class UserError extends Error {
  constructor(public key: string, public vars?: Record<string, string | number>) {
    super(key);
  }
}

/** Wraps an action body: maps auth / validation / user errors to i18n keys, logs the rest. */
export async function runAction(name: string, fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    const r = await fn();
    return r ? { ...r, at: Date.now() } : r;
  } catch (e) {
    if (e instanceof UserError) return { error: e.key, vars: e.vars, at: Date.now() };
    if (e instanceof AuthError) return { error: e.code === "NOT_FOUND" ? "competitors.err.notFound" : "ui.accessDenied", at: Date.now() };
    if (e instanceof ZodError) {
      const field = e.issues[0]?.path.join(".") ?? "";
      return { error: "competitors.err.validation", vars: { field }, at: Date.now() };
    }
    logger.error(`action.${name}`, { message: (e as Error)?.message });
    return { error: "ui.error", at: Date.now() };
  }
}

/** Newline/comma separated textarea → trimmed, de-duplicated list. */
export function splitList(v: unknown, max = 20, sep: RegExp = /\r?\n/): string[] {
  if (typeof v !== "string") return [];
  return [...new Set(v.split(sep).map((s) => s.trim()).filter(Boolean))].slice(0, max).map((s) => s.slice(0, 300));
}

/** FormData → plain object; repeated keys (checkbox groups) become arrays. */
export function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}
