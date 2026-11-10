import { requireSkuAccess, readAssetJson, safeError } from "../_lib/sku_api.js";
function cell(value){return `"${String(value ?? "").replaceAll('"','""')}"`;}
export async function onRequestGet(context) {
  try {
    await requireSkuAccess(context);
    const url = new URL(context.request.url);
    const store = url.searchParams.get("store") || "equestrian";
    const month = url.searchParams.get("month");
    const period = url.searchParams.get("period") || "YTD2026";
    if (!["equestrian","cavali"].includes(store) || !["FY2025","YTD2026","MONTH"].includes(period)) return Response.json({error:"Invalid export selection"},{status:400});
    let report;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const saved = await readAssetJson(context,`/data/archive/${store}/${month.slice(0,4)}/${month}.json`);
      report = saved?.report;
    } else {
      const latest = await readAssetJson(context,"/data/latest-report.json");
      report = latest?.stores?.[store]?.report;
    }
    const rows = report?.periods?.[period]?.skuRows || [];
    const columns = ["Rank","SKU","Product","Category","Vendor","Units Sold","Net Sales","Sales Share (%)","Cumulative Share (%)","Gross Profit","Gross Margin (%)","Available Inventory","Dropshipping","Inventory Action"];
    const csv = [columns,...rows.map(r=>[r.rank??"",r.sku,r.productTitle,r.category,r.vendor,r.unitsSold,r.netSales,r.salesShare,r.cumulativeShare,r.grossProfit,r.grossMargin??"",r.inventoryAvailable,r.isDropship?"Yes":"No",r.action])].map(row=>row.map(cell).join(",")).join("\r\n");
    return new Response("\uFEFF"+csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="sku-${store}-${period.toLowerCase()}.csv"`,"cache-control":"private, no-store"}});
  } catch (error) { return safeError(error); }
}
