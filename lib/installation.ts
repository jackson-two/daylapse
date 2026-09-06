import { z } from "zod";

const hostname = z.string().max(253).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
export const installationSettingsSchema = z.strictObject({
  familyHostname: hostname,
  displayHostname: z.union([hostname, z.literal("")]),
  accessTeamDomain: z.union([z.string().regex(/^[a-z0-9-]+\.cloudflareaccess\.com$/), z.literal("")]),
  accessAudience: z.string().max(256),
  timeZone: z.string().refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Use an IANA timezone"),
  notifications: z.boolean(),
  localDevelopment: z.boolean(),
}).refine((value) => !value.displayHostname || value.familyHostname !== value.displayHostname,
  "Family and display hostnames must differ");

export type InstallationSettings = z.infer<typeof installationSettingsSchema>;

export function isLocalRequest(request: Request, settings: InstallationSettings) {
  const url = new URL(request.url);
  return settings.localDevelopment && url.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function isDisplayRequest(request: Request, settings: InstallationSettings) {
  if (!settings.displayHostname) return false;
  return [new URL(request.url).hostname, request.headers.get("host"), request.headers.get("x-forwarded-host")]
    .filter(Boolean).flatMap((value) => value!.split(","))
    .some((value) => value.trim().split(":")[0].toLowerCase() === settings.displayHostname);
}

export function isFamilyRequest(request: Request, settings: InstallationSettings) {
  if (isDisplayRequest(request, settings)) return false;
  if (isLocalRequest(request, settings)) return true;
  const url = new URL(request.url);
  return !settings.localDevelopment && url.protocol === "https:" && url.hostname === settings.familyHostname;
}
