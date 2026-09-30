import { getI18n } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/format";
import { Callout } from "@/components/ui/primitives";

/** Last reviewed date of the placeholder text — update when the lawyer-approved version lands. */
const UPDATED = new Date("2026-09-30T00:00:00.000Z");

/** Renders help.legal.<doc>.* sections (1..count) — placeholder text pending legal review. */
export async function LegalDocument({ doc, count }: { doc: "privacy" | "terms"; count: number }) {
  const { t, locale } = await getI18n();
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t(`help.legal.${doc}Title`)}</h1>
        <p className="text-xs text-subtle">
          {t("help.legal.updated")}: <span className="num">{fmtDate(UPDATED, locale)}</span>
        </p>
        <Callout tone="warning">{t("help.legal.draft")}</Callout>
        <p className="leading-relaxed">{t(`help.legal.${doc}.intro`)}</p>
      </header>
      {Array.from({ length: count }, (_, i) => (
        <section key={i} className="space-y-1.5">
          <h2 className="text-lg font-semibold">
            <span className="num">{i + 1}.</span> {t(`help.legal.${doc}.${i + 1}.t`)}
          </h2>
          <p className="leading-relaxed text-muted">{t(`help.legal.${doc}.${i + 1}.b`)}</p>
        </section>
      ))}
      <p className="text-sm text-subtle">{t("help.legal.contact")}</p>
    </article>
  );
}
