/**
 * First-boot bootstrap for hosted deployments (e.g. Render). Runs only when the database has no
 * organizations yet, so restarts never overwrite anything:
 *  - DEMO_MODE=true  → loads the clearly-labelled demo workspace.
 *  - otherwise, if ORG_NAME + ADMIN_EMAIL + ADMIN_PASSWORD are set → creates a clean organization
 *    and its first Super Admin (no sample data at all).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { execSync } from "node:child_process";

async function main() {
  const db = new PrismaClient();
  const orgs = await db.organization.count();
  if (orgs > 0) {
    console.log(`bootstrap: ${orgs} organization(s) present — nothing to do`);
    return db.$disconnect();
  }
  if (process.env.DEMO_MODE === "true") {
    await db.$disconnect();
    console.log("bootstrap: empty database, DEMO_MODE=true — loading demo workspace");
    execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
    return;
  }
  const { ORG_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ORG_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.log("bootstrap: empty database — set ORG_NAME, ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin (or run scripts/create-admin.ts)");
    return db.$disconnect();
  }
  if (ADMIN_PASSWORD.length < 10 || !/[a-z]/i.test(ADMIN_PASSWORD) || !/\d/.test(ADMIN_PASSWORD)) throw new Error("ADMIN_PASSWORD must be 10+ characters with letters and digits");
  const slug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
  await db.organization.create({
    data: {
      name: ORG_NAME,
      slug,
      currency: process.env.ORG_CURRENCY || "EGP",
      timezone: process.env.ORG_TIMEZONE || "Africa/Cairo",
      users: { create: { email: ADMIN_EMAIL.toLowerCase(), name: process.env.ADMIN_NAME || "Administrator", role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12) } },
    },
  });
  console.log(`bootstrap: created organization "${ORG_NAME}" and Super Admin ${ADMIN_EMAIL.toLowerCase()} (no demo data)`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
