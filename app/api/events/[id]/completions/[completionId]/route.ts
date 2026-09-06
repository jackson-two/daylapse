import { env } from "cloudflare:workers";
import { handleRowRequest } from "@/lib/row-api";

export function PATCH(request: Request) { return handleRowRequest(request, env.DB, env.DAYLAPSE); }
export function DELETE(request: Request) { return handleRowRequest(request, env.DB, env.DAYLAPSE); }
