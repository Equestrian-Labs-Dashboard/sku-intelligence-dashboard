import { requireSkuAccess, readAssetJson, safeError } from "../_lib/sku_api.js";
export async function onRequestGet(context) {
  try {
    await requireSkuAccess(context);
    const store = new URL(context.request.url).searchParams.get("store") || "equestrian";
    if (!["equestrian","cavali"].includes(store)) return Response.json({error:"Invalid store"},{status:400});
    const index = await readAssetJson(context,"/data/archive-index.json");
    const months = [...(index?.[store] || [])].sort();
    const snapshots = [];
    for (const month of months) {
      const saved = await readAssetJson(context,`/data/archive/${store}/${month.slice(0,4)}/${month}.json`);
      if (!saved?.report?.periods) continue;
      snapshots.push({month,MONTH:saved.report.periods.MONTH?.summary,FY2025:saved.report.periods.FY2025?.summary,YTD2026:saved.report.periods.YTD2026?.summary});
    }
    return Response.json({snapshots},{headers:{"cache-control":"private, no-store"}});
  } catch (error) { return safeError(error); }
}
