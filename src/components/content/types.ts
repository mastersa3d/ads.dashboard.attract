import type { Role } from "@prisma/client";
import type { Permission } from "@/lib/rbac";

/** Serializable options the server passes to the content editor / boards. */
export type EditorOptions = {
  clients: { id: string; name: string; timezone: string; currency: string; isDemo: boolean; brands: { id: string; name: string }[] }[];
  users: { id: string; name: string }[];
  campaigns: string[];
  pillars: string[];
  audiences: string[];
  /** `${clientId}:${platform}` keys of CONNECTED integrations (lib/content/publishing.ts) */
  connected: string[];
  perms: Permission[];
  role: Role;
  conflictWindowMinutes: number;
  /** timezone the calendar is displayed in */
  timezone: string;
  platforms: string[];
};

export type CalendarView = "month" | "week" | "day" | "list" | "kanban" | "campaign" | "platform";
export const CALENDAR_VIEWS: CalendarView[] = ["month", "week", "day", "list", "kanban", "campaign", "platform"];
