import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { LocaleSwitch } from "@/components/auth/locale-switch";

/** Public, indexable layout for legal documents (no auth, no app shell). */
export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/login" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-fg">M</span>
            {process.env.NEXT_PUBLIC_APP_NAME ?? t("appName")}
          </Link>
          <LocaleSwitch />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="mx-auto flex max-w-3xl flex-wrap gap-4 px-4 pb-8 text-xs text-subtle">
        <Link href="/legal/privacy" className="hover:text-text">{t("help.legal.privacyTitle")}</Link>
        <Link href="/legal/terms" className="hover:text-text">{t("help.legal.termsTitle")}</Link>
        <Link href="/login" className="hover:text-text">{t("help.legal.backToSignIn")}</Link>
      </footer>
    </div>
  );
}
