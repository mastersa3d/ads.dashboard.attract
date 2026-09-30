/**
 * Create the first organization + SUPER_ADMIN on a fresh production database.
 *   npx tsx scripts/create-admin.ts --org "Acme Agency" --email admin@acme.com --name "Admin" [--currency EGP] [--timezone Africa/Cairo]
 * The password is read from ADMIN_PASSWORD (env) or prompted on stdin — never passed as an argument.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};

async function main() {
  const org = arg("org");
  const email = arg("email")?.toLowerCase();
  const name = arg("name", "Administrator")!;
  if (!org || !email) throw new Error('Usage: --org "Name" --email you@company.com [--name "Full name"]');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Password (min 10 chars, letters + digits): ");
    rl.close();
  }
  if (!password || password.length < 10 || !/[a-z]/i.test(password) || !/\d/.test(password)) throw new Error("Weak password");
  const db = new PrismaClient();
  const slug = org.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
  const created = await db.organization.create({
    data: {
      name: org,
      slug,
      currency: arg("currency", "EGP")!,
      timezone: arg("timezone", "Africa/Cairo")!,
      users: { create: { email, name, role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(password, 12) } },
    },
  });
  console.log(`Created organization ${created.name} and SUPER_ADMIN ${email}. Enable 2FA from Settings → Security.`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
