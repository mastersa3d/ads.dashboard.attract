import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { LocaleSwitch } from "@/components/auth/locale-switch";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col justify-between p-6 sm:p-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-brand font-bold text-brand-fg">M</div>
            <span className="font-semibold">{process.env.NEXT_PUBLIC_APP_NAME ?? t("appName")}</span>
          </div>
          <LocaleSwitch />
        </div>
        <div className="mx-auto w-full max-w-sm py-10">{children}</div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-subtle">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-4 text-good" /> {t("auth.secure")}
          </span>
          <Link href="/legal/privacy" className="hover:text-text">{t("auth.privacy")}</Link>
          <Link href="/legal/terms" className="hover:text-text">{t("auth.terms")}</Link>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-brand lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.15),transparent_40%)]" />
        <div className="absolute inset-x-12 bottom-16 space-y-3 text-white">
          <p className="text-3xl leading-tight font-bold">{t("appName")}</p>
          <p className="max-w-md text-white/80">{t("auth.signInSubtitle")}</p>
        </div>
      </div>
    </div>
  );
}
