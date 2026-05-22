import { unsealGleanCookiePayload } from "@/lib/gleanOAuthSession";
import { normalizeSupportdogDatacenter, SUPPORTDOG_DATACENTERS } from "@/lib/supportdogDatacenter";
import { getSupportdogMcpAuthorizationFromEnv } from "@/lib/supportdogMcpClient";
import {
  entryFromSessionPayload,
  readSupportdogSessionsMap,
  supportdogOAuthCookieSecret,
} from "@/lib/supportdogOAuthSession";

/**
 * Next datacenter that still needs OAuth (env token counts as satisfied).
 * @param {Record<string, { at?: string }>} sessionsMap
 */
export function nextSupportdogDatacenterNeedingAuth(sessionsMap) {
  for (const dc of SUPPORTDOG_DATACENTERS) {
    if (dc === "STAGING") continue;
    if (getSupportdogMcpAuthorizationFromEnv(dc)) continue;
    if (sessionsMap[dc]?.rt) continue;
    return dc;
  }
  return null;
}

/**
 * After OAuth callback: merge new region into map from request + fresh seal, return next DC for connect-all.
 * @param {Request} request
 * @param {string | null | undefined} datacenter
 * @param {string} sessionSeal
 */
export function nextDcAfterOAuthExchange(request, datacenter, sessionSeal) {
  const map = readSupportdogSessionsMap(request);
  const dc = normalizeSupportdogDatacenter(datacenter);
  const secret = supportdogOAuthCookieSecret();
  if (secret && sessionSeal && dc) {
    const payload = unsealGleanCookiePayload(sessionSeal, secret);
    const entry = entryFromSessionPayload(payload);
    if (entry?.rt) map[dc] = entry;
  }
  return nextSupportdogDatacenterNeedingAuth(map);
}
