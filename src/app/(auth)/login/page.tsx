import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { loginAction } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { Callout } from "@/components/ui/primitives";

// The login page is the only app page that may be indexed.
export const metadata: Metadata = { title: "Sign in", robots: { index: true, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  if (await getCurrentUser()) redirect("/dashboard");
  const { t } = await getI18n();
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("auth.signInTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("auth.signInSubtitle")}</p>
      {process.env.DEMO_MODE === "true" && (
        <div className="mb-4">
          <Callout tone="demo" title={t("auth.demoTitle")}>
            <p>{t("auth.demoBody")}</p>
            <p className="num mt-1 text-xs" dir="ltr">
              admin@demo.local · manager@demo.local · team@demo.local · client@demo.local · viewer@demo.local — Demo@12345
            </p>
          </Callout>
        </div>
      )}
      <AuthForm
        action={loginAction}
        hidden={{ next: sp.next ?? "" }}
        notice={sp.reset ? t("auth.resetDone") : undefined}
        submit={t("auth.signIn")}
        fields={[
          { name: "email", label: t("auth.email"), type: "email", autoComplete: "username" },
          { name: "password", label: t("auth.password"), type: "password", autoComplete: "current-password" },
        ]}
      />
      <Link href="/forgot-password" className="mt-4 inline-block text-sm text-brand hover:underline">
        {t("auth.forgot")}
      </Link>
    </div>
  );
}
