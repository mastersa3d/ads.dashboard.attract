import bcrypt from "bcryptjs";
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "min10")
  .max(200)
  .regex(/[a-z]/i, "letter")
  .regex(/[0-9]/, "digit");

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

let dummy: string | undefined;

export function verifyPassword(pw: string, hash: string | null | undefined) {
  // compare against a dummy hash when the user doesn't exist to keep timing uniform
  dummy ??= bcrypt.hashSync("timing-equaliser", 12);
  return bcrypt.compare(pw, hash ?? dummy);
}
