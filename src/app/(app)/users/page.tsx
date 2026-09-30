import Link from "next/link";
import { ShieldCheck, ShieldOff, RotateCw, X } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { fmtDate, fmtRelative, type Locale } from "@/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, EmptyState, PageHeader, Tabs } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/data-table";
import { ActionButton } from "@/components/admin/action-button";
import { InviteForm } from "@/components/users/invite-form";
import { PermissionMatrix } from "@/components/users/permission-matrix";
import { resendInvitation, revokeInvitation } from "@/app/actions/users";

export const metadata = { title: "Users & Permissions" };

const TABS = ["users", "invitations", "matrix"] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp, "users:view");
  const { t, locale, user } = ctx;
  const canManage = ctx.can("users:manage");
  const tab = TABS.includes(sp.tab as (typeof TABS)[number]) ? (sp.tab as (typeof TABS)[number]) : "users";
  const now = new Date();

  const [users, invitations, orgClients] = await Promise.all([
    db.user.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        lastLoginAt: true,
        totpEnabled: true,
        permissions: true,
        updatedAt: true,
        clientAccess: { select: { client: { select: { name: true } } } },
        _count: { select: { sessions: { where: { expiresAt: { gt: now } } } } },
      },
    }),
    db.invitation.findMany({ where: { organizationId: user.organizationId, acceptedAt: null }, orderBy: { createdAt: "desc" } }),
    db.client.findMany({ where: { organizationId: user.organizationId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const clientName = new Map(orgClients.map((c) => [c.id, c.name]));
  const inviterName = new Map(users.map((u) => [u.id, u.name]));
  const rel = (d: Date | null) => (d ? fmtRelative(d, locale as Locale) : null);
  const access = (u: (typeof users)[number]) => {
    if (u.role === "SUPER_ADMIN" || u.role === "COMPANY_MANAGER" || (u.role === "MARKETING_TEAM" && !u.clientAccess.length)) return t("users.allClients");
    return u.clientAccess.map((a) => a.client.name).join("، ") || t("users.noClients");
  };
  const updated = users.reduce<Date | null>((m, u) => (!m || u.updatedAt > m ? u.updatedAt : m), null);
  const meta = <DataMeta source={t("users.source")} updated={ctx.rel(updated)} labels={ctx.metaLabels} />;
  const pending = invitations.filter((i) => i.expiresAt > now).length;

  return (
    <div className="space-y-5">
      <PageHeader title={t("users.title")} description={t("users.subtitle")} />
      <Tabs
        active={tab}
        tabs={[
          { key: "users", label: `${t("users.tab.users")} (${users.length})`, href: "/users" },
          { key: "invitations", label: `${t("users.tab.invitations")} (${pending})`, href: "/users?tab=invitations" },
          { key: "matrix", label: t("users.tab.matrix"), href: "/users?tab=matrix" },
        ]}
      />

      {tab === "users" && (
        <Card>
          <CardHeader title={t("users.tab.users")} subtitle={canManage ? t("users.listHintManage") : t("users.listHint")} meta={meta} />
          <DataTable
            exportName="users"
            columns={[
              { key: "name", label: t("ui.name") },
              { key: "role", label: t("users.role") },
              { key: "status", label: t("ui.status") },
              { key: "lastLogin", label: t("users.lastLogin"), hideOnMobile: true },
              { key: "twofa", label: t("users.twoFactor"), hideOnMobile: true },
              { key: "clients", label: t("users.clientAccess"), hideOnMobile: true },
              { key: "sessions", label: t("users.sessions"), type: "number", hideOnMobile: true },
            ]}
            rows={users.map((u) => ({
              _id: u.id,
              name: {
                v: `${u.name} ${u.email}`,
                d: (
                  <div className="min-w-0">
                    <Link href={`/users/${u.id}`} className="font-medium text-brand hover:underline">
                      {u.name}
                    </Link>
                    {u.id === user.id && <Badge className="ms-1">{t("users.you")}</Badge>}
                    <p className="text-xs text-muted" dir="ltr">
                      {u.email}
                    </p>
                  </div>
                ),
              },
              role: {
                v: t(`role.${u.role}`),
                d: (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Badge tone={u.role === "SUPER_ADMIN" ? "brand" : "neutral"}>{t(`role.${u.role}`)}</Badge>
                    {u.permissions.length > 0 && <Badge tone="warning" title={u.permissions.join(", ")}>{t("users.customPerms", { n: u.permissions.length })}</Badge>}
                  </span>
                ),
              },
              status: { v: u.active ? 1 : 0, d: <Badge tone={u.active ? "good" : "neutral"}>{u.active ? t("users.active") : t("users.inactive")}</Badge> },
              lastLogin: { v: u.lastLoginAt?.toISOString() ?? "", d: <span className="text-xs text-muted">{rel(u.lastLoginAt) ?? t("users.never")}</span> },
              twofa: {
                v: u.totpEnabled ? 1 : 0,
                d: u.totpEnabled ? (
                  <Badge tone="good"><ShieldCheck className="size-3" aria-hidden /> {t("users.on")}</Badge>
                ) : (
                  <Badge tone="warning"><ShieldOff className="size-3" aria-hidden /> {t("users.off")}</Badge>
                ),
              },
              clients: { v: access(u), d: <span className="block max-w-56 truncate text-xs">{access(u)}</span> },
              sessions: u._count.sessions,
            }))}
          />
        </Card>
      )}

      {tab === "invitations" && (
        <div className="space-y-4">
          {canManage ? (
            <Card>
              <CardHeader title={t("users.inviteTitle")} subtitle={t("users.inviteHint")} />
              <CardBody>
                <InviteForm t={t} clients={orgClients} actorRole={user.role} />
              </CardBody>
            </Card>
          ) : (
            <Callout tone="info">{t("users.readOnly")}</Callout>
          )}
          <Card>
            <CardHeader title={t("users.pendingInvitations")} meta={<DataMeta source={t("users.source")} updated={ctx.rel(invitations[0]?.createdAt)} labels={ctx.metaLabels} />} />
            {invitations.length === 0 ? (
              <EmptyState title={t("users.noInvitations")} />
            ) : (
              <ul className="divide-y divide-border">
                {invitations.map((i) => {
                  const expired = i.expiresAt < now;
                  return (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" dir="ltr">
                          {i.email}
                        </p>
                        <p className="text-xs text-muted">
                          {t(`role.${i.role}`)}
                          {i.clientIds.length > 0 && <> · {i.clientIds.map((c) => clientName.get(c) ?? "—").join("، ")}</>} · {t("users.invitedBy", { name: (i.invitedById && inviterName.get(i.invitedById)) || "—" })} ·{" "}
                          {fmtDate(i.createdAt, locale)}
                        </p>
                      </div>
                      <Badge tone={expired ? "bad" : "info"}>{expired ? t("users.expired") : t("users.expiresIn", { when: rel(i.expiresAt) ?? "" })}</Badge>
                      {canManage && (
                        <div className="flex items-center gap-1">
                          <ActionButton action={resendInvitation.bind(null, i.id)} title={t("users.resendHint")}>
                            <RotateCw className="size-3.5" aria-hidden /> {t("users.resend")}
                          </ActionButton>
                          <ActionButton action={revokeInvitation.bind(null, i.id)} variant="ghost" confirm={t("users.revokeInviteConfirm", { email: i.email })}>
                            <X className="size-3.5 text-bad" aria-hidden /> {t("users.revokeInvite")}
                          </ActionButton>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "matrix" && (
        <Card>
          <CardHeader title={t("users.tab.matrix")} subtitle={t("users.matrixHint")} meta={<DataMeta source={t("users.matrixSource")} labels={ctx.metaLabels} />} />
          <PermissionMatrix t={t} />
        </Card>
      )}
    </div>
  );
}
