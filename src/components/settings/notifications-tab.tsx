import { Trash2 } from "lucide-react";
import { Platform } from "@prisma/client";
import { db } from "@/lib/db";
import type { PageContext } from "@/lib/page";
import { fmtNumber } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, DataMeta, EmptyState, Field, Input, Select, SimpleTable } from "@/components/ui/primitives";
import { ActionForm } from "@/components/admin/action-form";
import { ActionButton } from "@/components/admin/action-button";
import { NOTIFICATION_TYPES, THRESHOLD_TYPES } from "@/components/admin/constants";
import { addNotificationOverride, deleteNotificationOverride, saveNotificationDefaults } from "@/app/actions/settings";

const check = "size-4 accent-[var(--brand)]";

/** Per-user alert preferences: defaults per type, plus client/platform-specific overrides. */
export async function NotificationsTab({ ctx }: { ctx: PageContext }) {
  const { t, locale, user } = ctx;
  const prefs = await db.notificationPreference.findMany({ where: { userId: user.id }, orderBy: { type: "asc" } });
  const defaults = new Map(prefs.filter((p) => !p.clientId).map((p) => [p.type, p]));
  const overrides = prefs.filter((p) => p.clientId && ctx.clients.some((c) => c.id === p.clientId));
  const clientName = new Map(ctx.clients.map((c) => [c.id, c.name]));
  const meta = <DataMeta source={t("settings.prefsSource")} labels={ctx.metaLabels} />;
  const typeLabel = (type: string) => t(`notifications.type.${type}`);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("settings.notifDefaults")} subtitle={t("settings.notifDefaultsHint")} meta={meta} />
        <ActionForm action={saveNotificationDefaults} className="space-y-4 pb-4 [&>div:last-child]:px-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-3 py-2 text-start font-medium">{t("settings.alertType")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("settings.inApp")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("settings.email")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("settings.threshold")}</th>
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_TYPES.map((type) => {
                  const p = defaults.get(type);
                  return (
                    <tr key={type} className="border-b border-border/60">
                      <td className="px-3 py-2">
                        <p className="font-medium">{typeLabel(type)}</p>
                        <p className="text-[11px] text-subtle">{t(`settings.typeHint.${type}`)}</p>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" name={`inApp:${type}`} defaultChecked={p?.inApp ?? true} className={check} aria-label={`${typeLabel(type)} — ${t("settings.inApp")}`} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" name={`email:${type}`} defaultChecked={p?.email ?? false} className={check} aria-label={`${typeLabel(type)} — ${t("settings.email")}`} />
                      </td>
                      <td className="px-3 py-2">
                        {THRESHOLD_TYPES.includes(type) ? (
                          <Input name={`threshold:${type}`} type="number" step="any" min="0" defaultValue={p?.threshold ?? ""} placeholder={t(`settings.thresholdPh.${type}`)} aria-label={t("settings.threshold")} className="num w-32" dir="ltr" />
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title={t("settings.notifOverrides")} subtitle={t("settings.notifOverridesHint")} meta={meta} />
        <SimpleTable
          head={[t("settings.alertType"), t("filter.client"), t("filter.platform"), t("settings.inApp"), t("settings.email"), t("settings.threshold"), ""]}
          empty={<EmptyState title={t("settings.noOverrides")} />}
          rows={overrides.map((o) => [
            typeLabel(o.type),
            clientName.get(o.clientId!) ?? "—",
            o.platform ? t(`platform.${o.platform}`) : t("ui.all"),
            <Badge key="i" tone={o.inApp ? "good" : "neutral"}>{o.inApp ? t("ui.yes") : t("ui.no")}</Badge>,
            <Badge key="e" tone={o.email ? "good" : "neutral"}>{o.email ? t("ui.yes") : t("ui.no")}</Badge>,
            <span key="t" className="num">{o.threshold == null ? "—" : fmtNumber(o.threshold, locale, 2)}</span>,
            <ActionButton key="d" action={deleteNotificationOverride.bind(null, o.id)} variant="ghost" title={t("ui.delete")}>
              <Trash2 className="size-4 text-bad" aria-hidden />
              <span className="sr-only">{t("ui.delete")}</span>
            </ActionButton>,
          ])}
        />
        {ctx.clients.length > 0 && (
          <CardBody className="border-t border-border">
            <ActionForm action={addNotificationOverride} submitLabel={t("settings.addOverride")} resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t("settings.alertType")} htmlFor="ov-type">
                  <Select id="ov-type" name="type" options={NOTIFICATION_TYPES.map((x) => ({ value: x, label: typeLabel(x) }))} />
                </Field>
                <Field label={t("filter.client")} htmlFor="ov-client">
                  <Select id="ov-client" name="clientId" options={ctx.clients.map((c) => ({ value: c.id, label: c.name }))} />
                </Field>
                <Field label={t("filter.platform")} htmlFor="ov-platform">
                  <Select id="ov-platform" name="platform" placeholder={t("ui.all")} options={Object.values(Platform).map((p) => ({ value: p, label: t(`platform.${p}`) }))} />
                </Field>
                <Field label={t("settings.threshold")} htmlFor="ov-th" hint={t("settings.thresholdHint")}>
                  <Input id="ov-th" name="threshold" type="number" step="any" min="0" dir="ltr" className="num" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="inApp" defaultChecked className={check} /> {t("settings.inApp")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="email" className={check} /> {t("settings.email")}
                </label>
              </div>
            </ActionForm>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
