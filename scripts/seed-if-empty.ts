/**
 * Loads the DEMO workspace only when the database has no organizations yet, so restarts of a
 * demo deployment (e.g. Render) never wipe what people changed. Guarded by DEMO_MODE=true —
 * it never runs on a production database by accident.
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

async function main() {
  if (process.env.DEMO_MODE !== "true") {
    console.log("seed-if-empty: DEMO_MODE is not true — skipping");
    return;
  }
  const db = new PrismaClient();
  const orgs = await db.organization.count();
  await db.$disconnect();
  if (orgs > 0) {
    console.log(`seed-if-empty: ${orgs} organization(s) present — skipping`);
    return;
  }
  console.log("seed-if-empty: empty database — loading demo workspace");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
