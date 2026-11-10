import { authorize } from "./authz.js";

export function assertLhHistoryAccess(email, env) {
  const ownerEmail = "arojas@corroshop.com";
  const configuredEmail = String(env?.LH_HISTORY_ALLOWED_EMAIL || ownerEmail).trim().toLowerCase();
  if (configuredEmail !== ownerEmail) {
    const err = new Error("LH_HISTORY_ALLOWED_EMAIL must match the report owner");
    err.status = 503;
    err.code = "lh_history_access_misconfigured";
    throw err;
  }
  const allowedEmail = ownerEmail;

  if (String(email || "").trim().toLowerCase() !== allowedEmail) {
    const err = new Error("This email is not allowed to view the LH customer history report");
    err.status = 403;
    err.code = "lh_history_access_denied";
    throw err;
  }
}

export async function authorizeLhHistory(context) {
  const { identity, user } = await authorize(context);
  assertLhHistoryAccess(identity.email, context.env);
  return { identity, user };
}
