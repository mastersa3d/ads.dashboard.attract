import type { ContentStatus } from "@prisma/client";
import { Badge } from "@/components/ui/primitives";
import { statusTone } from "@/lib/content/workflow";

/** Workflow status pill. Server- and client-safe (pass the translated label). */
export function StatusBadge({ status, label, className }: { status: ContentStatus; label: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {label}
    </Badge>
  );
}

/** Solid dot colour per status (month grid on small screens, kanban headers). */
export const STATUS_DOT: Record<string, string> = {
  good: "bg-good",
  bad: "bg-bad",
  warning: "bg-warn",
  info: "bg-info",
  neutral: "bg-subtle",
  brand: "bg-brand",
  demo: "bg-demo",
};
