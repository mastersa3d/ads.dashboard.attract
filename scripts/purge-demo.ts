/**
 * Remove all demo data from the database (demo clients + their data, @demo.local users,
 * illustrative benchmarks, demo FX rates). Real data is untouched.
 *   npx tsx scripts/purge-demo.ts            # all organizations
 *   KEEP_USER_EMAIL=admin@demo.local npx tsx scripts/purge-demo.ts   # keep one demo login
 */
import { PrismaClient } from "@prisma/client";
import { purgeDemoData } from "../src/lib/demo-purge";

async function main() {
  const db = new PrismaClient();
  const keep = process.env.KEEP_USER_EMAIL ? await db.user.findUnique({ where: { email: process.env.KEEP_USER_EMAIL } }) : null;
  const result = await purgeDemoData(db, { keepUserId: keep?.id });
  // Remove organizations left with no users and no clients (e.g. the "Demo Agency").
  const empty = await db.organization.deleteMany({ where: { users: { none: {} }, clients: { none: {} } } });
  console.log("Demo data removed:", { ...result, emptyOrganizations: empty.count });
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
