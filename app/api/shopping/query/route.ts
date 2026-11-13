import { env } from "cloudflare:workers";
import { handlePurchasingRequest } from "@/lib/purchasing/api";
export function GET(request: Request) {
  return handlePurchasingRequest(request, env.DB, env.DAYLAPSE);
}
export function POST(request: Request) {
  return handlePurchasingRequest(request, env.DB, env.DAYLAPSE);
}
