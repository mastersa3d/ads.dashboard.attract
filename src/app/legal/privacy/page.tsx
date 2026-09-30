import type { Metadata } from "next";
import { LegalDocument } from "../legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How the Marketing Intelligence platform processes personal and marketing data.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return <LegalDocument doc="privacy" count={7} />;
}
