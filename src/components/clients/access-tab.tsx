import Link from "next/link";
import { UserMinus } from "lucide-react";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { fmtRelative, type Locale } from "@/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, EmptyState, SimpleTable } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ActionButton } from "@/components/admin/action-button";
import { grantClientAccess, revokeClientAccess } from "@/app/actions/clients";

/**
 * Who can see this client. Explicit rows come from ClientAccess; admins/managers see every
 * client, and Marketing Team members with no explicit rows see every client too (lib/tenant.ts).
 */
export async function AccessTab({ ctx, clientId, canManage }: { ctx: PageContext; clientId: string; canManage: boolean }) {
  const { t, locale, user } = ctx;
  const users = await db.user.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, clientAccess: { select: { clientId: true } } },
    orderBy: { name: "asc" },
  });
  const explicit = users.filter((u) => u.clientAccess.some((a) => a.clientId === clientId));
  const implicit = users.filter(
    (u) => !explicit.includes(u) && (u.role === "SUPER_ADMIN" || u.role === "COMPANY_MANAGER" || (u.role === "MARKETING_TEAM" && u.clientAccess.length === 0)),
  );
  const candidates = users.filter((u) => u.active && !explicit.includes(u) && u.role !== "SUPER_ADMIN" && u.role !== "COMPANY_MANAGER");
  const meta = <DataMeta source={t("clients.accessSource")} updated={ctx.rel(new Date())} labels={ctx.metaLabels} />;
  const who = (u: (typeof users)[number]) =>
    ctx.can("users:view") ? (
      <Link key="n" href={`/users/${u.id}`} className="font-medium text-brand hover:underline">
        {u.name}
      </Link>
    ) : (
      <span key="n" className="font-medium">{u.name}</span>
    );
  const status = (u: (typeof users)[number]) => <Badge key="s" tone={u.active ? "good" : "neutral"}>{u.active ? t("users.active") : t("users.inactive")}</Badge>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("clients.explicitAccess")} subtitle={t("clients.explicitAccessHint")} meta={meta} />
        <SimpleTable
          head={[t("ui.name"), t("users.email"), t("users.role"), t("ui.status"), t("users.lastLogin"), ...(canManage ? [t("ui.actions")] : [])]}
          empty={<EmptyState title={t("clients.noExplicitAccess")} />}
          rows={explicit.map((u) => [
            who(u),
            <span key="e" dir="ltr" className="text-xs text-muted">{u.email}</span>,
            <Badge key="r" tone={u.role === "CLIENT" ? "brand" : "neutral"}>{t(`role.${u.role}`)}</Badge>,
            status(u),
            <span key="l" className="text-xs text-muted">{u.lastLoginAt ? fmtRelative(u.lastLoginAt, locale as Locale) : "—"}</span>,
            ...(canManage
              ? [
                  <ActionButton key="a" action={revokeClientAccess.bind(null, clientId, u.id)} variant="ghost" confirm={t("clients.revokeAccessConfirm", { name: u.name })}>
                    <UserMinus className="size-4 text-bad" aria-hidden /> {t("clients.revoke")}
                  </ActionButton>,
                ]
              : []),
          ])}
        />
      </Card>

      <Card>
        <CardHeader title={t("clients.implicitAccess")} subtitle={t("clients.implicitAccessHint")} meta={meta} />
        <SimpleTable
          head={[t("ui.name"), t("users.email"), t("users.role"), t("ui.status")]}
          empty={<EmptyState title={t("ui.noData")} />}
          rows={implicit.map((u) => [who(u), <span key="e" dir="ltr" className="text-xs text-muted">{u.email}</span>, <Badge key="r">{t(`role.${u.role}`)}</Badge>, status(u)])}
        />
      </Card>

      {canManage && (
        <Card>
          <CardHeader title={t("clients.grantAccess")} />
          <CardBody className="space-y-3">
            <Callout tone="warning">{t("clients.grantAccessWarning")}</Callout>
            {candidates.length === 0 ? (
              <EmptyState title={t("clients.noCandidates")} />
            ) : (
              <ActionForm action={grantClientAccess.bind(null, clientId)} submitLabel={t("clients.grant")} resetOnSuccess>
                <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <legend className="sr-only">{t("clients.grantAccess")}</legend>
                  {candidates.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                      <input type="checkbox" name="userId" value={u.id} className="size-4 accent-[var(--brand)]" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{u.name}</span>
                        <span className="block truncate text-[11px] text-muted">{t(`role.${u.role}`)} · <span dir="ltr">{u.email}</span></span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
