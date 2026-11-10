import { requireSkuAccess, readAssetJson, safeError } from "../_lib/sku_api.js";
export async function onRequestGet(context) {
  try {
    await requireSkuAccess(context);
    const store = new URL(context.request.url).searchParams.get("store") || "equestrian";
    if (!["equestrian","cavali"].includes(store)) return Response.json({error:"Invalid store"},{status:400});
    const index = await readAssetJson(context,"/data/archive-index.json");
    return Response.json({months:index?.[store] || [],},{headers:{"cache-control":"private, no-store"}});
  } catch (error) { return safeError(error); }
}
