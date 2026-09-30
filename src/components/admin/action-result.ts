/**
 * Result shape returned by every server action in the admin areas (clients, users, settings,
 * notifications, security). `ok` / `error` are i18n keys; `data` carries small serialisable
 * extras (e.g. an invitation link when SMTP is not configured). Client-safe: no server imports.
 */
export type ActionResult = { ok?: string; error?: string; data?: Record<string, string | null> } | undefined;

/** Signature expected by <ActionForm>: (previous result, submitted form) → result. */
export type FormAction = (prev: ActionResult, form: FormData) => Promise<ActionResult>;
