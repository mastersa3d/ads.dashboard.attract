import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, IBM_Plex_Sans_Arabic } from "next/font/google";
import { getLocale } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n/translate";
import { I18nProvider } from "@/lib/i18n/client";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: process.env.NEXT_PUBLIC_APP_NAME ?? "Marketing Intelligence", template: "%s · " + (process.env.NEXT_PUBLIC_APP_NAME ?? "Marketing Intelligence") },
  description: "Marketing intelligence & management platform for agencies and brands.",
  // Private by default. Only public pages (login, legal) opt back in.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${inter.variable} ${arabic.variable} ${theme === "dark" ? "dark" : ""}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
