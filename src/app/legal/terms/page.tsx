import type { Metadata } from "next";
import { LegalDocument } from "../legal-document";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of the Marketing Intelligence platform.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return <LegalDocument doc="terms" count={7} />;
}
