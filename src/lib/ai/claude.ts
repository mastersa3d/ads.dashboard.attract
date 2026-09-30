import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * Thin wrapper around the Claude API used by the in-app AI assistant.
 *
 * Guard-rails (enforced here and by callers):
 *  - Claude only ever receives data the user can already see (tenant-scoped by the caller).
 *  - The system prompt forbids inventing numbers; outputs must cite the provided data sources
 *    and separate facts / estimates / recommendations with a confidence score.
 *  - Nothing returned is applied automatically — callers store results as PENDING
 *    AiRecommendation rows that a human must accept.
 *
 * Optional: when ANTHROPIC_API_KEY is not set, `aiEnabled()` is false and features fall back
 * to the deterministic rule-based engine in lib/ai/insights.ts.
 */
export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

export const GUARDRAILS = `You are the marketing analyst assistant inside a Marketing Intelligence platform used by an agency and its clients.
Rules you must always follow:
- Use ONLY the data provided in the <data> block. Never invent metrics, competitor spend, search volumes or sources.
- If the data is insufficient, say so plainly and state what data is missing.
- Label every point as FACT (directly from data), ESTIMATE (derived/projection — explain the method) or RECOMMENDATION.
- Give a confidence between 0 and 1 for each point and name the data source it relies on.
- Competitor ad spend is only a fact if an official source in the data states it; otherwise speak of "Estimated Advertising Intensity".
- Never claim you changed campaigns, budgets, plans or content — you only propose; a human approves.
- Do not copy competitor content verbatim; propose original adaptations.
- Answer in the requested language (Arabic uses clear Modern Standard Arabic unless asked otherwise).`;

export class AiError extends Error {
  constructor(public code: "DISABLED" | "REFUSED" | "RATE_LIMITED" | "FAILED", message?: string) {
    super(message ?? code);
  }
}

/** Structured JSON generation validated against a Zod schema. */
export async function generateStructured<T extends z.ZodType>(opts: {
  schema: T;
  task: string;
  data: unknown;
  locale: "ar" | "en";
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T>> {
  if (!aiEnabled()) throw new AiError("DISABLED");
  try {
    const response = await getClient().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: opts.effort ?? "medium", format: zodOutputFormat(opts.schema) },
      system: GUARDRAILS,
      messages: [
        {
          role: "user",
          content: `<data>\n${JSON.stringify(opts.data)}\n</data>\n\nLanguage: ${opts.locale === "ar" ? "Arabic" : "English"}\n\nTask: ${opts.task}`,
        },
      ],
    } as Parameters<Anthropic["beta"]["messages"]["parse"]>[0]);
    if (response.stop_reason === "refusal") throw new AiError("REFUSED");
    if (!response.parsed_output) throw new AiError("FAILED", "Empty structured output");
    return response.parsed_output as z.infer<T>;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new AiError("RATE_LIMITED");
    if (e instanceof Anthropic.APIError) {
      logger.error("ai.api_error", { status: e.status });
      throw new AiError("FAILED", `Claude API error ${e.status}`);
    }
    logger.error("ai.failed", { message: (e as Error).message });
    throw new AiError("FAILED");
  }
}
