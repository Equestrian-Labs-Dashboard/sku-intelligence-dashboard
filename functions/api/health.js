import { requireSkuAccess, readAssetJson, safeError } from "../_lib/sku_api.js";
export async function onRequestGet(context) {
  try {
    await requireSkuAccess(context);
    const latest = await readAssetJson(context,"/data/latest-report.json");
    const stores = ["equestrian","cavali"].map((key) => ({
      key,
      name: key === "equestrian" ? "Corro" : "Cavali",
      store: latest?.stores?.[key]?.shopifyStore || null,
      configured: Boolean(latest?.stores?.[key]?.report)
    }));
    return Response.json({status:latest ? "ok" : "pending",generatedAt:latest?.generatedAt || null,integrations:{stores}},{headers:{"cache-control":"private, no-store"}});
  } catch (error) { return safeError(error); }
}
