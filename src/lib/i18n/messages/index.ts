import common from "./common";
import auth from "./auth";
import dashboard from "./dashboard";
import clients from "./clients";
import strategy from "./strategy";
import analytics from "./analytics";
import budget from "./budget";
import content from "./content";
import competitors from "./competitors";
import trends from "./trends";
import benchmarks from "./benchmarks";
import reports from "./reports";
import tasks from "./tasks";
import notifications from "./notifications";
import users from "./users";
import settings from "./settings";
import audit from "./audit";
import help from "./help";
import onboarding from "./onboarding";
import integrations from "./integrations";
import type { Locale } from "@/lib/format";

const namespaces = {
  auth,
  dashboard,
  clients,
  strategy,
  analytics,
  budget,
  content,
  competitors,
  trends,
  benchmarks,
  reports,
  tasks,
  notifications,
  users,
  settings,
  audit,
  help,
  onboarding,
  integrations,
};

export type Messages = Record<string, string>;

function build(locale: Locale): Messages {
  const out: Messages = { ...common[locale] };
  for (const [ns, dict] of Object.entries(namespaces)) {
    for (const [k, v] of Object.entries(dict[locale])) out[`${ns}.${k}`] = v;
  }
  return out;
}

export const MESSAGES: Record<Locale, Messages> = { en: build("en"), ar: build("ar") };
