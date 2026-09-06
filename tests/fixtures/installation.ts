import type { InstallationSettings } from "../../lib/installation";

export const testInstallation: InstallationSettings = {
  familyHostname: "daylapse.example.com",
  displayHostname: "display.daylapse.example.com",
  accessTeamDomain: "test-team.cloudflareaccess.com",
  accessAudience: "a".repeat(64),
  timeZone: "UTC",
  notifications: false,
  localDevelopment: false,
};
