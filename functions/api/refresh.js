import { requireSkuAccess, safeError } from "../_lib/sku_api.js";
export async function onRequestPost(context) {
  try {
    await requireSkuAccess(context);
    return Response.json({error:"Data refresh is managed securely by the scheduled GitHub Actions workflow. Please contact the dashboard administrator for an on-demand refresh."},{status:405});
  } catch (error) { return safeError(error); }
}
