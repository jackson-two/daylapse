import { readFileSync } from "node:fs";
import { parseConfigFileTextToJson } from "typescript";

// Use the application's production compatibility settings in local integration
// tests and rehearsals. An unsupported runtime must fail instead of falling back.
const { config, error } = parseConfigFileTextToJson("wrangler.jsonc",
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
if (error || typeof config?.compatibility_date !== "string"
  || !Array.isArray(config.compatibility_flags)
  || config.compatibility_flags.some((flag: unknown) => typeof flag !== "string")) {
  throw new Error("Invalid Worker compatibility settings in wrangler.jsonc");
}
export const runtimeCompatibility = {
  compatibilityDate: config.compatibility_date as string,
  compatibilityFlags: config.compatibility_flags as string[],
};
