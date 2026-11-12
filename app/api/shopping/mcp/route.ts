import { env } from "cloudflare:workers";
import { handlePurchasingMcp } from "@/lib/purchasing/mcp";
export function POST(request: Request) {
  return handlePurchasingMcp(request, env.DB, env.DAYLAPSE);
}
export function GET(request: Request) {
  return handlePurchasingMcp(request, env.DB, env.DAYLAPSE);
}
export function DELETE(request: Request) {
  return handlePurchasingMcp(request, env.DB, env.DAYLAPSE);
}
