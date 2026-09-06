import { z } from "zod";
import { installationSettingsSchema } from "../lib/installation";

const resourceName = z.string().min(1).max(63).regex(/^[a-z0-9][a-z0-9-]*$/);
const publicHostname = (value: string) => value.includes(".") && !/^(?:\d+\.)+\d+$/.test(value)
  && !/(^|\.)(localhost|local|test|invalid|example|example\.com|example\.net|example\.org)$/.test(value);

export const deploymentSchema = z.strictObject({
  workerName: resourceName,
  accountId: z.string().regex(/^[a-f0-9]{32}$/).refine((v) => !/^0+$/.test(v), "Replace the account ID"),
  databaseName: resourceName,
  databaseId: z.uuid().refine((v) => v !== "00000000-0000-0000-0000-000000000000", "Replace the database ID"),
  settings: installationSettingsSchema,
}).superRefine(({ settings }, ctx) => {
  const problem = (field: string, message: string) => ctx.addIssue({ code: "custom", path: ["settings", field], message });
  if (settings.localDevelopment) problem("localDevelopment", "Must be false for deployment");
  if (!publicHostname(settings.familyHostname)) problem("familyHostname", "Use your own public hostname");
  if (settings.displayHostname && !publicHostname(settings.displayHostname)) problem("displayHostname", "Use your own public hostname or leave empty");
  if (!settings.accessTeamDomain || settings.accessTeamDomain === "your-team.cloudflareaccess.com") problem("accessTeamDomain", "Set your Cloudflare Access team domain");
  if (!/^[a-f0-9]{64}$/.test(settings.accessAudience) || /^0+$/.test(settings.accessAudience)) problem("accessAudience", "Set the Access application AUD tag");
  if (settings.displayHostname.endsWith(".workers.dev")) problem("displayHostname", "Use a custom domain for the optional display");
});
export type Deployment = z.infer<typeof deploymentSchema>;

export function deploymentConfig(input: unknown, template: Record<string, unknown>) {
  const config = deploymentSchema.parse(input);
  const workersDev = config.settings.familyHostname.endsWith(".workers.dev");
  if (workersDev && !config.settings.familyHostname.startsWith(`${config.workerName}.`)) {
    throw new Error("The workers.dev hostname must belong to the configured Worker name");
  }
  return {
    ...template,
    name: config.workerName,
    account_id: config.accountId,
    workers_dev: workersDev,
    preview_urls: false,
    routes: [workersDev ? "" : config.settings.familyHostname, config.settings.displayHostname].filter(Boolean)
      .map((pattern) => ({ pattern, custom_domain: true })),
    vars: { DAYLAPSE: config.settings },
    secrets: { required: config.settings.notifications ? ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] : [] },
    triggers: { crons: config.settings.notifications ? ["*/5 * * * *"] : [] },
    d1_databases: [{ binding: "DB", database_name: config.databaseName, database_id: config.databaseId, migrations_dir: "drizzle" }],
  };
}

export function emptyInitializationSql(timeZone: string) {
  // Validation precedes escaping; no caller-supplied SQL is accepted.
  new Intl.DateTimeFormat("en", { timeZone });
  const zone = timeZone.replaceAll("'", "''");
  return `UPDATE installation_settings
SET import_state = 'ready', storage_mode = 'rows', default_time_zone = '${zone}'
WHERE id = 1 AND storage_mode = 'legacy' AND import_state = 'empty'
  AND NOT EXISTS (SELECT 1 FROM events)
  AND NOT EXISTS (SELECT 1 FROM completions)
  AND NOT EXISTS (SELECT 1 FROM changes)
  AND NOT EXISTS (SELECT 1 FROM mutations)
  AND NOT EXISTS (SELECT 1 FROM migration_runs)
  AND NOT EXISTS (SELECT 1 FROM household_state)
  AND NOT EXISTS (SELECT 1 FROM household_state_revisions);
SELECT storage_mode, import_state, default_time_zone FROM installation_settings WHERE id = 1;`;
}
