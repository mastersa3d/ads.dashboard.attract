import { ConnectorError } from "./types";

/**
 * JSON HTTP client for platform APIs:
 *  - per-attempt timeout (AbortController)
 *  - retry with exponential backoff + full jitter on network errors, 5xx and rate limits
 *  - honours `Retry-After` (seconds or HTTP date) on 429/503
 *  - provider hook to recognise throttling reported in a 200/400 body (e.g. Meta error codes 4/17/32/613)
 *  - errors carry only method + host + path — never query strings, which may hold secrets.
 */

export type HttpOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** Encoded as JSON unless it is a URLSearchParams (form-encoded). */
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Classify a provider error body. Return undefined to fall back to HTTP status rules. */
  classify?: (status: number, body: unknown) => ConnectorError | undefined;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter: random(0, min(max, base·2^attempt)). */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 30_000, random: () => number = Math.random) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(cap * (0.5 + random() / 2));
}

/** Parses `Retry-After` (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** "GET graph.facebook.com/v23.0/act_1/insights" — safe for logs and error messages. */
export function describe(method: string, url: string) {
  try {
    const u = new URL(url);
    return `${method} ${u.host}${u.pathname}`;
  } catch {
    return method;
  }
}

function defaultClassify(status: number, body: unknown, what: string): ConnectorError {
  const msg = extractMessage(body);
  if (status === 401) return new ConnectorError("AUTH", `${what}: unauthorized${msg ? ` — ${msg}` : ""}`, { status });
  if (status === 403) return new ConnectorError("PERMISSION", `${what}: forbidden${msg ? ` — ${msg}` : ""}`, { status });
  if (status === 429) return new ConnectorError("RATE_LIMIT", `${what}: rate limited`, { status });
  return new ConnectorError("API", `${what}: HTTP ${status}${msg ? ` — ${msg}` : ""}`, { status });
}

/** Best-effort extraction of a provider error message (Graph, Google, TikTok, LinkedIn, X shapes). */
export function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 300) : undefined;
  const b = body as Record<string, unknown>;
  const err = b.error as Record<string, unknown> | string | undefined;
  const raw =
    (typeof err === "object" && err ? (err.message as string) : undefined) ??
    (typeof err === "string" ? (b.error_description as string) ?? err : undefined) ??
    (b.message as string | undefined) ??
    (b.detail as string | undefined) ??
    (b.title as string | undefined);
  return raw ? String(raw).slice(0, 300) : undefined;
}

export async function requestJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const what = describe(method, url);

  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: string | undefined;
  if (opts.body instanceof URLSearchParams) {
    headers["Content-Type"] ??= "application/x-www-form-urlencoded";
    body = opts.body.toString();
  } else if (opts.body !== undefined) {
    headers["Content-Type"] ??= "application/json";
    body = JSON.stringify(opts.body);
  }

  let lastError: ConnectorError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === "AbortError";
      lastError = new ConnectorError("NETWORK", `${what}: ${aborted ? `timed out after ${timeoutMs}ms` : "network error"}`);
      if (attempt < retries) {
        await sleep(backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs, opts.random));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);

    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // non-JSON body (HTML error page) — keep text for the message
      }
    }

    const provider = opts.classify?.(res.status, parsed);
    if (res.ok && !provider) return (text ? parsed : {}) as T;

    const error = provider ?? defaultClassify(res.status, parsed, what);
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    if (retryAfter !== undefined) error.meta.retryAfterMs = retryAfter;
    lastError = error;

    const retryable = error.code === "RATE_LIMIT" || error.code === "NETWORK" || (error.code === "API" && (error.meta.status ?? 0) >= 500);
    if (!retryable || attempt >= retries) throw error;
    const wait = error.meta.retryAfterMs ?? backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs, opts.random);
    // Never sleep longer than the max delay inside a job; the queue will retry later instead.
    if (wait > (opts.maxDelayMs ?? 30_000) * 4) throw error;
    await sleep(wait);
  }
  throw lastError ?? new ConnectorError("API", `${what}: failed`);
}

/** Adds query params to a URL (skips undefined). */
export function withQuery(base: string, params: Record<string, string | number | undefined | null>) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}
