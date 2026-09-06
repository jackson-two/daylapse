import { isDakboardHostname } from "@/lib/display-auth";
import { noStoreJson } from "@/lib/household-state";
function retired(request:Request) {
  if(isDakboardHostname(request))return noStoreJson({error:"Not found."},{status:404});
  return noStoreJson({code:"reload_required",error:"Storage has been upgraded. Reload Daylapse before making changes. Unsaved edits in this old tab have not been applied."},{status:410});
}
export const GET=retired;
export const PUT=retired;
