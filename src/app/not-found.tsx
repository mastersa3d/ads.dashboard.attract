import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t, locale } = await getI18n();
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="num text-6xl font-bold text-brand">404</p>
        <p className="mt-2 text-muted">{locale === "ar" ? "الصفحة غير موجودة أو ليست لديك صلاحية للوصول إليها." : "This page doesn't exist or you don't have access to it."}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-brand hover:underline">
          {t("nav.dashboard")}
        </Link>
      </div>
    </div>
  );
}
