import "server-only";
import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

/**
 * SMTP mailer (Hostinger email, SES, Mailgun… any SMTP). When SMTP_HOST is not set the
 * message is logged (without secrets) so development works without a mail server.
 */
export async function sendMail(to: string | string[], subject: string, html: string, attachments?: { filename: string; content: Buffer }[]) {
  if (!process.env.SMTP_HOST) {
    logger.info("mail.skipped (SMTP not configured)", { to, subject });
    return { skipped: true };
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, to, subject, html, attachments });
  return { skipped: false };
}

export function appUrl(path = "") {
  return (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "") + path;
}

export function emailLayout(title: string, body: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px"><h2 style="margin-top:0">${title}</h2>${body}</div></body></html>`;
}
