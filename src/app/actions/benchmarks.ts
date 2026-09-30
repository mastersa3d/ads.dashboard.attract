"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Objective, Platform } from "@prisma/client";
import { db } from "@/lib/db";
import { assertUser, AuthError } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { BENCHMARK_METRICS, METRIC_DEFS } from "@/components/benchmarks/model";

export type BenchmarkActionResult = { ok: true; id?: string } | { ok: false; error: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION"; fields?: string[] };

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const optNum = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, c) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) {
      c.addIssue({ code: "custom", message: "invalid" });
      return z.NEVER;
    }
    return n;
  });

/**
 * Values arrive in display units: percentages as "1.2" (= 1.2%), money in the organization's
 * currency. Percent metrics are stored as ratios.
 */
const benchmarkSchema = z
  .object({
    metric: z.enum(BENCHMARK_METRICS),
    platform: z.enum(Platform).nullish().transform((v) => v ?? null),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .nullish()
      .or(z.literal("").transform(() => null))
      .transform((v) => v ?? null),
    industry: optText(120),
    businessSize: optText(60),
    productType: optText(120),
    isB2B: z.boolean().nullish().transform((v) => v ?? null),
    objective: z.enum(Objective).nullish().transform((v) => v ?? null),
    audienceType: optText(120),
    p25: optNum,
    median: optNum.refine((v) => v != null, "required"),
    p75: optNum,
    higherIsBetter: z.boolean(),
    sourceName: z.string().trim().min(2).max(200),
    sourceUrl: z
      .url({ protocol: /^https?$/ })
      .max(500)
      .nullish()
      .or(z.literal("").transform(() => null))
      .transform((v) => v ?? null),
    sampleSize: optNum.refine((v) => v == null || Number.isInteger(v), "integer"),
    periodLabel: optText(80),
    asOf: z.iso.date(),
    isEstimate: z.boolean(),
  })
  .superRefine((v, c) => {
    if (v.p25 != null && v.median != null && v.p25 > v.median) c.addIssue({ code: "custom", path: ["p25"], message: "order" });
    if (v.p75 != null && v.median != null && v.p75 < v.median) c.addIssue({ code: "custom", path: ["p75"], message: "order" });
  });

function toData(input: z.infer<typeof benchmarkSchema>) {
  const pct = METRIC_DEFS[input.metric].unit === "pct";
  const scale = (n: number | null) => (n == null ? null : pct ? n / 100 : n);
  return {
    metric: input.metric,
    platform: input.platform,
    country: input.country,
    industry: input.industry,
    businessSize: input.businessSize,
    productType: input.productType,
    isB2B: input.isB2B,
    objective: input.objective,
    audienceType: input.audienceType,
    p25: scale(input.p25),
    median: scale(input.median)!,
    p75: scale(input.p75),
    higherIsBetter: input.higherIsBetter,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    sampleSize: input.sampleSize,
    periodLabel: input.periodLabel,
    asOf: new Date(input.asOf + "T00:00:00.000Z"),
    isEstimate: input.isEstimate,
  };
}

async function guard<T>(fn: () => Promise<T>): Promise<T | BenchmarkActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.code === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN" };
    if (e instanceof z.ZodError) return { ok: false, error: "VALIDATION", fields: [...new Set(e.issues.map((i) => String(i.path[0] ?? "")))] };
    throw e;
  }
}

/** Company (manual) benchmarks are organization-scoped: never global, never another org's. */
async function ownManual(organizationId: string, id: string) {
  const row = await db.benchmark.findFirst({ where: { id, organizationId, isManual: true } });
  if (!row) throw new AuthError("NOT_FOUND");
  return row;
}

export async function createBenchmark(input: unknown): Promise<BenchmarkActionResult> {
  return guard(async () => {
    const user = await assertUser("benchmarks:edit");
    const data = toData(benchmarkSchema.parse(input));
    const row = await db.benchmark.create({ data: { ...data, organizationId: user.organizationId, isManual: true } });
    await audit(user, { action: "create", entity: "Benchmark", entityId: row.id, summary: `${data.metric} ${data.platform ?? ""}`.trim(), diff: data });
    revalidatePath("/benchmarks");
    return { ok: true as const, id: row.id };
  });
}

export async function updateBenchmark(id: unknown, input: unknown): Promise<BenchmarkActionResult> {
  return guard(async () => {
    const user = await assertUser("benchmarks:edit");
    const bid = z.string().min(1).max(64).parse(id);
    const before = await ownManual(user.organizationId, bid);
    const data = toData(benchmarkSchema.parse(input));
    await db.benchmark.update({ where: { id: before.id }, data });
    await audit(user, { action: "update", entity: "Benchmark", entityId: before.id, summary: `${data.metric} ${data.platform ?? ""}`.trim(), diff: { before, after: data } });
    revalidatePath("/benchmarks");
    return { ok: true as const, id: before.id };
  });
}

export async function deleteBenchmark(id: unknown): Promise<BenchmarkActionResult> {
  return guard(async () => {
    const user = await assertUser("benchmarks:edit");
    const bid = z.string().min(1).max(64).parse(id);
    const before = await ownManual(user.organizationId, bid);
    await db.benchmark.delete({ where: { id: before.id } });
    await audit(user, { action: "delete", entity: "Benchmark", entityId: before.id, summary: `${before.metric} ${before.platform ?? ""}`.trim(), diff: before });
    revalidatePath("/benchmarks");
    return { ok: true as const };
  });
}
