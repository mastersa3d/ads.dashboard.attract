import type { Role } from "@prisma/client";
import type { TFunction } from "@/lib/i18n/translate";
import { ROLES } from "@/lib/rbac";
import { Field, Input, Select } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { inviteUser } from "@/app/actions/users";

/** Invite by email (Users page and onboarding wizard). Only Super Admins may invite Super Admins. */
export function InviteForm({ t, clients, actorRole }: { t: TFunction; clients: { id: string; name: string }[]; actorRole: Role }) {
  const roles = ROLES.filter((r) => r !== "SUPER_ADMIN" || actorRole === "SUPER_ADMIN");
  return (
    <ActionForm action={inviteUser} submitLabel={t("users.sendInvite")} resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("users.email")} htmlFor="inv-email">
          <Input id="inv-email" name="email" type="email" required dir="ltr" autoComplete="off" placeholder="name@company.com" />
        </Field>
        <Field label={t("users.role")} htmlFor="inv-role" hint={t("users.roleHint")}>
          <Select id="inv-role" name="role" defaultValue="MARKETING_TEAM" options={roles.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
        </Field>
      </div>
      {clients.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">{t("users.clientAccess")}</legend>
          <p className="mb-2 text-[11px] text-subtle">{t("users.inviteClientsHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                <input type="checkbox" name="clientIds" value={c.id} className="size-4 accent-[var(--brand)]" />
                <span className="truncate">{c.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}
