import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ClientBasicsFields } from "@/components/clients/client-fields";
import { createClient } from "@/app/actions/clients";

export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const ctx = await pageContext(await searchParams, "clients:create");
  const { t, locale, user } = ctx;
  const managers = await db.user.findMany({
    where: { organizationId: user.organizationId, active: true, role: { in: ["SUPER_ADMIN", "COMPANY_MANAGER", "MARKETING_TEAM"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t("clients.new")} description={t("clients.newSubtitle")} />
      <Card>
        <CardHeader title={t("clients.essentials")} subtitle={t("clients.essentialsHint")} />
        <CardBody>
          <ActionForm action={createClient} submitLabel={t("clients.createBtn")}>
            <ClientBasicsFields t={t} locale={locale} managers={managers} d={{ currency: ctx.org.currency, timezone: ctx.org.timezone, accountManagerId: user.id }} />
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
