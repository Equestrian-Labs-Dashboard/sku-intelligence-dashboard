import { authorize } from "../_lib/authz.js";
import { canUseReport } from "../_lib/registry.js";
import { errorJson } from "../_lib/http.js";

export async function requireSkuAccess(context) {
  const { user } = await authorize(context);
  if (!canUseReport(user, "sku_intelligence")) {
    const error = new Error("Your account is not authorized for SKU Intelligence. Ask an administrator to add SKU Intelligence to Report Access.");
    error.status = 403;
    error.code = "sku_access_denied";
    throw error;
  }
  return user;
}
export async function readAssetJson(context, path) {
  const url = new URL(path, context.request.url);
  const response = await context.env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!response.ok) return null;
  return response.json();
}
export function safeError(error) {
  return errorJson(error?.message || "Unable to load SKU report.", Number(error?.status || 500), error?.code || "sku_report_error");
}
