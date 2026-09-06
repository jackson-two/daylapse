import { env } from "cloudflare:workers";
import { handleRowRequest } from "@/lib/row-api";

export function GET(request: Request) { return handleRowRequest(request, env.DB, env.DAYLAPSE); }
export function POST(request: Request) { return handleRowRequest(request, env.DB, env.DAYLAPSE); }
