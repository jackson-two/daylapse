/** D1 --file may emit upload progress before its JSON, even with --json. */
export function d1Json(output: string): { success: boolean; results: Record<string, unknown>[] }[] {
  for (const match of output.matchAll(/^\s*\[/gm)) {
    try {
      const value = JSON.parse(output.slice(match.index));
      if (Array.isArray(value) && value.every((row) => row.success === true && Array.isArray(row.results))) return value;
    } catch { /* Continue past non-JSON progress lines. Never echo private output. */ }
  }
  throw new Error("D1 did not return a successful JSON result. Inspect private logs before retrying a write.");
}
