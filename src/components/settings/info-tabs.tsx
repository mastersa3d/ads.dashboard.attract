import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Gauge, ScrollText } from "lucide-react";
import type { PageContext } from "@/lib/page";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { Callout, Card, CardBody, CardHeader, DataMeta, EmptyState, LinkButton, SimpleTable } from "@/components/ui/primitives";

export function LinkTab({ ctx, kind }: { ctx: PageContext; kind: "benchmarks" | "audit" }) {
  const { t } = ctx;
  const allowed = ctx.can(kind === "benchmarks" ? "benchmarks:view" : "audit:view");
  const Icon = kind === "benchmarks" ? Gauge : ScrollText;
  return (
    <Card>
      <CardHeader title={t(`settings.tab.${kind}`)} />
      <CardBody className="space-y-3">
        <p className="max-w-2xl text-sm text-muted">{t(`settings.${kind}Body`)}</p>
        {allowed ? (
          <LinkButton href={`/${kind}`} variant="primary">
            <Icon className="size-4" aria-hidden /> {t(`settings.open.${kind}`)}
          </LinkButton>
        ) : (
          <Callout tone="info">{t("ui.accessDenied")}</Callout>
        )}
      </CardBody>
    </Card>
  );
}

/** Lists BACKUP_DIR (read-only) and documents scripts/backup.sh. It never runs or restores anything. */
export async function BackupsTab({ ctx }: { ctx: PageContext }) {
  const { t, locale } = ctx;
  const dir = process.env.BACKUP_DIR;
  let files: { name: string; size: number; mtime: Date }[] | null = null;
  let error = false;
  if (dir) {
    try {
      const names = (await readdir(dir)).filter((n) => /\.(sql|dump|gz|tar|zip|bak)(\.gz)?$/i.test(n));
      files = (await Promise.all(names.map(async (name) => ({ name, ...(await stat(path.join(dir, name))) })))).map((f) => ({ name: f.name, size: f.size, mtime: f.mtime })).sort((a, b) => +b.mtime - +a.mtime).slice(0, 30);
    } catch {
      error = true;
    }
  }
  const latest = files?.[0];
  const stale = latest ? Date.now() - latest.mtime.getTime() > 36 * 3600_000 : false;
  const mb = (n: number) => `${fmtNumber(n / 1024 / 1024, locale, 1)} MB`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("settings.backupStatus")} meta={<DataMeta source={dir ? `BACKUP_DIR (${dir})` : "BACKUP_DIR"} updated={ctx.rel(latest?.mtime)} labels={ctx.metaLabels} />} />
        <CardBody className="space-y-3">
          {!dir && <Callout tone="warning" title={t("settings.backupNoDir")}>{t("settings.backupNoDirBody")}</Callout>}
          {error && <Callout tone="bad">{t("settings.backupReadError")}</Callout>}
          {latest && (stale ? <Callout tone="warning">{t("settings.backupStale")}</Callout> : <Callout tone="good">{t("settings.backupFresh")}</Callout>)}
        </CardBody>
        {files && (
          <SimpleTable
            head={[t("settings.backupFile"), t("settings.backupSize"), t("ui.date")]}
            empty={<EmptyState title={t("settings.backupNone")} />}
            rows={files.map((f) => [<code key="n" dir="ltr" className="text-xs">{f.name}</code>, <span key="s" className="num">{mb(f.size)}</span>, <span key="d" className="text-xs">{fmtDateTime(f.mtime, locale)}</span>])}
          />
        )}
      </Card>
      <Card>
        <CardHeader title={t("settings.backupHowTitle")} />
        <CardBody className="space-y-3 text-sm">
          <p>{t("settings.backupHow1")}</p>
          <pre dir="ltr" className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">{`# nightly at 02:30 (crontab -e on the VPS)
30 2 * * * BACKUP_DIR=/var/backups/mimd /path/to/app/scripts/backup.sh >> /var/log/mimd-backup.log 2>&1

# what the script does
pg_dump "$DATABASE_URL" --format=custom | gzip > "$BACKUP_DIR/db-$(date +%F).dump.gz"
find "$BACKUP_DIR" -name 'db-*.dump.gz' -mtime +14 -delete   # keep 14 days

# restore (on a fresh database)
gunzip -c db-YYYY-MM-DD.dump.gz | pg_restore --clean --no-owner -d "$DATABASE_URL"`}</pre>
          <p className="text-muted">{t("settings.backupHow2")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
