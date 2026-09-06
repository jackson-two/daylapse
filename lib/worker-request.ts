import { accessResponse } from "./access-policy";

/** Worker-first routing must serve assets explicitly, after authentication. */
export async function serveAuthorizedRequest(
  request: Request,
  env: { DAYLAPSE: unknown; ASSETS: Pick<Fetcher, "fetch"> },
  render: () => Promise<Response>,
): Promise<Response> {
  const denied = await accessResponse(request, env.DAYLAPSE);
  if (denied) return denied;
  const path = new URL(request.url).pathname;
  if (["GET", "HEAD"].includes(request.method) && path !== "/api" && !path.startsWith("/api/")) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    await asset.body?.cancel();
  }
  return render();
}
