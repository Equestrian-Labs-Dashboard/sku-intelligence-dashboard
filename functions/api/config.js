import { json, errorJson } from "../_lib/http.js";

export async function onRequestGet(context) {
  try {
    const googleClientId = String(context.env.GOOGLE_CLIENT_ID || "").trim();
    if (!googleClientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
    return json({ ok: true, googleClientId });
  } catch (e) {
    return errorJson(e?.message || "Login configuration is unavailable", 500, "login_config_failed");
  }
}
