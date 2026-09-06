/** Works on display browsers that support AbortController but lack AbortSignal.timeout. */
export function createRequestTimeout(milliseconds = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
