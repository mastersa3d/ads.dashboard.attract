import { notFound } from "next/navigation";
import { ArrowLeft, LogOut, Power, ShieldCheck, ShieldOff } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/page";
import type { RawParams } from "@/lib/filters";
import { ROLES, ROLE_PERMISSIONS, effectivePermissions, type Permission } from "@/lib/rbac";
import { fmtDateTime, fmtRelative, type Locale } from "@/lib/format";
import { Badge, Callout, Card, CardBody, CardHeader, DataMeta, EmptyState, Field, LinkButton, PageHeader, Select, SimpleTable, cx } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ActionButton } from "@/components/admin/action-button";
import { permissionGroups } from "@/components/users/permission-matrix";
import { describeAgent } from "@/components/users/user-agent";
import { changeUserRole, revokeAllUserSessions, revokeUserSession, setUserActive, setUserClients, updateUserPermissions } from "@/app/actions/users";

export const metadata = { title: "User" };

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await pageContext(sp, "users:view");
  const { t, locale, user: me } = ctx;
  const now = new Date();

  // Tenant check: only users of the caller's organization.
  const u = await db.user.findFirst({
    where: { id, organizationId: me.organizationId },
    include: {
      clientAccess: { select: { clientId: true } },
      sessions: { where: { expiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" } },
      managedClients: { select: { id: true, name: true } },
    },
  });
  if (!u) notFound();

  const [clients, adminCount] = await Promise.all([
    db.client.findMany({ where: { organizationId: me.organizationId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.count({ where: { organizationId: me.organizationId, role: "SUPER_ADMIN", active: true } }),
  ]);
  const isSelf = u.id === me.id;
  const isLastAdmin = u.role === "SUPER_ADMIN" && u.active && adminCount <= 1;
  const superOnly = u.role === "SUPER_ADMIN" && me.role !== "SUPER_ADMIN";
  const canManage = ctx.can("users:manage") && !superOnly;
  const lockedReason = isSelf ? t("users.errSelf") : isLastAdmin ? t("users.errLastAdmin") : superOnly ? t("users.errSuperAdminOnly") : null;
  const roleDefaults = new Set<Permission>(ROLE_PERMISSIONS[u.role]);
  const effective = effectivePermissions(u.role, u.permissions);
  const override = (p: Permission) => (u.permissions.includes(p) ? "grant" : u.permissions.includes(`-${p}`) ? "revoke" : "default");
  const assigned = new Set(u.clientAccess.map((a) => a.clientId));
  const rel = (d: Date | null) => (d ? fmtRelative(d, locale as Locale) : "—");
  const meta = <DataMeta source={t("users.source")} updated={ctx.rel(u.updatedAt)} labels={ctx.metaLabels} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={u.name}
        description={<span dir="ltr">{u.email}</span>}
        badges={
          <>
            <Badge tone={u.role === "SUPER_ADMIN" ? "brand" : "neutral"}>{t(`role.${u.role}`)}</Badge>
            <Badge tone={u.active ? "good" : "neutral"}>{u.active ? t("users.active") : t("users.inactive")}</Badge>
            {isSelf && <Badge>{t("users.you")}</Badge>}
          </>
        }
        actions={
          <LinkButton href="/users" size="sm">
            <ArrowLeft className="size-3.5 flip-rtl" aria-hidden /> {t("ui.back")}
          </LinkButton>
        }
      />
      {!ctx.can("users:manage") && <Callout tone="info">{t("users.readOnly")}</Callout>}
      {ctx.can("users:manage") && lockedReason && <Callout tone="warning">{lockedReason}</Callout>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("users.account")} meta={meta} />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {[
                [t("users.lastLogin"), rel(u.lastLoginAt)],
                [t("users.createdAt"), fmtDateTime(u.createdAt, locale)],
                [
                  t("users.twoFactor"),
                  u.totpEnabled ? (
                    <Badge tone="good"><ShieldCheck className="size-3" aria-hidden /> {t("users.on")}</Badge>
                  ) : (
                    <Badge tone="warning"><ShieldOff className="size-3" aria-hidden /> {t("users.off")}</Badge>
                  ),
                ],
                [t("users.language"), u.locale === "ar" ? "العربية" : "English"],
                [t("users.lockedUntil"), u.lockedUntil && u.lockedUntil > now ? fmtDateTime(u.lockedUntil, locale) : "—"],
                [t("users.managerOf"), u.managedClients.map((c) => c.name).join("، ") || "—"],
              ].map(([k, v], i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-end">{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("users.role")} subtitle={t("users.roleHint")} />
          <CardBody>
            <ActionForm action={changeUserRole.bind(null, u.id)} disabled={!canManage || isSelf || isLastAdmin}>
              <Field label={t("users.role")} htmlFor="u-role">
                <Select id="u-role" name="role" defaultValue={u.role} options={ROLES.filter((r) => r !== "SUPER_ADMIN" || me.role === "SUPER_ADMIN" || u.role === "SUPER_ADMIN").map((r) => ({ value: r, label: t(`role.${r}`) }))} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("users.status")} subtitle={t("users.statusHint")} />
          <CardBody className="space-y-3">
            <p className="text-sm">{u.active ? t("users.activeBody") : t("users.inactiveBody")}</p>
            {canManage && !isSelf && (u.active ? !isLastAdmin : true) && (
              <ActionButton
                action={setUserActive.bind(null, u.id, !u.active)}
                variant={u.active ? "danger" : "success"}
                confirm={u.active ? t("users.deactivateConfirm", { name: u.name }) : undefined}
              >
                <Power className="size-3.5" aria-hidden /> {u.active ? t("users.deactivate") : t("users.activate")}
              </ActionButton>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("users.clientAccess")} subtitle={u.role === "SUPER_ADMIN" || u.role === "COMPANY_MANAGER" ? t("users.clientAccessAll") : t("users.clientAccessHint")} />
        <CardBody>
          {clients.length === 0 ? (
            <EmptyState title={t("users.noClientsOrg")} />
          ) : (
            <ActionForm action={setUserClients.bind(null, u.id)} disabled={!canManage}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                    <input type="checkbox" name="clientIds" value={c.id} defaultChecked={assigned.has(c.id)} className="size-4 accent-[var(--brand)]" />
                    <span className="truncate">{c.name}</span>
                  </label>
                ))}
              </div>
            </ActionForm>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("users.overrides")} subtitle={t("users.overridesHint")} />
        <ActionForm action={updateUserPermissions.bind(null, u.id)} disabled={!canManage || isSelf} className="space-y-4 pb-4 [&>div:last-child]:px-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-3 py-2 text-start font-medium">{t("users.permission")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("users.roleDefault")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("users.override")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("users.effective")}</th>
                </tr>
              </thead>
              {permissionGroups().map(([res, perms]) => (
                <tbody key={res}>
                  <tr className="bg-surface-2/60">
                    <th colSpan={4} className="px-3 py-1.5 text-start text-xs font-semibold text-muted">
                      {t(`users.res.${res}`)}
                    </th>
                  </tr>
                  {perms.map((p) => {
                    const o = override(p);
                    return (
                      <tr key={p} className={cx("border-b border-border/60", o !== "default" && "bg-warn-soft/40")}>
                        <td className="px-3 py-1.5">
                          {t(`users.act.${p.split(":")[1]}`)} <code className="ms-1 text-[10px] text-subtle" dir="ltr">{p}</code>
                        </td>
                        <td className="px-3 py-1.5 text-center">{roleDefaults.has(p) ? <Badge tone="good">{t("ui.yes")}</Badge> : <Badge>{t("ui.no")}</Badge>}</td>
                        <td className="px-3 py-1.5">
                          <fieldset className="flex flex-wrap gap-3 text-xs" aria-label={p}>
                            {(["default", "grant", "revoke"] as const).map((v) => (
                              <label key={v} className="inline-flex items-center gap-1">
                                <input type="radio" name={`perm:${p}`} value={v} defaultChecked={o === v} disabled={(v === "grant" && roleDefaults.has(p)) || (v === "revoke" && !roleDefaults.has(p))} className="accent-[var(--brand)]" />
                                {t(`users.ov.${v}`)}
                              </label>
                            ))}
                          </fieldset>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={cx("font-semibold", effective.has(p) ? "text-good" : "text-subtle")}>{effective.has(p) ? "✓" : "—"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
          <p className="px-4 text-[11px] text-subtle">{t("users.hardGuards")}</p>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader
          title={t("users.activeSessions")}
          subtitle={t("users.activeSessionsHint")}
          meta={<DataMeta source={t("users.sessionSource")} updated={ctx.rel(u.sessions[0]?.lastSeenAt)} labels={ctx.metaLabels} />}
          actions={
            canManage && !isSelf && u.sessions.length > 0 ? (
              <ActionButton action={revokeAllUserSessions.bind(null, u.id)} variant="danger" confirm={t("users.revokeAllConfirm", { name: u.name })}>
                <LogOut className="size-3.5 flip-rtl" aria-hidden /> {t("users.revokeAll")}
              </ActionButton>
            ) : undefined
          }
        />
        <SimpleTable
          head={[t("users.device"), t("users.ip"), t("users.started"), t("users.lastSeen"), t("users.twoFactor"), ...(canManage ? [""] : [])]}
          empty={<EmptyState title={t("users.noSessions")} />}
          rows={u.sessions.map((s) => [
            <span key="d" className="text-xs">
              {describeAgent(s.userAgent)}
              {s.id === me.sessionId && <Badge tone="info" className="ms-1">{t("users.thisDevice")}</Badge>}
            </span>,
            <span key="i" className="num text-xs" dir="ltr">{s.ip ?? "—"}</span>,
            <span key="c" className="text-xs">{fmtDateTime(s.createdAt, locale)}</span>,
            <span key="l" className="text-xs">{rel(s.lastSeenAt)}</span>,
            s.twoFactorOk ? <Badge key="t" tone="good">{t("users.verified")}</Badge> : <Badge key="t">—</Badge>,
            ...(canManage
              ? [
                  s.id === me.sessionId ? (
                    <span key="a" />
                  ) : (
                    <ActionButton key="a" action={revokeUserSession.bind(null, s.id)} variant="ghost">
                      <LogOut className="size-3.5 text-bad flip-rtl" aria-hidden /> {t("users.revoke")}
                    </ActionButton>
                  ),
                ]
              : []),
          ])}
        />
      </Card>
    </div>
  );
}
