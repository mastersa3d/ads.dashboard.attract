import { authenticator } from "otplib";
import QRCode from "qrcode";

authenticator.options = { window: 1 };

export function newTotpSecret() {
  return authenticator.generateSecret();
}

export function verifyTotp(code: string, secret: string) {
  return authenticator.verify({ token: code.replace(/\s/g, ""), secret });
}

export async function totpQr(email: string, secret: string) {
  const issuer = process.env.NEXT_PUBLIC_APP_NAME ?? "Marketing Intelligence";
  return QRCode.toDataURL(authenticator.keyuri(email, issuer, secret));
}
