import { Check, Minus } from "lucide-react";
import type { TFunction } from "@/lib/i18n/translate";
import { PERMISSIONS, ROLES, effectivePermissions } from "@/lib/rbac";
import { cx } from "@/components/ui/primitives";

/** Permissions grouped by resource ("content:edit" → "content"). */
export function permissionGroups() {
  const groups = new Map<string, (typeof PERMISSIONS)[number][]>();
  for (const p of PERMISSIONS) {
    const r = p.split(":")[0];
    groups.set(r, [...(groups.get(r) ?? []), p]);
  }
  return [...groups.entries()];
}

/** Human label for a permission, falling back to the raw key. */
export function permLabel(t: TFunction, p: string) {
  const [res, act] = p.split(":");
  return `${t(`users.res.${res}`)} · ${t(`users.act.${act}`)}`;
}

/** Roles × permissions, computed from ROLE_PERMISSIONS through the same hard guards as runtime. */
export function PermissionMatrix({ t }: { t: TFunction }) {
  const sets = Object.fromEntries(ROLES.map((r) => [r, effectivePermissions(r)]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-xs text-muted">
            <th className="px-3 py-2 text-start font-medium">{t("users.permission")}</th>
            {ROLES.map((r) => (
              <th key={r} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                {t(`role.${r}`)}
              </th>
            ))}
          </tr>
        </thead>
        {permissionGroups().map(([res, perms]) => (
          <tbody key={res}>
            <tr className="bg-surface-2/60">
              <th colSpan={ROLES.length + 1} className="px-3 py-1.5 text-start text-xs font-semibold text-muted">
                {t(`users.res.${res}`)}
              </th>
            </tr>
            {perms.map((p) => (
              <tr key={p} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5">
                  <span>{t(`users.act.${p.split(":")[1]}`)}</span> <code className="ms-1 text-[10px] text-subtle" dir="ltr">{p}</code>
                </td>
                {ROLES.map((r) => {
                  const on = sets[r].has(p);
                  return (
                    <td key={r} className="px-2 py-1.5 text-center">
                      <span className={cx("inline-grid size-6 place-items-center rounded-full", on ? "bg-good-soft text-good" : "text-subtle")}>
                        {on ? <Check className="size-3.5" aria-label={t("ui.yes")} /> : <Minus className="size-3.5" aria-label={t("ui.no")} />}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
