import { requireSkuAccess, readAssetJson, safeError } from "../_lib/sku_api.js";
export async function onRequestGet(context) {
  try {
    await requireSkuAccess(context);
    const url = new URL(context.request.url);
    const store = url.searchParams.get("store") || "equestrian";
    const month = url.searchParams.get("month");
    if (!["equestrian","cavali"].includes(store)) return new Response(JSON.stringify({error:"Invalid store"}),{status:400,headers:{"content-type":"application/json"}});
    const latest = await readAssetJson(context,"/data/latest-report.json");
    if (!latest) return new Response(JSON.stringify({error:"No published report data yet."}),{status:404,headers:{"content-type":"application/json"}});
    const selectedMonth = month || latest.month;
    if (selectedMonth === latest.month && latest.stores?.[store]?.report) return Response.json(latest.stores[store].report,{headers:{"cache-control":"private, no-store"}});
    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) return new Response(JSON.stringify({error:"Invalid month"}),{status:400,headers:{"content-type":"application/json"}});
    const archive = await readAssetJson(context,`/data/archive/${store}/${selectedMonth.slice(0,4)}/${selectedMonth}.json`);
    if (archive?.report) return Response.json(archive.report,{headers:{"cache-control":"private, no-store"}});
    return new Response(JSON.stringify({error:"No archive found for the selected month."}),{status:404,headers:{"content-type":"application/json"}});
  } catch (error) { return safeError(error); }
}
