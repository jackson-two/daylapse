import handler from "vinext/server/app-router-entry";
import { sendDueNotifications } from "../lib/notification-service";
import { serveAuthorizedRequest } from "../lib/worker-request";

const worker = {
  ...handler,
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return serveAuthorizedRequest(request, env, () => handler.fetch(request, env, ctx));
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    if (!env.DAYLAPSE.notifications) return;
    const result = await sendDueNotifications(env);
    console.log(JSON.stringify({ operation: "due-today-notifications", ...result }));
  },
};

export default worker;
